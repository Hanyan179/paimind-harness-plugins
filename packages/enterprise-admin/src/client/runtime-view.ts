// Browser projections are observations only, never runtime authority or storage.
export interface ResourcePolicy { revision: number; desiredState: 'running' | 'suspended'; cpuMillis: number; memoryMiB: number; pidsLimit: number }
export interface RuntimeState {
  targetUserId: string; targetName: string; desired: ResourcePolicy; enforcement: 'operator-observed' | 'unconfirmed';
  runtime: null | { cellId: string; cellRevision: string; bindingState: string; leaseValid: boolean; policyMatches: boolean;
    observed: ResourcePolicy | null; observedAt: string | null; physicalStop: 'not-observed' }
}
export interface RecoveryReceipt { requestId: string; targetUserId: string; outcome: 'queued' | 'executing' | 'applied' | 'rejected' | 'unconfirmed'; acceptedResourceRevision: number }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('运行管理响应格式无效')
  return value as Record<string, unknown>
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
function id(value: unknown): string { if (typeof value !== 'string' || !uuid.test(value)) throw Error('运行管理编号无效'); return value }
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw Error('运行资源范围无效')
  return value
}
export function resourcePolicy(value: unknown): ResourcePolicy {
  const row = object(value)
  if (!['running', 'suspended'].includes(String(row.desiredState))) throw Error('运行目标无效')
  return { revision: integer(row.revision, 0, 2147483647), desiredState: row.desiredState as ResourcePolicy['desiredState'],
    cpuMillis: integer(row.cpuMillis, 100, 1000), memoryMiB: integer(row.memoryMiB, 256, 1024), pidsLimit: integer(row.pidsLimit, 32, 256) }
}
export function runtimeState(value: unknown, target: string): RuntimeState {
  const row = object(value)
  if (row.targetUserId !== target || typeof row.targetName !== 'string' || !row.targetName || row.targetName.length > 120
    || !['operator-observed', 'unconfirmed'].includes(String(row.enforcement)) || row.persistentStorageQuota !== 'not-enforced') throw Error('运行状态与所选成员不匹配')
  let runtime: RuntimeState['runtime'] = null
  if (row.runtime !== null) {
    const b = object(row.runtime)
    if (!['ready', 'suspended', 'failed', 'starting'].includes(String(b.bindingState)) || typeof b.leaseValid !== 'boolean' || typeof b.policyMatches !== 'boolean'
      || b.physicalStop !== 'not-observed' || b.observedAt !== null && (typeof b.observedAt !== 'string' || !Number.isFinite(Date.parse(b.observedAt)))) throw Error('运行观察格式无效')
    runtime = { cellId: id(b.cellId), cellRevision: id(b.cellRevision), bindingState: String(b.bindingState), leaseValid: b.leaseValid, policyMatches: b.policyMatches,
      observed: b.observed === null ? null : resourcePolicy(b.observed), observedAt: b.observedAt as string | null, physicalStop: 'not-observed' }
  }
  const desired = resourcePolicy(row.desired)
  if (row.enforcement === 'operator-observed' && (!runtime || runtime.bindingState !== 'ready' || !runtime.leaseValid || !runtime.policyMatches
    || JSON.stringify(runtime.observed) !== JSON.stringify(desired))) throw Error('资源生效观察自相矛盾')
  return { targetUserId: target, targetName: row.targetName, desired, runtime, enforcement: row.enforcement as RuntimeState['enforcement'] }
}
export function recoveryReceipt(value: unknown, target: string): RecoveryReceipt {
  const row = object(value)
  if (row.targetUserId !== target || !['queued', 'executing', 'applied', 'rejected', 'unconfirmed'].includes(String(row.outcome))
    || row.physicalStop !== 'operator-must-verify') throw Error('恢复请求与所选成员不匹配')
  const revision = integer(row.acceptedResourceRevision, 0, 2147483647)
  if (row.outcome === 'queued' || row.outcome === 'executing') { if (row.result !== null) throw Error('未完成请求不能带成功结果') }
  else {
    const result = object(row.result)
    if (row.outcome === 'applied') { id(result.cellRevision); if (result.effect !== 'verified-replacement' || result.resourceRevision !== revision) throw Error('恢复确认不匹配') }
    if (row.outcome === 'rejected' && (result.effect !== 'not-started' || result.code !== 'precondition-changed')) throw Error('恢复拒绝结果无效')
    if (row.outcome === 'unconfirmed' && (result.effect !== 'unknown' || result.retry !== 'operator-inspection-required')) throw Error('未知恢复结果不能推断成功')
  }
  return { requestId: id(row.requestId), targetUserId: target, outcome: row.outcome as RecoveryReceipt['outcome'], acceptedResourceRevision: revision }
}
export function recoveryState(value: unknown, target: string): RecoveryReceipt | null {
  const row = object(value)
  if (row.targetUserId !== target) throw Error('恢复记录与所选成员不匹配')
  return row.request === null ? null : recoveryReceipt(row.request, target)
}
export const recoveryLabels: Record<RecoveryReceipt['outcome'], string> = {
  queued: '请求已排队，尚未恢复。请明确读取后续结果，不要重复提交。',
  executing: '操作者正在恢复；当前结果尚未确认，不要重复提交。',
  applied: '该次替代运行单元已核验并完成网关确认；当前健康仍以新鲜运行观察为准。',
  rejected: '请求在执行前已拒绝，未开始恢复；请重新核对当前身份与资源策略。',
  unconfirmed: '恢复效果未知，禁止自动重试；须由操作者核查，不能认定已经回退。',
}
