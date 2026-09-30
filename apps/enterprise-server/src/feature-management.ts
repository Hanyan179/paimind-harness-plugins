import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { JSONValue, TransactionSql } from 'postgres'
import { FEATURE_CATALOG_DIGEST, FEATURE_RECONCILED_PACK_IDS, digest, readFeatureChangePlan, readFeatureJournal, readFeatureSelection,
  type PaimindFeatureChangePlan, type PaimindFeatureCommandJournal } from '@paimind/extension-center/governance'
import { EnterpriseError, invalid, record, text, uuid } from './errors.js'
import type { Account, CommandContext, Identity, RuntimeIdentity } from './identity.js'
import type { PrivateRuntimeCell, RuntimeBindings } from './runtime-bindings.js'
import type { CellTransport } from './cell-transport.js'
import { retainCellTransports, selectCellTransport } from './cell-transport-directory.js'
import { PAIMIND_FEATURE_PACK_REMOTE_DESCRIPTORS } from '@paimind/extension-center/remote'

export interface ApprovedFeatureRelease { imageId: string; catalogDigest: string; packIds: readonly string[] }
interface Approval { image_id: string; catalog_digest: string; pack_ids: string[]; revision: number; reason: string }
interface Command {
  command_id: string; actor_user_id: string; request_digest: string; target_user_id: string;
  input: { targetUserId: string; selection: ReturnType<typeof readFeatureSelection>; planDigest: string; approvalRevision: number; reason: string; confirmed: true };
  target_pin: PrivateRuntimeCell; plan: PaimindFeatureChangePlan; outcome: 'unconfirmed' | 'applied' | 'rolled-back'; confirmation: PaimindFeatureCommandJournal | null
}
const denied = () => new EnterpriseError(403, 'feature-not-approved', '当前目标、镜像或完整功能包范围尚未批准')
const changed = () => new EnterpriseError(409, 'feature-context-changed', '管理员身份、批准或准确运行环境已变化，请重新确认')
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= 2_147_483_647) return invalid('批准版本无效')
  return Number(value)
}
function packs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > FEATURE_RECONCILED_PACK_IDS.length
    || value.some(id => typeof id !== 'string' || !FEATURE_RECONCILED_PACK_IDS.includes(id)) || new Set(value).size !== value.length) return invalid('批准的功能包范围无效')
  return [...value].sort()
}
function selection(value: unknown) { try { return readFeatureSelection(value) } catch { return invalid('功能包选择无效') } }
function sameActor(a: RuntimeIdentity, b: RuntimeIdentity): boolean {
  return a.sessionId === b.sessionId && a.account.userId === b.account.userId && a.account.tenantId === b.account.tenantId && a.account.role === b.account.role
}
function sameRecoveryStorage(original: PrivateRuntimeCell, current: PrivateRuntimeCell): boolean {
  return (['cellId', 'tenantId', 'userId', 'role', 'volumeName', 'imageId', 'policyDigest'] as const)
    .every(key => original[key] === current[key])
    && original.containerId !== current.containerId && original.revision !== current.revision
}
function pinDigest(pin: PrivateRuntimeCell): string {
  // JSONB/object insertion order is not runtime identity, and private
  // transport configuration is deliberately absent from this projection.
  return digest((['cellId', 'tenantId', 'userId', 'role', 'revision', 'origin', 'containerId', 'imageId', 'volumeName', 'policyDigest'] as const)
    .map(key => [key, pin[key]]))
}
function matchingJournal(journal: PaimindFeatureCommandJournal | undefined, row: Command): boolean {
  return Boolean(journal && journal.commandId === row.command_id && journal.requestDigest === row.request_digest
    && isDeepStrictEqual(journal.plan, row.plan))
}
function recoveryView(row: Command | undefined, current: PrivateRuntimeCell, journal: PaimindFeatureCommandJournal | undefined) {
  if (!row || row.outcome !== 'unconfirmed') return null
  const pins = { originalPinDigest: pinDigest(row.target_pin), currentPinDigest: pinDigest(current) }
  if (isDeepStrictEqual(row.target_pin, current)) return { kind: 'same-runtime' as const, ...pins }
  if (sameRecoveryStorage(row.target_pin, current) && matchingJournal(journal, row)) return { kind: 'replacement-runtime' as const, ...pins }
  return { kind: 'blocked' as const, ...pins, reason: '当前运行环境、原数据身份或原生回执不匹配，不能迁移原命令。请由部署人员检查，不要重复创建。' }
}
function summary(row: Command) {
  return { commandId: row.command_id, targetUserId: row.target_user_id, outcome: row.outcome, reason: row.input.reason,
    selection: row.input.selection, planDigest: row.plan.planDigest, imageId: row.target_pin.imageId,
    historicalReceipt: true as const, runtimeGrant: false as const }
}

