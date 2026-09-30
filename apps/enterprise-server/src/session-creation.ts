import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { JSONValue, TransactionSql } from 'postgres'
import { adoptedPresetId, readAdoptionInput } from '@paimind/agent-builder/adoption'
import { EnterpriseError, record, text, uuid } from './errors.js'
import type { Identity, CommandContext, RuntimeIdentity, ResourcePreparationKey } from './identity.js'
import type { NativeGateway } from './native-gateway.js'
import type { RuntimeGrant } from './runtime-bindings.js'
import { Publications } from './publications.js'
import { verifySessionTargetLineage } from './session-target-lineage.js'

interface Input { workspaceId: string; agentId: string; releaseId: string; configVersion: string }
type Target = Omit<RuntimeGrant, 'validForMs'>
interface Row { command_id: string; native_session_id: string; request_digest: string; target: Target; outcome: 'unconfirmed' | 'created' }
const projection = ({ validForMs: _ttl, ...target }: RuntimeGrant): Target => target
const changed = () => new EnterpriseError(409, 'session-runtime-changed', '创建所选运行单元已变化；不会重发旧操作')
function normalize(value: unknown): Input {
  const input = record(value, ['workspaceId', 'agentId', 'releaseId', 'configVersion'])
  return { workspaceId: text(input.workspaceId, 1, 200), agentId: text(input.agentId, 1, 160),
    releaseId: uuid(input.releaseId), configVersion: text(input.configVersion, 1, 160) }
}
function response(row: Row, input: Input, replayed: boolean) {
  return { operationId: row.command_id, replayed, data: { sessionId: row.native_session_id, workspaceId: input.workspaceId,
    agentId: input.agentId, releaseId: input.releaseId, configVersion: input.configVersion, presetId: adoptedPresetId(input.releaseId),
    outcome: row.outcome, runtimeGrant: false as const } }
}

/** Durable creation receipts, not native session ownership. Unknown commands
 * may explicitly recover the same native identity through its idempotent
 * create/attach contract. Confirmed commands only read; never recreate them. */
