import { createHash } from 'node:crypto'
import type { PaimindMcpAgent, PaimindMcpToolSummary, PaimindNativeMcpConfig, PaimindNativeMcpHandle } from '@paimind/harness-compat/native-mcp'
import { connectionSchema, connectionId, identityInputSchema, removeInputSchema, saveInputSchema, toggleInputSchema, sessionSummaryInputSchema,
  type McpConfiguration, type McpConnection, type McpConnectionRepository, type McpConnectionView,
  type McpEvidence, type McpIdentityInput, type McpOwnerResolver, type McpRemoveInput, type McpSaveInput, type McpToggleInput, type McpConnectionSummary } from './contract.js'

function connectionNamespace(id: string, agentId: string): string {
  return `paimind_${createHash('sha256').update(`${id}:${agentId}`).digest('hex').slice(0, 20)}`
}

export interface McpAgentReferenceSource {
  listProfiles(): Promise<{ readonly profiles: readonly { readonly presetId: string; readonly name: string; readonly connectionIds?: readonly string[] }[] }>
  connectionIdsForPreset(presetId: string): Promise<readonly string[]>
}
export interface McpRuntimeProjection {
  mount(agent: PaimindMcpAgent, config: PaimindNativeMcpConfig): Promise<PaimindNativeMcpHandle>
  probe(config: PaimindNativeMcpConfig): Promise<readonly PaimindMcpToolSummary[]>
  preset(agent: PaimindMcpAgent): string | undefined
  credential(reference: string): Promise<string>
}

/** Classify without echoing remote bodies, command output or credential values. */
function connectionFailure(error: unknown): string {
  const pending: unknown[] = [error], messages: string[] = []
  for (let index = 0; index < pending.length && index < 8; index++) {
    const item = pending[index]
    if (item instanceof Error) { messages.push(item.message); if (item.cause) pending.push(item.cause) }
    if (item && typeof item === 'object') {
      const detail = item as { code?: unknown; errors?: unknown }
      if (typeof detail.code === 'string') messages.push(detail.code)
      if (Array.isArray(detail.errors)) pending.push(...detail.errors.slice(0, 8))
    }
  }
  const reason = messages.join(' ')
  if (/ENOENT|not found|executable unavailable/i.test(reason)) return '未找到启动程序或工作目录，请检查本机路径。'
  if (/credential reference/i.test(reason)) return '宿主凭证引用不可用，请检查引用名称与宿主凭证配置。'
  if (/401|403|unauthori[sz]ed|forbidden|permission denied|EACCES|EPERM/i.test(reason)) return '授权或访问权限不足，请检查本地账号授权和目标服务权限。'
  if (/timeout|timed out|abort/i.test(reason)) return '连接超时或已取消，请检查服务运行状态与网络。'
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ECONNRESET|fetch failed/i.test(reason)) return '无法连接目标服务，请检查地址、端口与网络。'
  if (/certificate|TLS|SSL/i.test(reason)) return '安全连接校验失败，请检查服务证书。'
  return '协议连接失败，请检查程序是否提供 MCP 服务，以及账号配置是否有效。'
}

