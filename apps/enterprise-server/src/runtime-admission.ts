import { randomUUID } from 'node:crypto'
import type { Sql, TransactionSql } from 'postgres'
import { validatePrivateRuntimeCell, type PrivateRuntimeCell } from './runtime-bindings.js'
import { verifyRuntimeResources, type RuntimeResources } from './runtime-resources.js'

/** Operator-only lease writer. No HTTP route or application-role grant. The
 * caller verifies the actual immutable container and native policy immediately
 * before each call. An expired/replaced/suspended lease is never revived.
 * Gateway admission and stopping/joining the runtime remain distinct actions.
 */
export class RuntimeAdmission {
  constructor(private readonly sql: Sql, private readonly publicOrigin: string,
    private readonly role: 'member' | 'admin' = 'member') {
    if (!['member', 'admin'].includes(role)) throw new Error('Unsupported operator runtime role')
  }
  private checked(cell: PrivateRuntimeCell): PrivateRuntimeCell {
    const pin = validatePrivateRuntimeCell(cell, this.publicOrigin)
    if (pin.role !== this.role) throw new Error(`This controller admits ${this.role} cells only`)
    return pin
  }

  async admit(cell: PrivateRuntimeCell, resources?: RuntimeResources): Promise<void> {
    const p = this.checked(cell)
    await this.sql.begin(async db => {
      const observed = await verifyRuntimeResources(db, p.tenantId, p.userId, resources)
      const users = await db`select u.user_id from haas.users u join haas.tenants t using (tenant_id)
        where u.tenant_id = ${p.tenantId} and u.user_id = ${p.userId} and u.role = ${this.role}
          and u.status = 'active' and t.status = 'active' for update of u, t`
      if (users.length !== 1) throw new Error(`Active ${this.role} required for runtime admission`)
      await db`insert into haas.runtime_bindings
        (cell_id, tenant_id, user_id, origin, revision, isolation_mode, status, lease_expires_at,
          container_id, image_id, volume_name, policy_digest, resource_observation, resources_observed_at)
        values (${p.cellId}, ${p.tenantId}, ${p.userId}, ${p.origin}, ${p.revision}, 'container-managed', 'ready',
          clock_timestamp() + interval '30 seconds', ${p.containerId}, ${p.imageId}, ${p.volumeName}, ${p.policyDigest},
          ${observed ? db.json({ ...observed }) : null}, ${observed ? new Date() : null})`
      await db`insert into haas.audit_events (event_id, tenant_id, actor_user_id, action, outcome, request_id, target_id, reason)
        values (${randomUUID()}, ${p.tenantId}, null, ${`runtime.${this.role}.admit`}, 'succeeded', ${randomUUID()}, ${p.cellId}, ${`isolated-${this.role}-acceptance`})`
    })
  }

  async renew(cell: PrivateRuntimeCell, resources?: RuntimeResources): Promise<void> {
    const p = this.checked(cell)
    await this.sql.begin(async db => {
      const observed = await verifyRuntimeResources(db, p.tenantId, p.userId, resources)
      const rows = await db`update haas.runtime_bindings b set lease_expires_at = clock_timestamp() + interval '30 seconds',
        resource_observation=${observed ? db.json({ ...observed }) : null}, resources_observed_at=${observed ? new Date() : null}
        from haas.users u, haas.tenants t where b.cell_id = ${p.cellId} and b.tenant_id = ${p.tenantId}
          and b.user_id = ${p.userId} and b.revision = ${p.revision} and b.origin = ${p.origin}
          and b.isolation_mode = 'container-managed' and b.container_id = ${p.containerId} and b.image_id = ${p.imageId}
          and b.volume_name = ${p.volumeName} and b.policy_digest = ${p.policyDigest}
          and b.resource_observation is not distinct from ${observed ? db.json({ ...observed }) : null}
          and b.status = 'ready' and b.lease_expires_at > clock_timestamp()
          and u.tenant_id = b.tenant_id and u.user_id = b.user_id and u.role = ${this.role} and u.status = 'active'
          and t.tenant_id = b.tenant_id and t.status = 'active' returning b.cell_id`
      if (rows.length !== 1) throw new Error('Member runtime lease withdrawn, expired or changed')
    })
  }

