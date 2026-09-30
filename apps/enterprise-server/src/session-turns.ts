import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { JSONValue, TransactionSql } from 'postgres'
import { prepareHarnessTurnSubmission } from '@paimind/harness-compat/gateway-transport'
import { EnterpriseError, record } from './errors.js'
import type { Identity, CommandContext, RuntimeIdentity, ResourcePreparationKey } from './identity.js'
import type { NativeGateway } from './native-gateway.js'
import type { RuntimeGrant } from './runtime-bindings.js'
import { verifySessionTargetLineage } from './session-target-lineage.js'
import { Publications } from './publications.js'

type Target = Omit<RuntimeGrant, 'validForMs'>
interface Row {
  command_id: string; native_session_id: string; request_digest: string; expected_version: string; content_digest: string
  target: Target; outcome: 'unconfirmed' | 'accepted'; native_message_id: string | null; native_seq: string | number | null
}
const projection = ({ validForMs: _ttl, ...value }: RuntimeGrant): Target => value
const changed = () => new EnterpriseError(409, 'session-runtime-changed', '轮次所选运行单元已变化；保留原请求标识')
const conflict = () => new EnterpriseError(409, 'session-version-conflict', '会话已变化，请回读当前版本；不会覆盖已有消息')

/** Durable identity, not a message owner or retry worker. Explicit replay
 * still passes through current authority and the original native dedup guard. */
