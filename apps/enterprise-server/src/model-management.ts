import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { JSONValue, TransactionSql } from 'postgres'
import { createHarnessModelRead, decodeHarnessModelRead, decodeHarnessModelConfiguration, decodeHarnessModelCredentialState,
  prepareHarnessModelSelectionChange, prepareHarnessModelCredentialChange,
  type HarnessModelChange, type HarnessModelChangeOutcome, type HarnessModelConfiguration, type HarnessModelSelection } from '@paimind/harness-compat/gateway-transport'
import { EnterpriseError, invalid, record, text, uuid } from './errors.js'
import type { Account, CommandContext, Identity, RuntimeIdentity } from './identity.js'
import type { RuntimeBindings, PrivateRuntimeCell } from './runtime-bindings.js'
import type { CellTransport } from './cell-transport.js'
import { retainCellTransports } from './cell-transport-directory.js'
import { requestNativeModel } from './model-transport.js'

type Change = { kind: 'selection'; selection: HarnessModelSelection }
  | { kind: 'credential'; action: 'set'; value: string } | { kind: 'credential'; action: 'unset' }
interface Input { targetUserId: string; expectedCellRevision: string; expectedSettingsRevision: number; change: Change; reason: string; confirmed: true }
type Intent = Omit<Input, 'change'> & { change: Exclude<Change, { action: 'set' }> | { kind: 'credential'; action: 'set' } }
interface Command { command_id: string; actor_user_id: string; request_digest: string; target_user_id: string; intent: Intent;
  target_pin: PrivateRuntimeCell; outcome: 'unconfirmed' | 'applied' | 'conflict' | 'superseded'; confirmation: object | null }
const changed = () => new EnterpriseError(409, 'model-context-changed', '管理员、成员或原生配置修订已变化，请重新读取并确认')
const pending = () => new EnterpriseError(409, 'model-command-pending', '该成员有结果不确定的模型操作；请查看操作记录，不要换键重复提交')
const notFound = () => new EnterpriseError(404, 'model-command-not-found', '模型操作不存在或不可访问')
const sameActor = (a: RuntimeIdentity, b: RuntimeIdentity) => a.sessionId === b.sessionId && isDeepStrictEqual(a.account, b.account)
function normalize(input: unknown): Input {
  const row = record(input, ['targetUserId', 'expectedCellRevision', 'expectedSettingsRevision', 'change', 'reason', 'confirmed'])
  if (row.confirmed !== true || !Number.isSafeInteger(row.expectedSettingsRevision) || Number(row.expectedSettingsRevision) < 0
    || Number(row.expectedSettingsRevision) >= Number.MAX_SAFE_INTEGER) return invalid('请确认准确的模型设置修订')
  const raw = row.change as Partial<Change> | null
  let change: Change
  if (raw?.kind === 'selection') {
    const value = record(raw, ['kind', 'selection']).selection as HarnessModelSelection | undefined
    const selection = record(value, ['provider', 'model', ...(value?.reasoningEffort === undefined ? [] : ['reasoningEffort'])])
    change = { kind: 'selection', selection: { provider: text(selection.provider, 1, 200), model: text(selection.model, 1, 200),
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: text(selection.reasoningEffort, 1, 200) }) } }
  } else if (raw?.kind === 'credential' && raw.action === 'set') {
    const credential = record(raw, ['kind', 'action', 'value']).value
    if (typeof credential !== 'string' || !credential.length || credential.length > 8192 || /[\u0000\r\n]/u.test(credential)) return invalid('凭证内容无效')
    change = { kind: 'credential', action: 'set', value: credential }
  } else { record(raw, ['kind', 'action']); if (raw?.kind !== 'credential' || raw.action !== 'unset') return invalid(); change = { kind: 'credential', action: 'unset' } }
  return { targetUserId: uuid(row.targetUserId), expectedCellRevision: uuid(row.expectedCellRevision),
    expectedSettingsRevision: Number(row.expectedSettingsRevision), change, reason: text(row.reason, 3, 500), confirmed: true }
}
function redact(input: Input): Intent {
  return { ...input, change: input.change.kind === 'selection' ? input.change : { kind: 'credential', action: input.change.action } }
}
function summary(row: Command) {
  return { commandId: row.command_id, targetUserId: row.target_user_id, outcome: row.outcome, intent: row.intent,
    confirmation: row.confirmation, historicalReceipt: true as const, runtimeGrant: false as const }
}
function replacement(original: PrivateRuntimeCell, current: PrivateRuntimeCell): boolean {
  return (['cellId', 'tenantId', 'userId', 'role', 'volumeName', 'imageId', 'policyDigest'] as const).every(key => original[key] === current[key])
    && original.containerId !== current.containerId && original.revision !== current.revision
}
const observed = (state: HarnessModelConfiguration) => ({ selection: state.selection, revision: state.revision, applies: state.applies, writable: state.writable })

