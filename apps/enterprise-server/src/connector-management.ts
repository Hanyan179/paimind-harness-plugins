import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { JSONValue, TransactionSql } from 'postgres'
import { validateConnectorConfiguration, validateConnectorActivationState, validateConnectorRelease, validateNativeControlInput, type NativeConnectorConfiguration } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { EnterpriseError, invalid, record, text, uuid } from './errors.js'
import type { Account, CommandContext, Identity, RuntimeIdentity } from './identity.js'
import type { RuntimeBindings, PrivateRuntimeCell } from './runtime-bindings.js'
import type { CellTransport } from './cell-transport.js'
import { retainCellTransports, selectCellTransport } from './cell-transport-directory.js'

type Change = { kind: 'remove'; entryId: string } | { kind: 'upsert'; entryId: string; configuration: Record<string, unknown> }
interface Input { targetUserId: string; expectedCellRevision: string; expectedConfigurationRevision: string; change: Change; reason: string; confirmed: true }
type Intent = Omit<Input, 'change'> & { change: { kind: Change['kind']; entryId: string } }
interface Command { command_id: string; target_user_id: string; request_digest: string; target_pin: PrivateRuntimeCell; intent: Intent;
  outcome: 'unconfirmed' | 'saved-disabled' | 'unchanged' | 'conflict' | 'superseded'; confirmation: object | null }
interface ActivationInput { targetUserId: string; expectedCellRevision: string; expectedConfigurationRevision: string;
  entryId: string; configurationVersion: string; enabled: boolean; expectedApprovalRevision: number | null; reason: string; confirmed: true }
interface ActivationCommand { command_id: string; target_user_id: string; request_digest: string; target_pin: PrivateRuntimeCell; intent: ActivationInput;
  outcome: 'unconfirmed' | 'enabled' | 'disabled' | 'conflict' | 'superseded'; confirmation: object | null }
interface Approval {
  target_user_id: string; entry_id: string; configuration_version: string; server_name: string; transport: 'stdio' | 'streamable-http';
  cell_id: string; volume_name: string; image_id: string; policy_digest: string;
  decision: 'approved' | 'revoked'; revision: number; reason: string; updated_by: string
}
interface ApprovalSelection { targetUserId: string; entryId: string; expectedApprovalRevision: number; reason: string; confirmed: true }
type ApprovalInput = ApprovalSelection & ({ decision: 'approved'; expectedCellRevision: string; expectedConfigurationRevision: string } | { decision: 'revoked' })
const approvalChanged = () => new EnterpriseError(409, 'connector-approval-changed', '连接器批准记录已变化，请重新读取后确认')
const approvalView = (row: Approval) => ({ targetUserId: row.target_user_id, entryId: row.entry_id,
  configurationVersion: row.configuration_version, serverName: row.server_name, transport: row.transport,
  imageId: row.image_id, policyDigest: row.policy_digest, decision: row.decision, revision: row.revision,
  reason: row.reason, updatedBy: row.updated_by, historicalRecord: true as const, runtimeGrant: false as const, activation: 'not-observed' as const })
type ApprovalView = ReturnType<typeof approvalView>
const approvalScope = (row: Approval, cell: PrivateRuntimeCell) => row.cell_id === cell.cellId && row.volume_name === cell.volumeName
  && row.image_id === cell.imageId && row.policy_digest === cell.policyDigest && row.target_user_id === cell.userId
function connectorEntryId(value: unknown): string {
  const id = text(value, 1, 64)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(id)) return invalid('连接器条目编号无效')
  return id
}
function approvalInput(body: unknown): ApprovalInput {
  const decision = (body as { decision?: unknown } | null)?.decision
  const value = record(body, ['targetUserId','entryId','expectedApprovalRevision','decision','reason','confirmed',
    ...(decision === 'approved' ? ['expectedCellRevision','expectedConfigurationRevision'] : [])])
  if (!['approved','revoked'].includes(String(decision)) || value.confirmed !== true
    || !Number.isSafeInteger(value.expectedApprovalRevision) || Number(value.expectedApprovalRevision) < 0
    || Number(value.expectedApprovalRevision) >= 2_147_483_647) return invalid('请确认准确的连接器批准修订')
  const selected: ApprovalSelection = { targetUserId: uuid(value.targetUserId), entryId: connectorEntryId(value.entryId),
    expectedApprovalRevision: Number(value.expectedApprovalRevision), reason: text(value.reason, 3, 500), confirmed: true }
  if (decision === 'revoked') return { ...selected, decision }
  const revision = text(value.expectedConfigurationRevision, 64, 64)
  if (!/^[a-f0-9]{64}$/u.test(revision)) return invalid('连接器配置修订无效')
  return { ...selected, decision: 'approved', expectedCellRevision: uuid(value.expectedCellRevision), expectedConfigurationRevision: revision }
}
const changed = () => new EnterpriseError(409, 'connector-context-changed', '管理员、成员或连接器配置修订已变化，请重新读取并确认')
const pending = () => new EnterpriseError(409, 'connector-command-pending', '该成员存在结果不确定的连接器操作，请查看记录，不要换键重复提交')
const unavailable = () => new EnterpriseError(502, 'connector-configuration-unavailable', '原生连接器配置无法确认', true)
const missing = () => new EnterpriseError(404, 'connector-command-not-found', '连接器操作不存在或不可访问')
const sameActor = (a: RuntimeIdentity, b: RuntimeIdentity) => a.sessionId === b.sessionId && isDeepStrictEqual(a.account, b.account)
const summary = (row: Command) => ({ commandId: row.command_id, targetUserId: row.target_user_id, outcome: row.outcome,
  intent: row.intent, confirmation: row.confirmation, historicalReceipt: true as const, runtimeGrant: false as const })
