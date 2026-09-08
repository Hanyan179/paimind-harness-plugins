import { Component, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { markHarnessClientStyle, contributePaimindExtension, type HarnessRemoteResult, type HarnessRemoteMountService, type PaimindClientContext } from '@hansen/harness-compat'
import { PaimindConnectionIcon } from '@hansen/harness-compat/client-icons'
import { PaimindProductSurfaceController, resolvePaimindProductCenterHost, installPaimindProductCenterHost, installPaimindProductSurfaceInteraction, type PaimindProductCenterHost } from '@hansen/harness-compat/client-surface'
import TYPERT_REMOTE from '../remote.js'
import type { McpConfiguration, McpConnectionView, McpManagement, McpTemplate } from '../contract.js'

export type McpRemoteApi = { [K in keyof McpManagement]: (...args: Parameters<McpManagement[K]>) => Promise<HarnessRemoteResult<Awaited<ReturnType<McpManagement[K]>>>> }
export async function mcpResult<T>(request: Promise<HarnessRemoteResult<T>>): Promise<T> { const result = await request; if (!result.ok) throw new Error(result.error.message); return result.value }

export const name = 'paimind-mcp-center-client'
export const inject = ['slots', 'remote', 'locale']
const STYLE_ID = 'paimind-mcp-center-style'
const STYLE = `
[data-paimind-product-surface=mcp-center]{position:absolute;inset:0;z-index:80;overflow:auto;pointer-events:auto;background:var(--dsw-alias-bg-base,#f4f7fb)}
button[data-paimind-product-trigger=mcp-center]{width:calc(100% + 8px);min-height:34px;margin:4px -4px;padding:6px 10px;display:flex;align-items:center;gap:8px;border:0;border-radius:12px;color:inherit;background:transparent;font:inherit;font-size:14px;cursor:pointer}
button[data-paimind-product-trigger=mcp-center]:hover,button[data-paimind-product-trigger=mcp-center][aria-current=page]{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
button[data-paimind-product-trigger=mcp-center][data-wide=false]{width:36px;height:36px;margin:8px 0;padding:0;justify-content:center;border-radius:50%}
[data-mcp-center]{max-width:1120px;margin:auto;padding:32px 28px;color:var(--dsw-alias-label-primary,#242833);font:14px/1.6 system-ui,sans-serif}
[data-mcp-center] *{box-sizing:border-box}[data-mcp-center] h2{font-size:26px;letter-spacing:-.7px;margin:0}[data-mcp-center] h3{margin:0;font-size:17px}
[data-mcp-center] p{color:var(--dsw-alias-label-secondary,#6b7280);margin:6px 0 18px}[data-mcp-center] button{font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l1,#d9dce2);border-radius:9px;padding:7px 13px;background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;min-height:38px}
[data-mcp-center] button:disabled{opacity:.45;cursor:wait}[data-mcp-center] button[data-primary]{background:var(--dsw-alias-state-business-primary,#5265df);color:white;border-color:transparent}
[data-mcp-center] input,[data-mcp-center] select,[data-mcp-center] textarea{width:100%;border:1px solid var(--dsw-alias-border-l1,#d9dce2);border-radius:8px;padding:9px 11px;background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;font:inherit;min-height:40px}
[data-mcp-center] textarea{font-family:ui-monospace,monospace;font-size:12px;resize:vertical}[data-mcp-center] label{display:grid;gap:5px;margin-bottom:12px;font-size:13px}
[data-mcp-center] :focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#5265df);outline-offset:3px}
[data-mcp-header],[data-mcp-actions]{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}[data-mcp-toolbar]{display:grid;grid-template-columns:minmax(160px,1fr) 150px 150px;gap:10px;margin:22px 0}
[data-mcp-list]{display:grid;gap:12px}[data-mcp-card]{border:1px solid var(--dsw-alias-border-l1,#e0e3e8);border-radius:14px;padding:20px;background:var(--dsw-alias-bg-layer-2,white)}
[data-mcp-meta]{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);margin:8px 0 14px}
[data-mcp-status]{border-radius:6px;padding:2px 8px;background:var(--dsw-alias-bg-layer-1,#f0f2f7)}[data-mcp-status=available]{background:#e7f4ed;color:#236440}[data-mcp-status=error]{background:#fff0ee;color:#ae3b32}
[data-mcp-panel]{border:1px solid var(--dsw-alias-border-l1,#dfe2e8);border-radius:16px;padding:24px;margin:20px 0;background:var(--dsw-alias-bg-layer-2,white)}
[data-mcp-grid]{display:grid;grid-template-columns:1fr 1fr;gap:14px}[data-mcp-empty]{text-align:center;padding:64px 20px;border:1px dashed var(--dsw-alias-border-l1,#dce0e9);border-radius:14px}
[data-mcp-tools]{padding:0;list-style:none;max-height:330px;overflow:auto}[data-mcp-tools] li{padding:12px 0;border-top:1px solid var(--dsw-alias-border-l1,#eee)}[data-mcp-tools] code{overflow-wrap:anywhere}[data-mcp-tools] p{font-size:12px;margin:4px 0}
[data-mcp-center] [role=alert]{color:#b63d33;border-radius:8px;padding:10px 12px;background:#fff2f0;margin:12px 0}[data-mcp-destination]{overflow-wrap:anywhere;font-family:ui-monospace,monospace;font-size:12px}
@media(max-width:680px){[data-mcp-center]{padding:20px 12px}[data-mcp-toolbar],[data-mcp-grid]{grid-template-columns:1fr}[data-mcp-panel]{padding:16px}[data-mcp-actions]{justify-content:flex-start}[data-mcp-card]{padding:16px}}
`
const categories = { documents: '文档协作', development: '开发工具', data: '数据服务', other: '其他' }
const states = { disabled: '已停用', untested: '待测试', available: '工具可用', error: '需要处理' }
const initial = (): McpConfiguration => ({ id: crypto.randomUUID().replaceAll('-', ''), name: '', category: 'other', enabled: true, timeoutMs: 60_000, transport: 'stdio', command: '', args: [], cwd: '', envRefs: {} })

export function McpCenterSection({ api, close }: { readonly api: McpRemoteApi; readonly close?: () => void }): React.JSX.Element {
  const [items, setItems] = useState<McpConnectionView[]>([])
  const [templates, setTemplates] = useState<McpTemplate[]>([]), [setupHint, setSetupHint] = useState('')
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [query, setQuery] = useState(''), [category, setCategory] = useState('all'), [state, setState] = useState('all')
  const [draft, setDraft] = useState<McpConfiguration | null>(null), [revision, setRevision] = useState(0)
  const [argsText, setArgsText] = useState('[]'), [refsText, setRefsText] = useState('{}')
  const [detail, setDetail] = useState<string | null>(null), [removing, setRemoving] = useState<McpConnectionView | null>(null)
  const refresh = async (): Promise<void> => { setItems((await mcpResult(api.list())).items) }
  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => { try { const [result, presets] = await Promise.all([mcpResult(api.list()), mcpResult(api.templates()).catch(() => ({ items: [] as McpTemplate[] }))]); if (alive) { setItems(result.items); setTemplates(presets.items) } } catch (failure) { if (alive) setError(String(failure)) } finally { if (alive) setLoading(false) } }
    void load(); const timer = setInterval(() => { void load() }, 5000)
    return () => { alive = false; clearInterval(timer) }
  }, [api])
  const act = async (operation: () => Promise<unknown>): Promise<void> => { setBusy(true); setError(''); try { await operation(); await refresh() } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) } finally { setBusy(false) } }
  const edit = (view?: McpConnectionView): void => {
    const config = view?.connection.configuration ?? initial()
    setSetupHint(''); setDraft(config); setRevision(view?.connection.revision ?? 0); setArgsText(JSON.stringify(config.transport === 'stdio' ? config.args : [], null, 2)); setRefsText(JSON.stringify(config.transport === 'stdio' ? config.envRefs : config.headerRefs, null, 2)); setError('')
  }
  const template = (preset: McpTemplate): void => {
    const configuration = { ...preset.configuration, id: initial().id, name: preset.name }
    setDraft(configuration); setSetupHint(preset.setupHint ?? '')
    setArgsText(JSON.stringify(configuration.transport === 'stdio' ? configuration.args : [], null, 2))
    setRefsText(JSON.stringify(configuration.transport === 'stdio' ? configuration.envRefs : configuration.headerRefs, null, 2)); setRevision(0)
  }
  const save = async (): Promise<void> => {
    if (!draft) return
    const configuration: McpConfiguration = draft.transport === 'stdio' ? { ...draft, args: JSON.parse(argsText) as string[], envRefs: JSON.parse(refsText) as Record<string, string> } : { ...draft, headerRefs: JSON.parse(refsText) as Record<string, string> }
    await mcpResult(api.save({ configuration, expectedRevision: revision })); setDraft(null)
  }
  const visible = items.filter(item => {
    const config = item.connection.configuration
    return config.name.toLowerCase().includes(query.toLowerCase()) && (category === 'all' || config.category === category) && (state === 'all' || item.state === state)
  })
  return <section data-mcp-center aria-label="连接中心">
    <header data-mcp-header><div><h2>连接中心</h2><p>连接你的工具，交给需要它们的助手。</p></div><div data-mcp-actions>{templates.map(preset => <button key={preset.id} disabled={busy} title={preset.description} onClick={() => { template(preset) }}>连接{preset.name}</button>)}<button data-primary disabled={busy} onClick={() => { edit() }}>添加连接</button>{close && <button aria-label="关闭连接中心" onClick={close}>返回对话</button>}</div></header>
    {error && <div role="alert">{error}<button onClick={() => { void act(refresh) }}>重试</button></div>}
    {draft && <form data-mcp-panel aria-label="连接配置" onSubmit={event => { event.preventDefault(); void act(save) }}>
      <div data-mcp-header><h3>{revision === 0 ? '添加连接' : '编辑连接'}</h3><button type="button" onClick={() => { setDraft(null) }}>关闭</button></div>
      <p>保存后，到智能体中心为助手选择此连接。账号授权由对应工具管理。</p>{setupHint && <p>{setupHint}</p>}
      <div data-mcp-grid><label>连接名称<input required value={draft.name} onChange={event => { setDraft({ ...draft, name: event.target.value }) }} /></label><label>用途分类<select value={draft.category} onChange={event => { setDraft({ ...draft, category: event.target.value as McpConfiguration['category'] }) }}>{Object.entries(categories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
      <label>连接方式<select value={draft.transport} onChange={event => { const { id, name, category, enabled, timeoutMs } = draft; setDraft(event.target.value === 'stdio' ? { id, name, category, enabled, timeoutMs, transport: 'stdio', command: '', args: [], cwd: '', envRefs: {} } : { id, name, category, enabled, timeoutMs, transport: 'streamable-http', url: '', headerRefs: {} }); setRefsText('{}'); setSetupHint('') }}><option value="stdio">本机程序</option><option value="streamable-http">远程服务</option></select></label>
      {draft.transport === 'stdio' ? <><label>启动程序<input required value={draft.command} onChange={event => { setDraft({ ...draft, command: event.target.value }) }} /></label><label>工作目录<input required value={draft.cwd} onChange={event => { setDraft({ ...draft, cwd: event.target.value }) }} /></label><label>启动参数（JSON 数组）<textarea rows={5} value={argsText} onChange={event => { setArgsText(event.target.value) }} /></label></> : <label>服务地址<input required type="url" value={draft.url} onChange={event => { setDraft({ ...draft, url: event.target.value }) }} /></label>}
      <details><summary>高级配置</summary><label>{draft.transport === 'stdio' ? '环境变量 → 宿主凭证引用（JSON）' : '请求头 → 宿主凭证引用（JSON）'}<textarea rows={3} value={refsText} onChange={event => { setRefsText(event.target.value) }} /></label><p>只填写已有凭证的引用名称，例如 {'{"Authorization":"MCP_AUTH_HEADER"}'}。</p><label>调用超时（毫秒）<input type="number" min={1000} max={120000} value={draft.timeoutMs} onChange={event => { setDraft({ ...draft, timeoutMs: Number(event.target.value) }) }} /></label></details>
      <div data-mcp-actions><button type="button" disabled={busy} onClick={() => { setDraft(null) }}>取消</button><button data-primary disabled={busy}>保存连接</button></div>
    </form>}
    <div data-mcp-toolbar><input type="search" aria-label="搜索连接" placeholder="搜索连接名称" value={query} onChange={event => { setQuery(event.target.value) }} /><select aria-label="按用途筛选" value={category} onChange={event => { setCategory(event.target.value) }}><option value="all">全部用途</option>{Object.entries(categories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><select aria-label="按状态筛选" value={state} onChange={event => { setState(event.target.value) }}><option value="all">全部状态</option>{Object.entries(states).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
    {loading ? <div data-mcp-empty aria-busy="true">正在读取连接…</div> : visible.length === 0 ? <div data-mcp-empty><h3>{items.length ? '没有匹配的连接' : '从第一条连接开始'}</h3><p>{items.length ? '调整名称、用途或状态筛选。' : '添加本地工具或远程服务，测试通过后再绑定给助手。'}</p></div> : <div data-mcp-list>{visible.map(view => { const config = view.connection.configuration; const identity = { id: config.id, expectedRevision: view.connection.revision }; return <article data-mcp-card key={config.id}>
      <div data-mcp-header><h3>{config.name}</h3><span data-mcp-status={view.state}>{states[view.state]}</span></div>
      <div data-mcp-meta><span>{categories[config.category]}</span><span>·</span><span>{config.transport === 'stdio' ? '当前宿主电脑' : '远程服务'}</span><span>·</span><span>{view.tools.length} 个工具</span><span>·</span><span>{view.bindings.length} 个助手引用</span></div>
      <div data-mcp-actions><div data-mcp-actions><button disabled={busy || !config.enabled} onClick={() => { void act(async () => { await mcpResult(api.probe(identity)) }) }}>测试连接</button><button disabled={busy} onClick={() => { edit(view) }}>编辑</button><button aria-expanded={detail === config.id} onClick={() => { setDetail(detail === config.id ? null : config.id) }}>查看详情</button></div><div data-mcp-actions><button disabled={busy} onClick={() => { void act(async () => { await mcpResult(api.setEnabled({ ...identity, enabled: !config.enabled })) }) }}>{config.enabled ? '停用' : '启用并测试'}</button><button disabled={busy} onClick={() => { setRemoving(view) }}>移除</button></div></div>
      {detail === config.id && <div><p data-mcp-destination>{config.transport === 'stdio' ? `${config.command} · ${config.cwd}` : config.url}</p><p>连接测试：{view.probe ? `${new Date(view.probe.at).toLocaleString()} · ${view.probe.message}` : '尚未测试'}</p><p>最近工具调用：{view.business ? `${new Date(view.business.at).toLocaleString()} · ${view.business.message}` : '尚无真实调用证据'}</p><p>引用助手：{view.bindings.map(binding => binding.name).join('、') || '无'}</p><ul data-mcp-tools>{view.tools.map(tool => <li key={tool.name}><code>{tool.name}</code><p>{tool.description}</p></li>)}</ul></div>}
    </article> })}</div>}
    {removing && <div data-mcp-panel role="alertdialog" aria-label="确认移除连接"><h3>移除「{removing.connection.configuration.name}」？</h3><p>{removing.bindings.length ? `这些助手将无法使用此连接：${removing.bindings.map(binding => binding.name).join('、')}。其他配置保留。` : '这条连接没有助手引用。'} 外部账号与数据不会被删除。</p><div data-mcp-actions><button onClick={() => { setRemoving(null) }}>取消</button><button disabled={busy} onClick={() => { void act(async () => { await mcpResult(api.removeConnection({ id: removing.connection.configuration.id, expectedRevision: removing.connection.revision, acknowledgeBindings: true })); setRemoving(null) }) }}>确认移除</button></div></div>}
  </section>
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  render(): ReactNode { return this.state.failed ? <p role="alert">连接中心暂时不可用，请重新打开。</p> : this.props.children }
}

interface SurfaceProps { readonly api: McpRemoteApi; readonly controller: PaimindProductSurfaceController }
function McpTrigger({ controller, wide }: { readonly controller: PaimindProductSurfaceController; readonly wide: boolean }): React.JSX.Element {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  return <button data-paimind-product-trigger="mcp-center" data-paimind-navigation-label="连接" data-paimind-navigation-description="接入外部服务与工具" data-paimind-navigation-group="能力与工具" data-wide={wide} aria-label="打开连接中心" aria-expanded={state.open} aria-current={state.open ? 'page' : undefined} onClick={event => { controller.toggle(event.currentTarget) }}><PaimindConnectionIcon size={wide ? 16 : 18} />{wide && <span>连接中心</span>}</button>
}
function McpSurface(props: SurfaceProps): ReactNode {
  const state = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot, props.controller.getSnapshot)
  return state.open ? <MountedMcpSurface {...props} /> : null
}
function MountedMcpSurface({ api, controller }: SurfaceProps): ReactNode {
  const [host, setHost] = useState<Readonly<PaimindProductCenterHost> | null>(null)
  const root = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const target = resolvePaimindProductCenterHost()
    const release = target === null ? null : installPaimindProductCenterHost(target)
    if (!target || !release) { controller.close(false); return }
    setHost(target); return release
  }, [controller])
  useEffect(() => { if (host && root.current) return installPaimindProductSurfaceInteraction(root.current, controller) }, [host, controller])
  return host === null ? null : createPortal(<main ref={root} data-paimind-product-surface="mcp-center" aria-label="连接中心"><McpCenterSection api={api} close={() => { controller.close() }} /></main>, host.mount)
}
interface McpClientContext extends PaimindClientContext {
  readonly remote: HarnessRemoteMountService & { readonly paimindMcpConnections?: McpRemoteApi }
  inject(services: readonly string[], install: (scope: McpClientContext) => void, label?: string): PromiseLike<unknown> & { dispose(): Promise<void> }
}
export async function apply(ctx: McpClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  ctx.effect(() => { const style = document.createElement('style'); style.id = STYLE_ID; style.textContent = STYLE; markHarnessClientStyle(style, '@hansen/mcp-center'); document.head.append(style); return () => { style.remove() } }, 'paimind-mcp-center: style')
  const mounted = ctx.inject([...inject, 'remote.paimindMcpConnections'], scope => {
  const api = scope.remote.paimindMcpConnections
  if (!api) throw new Error('Connection Center Remote did not mount')
  const controller = new PaimindProductSurfaceController('mcp-center')
  scope.effect(() => () => { controller.dispose() }, 'paimind-mcp-center: surface lifecycle')
  contributePaimindExtension(scope.slots, { id: 'paimind:mcp-center', packageName: '@hansen/mcp-center', nameZh: '连接中心', nameEn: 'MCP Center', descriptionZh: '管理个人工具连接，测试并绑定给助手。', descriptionEn: 'Manage, test, and bind personal tool connections.', category: 'skills-tools', surface: 'shell', maturity: 'technical-preview', order: 35 })
  scope.slots.inject('sidebar.footer.action', () => scope.slots.register({ name: 'sidebar.footer.action', id: 'paimind-mcp-center-trigger', order: -10, label: () => '连接中心', inject: () => ({ controller }) }, (props: { readonly wide: boolean; readonly controller: PaimindProductSurfaceController }) => <McpTrigger {...props} />))
  scope.slots.inject('shell.overlay', () => scope.slots.register({ name: 'shell.overlay', id: 'paimind-mcp-center-surface', order: 12, inject: () => ({ api, controller }) }, (props: SurfaceProps) => <Boundary><McpSurface {...props} /></Boundary>))
  scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'paimind-mcp-center', order: 35, label: () => '连接中心', inject: () => ({ api }) }, props => <Boundary><McpCenterSection {...props as { api: McpRemoteApi }} /></Boundary>))
  })
  try { await mounted } catch (error) { await disposeRemote(); throw error }
  return async () => { await mounted.dispose(); await disposeRemote() }
}
