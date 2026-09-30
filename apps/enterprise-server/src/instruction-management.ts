import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { JSONValue, TransactionSql } from 'postgres'
import { createHarnessInstructionRead, decodeHarnessInstructionConfiguration, normalizeHarnessInstructions,
  prepareHarnessInstructionChange, type HarnessInstructionConfiguration, type HarnessInstructionValue } from '@paimind/harness-compat/gateway-transport'
import { EnterpriseError, invalid, record, text, uuid } from './errors.js'
import type { Account, CommandContext, Identity, RuntimeIdentity } from './identity.js'
import type { RuntimeBindings, PrivateRuntimeCell } from './runtime-bindings.js'
import type { CellTransport } from './cell-transport.js'
import { retainCellTransports } from './cell-transport-directory.js'
import { requestNativeConfiguration } from './model-transport.js'

interface Input { targetUserId: string; expectedCellRevision: string; expectedSettingsRevision: number; change: HarnessInstructionValue; reason: string; confirmed: true }
type Intent = Omit<Input, 'change'> & { change: { enabled: boolean; instructionLength: number } }
interface Command { command_id: string; request_digest: string; target_user_id: string; intent: Intent; target_pin: PrivateRuntimeCell;
  outcome: 'unconfirmed' | 'applied' | 'conflict' | 'superseded'; confirmation: object | null }
const changed = () => new EnterpriseError(409, 'instruction-context-changed', '管理员、成员或原生配置修订已变化，请重新读取并确认')
const pending = () => new EnterpriseError(409, 'instruction-command-pending', '该成员有结果不确定的指令操作，请先查看操作记录，不要换键重复提交')
const notFound = () => new EnterpriseError(404, 'instruction-command-not-found', '成员或指令操作不存在或不可访问')
const unavailable = () => new EnterpriseError(502, 'instruction-state-unavailable', '原生指令状态无法确认，请查看操作记录，不要重复提交', true)
const sameActor = (a: RuntimeIdentity, b: RuntimeIdentity) => a.sessionId === b.sessionId && isDeepStrictEqual(a.account, b.account)
const summary = (row: Command) => ({ commandId: row.command_id, targetUserId: row.target_user_id, outcome: row.outcome,
  intent: row.intent, confirmation: row.confirmation, historicalReceipt: true as const, runtimeGrant: false as const })
const observed = (state: HarnessInstructionConfiguration) => ({ enabled: state.enabled, instructionLength: state.instructions.length,
  revision: state.revision, writable: state.writable, applies: state.applies })
function normalize(value: unknown): Input {
  const row = record(value, ['targetUserId', 'expectedCellRevision', 'expectedSettingsRevision', 'change', 'reason', 'confirmed'])
  if (row.confirmed !== true || !Number.isSafeInteger(row.expectedSettingsRevision) || Number(row.expectedSettingsRevision) < 0
    || Number(row.expectedSettingsRevision) >= Number.MAX_SAFE_INTEGER) return invalid('请确认准确的指令设置修订')
  let change: HarnessInstructionValue
  try { change = normalizeHarnessInstructions(row.change) } catch { return invalid('指令须为不超过8000字符的文本，且只能修改指令及其启停') }
  return { targetUserId: uuid(row.targetUserId), expectedCellRevision: uuid(row.expectedCellRevision),
    expectedSettingsRevision: Number(row.expectedSettingsRevision), change, reason: text(row.reason, 3, 500), confirmed: true }
}
/** Existing identity/audit transactions reserve a single durable sender. The
 * journal stores metadata, not instructions; native Settings remains owner. */