const activationSummary = (row: ActivationCommand) => ({ commandId: row.command_id, targetUserId: row.target_user_id, outcome: row.outcome,
  intent: row.intent, confirmation: row.confirmation, historicalReceipt: true as const, runtimeGrant: false as const })
function normalizeActivation(body: unknown): ActivationInput {
  const row = record(body, ['targetUserId','expectedCellRevision','expectedConfigurationRevision','entryId','configurationVersion','enabled','expectedApprovalRevision','reason','confirmed'])
  try { validateNativeControlInput('connector.activate', {entryId:row.entryId,configurationVersion:row.configurationVersion,
    expectedRevision:row.expectedConfigurationRevision,enabled:row.enabled,expectedApprovalRevision:row.expectedApprovalRevision}) } catch { return invalid('连接器启停输入或批准修订无效') }
  if (row.confirmed !== true) return invalid('请确认准确成员、连接器版本和启停操作')
  return {targetUserId:uuid(row.targetUserId),expectedCellRevision:uuid(row.expectedCellRevision),expectedConfigurationRevision:String(row.expectedConfigurationRevision),
    entryId:String(row.entryId),configurationVersion:String(row.configurationVersion),enabled:row.enabled as boolean,
    expectedApprovalRevision:row.expectedApprovalRevision as number | null,reason:text(row.reason,3,500),confirmed:true}
}
function normalize(body: unknown): Input {
  const row = record(body, ['targetUserId', 'expectedCellRevision', 'expectedConfigurationRevision', 'change', 'reason', 'confirmed'])
  const revision = text(row.expectedConfigurationRevision, 64, 64)
  if (row.confirmed !== true || !/^[a-f0-9]{64}$/u.test(revision)) return invalid('请确认准确的连接器配置修订')
  const value = row.change as Partial<Change> | undefined
  record(value, value?.kind === 'upsert' ? ['kind', 'entryId', 'configuration'] : ['kind', 'entryId'])
  try { validateNativeControlInput('connector.configure', { ...value, expectedRevision: revision }) } catch { return invalid('连接器配置输入无效') }
  return { targetUserId: uuid(row.targetUserId), expectedCellRevision: uuid(row.expectedCellRevision), expectedConfigurationRevision: revision,
    change: value as Change, reason: text(row.reason, 3, 500), confirmed: true }
}
/** Durable operation metadata only. The native Include remains the sole
 * configuration owner. A reserved command has exactly one sender; uncertain
 * effects are never retried, inferred from metadata, or represented as grants. */