/** Admin governance only. Each durably reserved operation has one sender; no
 * restart, replay, timeout or credential-presence observation can resend it. */
export class ModelManagement {
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
    if (this.closed || this.active.size >= 8 || (this.pending.get(key) ?? 0) >= 2) throw new EnterpriseError(503, 'model-management-busy', '模型管理暂不可用或已达并发上限', true)
    const controller = new AbortController(); this.active.add(controller); this.pending.set(key, (this.pending.get(key) ?? 0) + 1)
    try { return await run(AbortSignal.any([controller.signal, cancellation, AbortSignal.timeout(15_000)])) }
    finally { this.active.delete(controller); const count = this.pending.get(key)! - 1; if (count) this.pending.set(key, count); else this.pending.delete(key) }
  }
  private async target(db: TransactionSql, actor: RuntimeIdentity, userId: string): Promise<PrivateRuntimeCell> {
    if (this.closed) throw new EnterpriseError(503, 'model-management-closed', '模型管理已关闭', true)
    const [row] = await db<{ user_id: string; tenant_id: string; username: string; display_name: string; role: Account['role']; status: Account['status'] }[]>`
      select user_id,tenant_id,username,display_name,role,status from haas.users
      where tenant_id=${actor.account.tenantId} and user_id=${userId} and status='active' and role='member'`
    if (!row) throw notFound()
    return this.bindings.selectManagedAccount(db, { userId: row.user_id, tenantId: row.tenant_id, username: row.username,
      displayName: row.display_name, role: row.role, status: row.status })
  }
  private async command(db: TransactionSql, actor: RuntimeIdentity, commandId: string): Promise<Command> {
    const [row] = await db<Command[]>`select * from haas.model_commands where tenant_id=${actor.account.tenantId} and command_id=${commandId}`
    if (!row) throw notFound()
    return row
  }
  private async verify(token: string | undefined, requestId: string, actor: RuntimeIdentity, cell: PrivateRuntimeCell, signal: AbortSignal) {
    await this.identity.resourceRead(token, requestId, true, async (db, current) => {
      const target = await this.target(db, current, cell.userId); signal.throwIfAborted()
      if (!sameActor(actor, current) || !isDeepStrictEqual(cell, target)) throw changed()
    })
  }
  private async settings(cell: PrivateRuntimeCell, signal: AbortSignal) {
    const rpcId = randomUUID()
    return decodeHarnessModelConfiguration(await requestNativeModel(this.transports, cell, createHarnessModelRead('settings', rpcId), signal), rpcId)
  }
  async read(token: string | undefined, id: string, requestId: string) {
    const commandId = uuid(id)
    // Historical redacted receipts remain readable to current admins even if a
    // target is offline/disabled; they are not a native access permission.
    return this.identity.modelTransaction(token, requestId, 'runtime.model.receipt', async (db, actor) => {
      const row = await this.command(db, actor, commandId)
      return { data: summary(row), targetId: row.target_user_id, reason: JSON.stringify({ commandId }) }
    })
  }
  async state(token: string | undefined, body: unknown, requestId: string) {
    const targetUserId = uuid(record(body, ['targetUserId']).targetUserId)
    // A browser may lose the entire response (including commandId). Recover
    // the pending receipt without re-entering, retaining or resending a secret.
    return this.identity.modelTransaction(token, requestId, 'runtime.model.receipt', async (db, actor) => {
      const member = await db`select 1 from haas.users where tenant_id=${actor.account.tenantId} and user_id=${targetUserId} and role='member'`
      if (!member.length) throw notFound()
      const [row] = await db<Command[]>`select * from haas.model_commands where tenant_id=${actor.account.tenantId} and target_user_id=${targetUserId}
        order by (outcome='unconfirmed') desc, created_at desc, command_id desc limit 1`
      return { data: { targetUserId, command: row ? summary(row) : null }, targetId: targetUserId, reason: '读取最近模型操作；不访问原生配置或凭证' }
    })
  }
  async create(token: string | undefined, body: unknown, context: CommandContext, cancellation: AbortSignal) {
    const input = normalize(body), intent = redact(input)
    return this.lifetime(token, cancellation, async signal => {
      const lookup = async (db: TransactionSql, actor: RuntimeIdentity, key: { key: string; requestDigest: string }) => {
        const [row] = await db<Command[]>`select * from haas.model_commands
          where tenant_id=${actor.account.tenantId} and actor_user_id=${actor.account.userId} and idempotency_key=${key.key}`
        if (row && row.request_digest !== key.requestDigest) throw new EnterpriseError(409, 'idempotency-conflict', '同一请求标识不能用于不同模型配置')
        return row
      }
      const initial = await this.identity.modelCommandTransaction<{ actor: RuntimeIdentity; cell: PrivateRuntimeCell; row: Command | undefined }>(token, input, context, 'runtime.model.command.authorized', async (db, actor, key) => {
        signal.throwIfAborted()
        const row = await lookup(db, actor, key)
        // Replays perform no native I/O, even when their old cell is unavailable.
        if (row) return { data: { actor, cell: row.target_pin, row }, targetId: input.targetUserId, reason: input.reason }
        const cell = await this.target(db, actor, input.targetUserId)
        if (cell.revision !== input.expectedCellRevision) throw changed()
        const waiting = await db`select 1 from haas.model_commands where tenant_id=${actor.account.tenantId} and target_user_id=${input.targetUserId} and outcome='unconfirmed'`
        if (waiting.length) throw pending()
        return { data: { actor, cell, row: undefined }, targetId: input.targetUserId, reason: input.reason }
      })
      if (initial.row) return summary(initial.row)
      const verify = () => this.verify(token, context.requestId, initial.actor, initial.cell, signal)
      const read = async <T>(run: () => Promise<T>) => { await verify(); const value = await run(); await verify(); return value }
      const before = await read(() => this.settings(initial.cell, signal))
      if (before.revision !== input.expectedSettingsRevision) throw changed()
      let wire: HarnessModelChange<object>
      if (input.change.kind === 'selection') {
        const fetch = async <K extends 'providers' | 'catalog'>(kind: K) => {
          const rpcId = randomUUID(), value = await requestNativeModel(this.transports, initial.cell, createHarnessModelRead(kind, rpcId), signal)
          return decodeHarnessModelRead(value, rpcId, kind)
        }
        const providers = await read(() => fetch('providers')), catalog = await read(() => fetch('catalog'))
        try { wire = prepareHarnessModelSelectionChange(before, providers, catalog, input.change.selection, randomUUID()) }
        catch { throw new EnterpriseError(409, 'model-selection-unavailable', '模型不在当前可用目录内，或原生设置不可写') }
      } else {
        if (!before.credentialRef) throw new EnterpriseError(409, 'model-credential-unavailable', '当前模型不使用可管理的命名凭证')
        const ref = before.credentialRef, rpcId = randomUUID()
        const credential = await read(async () => decodeHarnessModelCredentialState(await requestNativeModel(this.transports, initial.cell,
          createHarnessModelRead('credentials', rpcId, [ref]), signal), rpcId, ref))
        try { wire = prepareHarnessModelCredentialChange(before, credential,
          input.change.action === 'set' ? { action: 'set', value: input.change.value } : { action: 'unset' }, randomUUID()) }
        catch { throw new EnterpriseError(409, 'model-credential-unavailable', '当前模型凭证不可写') }
      }
      if (!isDeepStrictEqual(before, await read(() => this.settings(initial.cell, signal)))) throw changed()
      const reserved = await this.identity.modelCommandTransaction(token, input, context, 'runtime.model.requested', async (db, actor, key) => {
        signal.throwIfAborted()
        const prior = await lookup(db, actor, key)
        if (prior) return { data: { row: prior, send: false }, targetId: input.targetUserId, reason: input.reason }
        const cell = await this.target(db, actor, input.targetUserId)
        if (!sameActor(initial.actor, actor) || !isDeepStrictEqual(initial.cell, cell)) throw changed()
        if ((await db`select 1 from haas.model_commands where tenant_id=${actor.account.tenantId} and target_user_id=${input.targetUserId} and outcome='unconfirmed'`).length) throw pending()
        const [capacity] = await db<{ count: number }[]>`select count(*)::int as count from haas.model_commands where tenant_id=${actor.account.tenantId}`
        if (capacity!.count >= 10_000) throw new EnterpriseError(409, 'model-command-capacity', '模型操作记录已达容量上限，请联系部署人员')
        const [row] = await db<Command[]>`insert into haas.model_commands
          (tenant_id,command_id,actor_user_id,login_session_id,idempotency_key,request_digest,target_user_id,intent,target_pin)
          values (${actor.account.tenantId},${randomUUID()},${actor.account.userId},${actor.sessionId},${key.key},${key.requestDigest},
            ${input.targetUserId},${db.json(intent as unknown as JSONValue)},${db.json(cell as unknown as JSONValue)}) returning *`
        return { data: { row: row!, send: true }, targetId: input.targetUserId, reason: input.reason }
      })
      if (!reserved.send) return summary(reserved.row)
      await verify()
      let outcome: HarnessModelChangeOutcome<object> = { status: 'unconfirmed' }, observation: object | undefined
      try {
        outcome = wire.decode(await requestNativeModel(this.transports, initial.cell, wire, signal))
        if (outcome.status === 'applied') {
          const after = await read(() => this.settings(initial.cell, signal))
          if (input.change.kind === 'selection') {
            const value = outcome.value as HarnessModelSelection & { revision: number; applies: string }
            const { revision, applies, ...selection } = value
            if (after.revision !== revision || after.applies !== applies || !isDeepStrictEqual(after.selection, selection)) outcome = { status: 'unconfirmed' }
          } else {
            if (!isDeepStrictEqual(before, after)) outcome = { status: 'unconfirmed' }
            else {
              const ref = before.credentialRef!, rpcId = randomUUID()
              const credential = await read(async () => decodeHarnessModelCredentialState(await requestNativeModel(this.transports, initial.cell,
                createHarnessModelRead('credentials', rpcId, [ref]), signal), rpcId, ref))
              // Presence supplements the exact native ack; alone it can never
              // confirm which set operation persisted, nor whether it works.
              if (credential.configured !== (input.change.action === 'set')) outcome = { status: 'unconfirmed' }
              else observation = { credentialConfigured: credential.configured }
            }
          }
          observation = { ...observed(after), ...observation }
        }
      } catch { outcome = { status: 'unconfirmed' } }
      await verify()
      if (outcome.status === 'unconfirmed') return this.read(token, reserved.row.command_id, context.requestId)
      const status = outcome.status
      return this.identity.modelTransaction(token, context.requestId, 'runtime.model.confirmed', async (db, actor) => {
        const current = await this.target(db, actor, input.targetUserId); signal.throwIfAborted()
        if (!sameActor(initial.actor, actor) || !isDeepStrictEqual(initial.cell, current)) throw changed()
        const confirmation = { commandId: reserved.row.command_id, outcome: status, ...(observation ? { observation } : {}) }
        const [row] = await db<Command[]>`update haas.model_commands set outcome=${status},confirmation=${db.json(confirmation as JSONValue)},confirmed_at=clock_timestamp()
          where tenant_id=${actor.account.tenantId} and command_id=${reserved.row.command_id} and outcome='unconfirmed' returning *`
        if (!row) throw changed()
        return { data: summary(row), targetId: input.targetUserId, reason: JSON.stringify({ commandId: row.command_id, outcome: status, reason: input.reason }) }
      })
    })
  }
  async resolve(token: string | undefined, id: string, body: unknown, requestId: string, cancellation: AbortSignal) {
    const commandId = uuid(id), input = record(body, ['expectedCellRevision', 'reason', 'confirmed'])
    if (input.confirmed !== true) return invalid('请确认历史效果仍不确定，旧操作不会重发')
    const expectedCellRevision = uuid(input.expectedCellRevision), reason = text(input.reason, 3, 500)
    return this.lifetime(token, cancellation, async signal => {
      const initial = await this.identity.modelTransaction(token, requestId, 'runtime.model.command.authorized', async (db, actor) => {
        const row = await this.command(db, actor, commandId), cell = await this.target(db, actor, row.target_user_id)
        if (row.outcome !== 'unconfirmed' || cell.revision !== expectedCellRevision || !replacement(row.target_pin, cell)) throw changed()
        return { data: { row, actor, cell }, targetId: row.target_user_id, reason }
      })
      await this.verify(token, requestId, initial.actor, initial.cell, signal)
      const state = await this.settings(initial.cell, signal)
      return this.identity.modelTransaction(token, requestId, 'runtime.model.resolved', async (db, actor) => {
        const cell = await this.target(db, actor, initial.row.target_user_id); signal.throwIfAborted()
        if (!sameActor(initial.actor, actor) || !isDeepStrictEqual(initial.cell, cell)) throw changed()
        const confirmation = { commandId, outcome: 'superseded', effect: 'unknown', cellRevision: cell.revision, observation: observed(state), reason }
        const [row] = await db<Command[]>`update haas.model_commands set outcome='superseded',confirmation=${db.json(confirmation)},confirmed_at=clock_timestamp()
          where tenant_id=${actor.account.tenantId} and command_id=${commandId} and outcome='unconfirmed' returning *`
        if (!row) throw changed()
        return { data: summary(row), targetId: row.target_user_id, reason: JSON.stringify({ commandId, effect: 'unknown', reason }) }
      })
    })
  }
}
