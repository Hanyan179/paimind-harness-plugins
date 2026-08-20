import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  contributePaimindExtension,
  type HarnessConversationDraftService,
  type HarnessRemoteMountService,
  type HarnessRemoteResult,
  type HarnessSessionService,
  type HarnessSkillsApi,
  type PaimindClientContext,
  type PaimindLocaleSource,
} from '@paimind/harness-compat'
import {
  PaimindAgentIcon,
  PaimindCheckIcon,
  PaimindCloseIcon,
  PaimindFavoriteFillIcon,
  PaimindFavoriteIcon,
  PaimindNewConversationIcon,
  PaimindRefreshIcon,
  PaimindSearchIcon,
  PaimindSkillIcon,
  PaimindTrashIcon,
  PaimindUploadIcon,
  PaimindWarningIcon,
} from '@paimind/harness-compat/client-icons'
import {
  PaimindProductSurfaceController,
  installPaimindProductSurfaceInteraction,
  isPaimindProductSurfaceAvailable,
  requestPaimindProductSurface,
} from '@paimind/harness-compat/client-surface'
import {
  PAIMIND_SKILL_UPLOAD_PATH,
  SKILL_FAVORITES_STORAGE_KEY,
  parseFavoriteSkillNames,
  serializeFavoriteSkillNames,
} from '../catalog.js'
import type {
  SkillInstallRecord,
  SkillInstallResult,
  SkillInstallerSnapshot,
  SkillRemovalRecord,
  SkillUploadPreview,
} from '../installer.js'
import type { SkillCatalogItem, SkillCatalogSnapshot } from '../recommended.js'
import TYPERT_REMOTE from '../remote.js'
import { SKILL_CENTER_STYLE } from './styles.js'

const BASE_INJECT = ['slots', 'locale', 'remote', 'sessions', 'conversation'] as const
export const inject = [...BASE_INJECT]
const STYLE_ID = '@paimind/skill-market'

export function installSkillMarketStyle(): () => void {
  const existing = document.getElementById(STYLE_ID)
  const style = existing?.tagName === 'STYLE' ? existing as HTMLStyleElement : document.createElement('style')
  if (existing?.tagName !== 'STYLE') {
    style.id = STYLE_ID
    style.dataset.paimindPlugin = STYLE_ID
    document.head.append(style)
  }
  style.textContent = SKILL_CENTER_STYLE
  style.dataset.paimindStyleRefs = String(Number(style.dataset.paimindStyleRefs ?? '0') + 1)
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    const references = Math.max(0, Number(style.dataset.paimindStyleRefs ?? '1') - 1)
    if (references === 0) style.remove()
    else style.dataset.paimindStyleRefs = String(references)
  }
}

type StorageFace = Pick<Storage, 'getItem' | 'setItem'>
function usableStorage(value: unknown): StorageFace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<StorageFace>
  return typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function' ? candidate as StorageFace : undefined
}

interface SkillInstallerRemoteNamespace {
  listCatalog(): Promise<HarnessRemoteResult<Readonly<SkillCatalogSnapshot>>>
  inspectCatalog(input: { readonly catalogId: string; readonly version: string }): Promise<HarnessRemoteResult<Readonly<SkillUploadPreview>>>
  inspectUpload(input: { readonly uploadId: string }): Promise<HarnessRemoteResult<Readonly<SkillUploadPreview>>>
  installUpload(input: { readonly uploadId: string; readonly digest: string }): Promise<HarnessRemoteResult<Readonly<SkillInstallResult>>>
  listInstalled(): Promise<HarnessRemoteResult<Readonly<SkillInstallerSnapshot>>>
  uninstall(input: { readonly skillId: string; readonly version?: string }): Promise<HarnessRemoteResult<Readonly<SkillRemovalRecord>>>
}

interface SkillMarketRemote extends HarnessRemoteMountService {
  readonly paimindSkillInstaller?: SkillInstallerRemoteNamespace
}

interface SkillMarketClientContext extends PaimindClientContext {
  readonly remote: SkillMarketRemote
  readonly sessions: HarnessSessionService
  readonly conversation: HarnessConversationDraftService
  get(name: 'connection'): { readonly api: { readonly skills: HarnessSkillsApi } }
  inject(
    services: readonly string[],
    install: (scope: SkillMarketClientContext) => void | (() => void),
    label?: string,
  ): PromiseLike<unknown> & { dispose(): Promise<void> }
}

export interface SkillMarketSectionProps {
  readonly close: () => void
  readonly api: HarnessSkillsApi
  readonly installer: SkillInstallerRemoteNamespace
  readonly sessions: HarnessSessionService
  readonly conversation: HarnessConversationDraftService
  readonly locale: PaimindLocaleSource
  readonly storage?: StorageFace
}

type CatalogState = { readonly status: 'loading'; readonly items: readonly []; readonly error: null }
  | { readonly status: 'ready'; readonly items: readonly SkillCatalogItem[]; readonly error: null }
  | { readonly status: 'error'; readonly items: readonly []; readonly error: string }

type RuntimeAvailability =
  | { readonly status: 'no-session' | 'loading' | 'error'; readonly names: ReadonlySet<string> }
  | { readonly status: 'ready'; readonly names: ReadonlySet<string> }

function remoteValue<Value>(result: HarnessRemoteResult<Value>): Value {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function handleScopeKey(event: ReactKeyboardEvent<HTMLButtonElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  const tabs = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]
  const current = tabs.indexOf(event.currentTarget)
  if (current < 0 || tabs.length === 0) return
  event.preventDefault()
  const offset = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + offset + tabs.length) % tabs.length
  tabs[next]?.focus()
  tabs[next]?.click()
}

function handleDialogKey(event: ReactKeyboardEvent<HTMLElement>, close: () => void): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

