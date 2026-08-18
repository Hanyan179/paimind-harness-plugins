import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
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
const STYLE = `
[data-paimind-skill-market]{box-sizing:border-box;min-height:100%;padding:24px;color:var(--dsw-alias-label-primary,#202124);font:inherit}
[data-paimind-skill-market] *{box-sizing:border-box}
[data-paimind-skill-market] h2{margin:0;font-size:22px;line-height:30px}
[data-paimind-skill-market] p{overflow-wrap:anywhere}
[data-paimind-skill-intro]{margin:5px 0 15px;max-width:760px;color:var(--dsw-alias-label-secondary,#626872);font-size:13px;line-height:20px}
[data-paimind-skill-head]{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
[data-paimind-skill-tabs],[data-paimind-skill-filters]{display:flex;gap:6px;overflow:auto;list-style:none;margin:0;padding:0}
[data-paimind-skill-tab],[data-paimind-skill-filter],[data-paimind-skill-button]{min-height:34px;padding:7px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.24));border-radius:9px;color:var(--dsw-alias-label-secondary,#626872);background:transparent;font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
[data-paimind-skill-tab][aria-selected='true'],[data-paimind-skill-filter][aria-pressed='true']{border-color:var(--dsw-alias-state-business-primary,#4f7ff8);color:var(--dsw-alias-state-business-primary,#4f7ff8);background:color-mix(in srgb,currentColor 8%,transparent)}
[data-paimind-skill-button][data-primary='true']{border-color:transparent;color:#fff;background:var(--dsw-alias-state-business-primary,#4f7ff8)}
[data-paimind-skill-button][data-danger='true']{color:var(--dsw-alias-state-error-primary,#d04444)}
[data-paimind-skill-button]:disabled{opacity:.48;cursor:not-allowed}
[data-paimind-skill-toolbar]{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:14px 0 12px}
[data-paimind-skill-toolbar] input{min-width:220px;min-height:36px;flex:1;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.24));border-radius:9px;color:inherit;background:transparent;font:inherit}
[data-paimind-skill-grid]{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(260px,.8fr);gap:14px;align-items:start}
[data-paimind-skill-panel]{min-width:0;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:14px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.025));overflow:hidden}
[data-paimind-skill-list]{list-style:none;margin:0;padding:6px;display:grid;gap:4px;max-height:560px;overflow:auto}
[data-paimind-skill-row]{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;padding:10px;border-radius:10px}
[data-paimind-skill-row][data-selected='true']{background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08))}
[data-paimind-skill-select]{min-width:0;padding:0;text-align:left;border:0;color:inherit;background:transparent;font:inherit;cursor:pointer}
[data-paimind-skill-name]{display:block;font-size:13px;font-weight:650;line-height:20px;overflow-wrap:anywhere}
[data-paimind-skill-description]{display:block;margin-top:2px;color:var(--dsw-alias-label-secondary,#626872);font-size:11px;line-height:17px;overflow-wrap:anywhere}
[data-paimind-skill-policy]{display:inline-block;margin-top:6px;padding:2px 7px;border-radius:999px;color:var(--dsw-alias-state-business-primary,#4f7ff8);background:color-mix(in srgb,currentColor 9%,transparent);font-size:10px;line-height:16px}
[data-paimind-skill-favorite]{width:32px;height:32px;padding:0;border:0;border-radius:8px;color:var(--dsw-alias-label-tertiary,#7a808a);background:transparent;font-size:17px;cursor:pointer}
[data-paimind-skill-favorite][aria-pressed='true']{color:#e89b19;background:color-mix(in srgb,#e89b19 12%,transparent)}
[data-paimind-skill-detail]{padding:15px;display:grid;gap:12px}
[data-paimind-skill-detail] h3{margin:0;font-size:16px;line-height:23px;overflow-wrap:anywhere}
[data-paimind-skill-detail] p{margin:0;color:var(--dsw-alias-label-secondary,#626872);font-size:12px;line-height:19px}
[data-paimind-skill-actions]{display:flex;gap:8px;flex-wrap:wrap}
[data-paimind-skill-state]{padding:20px;color:var(--dsw-alias-label-secondary,#626872);font-size:12px;line-height:19px}
[data-paimind-skill-state][data-error='true']{color:var(--dsw-alias-state-error-primary,#d04444)}
[data-paimind-skill-preview]{margin:12px 0;padding:14px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 45%,transparent);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 6%,transparent)}
[data-paimind-skill-preview] h3{margin:0 0 5px;font-size:15px}
[data-paimind-skill-preview] p{margin:3px 0;color:var(--dsw-alias-label-secondary,#626872);font-size:12px;line-height:18px}
[data-paimind-skill-warning]{color:#d78118!important}
[data-paimind-skill-installed]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;list-style:none;margin:0;padding:0}
[data-paimind-skill-installed] li{display:grid;gap:9px;min-width:0;padding:14px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:12px}
[data-paimind-skill-installed] h3{margin:0;font-size:14px;overflow-wrap:anywhere}
[data-paimind-skill-installed] p{margin:0;color:var(--dsw-alias-label-secondary,#626872);font-size:12px;line-height:18px}
@media(max-width:760px){[data-paimind-skill-market]{padding:16px 12px}[data-paimind-skill-grid]{grid-template-columns:1fr}[data-paimind-skill-list]{max-height:340px}[data-paimind-skill-installed]{grid-template-columns:1fr}}
`

