import {
  Component,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import {
  PAIMIND_EXTENSION_CATEGORIES,
  type PaimindExtensionCategory,
  type PaimindExtensionDescriptor,
} from '@paimind/contracts'
import {
  contributePaimindExtension,
  type HarnessPluginInventorySnapshot,
  type HarnessSettingsSectionOwnerProps,
  type PaimindExtensionCenterClientContext,
} from '@paimind/harness-compat'
import {
  compareExtensionDescriptors,
  projectExtensionTechnicalState,
  type ExtensionTechnicalState,
} from '../index.js'

export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']

const SLOT = 'paimind.extension'
const STYLE_ID = '@paimind/extension-center'

const SELF: PaimindExtensionDescriptor = {
  id: 'paimind:extension-center',
  packageName: '@paimind/extension-center',
  category: 'developer',
  nameZh: '扩展中心',
  nameEn: 'Extension Center',
  descriptionZh: '按产品类别管理 PAIMind 能力，并映射 Harness 的真实技术加载状态。',
  descriptionEn: 'Manages PAIMind capabilities by product category and projects native Harness loader state.',
  surface: 'settings',
  maturity: 'available',
  order: -100,
}

const CATEGORY_COPY: Readonly<Record<PaimindExtensionCategory, { readonly zh: string; readonly en: string }>> = {
  experience: { zh: '体验', en: 'Experience' },
  'content-rendering': { zh: '内容与渲染', en: 'Content & Rendering' },
  agents: { zh: '智能体', en: 'Agents' },
  'skills-tools': { zh: '技能与工具', en: 'Skills & Tools' },
  automation: { zh: '自动化', en: 'Automation' },
  governance: { zh: '治理', en: 'Governance' },
  developer: { zh: '开发者', en: 'Developer' },
}

const TECHNICAL_COPY: Readonly<Record<ExtensionTechnicalState, { readonly zh: string; readonly en: string }>> = {
  active: { zh: '已加载', en: 'Active' },
  loading: { zh: '加载中', en: 'Loading' },
  failed: { zh: '加载失败', en: 'Failed' },
  disabled: { zh: '已停用', en: 'Disabled' },
  unobserved: { zh: '已启用 · 未观测', en: 'Enabled · Unobserved' },
  unavailable: { zh: '注册表未发现', en: 'Not in registry' },
}

const MATURITY_COPY = {
  available: { zh: '可用', en: 'Available' },
  'technical-preview': { zh: '技术已验证', en: 'Technical preview' },
  reopened: { zh: '纠偏中', en: 'Reopened' },
} as const

const SURFACE_COPY = {
  shell: { zh: '应用外壳', en: 'App shell' },
  conversation: { zh: '原生对话', en: 'Native conversation' },
  settings: { zh: '设置', en: 'Settings' },
  'header-button': { zh: '独立按钮', en: 'Independent button' },
  'side-card': { zh: '侧卡', en: 'Side card' },
  preview: { zh: '预览通道', en: 'Preview channel' },
  headless: { zh: '无界面适配器', en: 'Headless adapter' },
} as const

const STYLE = `
[data-paimind-extension-center]{box-sizing:border-box;min-height:100%;padding:24px;color:var(--dsw-alias-label-primary,#202124);font:inherit}
[data-paimind-extension-center] *{box-sizing:border-box}
[data-paimind-extension-header]{display:grid;gap:6px;margin-bottom:18px}
[data-paimind-extension-header] h2{margin:0;font-size:22px;line-height:30px;font-weight:650}
[data-paimind-extension-header] p{margin:0;max-width:720px;color:var(--dsw-alias-label-secondary,#626872);font-size:13px;line-height:20px}
[data-paimind-extension-note]{display:flex;gap:8px;align-items:flex-start;margin:14px 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16));border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05));color:var(--dsw-alias-label-secondary,#626872);font-size:12px;line-height:18px}
[data-paimind-extension-search]{display:block;margin:14px 0}
[data-paimind-extension-search] input{width:100%;min-height:38px;padding:8px 11px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.24));border-radius:10px;color:inherit;background:var(--dsw-alias-bg-layer-2,transparent);font:inherit;font-size:13px;outline:none}
[data-paimind-extension-search] input:focus{border-color:var(--dsw-alias-state-business-primary,#4f7ff8);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 16%,transparent)}
[data-paimind-extension-categories]{display:flex;gap:6px;overflow:auto;padding:1px 0 12px;scrollbar-width:thin}
[data-paimind-extension-category-button]{flex:none;min-height:30px;padding:5px 10px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:999px;color:var(--dsw-alias-label-secondary,#626872);background:transparent;font:inherit;font-size:12px;cursor:pointer}
[data-paimind-extension-category-button][aria-pressed='true']{border-color:var(--dsw-alias-state-business-primary,#4f7ff8);color:var(--dsw-alias-state-business-primary,#4f7ff8);background:color-mix(in srgb,currentColor 8%,transparent)}
[data-paimind-extension-groups]{display:grid;gap:22px}
[data-paimind-extension-group]{display:grid;gap:9px}
[data-paimind-extension-group] h3{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#626872)}
[data-paimind-extension-grid]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
[data-paimind-extension-card]{display:grid;gap:9px;min-width:0;padding:13px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16));border-radius:12px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.025))}
[data-paimind-extension-card-header]{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
[data-paimind-extension-card] h4{margin:0;font-size:14px;line-height:20px}
[data-paimind-extension-card] p{margin:0;color:var(--dsw-alias-label-secondary,#626872);font-size:12px;line-height:18px}
[data-paimind-extension-badges]{display:flex;flex-wrap:wrap;gap:5px}
[data-paimind-extension-badge]{padding:2px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.09));color:var(--dsw-alias-label-secondary,#626872);font-size:10px;line-height:16px}
[data-paimind-extension-badge][data-state='active']{color:var(--dsw-alias-state-success-primary,#238c55);background:color-mix(in srgb,currentColor 10%,transparent)}
[data-paimind-extension-badge][data-state='failed']{color:var(--dsw-alias-state-error-primary,#d04444);background:color-mix(in srgb,currentColor 10%,transparent)}
[data-paimind-extension-package]{overflow-wrap:anywhere;color:var(--dsw-alias-label-tertiary,#7c828b);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;line-height:16px}
[data-paimind-extension-status]{padding:18px 12px;color:var(--dsw-alias-label-secondary,#626872);font-size:13px;text-align:center}
[data-paimind-extension-status] button{margin-top:8px;padding:6px 10px;border:0;border-radius:8px;color:#fff;background:var(--dsw-alias-state-business-primary,#4f7ff8);font:inherit;cursor:pointer}
@media(max-width:760px){[data-paimind-extension-center]{padding:16px 12px}[data-paimind-extension-grid]{grid-template-columns:1fr}}
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
  return typeof candidate.id === 'string'
    && candidate.id.startsWith('paimind:')
    && typeof candidate.packageName === 'string'
    && candidate.packageName.startsWith('@paimind/')
    && typeof candidate.category === 'string'
}

function descriptorFromEntry(entry: { readonly inject?: () => unknown }): unknown {
  try {
    const injected = entry.inject?.()
    return typeof injected === 'object' && injected !== null
      ? (injected as { readonly descriptor?: unknown }).descriptor
      : undefined
  } catch {
    return undefined
  }
}

interface ExtensionCenterInjected {
  readonly getExtensions: () => readonly Readonly<PaimindExtensionDescriptor>[]
  readonly subscribeExtensions: (listener: () => void) => () => void
  readonly listInventory: () => Promise<HarnessPluginInventorySnapshot>
  readonly locale: PaimindExtensionCenterClientContext['locale']
}

type ExtensionCenterProps = HarnessSettingsSectionOwnerProps & ExtensionCenterInjected

type InventoryState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: HarnessPluginInventorySnapshot }

export function ExtensionCenterSection(props: ExtensionCenterProps): React.JSX.Element {
  const extensions = useSyncExternalStore(
    props.subscribeExtensions,
    props.getExtensions,
    props.getExtensions,
  )
  const locale = useSyncExternalStore(
    props.locale.subscribe.bind(props.locale),
    () => props.locale.getLocale().active,
    () => props.locale.getLocale().active,
  )
  const zh = locale.startsWith('zh')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<PaimindExtensionCategory | 'all'>('all')
  const [request, setRequest] = useState(0)
  const [inventory, setInventory] = useState<InventoryState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    setInventory({ status: 'loading' })
    void props.listInventory().then(
      snapshot => { if (current) setInventory({ status: 'ready', snapshot }) },
      () => { if (current) setInventory({ status: 'error' }) },
    )
    return () => { current = false }
  }, [props.listInventory, request])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visible = useMemo(() => extensions.filter(extension => {
    if (category !== 'all' && extension.category !== category) return false
    if (normalizedQuery.length === 0) return true
    return [extension.nameZh, extension.nameEn, extension.packageName, extension.descriptionZh, extension.descriptionEn]
      .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
  }), [category, extensions, normalizedQuery])

  return <section data-paimind-extension-center aria-label={zh ? 'PAIMind 扩展中心' : 'PAIMind Extension Center'}>
    <header data-paimind-extension-header>
      <h2>{zh ? 'PAIMind 扩展中心' : 'PAIMind Extension Center'}</h2>
      <p>{zh ? '按产品能力管理 PAIMind 扩展；技术加载、依赖和启停仍由 Harness Plugin Registry 负责。' : 'Manage PAIMind extensions by product capability. Harness Plugin Registry remains responsible for loading, dependencies, and enablement.'}</p>
    </header>
    <div data-paimind-extension-note role="note">ⓘ <span>{zh ? '这里不会创建第二套插件状态，也不是页面启动器。技术状态来自 Harness，只读展示。' : 'This page creates no second plugin state and is not a launcher. Technical state is read-only from Harness.'}</span></div>
    <label data-paimind-extension-search>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>{zh ? '搜索扩展' : 'Search extensions'}</span>
      <input type="search" value={query} placeholder={zh ? '搜索名称、包或能力' : 'Search name, package, or capability'} onChange={event => { setQuery(event.currentTarget.value) }} />
    </label>
    <nav data-paimind-extension-categories aria-label={zh ? '扩展类别' : 'Extension categories'}>
      <button type="button" data-paimind-extension-category-button aria-pressed={category === 'all'} onClick={() => { setCategory('all') }}>{zh ? '全部' : 'All'}</button>
      {PAIMIND_EXTENSION_CATEGORIES.map(id => <button key={id} type="button" data-paimind-extension-category-button aria-pressed={category === id} onClick={() => { setCategory(id) }}>{zh ? CATEGORY_COPY[id].zh : CATEGORY_COPY[id].en}</button>)}
    </nav>
    {inventory.status === 'loading' && <div data-paimind-extension-status aria-busy="true">{zh ? '正在读取 Harness 技术状态…' : 'Reading Harness technical state…'}</div>}
    {inventory.status === 'error' && <div data-paimind-extension-status><p role="alert">{zh ? 'Harness Plugin Registry 暂时不可用；没有回退到缓存状态。' : 'Harness Plugin Registry is unavailable; no cached state is shown.'}</p><button type="button" onClick={() => { setRequest(value => value + 1) }}>{zh ? '重试' : 'Retry'}</button></div>}
    {inventory.status === 'ready' && visible.length === 0 && <div data-paimind-extension-status role="status">{category === 'governance'
      ? (zh
          ? '当前没有可信身份提供方，因此没有可用的治理扩展。PAIMind 不会把浏览器角色或 Harness Full Access 冒充企业管理员权限。'
          : 'No trusted identity provider is configured, so no governance extension is available. PAIMind does not treat browser roles or Harness Full Access as enterprise administrator authority.')
      : (zh ? '当前筛选条件下没有扩展。' : 'No extensions match the current filters.')}</div>}
    {inventory.status === 'ready' && <div data-paimind-extension-groups>{PAIMIND_EXTENSION_CATEGORIES.map(categoryId => {
      const rows = visible.filter(extension => extension.category === categoryId)
      if (rows.length === 0) return null
      return <section key={categoryId} data-paimind-extension-group>
        <h3>{zh ? CATEGORY_COPY[categoryId].zh : CATEGORY_COPY[categoryId].en}</h3>
        <div data-paimind-extension-grid>{rows.map(descriptor => {
          const projection = projectExtensionTechnicalState(descriptor, inventory.snapshot)
          return <article key={descriptor.id} data-paimind-extension-card>
            <div data-paimind-extension-card-header><h4>{zh ? descriptor.nameZh : descriptor.nameEn}</h4><span data-paimind-extension-badge data-state={projection.technicalState}>{zh ? TECHNICAL_COPY[projection.technicalState].zh : TECHNICAL_COPY[projection.technicalState].en}</span></div>
            <p>{zh ? descriptor.descriptionZh : descriptor.descriptionEn}</p>
            <div data-paimind-extension-badges><span data-paimind-extension-badge>{zh ? MATURITY_COPY[descriptor.maturity].zh : MATURITY_COPY[descriptor.maturity].en}</span><span data-paimind-extension-badge>{zh ? SURFACE_COPY[descriptor.surface].zh : SURFACE_COPY[descriptor.surface].en}</span></div>
            <code data-paimind-extension-package>{descriptor.packageName}</code>
          </article>
        })}</div>
      </section>
    })}</div>}
  </section>
}

class ExtensionCenterBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('[paimind-extension-center]', error, info) }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

/** Register one Settings section; all extension metadata remains independently contributed. */
export function apply(ctx: PaimindExtensionCenterClientContext): void {
  ctx.effect(installStyle, 'paimind-extension-center: style')
  contributePaimindExtension(ctx.slots, SELF)

  let cachedVersion = -1
  let cachedExtensions: readonly Readonly<PaimindExtensionDescriptor>[] = Object.freeze([])
  const getExtensions = (): readonly Readonly<PaimindExtensionDescriptor>[] => {
    const version = ctx.slots.getVersion(SLOT)
    if (version === cachedVersion) return cachedExtensions
    const seen = new Set<string>()
    cachedExtensions = Object.freeze(ctx.slots.entries(SLOT)
      .map(descriptorFromEntry)
      .filter(isDescriptor)
      .filter(descriptor => {
        if (seen.has(descriptor.id)) return false
        seen.add(descriptor.id)
        return true
      })
      .sort(compareExtensionDescriptors))
    cachedVersion = version
    return cachedExtensions
  }
  const listInventory = async (): Promise<HarnessPluginInventorySnapshot> => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }
  const injectSection = (): ExtensionCenterInjected => ({
    getExtensions,
    subscribeExtensions: listener => ctx.slots.subscribe(SLOT, listener),
    listInventory,
    locale: ctx.locale,
  })
  const label = (): string => ctx.locale.getLocale().active.startsWith('zh') ? '扩展中心' : 'Extension Center'

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'paimind-extensions',
    order: 17,
    label,
    inject: injectSection,
    children: { [SLOT]: { kind: 'list', scope: 'root' } },
  }, props => <ExtensionCenterBoundary><ExtensionCenterSection {...props as ExtensionCenterProps} /></ExtensionCenterBoundary>))
}