async function uploadSkill(file: File, signal: AbortSignal): Promise<{ readonly uploadId: string; readonly digest: string }> {
  const response = await fetch(PAIMIND_SKILL_UPLOAD_PATH, {
    method: 'POST', body: file, signal,
    headers: { 'x-paimind-upload': '1', 'x-paimind-file-name': encodeURIComponent(file.name) },
  })
  const value = await response.json() as { readonly uploadId?: string; readonly digest?: string; readonly error?: { readonly message?: string } }
  if (!response.ok || value.uploadId === undefined || value.digest === undefined) throw new Error(value.error?.message ?? '上传失败')
  return { uploadId: value.uploadId, digest: value.digest }
}

export function SkillMarketSection(props: SkillMarketSectionProps): React.JSX.Element {
  const locale = useSyncExternalStore(props.locale.subscribe.bind(props.locale), () => props.locale.getLocale().active, () => props.locale.getLocale().active)
  const sessionSnapshot = useSyncExternalStore(props.sessions.list.subscribe.bind(props.sessions.list), props.sessions.list.getSnapshot.bind(props.sessions.list), props.sessions.list.getSnapshot.bind(props.sessions.list))
  const zh = locale.startsWith('zh')
  const sessionId = sessionSnapshot.current
  const agentPreset = sessionId === undefined ? undefined : sessionSnapshot.byId[sessionId]?.agentPreset
  const [tab, setTab] = useState<'recommended' | 'installed'>('recommended')
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading', items: [], error: null })
  const [runtimeSkills, setRuntimeSkills] = useState<RuntimeAvailability>({ status: 'no-session', names: new Set() })
  const [installed, setInstalled] = useState<readonly SkillInstallRecord[]>([])
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'installed' | 'available'>('all')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [favoriteIds, setFavoriteIds] = useState<readonly string[]>(() => parseFavoriteSkillNames(props.storage?.getItem(SKILL_FAVORITES_STORAGE_KEY) ?? null))
  const [preview, setPreview] = useState<SkillUploadPreview | null>(null)
  const [uploadGuideOpen, setUploadGuideOpen] = useState(false)
  const [uninstallTarget, setUninstallTarget] = useState<SkillInstallRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [pendingDiscovery, setPendingDiscovery] = useState<string | null>(null)
  const [discoveryTimedOut, setDiscoveryTimedOut] = useState(false)
  const [selectedInstalled, setSelectedInstalled] = useState<string | null>(null)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const uploadAbort = useRef<AbortController | null>(null)
  const previewPrimary = useRef<HTMLButtonElement>(null)
  const uploadGuidePrimary = useRef<HTMLButtonElement>(null)
  const uninstallPrimary = useRef<HTMLButtonElement>(null)

  useEffect(() => () => { uploadAbort.current?.abort() }, [])

  useEffect(() => {
    let current = true
    setCatalog({ status: 'loading', items: [], error: null })
    void Promise.all([props.installer.listCatalog(), props.installer.listInstalled()]).then(([catalogResult, installedResult]) => {
      if (!current) return
      const items = remoteValue(catalogResult).items
      setCatalog({ status: 'ready', items, error: null })
      setInstalled(remoteValue(installedResult).items)
      setSelected(value => items.some(item => item.id === value) ? value : (items[0]?.id ?? null))
    }, reason => { if (current) setCatalog({ status: 'error', items: [], error: messageOf(reason) }) })
    return () => { current = false }
  }, [props.installer, revision])

  useEffect(() => {
    if (sessionId === undefined) {
      setRuntimeSkills({ status: 'no-session', names: new Set() })
      return
    }
    const controller = new AbortController(); let current = true
    setRuntimeSkills({ status: 'loading', names: new Set() })
    const probe = async (attempt = 0): Promise<void> => {
      try {
        const response = await props.api.list({ sessionId }, controller.signal)
        if (!current) return
        if (!response.result.ok) {
          setRuntimeSkills({ status: 'error', names: new Set() })
          return
        }
        const names = new Set(response.result.value.skills.map(skill => skill.name))
        setRuntimeSkills({ status: 'ready', names })
        if (pendingDiscovery === null || names.has(pendingDiscovery)) {
          if (pendingDiscovery !== null) setPendingDiscovery(null)
          return
        }
        const delays = [120, 360, 900, 1_500] as const
        const delay = delays[attempt]
        if (delay === undefined) {
          setDiscoveryTimedOut(true)
          return
        }
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(resolve, delay)
          controller.signal.addEventListener('abort', () => { window.clearTimeout(timeout); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
        })
        await probe(attempt + 1)
      } catch (reason) {
        if (current && (reason as { name?: string }).name !== 'AbortError') setRuntimeSkills({ status: 'error', names: new Set() })
      }
    }
    void probe()
    return () => { current = false; controller.abort() }
  }, [agentPreset, pendingDiscovery, props.api, revision, sessionId])

  useEffect(() => { if (preview !== null) previewPrimary.current?.focus() }, [preview])
  useEffect(() => { if (uploadGuideOpen) uploadGuidePrimary.current?.focus() }, [uploadGuideOpen])
  useEffect(() => { if (uninstallTarget !== null) uninstallPrimary.current?.focus() }, [uninstallTarget])

  const bindingAvailable = sessionId !== undefined && props.sessions.binding?.(sessionId)?.ctx !== undefined
  const installedNames = useMemo(() => new Set(installed.map(item => item.name)), [installed])
  const installedByName = useMemo(() => new Map(installed.map(item => [item.name, item])), [installed])
  const recommendedByName = useMemo(() => new Map((catalog.status === 'ready' ? catalog.items : []).map(item => [item.name, item])), [catalog])
  const sources = useMemo(() => [...new Set((catalog.status === 'ready' ? catalog.items : []).map(item => item.source))], [catalog])
  const rows = useMemo(() => catalog.status !== 'ready' ? [] : catalog.items
    .filter(item => query.trim() === '' || `${item.name} ${item.description} ${item.source}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .filter(item => sourceFilter === 'all' || item.source === sourceFilter)
    .filter(item => statusFilter === 'all' || (statusFilter === 'installed' ? installedNames.has(item.name) : !installedNames.has(item.name)))
    .map((item, sourceIndex) => ({ item, sourceIndex, favorite: favoriteIds.includes(item.id) }))
    .filter(row => !favoriteOnly || row.favorite)
    .sort((left, right) => left.favorite === right.favorite ? left.sourceIndex - right.sourceIndex : left.favorite ? -1 : 1), [catalog, favoriteIds, favoriteOnly, installedNames, query, sourceFilter, statusFilter])
  const detail = rows.find(row => row.item.id === selected)?.item ?? rows[0]?.item
  const installedRows = useMemo(() => installed.filter(item => query.trim() === '' || `${item.name} ${item.description} ${item.whenToUse ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [installed, query])
  const installedDetail = installedRows.find(item => item.skillId === selectedInstalled) ?? installedRows[0]

  const toggleFavorite = (name: string): void => {
    const next = favoriteIds.includes(name) ? favoriteIds.filter(id => id !== name) : [...favoriteIds, name]
    const normalized = parseFavoriteSkillNames(serializeFavoriteSkillNames(next)); setFavoriteIds(normalized)
    try { props.storage?.setItem(SKILL_FAVORITES_STORAGE_KEY, serializeFavoriteSkillNames(normalized)) } catch { /* preference never affects runtime discovery */ }
  }
  const useSkill = (name: string): void => {
    if (sessionId === undefined || !runtimeSkills.names.has(name)) return
    const binding = props.sessions.binding?.(sessionId)
    if (binding?.ctx === undefined) return
    props.conversation.input.for(binding.ctx).setDraft(`/${name} `)
    props.close()
  }
  const inspectRecommended = async (item: SkillCatalogItem): Promise<void> => {
    setBusy(true); setError(null); setPreview(null)
    try { setPreview(remoteValue(await props.installer.inspectCatalog({ catalogId: item.id, version: item.version }))) }
    catch (reason) { setError(messageOf(reason)) } finally { setBusy(false) }
  }
  const chooseUpload = (): void => { setError(null); setUploadGuideOpen(true) }
  const openUploadPicker = (): void => {
    uploadRef.current?.click()
    setUploadGuideOpen(false)
  }
  const inspectFile = async (file: File): Promise<void> => {
    uploadAbort.current?.abort()
    const controller = new AbortController(); uploadAbort.current = controller
    setBusy(true); setUploading(true); setError(null); setNotice(null); setPreview(null)
    try {
      const upload = await uploadSkill(file, controller.signal)
      setPreview(remoteValue(await props.installer.inspectUpload({ uploadId: upload.uploadId })))
    } catch (reason) {
      if ((reason as { name?: string }).name !== 'AbortError') setError(messageOf(reason))
    } finally { setBusy(false); setUploading(false); uploadAbort.current = null }
  }
  const confirmInstall = async (): Promise<void> => {
    if (preview === null) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = remoteValue(await props.installer.installUpload({ uploadId: preview.uploadId, digest: preview.digest }))
      setPendingDiscovery(preview.name); setDiscoveryTimedOut(false); setPreview(null); setRevision(value => value + 1); setTab('installed'); setSelectedInstalled(result.record.skillId)
      setNotice(result.operation === 'updated' ? (zh ? `${preview.name} 已原子更新；失败时旧版本会自动回退。` : `${preview.name} updated atomically; the prior version is restored on failure.`) : (zh ? `${preview.name} 已安装，正在等待 Harness 原生发现。` : `${preview.name} installed; waiting for Harness native discovery.`))
    } catch (reason) { setError(messageOf(reason)) } finally { setBusy(false) }
  }
  const uninstall = async (): Promise<void> => {
    if (uninstallTarget === null || !uninstallTarget.managed) return
    const item = uninstallTarget
    setBusy(true); setError(null); setNotice(null)
    try {
      const removal = remoteValue(await props.installer.uninstall({ skillId: item.skillId, version: item.digest }))
      setUninstallTarget(null); setSelectedInstalled(null); setRevision(value => value + 1)
      setNotice(removal.recoverable ? (zh ? `${item.name} 已卸载，原内容已移入可恢复备份。` : `${item.name} uninstalled; its prior contents are in a recoverable backup.`) : (zh ? `${item.name} 已卸载。` : `${item.name} uninstalled.`))
    } catch (reason) { setError(messageOf(reason)) } finally { setBusy(false) }
  }

  const availabilityLabel = (name: string): string => {
    if (runtimeSkills.status === 'no-session') return zh ? '打开对话后检查可用性' : 'Open a conversation to check'
    if (runtimeSkills.status === 'loading') return zh ? '正在检查当前对话' : 'Checking current conversation'
    if (runtimeSkills.status === 'error') return zh ? '当前对话可用性未知' : 'Availability unknown'
    if (runtimeSkills.names.has(name)) return zh ? '当前对话可用' : 'Available now'
    if (pendingDiscovery === name && discoveryTimedOut) return zh ? '需要新建对话以刷新 Skill 快照' : 'Start a new conversation to refresh the Skill snapshot'
    if (pendingDiscovery === name) return zh ? '等待 Harness 原生发现' : 'Waiting for Harness native discovery'
    return zh ? '当前对话不可用' : 'Unavailable in this conversation'
  }

  const favoriteCount = catalog.status === 'ready' ? catalog.items.filter(item => favoriteIds.includes(item.id)).length : 0
  const activateAll = (): void => { setTab('recommended'); setFavoriteOnly(false); setStatusFilter('all'); setMobileDetailOpen(false) }
  const activateInstalled = (): void => { setTab('installed'); setFavoriteOnly(false); setMobileDetailOpen(false) }
  const activateFavorites = (): void => { setTab('recommended'); setFavoriteOnly(true); setMobileDetailOpen(false) }
  const detailInstall = detail === undefined ? undefined : installedByName.get(detail.name)
  const detailCurrent = detail !== undefined && detailInstall?.digest === detail.digest
  const installedRecommended = installedDetail === undefined ? undefined : recommendedByName.get(installedDetail.name)
  const installedCurrent = installedDetail !== undefined && installedRecommended?.digest === installedDetail.digest
  const filtersActive = query.trim() !== '' || sourceFilter !== 'all' || statusFilter !== 'all' || favoriteOnly
  const resetFilters = (): void => { setQuery(''); setSourceFilter('all'); setStatusFilter('all'); setFavoriteOnly(false) }

  return <section data-paimind-skill-market aria-label={zh ? '技能中心' : 'Skill Center'}>
    <header data-paimind-skill-hero>
      <div><p data-paimind-skill-eyebrow><PaimindSkillIcon size={16} />{zh ? '个人能力 · Harness 原生执行' : 'Personal capability · Harness-native execution'}</p><h1 id="paimind-skill-center-title" tabIndex={-1} data-paimind-product-initial-focus>{zh ? '技能中心' : 'Skill Center'}</h1><p data-paimind-skill-intro>{zh ? '发现真实来源，安装前检查风险，并直接在当前对话调用。PAIMind 管理目录与安装投影，Harness 始终负责发现和执行。' : 'Find verified sources, review risk before install, and invoke Skills in this conversation. PAIMind projects the catalog and installer; Harness always owns discovery and execution.'}</p></div>
      <div data-paimind-skill-head-actions><button type="button" data-paimind-skill-button data-primary="true" onClick={chooseUpload} disabled={busy}><PaimindUploadIcon size={15} />{zh ? '导入本地 Skill' : 'Import local Skill'}</button></div>
    </header>
    <input ref={uploadRef} hidden type="file" accept=".zip,.md" aria-label={zh ? '选择技能包' : 'Choose Skill package'} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file !== undefined) void inspectFile(file) }} />
    <div data-paimind-skill-feedback aria-live="polite" aria-atomic="true">
      {uploading && <div role="status" data-paimind-skill-notice><span>{zh ? '正在安全读取并检查本地 Skill…' : 'Securely reading and inspecting the local Skill…'}</span><button type="button" data-paimind-skill-inline-action onClick={() => { uploadAbort.current?.abort() }}>{zh ? '取消' : 'Cancel'}</button></div>}
      {notice !== null && <div role="status" data-paimind-skill-notice data-success="true"><PaimindCheckIcon size={15} /><span>{notice}</span><button type="button" data-paimind-skill-inline-action onClick={() => { setNotice(null) }}>{zh ? '关闭' : 'Dismiss'}</button></div>}
      {error !== null && <div role="alert" data-paimind-skill-notice data-error="true"><PaimindWarningIcon size={15} /><span>{error}</span><button type="button" data-paimind-skill-inline-action onClick={() => { setError(null) }}>{zh ? '关闭' : 'Dismiss'}</button></div>}
    </div>

    <div data-paimind-skill-workspace>
      <aside data-paimind-skill-scope aria-label={zh ? '技能范围' : 'Skill scope'}><p data-paimind-skill-scope-title>{zh ? '浏览' : 'Browse'}</p><div role="tablist" aria-orientation="vertical" data-paimind-skill-scope-list>
        <button role="tab" type="button" data-paimind-skill-scope-button aria-label={zh ? '目录' : 'Catalog'} aria-selected={tab === 'recommended' && !favoriteOnly} tabIndex={tab === 'recommended' && !favoriteOnly ? 0 : -1} onKeyDown={handleScopeKey} onClick={activateAll}><PaimindSkillIcon size={16} />{zh ? '目录' : 'Catalog'}<span data-paimind-skill-scope-count>{catalog.status === 'ready' ? catalog.items.length : 0}</span></button>
        <button role="tab" type="button" data-paimind-skill-scope-button aria-label={zh ? '已安装' : 'Installed'} aria-selected={tab === 'installed'} tabIndex={tab === 'installed' ? 0 : -1} onKeyDown={handleScopeKey} onClick={activateInstalled}><PaimindCheckIcon size={16} />{zh ? '已安装' : 'Installed'}<span data-paimind-skill-scope-count>{installed.length}</span></button>
        <button role="tab" type="button" data-paimind-skill-scope-button aria-label={zh ? '收藏' : 'Favorites'} aria-selected={tab === 'recommended' && favoriteOnly} tabIndex={tab === 'recommended' && favoriteOnly ? 0 : -1} onKeyDown={handleScopeKey} onClick={activateFavorites}><PaimindFavoriteIcon size={16} />{zh ? '收藏' : 'Favorites'}<span data-paimind-skill-scope-count>{favoriteCount}</span></button>
      </div></aside>

      <section data-paimind-skill-catalog aria-label={zh ? '技能目录' : 'Skill catalog'}>
        <div data-paimind-skill-toolbar>
          <div data-paimind-skill-search-wrap><span data-paimind-skill-search-icon><PaimindSearchIcon size={17} /></span><input type="search" aria-label={zh ? '搜索技能' : 'Search Skills'} value={query} onChange={event => { setQuery(event.currentTarget.value) }} placeholder={zh ? '搜索名称、说明或来源' : 'Search name, description, or source'} /></div>
          <span data-paimind-skill-result-count>{zh ? `${tab === 'recommended' ? rows.length : installedRows.length} 个真实结果` : `${tab === 'recommended' ? rows.length : installedRows.length} live results`}</span>
        </div>
        <div data-paimind-skill-filterbar>
          {tab === 'recommended' ? <div data-paimind-skill-filters>
            <select data-paimind-skill-select-filter aria-label={zh ? '按来源筛选' : 'Filter by source'} value={sourceFilter} onChange={event => { setSourceFilter(event.currentTarget.value) }}><option value="all">{zh ? '全部来源' : 'All sources'}</option>{sources.map(source => <option key={source} value={source}>{source}</option>)}</select>
            <select data-paimind-skill-select-filter aria-label={zh ? '按安装状态筛选' : 'Filter by install status'} value={statusFilter} onChange={event => { setStatusFilter(event.currentTarget.value as typeof statusFilter) }}><option value="all">{zh ? '全部状态' : 'All statuses'}</option><option value="installed">{zh ? '已安装' : 'Installed'}</option><option value="available">{zh ? '可安装' : 'Available'}</option></select>
            <button type="button" data-paimind-skill-filter aria-pressed={favoriteOnly} onClick={() => { setFavoriteOnly(value => !value) }}>{favoriteOnly ? <PaimindFavoriteFillIcon size={15} /> : <PaimindFavoriteIcon size={15} />}{zh ? '只看收藏' : 'Favorites only'}</button>
          </div> : <span data-paimind-skill-result-count>{zh ? 'Harness 原生 Skill 目录的个人安装投影' : 'Personal install projection of the Harness-native Skill catalog'}</span>}
          {filtersActive && <button type="button" data-paimind-skill-inline-action onClick={resetFilters}>{zh ? '清除筛选' : 'Clear filters'}</button>}
        </div>

        {tab === 'recommended' ? <div data-paimind-skill-grid>
          <section data-paimind-skill-panel aria-label={zh ? '技能目录列表' : 'Catalog Skill list'}>{catalog.status === 'loading' ? <div data-paimind-skill-state aria-busy="true"><span data-paimind-skill-loading-dot />{zh ? '正在读取真实目录…' : 'Reading the live catalog…'}</div> : catalog.status === 'error' ? <div data-paimind-skill-state data-error="true" role="alert"><p>{catalog.error}</p><button type="button" data-paimind-skill-button onClick={() => { setRevision(value => value + 1) }}>{zh ? '重试' : 'Retry'}</button></div> : rows.length === 0 ? <div data-paimind-skill-state><p>{zh ? '没有匹配的 Skill。调整筛选或清除搜索即可继续。' : 'No matching Skills. Adjust filters or clear search to continue.'}</p><button type="button" data-paimind-skill-button onClick={resetFilters}>{zh ? '清除筛选' : 'Clear filters'}</button></div> : <ul data-paimind-skill-list>{rows.map(row => <li key={row.item.id} data-paimind-skill-row data-selected={detail?.id === row.item.id}><button type="button" data-paimind-skill-select onClick={() => { setSelected(row.item.id); setMobileDetailOpen(true) }} aria-label={`${zh ? '查看' : 'View'}: ${row.item.name}`}><span data-paimind-skill-row-icon><PaimindSkillIcon size={20} /></span><span data-paimind-skill-row-copy><span data-paimind-skill-name>{row.item.name}</span><span data-paimind-skill-description>{row.item.description}</span></span><span data-paimind-skill-policy>{installedNames.has(row.item.name) ? (zh ? '已安装' : 'Installed') : (zh ? '可安装' : 'Available')}</span></button><button type="button" data-paimind-skill-favorite aria-pressed={row.favorite} aria-label={`${row.favorite ? (zh ? '取消收藏' : 'Unfavorite') : (zh ? '收藏' : 'Favorite')}: ${row.item.name}`} onClick={() => { toggleFavorite(row.item.id) }}>{row.favorite ? <PaimindFavoriteFillIcon size={16} /> : <PaimindFavoriteIcon size={16} />}</button></li>)}</ul>}</section>
          <aside data-paimind-skill-panel data-paimind-skill-detail data-mobile-open={mobileDetailOpen} aria-label={zh ? '技能详情' : 'Skill details'}><button type="button" data-paimind-skill-mobile-close aria-label={zh ? '返回技能列表' : 'Back to Skill list'} onClick={() => { setMobileDetailOpen(false) }}><PaimindCloseIcon size={17} /></button>{detail === undefined ? <p>{zh ? '选择一个 Skill 查看详情。' : 'Select a Skill.'}</p> : <><span data-paimind-skill-detail-icon><PaimindSkillIcon size={25} /></span><div><h2>{detail.name}</h2><p data-paimind-skill-detail-subtitle>{detail.description}</p></div><div data-paimind-skill-statuses>{detailInstall !== undefined && <span data-paimind-skill-policy>{availabilityLabel(detail.name)}</span>}{detailInstall?.runtimeRequirements.length ? <span data-paimind-skill-policy data-warning="true">{zh ? '运行环境待确认' : 'Runtime setup to verify'}</span> : null}</div><details data-paimind-skill-disclosure><summary>{zh ? '来源与包信息' : 'Source and package details'}</summary><dl data-paimind-skill-meta><div data-paimind-skill-meta-row><dt>{zh ? '版本' : 'Version'}</dt><dd>{detail.version}</dd></div><div data-paimind-skill-meta-row><dt>{zh ? '来源' : 'Source'}</dt><dd>{detail.source}</dd></div><div data-paimind-skill-meta-row><dt>{zh ? '许可' : 'License'}</dt><dd>{detail.license}</dd></div><div data-paimind-skill-meta-row><dt>{zh ? '执行' : 'Execution'}</dt><dd>{zh ? 'Harness 原生 Skill Runtime' : 'Harness-native Skill Runtime'}</dd></div></dl></details><div data-paimind-skill-actions>{detailInstall === undefined ? <button type="button" data-paimind-skill-button data-primary="true" disabled={busy} onClick={() => { void inspectRecommended(detail) }}><PaimindCheckIcon size={14} />{zh ? '检查并安装' : 'Review and install'}</button> : <><button type="button" data-paimind-skill-button disabled={busy || detailCurrent} onClick={() => { void inspectRecommended(detail) }}><PaimindRefreshIcon size={14} />{detailCurrent ? (zh ? '目录版本已是最新' : 'Catalog version is current') : (zh ? '检查并更新' : 'Review update')}</button><button type="button" data-paimind-skill-button data-primary="true" title={availabilityLabel(detail.name)} disabled={!bindingAvailable || !runtimeSkills.names.has(detail.name)} onClick={() => { useSkill(detail.name) }}><PaimindNewConversationIcon size={14} />{zh ? '在当前对话使用' : 'Use in conversation'}</button></>}</div></>}</aside>
        </div> : installedRows.length === 0 ? <div data-paimind-skill-state><p>{zh ? '还没有已安装的个人 Skill。可从目录安装，或导入本地 SKILL.md / ZIP。' : 'No personal Skills installed. Install from the catalog or import a local SKILL.md / ZIP.'}</p><div data-paimind-skill-actions><button type="button" data-paimind-skill-button data-primary="true" onClick={activateAll}>{zh ? '浏览目录' : 'Browse catalog'}</button><button type="button" data-paimind-skill-button onClick={chooseUpload}>{zh ? '本地导入' : 'Import local'}</button></div></div> : <div data-paimind-skill-grid>
          <section data-paimind-skill-panel aria-label={zh ? '已安装技能列表' : 'Installed Skill list'}><ul data-paimind-skill-list>{installedRows.map(item => <li key={item.skillId} data-paimind-skill-row data-selected={installedDetail?.skillId === item.skillId}><button type="button" data-paimind-skill-select onClick={() => { setSelectedInstalled(item.skillId); setMobileDetailOpen(true) }} aria-label={`${zh ? '查看已安装' : 'View installed'}: ${item.name}`}><span data-paimind-skill-row-icon><PaimindSkillIcon size={20} /></span><span data-paimind-skill-row-copy><span data-paimind-skill-name>{item.name}</span><span data-paimind-skill-description>{item.description}</span></span><span data-paimind-skill-policy>{availabilityLabel(item.name)}</span></button></li>)}</ul></section>
          <aside data-paimind-skill-panel data-paimind-skill-detail data-mobile-open={mobileDetailOpen} aria-label={zh ? '已安装技能详情' : 'Installed Skill details'}><button type="button" data-paimind-skill-mobile-close aria-label={zh ? '返回已安装列表' : 'Back to installed list'} onClick={() => { setMobileDetailOpen(false) }}><PaimindCloseIcon size={17} /></button>{installedDetail !== undefined && <><span data-paimind-skill-detail-icon><PaimindSkillIcon size={25} /></span><div><h2>{installedDetail.name}</h2><p data-paimind-skill-detail-subtitle>{installedDetail.description}</p></div><div data-paimind-skill-statuses><span data-paimind-skill-policy>{availabilityLabel(installedDetail.name)}</span>{installedDetail.runtimeRequirements.length > 0 && <span data-paimind-skill-policy data-warning="true">{zh ? '运行环境待确认' : 'Runtime setup to verify'}</span>}</div>{installedDetail.whenToUse !== undefined && <p>{installedDetail.whenToUse}</p>}<details data-paimind-skill-disclosure><summary>{zh ? '安装与所有权信息' : 'Install and ownership details'}</summary><dl data-paimind-skill-meta><div data-paimind-skill-meta-row><dt>{zh ? '来源' : 'Source'}</dt><dd>{installedRecommended?.source ?? (zh ? '本地导入' : 'Local import')}</dd></div><div data-paimind-skill-meta-row><dt>{zh ? '管理' : 'Managed'}</dt><dd>{installedDetail.managed ? (zh ? 'PAIMind Installer 管理；支持备份卸载' : 'Managed by PAIMind Installer; recoverable uninstall') : (zh ? '外部安装；请回到原来源管理' : 'External install; manage from its original source')}</dd></div><div data-paimind-skill-meta-row><dt>{zh ? '执行' : 'Execution'}</dt><dd>{zh ? 'Harness 原生发现与执行' : 'Harness-native discovery and execution'}</dd></div></dl></details><div data-paimind-skill-actions><button type="button" data-paimind-skill-button data-primary="true" title={availabilityLabel(installedDetail.name)} disabled={!bindingAvailable || !runtimeSkills.names.has(installedDetail.name)} onClick={() => { useSkill(installedDetail.name) }}><PaimindNewConversationIcon size={14} />{zh ? '在当前对话使用' : 'Use in conversation'}</button><button type="button" data-paimind-skill-button onClick={() => { if (installedRecommended === undefined) chooseUpload(); else void inspectRecommended(installedRecommended) }} disabled={busy || installedCurrent}><PaimindRefreshIcon size={14} />{installedRecommended === undefined ? (zh ? '导入更新' : 'Import update') : installedCurrent ? (zh ? '目录版本已是最新' : 'Catalog version is current') : (zh ? '检查并更新' : 'Review update')}</button>{installedDetail.managed ? <button type="button" data-paimind-skill-button data-danger="true" disabled={busy} onClick={() => { setUninstallTarget(installedDetail) }}><PaimindTrashIcon size={14} />{zh ? '卸载' : 'Uninstall'}</button> : <button type="button" data-paimind-skill-button disabled title={zh ? '此 Skill 不由 PAIMind Installer 管理' : 'This Skill is not managed by PAIMind Installer'}>{zh ? '由原来源管理' : 'Managed externally'}</button>}</div></>}</aside>
        </div>}
      </section>
    </div>
    {uploadGuideOpen && <div data-paimind-skill-dialog-backdrop><section role="dialog" aria-modal="true" aria-labelledby="paimind-skill-import-guide-title" aria-describedby="paimind-skill-import-guide-copy" data-paimind-skill-dialog data-paimind-skill-import-guide onKeyDown={event => { handleDialogKey(event, () => { setUploadGuideOpen(false) }) }}>
      <div data-paimind-skill-dialog-head><span data-paimind-skill-detail-icon><PaimindUploadIcon size={24} /></span><div><p data-paimind-skill-eyebrow>{zh ? '本地个人导入' : 'Local personal import'}</p><h2 id="paimind-skill-import-guide-title">{zh ? '选择一个可识别的 Skill 包' : 'Choose a recognizable Skill package'}</h2></div></div>
      <p id="paimind-skill-import-guide-copy">{zh ? '导入前先确认包结构。选择文件后会先进行安全检查和预览，只有再次确认才会安装。' : 'Check the package structure first. After selection, PAIMind performs a safety review and preview before anything is installed.'}</p>
      <div data-paimind-skill-import-formats><section><strong>SKILL.md</strong><p>{zh ? '适合只有一份说明文件的 Skill。文件必须包含 YAML Frontmatter（至少 name 与 description）。' : 'For a single-file Skill. It must include YAML frontmatter with at least name and description.'}</p></section><section><strong>ZIP</strong><p>{zh ? '适合包含脚本、参考资料或资源的 Skill。ZIP 根目录必须能找到 SKILL.md。' : 'For Skills with scripts, references, or assets. SKILL.md must be discoverable at the ZIP root.'}</p></section></div>
      <div data-paimind-skill-import-tree aria-label={zh ? 'Skill 包结构示例' : 'Skill package structure example'}><code>my-skill/<br />├── SKILL.md <b>{zh ? '必需' : 'required'}</b><br />├── scripts/ <i>{zh ? '可选' : 'optional'}</i><br />├── references/ <i>{zh ? '可选' : 'optional'}</i><br />└── assets/ <i>{zh ? '可选' : 'optional'}</i></code></div>
      <ul data-paimind-skill-import-rules><li>{zh ? '不要包含密码、令牌或其他凭证。' : 'Do not include passwords, tokens, or other credentials.'}</li><li>{zh ? '本阶段只安装到当前用户的个人 Skill 范围。' : 'This phase installs only to the current user’s personal Skill scope.'}</li><li>{zh ? 'PAIMind 负责检查与安装；Harness 继续负责发现和执行。' : 'PAIMind reviews and installs; Harness remains responsible for discovery and execution.'}</li></ul>
      <div data-paimind-skill-dialog-actions><button ref={uploadGuidePrimary} type="button" data-paimind-skill-button data-primary="true" onClick={openUploadPicker}><PaimindUploadIcon size={14} />{zh ? '选择 Skill 包' : 'Choose Skill package'}</button><button type="button" data-paimind-skill-button onClick={() => { setUploadGuideOpen(false) }}>{zh ? '取消' : 'Cancel'}</button></div>
    </section></div>}
    {preview !== null && <div data-paimind-skill-dialog-backdrop><section role="dialog" aria-modal="true" aria-labelledby="paimind-skill-install-title" data-paimind-skill-dialog onKeyDown={event => { handleDialogKey(event, () => { if (!busy) setPreview(null) }) }}><div data-paimind-skill-dialog-head><span data-paimind-skill-detail-icon><PaimindSkillIcon size={24} /></span><div><p data-paimind-skill-eyebrow>{preview.operation === 'update' ? (zh ? '更新检查' : 'Update review') : (zh ? '安装检查' : 'Install review')}</p><h2 id="paimind-skill-install-title">{preview.operation === 'update' ? (zh ? `更新 ${preview.name}` : `Update ${preview.name}`) : (zh ? `安装 ${preview.name}` : `Install ${preview.name}`)}</h2></div></div><p>{preview.description}</p><dl data-paimind-skill-review-grid><div><dt>{zh ? '文件' : 'Files'}</dt><dd>{preview.fileCount}</dd></div><div><dt>{zh ? '解压大小' : 'Expanded'}</dt><dd>{new Intl.NumberFormat(locale).format(preview.expandedBytes)} B</dd></div><div><dt>{zh ? '操作' : 'Operation'}</dt><dd>{preview.operation === 'update' ? (zh ? '原子替换' : 'Atomic replace') : (zh ? '全新安装' : 'New install')}</dd></div></dl>{preview.operation === 'update' && <p data-paimind-skill-safe-copy>{zh ? '更新失败时 Installer 会恢复旧版本；成功后旧版本进入可恢复备份。' : 'The Installer restores the previous version if update fails; after success, the prior version remains recoverable.'}</p>}{preview.runtimeRequirements.length > 0 && <p data-paimind-skill-warning><PaimindWarningIcon size={14} />{zh ? `运行环境待确认：${preview.runtimeRequirements.map(value => value === 'python' ? 'Python 依赖' : value === 'node' ? 'Node.js 依赖' : '系统依赖').join('、')}。安装完成不代表依赖已就绪。` : `Runtime setup to verify: ${preview.runtimeRequirements.join(', ')}. Installed does not mean runtime-ready.`}</p>}{preview.warnings.map(value => <p key={value} data-paimind-skill-warning><PaimindWarningIcon size={14} />{value}</p>)}<div data-paimind-skill-dialog-actions><button ref={previewPrimary} type="button" data-paimind-skill-button data-primary="true" disabled={busy} onClick={() => { void confirmInstall() }}><PaimindCheckIcon size={14} />{preview.operation === 'update' ? (zh ? '确认更新' : 'Confirm update') : (zh ? '确认安装' : 'Confirm install')}</button><button type="button" data-paimind-skill-button disabled={busy} onClick={() => { setPreview(null) }}>{zh ? '取消' : 'Cancel'}</button></div></section></div>}
    {uninstallTarget !== null && <div data-paimind-skill-dialog-backdrop><section role="dialog" aria-modal="true" aria-labelledby="paimind-skill-uninstall-title" data-paimind-skill-dialog onKeyDown={event => { handleDialogKey(event, () => { if (!busy) setUninstallTarget(null) }) }}><div data-paimind-skill-dialog-head data-danger="true"><span data-paimind-skill-detail-icon><PaimindTrashIcon size={22} /></span><div><p data-paimind-skill-eyebrow>{zh ? '可恢复卸载' : 'Recoverable uninstall'}</p><h2 id="paimind-skill-uninstall-title">{zh ? `卸载 ${uninstallTarget.name}` : `Uninstall ${uninstallTarget.name}`}</h2></div></div><p>{zh ? 'Skill 将从 Harness 发现目录移出，并保存在 PAIMind 备份区。对话历史不会被删除；如需恢复，可从备份回退。' : 'The Skill will leave Harness discovery and move to the PAIMind backup area. Conversation history is not deleted; the backup can be used for recovery.'}</p><div data-paimind-skill-dialog-actions><button ref={uninstallPrimary} type="button" data-paimind-skill-button data-danger="true" disabled={busy} onClick={() => { void uninstall() }}><PaimindTrashIcon size={14} />{zh ? '带备份卸载' : 'Uninstall with backup'}</button><button type="button" data-paimind-skill-button disabled={busy} onClick={() => { setUninstallTarget(null) }}>{zh ? '保留 Skill' : 'Keep Skill'}</button></div></section></div>}
  </section>
}

