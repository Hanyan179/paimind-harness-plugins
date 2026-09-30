import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Sql, TransactionSql } from 'postgres'
import { validateNativeOriginInput, validateNativeExecutionInput, validateNativeDelegationInput, validateNativeJobOriginInput, validateNativeSkillReferences,
  validateNativeConnectorApprovalInput, validateNativeConnectorExecutionInput, type NativeConnectorReleaseReference, type NativeOriginInput } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { Publications } from './publications.js'
import { SkillPublications } from './skill-publications.js'
import { EnterpriseError } from './errors.js'
import type { Account, Identity, RuntimeIdentity } from './identity.js'

export interface RuntimeGrant {
  cellId: string; tenantId: string; userId: string; role: 'admin' | 'member'; revision: string; origin: string; validForMs: number
  transport?: 'private-cell'
}

/** Trusted operator snapshot, never supplied by HTTP or generated from a DB
 * row. The provisioner must verify its actual container, volume, immutable
 * image and policy before publishing this snapshot and renewing its DB lease.
 */
export interface PrivateRuntimeCell {
  readonly cellId: string; readonly tenantId: string; readonly userId: string; readonly role: 'admin' | 'member'
  readonly revision: string; readonly origin: string; readonly containerId: string; readonly imageId: string
  readonly volumeName: string; readonly policyDigest: string
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
export function validatePrivateRuntimeCell(value: PrivateRuntimeCell, publicOrigin: string): PrivateRuntimeCell {
  if (!value || ![value.cellId, value.userId, value.revision].every(id => typeof id === 'string' && uuid.test(id))
    || typeof value.tenantId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value.tenantId)
    || !['admin', 'member'].includes(value.role) || !/^[a-f0-9]{64}$/.test(value.containerId)
    || !/^sha256:[a-f0-9]{64}$/.test(value.imageId) || !/^sha256:[a-f0-9]{64}$/.test(value.policyDigest)
    || !/^paimind-haas-member-[a-z0-9-]{1,100}$/.test(value.volumeName)) throw new Error('Invalid private runtime identity')
  developmentCellOrigin(value.origin, publicOrigin)
  return Object.freeze({ ...value })
}

export function developmentCellOrigin(value: string, publicOrigin: string): URL {
  const url = new URL(value)
  if (url.origin !== value || url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || !url.port || Number(url.port) < 1024 || url.port === '3080' || value === publicOrigin
    || url.username || url.password) throw new Error('Invalid isolated development cell origin')
  return url
}

/** Selection is exclusively by authenticated tenant/user/session. An operator
 * allowlist pins destinations independently of database contents. Runtime role
 * cannot insert or update bindings. No caller-provided URL, cell id or user id. */