export function installSkillMarketStyle(): () => void {
  const existing = document.getElementById(STYLE_ID)
  const style = existing?.tagName === 'STYLE' ? existing as HTMLStyleElement : document.createElement('style')
  if (existing?.tagName !== 'STYLE') {
    style.id = STYLE_ID
    style.dataset.paimindPlugin = STYLE_ID
    document.head.append(style)
  }
  style.textContent = `${STYLE}\n${SKILL_CENTER_STYLE}`
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [pendingDiscovery, setPendingDiscovery] = useState<string | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const uploadAbort = useRef<AbortController | null>(null)

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
        if (delay === undefined) return
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

  const bindingAvailable = sessionId !== undefined && props.sessions.binding?.(sessionId)?.ctx !== undefined
  const installedNames = useMemo(() => new Set(installed.map(item => item.name)), [installed])
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
  const chooseUpload = (): void => { uploadRef.current?.click() }
  const inspectFile = async (file: File): Promise<void> => {
    uploadAbort.current?.abort()
    const controller = new AbortController(); uploadAbort.current = controller
    setBusy(true); setError(null); setPreview(null)
    try {
      const upload = await uploadSkill(file, controller.signal)
      setPreview(remoteValue(await props.installer.inspectUpload({ uploadId: upload.uploadId })))
    } catch (reason) {
      if ((reason as { name?: string }).name !== 'AbortError') setError(messageOf(reason))
    } finally { setBusy(false); uploadAbort.current = null }
  }
  const confirmInstall = async (): Promise<void> => {
    if (preview === null) return
    setBusy(true); setError(null)
    try {
      remoteValue(await props.installer.installUpload({ uploadId: preview.uploadId, digest: preview.digest }))
      setPendingDiscovery(preview.name); setPreview(null); setRevision(value => value + 1); setTab('installed')
    } catch (reason) { setError(messageOf(reason)) } finally { setBusy(false) }
  }
  const uninstall = async (item: SkillInstallRecord): Promise<void> => {
    if (!item.managed || !window.confirm(zh ? `卸载“${item.name}”？已安装内容会保留在可恢复备份中。` : `Uninstall “${item.name}”? A recoverable backup will be kept.`)) return
    setBusy(true); setError(null)
    try {
      remoteValue(await props.installer.uninstall({ skillId: item.skillId, version: item.digest }))
      setRevision(value => value + 1)
    } catch (reason) { setError(messageOf(reason)) } finally { setBusy(false) }
  }

  const availabilityLabel = (name: string): string => {
    if (runtimeSkills.status === 'no-session') return zh ? '打开对话后检查可用性' : 'Open a conversation to check'
    if (runtimeSkills.status === 'loading') return zh ? '正在检查当前对话' : 'Checking current conversation'
    if (runtimeSkills.status === 'error') return zh ? '当前对话可用性未知' : 'Availability unknown'
    return runtimeSkills.names.has(name) ? (zh ? '当前对话可用' : 'Available now') : (zh ? '当前对话不可用' : 'Unavailable in this conversation')
  }

  const favoriteCount = catalog.status === 'ready' ? catalog.items.filter(item => favoriteIds.includes(item.id)).length : 0
  const activateAll = (): void => { setTab('recommended'); setFavoriteOnly(false); setStatusFilter('all') }
  const activateInstalled = (): void => { setTab('installed'); setFavoriteOnly(false) }
  const activateFavorites = (): void => { setTab('recommended'); setFavoriteOnly(true) }

  return <section data-paimind-skill-market aria-label={zh ? '技能中心' : 'Skill Center'}>
    <header data-paimind-skill-hero>
      <div><p data-paimind-skill-eyebrow><PaimindSkillIcon size={16} />{zh ? '技能中心 · 能力目录' : 'Skill Center · Capability catalog'}</p><h1 id="paimind-skill-center-title" tabIndex={-1} data-paimind-product-initial-focus>{zh ? '技能中心' : 'Skill Center'}</h1><p data-paimind-skill-intro>{zh ? '发现、安装和管理个人技能。目录独立于当前对话；安装完成后由 Harness 原生发现并执行。' : 'Discover, install, and manage personal Skills. The catalog is conversation-independent; Harness discovers and executes installed Skills natively.'}</p></div>
      <div data-paimind-skill-head-actions><button type="button" data-paimind-skill-button data-primary="true" onClick={chooseUpload} disabled={busy}><PaimindUploadIcon size={15} />{busy ? (zh ? '处理中…' : 'Working…') : (zh ? '本地导入' : 'Import local')}</button></div>
    </header>
    <input ref={uploadRef} hidden type="file" accept=".zip,.md" aria-label={zh ? '选择技能包' : 'Choose Skill package'} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file !== undefined) void inspectFile(file) }} />
    {preview !== null && <section data-paimind-skill-preview aria-label={zh ? '安装确认' : 'Install confirmation'}><div data-paimind-skill-preview-head><span data-paimind-skill-detail-icon><PaimindSkillIcon size={24} /></span><div><h2>{preview.operation === 'update' ? (zh ? `更新 ${preview.name}` : `Update ${preview.name}`) : (zh ? `安装 ${preview.name}` : `Install ${preview.name}`)}</h2><p>{preview.description}</p><p>{zh ? `${preview.fileCount} 个文件 · 解压后 ${new Intl.NumberFormat(locale).format(preview.expandedBytes)} 字节` : `${preview.fileCount} files · ${new Intl.NumberFormat(locale).format(preview.expandedBytes)} bytes expanded`}</p></div></div>{preview.runtimeRequirements.length > 0 && <p data-paimind-skill-warning><PaimindWarningIcon size={14} />{zh ? `需要确认运行环境：${preview.runtimeRequirements.map(value => value === 'python' ? 'Python 依赖' : value === 'node' ? 'Node.js 依赖' : '系统依赖').join('、')}。安装成功不代表依赖已就绪。` : `Runtime setup must be checked: ${preview.runtimeRequirements.join(', ')}. Installed does not mean runtime-ready.`}</p>}{preview.warnings.map(value => <p key={value} data-paimind-skill-warning><PaimindWarningIcon size={14} />{value}</p>)}<div data-paimind-skill-actions><button type="button" data-paimind-skill-button data-primary="true" disabled={busy} onClick={() => { void confirmInstall() }}><PaimindCheckIcon size={14} />{zh ? '确认安装' : 'Confirm'}</button><button type="button" data-paimind-skill-button disabled={busy} onClick={() => { setPreview(null) }}>{zh ? '取消' : 'Cancel'}</button></div></section>}
    {error !== null && <div role="alert" data-paimind-skill-state data-error="true">{error}</div>}

    <div data-paimind-skill-workspace>
      <aside data-paimind-skill-scope aria-label={zh ? '技能范围' : 'Skill scope'}><p data-paimind-skill-scope-title>{zh ? '范围' : 'Scope'}</p><div data-paimind-skill-scope-list>
        <button type="button" data-paimind-skill-scope-button aria-pressed={tab === 'recommended' && !favoriteOnly && statusFilter === 'all'} onClick={activateAll}><PaimindSkillIcon size={16} />{zh ? '全部技能' : 'All Skills'}<span data-paimind-skill-scope-count>{catalog.status === 'ready' ? catalog.items.length : 0}</span></button>
        <button type="button" data-paimind-skill-scope-button aria-pressed={tab === 'installed'} onClick={activateInstalled}><PaimindCheckIcon size={16} />{zh ? '已安装' : 'Installed'}<span data-paimind-skill-scope-count>{installed.length}</span></button>
        <button type="button" data-paimind-skill-scope-button aria-pressed={tab === 'recommended' && favoriteOnly} onClick={activateFavorites}><PaimindFavoriteIcon size={16} />{zh ? '收藏' : 'Favorites'}<span data-paimind-skill-scope-count>{favoriteCount}</span></button>
      </div></aside>

      <section data-paimind-skill-catalog aria-label={zh ? '技能目录' : 'Skill catalog'}>
        <div data-paimind-skill-toolbar>
          <div data-paimind-skill-search-wrap><span data-paimind-skill-search-icon><PaimindSearchIcon size={17} /></span><input type="search" aria-label={zh ? '搜索技能' : 'Search Skills'} value={query} onChange={event => { setQuery(event.currentTarget.value) }} placeholder={zh ? '搜索名称、说明或来源' : 'Search name, description, or source'} /></div>
          <div role="tablist" data-paimind-skill-tabs><button role="tab" type="button" data-paimind-skill-tab aria-selected={tab === 'recommended'} onClick={() => { setTab('recommended') }}>{zh ? '推荐技能' : 'Recommended'}</button><button role="tab" type="button" data-paimind-skill-tab aria-selected={tab === 'installed'} onClick={() => { setTab('installed'); setFavoriteOnly(false) }}>{zh ? '已安装' : 'Installed'}</button></div>
        </div>
        <div data-paimind-skill-filterbar>
          {tab === 'recommended' ? <div data-paimind-skill-filters>
            <select data-paimind-skill-select-filter aria-label={zh ? '按来源筛选' : 'Filter by source'} value={sourceFilter} onChange={event => { setSourceFilter(event.currentTarget.value) }}><option value="all">{zh ? '全部来源' : 'All sources'}</option>{sources.map(source => <option key={source} value={source}>{source}</option>)}</select>
            <select data-paimind-skill-select-filter aria-label={zh ? '按安装状态筛选' : 'Filter by install status'} value={statusFilter} onChange={event => { setStatusFilter(event.currentTarget.value as typeof statusFilter) }}><option value="all">{zh ? '全部状态' : 'All statuses'}</option><option value="installed">{zh ? '已安装' : 'Installed'}</option><option value="available">{zh ? '可安装' : 'Available'}</option></select>
            <button type="button" data-paimind-skill-filter aria-pressed={favoriteOnly} onClick={() => { setFavoriteOnly(value => !value) }}>{favoriteOnly ? <PaimindFavoriteFillIcon size={15} /> : <PaimindFavoriteIcon size={15} />}{zh ? '只看收藏' : 'Favorites only'}</button>
          </div> : <span data-paimind-skill-result-count>{zh ? '已安装的个人技能' : 'Installed personal Skills'}</span>}
          <span data-paimind-skill-result-count>{zh ? `${tab === 'recommended' ? rows.length : installedRows.length} 个真实结果` : `${tab === 'recommended' ? rows.length : installedRows.length} live results`}</span>
        </div>

        {tab === 'recommended' ? <div data-paimind-skill-grid>
          <section data-paimind-skill-panel aria-label={zh ? '推荐技能列表' : 'Recommended Skill list'}>{catalog.status === 'loading' ? <div data-paimind-skill-state aria-busy="true">{zh ? '正在读取推荐技能…' : 'Reading recommendations…'}</div> : catalog.status === 'error' ? <div data-paimind-skill-state data-error="true" role="alert">{catalog.error}</div> : rows.length === 0 ? <div data-paimind-skill-state>{zh ? '没有匹配的推荐技能。' : 'No matching recommendations.'}</div> : <ul data-paimind-skill-list>{rows.map(row => <li key={row.item.id} data-paimind-skill-row data-selected={detail?.id === row.item.id}><button type="button" data-paimind-skill-select onClick={() => { setSelected(row.item.id) }} aria-label={`${zh ? '查看' : 'View'}: ${row.item.name}`}><span data-paimind-skill-row-icon><PaimindSkillIcon size={20} /></span><span data-paimind-skill-row-copy><span data-paimind-skill-name>{row.item.name}</span><span data-paimind-skill-description>{row.item.description}</span></span><span data-paimind-skill-policy>{installedNames.has(row.item.name) ? (zh ? '已安装' : 'Installed') : (zh ? '可安装' : 'Available')}</span></button><button type="button" data-paimind-skill-favorite aria-pressed={row.favorite} aria-label={`${row.favorite ? (zh ? '取消收藏' : 'Unfavorite') : (zh ? '收藏' : 'Favorite')}: ${row.item.name}`} onClick={() => { toggleFavorite(row.item.id) }}>{row.favorite ? <PaimindFavoriteFillIcon size={16} /> : <PaimindFavoriteIcon size={16} />}</button></li>)}</ul>}</section>
          <aside data-paimind-skill-panel data-paimind-skill-detail aria-label={zh ? '技能详情' : 'Skill details'}>{detail === undefined ? <p>{zh ? '选择一个技能查看详情。' : 'Select a Skill.'}</p> : <><span data-paimind-skill-detail-icon><PaimindSkillIcon size={25} /></span><h2>{detail.name}</h2><p>{detail.description}</p><dl data-paimind-skill-meta><div data-paimind-skill-meta-row><dt>{zh ? '版本' : 'Version'}</dt><dd>{detail.version}</dd></div><div data-paimind-skill-meta-row><dt>{zh ? '来源' : 'Source'}</dt><dd>{detail.source}</dd></div><div data-paimind-skill-meta-row><dt>{zh ? '许可' : 'License'}</dt><dd>{detail.license}</dd></div></dl>{installedNames.has(detail.name) && <span data-paimind-skill-policy>{availabilityLabel(detail.name)}</span>}<div data-paimind-skill-actions>{!installedNames.has(detail.name) ? <button type="button" data-paimind-skill-button data-primary="true" disabled={busy} onClick={() => { void inspectRecommended(detail) }}><PaimindCheckIcon size={14} />{zh ? '检查并安装' : 'Review and install'}</button> : <><button type="button" data-paimind-skill-button disabled={busy} onClick={() => { void inspectRecommended(detail) }}><PaimindRefreshIcon size={14} />{zh ? '检查更新' : 'Check update'}</button><button type="button" data-paimind-skill-button data-primary="true" title={availabilityLabel(detail.name)} disabled={!bindingAvailable || !runtimeSkills.names.has(detail.name)} onClick={() => { useSkill(detail.name) }}><PaimindNewConversationIcon size={14} />{zh ? '在当前对话使用' : 'Use in conversation'}</button></>}</div></>}</aside>
        </div> : installedRows.length === 0 ? <div data-paimind-skill-state>{zh ? '还没有已安装的个人技能。' : 'No personal Skills installed.'}</div> : <ul data-paimind-skill-installed>{installedRows.map(item => { const recommended = recommendedByName.get(item.name); return <li key={item.skillId}><div data-paimind-skill-installed-card-head><span data-paimind-skill-row-icon><PaimindSkillIcon size={20} /></span><h2>{item.name}</h2></div><p>{item.description}</p>{item.whenToUse !== undefined && <p>{item.whenToUse}</p>}<div><span data-paimind-skill-policy>{availabilityLabel(item.name)}</span>{item.runtimeRequirements.length > 0 && <span data-paimind-skill-policy>{zh ? '运行环境待确认' : 'Runtime setup to verify'}</span>}</div><div data-paimind-skill-actions><button type="button" data-paimind-skill-button data-primary="true" title={availabilityLabel(item.name)} disabled={!bindingAvailable || !runtimeSkills.names.has(item.name)} onClick={() => { useSkill(item.name) }}><PaimindNewConversationIcon size={14} />{zh ? '在当前对话使用' : 'Use in conversation'}</button><button type="button" data-paimind-skill-button onClick={() => { if (recommended === undefined) chooseUpload(); else void inspectRecommended(recommended) }} disabled={busy}><PaimindRefreshIcon size={14} />{recommended === undefined ? (zh ? '本地更新' : 'Import update') : (zh ? '检查更新' : 'Check update')}</button>{item.managed && <button type="button" data-paimind-skill-button data-danger="true" aria-label={`${zh ? '卸载' : 'Uninstall'} ${item.name}`} disabled={busy} onClick={() => { void uninstall(item) }}><PaimindTrashIcon size={14} /></button>}</div></li> })}</ul>}
      </section>
    </div>
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
