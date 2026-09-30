/** Browser-only projections of /haas/v1. These values never establish authority. */
export interface AccountView {
  userId: string; tenantId: string; username: string; displayName: string
  role: 'admin' | 'member'; status: 'active' | 'disabled'
}
export interface AuditView {
  event_id: string; action: string; outcome: string; occurred_at: string
  actor_user_id: string | null; target_id: string | null; reason: string | null; request_id: string
}
export interface GroupView {
  groupId: string; name: string; status: 'active' | 'archived'; revision: number; memberIds: string[]
}
const canonicalUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
export function groupView(value: unknown): GroupView {
  const row = object(value)
  if (typeof row.groupId !== 'string' || !canonicalUuid.test(row.groupId)
    || typeof row.name !== 'string' || !row.name.length || row.name.length > 120 || row.name.trim() !== row.name
    || !['active', 'archived'].includes(String(row.status)) || typeof row.revision !== 'number'
    || !Number.isInteger(row.revision) || row.revision < 1 || row.revision > 2_147_483_647
    || !Array.isArray(row.memberIds) || row.memberIds.length > 500
    || row.memberIds.some(id => typeof id !== 'string' || !canonicalUuid.test(id))
    || new Set(row.memberIds).size !== row.memberIds.length) throw new Error('成员组响应格式无效')
  return { groupId: row.groupId, name: row.name, status: row.status as GroupView['status'], revision: row.revision, memberIds: [...row.memberIds] as string[] }
}
export function groupViews(value: unknown): GroupView[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error('成员组列表响应格式无效')
  const groups = value.map(groupView)
  if (new Set(groups.map(group => group.groupId)).size !== groups.length) throw new Error('成员组列表存在重复编号')
  return groups
}
export class ApiFailure extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('企业服务响应格式无效')
  return value as Record<string, unknown>
}
export function accountView(value: unknown): AccountView {
  const row = object(value)
  if (!['userId', 'tenantId', 'username', 'displayName'].every(key => typeof row[key] === 'string' && row[key] !== '')
    || !['admin', 'member'].includes(String(row.role)) || !['active', 'disabled'].includes(String(row.status))) {
    throw new Error('企业账户响应格式无效')
  }
  return row as unknown as AccountView
}
export function memberViews(value: unknown): AccountView[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('企业成员响应格式无效')
  return value.map(accountView)
}
export function auditViews(value: unknown): AuditView[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error('审计响应格式无效')
  return value.map(item => {
    const row = object(item)
    if (!['event_id', 'action', 'outcome', 'occurred_at', 'request_id'].every(key => typeof row[key] === 'string')
      || !['actor_user_id', 'target_id', 'reason'].every(key => row[key] === null || typeof row[key] === 'string')) {
      throw new Error('审计响应格式无效')
    }
    return row as unknown as AuditView
  })
}