/** Governance only. Native settings, actual state and execution remain at the
 * original owner. No browser-selected address or cached execution permission. */
export class FeatureManagement {
  private readonly releases: ReadonlyMap<string, ApprovedFeatureRelease>
  private readonly transports: ReadonlyMap<string, CellTransport>
  private readonly active = new Set<AbortController>()
  private closed = false
  constructor(private readonly identity: Identity, private readonly bindings: RuntimeBindings,
    transports: ReadonlyMap<string, CellTransport>, releases: readonly ApprovedFeatureRelease[]) {
    if (!Array.isArray(releases) || releases.length > 32) throw Error('Invalid operator Feature Pack releases')
    const checked = releases.map(input => {
      record(input, ['imageId', 'catalogDigest', 'packIds'])
      if (!/^sha256:[a-f0-9]{64}$/u.test(input.imageId) || input.catalogDigest !== FEATURE_CATALOG_DIGEST) throw Error('Unsupported approved Feature Pack release')
      return Object.freeze({ imageId: input.imageId, catalogDigest: input.catalogDigest, packIds: Object.freeze(packs(input.packIds)) })
    })
    if (new Set(checked.map(row => row.imageId)).size !== checked.length) throw Error('Duplicate approved Feature Pack image')
    this.releases = new Map(checked.map(row => [row.imageId, row])); this.transports = retainCellTransports(transports)
    for (const [origin, transport] of this.transports) if (origin !== transport.ingressOrigin) throw Error('Feature transport binding mismatch')
  }
  close() { this.closed = true; for (const controller of this.active) controller.abort() }
  private assertOpen() {
    if (this.closed) throw new EnterpriseError(503, 'feature-management-unavailable', '功能包管理已关闭', true)
  }
  private async target(db: TransactionSql, actor: RuntimeIdentity, userId: string) {
    this.assertOpen()
    const [row] = await db<{ user_id: string; tenant_id: string; username: string; display_name: string; role: Account['role']; status: Account['status'] }[]>`
      select user_id,tenant_id,username,display_name,role,status from haas.users
      where tenant_id = ${actor.account.tenantId} and user_id = ${userId} and status = 'active'`
    if (!row) throw denied()
    const account: Account = { userId: row.user_id, tenantId: row.tenant_id, username: row.username, displayName: row.display_name, role: row.role, status: row.status }
    const cell = await this.bindings.selectManagedAccount(db, account), release = this.releases.get(cell.imageId)
    if (!release || release.catalogDigest !== FEATURE_CATALOG_DIGEST) throw denied()
    const [approval] = await db<Approval[]>`select image_id,catalog_digest,pack_ids,revision,reason from haas.feature_approvals
      where tenant_id = ${account.tenantId} and user_id = ${account.userId}`
    return { account, cell, release, approval }
  }
  private requireApproval(target: Awaited<ReturnType<FeatureManagement['target']>>, expected?: number) {
    const approval = target.approval
    if (!approval || approval.image_id !== target.cell.imageId || approval.catalog_digest !== FEATURE_CATALOG_DIGEST
      || expected !== undefined && approval.revision !== expected
      || FEATURE_RECONCILED_PACK_IDS.some(id => !target.release.packIds.includes(id) || !approval.pack_ids.includes(id))) throw denied()
    return packs(approval.pack_ids)
  }
  private native(cell: PrivateRuntimeCell, operation: 'feature.plan' | 'feature.describe' | 'feature.apply', input: object, signal: AbortSignal) {
    this.assertOpen()
    signal.throwIfAborted()
    const transport = selectCellTransport(this.transports, cell)
    if (!transport || transport.ingressOrigin !== cell.origin) throw new EnterpriseError(503, 'feature-transport-unavailable', '原功能包控制通道尚未就绪', true)
    return transport.requestControl(operation, input, signal)
  }
  private async lifetime<T>(cancellation: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed || this.active.size >= 8) throw new EnterpriseError(503, 'feature-management-busy', '功能包管理繁忙，请稍后重试', true)
    const controller = new AbortController(); this.active.add(controller)
    try { return await work(AbortSignal.any([controller.signal, cancellation, AbortSignal.timeout(15_000)])) }
    finally { this.active.delete(controller) }
  }
  private async planContext(token: string | undefined, input: unknown, requestId: string, cancellation: AbortSignal) {
    const body = record(input, ['targetUserId', 'selection']), userId = uuid(body.targetUserId), selected = selection(body.selection)
    return this.lifetime(cancellation, async signal => {
      const initial = await this.identity.resourceRead(token, requestId, true, async (db, actor) => ({ actor, ...await this.target(db, actor, userId) }))
      signal.throwIfAborted()
      const plan = readFeatureChangePlan(await this.native(initial.cell, 'feature.plan', selected, signal))
      if (!isDeepStrictEqual(plan.selection, selected)) throw changed()
      return this.identity.featureTransaction(token, requestId, 'runtime.feature.read', async (db, actor) => {
        const current = await this.target(db, actor, userId); signal.throwIfAborted()
        if (!sameActor(actor, initial.actor) || !isDeepStrictEqual(current.cell, initial.cell)) throw changed()
        return { data: { actor, cell: current.cell, plan, targetUserId: userId, targetName: current.account.displayName, imageId: current.cell.imageId,
          approval: current.approval ? { imageId: current.approval.image_id, catalogDigest: current.approval.catalog_digest,
            packIds: current.approval.pack_ids, revision: current.approval.revision, reason: current.approval.reason } : null,
          allowedPackIds: current.release.packIds }, targetId: userId, reason: 'preview:' + plan.planDigest }
      })
    })
  }
  async preview(token: string | undefined, input: unknown, requestId: string, cancellation: AbortSignal) {
    const { actor: _actor, cell: _cell, ...view } = await this.planContext(token, input, requestId, cancellation)
    return view
  }
  async state(token: string | undefined, input: unknown, requestId: string, cancellation: AbortSignal) {
    const body = record(input, ['targetUserId']), userId = uuid(body.targetUserId)
    return this.lifetime(cancellation, async signal => {
      const initial = await this.identity.resourceRead(token, requestId, true, async (db, actor) => ({ actor, ...await this.target(db, actor, userId) }))
      const native = record(await this.native(initial.cell, 'feature.describe', {}, signal), ['view', 'command'])
      const view = PAIMIND_FEATURE_PACK_REMOTE_DESCRIPTORS[0]!.result.schema.parse(native.view)
      const journal = native.command === null ? undefined : readFeatureJournal(JSON.stringify(native.command))
      return this.identity.featureTransaction(token, requestId, 'runtime.feature.read', async (db, actor) => {
        const target = await this.target(db, actor, userId); signal.throwIfAborted()
        if (!sameActor(actor, initial.actor) || !isDeepStrictEqual(target.cell, initial.cell)) throw changed()
        const [latest] = await db<{ command_id: string }[]>`select command_id from haas.feature_commands
          where tenant_id=${actor.account.tenantId} and target_user_id=${userId}
          order by (outcome='unconfirmed') desc,created_at desc,command_id desc limit 1`
        const row = latest ? await this.command(db, actor, latest.command_id) : undefined
        const command = row ? summary(row) : null
        return { data: { targetUserId: userId, targetName: target.account.displayName, imageId: target.cell.imageId,
          catalogDigest: FEATURE_CATALOG_DIGEST, allowedPackIds: target.release.packIds,
          approval: target.approval ? { imageId: target.approval.image_id, catalogDigest: target.approval.catalog_digest,
            packIds: target.approval.pack_ids, revision: target.approval.revision, reason: target.approval.reason } : null,
          view, command, recovery: recoveryView(row, target.cell, journal),
          nativeCommand: journal ? { commandId: journal.commandId, phase: journal.phase, planDigest: journal.plan.planDigest } : null,
          observedAt: new Date().toISOString() }, targetId: userId, reason: 'current-state-and-command-readback' }
      })
    })
  }
  async approve(token: string | undefined, input: unknown, context: CommandContext) {
    this.assertOpen()
    const normalize = () => {
      const body = record(input, ['targetUserId', 'imageId', 'catalogDigest', 'packIds', 'expectedRevision', 'reason', 'confirmed'])
      if (body.confirmed !== true || body.catalogDigest !== FEATURE_CATALOG_DIGEST) return invalid('请确认准确目录与批准范围')
      return { targetUserId: uuid(body.targetUserId), imageId: text(body.imageId, 71, 71), catalogDigest: FEATURE_CATALOG_DIGEST,
        packIds: packs(body.packIds), expectedRevision: revision(body.expectedRevision), reason: text(body.reason, 3, 500) }
    }
    return this.identity.resourceCommand(token, 'runtime.feature.approval', normalize, context, true, async (db, actor, data) => {
      const current = await this.target(db, actor, data.targetUserId)
      if (current.cell.imageId !== data.imageId || data.packIds.some(id => !current.release.packIds.includes(id))) throw denied()
      if ((current.approval?.revision ?? 0) !== data.expectedRevision) throw changed()
      const next = data.expectedRevision + 1
      await db`insert into haas.feature_approvals (tenant_id,user_id,image_id,catalog_digest,pack_ids,revision,reason,updated_by)
        values (${actor.account.tenantId},${data.targetUserId},${data.imageId},${data.catalogDigest},${db.json(data.packIds)},${next},${data.reason},${actor.account.userId})
        on conflict (tenant_id,user_id) do update set image_id=excluded.image_id,catalog_digest=excluded.catalog_digest,
        pack_ids=excluded.pack_ids,revision=excluded.revision,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=clock_timestamp()`
      return { data: { targetUserId: data.targetUserId, imageId: data.imageId, catalogDigest: data.catalogDigest, packIds: data.packIds, revision: next },
        targetId: data.targetUserId, reason: JSON.stringify({ reason: data.reason, imageId: data.imageId,
          catalogDigest: data.catalogDigest, packIds: data.packIds, revision: next }) }
    }, async (db, actor, data, previous) => {
      const current = await this.target(db, actor, data.targetUserId)
      if (current.cell.imageId !== previous.imageId || current.approval?.revision !== previous.revision) throw changed()
    })
  }
  async create(token: string | undefined, input: unknown, context: CommandContext, cancellation: AbortSignal) {
    this.assertOpen(); cancellation.throwIfAborted()
    const body = record(input, ['targetUserId', 'selection', 'planDigest', 'approvalRevision', 'reason', 'confirmed'])
    if (body.confirmed !== true) return invalid('请确认全部功能包协调影响')
    const data: Command['input'] = { targetUserId: uuid(body.targetUserId), selection: selection(body.selection),
      planDigest: text(body.planDigest, 71, 71), approvalRevision: revision(body.approvalRevision), reason: text(body.reason, 3, 500), confirmed: true }
    const key = uuid(context.key), requestDigest = digest(data)
    const existing = await this.identity.resourceRead(token, context.requestId, true, async (db, actor) => {
      const [row] = await db<Command[]>`select * from haas.feature_commands where tenant_id=${actor.account.tenantId}
        and actor_user_id=${actor.account.userId} and idempotency_key=${key}`
      if (row && row.request_digest !== requestDigest) throw new EnterpriseError(409, 'idempotency-conflict', '原请求编号不能用于不同内容')
      return row
    })
    if (existing) return this.resume(token, existing.command_id, { reason: data.reason, confirmed: true }, context.requestId, cancellation)
    const preview = await this.planContext(token, { targetUserId: data.targetUserId, selection: data.selection }, context.requestId, cancellation)
    if (preview.plan.planDigest !== data.planDigest) throw changed()
    const commandId = await this.identity.featureTransaction(token, context.requestId, 'runtime.feature.requested', async (db, actor) => {
      cancellation.throwIfAborted()
      const target = await this.target(db, actor, data.targetUserId); this.requireApproval(target, data.approvalRevision)
      if (!sameActor(actor, preview.actor) || !isDeepStrictEqual(target.cell, preview.cell)) throw changed()
      const [existing] = await db<Command[]>`select * from haas.feature_commands where tenant_id=${actor.account.tenantId}
        and actor_user_id=${actor.account.userId} and idempotency_key=${key}`
      if (existing) {
        if (existing.request_digest !== requestDigest) throw new EnterpriseError(409, 'idempotency-conflict', '原请求编号不能用于不同内容')
        return { data: existing.command_id, targetId: data.targetUserId, reason: 'replay:' + data.reason }
      }
      const [pending] = await db`select 1 from haas.feature_commands where tenant_id=${actor.account.tenantId}
        and target_user_id=${data.targetUserId} and outcome='unconfirmed'`
      if (pending) throw new EnterpriseError(409, 'feature-command-pending', '该成员已有待确认命令，请先确认或恢复原命令')
      const [capacity] = await db<{ count: number }[]>`select count(*)::integer as count from haas.feature_commands where tenant_id=${actor.account.tenantId}`
      if (!capacity || capacity.count >= 10000) throw new EnterpriseError(409, 'feature-command-capacity', '功能包命令记录已达保留上限；未删除历史记录')
      const id = randomUUID()
      await db`insert into haas.feature_commands (tenant_id,command_id,actor_user_id,login_session_id,idempotency_key,request_digest,target_user_id,input,target_pin,plan)
        values (${actor.account.tenantId},${id},${actor.account.userId},${actor.sessionId},${key},${requestDigest},${data.targetUserId},
        ${db.json(data as unknown as JSONValue)},${db.json(target.cell as unknown as JSONValue)},${db.json(preview.plan as unknown as JSONValue)})`
      return { data: id, targetId: data.targetUserId, reason: JSON.stringify({ commandId: id, reason: data.reason, planDigest: data.planDigest }) }
    })
    return this.resume(token, commandId, { reason: data.reason, confirmed: true }, context.requestId, cancellation)
  }
  async read(token: string | undefined, commandId: string, requestId: string) {
    this.assertOpen()
    const id = uuid(commandId)
    return this.identity.featureTransaction(token, requestId, 'runtime.feature.read', async (db, actor) => {
      const row = await this.command(db, actor, id)
      return { data: summary(row), targetId: row.target_user_id, reason: 'command:' + id }
    })
  }
  private async command(db: TransactionSql, actor: RuntimeIdentity, id: string): Promise<Command> {
    this.assertOpen()
    const [row] = await db<Command[]>`select * from haas.feature_commands where tenant_id=${actor.account.tenantId} and command_id=${id}`
    if (!row) throw new EnterpriseError(404, 'not-found', '命令不存在或不可访问')
    row.plan = readFeatureChangePlan(row.plan)
    return row
  }
  async resume(token: string | undefined, commandId: string, input: unknown, requestId: string, cancellation: AbortSignal) {
    const optional = input && typeof input === 'object' && !Array.isArray(input)
      ? ['expectedRuntimeDigest', 'allowReplacement'].filter(key => Object.hasOwn(input, key)) : []
    const id = uuid(commandId), body = record(input, ['reason', 'confirmed', ...optional]), reason = text(body.reason, 3, 500)
    if (body.confirmed !== true) return invalid('请确认恢复准确原命令')
    if (body.expectedRuntimeDigest !== undefined && (typeof body.expectedRuntimeDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(body.expectedRuntimeDigest))
      || body.allowReplacement !== undefined && body.allowReplacement !== true
      || body.allowReplacement === true && body.expectedRuntimeDigest === undefined) return invalid('请回读并确认准确替代运行环境')
    return this.lifetime(cancellation, async signal => {
      const prepared = await this.identity.featureTransaction(token, requestId, 'runtime.feature.authorized', async (db, actor) => {
        signal.throwIfAborted()
        const row = await this.command(db, actor, id)
        if (row.outcome !== 'unconfirmed') return { data: { row, actor, cell: row.target_pin, replacement: false, approvedPackIds: [], approvalRevision: 0 }, targetId: row.target_user_id, reason: 'historical:' + id }
        const target = await this.target(db, actor, row.target_user_id), approvedPackIds = this.requireApproval(target)
        if (body.expectedRuntimeDigest !== undefined && body.expectedRuntimeDigest !== pinDigest(target.cell)) throw changed()
        const replacement = !isDeepStrictEqual(target.cell, row.target_pin)
        if (replacement && (body.allowReplacement !== true || !sameRecoveryStorage(row.target_pin, target.cell))) throw changed()
        return { data: { row, actor, cell: target.cell, replacement, approvedPackIds, approvalRevision: target.approval!.revision }, targetId: row.target_user_id,
          reason: JSON.stringify({ commandId: id, reason, approvalRevision: target.approval!.revision,
            ...(replacement ? { recovery: { originalPinDigest: pinDigest(row.target_pin), currentPinDigest: pinDigest(target.cell) } } : {}) }) }
      })
      if (prepared.row.outcome !== 'unconfirmed') return summary(prepared.row)
      const verify = () => this.identity.resourceRead(token, requestId, true, async (db, actor) => {
        signal.throwIfAborted(); const target = await this.target(db, actor, prepared.row.target_user_id); this.requireApproval(target, prepared.approvalRevision)
        if (!sameActor(actor, prepared.actor) || !isDeepStrictEqual(target.cell, prepared.cell)) throw changed()
      })
      await verify(); signal.throwIfAborted()
      if (prepared.replacement) {
        // Admission/old-writer termination remain the independent operator's
        // responsibility. Do not execute into a fresh or different journal:
        // only the same native owner's durable original command can continue.
        await this.identity.resourceTransfer(token, requestId, async () => {
          const native = record(await this.native(prepared.cell, 'feature.describe', {}, signal), ['view', 'command'])
          const journal = native.command === null ? undefined : readFeatureJournal(JSON.stringify(native.command))
          if (!matchingJournal(journal, prepared.row)) throw changed()
        }, 'runtime.feature.transfer')
        await verify(); signal.throwIfAborted()
      }
      let journal: PaimindFeatureCommandJournal
      try {
        journal = await this.identity.resourceTransfer(token, requestId, async () => {
          const native = await this.native(prepared.cell, 'feature.apply', { commandId: id, requestDigest: prepared.row.request_digest,
            planDigest: prepared.row.plan.planDigest, selection: prepared.row.plan.selection, approvedPackIds: prepared.approvedPackIds }, signal)
          const value = native as { command?: unknown }
          const journal = value && typeof value === 'object' && value.command ? readFeatureJournal(JSON.stringify(value.command)) : undefined
          if (!journal || journal.commandId !== id || journal.requestDigest !== prepared.row.request_digest
            || journal.plan.planDigest !== prepared.row.plan.planDigest || !['applied', 'rolled-back'].includes(journal.phase)) {
            throw new EnterpriseError(503, 'feature-command-unconfirmed', '原功能包命令结果尚未确认', true)
          }
          return journal
        }, 'runtime.feature.transfer')
      } catch (error) {
        // A transport error can follow native acceptance. Retain the exact
        // command; never claim rollback, clear it, or issue a fresh command.
        if (error instanceof EnterpriseError && error.code === 'audit-unavailable') throw error
        await verify(); return summary(prepared.row)
      }
      return this.identity.featureTransaction(token, requestId, 'runtime.feature.confirmed', async (db, actor) => {
        signal.throwIfAborted(); const current = await this.target(db, actor, prepared.row.target_user_id); this.requireApproval(current, prepared.approvalRevision)
        if (!sameActor(actor, prepared.actor) || !isDeepStrictEqual(current.cell, prepared.cell)) throw changed()
        const row = await this.command(db, actor, id)
        if (row.outcome === 'unconfirmed') {
          await db`update haas.feature_commands set outcome=${journal.phase},confirmation=${db.json(journal as unknown as JSONValue)},confirmed_at=clock_timestamp()
            where tenant_id=${actor.account.tenantId} and command_id=${id} and outcome='unconfirmed'`
          row.outcome = journal.phase as 'applied' | 'rolled-back'
        } else if (row.outcome !== journal.phase) throw changed()
        return { data: summary(row), targetId: row.target_user_id, reason: JSON.stringify({ commandId: id, reason, outcome: row.outcome,
          ...(prepared.replacement ? { recovery: { originalPinDigest: pinDigest(row.target_pin), currentPinDigest: pinDigest(prepared.cell) } } : {}) }) }
      })
    })
  }
}
