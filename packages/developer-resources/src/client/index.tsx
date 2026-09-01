import {
  Component,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import type { PaimindExtensionDescriptor } from '@paimind/contracts'
import {
  contributePaimindExtension,
  type HarnessPluginInventorySnapshot,
  type HarnessSettingsSectionOwnerProps,
  type PaimindDeveloperResourcesClientContext,
} from '@paimind/harness-compat'
import {
  PAIMIND_INTEGRATION_REFERENCES,
  paimindInventoryEntries,
  projectDeveloperSurface,
  summarizePaimindInventory,
  type DeveloperTechnicalState,
} from '../index.js'

export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']

const EXTENSION_SLOT = 'paimind.extension'
const STYLE_ID = '@paimind/developer-resources'
const SELF: PaimindExtensionDescriptor = {
  id: 'paimind:developer-resources', packageName: '@paimind/developer-resources', category: 'developer',
  nameZh: '开发者资源', nameEn: 'Developer Resources',
  descriptionZh: '原生 Plugin Inventory 实时诊断、当前扩展表面目录与随包发布的集成契约参考。',
  descriptionEn: 'Native Plugin Inventory diagnostics, current extension surfaces, and bundled integration contract reference.',
  surface: 'settings', maturity: 'available', order: 100,
}

const STYLE = `
[data-paimind-developer-resources]{box-sizing:border-box;min-height:100%;padding:24px;color:var(--dsw-alias-label-primary,#202124);font:inherit}
[data-paimind-developer-resources] *{box-sizing:border-box}
[data-paimind-developer-header]{display:grid;gap:6px;margin-bottom:14px}
[data-paimind-developer-header] h2{margin:0;font-size:22px;line-height:30px;font-weight:650}
[data-paimind-developer-header] p{margin:0;max-width:760px;color:var(--dsw-alias-label-secondary,#626872);font-size:13px;line-height:20px}
[data-paimind-developer-boundary]{margin:0 0 14px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.17));border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05));color:var(--dsw-alias-label-secondary,#626872);font-size:11px;line-height:18px}
[data-paimind-developer-tabs]{display:flex;gap:6px;overflow:auto;margin:0 0 16px;padding:1px 0;scrollbar-width:thin}
[data-paimind-developer-tab]{flex:none;min-height:32px;padding:6px 11px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.19));border-radius:999px;color:var(--dsw-alias-label-secondary,#626872);background:transparent;font:inherit;font-size:12px;cursor:pointer}
[data-paimind-developer-tab][aria-selected='true']{border-color:var(--dsw-alias-state-business-primary,#4f7ff8);color:var(--dsw-alias-state-business-primary,#4f7ff8);background:color-mix(in srgb,currentColor 8%,transparent)}
[data-paimind-developer-toolbar]{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}
[data-paimind-developer-toolbar] h3{margin:0;font-size:15px;line-height:22px}
[data-paimind-developer-toolbar] p{margin:3px 0 0;max-width:680px;color:var(--dsw-alias-label-secondary,#626872);font-size:11px;line-height:17px}
[data-paimind-developer-toolbar] button,[data-paimind-developer-retry]{min-height:30px;padding:5px 10px;border:0;border-radius:8px;color:#fff;background:var(--dsw-alias-state-business-primary,#4f7ff8);font:inherit;font-size:11px;cursor:pointer}
[data-paimind-developer-summary]{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-bottom:12px}
[data-paimind-developer-metric]{display:grid;gap:2px;padding:10px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16));border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.025))}
[data-paimind-developer-metric] strong{font-size:19px;line-height:24px}
[data-paimind-developer-metric] span{color:var(--dsw-alias-label-secondary,#626872);font-size:10px;line-height:15px}
[data-paimind-developer-list]{display:grid;gap:8px;margin:0;padding:0;list-style:none}
[data-paimind-developer-row],[data-paimind-developer-card]{display:grid;gap:8px;min-width:0;padding:12px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.17));border-radius:11px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.025))}
[data-paimind-developer-row-header],[data-paimind-developer-card-header]{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
[data-paimind-developer-row] code,[data-paimind-developer-card] code{overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:17px}
[data-paimind-developer-entry-id]{color:var(--dsw-alias-label-tertiary,#7c828b)}
[data-paimind-developer-badges]{display:flex;flex-wrap:wrap;gap:5px}
[data-paimind-developer-badge]{padding:2px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.09));color:var(--dsw-alias-label-secondary,#626872);font-size:10px;line-height:16px}
[data-paimind-developer-badge][data-state='active']{color:var(--dsw-alias-state-success-primary,#238c55);background:color-mix(in srgb,currentColor 10%,transparent)}
[data-paimind-developer-badge][data-state='failed']{color:var(--dsw-alias-state-error-primary,#d04444);background:color-mix(in srgb,currentColor 10%,transparent)}
[data-paimind-developer-card] h4{margin:0;font-size:13px;line-height:19px}
[data-paimind-developer-card] p{margin:0;color:var(--dsw-alias-label-secondary,#626872);font-size:11px;line-height:17px}
[data-paimind-developer-state]{padding:28px 12px;color:var(--dsw-alias-label-secondary,#626872);font-size:12px;line-height:18px;text-align:center}
[data-paimind-developer-state] p{margin:0 0 8px}
@media(max-width:900px){[data-paimind-developer-summary]{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:760px){[data-paimind-developer-resources]{padding:16px 12px}[data-paimind-developer-summary]{grid-template-columns:repeat(2,minmax(0,1fr))}[data-paimind-developer-toolbar]{display:grid}[data-paimind-developer-toolbar] button{justify-self:start}}
@media(max-width:600px){[role='dialog'][aria-modal='true']:has([data-paimind-developer-resources]){flex-direction:column!important}[role='dialog'][aria-modal='true']:has([data-paimind-developer-resources])>nav{width:100%!important;max-width:none!important;max-height:96px;box-sizing:border-box;padding:10px 12px!important;border-right:0!important;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.16));overflow:hidden}[role='dialog'][aria-modal='true']:has([data-paimind-developer-resources])>nav>:first-child{display:none!important}[role='dialog'][aria-modal='true']:has([data-paimind-developer-resources])>nav>:last-child{display:flex!important;flex-direction:row!important;gap:6px;overflow-x:auto;overscroll-behavior-inline:contain;scrollbar-width:thin}[role='dialog'][aria-modal='true']:has([data-paimind-developer-resources])>nav>:last-child>*{flex:0 0 auto}[role='dialog'][aria-modal='true']:has([data-paimind-developer-resources])>nav+*{width:100%!important;min-width:0!important;flex:1 1 auto!important}[data-paimind-developer-tabs]{flex-wrap:wrap;overflow:visible}}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = STYLE_ID
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}

function isDescriptor(value: unknown): value is Readonly<PaimindExtensionDescriptor> {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<PaimindExtensionDescriptor>
  return typeof candidate.id === 'string' && candidate.id.startsWith('paimind:')
    && typeof candidate.packageName === 'string' && candidate.packageName.startsWith('@paimind/')
    && typeof candidate.category === 'string' && typeof candidate.surface === 'string'
}

function descriptorFromEntry(entry: { readonly inject?: () => unknown }): unknown {
  try {
    const injected = entry.inject?.()
    return typeof injected === 'object' && injected !== null
      ? (injected as { readonly descriptor?: unknown }).descriptor
      : undefined
  } catch { return undefined }
}

type DeveloperTab = 'diagnostics' | 'surfaces' | 'reference'
type InventoryState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: HarnessPluginInventorySnapshot }

interface DeveloperResourcesInjected {
  readonly getExtensions: () => readonly Readonly<PaimindExtensionDescriptor>[]
  readonly subscribeExtensions: (listener: () => void) => () => void
  readonly listInventory: () => Promise<HarnessPluginInventorySnapshot>
  readonly locale: PaimindDeveloperResourcesClientContext['locale']
}

type DeveloperResourcesProps = HarnessSettingsSectionOwnerProps & DeveloperResourcesInjected

const TECHNICAL_COPY: Readonly<Record<DeveloperTechnicalState, { readonly zh: string; readonly en: string }>> = {
  active: { zh: '已加载', en: 'Active' }, loading: { zh: '加载中', en: 'Loading' },
  failed: { zh: '加载失败', en: 'Failed' }, disabled: { zh: '已停用', en: 'Disabled' },
  unobserved: { zh: '已启用 · 未观测', en: 'Enabled · Unobserved' }, unavailable: { zh: '注册表未发现', en: 'Not in registry' },
}

const CATEGORY_COPY: Readonly<Record<string, { readonly zh: string; readonly en: string }>> = {
  experience: { zh: '体验', en: 'Experience' }, 'content-rendering': { zh: '内容与渲染', en: 'Content & Rendering' },
  agents: { zh: '智能体', en: 'Agents' }, 'skills-tools': { zh: '技能与工具', en: 'Skills & Tools' },
  automation: { zh: '自动化', en: 'Automation' }, governance: { zh: '治理', en: 'Governance' }, developer: { zh: '开发者', en: 'Developer' },
}

function phaseText(phase: string | null, zh: boolean): string {
  if (phase === null) return zh ? '未观测' : 'Unobserved'
  const copy: Readonly<Record<string, { readonly zh: string; readonly en: string }>> = {
    pending: { zh: '等待加载', en: 'Pending' }, loading: { zh: '加载中', en: 'Loading' }, active: { zh: '运行中', en: 'Active' },
    failed: { zh: '加载失败', en: 'Failed' }, unloading: { zh: '卸载中', en: 'Unloading' },
  }
  return copy[phase]?.[zh ? 'zh' : 'en'] ?? phase
}

export function DeveloperResourcesSection(props: DeveloperResourcesProps): React.JSX.Element {
  const extensions = useSyncExternalStore(props.subscribeExtensions, props.getExtensions, props.getExtensions)
  const locale = useSyncExternalStore(
    props.locale.subscribe.bind(props.locale),
    () => props.locale.getLocale().active,
    () => props.locale.getLocale().active,
  )
  const zh = locale.startsWith('zh')
  const [tab, setTab] = useState<DeveloperTab>('diagnostics')
  const [request, setRequest] = useState(0)
  const [inventory, setInventory] = useState<InventoryState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    setInventory({ status: 'loading' })
    void Promise.resolve().then(() => props.listInventory()).then(
      snapshot => { if (current) setInventory({ status: 'ready', snapshot }) },
      () => { if (current) setInventory({ status: 'error' }) },
    )
    return () => { current = false }
  }, [props.listInventory, request])

  const entries = useMemo(() => inventory.status === 'ready' ? paimindInventoryEntries(inventory.snapshot) : [], [inventory])
  const summary = useMemo(() => inventory.status === 'ready' ? summarizePaimindInventory(inventory.snapshot) : null, [inventory])
  const surfaces = useMemo(() => inventory.status === 'ready'
    ? extensions.map(descriptor => projectDeveloperSurface(descriptor, inventory.snapshot))
    : [], [extensions, inventory])

  const retry = (): void => { setRequest(value => value + 1) }
  const tabCopy: Readonly<Record<DeveloperTab, { readonly zh: string; readonly en: string }>> = {
    diagnostics: { zh: '实时诊断', en: 'Live Diagnostics' }, surfaces: { zh: '表面目录', en: 'Surface Catalog' }, reference: { zh: '集成参考', en: 'Integration Reference' },
  }

  return <section data-paimind-developer-resources aria-label={zh ? 'PAIMind 开发者资源' : 'PAIMind Developer Resources'}>
    <header data-paimind-developer-header><h2>{zh ? '开发者资源' : 'Developer Resources'}</h2><p>{zh ? '检查真实 Loader 状态、当前注册的产品表面和随当前包发布的稳定集成边界。' : 'Inspect real Loader state, currently registered product surfaces, and stable integration boundaries shipped with this package.'}</p></header>
    <p data-paimind-developer-boundary>{zh ? 'Harness Plugin Registry 仍独占技术加载、版本、依赖和启停。此页面只读；原生清单未提供版本、依赖图或失败堆栈，因此这里不会猜测。' : 'Harness Plugin Registry remains the sole owner of loading, versions, dependencies, and enablement. This page is read-only. The native inventory exposes no versions, dependency graph, or failure stack, so none are guessed here.'}</p>
    <div data-paimind-developer-tabs role="tablist" aria-label={zh ? '开发者资源类别' : 'Developer resource categories'}>{(Object.keys(tabCopy) as DeveloperTab[]).map(id => <button key={id} type="button" role="tab" data-paimind-developer-tab aria-selected={tab === id} onClick={() => { setTab(id) }}>{tabCopy[id][zh ? 'zh' : 'en']}</button>)}</div>

    {tab !== 'reference' && inventory.status === 'loading' && <div data-paimind-developer-state aria-busy="true">{zh ? '正在读取 Harness Plugin Inventory…' : 'Reading Harness Plugin Inventory…'}</div>}
    {tab !== 'reference' && inventory.status === 'error' && <div data-paimind-developer-state><p role="alert">{zh ? 'Harness Plugin Inventory 暂时不可用；没有展示缓存或猜测状态。' : 'Harness Plugin Inventory is unavailable. No cached or inferred state is shown.'}</p><button type="button" data-paimind-developer-retry onClick={retry}>{zh ? '重试' : 'Retry'}</button></div>}

    {tab === 'diagnostics' && inventory.status === 'ready' && summary !== null && <div role="tabpanel">
      <div data-paimind-developer-toolbar><div><h3>{zh ? 'PAIMind Loader 实时快照' : 'PAIMind Loader live snapshot'}</h3><p>{zh ? `从当前 Harness 原生清单读取 ${entries.length} 条 @paimind/* Loader 记录。` : `Read ${entries.length} @paimind/* Loader entries from the current native Harness inventory.`}</p></div><button type="button" onClick={retry}>{zh ? '刷新' : 'Refresh'}</button></div>
      <div data-paimind-developer-summary>{([
        ['total', zh ? '全部记录' : 'Total'], ['active', zh ? '运行中' : 'Active'], ['loading', zh ? '加载流转' : 'Loading'],
        ['failed', zh ? '失败' : 'Failed'], ['disabled', zh ? '已停用' : 'Disabled'], ['unobserved', zh ? '未观测' : 'Unobserved'],
      ] as const).map(([key, label]) => <div key={key} data-paimind-developer-metric data-metric={key}><strong>{summary[key]}</strong><span>{label}</span></div>)}</div>
      {entries.length === 0 ? <div data-paimind-developer-state>{zh ? '当前原生清单中没有 PAIMind Loader 记录。' : 'No PAIMind Loader entries are present in the native inventory.'}</div> : <ul data-paimind-developer-list>{entries.map(entry => <li key={entry.entryId} data-paimind-developer-row data-loader-entry={entry.entryId}><div data-paimind-developer-row-header><code>{entry.moduleName}</code><span data-paimind-developer-badge data-state={entry.enabled ? (entry.fiberPhase ?? 'unobserved') : 'disabled'}>{entry.enabled ? phaseText(entry.fiberPhase, zh) : (zh ? '已停用' : 'Disabled')}</span></div><code data-paimind-developer-entry-id>{entry.entryId}</code><div data-paimind-developer-badges><span data-paimind-developer-badge>{zh ? '有效启用' : 'Effective enablement'}: {entry.enabled ? 'true' : 'false'}</span><span data-paimind-developer-badge>fiberPhase: {entry.fiberPhase ?? 'null'}</span></div></li>)}</ul>}
    </div>}

    {tab === 'surfaces' && inventory.status === 'ready' && <div role="tabpanel">
      <div data-paimind-developer-toolbar><div><h3>{zh ? '当前扩展表面' : 'Current extension surfaces'}</h3><p>{zh ? '来自正在运行的 paimind.extension Slot；这里只列真实注册表面，不渲染原型模拟状态。' : 'Read from the live paimind.extension Slot. Only registered surfaces are listed; prototype simulation states are not rendered.'}</p></div></div>
      <ul data-paimind-developer-list>{surfaces.map(({ descriptor, technicalState }) => <li key={descriptor.id} data-paimind-developer-card data-extension-id={descriptor.id}><div data-paimind-developer-card-header><h4>{zh ? descriptor.nameZh : descriptor.nameEn}</h4><span data-paimind-developer-badge data-state={technicalState}>{TECHNICAL_COPY[technicalState][zh ? 'zh' : 'en']}</span></div><p>{zh ? descriptor.descriptionZh : descriptor.descriptionEn}</p><div data-paimind-developer-badges><span data-paimind-developer-badge>{CATEGORY_COPY[descriptor.category]?.[zh ? 'zh' : 'en'] ?? descriptor.category}</span><span data-paimind-developer-badge>{descriptor.surface}</span><span data-paimind-developer-badge>{descriptor.maturity}</span></div><code>{descriptor.packageName}</code></li>)}</ul>
    </div>}

    {tab === 'reference' && <div role="tabpanel">
      <div data-paimind-developer-toolbar><div><h3>{zh ? '稳定集成边界' : 'Stable integration boundaries'}</h3><p>{zh ? '这些条目随当前 PAIMind 包版本发布，不是运行时发现结果。升级时以新包中的契约与兼容层为准。' : 'These entries ship with the current PAIMind package version; they are not runtime discovery. On upgrade, use the new package contracts and compatibility layer.'}</p></div></div>
      <ul data-paimind-developer-list>{PAIMIND_INTEGRATION_REFERENCES.map(reference => <li key={reference.id} data-paimind-developer-card data-reference-id={reference.id}><div data-paimind-developer-card-header><code>{reference.contract}</code><span data-paimind-developer-badge>{zh ? '随包发布' : 'Bundled reference'}</span></div><p>{zh ? reference.descriptionZh : reference.descriptionEn}</p><div data-paimind-developer-badges><span data-paimind-developer-badge>{reference.kind}</span><span data-paimind-developer-badge>{zh ? '所有者' : 'Owner'}: {reference.owner}</span></div></li>)}</ul>
    </div>}
  </section>
}

class DeveloperResourcesBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('[paimind-developer-resources]', error, info) }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

export function apply(ctx: PaimindDeveloperResourcesClientContext): void {
  ctx.effect(installStyle, 'paimind-developer-resources: style')
  contributePaimindExtension(ctx.slots, SELF)

  let cachedVersion = -1
  let cachedExtensions: readonly Readonly<PaimindExtensionDescriptor>[] = Object.freeze([])
  const getExtensions = (): readonly Readonly<PaimindExtensionDescriptor>[] => {
    let version: number
    try { version = ctx.slots.getVersion(EXTENSION_SLOT) } catch { return Object.freeze([]) }
    if (version === cachedVersion) return cachedExtensions
    const seen = new Set<string>()
    let entries: ReturnType<typeof ctx.slots.entries>
    try { entries = ctx.slots.entries(EXTENSION_SLOT) } catch { return Object.freeze([]) }
    cachedExtensions = Object.freeze(entries
      .map(descriptorFromEntry)
      .filter(isDescriptor)
      .filter(descriptor => {
        if (seen.has(descriptor.id)) return false
        seen.add(descriptor.id)
        return true
      })
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)))
    cachedVersion = version
    return cachedExtensions
  }
  const listInventory = async (): Promise<HarnessPluginInventorySnapshot> => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }
  const injectSection = (): DeveloperResourcesInjected => ({
    getExtensions,
    subscribeExtensions: listener => {
      try { return ctx.slots.subscribe(EXTENSION_SLOT, listener) } catch { return () => {} }
    },
    listInventory,
    locale: ctx.locale,
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'paimind-developer-resources', order: 25,
    label: () => ctx.locale.getLocale().active.startsWith('zh') ? '开发者资源' : 'Developer Resources',
    inject: injectSection,
  }, props => <DeveloperResourcesBoundary><DeveloperResourcesSection {...props as DeveloperResourcesProps} /></DeveloperResourcesBoundary>))
}