export class SessionTurns {
  private readonly pending = new Map<string | undefined, number>()
  private active = 0
  constructor(private readonly identity: Identity, private readonly gateway: NativeGateway) {}
  async submit(token: string | undefined, sessionId: string, raw: unknown, context: CommandContext, signal: AbortSignal) {
    if (this.active >= 8 || (this.pending.get(token) ?? 0) >= 2) throw new EnterpriseError(503, 'turn-command-busy', '轮次提交正在处理中，请保留请求标识稍后重试', true)
    this.active += 1; this.pending.set(token, (this.pending.get(token) ?? 0) + 1)
    try { return await this.execute(token, sessionId, raw, context, signal) }
    finally {
      this.active -= 1
      const count = this.pending.get(token)! - 1
      if (count) this.pending.set(token, count); else this.pending.delete(token)
    }
  }
  private async execute(token: string | undefined, sessionId: string, raw: unknown, context: CommandContext, signal: AbortSignal) {
    const value = record(raw, ['text', 'expectedVersion'])
    if (typeof value.text !== 'string' || !value.text.length || value.text.length > 65536
      || typeof value.expectedVersion !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value.expectedVersion)
      || Buffer.from(value.expectedVersion, 'base64url').toString('base64url') !== value.expectedVersion
      || typeof sessionId !== 'string' || !sessionId || sessionId.length > 200 || /[\u0000-\u001f\u007f/\\]/u.test(sessionId)) {
      throw new EnterpriseError(400, 'invalid-turn-input', '轮次内容或准确版本无效')
    }
    const input = { sessionId, text: value.text, expectedVersion: value.expectedVersion }
    const initial = await this.gateway.sessionTurnState(token, context.requestId, sessionId, signal, undefined, true)
    const target = initial.grant
    const lookup = async (db: TransactionSql, actor: RuntimeIdentity, key: ResourcePreparationKey) => {
      signal.throwIfAborted()
      if (actor.account.tenantId !== target.tenantId || actor.account.userId !== target.userId || actor.account.role !== target.role) throw changed()
      const [admitted] = await db`select 1 from haas.admitted_runtime_bindings where tenant_id=${target.tenantId} and user_id=${target.userId}
        and cell_id=${target.cellId} and revision=${target.revision} and origin=${target.origin}
        and status='ready' and isolation_mode='container-managed' and lease_expires_at>clock_timestamp()`
      if (!admitted) throw changed()
      const presetId = initial.state.presetId
      if (!presetId || !(await Publications.readPresetEligibility(db, actor, [presetId])).includes(presetId)) {
        throw new EnterpriseError(403, 'preset-not-eligible', '当前智能体资格已撤回，不能重放或确认轮次')
      }
      const [row] = await db<Row[]>`select * from haas.session_turn_commands where tenant_id=${actor.account.tenantId}
        and actor_user_id=${actor.account.userId} and idempotency_key=${key.key}`
      if (row && row.request_digest !== key.requestDigest) throw new EnterpriseError(409, 'idempotency-conflict', '同一请求标识不能用于不同轮次内容')
      if (row) await verifySessionTargetLineage(db, row.target, projection(target))
      return row
    }
    const prior = await this.identity.sessionTurnTransaction(token, input, context, 'session.turn.requested', async (db, actor, key) => {
      const row = await lookup(db, actor, key)
      return { data: row, targetId: row?.command_id ?? context.requestId, reason: '核对当前主体与原轮次命令；未发送原生消息' }
    })
    const commandId = prior?.command_id ?? randomUUID()
    const selection = prepareHarnessTurnSubmission(sessionId, input.text, commandId, input.expectedVersion).selection
    const before = await this.gateway.sessionTurnState(token, context.requestId, sessionId, signal, prior ? selection : undefined, true, target)
    const reserved = await this.identity.sessionTurnTransaction(token, input, context, 'session.turn.requested', async (db, actor, key) => {
      const row = await lookup(db, actor, key)
      if (row) return { data: { row, replayed: true }, targetId: row.command_id, reason: '复用准确命令身份，重新验证原生效果' }
      if (before.state.version !== input.expectedVersion) throw conflict()
      const [capacity] = await db<{ count: number }[]>`select count(*)::int as count from haas.session_turn_commands where tenant_id=${actor.account.tenantId}`
      if (capacity!.count >= 10000) throw new EnterpriseError(409, 'turn-command-capacity', '轮次请求记录已达容量上限')
      const [created] = await db<Row[]>`insert into haas.session_turn_commands
        (tenant_id,command_id,actor_user_id,idempotency_key,request_digest,native_session_id,expected_version,content_digest,target)
        values (${actor.account.tenantId},${commandId},${actor.account.userId},${key.key},${key.requestDigest},${sessionId},
          ${input.expectedVersion},${selection.contentDigest},${db.json(projection(target) as unknown as JSONValue)}) returning *`
      return { data: { row: created!, replayed: false }, targetId: commandId, reason: '保留准确原生会话和命令引用；正文只送原宿主，不写命令表' }
    })
    const fixed = { commandId: reserved.row.command_id, expectedVersion: reserved.row.expected_version, contentDigest: reserved.row.content_digest }
    // The persistent native owner can prove a previous insertion without an
    // active Agent or a second prompt. It is not execution permission: current
    // authority, assignment and immutable replacement lineage remain required.
    // An explicit replay may continue the same still-pending native message;
    // consumed, edited or removed work remains a read-only historical receipt.
    let acknowledged = reserved.row.outcome === 'accepted' || !!(prior && before.state.accepted && before.state.persisted)
    if (!acknowledged || before.state.pending) {
      try { acknowledged = await this.gateway.submitSessionTurn(token, context.requestId, target,
        { ...input, commandId: fixed.commandId }, signal) }
      catch (error) {
        if (error instanceof EnterpriseError && [400, 401, 403, 409].includes(error.status)) throw error
        // Unknown effect retains the same command; no background retry or
        // alternate native identity. Native insertion alone cannot confirm it.
      }
    }
    const after = await this.gateway.sessionTurnState(token, context.requestId, sessionId, signal, fixed, true, target)
    if (!isDeepStrictEqual(projection(target), projection(after.grant)) || initial.state.presetId !== after.state.presetId) throw changed()
    return this.identity.sessionTurnTransaction(token, input, context, 'session.turn.confirmed', async (db, actor, key) => {
      let row = (await lookup(db, actor, key))!
      const accepted = after.state.accepted
      if (row.outcome === 'accepted' && accepted
        && (accepted.messageId !== row.native_message_id || accepted.seq !== Number(row.native_seq))) throw changed()
      if (acknowledged && accepted && after.state.persisted && row.outcome === 'unconfirmed') {
        const [confirmed] = await db<Row[]>`update haas.session_turn_commands set outcome='accepted', native_message_id=${accepted.messageId},
          native_seq=${accepted.seq},confirmed_at=clock_timestamp() where tenant_id=${actor.account.tenantId} and command_id=${row.command_id}
          and outcome='unconfirmed' returning *`
        row = confirmed!
      }
      const confirmed = row.outcome === 'accepted' && accepted !== null && after.state.persisted
      return { data: { operationId: row.command_id, replayed: reserved.replayed,
        data: { sessionId, outcome: confirmed ? 'accepted' as const : 'unconfirmed' as const,
          messageId: confirmed ? row.native_message_id : null, nativeSeq: confirmed ? Number(row.native_seq) : null,
          executionComplete: false as const, runtimeGrant: false as const } }, targetId: row.command_id,
      reason: confirmed ? '原生消息已确认持久入队；不代表模型或工具执行完成' : '效果尚未确认，保留原命令，不自动重发' }
    })
  }
}
