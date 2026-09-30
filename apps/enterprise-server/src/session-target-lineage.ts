import { isDeepStrictEqual } from 'node:util'
import type { TransactionSql } from 'postgres'
import type { PrivateRuntimeCell, RuntimeGrant } from './runtime-bindings.js'
import { EnterpriseError } from './errors.js'

type Target = Omit<RuntimeGrant, 'validForMs'>
const conflict = () => new EnterpriseError(409, 'session-runtime-changed', '创建请求缺少准确的保数据替换链；不能转发到当前运行单元')
const targetOf = (pin: PrivateRuntimeCell): Target => ({ cellId: pin.cellId, tenantId: pin.tenantId, userId: pin.userId,
  role: pin.role, revision: pin.revision, origin: pin.origin, transport: 'private-cell' })
const identityKeys = ['cellId', 'tenantId', 'userId', 'role', 'volumeName', 'imageId', 'policyDigest'] as const

/** Original command target stays immutable. Only the existing deployment
 * owner's durable replacement edges can bridge it to a newly admitted cell.
 * No caller target, mutable alias, fallback volume or missing-edge inference. */
export async function verifySessionTargetLineage(db: TransactionSql, original: Target, current: Target): Promise<void> {
  if (isDeepStrictEqual(original, current)) return
  if (original.transport !== 'private-cell' || current.transport !== 'private-cell'
    || ['cellId', 'tenantId', 'userId', 'role'].some(key => original[key as keyof Target] !== current[key as keyof Target])) throw conflict()
  let cursor = original
  const seen = new Set<string>()
  for (let hop = 0; hop < 32; hop++) {
    if (seen.has(cursor.revision)) throw conflict()
    seen.add(cursor.revision)
    const [edge] = await db<{ source_pin: PrivateRuntimeCell; target_pin: PrivateRuntimeCell }[]>`
      select source_pin,target_pin from haas.runtime_replacement_lineage
      where tenant_id=${original.tenantId} and user_id=${original.userId} and cell_id=${original.cellId} and source_revision=${cursor.revision}`
    if (!edge || !isDeepStrictEqual(targetOf(edge.source_pin), cursor)
      || identityKeys.some(key => typeof edge.source_pin[key] !== 'string' || !edge.source_pin[key]
        || edge.source_pin[key] !== edge.target_pin[key])
      || edge.source_pin.containerId === edge.target_pin.containerId || edge.source_pin.revision === edge.target_pin.revision) throw conflict()
    cursor = targetOf(edge.target_pin)
    if (isDeepStrictEqual(cursor, current)) {
      const p = edge.target_pin
      const [admitted] = await db`select 1 from haas.admitted_runtime_bindings where cell_id=${p.cellId}
        and tenant_id=${p.tenantId} and user_id=${p.userId} and revision=${p.revision} and origin=${p.origin}
        and container_id=${p.containerId} and volume_name=${p.volumeName} and image_id=${p.imageId} and policy_digest=${p.policyDigest}
        and isolation_mode='container-managed' and status='ready' and lease_expires_at>clock_timestamp()`
      if (!admitted) throw conflict()
      return
    }
  }
  throw conflict() // Bounded chain, never silently accept a truncated history.
}
