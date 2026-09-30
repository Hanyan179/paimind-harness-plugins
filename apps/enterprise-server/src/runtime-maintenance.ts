import { createHash, randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import { EnterpriseError, record, text, uuid } from './errors.js'

export interface MaintenanceRequest {
  operationId: string; requestId: string; tenantId: string; userId: string; cellId: string
  expectedRevision: string; expectedOrigin: string; reason: 'maintenance' | 'storage-recovery' | 'image-change'
}
export interface RuntimeMaintenanceFence {
  operationId: string; tenantId: string; userId: string; cellId: string; revision: string; origin: string
  replayed: boolean
}
interface BindingRow {
  cell_id: string; tenant_id: string; user_id: string; revision: string; origin: string; status: string
  expired: boolean
}
interface MaintenanceRow {
  operation_id: string; cell_id: string; tenant_id: string; user_id: string; fenced_revision: string
  origin: string; request_digest: string
}
function conflict(): never { throw new EnterpriseError(409, 'runtime-maintenance-conflict', '运行绑定已变化，请回读后再执行维护') }
const projection = (row: MaintenanceRow, replayed: boolean): RuntimeMaintenanceFence => Object.freeze({
  operationId: row.operation_id, tenantId: row.tenant_id, userId: row.user_id, cellId: row.cell_id,
  revision: row.fenced_revision, origin: row.origin, replayed,
})
function requireSameFence(binding: BindingRow | undefined, receipt: MaintenanceRow): void {
  if (!binding || binding.cell_id !== receipt.cell_id || binding.tenant_id !== receipt.tenant_id
    || binding.user_id !== receipt.user_id || binding.origin !== receipt.origin
    || binding.revision !== receipt.fenced_revision || binding.status !== 'suspended' || !binding.expired) conflict()
}

/** Internal operator database boundary, deliberately absent from HTTP routes.
 * Use a separate operator connection, never the gateway's runtime role. Commit
 * suspension, revision invalidation, expired lease, receipt and audit together
 * BEFORE stopping a cell or touching its volume. Failures never reopen ingress.
 * This is an admission fence, not proof that old writers have terminated.
 */
export class RuntimeMaintenance {
  constructor(private readonly sql: Sql) {}

  async suspend(input: MaintenanceRequest): Promise<RuntimeMaintenanceFence> {
    record(input, ['operationId', 'requestId', 'tenantId', 'userId', 'cellId', 'expectedRevision', 'expectedOrigin', 'reason'])
    const request = { operationId: uuid(input.operationId), tenantId: text(input.tenantId, 1, 160),
      userId: uuid(input.userId), cellId: uuid(input.cellId), expectedRevision: uuid(input.expectedRevision),
      expectedOrigin: text(input.expectedOrigin, 1, 512), reason: input.reason }
    const requestId = uuid(input.requestId)
    if (!['maintenance', 'storage-recovery', 'image-change'].includes(request.reason)) conflict()
    const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    return this.sql.begin(async db => {
      const [binding] = await db<BindingRow[]>`select cell_id, tenant_id, user_id, revision, origin, status,
        lease_expires_at <= clock_timestamp() as expired from haas.runtime_bindings
        where cell_id = ${request.cellId} for update`
      if (!binding || binding.tenant_id !== request.tenantId || binding.user_id !== request.userId
        || binding.origin !== request.expectedOrigin) conflict()
      const [previous] = await db<MaintenanceRow[]>`select * from haas.runtime_maintenance where operation_id = ${request.operationId}`
      if (previous) {
        if (previous.request_digest !== digest) conflict()
        requireSameFence(binding, previous)
        return projection(previous, true)
      }
      if (binding.revision !== request.expectedRevision || binding.status !== 'ready') conflict()
      const revision = randomUUID()
      await db`update haas.runtime_bindings set status = 'suspended', revision = ${revision},
        lease_expires_at = least(lease_expires_at, clock_timestamp()) where cell_id = ${request.cellId}`
      const [receipt] = await db<MaintenanceRow[]>`insert into haas.runtime_maintenance
        (operation_id, cell_id, tenant_id, user_id, previous_revision, fenced_revision, origin, request_digest, reason, request_id)
        values (${request.operationId}, ${request.cellId}, ${request.tenantId}, ${request.userId}, ${request.expectedRevision},
          ${revision}, ${request.expectedOrigin}, ${digest}, ${request.reason}, ${requestId}) returning *`
      await db`insert into haas.audit_events (event_id, tenant_id, actor_user_id, action, outcome, request_id, target_id, reason)
        values (${randomUUID()}, ${request.tenantId}, null, 'runtime.maintenance.suspend', 'succeeded',
          ${requestId}, ${request.cellId}, ${request.reason})`
      return projection(receipt!, false)
    })
  }

  async requireSuspended(fence: RuntimeMaintenanceFence): Promise<void> {
    uuid(fence.operationId)
    const rows = await this.sql<(BindingRow & MaintenanceRow)[]>`select b.cell_id, b.tenant_id, b.user_id,
      b.revision, b.origin, b.status, b.lease_expires_at <= clock_timestamp() as expired,
      m.operation_id, m.fenced_revision, m.request_digest
      from haas.runtime_maintenance m join haas.runtime_bindings b on b.cell_id = m.cell_id
        and b.tenant_id = m.tenant_id and b.user_id = m.user_id and b.origin = m.origin
      where m.operation_id = ${fence.operationId}`
    const row = rows[0]
    if (!row || fence.cellId !== row.cell_id || fence.tenantId !== row.tenant_id || fence.userId !== row.user_id
      || fence.revision !== row.fenced_revision || fence.origin !== row.origin) conflict()
    requireSameFence(row, row)
  }

  async whileSuspended<T>(request: MaintenanceRequest,
    operation: (fence: RuntimeMaintenanceFence) => Promise<T>): Promise<T> {
    const fence = await this.suspend(request)
    await this.requireSuspended(fence)
    try { return await operation(fence) }
    finally { await this.requireSuspended(fence) }
    // No finally-resume: completed maintenance still needs a fresh independently
    // verified runtime admission. Old origin/revision/lease cannot be revived.
  }
}