export function SkillCenterTrigger(props: {
  readonly wide: boolean
  readonly controller: PaimindProductSurfaceController
  readonly locale: PaimindLocaleSource
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot, props.controller.getSnapshot)
  const locale = useSyncExternalStore(props.locale.subscribe.bind(props.locale), () => props.locale.getLocale().active, () => props.locale.getLocale().active)
  const zh = locale.startsWith('zh')
  return <button
    type="button"
    data-paimind-skill-trigger
    data-paimind-product-trigger="skill-center"
    data-wide={props.wide}
    aria-expanded={snapshot.open}
    aria-label={zh ? '打开技能中心' : 'Open Skill Center'}
    onClick={event => { props.controller.toggle(event.currentTarget) }}
  >
    <PaimindSkillIcon size={props.wide ? 16 : 18} />
    {props.wide && <span data-paimind-skill-trigger-label>{zh ? '技能中心' : 'Skill Center'}</span>}
  </button>
}

export interface SkillCenterSurfaceProps extends Omit<SkillMarketSectionProps, 'close'> {
  readonly controller: PaimindProductSurfaceController
}

export function SkillCenterSurface(props: SkillCenterSurfaceProps): ReactNode {
  const snapshot = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot, props.controller.getSnapshot)
  const locale = useSyncExternalStore(props.locale.subscribe.bind(props.locale), () => props.locale.getLocale().active, () => props.locale.getLocale().active)
  const root = useRef<HTMLDivElement>(null)
  const zh = locale.startsWith('zh')
  const agentAvailable = snapshot.open && isPaimindProductSurfaceAvailable('agent-center')

  useEffect(() => {
    if (!snapshot.open || root.current === null) return
    return installPaimindProductSurfaceInteraction(root.current, props.controller)
  }, [props.controller, snapshot.open])

  if (!snapshot.open) return null
  return createPortal(<div ref={root} data-paimind-product-surface="skill-center" role="dialog" aria-modal="true" aria-labelledby="paimind-skill-center-title">
    <header data-paimind-product-bar>
      <div data-paimind-product-brand><span data-paimind-product-brand-icon><PaimindSkillIcon size={18} /></span><span>PAIMind</span></div>
      <nav data-paimind-product-switcher aria-label={zh ? 'PAIMind 产品中心' : 'PAIMind product centers'}>
        <button type="button" data-paimind-product-switch disabled={!agentAvailable} onClick={() => { requestPaimindProductSurface('agent-center') }}><PaimindAgentIcon size={15} /><span>{zh ? '智能体中心' : 'Agent Center'}</span></button>
        <button type="button" data-paimind-product-switch aria-current="page"><PaimindSkillIcon size={15} /><span>{zh ? '技能中心' : 'Skill Center'}</span></button>
      </nav>
      <div data-paimind-product-bar-actions>
        <button type="button" data-paimind-product-return onClick={() => { props.controller.close() }}><PaimindNewConversationIcon size={15} /><span>{zh ? '返回对话' : 'Back to conversation'}</span></button>
        <button type="button" data-paimind-product-close aria-label={zh ? '关闭技能中心' : 'Close Skill Center'} onClick={() => { props.controller.close() }}><PaimindCloseIcon size={16} /></button>
      </div>
    </header>
    <main data-paimind-product-body><SkillMarketSection {...props} close={() => { props.controller.close() }} /></main>
  </div>, document.body)
}

class SkillMarketBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('[paimind-skill-market]', error, info) }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

export async function apply(ctx: SkillMarketClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const mounted = ctx.inject([...BASE_INJECT, 'remote.paimindSkillInstaller'], scope => {
    const installer = scope.remote.paimindSkillInstaller
    if (installer === undefined) throw new Error('PAIMind Skill Installer Remote did not mount')
    const surfaceController = new PaimindProductSurfaceController('skill-center')
    scope.effect(installSkillMarketStyle, 'paimind-skill-market: style')
    scope.effect(() => () => { surfaceController.dispose() }, 'paimind-skill-market: surface controller')
    contributePaimindExtension(scope.slots, {
      id: 'paimind:skill-market', packageName: '@paimind/skill-market', category: 'skills-tools',
      nameZh: '技能中心', nameEn: 'Skill Center',
      descriptionZh: '发现、安装和管理由 Harness 原生执行的个人技能。',
      descriptionEn: 'Discover, install, and manage personal Skills executed natively by Harness.',
      surface: 'shell', maturity: 'available', order: 30,
    })
    const api = scope.get('connection').api.skills
    const storage = usableStorage(typeof window === 'undefined' ? undefined : window.localStorage)
    const injectProps = () => ({
      controller: surfaceController,
      api,
      installer,
      sessions: scope.sessions,
      conversation: scope.conversation,
      locale: scope.locale,
      ...(storage === undefined ? {} : { storage }),
    })
    scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
      name: 'sidebar.footer.action', id: 'paimind-skill-center-trigger', order: -11,
      label: () => scope.locale.getLocale().active.startsWith('zh') ? '技能中心' : 'Skill Center',
      inject: () => ({ controller: surfaceController, locale: scope.locale }),
    }, (props: { readonly wide: boolean; readonly controller: PaimindProductSurfaceController; readonly locale: PaimindLocaleSource }) => <SkillMarketBoundary><SkillCenterTrigger {...props} /></SkillMarketBoundary>))
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay', id: 'paimind-skill-center-surface', order: 11, inject: injectProps,
    }, (props: SkillCenterSurfaceProps) => <SkillMarketBoundary><SkillCenterSurface {...props} /></SkillMarketBoundary>))
  }, 'paimind-skill-market: full-page product surface')
  try { await mounted } catch (error) { await disposeRemote(); throw error }
  return async () => { await mounted.dispose(); await disposeRemote() }
}