export class RuntimeBindings {
  private readonly allowed: ReadonlySet<string>
  private readonly privateCells: Map<string, PrivateRuntimeCell>
  constructor(private readonly sql: Sql, private readonly identity: Identity,
    private readonly publicOrigin: string, origins: readonly string[], cells: readonly PrivateRuntimeCell[] = []) {
    if (origins.length + cells.length === 0 || origins.length + cells.length > 128
      || new Set(origins).size !== origins.length) throw new Error('Explicit unique cell origins required')
    for (const origin of origins) developmentCellOrigin(origin, publicOrigin)
    this.allowed = new Set(origins)
    const checked = cells.map(cell => validatePrivateRuntimeCell(cell, publicOrigin))
    for (const field of ['cellId', 'origin', 'containerId', 'volumeName'] as const) {
      if (new Set(checked.map(cell => cell[field])).size !== checked.length) throw new Error('Private cells cannot share runtime identity')
    }
    if (new Set(checked.map(cell => `${cell.tenantId}/${cell.userId}`)).size !== checked.length
      || checked.some(cell => this.allowed.has(cell.origin))) throw new Error('Private cells cannot alias development or user bindings')
    this.privateCells = new Map(checked.map(cell => [cell.cellId, cell]))
  }
  resolve(token: string | undefined, requestId: string): Promise<RuntimeGrant> {
    return this.identity.withRuntimeIdentity(token, requestId, principal => this.current(principal))
  }
  /** A retired reverse connection cannot borrow the replacement via cellId. */
  assertPrivateCell(expected: PrivateRuntimeCell): void {
    if (!isDeepStrictEqual(this.privateCells.get(expected.cellId), expected)) {
      throw new EnterpriseError(403, 'runtime-cell-denied', '运行单元固定修订已变化')
    }
  }
  private replacement(previous: PrivateRuntimeCell, next: PrivateRuntimeCell): PrivateRuntimeCell {
    this.assertPrivateCell(previous)
    const checked = validatePrivateRuntimeCell(next, this.publicOrigin)
    for (const key of ['cellId', 'tenantId', 'userId', 'role', 'volumeName', 'imageId', 'policyDigest'] as const) {
      if (previous[key] !== checked[key]) throw Error('Replacement must retain exact member storage, image and policy')
    }
    if (previous.revision === checked.revision || previous.containerId === checked.containerId
      || this.allowed.has(checked.origin) || [...this.privateCells.values()].some(cell => cell.cellId !== checked.cellId
        && (cell.origin === checked.origin || cell.containerId === checked.containerId || cell.volumeName === checked.volumeName))) {
      throw Error('Private runtime replacement conflicts with the current pins')
    }
    return checked
  }
  /** Operator composition only: no HTTP route or DB write. The provisioner
   * already stopped the old writer and admitted its replacement. Publish all
   * pointers synchronously; subsequent requests still check identity/lease. */
  async verifyPrivateCellReplacement(previous: PrivateRuntimeCell, next: PrivateRuntimeCell, signal: AbortSignal): Promise<PrivateRuntimeCell> {
    signal.throwIfAborted()
    const cell = this.replacement(previous, next)
    const [row] = await this.sql`select 1 from haas.admitted_runtime_bindings b join haas.users u using (tenant_id,user_id)
      join haas.tenants t using (tenant_id) where b.cell_id=${cell.cellId} and b.tenant_id=${cell.tenantId}
      and b.user_id=${cell.userId} and u.role=${cell.role} and u.status='active' and t.status='active'
      and b.revision=${cell.revision} and b.origin=${cell.origin} and b.container_id=${cell.containerId}
      and b.image_id=${cell.imageId} and b.volume_name=${cell.volumeName} and b.policy_digest=${cell.policyDigest}
      and b.isolation_mode='container-managed' and b.status='ready' and b.lease_expires_at>clock_timestamp()`
    if (!row) throw new EnterpriseError(503, 'runtime-replacement-unavailable', '替代运行环境未获得准确有效的准入', true)
    signal.throwIfAborted(); this.replacement(previous, cell)
    return cell
  }
  async replacePrivateCell(previous: PrivateRuntimeCell, next: PrivateRuntimeCell, publish: () => void, signal: AbortSignal): Promise<void> {
    const cell = await this.verifyPrivateCellReplacement(previous, next, signal)
    signal.throwIfAborted(); this.replacement(previous, cell)
    publish()
    this.privateCells.set(cell.cellId, cell)
  }
  /** Only composed with Identity.inspectMemberContent. It creates no member
   * login or generic runtime grant, and never permits development processes. */
  async selectInspectedMember(db: TransactionSql, member: Account): Promise<PrivateRuntimeCell> {
    if (member.role !== 'member') throw new EnterpriseError(403, 'member-content-denied', '无法查看所选成员的内容')
    const cell = [...this.privateCells.values()].find(row => row.tenantId === member.tenantId && row.userId === member.userId && row.role === 'member')
    if (!cell) throw new EnterpriseError(503, 'member-content-unavailable', '所选成员没有可安全读取的受管运行环境', true)
    const [row] = await db`select 1 from haas.admitted_runtime_bindings where cell_id = ${cell.cellId}
      and tenant_id = ${member.tenantId} and user_id = ${member.userId} and revision = ${cell.revision}
      and origin = ${cell.origin} and isolation_mode = 'container-managed' and status = 'ready'
      and lease_expires_at > clock_timestamp() and container_id = ${cell.containerId} and image_id = ${cell.imageId}
      and volume_name = ${cell.volumeName} and policy_digest = ${cell.policyDigest}`
    if (!row) throw new EnterpriseError(503, 'member-content-unavailable', '所选成员运行环境不可用或已变化', true)
    return cell
  }
  /** Current administrator composition only. Unlike history inspection,
   * management requires an active target; no development-cell fallback. */
  async selectManagedAccount(db: TransactionSql, target: Account): Promise<PrivateRuntimeCell> {
    if (target.status !== 'active') throw new EnterpriseError(403, 'feature-target-denied', '所选账户不可管理')
    const cell = [...this.privateCells.values()].find(row => row.tenantId === target.tenantId && row.userId === target.userId && row.role === target.role)
    if (!cell) throw new EnterpriseError(503, 'feature-target-unavailable', '所选账户没有准确的受管运行环境', true)
    const [row] = await db`select 1 from haas.admitted_runtime_bindings where cell_id = ${cell.cellId}
      and tenant_id = ${target.tenantId} and user_id = ${target.userId} and revision = ${cell.revision}
      and origin = ${cell.origin} and isolation_mode = 'container-managed' and status = 'ready'
      and lease_expires_at > clock_timestamp() and container_id = ${cell.containerId} and image_id = ${cell.imageId}
      and volume_name = ${cell.volumeName} and policy_digest = ${cell.policyDigest}`
    if (!row) throw new EnterpriseError(503, 'feature-target-unavailable', '所选账户运行绑定已变化', true)
    return cell
  }
  /** Native preset visibility for this exact authenticated browser principal.
   * Does not grant model/tool execution or substitute for native ownership. */
  async readAgentPresetEligibility(token: string | undefined, requestId: string, grant: RuntimeGrant,
    presetIds: readonly string[]): Promise<readonly string[]> {
    const selected = Object.freeze([...presetIds])
    return this.identity.resourceRead(token, requestId, false, async (db, principal) => {
      if (principal.account.tenantId !== grant.tenantId || principal.account.userId !== grant.userId || principal.account.role !== grant.role) {
        throw new EnterpriseError(403, 'runtime-principal-changed', '账户运行权限已变化，请重新连接')
      }
      // Gateway independently re-admits this exact cell/revision after policy
      // IO. The existing tenant transaction serializes assignment revocation.
      return Publications.readPresetEligibility(db, principal, selected)
    })
  }

