import { randomUUID } from 'node:crypto'
import type { JSONValue, TransactionSql } from 'postgres'
import { EnterpriseError, record, text, uuid } from './errors.js'
import type { Identity, RuntimeIdentity, ResourcePreparationKey, CommandContext } from './identity.js'
import type { NativeGateway } from './native-gateway.js'
import type { RuntimeGrant } from './runtime-bindings.js'
import { Publications } from './publications.js'
import { verifySessionTargetLineage } from './session-target-lineage.js'

type Target = Omit<RuntimeGrant, 'validForMs'>
interface Row {
  command_id: string; request_digest: string; native_rpc_id: string; expected_version: string; preset_id: string;
  decision: 'approve' | 'reject'; target: Target; carrier_accepted: boolean
}
const projection = ({ validForMs: _ttl, ...target }: RuntimeGrant): Target => target
const changed = () => new EnterpriseError(409, 'approval-state-changed', '原审批或运行目标已变化；不能另选待处理请求')

/** Durable command identity only. Original native approval state and pending
 * consumption are never reconstructed from this table. No background retry. */
export class SessionApprovals {
  private active = 0
  private readonly pending = new Map<string | undefined, number>()
  constructor(private readonly identity: Identity, private readonly gateway: NativeGateway) {}
  async decide(token: string | undefined, sessionId: string, approvalId: string, raw: unknown, context: CommandContext, signal: AbortSignal) {
    if (this.active >= 8 || (this.pending.get(token) ?? 0) >= 2) throw new EnterpriseError(503, 'approval-command-busy', '审批正在处理中，请保留原请求标识', true)
    this.active++; this.pending.set(token, (this.pending.get(token) ?? 0) + 1)
    try { return await this.execute(token, sessionId, approvalId, raw, context, signal) }
    finally { this.active--; const remaining = this.pending.get(token)! - 1; if (remaining) this.pending.set(token, remaining); else this.pending.delete(token) }
  }
  private async execute(token: string | undefined, sessionId: string, approvalId: string, raw: unknown, context: CommandContext, signal: AbortSignal) {
    text(sessionId, 1, 200); if (/[\/\\]/u.test(sessionId)) throw new EnterpriseError(400, 'invalid-approval-input', '会话编号无效')
    approvalId = uuid(approvalId)
    const value = record(raw, ['decision', 'expectedVersion', 'reason'])
    if (!['approve', 'reject'].includes(value.decision as string) || typeof value.expectedVersion !== 'string'
      || !/^[A-Za-z0-9_-]{43}$/u.test(value.expectedVersion) || Buffer.from(value.expectedVersion, 'base64url').toString('base64url') !== value.expectedVersion) {
      throw new EnterpriseError(400, 'invalid-approval-input', '审批决定或准确版本无效')
    }
    const input = { sessionId, approvalId, decision: value.decision as 'approve' | 'reject', expectedVersion: value.expectedVersion, reason: text(value.reason, 3, 500) }
    const initial = await this.gateway.sessionApprovalState(token, context.requestId, sessionId, approvalId, signal, input.decision === 'approve')
    const target = initial.grant
    const lookup = async (db: TransactionSql, actor: RuntimeIdentity, key: ResourcePreparationKey) => {
      signal.throwIfAborted()
      if (actor.account.tenantId !== target.tenantId || actor.account.userId !== target.userId || actor.account.role !== target.role) throw changed()
      const [admitted] = await db`select 1 from haas.admitted_runtime_bindings where tenant_id=${target.tenantId} and user_id=${target.userId}
        and cell_id=${target.cellId} and revision=${target.revision} and origin=${target.origin}
        and status='ready' and isolation_mode='container-managed' and lease_expires_at>clock_timestamp()`
      if (!admitted) throw changed()
      if (input.decision === 'approve' && !(await Publications.readPresetEligibility(db, actor, [initial.presetId])).includes(initial.presetId)) {
        throw new EnterpriseError(403, 'preset-not-eligible', '当前智能体资格已撤回，不能批准或重放批准')
      }
      const [row] = await db<Row[]>`select * from haas.session_approval_commands where tenant_id=${actor.account.tenantId}
        and actor_user_id=${actor.account.userId} and idempotency_key=${key.key}`
      if (row) {
        if (row.request_digest !== key.requestDigest) throw new EnterpriseError(409, 'idempotency-conflict', '同一请求标识不能用于不同审批内容')
        if (row.preset_id !== initial.presetId) throw changed()
        await verifySessionTargetLineage(db, row.target, projection(target))
      }
      return row
    }
    const reserved = await this.identity.sessionApprovalTransaction(token, input, context, 'session.approval.requested', async (db, actor, key) => {
      const row = await lookup(db, actor, key)
      if (row) return { data: { row, replayed: true }, targetId: row.command_id, reason: '回读原审批命令；当前身份与原生状态仍须验证' }
      if (!initial.state.answerable || initial.state.version !== input.expectedVersion || !initial.state.rpcId) throw changed()
      const [other] = await db`select 1 from haas.session_approval_commands where tenant_id=${target.tenantId} and actor_user_id=${target.userId}
        and cell_id=${target.cellId} and native_session_id=${sessionId} and native_approval_id=${approvalId}`
      if (other) throw new EnterpriseError(409, 'approval-command-conflict', '此审批已有固定命令，请沿原请求标识读取，不提交相反决定')
      const [capacity] = await db<{ count: number }[]>`select count(*)::int as count from haas.session_approval_commands where tenant_id=${target.tenantId}`
      if (capacity!.count >= 10000) throw new EnterpriseError(409, 'approval-command-capacity', '审批命令记录已达容量上限')
      const commandId = randomUUID()
      const [created] = await db<Row[]>`insert into haas.session_approval_commands
        (tenant_id,command_id,actor_user_id,idempotency_key,request_digest,cell_id,native_session_id,native_approval_id,native_rpc_id,expected_version,preset_id,decision,reason,target)
        values (${target.tenantId},${commandId},${target.userId},${key.key},${key.requestDigest},${target.cellId},${sessionId},${approvalId},
          ${initial.state.rpcId},${input.expectedVersion},${initial.presetId},${input.decision},${input.reason},${db.json(projection(target) as unknown as JSONValue)}) returning *`
      return { data: { row: created!, replayed: false }, targetId: commandId, reason: input.reason }
    })
    let acknowledged = reserved.row.carrier_accepted
    if (!acknowledged && initial.state.answerable) {
      try {
        acknowledged = await this.gateway.submitSessionApproval(token, context.requestId, target,
          { sessionId, approvalId, expectedVersion: reserved.row.expected_version, rpcId: reserved.row.native_rpc_id,
            outcome: reserved.row.decision === 'approve' ? 'allowed-once' : 'rejected' }, signal)
      } catch (error) {
        if (error instanceof EnterpriseError && [400, 401, 403, 409].includes(error.status)) throw error
        // A lost acknowledgement is not rollback or permission to create a new
        // request. Re-read the original owner, without another native attempt.
      }
    }
    const after = await this.gateway.sessionApprovalState(token, context.requestId, sessionId, approvalId, signal, input.decision === 'approve', target)
    if (after.presetId !== initial.presetId) throw changed()
    return this.identity.sessionApprovalTransaction(token, input, context, 'session.approval.observed', async (db, actor, key) => {
      let row = (await lookup(db, actor, key))!
      if (!row) throw changed()
      if (acknowledged && !row.carrier_accepted) {
        const [updated] = await db<Row[]>`update haas.session_approval_commands set carrier_accepted=true,acknowledged_at=clock_timestamp()
          where tenant_id=${target.tenantId} and command_id=${row.command_id} and carrier_accepted=false returning *`
        row = updated!
      }
      return { data: { operationId: row.command_id, replayed: reserved.replayed,
        data: { sessionId, approvalId, decision: row.decision, carrierAccepted: row.carrier_accepted,
          observation: { version: after.state.version, outcome: after.state.outcome, answerable: after.state.answerable, persisted: after.state.persisted },
          decisionPersisted: row.carrier_accepted && after.state.persisted
            && after.state.outcome === (row.decision === 'approve' ? 'allowed-once' : 'rejected') ? true : null,
          executionComplete: false as const, runtimeGrant: false as const } }, targetId: row.command_id,
        reason: row.carrier_accepted ? '原答复载体已接受；观察不证明持久决定或工具执行完成' : '载体回执未确认；仅回读原审批，不据相同结果捏造命令归属' }
    })
  }
}