export class ConnectorManagement {
  private readonly transports: ReadonlyMap<string, CellTransport>
  private readonly active = new Set<AbortController>()
  private readonly pending = new Map<string, number>()
  private closed = false
  constructor(private readonly identity: Identity, private readonly bindings: RuntimeBindings, transports: ReadonlyMap<string, CellTransport>) {
    this.transports = retainCellTransports(transports)
  }
  close() { this.closed = true; for (const controller of this.active) controller.abort() }
  private async lifetime<T>(token: string | undefined, cancellation: AbortSignal, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const key = createHash('sha256').update(token ?? '').digest('hex')
    if (this.closed || this.active.size >= 8 || (this.pending.get(key) ?? 0) >= 2) throw new EnterpriseError(503, 'connector-management-busy', '连接器管理暂不可用或已达并发上限', true)
    const controller = new AbortController(); this.active.add(controller); this.pending.set(key, (this.pending.get(key) ?? 0) + 1)
    try { return await run(AbortSignal.any([controller.signal, cancellation, AbortSignal.timeout(15_000)])) }
    finally { this.active.delete(controller); const count = this.pending.get(key)! - 1; if (count) this.pending.set(key, count); else this.pending.delete(key) }
  }
  private async target(db: TransactionSql, actor: RuntimeIdentity, userId: string): Promise<PrivateRuntimeCell> {
    if (this.closed) throw new EnterpriseError(503, 'connector-management-closed', '连接器管理已关闭', true)
    const [row] = await db<{ user_id: string; tenant_id: string; username: string; display_name: string; role: Account['role']; status: Account['status'] }[]>`
      select user_id,tenant_id,username,display_name,role,status from haas.users
      where tenant_id=${actor.account.tenantId} and user_id=${userId} and status='active' and role='member'`
    if (!row) throw missing()
    return this.bindings.selectManagedAccount(db, { userId: row.user_id, tenantId: row.tenant_id, username: row.username,
      displayName: row.display_name, role: row.role, status: row.status })
  }
  private async verify(token: string | undefined, requestId: string, actor: RuntimeIdentity, cell: PrivateRuntimeCell, signal: AbortSignal) {
    await this.identity.resourceRead(token, requestId, true, async (db, current) => {
      const target = await this.target(db, current, cell.userId); signal.throwIfAborted()
      if (!sameActor(actor, current) || !isDeepStrictEqual(cell, target)) throw changed()
    })
  }
  private async request(cell: PrivateRuntimeCell, operation: 'connector.configuration' | 'connector.activation-state' | 'connector.activate' | 'connector.prepare' | 'connector.configure' | 'connector.release', input: object, signal: AbortSignal) {
    const transport = selectCellTransport(this.transports, cell)
    if (!transport || transport.ingressOrigin !== cell.origin) throw unavailable()
    try { return await transport.requestControl(operation, input, signal) } catch { throw unavailable() }
  }
  private async configuration(cell: PrivateRuntimeCell, signal: AbortSignal) {
    const state = await this.request(cell, 'connector.configuration', {}, signal)
    try { validateConnectorConfiguration(state) } catch { throw unavailable() }
    return state
  }
  private async lifecycle(cell: PrivateRuntimeCell, signal: AbortSignal) {
    const state = await this.request(cell,'connector.activation-state',{},signal)
    try { validateConnectorActivationState(state) } catch { throw unavailable() }
    return state
  }
  private async requireNoPending(db: TransactionSql, actor: RuntimeIdentity, userId: string) {
    if ((await db`select 1 from haas.connector_commands where tenant_id=${actor.account.tenantId} and target_user_id=${userId} and outcome='unconfirmed'
      union all select 1 from haas.connector_activation_commands where tenant_id=${actor.account.tenantId} and target_user_id=${userId} and outcome='unconfirmed' limit 1`).length) throw pending()
  }
  private async approvalMember(db: TransactionSql, actor: RuntimeIdentity, userId: string) {
    // Reading/revoking a stored approval must remain possible when a member is
    // disabled or their cell/configuration no longer exists. Still tenant-bound.
    if (this.closed) throw new EnterpriseError(503, 'connector-management-closed', '连接器管理已关闭', true)
    if (!(await db`select 1 from haas.users where tenant_id=${actor.account.tenantId} and user_id=${userId} and role='member'`).length) throw missing()
  }
  private async approval(db: TransactionSql, actor: RuntimeIdentity, input: { targetUserId: string; entryId: string }) {
    const [row] = await db<Approval[]>`select * from haas.connector_approvals
      where tenant_id=${actor.account.tenantId} and target_user_id=${input.targetUserId} and entry_id=${input.entryId}`
    return row
  }
  async approvalState(token: string | undefined, input: unknown, requestId: string) {
    const body = record(input, ['targetUserId','entryId','reason','confirmed'])
    if (body.confirmed !== true) return invalid('请确认读取所选连接器批准记录')
    const data = { targetUserId: uuid(body.targetUserId), entryId: connectorEntryId(body.entryId) }, reason = text(body.reason, 3, 500)
    return this.identity.connectorTransaction(token, requestId, 'runtime.connector.approval.read', async (db, actor) => {
      await this.approvalMember(db, actor, data.targetUserId)
      const row = await this.approval(db, actor, data)
      return { data: { ...data, approval: row ? approvalView(row) : null, observation: 'stored-only' as const }, targetId: data.targetUserId, reason }
    })
  }
  async decideApproval(token: string | undefined, body: unknown, context: CommandContext, cancellation: AbortSignal) {
    const input = approvalInput(body), action = 'runtime.connector.approval' as const
    return this.lifetime(token, cancellation, async signal => {
      const replay = async (db: TransactionSql, actor: RuntimeIdentity, data: ApprovalInput, previous: ApprovalView) => {
        signal.throwIfAborted(); await this.approvalMember(db, actor, data.targetUserId)
        const row = await this.approval(db, actor, data)
        if (!row || !isDeepStrictEqual(approvalView(row), previous)) throw approvalChanged()
        if (data.decision === 'approved' && !approvalScope(row, await this.target(db, actor, data.targetUserId))) throw changed()
      }
      const reason = (row: Approval) => JSON.stringify({ entryId: row.entry_id, configurationVersion: row.configuration_version,
        decision: row.decision, revision: row.revision, reason: row.reason, activation: 'not-observed' })
      if (input.decision === 'revoked') {
        // Pure governance commit: no healthy worker, readable config or active
        // target is required to withdraw. Never claim this stopped a process.
        return this.identity.resourceCommand<ApprovalInput, ApprovalView>(token, action, () => input, context, true, async (db, actor, data) => {
          signal.throwIfAborted(); await this.approvalMember(db, actor, data.targetUserId)
          const current = await this.approval(db, actor, data)
          if (!current || current.revision !== data.expectedApprovalRevision) throw approvalChanged()
          signal.throwIfAborted()
          const [row] = await db<Approval[]>`update haas.connector_approvals set decision='revoked',revision=revision+1,
            reason=${data.reason},updated_by=${actor.account.userId},updated_at=clock_timestamp()
            where tenant_id=${actor.account.tenantId} and target_user_id=${data.targetUserId} and entry_id=${data.entryId} returning *`
          return { data: approvalView(row!), targetId: data.targetUserId, reason: reason(row!) }
        }, replay)
      }
      const prepare = async (db: TransactionSql, actor: RuntimeIdentity, data: ApprovalInput) => {
        signal.throwIfAborted(); if (data.decision !== 'approved') throw changed()
        const cell = await this.target(db, actor, data.targetUserId), row = await this.approval(db, actor, data)
        if (cell.revision !== data.expectedCellRevision) throw changed()
        if ((row?.revision ?? 0) !== data.expectedApprovalRevision) throw approvalChanged()
        await this.requireNoPending(db, actor, data.targetUserId)
        return { cell }
      }
      const prepared = await this.identity.prepareResourceCommand<ApprovalInput, ApprovalView, { cell: PrivateRuntimeCell }>(token, action,
        () => input, context, true, (db, actor, data) => prepare(db, actor, data), replay)
      if (prepared.kind === 'replay') return prepared.result
      const cell = prepared.prepared.cell
      await this.verify(token, context.requestId, prepared.principal, cell, signal)
      const reference = await this.identity.resourceTransfer(token, context.requestId, async () => {
        const release = await this.request(cell, 'connector.release', { entryId: input.entryId, expectedRevision: input.expectedConfigurationRevision }, signal)
        try { validateConnectorRelease(release) } catch { throw unavailable() }
        if (release.outcome === 'unversioned') throw new EnterpriseError(409, 'connector-version-required', '旧配置尚无稳定版本，请先显式完整替换后再批准')
        if (release.outcome !== 'current' || release.revision !== input.expectedConfigurationRevision || release.reference.entryId !== input.entryId) throw changed()
        return release.reference
      }, action)
      // External I/O is outside the tenant transaction. Approval refers only
      // to this exact observed immutable version, never to whatever config may
      // be current later. Actual activation/use must independently revalidate it.
      return this.identity.resourceCommand<ApprovalInput, ApprovalView>(token, action, () => input, context, true, async (db, actor, data) => {
        const current = await prepare(db, actor, data)
        if (!sameActor(prepared.principal, actor) || !isDeepStrictEqual(cell, current.cell)) throw changed()
        if (!await this.approval(db, actor, data)) {
          const [capacity] = await db<{ count: number }[]>`select count(*)::int as count from haas.connector_approvals where tenant_id=${actor.account.tenantId}`
          if (capacity!.count >= 10_000) throw new EnterpriseError(409, 'connector-approval-capacity', '连接器批准记录已达容量上限，请联系部署人员')
        }
        signal.throwIfAborted()
        const [row] = await db<Approval[]>`insert into haas.connector_approvals
          (tenant_id,target_user_id,entry_id,configuration_version,server_name,transport,cell_id,volume_name,image_id,policy_digest,decision,revision,reason,updated_by)
          values (${actor.account.tenantId},${data.targetUserId},${data.entryId},${reference.configurationVersion},${reference.serverName},${reference.transport},
            ${cell.cellId},${cell.volumeName},${cell.imageId},${cell.policyDigest},'approved',${data.expectedApprovalRevision+1},${data.reason},${actor.account.userId})
          on conflict (tenant_id,target_user_id,entry_id) do update set configuration_version=excluded.configuration_version,
            server_name=excluded.server_name,transport=excluded.transport,cell_id=excluded.cell_id,volume_name=excluded.volume_name,
            image_id=excluded.image_id,policy_digest=excluded.policy_digest,decision=excluded.decision,revision=excluded.revision,
            reason=excluded.reason,updated_by=excluded.updated_by,updated_at=clock_timestamp() returning *`
        return { data: approvalView(row!), targetId: data.targetUserId, reason: reason(row!) }
      }, replay)
    })
  }
  private outcome(value: unknown, planned: boolean): { outcome: string; state: NativeConnectorConfiguration } {
    try {
      const row = record(value, ['outcome', 'state'])
      if (!(planned ? ['ready', 'unchanged', 'conflict'] : ['saved-disabled', 'unchanged', 'conflict']).includes(String(row.outcome))) throw unavailable()
      validateConnectorConfiguration(row.state)
      return { outcome: String(row.outcome), state: row.state }
    } catch { throw unavailable() }
  }
  async inspect(token: string | undefined, body: unknown, requestId: string, cancellation: AbortSignal) {
    const input = record(body, ['targetUserId', 'reason', 'confirmed']), userId = uuid(input.targetUserId), reason = text(input.reason, 3, 500)
    if (input.confirmed !== true) return invalid('请确认读取连接器配置及审计提示')
    return this.lifetime(token, cancellation, async signal => {
      const initial = await this.identity.connectorTransaction(token, requestId, 'runtime.connector.command.authorized', async (db, actor) => {
        const cell = await this.target(db, actor, userId); signal.throwIfAborted()
        return { data: { actor, cell }, targetId: userId, reason }
      })
      await this.verify(token, requestId, initial.actor, initial.cell, signal)
      const configuration = await this.configuration(initial.cell, signal)
      return this.identity.connectorTransaction(token, requestId, 'runtime.connector.configuration.read', async (db, actor) => {
        const cell = await this.target(db, actor, userId); signal.throwIfAborted()
        if (!sameActor(initial.actor, actor) || !isDeepStrictEqual(initial.cell, cell)) throw changed()
        return { data: { targetUserId: userId, cellRevision: cell.revision, configuration, activation: 'not-authorized' as const }, targetId: userId, reason }
      })
    })
  }
  async inspectActivation(token: string | undefined, body: unknown, requestId: string, cancellation: AbortSignal) {
    const input = record(body, ['targetUserId','reason','confirmed']), userId = uuid(input.targetUserId), reason = text(input.reason, 3, 500)
    if (input.confirmed !== true) return invalid('请确认读取连接器启停状态及审计提示')
    return this.lifetime(token, cancellation, async signal => {
      const initial = await this.identity.connectorTransaction(token, requestId, 'runtime.connector.command.authorized', async (db, actor) => {
        const cell = await this.target(db, actor, userId); signal.throwIfAborted()
        return { data: { actor, cell }, targetId: userId, reason }
      })
      await this.verify(token, requestId, initial.actor, initial.cell, signal)
      const lifecycle = await this.request(initial.cell, 'connector.activation-state', {}, signal)
      try { validateConnectorActivationState(lifecycle) } catch { throw unavailable() }
      return this.identity.connectorTransaction(token, requestId, 'runtime.connector.activation.read', async (db, actor) => {
        const cell = await this.target(db, actor, userId); signal.throwIfAborted()
        if (!sameActor(initial.actor, actor) || !isDeepStrictEqual(initial.cell, cell)) throw changed()
        // Native gate presence is an observation, not a current DB approval,
        // network probe, command receipt or permission to invoke any tool.
        return { data: { targetUserId: userId, cellRevision: cell.revision, lifecycle,
          observation: 'native-lifecycle-only' as const, runtimeGrant: false as const }, targetId: userId, reason }
      })
    })
  }
  async read(token: string | undefined, id: string, requestId: string) {
    const commandId = uuid(id)
    return this.identity.connectorTransaction(token, requestId, 'runtime.connector.receipt', async (db, actor) => {
      const [row] = await db<Command[]>`select * from haas.connector_commands where tenant_id=${actor.account.tenantId} and command_id=${commandId}`
      if (!row) throw missing()
      return { data: summary(row), targetId: row.target_user_id, reason: JSON.stringify({ commandId }) }
    })
  }
  async state(token: string | undefined, body: unknown, requestId: string) {
    const targetUserId = uuid(record(body, ['targetUserId']).targetUserId)
    return this.identity.connectorTransaction(token, requestId, 'runtime.connector.receipt', async (db, actor) => {
      if (!(await db`select 1 from haas.users where tenant_id=${actor.account.tenantId} and user_id=${targetUserId} and role='member'`).length) throw missing()
      const [row] = await db<Command[]>`select * from haas.connector_commands where tenant_id=${actor.account.tenantId} and target_user_id=${targetUserId}
        order by (outcome='unconfirmed') desc, created_at desc, command_id desc limit 1`
      return { data: { targetUserId, command: row ? summary(row) : null }, targetId: targetUserId, reason: '读取最近连接器配置操作；不访问配置正文或凭证' }
    })
  }
  async create(token: string | undefined, body: unknown, context: CommandContext, cancellation: AbortSignal) {
    const input = normalize(body), intent: Intent = { ...input, change: { kind: input.change.kind, entryId: input.change.entryId } }
    const wire = { ...input.change, expectedRevision: input.expectedConfigurationRevision }
    return this.lifetime(token, cancellation, async signal => {
      const lookup = async (db: TransactionSql, actor: RuntimeIdentity, key: { key: string; requestDigest: string }) => {
        const [row] = await db<Command[]>`select * from haas.connector_commands
          where tenant_id=${actor.account.tenantId} and actor_user_id=${actor.account.userId} and idempotency_key=${key.key}`
        if (row && row.request_digest !== key.requestDigest) throw new EnterpriseError(409, 'idempotency-conflict', '同一请求标识不能用于不同连接器配置')
        return row
      }
      const initial = await this.identity.connectorCommandTransaction<{ actor: RuntimeIdentity; cell: PrivateRuntimeCell; row: Command | undefined }>(token, input, context, 'runtime.connector.command.authorized', async (db, actor, key) => {
        signal.throwIfAborted(); const row = await lookup(db, actor, key)
        if (row) return { data: { actor, cell: row.target_pin, row }, targetId: input.targetUserId, reason: input.reason }
        const cell = await this.target(db, actor, input.targetUserId)
        if (cell.revision !== input.expectedCellRevision) throw changed()
        await this.requireNoPending(db, actor, input.targetUserId)
        return { data: { actor, cell, row: undefined }, targetId: input.targetUserId, reason: input.reason }
      })
      if (initial.row) return summary(initial.row)
      const verify = () => this.verify(token, context.requestId, initial.actor, initial.cell, signal)
      await verify()
      // Native syntax, collisions, resource bounds and optimistic revision are
      // checked by the sole configuration owner before any durable reservation.
      const plan = this.outcome(await this.request(initial.cell, 'connector.prepare', wire, signal), true)
      await verify()
      if (plan.outcome === 'conflict' || plan.state.revision !== input.expectedConfigurationRevision) throw changed()
      const reserved = await this.identity.connectorCommandTransaction(token, input, context, 'runtime.connector.requested', async (db, actor, key) => {
        signal.throwIfAborted(); const prior = await lookup(db, actor, key)
        if (prior) return { data: { row: prior, send: false }, targetId: input.targetUserId, reason: input.reason }
        const cell = await this.target(db, actor, input.targetUserId)
        if (!sameActor(initial.actor, actor) || !isDeepStrictEqual(initial.cell, cell)) throw changed()
        await this.requireNoPending(db, actor, input.targetUserId)
        const [capacity] = await db<{ count: number }[]>`select count(*)::int as count from haas.connector_commands where tenant_id=${actor.account.tenantId}`
        if (capacity!.count >= 10_000) throw new EnterpriseError(409, 'connector-command-capacity', '连接器操作记录已达容量上限，请联系部署人员')
        const [row] = await db<Command[]>`insert into haas.connector_commands
          (tenant_id,command_id,actor_user_id,login_session_id,idempotency_key,request_digest,target_user_id,intent,target_pin)
          values (${actor.account.tenantId},${randomUUID()},${actor.account.userId},${actor.sessionId},${key.key},${key.requestDigest},
            ${input.targetUserId},${db.json(intent as unknown as JSONValue)},${db.json(cell as unknown as JSONValue)}) returning *`
        return { data: { row: row!, send: true }, targetId: input.targetUserId, reason: input.reason }
      })
      if (!reserved.send) return summary(reserved.row)
      await verify()
      let result: ReturnType<ConnectorManagement['outcome']> | undefined
      try {
        result = this.outcome(await this.request(initial.cell, 'connector.configure', wire, signal), false)
        await verify()
        // Metadata cannot prove which secret was stored. Only an exact native
        // acknowledgement plus fresh matching state can confirm this command.
        if (!isDeepStrictEqual(result.state, await this.configuration(initial.cell, signal))) result = undefined
      } catch { result = undefined }
      await verify()
      if (!result) return this.read(token, reserved.row.command_id, context.requestId)
      const observed = result
      return this.identity.connectorTransaction(token, context.requestId, 'runtime.connector.confirmed', async (db, actor) => {
        const current = await this.target(db, actor, input.targetUserId); signal.throwIfAborted()
        if (!sameActor(initial.actor, actor) || !isDeepStrictEqual(initial.cell, current)) throw changed()
        const confirmation = { commandId: reserved.row.command_id, outcome: observed.outcome, configuration: observed.state, activation: 'not-authorized' }
        const [row] = await db<Command[]>`update haas.connector_commands set outcome=${observed.outcome},confirmation=${db.json(confirmation as unknown as JSONValue)},confirmed_at=clock_timestamp()
          where tenant_id=${actor.account.tenantId} and command_id=${reserved.row.command_id} and outcome='unconfirmed' returning *`
        if (!row) throw changed()
        return { data: summary(row), targetId: input.targetUserId, reason: JSON.stringify({ commandId: row.command_id, outcome: row.outcome, reason: input.reason }) }
      })
    })
  }
  async readActivation(token: string | undefined, id: string, requestId: string) {
    const commandId = uuid(id)
    return this.identity.connectorTransaction(token, requestId, 'runtime.connector.activation.receipt', async (db, actor) => {
      const [row] = await db<ActivationCommand[]>`select * from haas.connector_activation_commands where tenant_id=${actor.account.tenantId} and command_id=${commandId}`
      if (!row) throw missing()
      return {data:activationSummary(row),targetId:row.target_user_id,reason:JSON.stringify({commandId})}
    })
  }
  async activationCommandState(token: string | undefined, body: unknown, requestId: string) {
    const userId=uuid(record(body,['targetUserId']).targetUserId)
    return this.identity.connectorTransaction(token,requestId,'runtime.connector.activation.receipt',async(db,actor)=>{
      await this.approvalMember(db,actor,userId)
      const [row]=await db<ActivationCommand[]>`select * from haas.connector_activation_commands where tenant_id=${actor.account.tenantId} and target_user_id=${userId}
        order by (outcome='unconfirmed') desc,created_at desc,command_id desc limit 1`
      return {data:{targetUserId:userId,command:row?activationSummary(row):null},targetId:userId,reason:'读取连接器历史启停操作，不代表当前状态或使用许可'}
    })
  }
  private async activationTarget(db: TransactionSql, actor: RuntimeIdentity, input: ActivationInput) {
    const cell=await this.target(db,actor,input.targetUserId)
    if(cell.revision!==input.expectedCellRevision)throw changed()
    const approval=input.enabled?await this.approval(db,actor,input):undefined
    if(input.enabled&&(!approval||approval.decision!=='approved'||approval.revision!==input.expectedApprovalRevision
      ||approval.configuration_version!==input.configurationVersion||!approvalScope(approval,cell)))throw approvalChanged()
    return {cell,approval}
  }
  async createActivation(token: string | undefined, body: unknown, context: CommandContext, cancellation: AbortSignal) {
    const input=normalizeActivation(body),wire={entryId:input.entryId,configurationVersion:input.configurationVersion,
      expectedRevision:input.expectedConfigurationRevision,enabled:input.enabled,expectedApprovalRevision:input.expectedApprovalRevision}
    return this.lifetime(token,cancellation,async signal=>{
      const lookup=async(db:TransactionSql,actor:RuntimeIdentity,key:{key:string;requestDigest:string})=>{
        const [row]=await db<ActivationCommand[]>`select * from haas.connector_activation_commands
          where tenant_id=${actor.account.tenantId} and actor_user_id=${actor.account.userId} and idempotency_key=${key.key}`
        if(row&&row.request_digest!==key.requestDigest)throw new EnterpriseError(409,'idempotency-conflict','同一请求标识不能用于不同连接器启停操作')
        return row
      }
      const initial=await this.identity.connectorActivationCommandTransaction<{actor:RuntimeIdentity;cell:PrivateRuntimeCell;row:ActivationCommand|undefined;approval:Approval|undefined}>(token,input,context,'runtime.connector.command.authorized',async(db,actor,key)=>{
        signal.throwIfAborted();const row=await lookup(db,actor,key)
        if(row)return {data:{actor,cell:row.target_pin,row,approval:undefined},targetId:input.targetUserId,reason:input.reason,replayed:true}
        await this.requireNoPending(db,actor,input.targetUserId)
        const selected=await this.activationTarget(db,actor,input)
        return {data:{actor,...selected,row:undefined},targetId:input.targetUserId,reason:input.reason}
      })
      if(initial.row)return activationSummary(initial.row)
      const verify=()=>this.identity.resourceRead(token,context.requestId,true,async(db,actor)=>{
        const {cell}=await this.activationTarget(db,actor,input);signal.throwIfAborted()
        if(!sameActor(initial.actor,actor)||!isDeepStrictEqual(initial.cell,cell))throw changed()
      })
      await verify()
      const observed=await this.lifecycle(initial.cell,signal),entry=observed.entries.find(row=>row.entryId===input.entryId)
      if(observed.revision!==input.expectedConfigurationRevision||!entry||entry.configurationVersion!==input.configurationVersion
        ||initial.approval&&(entry.serverName!==initial.approval.server_name||entry.transport!==initial.approval.transport))throw changed()
      await verify()
      const reserved=await this.identity.connectorActivationCommandTransaction(token,input,context,'runtime.connector.activation.requested',async(db,actor,key)=>{
        signal.throwIfAborted();const prior=await lookup(db,actor,key)
        if(prior)return {data:{row:prior,send:false},targetId:input.targetUserId,reason:input.reason,replayed:true}
        await this.requireNoPending(db,actor,input.targetUserId)
        const {cell}=await this.activationTarget(db,actor,input)
        if(!sameActor(initial.actor,actor)||!isDeepStrictEqual(initial.cell,cell))throw changed()
        const [capacity]=await db<{count:number}[]>`select count(*)::int as count from haas.connector_activation_commands where tenant_id=${actor.account.tenantId}`
        if(capacity!.count>=10_000)throw new EnterpriseError(409,'connector-command-capacity','连接器启停记录已达容量上限，请联系部署人员')
        const [row]=await db<ActivationCommand[]>`insert into haas.connector_activation_commands
          (tenant_id,command_id,actor_user_id,login_session_id,idempotency_key,request_digest,target_user_id,intent,target_pin)
          values(${actor.account.tenantId},${randomUUID()},${actor.account.userId},${actor.sessionId},${key.key},${key.requestDigest},${input.targetUserId},
            ${db.json(input as unknown as JSONValue)},${db.json(cell as unknown as JSONValue)}) returning *`
        return {data:{row:row!,send:true},targetId:input.targetUserId,reason:input.reason}
      })
      if(!reserved.send)return activationSummary(reserved.row)
      // Reservation is not a grant. The native controller independently checks
      // this exact approval revision before/after persistence and every use.
      // An unknown activation can have taken effect; do not stop its legitimate
      // authority via its own pending receipt or infer a successful rollback.
      let result:{outcome:'enabled'|'disabled'|'conflict';state:Awaited<ReturnType<ConnectorManagement['lifecycle']>>}|undefined
      try{
        await verify()
        const raw=record(await this.request(initial.cell,'connector.activate',wire,signal),['outcome','state'])
        if(!['activated','disabled','conflict'].includes(String(raw.outcome))||raw.outcome!=='conflict'&&raw.outcome!==(input.enabled?'activated':'disabled'))throw unavailable()
        validateConnectorActivationState(raw.state)
        const selected=raw.state.entries.find(row=>row.entryId===input.entryId)
        if(raw.outcome!=='conflict'&&(!selected||selected.configurationVersion!==input.configurationVersion||selected.enabled!==input.enabled
          ||input.enabled&&(selected.authority!=='live'||selected.phase!=='active')||!input.enabled&&selected.authority!=='absent'))throw unavailable()
        await verify()
        if(!isDeepStrictEqual(raw.state,await this.lifecycle(initial.cell,signal)))throw unavailable()
        result={outcome:raw.outcome==='activated'?'enabled':raw.outcome as 'disabled'|'conflict',state:raw.state}
      }catch{result=undefined}
      if(!result)return this.readActivation(token,reserved.row.command_id,context.requestId)
      const confirmed=result
      return this.identity.connectorTransaction(token,context.requestId,'runtime.connector.activation.confirmed',async(db,actor)=>{
        const {cell}=await this.activationTarget(db,actor,input);signal.throwIfAborted()
        if(!sameActor(initial.actor,actor)||!isDeepStrictEqual(initial.cell,cell))throw changed()
        const confirmation={commandId:reserved.row.command_id,outcome:confirmed.outcome,lifecycle:confirmed.state,observation:'native-lifecycle-only'}
        const [row]=await db<ActivationCommand[]>`update haas.connector_activation_commands set outcome=${confirmed.outcome},confirmation=${db.json(confirmation as unknown as JSONValue)},confirmed_at=clock_timestamp()
          where tenant_id=${actor.account.tenantId} and command_id=${reserved.row.command_id} and outcome='unconfirmed' returning *`
        if(!row)throw changed()
        return {data:activationSummary(row),targetId:input.targetUserId,reason:JSON.stringify({commandId:row.command_id,outcome:row.outcome,entryId:input.entryId,reason:input.reason})}
      })
    })
  }
  async resolveActivation(token: string | undefined, id: string, body: unknown, requestId: string, cancellation: AbortSignal) {
    const commandId=uuid(id),input=record(body,['expectedCellRevision','reason','confirmed'])
    if(input.confirmed!==true)return invalid('请确认历史启停效果仍未知，旧操作不会重发')
    const expectedCellRevision=uuid(input.expectedCellRevision),reason=text(input.reason,3,500)
    return this.lifetime(token,cancellation,async signal=>{
      const initial=await this.identity.connectorTransaction(token,requestId,'runtime.connector.command.authorized',async(db,actor)=>{
        const [row]=await db<ActivationCommand[]>`select * from haas.connector_activation_commands where tenant_id=${actor.account.tenantId} and command_id=${commandId}`
        if(!row)throw missing()
        const cell=await this.target(db,actor,row.target_user_id),old=row.target_pin
        if(row.outcome!=='unconfirmed'||cell.revision!==expectedCellRevision||old.containerId===cell.containerId||old.revision===cell.revision
          ||!(['cellId','tenantId','userId','role','volumeName','imageId','policyDigest'] as const).every(key=>old[key]===cell[key]))throw changed()
        return {data:{row,actor,cell},targetId:row.target_user_id,reason}
      })
      await this.verify(token,requestId,initial.actor,initial.cell,signal)
      const lifecycle=await this.lifecycle(initial.cell,signal)
      return this.identity.connectorTransaction(token,requestId,'runtime.connector.activation.resolved',async(db,actor)=>{
        const cell=await this.target(db,actor,initial.row.target_user_id);signal.throwIfAborted()
        if(!sameActor(initial.actor,actor)||!isDeepStrictEqual(initial.cell,cell))throw changed()
        const confirmation={commandId,outcome:'superseded',effect:'unknown',cellRevision:cell.revision,lifecycle,reason}
        const [row]=await db<ActivationCommand[]>`update haas.connector_activation_commands set outcome='superseded',confirmation=${db.json(confirmation as unknown as JSONValue)},confirmed_at=clock_timestamp()
          where tenant_id=${actor.account.tenantId} and command_id=${commandId} and outcome='unconfirmed' returning *`
        if(!row)throw changed()
        return {data:activationSummary(row),targetId:row.target_user_id,reason:JSON.stringify({commandId,effect:'unknown',reason})}
      })
    })
  }
  async resolve(token: string | undefined, id: string, body: unknown, requestId: string, cancellation: AbortSignal) {
    const commandId = uuid(id), input = record(body, ['expectedCellRevision', 'reason', 'confirmed'])
    if (input.confirmed !== true) return invalid('请确认历史效果仍不确定，旧操作不会重发')
    const expectedCellRevision = uuid(input.expectedCellRevision), reason = text(input.reason, 3, 500)
    return this.lifetime(token, cancellation, async signal => {
      const initial = await this.identity.connectorTransaction(token, requestId, 'runtime.connector.command.authorized', async (db, actor) => {
        const [row] = await db<Command[]>`select * from haas.connector_commands where tenant_id=${actor.account.tenantId} and command_id=${commandId}`
        if (!row) throw missing()
        const cell = await this.target(db, actor, row.target_user_id), old = row.target_pin
        if (row.outcome !== 'unconfirmed' || cell.revision !== expectedCellRevision || old.containerId === cell.containerId || old.revision === cell.revision
          || !(['cellId','tenantId','userId','role','volumeName','imageId','policyDigest'] as const).every(key => old[key] === cell[key])) throw changed()
        return { data: { row, actor, cell }, targetId: row.target_user_id, reason }
      })
      await this.verify(token, requestId, initial.actor, initial.cell, signal)
      const configuration = await this.configuration(initial.cell, signal)
      return this.identity.connectorTransaction(token, requestId, 'runtime.connector.resolved', async (db, actor) => {
        const cell = await this.target(db, actor, initial.row.target_user_id); signal.throwIfAborted()
        if (!sameActor(initial.actor, actor) || !isDeepStrictEqual(initial.cell, cell)) throw changed()
        const confirmation = { commandId, outcome: 'superseded', effect: 'unknown', cellRevision: cell.revision, configuration, reason }
        const [row] = await db<Command[]>`update haas.connector_commands set outcome='superseded',confirmation=${db.json(confirmation as unknown as JSONValue)},confirmed_at=clock_timestamp()
          where tenant_id=${actor.account.tenantId} and command_id=${commandId} and outcome='unconfirmed' returning *`
        if (!row) throw changed()
        return { data: summary(row), targetId: row.target_user_id, reason: JSON.stringify({ commandId, effect: 'unknown', reason }) }
      })
    })
  }
}
