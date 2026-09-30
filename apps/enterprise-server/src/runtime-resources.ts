import type { Sql, TransactionSql } from 'postgres'
import { EnterpriseError, invalid, record } from './errors.js'

export interface RuntimeResources {
  revision: number; desiredState: 'running' | 'suspended'; cpuMillis: number; memoryMiB: number; pidsLimit: number
}
// Existing operator capacity ceiling, not a new tenant entitlement. Persistent
// volume capacity is intentionally absent until physical enforcement exists.
export const DEFAULT_RUNTIME_RESOURCES: Readonly<RuntimeResources> = Object.freeze({
  revision: 0, desiredState: 'running', cpuMillis: 1000, memoryMiB: 1024, pidsLimit: 256,
})
export function parseRuntimeResources(input: unknown): RuntimeResources {
  const row = record(input, ['revision', 'desiredState', 'cpuMillis', 'memoryMiB', 'pidsLimit'])
  for (const [key, min, max] of [['revision', 0, 2147483647], ['cpuMillis', 100, 1000],
    ['memoryMiB', 256, 1024], ['pidsLimit', 32, 256]] as const) {
    if (!Number.isSafeInteger(row[key]) || Number(row[key]) < min || Number(row[key]) > max) return invalid('运行配额超出当前部署容量范围')
  }
  if (!['running', 'suspended'].includes(String(row.desiredState))) return invalid('运行目标状态无效')
  return { revision: Number(row.revision), desiredState: row.desiredState as RuntimeResources['desiredState'],
    cpuMillis: Number(row.cpuMillis), memoryMiB: Number(row.memoryMiB), pidsLimit: Number(row.pidsLimit) }
}
export async function readRuntimeResources(db: Sql | TransactionSql, tenantId: string, userId: string): Promise<RuntimeResources> {
  const [row] = await db`select revision, desired_state, cpu_millis, memory_mib, pids_limit
    from haas.runtime_resource_policies where tenant_id=${tenantId} and user_id=${userId}`
  return row ? parseRuntimeResources({ revision: row.revision, desiredState: row.desired_state,
    cpuMillis: row.cpu_millis, memoryMiB: row.memory_mib, pidsLimit: row.pids_limit }) : { ...DEFAULT_RUNTIME_RESOURCES }
}
/** Operator only. Caller must inspect exact container limits immediately before
 * admission/renewal; the browser and database intent are not observations. */
export async function verifyRuntimeResources(db: TransactionSql, tenantId: string, userId: string,
  observed?: RuntimeResources): Promise<RuntimeResources | null> {
  await db`select pg_advisory_xact_lock(hashtextextended(${`haas:identity:${tenantId}`}, 0))`
  const current = await readRuntimeResources(db, tenantId, userId)
  // Preserve existing unmigrated observation semantics. Once a policy exists,
  // no legacy caller can admit or renew it without an exact fresh observation.
  if (!observed && current.revision === 0) return null
  if (!observed) throw new EnterpriseError(409, 'runtime-resource-mismatch', '缺少准确运行配额回读')
  const value = parseRuntimeResources(observed)
  if (current.desiredState !== 'running' || JSON.stringify(current) !== JSON.stringify(value)) {
    throw new EnterpriseError(409, 'runtime-resource-mismatch', '运行配额或目标状态已变化，须隔离旧单元并重新准入')
  }
  return value
}