/** Configuration reconciliation, not an execution runtime. Native handles own every tool. */
export class McpConnectionManager {
  private readonly records = new Map<string, McpConnection>()
  private readonly probes = new Map<string, { evidence: McpEvidence; tools: readonly PaimindMcpToolSummary[] }>()
  private readonly business = new Map<string, McpEvidence>()
  private readonly live = new Map<PaimindMcpAgent, Map<string, { revision: number; fingerprint: string; handle: PaimindNativeMcpHandle }>>()
  private readonly allowed = new Map<PaimindMcpAgent, ReadonlySet<string>>()
  private readonly blocked = new Map<string, Set<symbol>>()
  private readonly namespaces = new Map<string, { id: string; agent: PaimindMcpAgent }>()
  private queue: Promise<unknown> = Promise.resolve()
  private active = true
  private readonly disposedAgents = new WeakSet<PaimindMcpAgent>()
  private readonly ready: Promise<void>
  readonly owner: string
  constructor(private readonly repository: McpConnectionRepository, owner: McpOwnerResolver,
    private readonly runtime: McpRuntimeProjection, private readonly references: () => McpAgentReferenceSource | undefined) {
    this.owner = owner.currentOwner()
    this.ready = repository.load(this.owner).then(rows => { for (const raw of rows) { const row = connectionSchema.parse(raw); if (row.owner !== this.owner) throw new Error('Connection owner mismatch'); this.records.set(row.configuration.id, row) } })
  }
  async prepare(): Promise<void> { await this.ready }
  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => { await this.ready; if (!this.active) throw new Error('Connection Center is unloaded'); return await operation() })
    this.queue = next.catch(() => {})
    return await next
  }
  private get(input: McpIdentityInput): McpConnection {
    const parsed = identityInputSchema.parse({ id: input.id, expectedRevision: input.expectedRevision })
    const row = this.records.get(parsed.id)
    if (row === undefined || row.owner !== this.owner) throw new Error('连接不存在或不属于当前用户')
    if (row.revision !== parsed.expectedRevision) throw new Error('连接已更新，请刷新后重试')
    return row
  }
  async validateSelection(ids: readonly string[]): Promise<void> {
    await this.ready
    for (const id of ids) if (!this.records.has(connectionId.parse(id))) throw new Error('所选连接不存在或不属于当前用户')
  }
  async list(): Promise<{ items: McpConnectionView[] }> {
    await this.ready
    return { items: await Promise.all([...this.records.values()].map(row => this.view(row))) }
  }
  async summarizeSession(raw: { sessionId: string }): Promise<{ items: McpConnectionSummary[] }> {
    const { sessionId } = sessionSummaryInputSchema.parse(raw)
    await this.ready
    if (!this.active) throw new Error('Connection Center is unloaded')
    const agent = [...this.live.keys()].find(candidate => candidate.id === sessionId)
    return { items: [...this.records.values()].map(({ configuration: config }) => ({
      id: config.id, name: config.name, server: connectionNamespace(config.id, sessionId), enabled: config.enabled,
      mounted: config.enabled && !this.blocked.has(config.id) && agent !== undefined
        && this.allowed.get(agent)?.has(config.id) === true
        && (this.live.get(agent)?.get(config.id)?.handle.tools().length ?? 0) > 0,
    })) }
  }
  private async view(row: McpConnection): Promise<McpConnectionView> {
    const id = row.configuration.id
    const profiles = await this.references()?.listProfiles()
    const probe = this.probes.get(id)
    const nativeTools = [...this.live.values()].map(handles => handles.get(id)?.handle.tools() ?? []).find(tools => tools.length > 0) ?? []
    const tools = [...new Map((nativeTools.length > 0 ? nativeTools : probe?.tools ?? []).map(tool => [tool.name, tool])).values()]
    return { connection: row, tools,
      state: !row.configuration.enabled ? 'disabled' : probe?.evidence.status === 'failed' ? 'error' : nativeTools.length > 0 || probe?.evidence.status === 'passed' ? 'available' : 'untested',
      probe: probe?.evidence ?? null, business: this.business.get(id) ?? null,
      bindings: (profiles?.profiles ?? []).filter(profile => profile.connectionIds?.includes(id)).map(profile => ({ presetId: profile.presetId, name: profile.name })),
    }
  }
  private async persist(next: Map<string, McpConnection>): Promise<void> {
    await this.repository.replace(this.owner, [...next.values()])
    this.records.clear(); for (const [id, row] of next) this.records.set(id, row)
  }
  async save(raw: McpSaveInput): Promise<McpConnectionView> {
    return await this.serialized(async () => {
      const input = saveInputSchema.parse(raw)
      const old = this.records.get(input.configuration.id)
      if ((old?.revision ?? 0) !== input.expectedRevision) throw new Error('连接已更新，请刷新后重试')
      if (old === undefined && this.records.size >= 100) throw new Error('最多保存 100 条连接')
      const row = { configuration: input.configuration, owner: this.owner, revision: input.expectedRevision + 1, updatedAt: Date.now() }
      const next = new Map(this.records); next.set(input.configuration.id, row)
      await this.persist(next)
      this.probes.delete(row.configuration.id); this.business.delete(row.configuration.id)
      await this.refreshLive()
      return await this.view(row)
    })
  }
  async setEnabled(raw: McpToggleInput): Promise<McpConnectionView> {
    const input = toggleInputSchema.parse(raw)
    const block = Symbol('pending disable')
    if (!input.enabled) {
      const requests = this.blocked.get(input.id) ?? new Set<symbol>()
      requests.add(block); this.blocked.set(input.id, requests)
    }
    try { return await this.serialized(async () => {
      const old = this.get(input)
      const row = { ...old, configuration: { ...old.configuration, enabled: input.enabled }, revision: old.revision + 1, updatedAt: Date.now() }
      const next = new Map(this.records); next.set(input.id, row)
      await this.persist(next) // gate changes before any asynchronous tool disposal
      this.probes.delete(input.id)
      await this.refreshLive()
      if (input.enabled) await this.probeRow(row)
      return await this.view(row)
    }) } finally {
      const requests = this.blocked.get(input.id)
      requests?.delete(block)
      if (requests?.size === 0) this.blocked.delete(input.id)
    }
  }
  async remove(raw: McpRemoveInput): Promise<{ removed: true }> {
    return await this.serialized(async () => {
      const input = removeInputSchema.parse(raw), row = this.get(input)
      if ((await this.view(row)).bindings.length && !input.acknowledgeBindings) throw new Error('此连接仍有智能体引用，请先确认影响范围')
      const next = new Map(this.records); next.delete(input.id)
      await this.persist(next); await this.refreshLive()
      this.probes.delete(input.id); this.business.delete(input.id)
      return { removed: true }
    })
  }
  async probe(input: McpIdentityInput): Promise<McpConnectionView> {
    return await this.serialized(async () => { const row = this.get(input); if (!row.configuration.enabled) throw new Error('请先启用连接'); await this.probeRow(row); return await this.view(row) })
  }
  private async probeRow(row: McpConnection): Promise<void> {
    try {
      const tools = await this.runtime.probe(await this.nativeConfiguration(row.configuration))
      this.probes.set(row.configuration.id, { tools, evidence: { at: Date.now(), status: 'passed', message: `协议握手成功，发现 ${tools.length} 个工具；未执行工具调用，具体操作权限尚待核验。` } })
    } catch (error) {
      this.probes.set(row.configuration.id, { tools: [], evidence: { at: Date.now(), status: 'failed', message: connectionFailure(error) } })
    }
  }
  private async nativeConfiguration(config: McpConfiguration, agent?: PaimindMcpAgent): Promise<PaimindNativeMcpConfig> {
    const values: Record<string, string> = {}
    for (const [name, reference] of Object.entries(config.transport === 'stdio' ? config.envRefs : config.headerRefs)) values[name] = await this.runtime.credential(reference)
    // Native MCP reserves namespaces across the whole app, even for scoped tools.
    const serverName = connectionNamespace(config.id, agent?.id ?? 'probe')
    if (agent) this.namespaces.set(serverName, { id: config.id, agent })
    const common = { serverName, toolCallTimeoutMs: config.timeoutMs }
    if (config.transport === 'streamable-http') return { ...common, transport: config.transport, url: config.url, headers: values }
    const env: Record<string, string> = {}
    for (const key of ['HOME', 'PATH', 'LANG', 'TMPDIR', 'USER', 'LOGNAME', 'XDG_CONFIG_HOME']) if (process.env[key] !== undefined) env[key] = process.env[key]!
    return { ...common, transport: config.transport, command: config.command, args: config.args, cwd: config.cwd, env: { ...env, ...values } }
  }
  async reconcile(agent: PaimindMcpAgent): Promise<void> {
    return await this.serialized(async () => { await this.reconcileNow(agent) })
  }
  private async reconcileNow(agent: PaimindMcpAgent): Promise<void> {
    if (!this.active || this.disposedAgents.has(agent)) return
    const preset = this.runtime.preset(agent)
    const ids = preset === undefined ? [] : await this.references()?.connectionIdsForPreset(preset) ?? []
    const selected = new Set(ids.filter(id => this.records.get(id)?.configuration.enabled === true))
    this.allowed.set(agent, selected)
    let handles = this.live.get(agent)
    if (handles === undefined) { handles = new Map(); this.live.set(agent, handles) }
    for (const [id, current] of handles) if (!selected.has(id) || current.revision !== this.records.get(id)?.revision) { handles.delete(id); await current.handle.dispose() }
    for (const id of selected) {
      const row = this.records.get(id)!
      try {
        // Resolve credential references again at each native assembly/step. A
        // rotated or removed value must not leave the old client usable.
        const configuration = await this.nativeConfiguration(row.configuration, agent)
        const fingerprint = createHash('sha256').update(JSON.stringify(configuration)).digest('hex')
        const previous = handles.get(id)
        if (previous?.fingerprint === fingerprint) continue
        if (previous) { handles.delete(id); await previous.handle.dispose() }
        const handle = await this.runtime.mount(agent, configuration)
        if (!this.active || this.disposedAgents.has(agent)) await handle.dispose()
        else handles.set(id, { revision: row.revision, fingerprint, handle })
      }
      catch (error) {
        selected.delete(id)
        const previous = handles.get(id); handles.delete(id)
        await previous?.handle.dispose()
        this.probes.set(id, { tools: [], evidence: { at: Date.now(), status: 'failed', message: connectionFailure(error) } })
      }
    }
  }
  private async refreshLive(): Promise<void> { for (const agent of this.live.keys()) await this.reconcileNow(agent) }
  async bindingsChanged(): Promise<void> { this.allowed.clear(); await this.serialized(async () => { await this.refreshLive() }) }
  /** Synchronous last-mile guard also protects requests queued before disable/unbind. */
  guard(name: string, agent?: PaimindMcpAgent): string | undefined {
    if (!name.startsWith('mcp__paimind_')) return undefined
    const namespace = /^mcp__(paimind_[a-f0-9]{20})__/.exec(name)?.[1]
    const entry = namespace === undefined ? undefined : this.namespaces.get(namespace)
    if (!this.active || !entry || this.blocked.has(entry.id) || !this.records.get(entry.id)?.configuration.enabled || agent !== entry.agent || !this.allowed.get(agent)?.has(entry.id)) return '此连接已停用、未绑定或不属于当前用户'
    return undefined
  }
  observe(name: string, success: boolean): void {
    const namespace = /^mcp__(paimind_[a-f0-9]{20})__/.exec(name)?.[1]
    const id = namespace === undefined ? undefined : this.namespaces.get(namespace)?.id
    if (id && this.records.has(id)) this.business.set(id, { at: Date.now(), status: success ? 'passed' : 'unknown', message: success ? '最近一次原生工具调用成功；不代表完整业务流程已验收。' : '最近一次原生工具调用失败；如操作可能产生修改，请先核对目标状态。' })
  }
  async disposeAgent(agent: PaimindMcpAgent): Promise<void> {
    this.disposedAgents.add(agent)
    this.allowed.delete(agent)
    const handles = this.live.get(agent); this.live.delete(agent)
    if (handles) for (const current of handles.values()) await current.handle.dispose()
  }
  async dispose(): Promise<void> {
    this.active = false; this.allowed.clear()
    await this.queue.catch(() => {})
    for (const agent of this.live.keys()) await this.disposeAgent(agent)
  }
}