  /** Metadata for the account fixed by this private connection. Deliberately
   * no login/turn source: preferences must not borrow an unrelated login, and
   * this result cannot authorize a message, tool or model request. */
  async readSkillEligibility(cellId: string, references: unknown, signal: AbortSignal): Promise<readonly string[]> {
    validateNativeSkillReferences(references); signal.throwIfAborted()
    const selected = structuredClone(references), cell = this.privateCells.get(cellId)
    if (!cell) throw new EnterpriseError(403, 'runtime-cell-denied', '运行单元未获准入')
    return this.identity.readRuntimeAccount({ tenantId: cell.tenantId, userId: cell.userId, role: cell.role }, randomUUID(), async (db, account) => {
      const verify = async () => {
        signal.throwIfAborted()
        const [row] = await db`select 1 from haas.admitted_runtime_bindings where cell_id = ${cell.cellId}
          and tenant_id = ${cell.tenantId} and user_id = ${cell.userId} and revision = ${cell.revision}
          and origin = ${cell.origin} and isolation_mode = 'container-managed' and status = 'ready'
          and lease_expires_at > clock_timestamp() and container_id = ${cell.containerId} and image_id = ${cell.imageId}
          and volume_name = ${cell.volumeName} and policy_digest = ${cell.policyDigest}`
        if (!row) throw new EnterpriseError(403, 'runtime-cell-denied', '运行单元绑定已变化')
      }
      await verify()
      const eligible = await SkillPublications.readEligibility(db, { account }, selected)
      await verify(); signal.throwIfAborted()
      return eligible
    })
  }
  /** Internal reverse-channel consumer. The gateway closure selects a pinned
   * cell, never one claimed in the native message or signed source payload. */
  async checkInteractiveOrigins(cellId: string, input: unknown, signal: AbortSignal): Promise<void> {
    validateNativeOriginInput(input); signal.throwIfAborted()
    await this.withInteractiveOrigins(cellId, input, signal, async () => {})
  }
  async authorizeInteractiveExecution(cellId: string, input: unknown, signal: AbortSignal): Promise<void> {
    validateNativeExecutionInput(input); signal.throwIfAborted()
    await this.withInteractiveOrigins(cellId, input, signal, (db, principal) => Publications.authorizeExecution(db, principal, input), input.presetId,
      input.skills.map(skill => skill.publicationId))
  }
  /** Current connection eligibility, not login/turn/tool permission. Both the
   * private pin and exact approval are read in the existing tenant transaction.
   * Native callers must still own this version and maintain a live lifecycle;
   * this reply must never be persisted as a reusable authorization. */
  async readConnectorApproval(cellId: string, input: unknown, signal: AbortSignal): Promise<number> {
    validateNativeConnectorApprovalInput(input); signal.throwIfAborted()
    const selected = structuredClone(input), cell = this.privateCells.get(cellId)
    if (!cell) throw new EnterpriseError(403, 'runtime-cell-denied', '运行单元未获准入')
    const revision = await this.identity.readRuntimeAccount({ tenantId: cell.tenantId, userId: cell.userId, role: cell.role }, randomUUID(),
      db => this.currentConnectorApproval(db, cell, selected.reference, selected.expectedApprovalRevision, signal))
    this.assertPrivateCell(cell); signal.throwIfAborted()
    return revision
  }
  /** Every use checks signed current login origins, original publication/skill
   * eligibility and the exact approval revision in one revocation transaction.
   * Neither the wire reference nor an earlier approval read proves native tool
   * provenance: the original native dispatch guard remains mandatory. */
  async authorizeConnectorExecution(cellId: string, input: unknown, signal: AbortSignal): Promise<void> {
    validateNativeConnectorExecutionInput(input); signal.throwIfAborted()
    const selected = structuredClone(input), cell = this.privateCells.get(cellId)
    if (!cell) throw new EnterpriseError(403, 'runtime-cell-denied', '运行单元未获准入')
    const execution = selected.execution
    await this.withInteractiveOrigins(cellId, execution, signal, async (db, principal) => {
      await this.currentConnectorApproval(db, cell, selected.reference, selected.approvalRevision, signal)
      await Publications.authorizeExecution(db, principal, execution)
      await this.currentConnectorApproval(db, cell, selected.reference, selected.approvalRevision, signal)
    }, execution.presetId, execution.skills.map(skill => skill.publicationId))
    this.assertPrivateCell(cell); signal.throwIfAborted()
  }
  private async currentConnectorApproval(db: TransactionSql, cell: PrivateRuntimeCell, reference: NativeConnectorReleaseReference,
    expectedRevision: number | null, signal: AbortSignal): Promise<number> {
    signal.throwIfAborted(); this.assertPrivateCell(cell)
    const [row] = await db<{ revision: number }[]>`select a.revision from haas.connector_approvals a
      join haas.admitted_runtime_bindings b on b.cell_id=a.cell_id and b.tenant_id=a.tenant_id and b.user_id=a.target_user_id
      where a.tenant_id=${cell.tenantId} and a.target_user_id=${cell.userId} and a.entry_id=${reference.entryId}
        and a.configuration_version=${reference.configurationVersion} and a.server_name=${reference.serverName}
        and a.transport=${reference.transport} and a.decision='approved'
        and a.cell_id=${cell.cellId} and a.volume_name=${cell.volumeName} and a.image_id=${cell.imageId} and a.policy_digest=${cell.policyDigest}
        and b.revision=${cell.revision} and b.origin=${cell.origin} and b.container_id=${cell.containerId}
        and b.volume_name=${cell.volumeName} and b.image_id=${cell.imageId} and b.policy_digest=${cell.policyDigest}
        and b.isolation_mode='container-managed' and b.status='ready' and b.lease_expires_at>clock_timestamp()
        and not exists (select 1 from haas.connector_commands c where c.tenant_id=a.tenant_id
          and c.target_user_id=a.target_user_id and c.outcome='unconfirmed')`
    signal.throwIfAborted(); this.assertPrivateCell(cell)
    if (!row || expectedRevision !== null && row.revision !== expectedRevision) {
      throw new EnterpriseError(403, 'connector-use-denied', '连接器当前批准或运行环境已失效')
    }
    return row.revision
  }
  async deriveInteractiveOrigins(cellId: string, input: unknown, signal: AbortSignal): Promise<NativeOriginInput> {
    validateNativeDelegationInput(input); signal.throwIfAborted()
    const { targetSessionId, ...execution } = input
    const cell = this.privateCells.get(cellId)
    if (!cell) throw new EnterpriseError(403, 'runtime-cell-denied', '运行单元未获准入')
    const sources = await this.identity.deriveInteractiveOrigins(input.sources, randomUUID(), {
      tenantId: cell.tenantId, userId: cell.userId, role: cell.role, cellId: cell.cellId, nativeSessionId: input.nativeSessionId,
    }, targetSessionId, input.presetId, async (db, principals) => {
      await this.verifyCurrentOrigins(cell, db, principals, signal)
      await Publications.authorizeExecution(db, principals[0]!, execution)
      signal.throwIfAborted()
    }, input.skills.map(skill => skill.publicationId))
    signal.throwIfAborted()
    return { nativeSessionId: targetSessionId, sources }
  }
  private async verifyCurrentOrigins(cell: PrivateRuntimeCell, db: TransactionSql,
    principals: readonly RuntimeIdentity[], signal: AbortSignal): Promise<void> {
    for (const principal of principals) {
      signal.throwIfAborted()
      const grant = await this.current(principal, db)
      if (grant.transport !== 'private-cell' || grant.cellId !== cell.cellId || grant.revision !== cell.revision) {
        throw new EnterpriseError(403, 'runtime-cell-denied', '运行单元绑定已变化')
      }
    }
    signal.throwIfAborted()
  }
  async sealJobOrigins(cellId: string, input: unknown, signal: AbortSignal): Promise<NativeOriginInput> {
    validateNativeJobOriginInput(input); signal.throwIfAborted()
    const cell = this.privateCells.get(cellId)
    if (!cell) throw new EnterpriseError(403, 'runtime-cell-denied', '运行单元未获准入')
    const { nativeJobId, ...execution } = input
    const sources = await this.identity.sealJobOrigins(input.sources, randomUUID(), {
      tenantId: cell.tenantId, userId: cell.userId, role: cell.role, cellId: cell.cellId, nativeSessionId: input.nativeSessionId,
    }, nativeJobId, input.presetId, async (db, principals) => {
      await this.verifyCurrentOrigins(cell, db, principals, signal)
      await Publications.authorizeExecution(db, principals[0]!, execution)
      signal.throwIfAborted()
    }, input.skills.map(skill => skill.publicationId))
    signal.throwIfAborted()
    return { nativeSessionId: input.nativeSessionId, sources }
  }
  private async withInteractiveOrigins(cellId: string, input: NativeOriginInput, signal: AbortSignal,
    consume: (db: TransactionSql, principal: RuntimeIdentity) => Promise<void>, expectedPresetId?: string, expectedSkillIds?: readonly string[]): Promise<void> {
    const cell = this.privateCells.get(cellId)
    if (!cell) throw new EnterpriseError(403, 'runtime-cell-denied', '运行单元未获准入')
    await this.identity.withInteractiveOrigins(input.sources, randomUUID(), { tenantId: cell.tenantId, userId: cell.userId,
      role: cell.role, cellId: cell.cellId, nativeSessionId: input.nativeSessionId }, async (db, principals) => {
      await this.verifyCurrentOrigins(cell, db, principals, signal)
      await consume(db, principals[0]!)
      signal.throwIfAborted()
    }, expectedPresetId, expectedSkillIds)
    signal.throwIfAborted()
  }
  private async current(principal: RuntimeIdentity, db: Sql | TransactionSql = this.sql): Promise<RuntimeGrant> {
    const [row] = await db<{
      cell_id: string; revision: string; origin: string; role: string; valid_for_ms: number; isolation_mode: string
      container_id: string | null; image_id: string | null; volume_name: string | null; policy_digest: string | null
    }[]>`select b.cell_id, b.revision, b.origin, u.role, b.isolation_mode,
      b.container_id, b.image_id, b.volume_name, b.policy_digest,
      floor(extract(epoch from (least(b.lease_expires_at, s.expires_at) - clock_timestamp())) * 1000)::float8 as valid_for_ms
      from haas.admitted_runtime_bindings b join haas.users u using (tenant_id, user_id)
      join haas.tenants t using (tenant_id) join haas.login_sessions s using (tenant_id, user_id)
      where b.tenant_id = ${principal.account.tenantId} and b.user_id = ${principal.account.userId}
        and s.session_id = ${principal.sessionId} and s.revoked_at is null and s.expires_at > clock_timestamp()
        and u.status = 'active' and t.status = 'active' and b.status = 'ready'
        and b.lease_expires_at > clock_timestamp()`
    if (!row) throw new EnterpriseError(503, 'runtime-unavailable', '当前账户的运行环境尚未就绪', true)
    let transport: 'private-cell' | undefined
    if (row.isolation_mode === 'development-process') {
      if (row.role !== 'admin') throw new EnterpriseError(403, 'member-native-policy-pending', '成员运行权限尚未完成配置')
      if (!this.allowed.has(row.origin)) throw new EnterpriseError(503, 'runtime-unavailable', '当前账户的运行环境不可用', true)
    } else {
      const pin = this.privateCells.get(row.cell_id)
      if (row.isolation_mode !== 'container-managed' || !pin || pin.tenantId !== principal.account.tenantId
        || pin.userId !== principal.account.userId || pin.role !== row.role || pin.revision !== row.revision
        || pin.origin !== row.origin || pin.containerId !== row.container_id || pin.imageId !== row.image_id
        || pin.volumeName !== row.volume_name || pin.policyDigest !== row.policy_digest) {
        throw new EnterpriseError(503, 'runtime-unavailable', '当前账户的运行环境与受管配置不一致', true)
      }
      transport = 'private-cell'
    }
    if (!Number.isFinite(row.valid_for_ms) || row.valid_for_ms <= 0) {
      throw new EnterpriseError(503, 'runtime-unavailable', '当前账户的运行环境不可用', true)
    }
    developmentCellOrigin(row.origin, this.publicOrigin)
    return { cellId: row.cell_id, tenantId: principal.account.tenantId, userId: principal.account.userId,
      role: principal.account.role, revision: row.revision, origin: row.origin, validForMs: Math.min(row.valid_for_ms, 86_400_000),
      ...(transport ? { transport } : {}) }
  }
}