  async replaceSuspended(previous: PrivateRuntimeCell, cell: PrivateRuntimeCell, resources?: RuntimeResources,
    authorize?: (db: TransactionSql) => Promise<void>, lineageSource?: PrivateRuntimeCell): Promise<void> {
    const old = this.checked(previous), p = this.checked(cell)
    // Optional only for old operator consumers that do not yet establish
    // lineage: their replacement remains usable but cannot recover old commands.
    // The trusted caller supplies its ORIGINAL admitted pin only after stopping
    // and joining that writer, verifying exclusive volumes, and the new cell.
    const source = lineageSource && this.checked(lineageSource)
    if (source && Object.keys(old).some(key => key !== 'revision'
      && old[key as keyof PrivateRuntimeCell] !== source[key as keyof PrivateRuntimeCell])) {
      throw new Error('Replacement lineage must match the exact stopped original cell')
    }
    if (old.cellId !== p.cellId || old.tenantId !== p.tenantId || old.userId !== p.userId || old.volumeName !== p.volumeName
      || old.revision === p.revision || old.containerId === p.containerId) throw new Error('Invalid member runtime replacement')
    await this.sql.begin(async db => {
      const observed = await verifyRuntimeResources(db, p.tenantId, p.userId, resources)
      await authorize?.(db)
      const users = await db`select u.user_id from haas.users u join haas.tenants t using (tenant_id)
        where u.tenant_id = ${p.tenantId} and u.user_id = ${p.userId} and u.role = ${this.role}
          and u.status = 'active' and t.status = 'active' for update of u, t`
      if (users.length !== 1) throw new Error(`Active ${this.role} required for runtime admission`)
      const changed = await db`update haas.runtime_bindings set revision = ${p.revision}, origin = ${p.origin},
        container_id = ${p.containerId}, image_id = ${p.imageId}, policy_digest = ${p.policyDigest},
        status = 'ready', lease_expires_at = clock_timestamp() + interval '30 seconds',
        resource_observation=${observed ? db.json({ ...observed }) : null}, resources_observed_at=${observed ? new Date() : null}
        where cell_id = ${old.cellId} and tenant_id = ${old.tenantId} and user_id = ${old.userId}
          and revision = ${old.revision} and origin = ${old.origin} and container_id = ${old.containerId}
          and image_id = ${old.imageId} and volume_name = ${old.volumeName} and policy_digest = ${old.policyDigest}
          and isolation_mode = 'container-managed' and status = 'suspended' and lease_expires_at <= clock_timestamp()
        returning cell_id`
      if (changed.length !== 1) throw new Error('Member replacement requires the exact suspended binding')
      if (source) {
        const [capacity] = await db<{ count: number }[]>`select count(*)::int as count from haas.runtime_replacement_lineage where tenant_id=${p.tenantId}`
        if (capacity!.count >= 10000) throw new Error('Runtime replacement lineage capacity reached; preserve history')
        await db`insert into haas.runtime_replacement_lineage
          (tenant_id,user_id,cell_id,source_revision,target_revision,suspended_revision,source_pin,target_pin)
          values (${p.tenantId},${p.userId},${p.cellId},${source.revision},${p.revision},${old.revision},
            ${db.json({...source})},${db.json({...p})})`
      }
      await db`insert into haas.audit_events (event_id, tenant_id, actor_user_id, action, outcome, request_id, target_id, reason)
        values (${randomUUID()}, ${p.tenantId}, null, ${`runtime.${this.role}.replace`}, 'succeeded', ${randomUUID()}, ${p.cellId}, ${`isolated-${this.role}-acceptance`})`
    })
  }

  async suspend(cell: PrivateRuntimeCell): Promise<boolean> {
    const p = this.checked(cell)
    return this.sql.begin(async db => {
      const rows = await db`update haas.runtime_bindings set status = 'suspended', revision = ${randomUUID()},
        lease_expires_at = least(lease_expires_at, clock_timestamp())
        where cell_id = ${p.cellId} and tenant_id = ${p.tenantId} and user_id = ${p.userId}
          and revision = ${p.revision} and origin = ${p.origin} and container_id = ${p.containerId}
          and image_id = ${p.imageId} and volume_name = ${p.volumeName} and policy_digest = ${p.policyDigest}
          and isolation_mode = 'container-managed' returning cell_id`
      if (rows.length === 0) return false // Never touch a replacement or maintenance fence.
      await db`insert into haas.audit_events (event_id, tenant_id, actor_user_id, action, outcome, request_id, target_id, reason)
        values (${randomUUID()}, ${p.tenantId}, null, ${`runtime.${this.role}.suspend`}, 'succeeded', ${randomUUID()}, ${p.cellId}, 'controller-withdrawn')`
      return true
    })
  }
}