export class EnterpriseApi {
  private readonly lifetime = new AbortController()
  onUnauthorized: () => void = () => {}
  constructor(private readonly transport: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  async request(path: string, method = 'GET', body?: object, key?: string, signal?: AbortSignal): Promise<unknown> {
    const adoption = /^\/publications\/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/adopt$/u.test(path)
    const skillRead = /^\/catalog\/skills(?:\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})?$/u.test(path)
    const skillAdopt = /^\/catalog\/skills\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/adoption$/u.test(path)
    const skillSubmit = path === '/admin/skill-publications' && method === 'POST'
    const memberContentRead = ['/admin/member-content', '/admin/model-state'].includes(path) && method === 'POST'
    const runtimeWrite = ['/admin/runtime-state', '/admin/runtime-resource-policy', '/admin/runtime-recovery-state', '/admin/runtime-recovery-requests'].includes(path) && method === 'POST'
    const runtimeRead = /^\/admin\/runtime-recovery-requests\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(path) && method === 'GET'
    const modelRead = /^\/admin\/model-commands\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(path) && method === 'GET'
    const instructionRoute = /^\/admin\/instruction-commands\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(path) && method === 'GET'
      || (['/admin/instruction-configuration','/admin/instruction-commands','/admin/instruction-command-state'].includes(path)
        || /^\/admin\/instruction-commands\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/resolve$/u.test(path)) && method === 'POST'
    const modelWrite = (['/admin/model-commands', '/admin/model-command-state'].includes(path)
      || /^\/admin\/model-commands\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/resolve$/u.test(path)) && method === 'POST'
    const connectorRead = /^\/admin\/connector-(?:activation-)?commands\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(path) && method === 'GET'
    const connectorWrite = (['/admin/connector-configuration', '/admin/connector-activation-state', '/admin/connector-commands', '/admin/connector-command-state',
      '/admin/connector-approval-state', '/admin/connector-approvals', '/admin/connector-activation-commands', '/admin/connector-activation-command-state'].includes(path)
      || /^\/admin\/connector-(?:activation-)?commands\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/resolve$/u.test(path)) && method === 'POST'
    const featureRead = /^\/admin\/feature-commands\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(path) && method === 'GET'
    const featureWrite = (['/admin/feature-packs/state', '/admin/feature-packs/preview', '/admin/feature-packs/approvals', '/admin/feature-packs/commands'].includes(path)
      || /^\/admin\/feature-commands\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/resume$/u.test(path)) && method === 'POST'
    const skillContent = /^\/(?:admin\/skill-publications|catalog\/skills)\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/content\/[1-9][0-9]{0,9}\/[a-f0-9]{64}\/(?:entries\/(?:0|[1-9][0-9]{0,4})|files\/(?:0|[1-9][0-9]{0,4})\/(?:0|[1-9][0-9]{0,8}))$/u.test(path)
    const skillAdminRead = /^\/admin\/skill-publications\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?:\/assignments)?$/u.test(path)
    const skillAdminWrite = /^\/admin\/skill-publications\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/(?:review|assignments)$/u.test(path)
    if (!(instructionRoute || runtimeWrite || runtimeRead || connectorRead || connectorWrite || modelRead || modelWrite || featureRead || featureWrite || memberContentRead || adoption && method === 'POST' || (skillRead || skillContent || skillAdminRead) && method === 'GET' || (skillAdopt || skillAdminWrite) && method === 'POST') && !/^\/(?:auth\/(?:me|logout)|catalog\/agents(?:\/[a-f0-9-]+)?|publications(?:\/[a-f0-9-]+)?|admin\/(?:audit|skill-publications|publications(?:\/[a-f0-9-]+\/(?:review|assignments))?|members(?:\/[a-f0-9-]+\/(?:status|name))?|groups(?:\/[a-f0-9-]+(?:\/status)?)?))$/u.test(path)
      || path === '/admin/skill-publications' && method !== 'GET' && !skillSubmit) {
      throw new Error('Unsupported enterprise plugin route')
    }
    if (method !== 'GET' && !key) throw new Error('A stable command key is required')
    const response = await this.transport(`/haas/v1${path}`, {
      method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(skillAdopt || skillSubmit ? 300_000 : skillContent ? 35_000 : 15_000), ...(signal ? [signal] : [])]),
      ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key! } } : {}),
    })
    if (response.status === 401) this.onUnauthorized()
    const result = object(await response.json())
    if (!response.ok) throw new ApiFailure(response.status, typeof result.title === 'string' ? result.title : '企业服务请求失败')
    if (!Object.hasOwn(result, 'data')) throw new Error('企业服务响应缺少数据')
    return result.data
  }
  dispose(): void { this.lifetime.abort(); this.onUnauthorized = () => {} }
}

export type SessionView = { status: 'loading' | 'unavailable' | 'signed-out' } | { status: 'ready'; account: AccountView }
/** In-memory current-identity projection only. No browser token/principal storage. */
export class EnterpriseSession {
  private value: SessionView = { status: 'loading' }
  private readonly listeners = new Set<() => void>()
  private disposed = false
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private checking: Promise<void> | undefined
  private started = false
  readonly getSnapshot = (): SessionView => this.value
  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  constructor(readonly api: EnterpriseApi) { api.onUnauthorized = () => this.invalidate() }
  private publish(value: SessionView): void {
    if (this.disposed) return
    this.value = value
    for (const listener of this.listeners) listener()
  }
  invalidate(): void { this.generation += 1; this.publish({ status: 'signed-out' }) }
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.checking) return this.checking
    const generation = this.generation
    this.checking = (async () => {
      try {
        const account = accountView(await this.api.request('/auth/me'))
        if (generation === this.generation) this.publish(account.status === 'active' ? { status: 'ready', account } : { status: 'signed-out' })
      } catch (error) {
        if (generation === this.generation) this.publish({ status: error instanceof ApiFailure && error.status === 401 ? 'signed-out' : 'unavailable' })
      } finally { this.checking = undefined }
    })()
    return this.checking
  }
  start(): void {
    if (this.started || this.disposed) return
    this.started = true
    const tick = async () => {
      // Do not repeatedly audit an already expired session. A new login loads
      // a fresh native client; explicit retry remains available in Settings.
      if (this.value.status !== 'signed-out') await this.refresh()
      if (!this.disposed) this.timer = setTimeout(() => { void tick() }, 5_000)
    }
    void tick()
  }
  dispose(): void {
    this.disposed = true; this.generation += 1
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.listeners.clear(); this.api.dispose()
  }
}