export class SessionCreation {
  constructor(private readonly identity: Identity, private readonly gateway: NativeGateway) {}
  async create(token: string | undefined, raw: unknown, context: CommandContext, signal: AbortSignal) {
    const input = normalize(raw)
    const target = await this.gateway.sessionCreationTarget(token, context.requestId)
    const lookup = async (db: TransactionSql, actor: RuntimeIdentity, key: ResourcePreparationKey) => {
      const [row] = await db<Row[]>`select * from haas.session_create_commands where tenant_id=${actor.account.tenantId}
        and actor_user_id=${actor.account.userId} and idempotency_key=${key.key}`
      if (row && row.request_digest !== key.requestDigest) throw new EnterpriseError(409, 'idempotency-conflict', '同一请求标识不能用于不同会话创建')
      return row
    }
    const authorize = async (db: TransactionSql, actor: RuntimeIdentity) => {
      signal.throwIfAborted()
      if (actor.account.tenantId !== target.tenantId || actor.account.userId !== target.userId || actor.account.role !== target.role) throw changed()
      return Publications.sessionRelease(db, actor, input)
    }
    const initial = await this.identity.sessionCreateTransaction(token, input, context, 'session.create.requested', async (db, actor, key) => {
      const row = await lookup(db, actor, key), release = await authorize(db, actor)
      if (row) await verifySessionTargetLineage(db, row.target, projection(target))
      return { data: { row, release, actor }, targetId: input.releaseId, reason: '核对明确授权版本和当前创建请求；未发送原生操作' }
    })
    const verifyNative = async () => {
      await this.gateway.adoptAgentPublication(token, context.requestId, initial.actor, readAdoptionInput({ tenantId: target.tenantId,
        publicationId: initial.release.publicationId, sourceUserId: initial.release.sourceUserId, snapshot: initial.release.snapshot }),
      'verify', initial.release.skillPublications.map(({ status: _status, ...reference }) => reference))
      signal.throwIfAborted()
    }
    await verifyNative()
    const proposedId = initial.row?.native_session_id ?? 'session-' + randomUUID()
    const nativeInput = { sessionId: proposedId, workspaceId: input.workspaceId, presetId: adoptedPresetId(input.releaseId) }
    // Validate the owned workspace before committing a new command identity.
    const before = await this.gateway.sessionCreation(token, context.requestId, target, nativeInput, false, signal)
    if (!before.workspaceExists) throw new EnterpriseError(404, 'session-workspace-unavailable', '工作区不存在或不可访问')
    const reserved = await this.identity.sessionCreateTransaction(token, input, context, 'session.create.requested', async (db, actor, key) => {
      await authorize(db, actor)
      const prior = await lookup(db, actor, key)
      if (prior) {
        await verifySessionTargetLineage(db, prior.target, projection(target))
        return { data: { row: prior, newReservation: false }, targetId: prior.command_id,
          reason: prior.outcome === 'created' ? '已确认创建只回读，不恢复或重建' : '重放核对同一原生编号；仅允许原所有者的幂等创建恢复' }
      }
      const [capacity] = await db<{ count: number }[]>`select count(*)::int as count from haas.session_create_commands where tenant_id=${actor.account.tenantId}`
      if (capacity!.count >= 10000) throw new EnterpriseError(409, 'session-command-capacity', '创建请求记录已达容量上限')
      const [row] = await db<Row[]>`insert into haas.session_create_commands
        (tenant_id,command_id,actor_user_id,idempotency_key,request_digest,native_session_id,intent,target)
        values (${actor.account.tenantId},${randomUUID()},${actor.account.userId},${key.key},${key.requestDigest},${proposedId},
          ${db.json(input as unknown as JSONValue)},${db.json(projection(target) as unknown as JSONValue)}) returning *`
      return { data: { row: row!, newReservation: true }, targetId: row!.command_id, reason: '持久保留原生编号；后续仅恢复同一原生身份' }
    })
    nativeInput.sessionId = reserved.row.native_session_id
    let created = false
    try {
      await verifyNative()
      created = (await this.gateway.sessionCreation(token, context.requestId, target, nativeInput,
        reserved.row.outcome === 'unconfirmed', signal)).created
    } catch (error) {
      // Definite pre-write conflicts are actionable, not an endlessly pending
      // unknown result. Transport ambiguity still retains the same command.
      if (error instanceof EnterpriseError && ['session-native-conflict', 'session-runtime-changed'].includes(error.code)) throw error
    }
    // Replays and confirmations reauthorize the caller and current release;
    // neither an old receipt nor an existing native object grants permission.
    const currentTarget = await this.gateway.sessionCreationTarget(token, context.requestId)
    if (!isDeepStrictEqual(projection(target), projection(currentTarget))) throw changed()
    return this.identity.sessionCreateTransaction(token, input, context, 'session.create.confirmed', async (db, actor, key) => {
      await authorize(db, actor)
      let row = (await lookup(db, actor, key))!
      await verifySessionTargetLineage(db, row.target, projection(target))
      if (created && row.outcome === 'unconfirmed') {
        const [confirmed] = await db<Row[]>`update haas.session_create_commands set outcome='created',confirmed_at=clock_timestamp()
          where tenant_id=${actor.account.tenantId} and command_id=${row.command_id} and outcome='unconfirmed' returning *`
        row = confirmed!
      }
      // A historical success is never returned as a currently confirmed
      // resource when the native owner cannot prove the same object now.
      const visible = created ? row : { ...row, outcome: 'unconfirmed' as const }
      return { data: response(visible, input, !reserved.newReservation), targetId: row.command_id,
        reason: created ? '原生身份、预设及工作区关系已回读确认' : '效果未确认；保留请求及原生编号，不自动重试' }
    })
  }
}