export class InstructionManagement {
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
    if (this.closed || this.active.size >= 8 || (this.pending.get(key) ?? 0) >= 2) throw new EnterpriseError(503, 'instruction-management-busy', '指令管理暂不可用或已达并发上限', true)
    const controller = new AbortController(); this.active.add(controller); this.pending.set(key, (this.pending.get(key) ?? 0) + 1)
    try { return await run(AbortSignal.any([controller.signal, cancellation, AbortSignal.timeout(15_000)])) }
    finally { this.active.delete(controller); const n = this.pending.get(key)! - 1; if (n) this.pending.set(key, n); else this.pending.delete(key) }
  }
  private async target(db: TransactionSql, actor: RuntimeIdentity, id: string): Promise<PrivateRuntimeCell> {
    if (this.closed) throw new EnterpriseError(503, 'instruction-management-closed', '指令管理已关闭', true)
    const [row] = await db<{ user_id: string; tenant_id: string; username: string; display_name: string; role: Account['role']; status: Account['status'] }[]>`
      select user_id,tenant_id,username,display_name,role,status from haas.users
      where tenant_id=${actor.account.tenantId} and user_id=${id} and status='active' and role='member'`
    if (!row) throw notFound()
    return this.bindings.selectManagedAccount(db, { userId: row.user_id, tenantId: row.tenant_id, username: row.username,
      displayName: row.display_name, role: row.role, status: row.status })
  }
  private async verify(db: TransactionSql, current: RuntimeIdentity, actor: RuntimeIdentity, cell: PrivateRuntimeCell, signal: AbortSignal) {
    const target = await this.target(db, current, cell.userId); signal.throwIfAborted()
    if (!sameActor(actor, current) || !isDeepStrictEqual(cell, target)) throw changed()
  }
  private async configuration(cell: PrivateRuntimeCell, signal: AbortSignal) {
    const rpcId = randomUUID()
    try { return decodeHarnessInstructionConfiguration(await requestNativeConfiguration(this.transports, cell,
      createHarnessInstructionRead(rpcId), signal, unavailable), rpcId) } catch { throw unavailable() }
  }
  async inspect(token: string | undefined, body: unknown, requestId: string, cancellation: AbortSignal) {
    const input = record(body, ['targetUserId', 'reason', 'confirmed'])
    if (input.confirmed !== true) return invalid('请确认成员指令读取与审计')
    const targetUserId = uuid(input.targetUserId), reason = text(input.reason, 3, 500)
    return this.lifetime(token, cancellation, async signal => {
      const initial = await this.identity.instructionTransaction(token, requestId, 'runtime.instructions.authorized', async (db, actor) => {
        signal.throwIfAborted(); return { data: { actor, cell: await this.target(db, actor, targetUserId) }, targetId: targetUserId, reason }
      })
      const configuration = await this.configuration(initial.cell, signal)
      return this.identity.instructionTransaction(token, requestId, 'runtime.instructions.read', async (db, actor) => {
        await this.verify(db, actor, initial.actor, initial.cell, signal)
        return { data: { targetUserId, cellRevision: initial.cell.revision, configuration, audit: { requestId, reason } }, targetId: targetUserId, reason }
      })
    })
  }
  private async command(db: TransactionSql, actor: RuntimeIdentity, commandId: string) {
    const [row] = await db<Command[]>`select * from haas.instruction_commands where tenant_id=${actor.account.tenantId} and command_id=${commandId}`
    if (!row) throw notFound(); return row
  }
  read(token: string | undefined, id: string, requestId: string) {
    const commandId = uuid(id)
    return this.identity.instructionTransaction(token, requestId, 'runtime.instructions.receipt', async (db, actor) => {
      const row = await this.command(db, actor, commandId)
      return { data: summary(row), targetId: row.target_user_id, reason: JSON.stringify({ commandId }) }
    })
  }
  state(token: string | undefined, body: unknown, requestId: string) {
    const targetUserId = uuid(record(body, ['targetUserId']).targetUserId)
    return this.identity.instructionTransaction(token, requestId, 'runtime.instructions.receipt', async (db, actor) => {
      if (!(await db`select 1 from haas.users where tenant_id=${actor.account.tenantId} and user_id=${targetUserId} and role='member'`).length) throw notFound()
      const [row] = await db<Command[]>`select * from haas.instruction_commands where tenant_id=${actor.account.tenantId} and target_user_id=${targetUserId}
        order by (outcome='unconfirmed') desc, created_at desc, command_id desc limit 1`
      return { data: { targetUserId, command: row ? summary(row) : null }, targetId: targetUserId, reason: '读取最近指令操作，不读取原生指令正文' }
    })
  }
  async create(token: string | undefined, body: unknown, context: CommandContext, cancellation: AbortSignal) {
    const input = normalize(body), intent: Intent = { ...input, change: { enabled: input.change.enabled, instructionLength: input.change.instructions.length } }
    return this.lifetime(token, cancellation, async signal => {
      const lookup = async (db: TransactionSql, actor: RuntimeIdentity, key: { key: string; requestDigest: string }) => {
        const [row] = await db<Command[]>`select * from haas.instruction_commands where tenant_id=${actor.account.tenantId}
          and actor_user_id=${actor.account.userId} and idempotency_key=${key.key}`
        if (row && row.request_digest !== key.requestDigest) throw new EnterpriseError(409, 'idempotency-conflict', '同一请求标识不能用于不同指令配置')
        return row
      }
      const initial = await this.identity.instructionCommandTransaction<{ actor: RuntimeIdentity; cell: PrivateRuntimeCell; row: Command | undefined }>(token, input, context, 'runtime.instructions.authorized', async (db, actor, key) => {
        signal.throwIfAborted(); const row = await lookup(db, actor, key)
        if (row) return { data: { actor, cell: row.target_pin, row }, targetId: input.targetUserId, reason: input.reason }
        const cell = await this.target(db, actor, input.targetUserId)
        if (cell.revision !== input.expectedCellRevision) throw changed()
        if ((await db`select 1 from haas.instruction_commands where tenant_id=${actor.account.tenantId} and target_user_id=${input.targetUserId} and outcome='unconfirmed'`).length) throw pending()
        return { data: { actor, cell, row: undefined }, targetId: input.targetUserId, reason: input.reason }
      })
      if (initial.row) return summary(initial.row)
      const verify = () => this.identity.resourceRead(token, context.requestId, true, (db, actor) => this.verify(db, actor, initial.actor, initial.cell, signal))
      const before = await this.configuration(initial.cell, signal); await verify()
      if (before.revision !== input.expectedSettingsRevision || !before.writable) throw changed()
      const wire = prepareHarnessInstructionChange(before, input.change, randomUUID())
      const reserved = await this.identity.instructionCommandTransaction(token, input, context, 'runtime.instructions.requested', async (db, actor, key) => {
        signal.throwIfAborted(); const prior = await lookup(db, actor, key)
        if (prior) return { data: { row: prior, send: false }, targetId: input.targetUserId, reason: input.reason }
        await this.verify(db, actor, initial.actor, initial.cell, signal)
        if ((await db`select 1 from haas.instruction_commands where tenant_id=${actor.account.tenantId} and target_user_id=${input.targetUserId} and outcome='unconfirmed'`).length) throw pending()
        const [capacity] = await db<{ count: number }[]>`select count(*)::int as count from haas.instruction_commands where tenant_id=${actor.account.tenantId}`
        if (capacity!.count >= 10_000) throw new EnterpriseError(409, 'instruction-command-capacity', '指令操作记录已达容量上限，请联系部署人员')
        const [row] = await db<Command[]>`insert into haas.instruction_commands
          (tenant_id,command_id,actor_user_id,login_session_id,idempotency_key,request_digest,target_user_id,intent,target_pin)
          values (${actor.account.tenantId},${randomUUID()},${actor.account.userId},${actor.sessionId},${key.key},${key.requestDigest},
            ${input.targetUserId},${db.json(intent as unknown as JSONValue)},${db.json(initial.cell as unknown as JSONValue)}) returning *`
        return { data: { row: row!, send: true }, targetId: input.targetUserId, reason: input.reason }
      })
      if (!reserved.send) return summary(reserved.row)
      await verify()
      let outcome: ReturnType<typeof wire.decode> = { status: 'unconfirmed' }, observation: ReturnType<typeof observed> | undefined
      try {
        outcome = wire.decode(await requestNativeConfiguration(this.transports, initial.cell, wire, signal, unavailable))
        if (outcome.status === 'applied') {
          await verify(); const after = await this.configuration(initial.cell, signal); await verify()
          if (!isDeepStrictEqual(outcome.value, after)) outcome = { status: 'unconfirmed' }
          else observation = observed(after)
        }
      } catch { outcome = { status: 'unconfirmed' } }
      await verify()
      if (outcome.status === 'unconfirmed') return this.read(token, reserved.row.command_id, context.requestId)
      const status = outcome.status
      return this.identity.instructionTransaction(token, context.requestId, 'runtime.instructions.confirmed', async (db, actor) => {
        await this.verify(db, actor, initial.actor, initial.cell, signal)
        const confirmation = { commandId: reserved.row.command_id, outcome: status, ...(observation ? { observation } : {}) }
        const [row] = await db<Command[]>`update haas.instruction_commands set outcome=${status},confirmation=${db.json(confirmation as JSONValue)},confirmed_at=clock_timestamp()
          where tenant_id=${actor.account.tenantId} and command_id=${reserved.row.command_id} and outcome='unconfirmed' returning *`
        if (!row) throw changed()
        return { data: summary(row), targetId: input.targetUserId, reason: JSON.stringify({ commandId: row.command_id, outcome: status, reason: input.reason }) }
      })
    })
  }
  async resolve(token: string | undefined, id: string, body: unknown, requestId: string, cancellation: AbortSignal) {
    const commandId = uuid(id), input = record(body, ['expectedCellRevision', 'reason', 'confirmed'])
    if (input.confirmed !== true) return invalid('请确认历史效果仍不确定，旧指令不会重发')
    const expectedCellRevision = uuid(input.expectedCellRevision), reason = text(input.reason, 3, 500)
    return this.lifetime(token, cancellation, async signal => {
      const initial = await this.identity.instructionTransaction(token, requestId, 'runtime.instructions.authorized', async (db, actor) => {
        const row = await this.command(db, actor, commandId), cell = await this.target(db, actor, row.target_user_id), previous = row.target_pin
        if (row.outcome !== 'unconfirmed' || cell.revision !== expectedCellRevision || previous.containerId === cell.containerId || previous.revision === cell.revision
          || !(['cellId','tenantId','userId','role','volumeName','imageId','policyDigest'] as const).every(key => previous[key] === cell[key])) throw changed()
        signal.throwIfAborted(); return { data: { row, actor, cell }, targetId: row.target_user_id, reason }
      })
      const state = await this.configuration(initial.cell, signal)
      return this.identity.instructionTransaction(token, requestId, 'runtime.instructions.resolved', async (db, actor) => {
        await this.verify(db, actor, initial.actor, initial.cell, signal)
        const confirmation = { commandId, outcome: 'superseded', effect: 'unknown', cellRevision: initial.cell.revision, observation: observed(state), reason }
        const [row] = await db<Command[]>`update haas.instruction_commands set outcome='superseded',confirmation=${db.json(confirmation)},confirmed_at=clock_timestamp()
          where tenant_id=${actor.account.tenantId} and command_id=${commandId} and outcome='unconfirmed' returning *`
        if (!row) throw changed()
        return { data: summary(row), targetId: row.target_user_id, reason: JSON.stringify({ commandId, effect: 'unknown', reason }) }
      })
    })
  }
}
