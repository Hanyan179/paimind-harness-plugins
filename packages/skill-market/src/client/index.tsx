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
import {
  contributePaimindExtension,
  type HarnessConversationDraftService,
  type HarnessRemoteMountService,
  type HarnessRemoteResult,
  type HarnessSessionService,
  type HarnessSettingsSectionOwnerProps,
  type HarnessSkillsApi,
  type PaimindClientContext,
  type PaimindLocaleSource,
} from '@paimind/harness-compat'
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

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID; style.dataset.paimindPlugin = STYLE_ID; style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
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

export interface SkillMarketSectionProps extends HarnessSettingsSectionOwnerProps {
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
  const [selected, setSelected] = useState<string | null>(null)
  const [favoriteIds, setFavoriteIds] = useState<readonly string[]>(() => parseFavoriteSkillNames(props.storage?.getItem(SKILL_FAVORITES_STORAGE_KEY) ?? null))
  const [preview, setPreview] = useState<SkillUploadPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const uploadRef = useRef<HTMLInputElement>(null)
  const uploadAbort = useRef<AbortController | null>(null)

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
    void props.api.list({ sessionId }, controller.signal).then(response => {
      if (!current) return
      if (!response.result.ok) setRuntimeSkills({ status: 'error', names: new Set() })
      else setRuntimeSkills({ status: 'ready', names: new Set(response.result.value.skills.map(skill => skill.name)) })
    }, reason => { if (current && (reason as { name?: string }).name !== 'AbortError') setRuntimeSkills({ status: 'error', names: new Set() }) })
    return () => { current = false; controller.abort() }
  }, [agentPreset, props.api, revision, sessionId])

  const rows = useMemo(() => catalog.status !== 'ready' ? [] : catalog.items
    .filter(item => query.trim() === '' || `${item.name} ${item.description} ${item.source}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .map((item, sourceIndex) => ({ item, sourceIndex, favorite: favoriteIds.includes(item.id) }))
    .sort((left, right) => left.favorite === right.favorite ? left.sourceIndex - right.sourceIndex : left.favorite ? -1 : 1), [catalog, favoriteIds, query])
  const detail = rows.find(row => row.item.id === selected)?.item ?? rows[0]?.item
  const installedRows = useMemo(() => installed.filter(item => query.trim() === '' || `${item.name} ${item.description} ${item.whenToUse ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [installed, query])
  const bindingAvailable = sessionId !== undefined && props.sessions.binding?.(sessionId)?.ctx !== undefined
  const installedNames = useMemo(() => new Set(installed.map(item => item.name)), [installed])
  const recommendedByName = useMemo(() => new Map((catalog.status === 'ready' ? catalog.items : []).map(item => [item.name, item])), [catalog])

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
      setPreview(null); setRevision(value => value + 1); setTab('installed')
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

  return <section data-paimind-skill-market aria-label={zh ? '技能市场' : 'Skill Market'}>
    <div data-paimind-skill-head><div><h2>{zh ? '技能市场' : 'Skill Market'}</h2><p data-paimind-skill-intro>{zh ? '安装和管理个人技能。推荐目录不依赖当前对话；安装后由 Harness 自动发现并执行。' : 'Install and manage personal Skills. Recommendations do not depend on the current conversation; Harness discovers and executes installed Skills.'}</p></div><button type="button" data-paimind-skill-button data-primary="true" onClick={chooseUpload} disabled={busy}>{busy ? (zh ? '处理中…' : 'Working…') : (zh ? '本地导入' : 'Import')}</button></div>
    <div role="tablist" data-paimind-skill-tabs><button role="tab" type="button" data-paimind-skill-tab aria-selected={tab === 'recommended'} onClick={() => { setTab('recommended') }}>{zh ? '推荐技能' : 'Recommended'}</button><button role="tab" type="button" data-paimind-skill-tab aria-selected={tab === 'installed'} onClick={() => { setTab('installed') }}>{zh ? '已安装' : 'Installed'}</button></div>
    <input ref={uploadRef} hidden type="file" accept=".zip,.md" aria-label={zh ? '选择技能包' : 'Choose Skill package'} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file !== undefined) void inspectFile(file) }} />
    {preview !== null && <section data-paimind-skill-preview aria-label={zh ? '安装确认' : 'Install confirmation'}><h3>{preview.operation === 'update' ? (zh ? `更新 ${preview.name}` : `Update ${preview.name}`) : (zh ? `安装 ${preview.name}` : `Install ${preview.name}`)}</h3><p>{preview.description}</p><p>{zh ? `${preview.fileCount} 个文件 · 解压后 ${new Intl.NumberFormat(locale).format(preview.expandedBytes)} 字节` : `${preview.fileCount} files · ${new Intl.NumberFormat(locale).format(preview.expandedBytes)} bytes expanded`}</p>{preview.warnings.map(value => <p key={value} data-paimind-skill-warning>⚠ {value}</p>)}<div data-paimind-skill-actions><button type="button" data-paimind-skill-button data-primary="true" disabled={busy} onClick={() => { void confirmInstall() }}>{zh ? '确认安装' : 'Confirm'}</button><button type="button" data-paimind-skill-button disabled={busy} onClick={() => { setPreview(null) }}>{zh ? '取消' : 'Cancel'}</button></div></section>}
    {error !== null && <div role="alert" data-paimind-skill-state data-error="true">{error}</div>}
    <div data-paimind-skill-toolbar><input type="search" aria-label={zh ? '搜索技能' : 'Search Skills'} value={query} onChange={event => { setQuery(event.currentTarget.value) }} placeholder={zh ? '搜索名称、说明或来源' : 'Search name, description, or source'} /></div>
    {tab === 'recommended' ? <div data-paimind-skill-grid>
      <section data-paimind-skill-panel aria-label={zh ? '推荐技能列表' : 'Recommended Skill list'}>{catalog.status === 'loading' ? <div data-paimind-skill-state aria-busy="true">{zh ? '正在读取推荐技能…' : 'Reading recommendations…'}</div> : catalog.status === 'error' ? <div data-paimind-skill-state data-error="true" role="alert">{catalog.error}</div> : rows.length === 0 ? <div data-paimind-skill-state>{zh ? '没有匹配的推荐技能。' : 'No matching recommendations.'}</div> : <ul data-paimind-skill-list>{rows.map(row => <li key={row.item.id} data-paimind-skill-row data-selected={detail?.id === row.item.id}><button type="button" data-paimind-skill-select onClick={() => { setSelected(row.item.id) }} aria-label={`${zh ? '查看' : 'View'}: ${row.item.name}`}><span data-paimind-skill-name>{row.item.name}</span><span data-paimind-skill-description>{row.item.description}</span><span data-paimind-skill-policy>{installedNames.has(row.item.name) ? (zh ? '已安装' : 'Installed') : (zh ? '可安装' : 'Available')}</span></button><button type="button" data-paimind-skill-favorite aria-pressed={row.favorite} aria-label={`${row.favorite ? (zh ? '取消收藏' : 'Unfavorite') : (zh ? '收藏' : 'Favorite')}: ${row.item.name}`} onClick={() => { toggleFavorite(row.item.id) }}>★</button></li>)}</ul>}</section>
      <aside data-paimind-skill-panel data-paimind-skill-detail aria-label={zh ? '技能详情' : 'Skill details'}>{detail === undefined ? <p>{zh ? '选择一个技能查看详情。' : 'Select a Skill.'}</p> : <><h3>{detail.name}</h3><p>{detail.description}</p><p><strong>{zh ? '来源：' : 'Source: '}</strong>{detail.source}</p><p><strong>{zh ? '许可：' : 'License: '}</strong>{detail.license}</p>{installedNames.has(detail.name) && <span data-paimind-skill-policy>{availabilityLabel(detail.name)}</span>}<div data-paimind-skill-actions>{!installedNames.has(detail.name) ? <button type="button" data-paimind-skill-button data-primary="true" disabled={busy} onClick={() => { void inspectRecommended(detail) }}>{zh ? '检查并安装' : 'Review and install'}</button> : <><button type="button" data-paimind-skill-button disabled={busy} onClick={() => { void inspectRecommended(detail) }}>{zh ? '检查更新' : 'Check update'}</button><button type="button" data-paimind-skill-button data-primary="true" disabled={!bindingAvailable || !runtimeSkills.names.has(detail.name)} onClick={() => { useSkill(detail.name) }}>{zh ? '在当前对话使用' : 'Use in conversation'}</button></>}</div></>}</aside>
    </div> : installedRows.length === 0 ? <div data-paimind-skill-state>{zh ? '还没有已安装的个人技能。' : 'No personal Skills installed.'}</div> : <ul data-paimind-skill-installed>{installedRows.map(item => { const recommended = recommendedByName.get(item.name); return <li key={item.skillId}><h3>{item.name}</h3><p>{item.description}</p>{item.whenToUse !== undefined && <p>{item.whenToUse}</p>}<span data-paimind-skill-policy>{availabilityLabel(item.name)}</span><div data-paimind-skill-actions><button type="button" data-paimind-skill-button data-primary="true" disabled={!bindingAvailable || !runtimeSkills.names.has(item.name)} onClick={() => { useSkill(item.name) }}>{zh ? '在当前对话使用' : 'Use in conversation'}</button><button type="button" data-paimind-skill-button onClick={() => { if (recommended === undefined) chooseUpload(); else void inspectRecommended(recommended) }} disabled={busy}>{recommended === undefined ? (zh ? '本地更新' : 'Import update') : (zh ? '检查更新' : 'Check update')}</button>{item.managed && <button type="button" data-paimind-skill-button data-danger="true" disabled={busy} onClick={() => { void uninstall(item) }}>{zh ? '卸载' : 'Uninstall'}</button>}</div></li> })}</ul>}
  </section>
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
    scope.effect(installStyle, 'paimind-skill-market: style')
    contributePaimindExtension(scope.slots, {
      id: 'paimind:skill-market', packageName: '@paimind/skill-market', category: 'skills-tools',
      nameZh: '技能市场', nameEn: 'Skill Market',
      descriptionZh: '发现、安装和管理由 Harness 原生执行的个人技能。',
      descriptionEn: 'Discover, install, and manage personal Skills executed natively by Harness.',
      surface: 'settings', maturity: 'available', order: 30,
    })
    const api = scope.get('connection').api.skills
    const storage = usableStorage(typeof window === 'undefined' ? undefined : window.localStorage)
    scope.slots.inject('settings.section', () => scope.slots.register({
      name: 'settings.section', id: 'paimind-skill-market', order: 22,
      label: () => scope.locale.getLocale().active.startsWith('zh') ? '技能市场' : 'Skill Market',
    }, (owner: HarnessSettingsSectionOwnerProps) => <SkillMarketBoundary><SkillMarketSection {...owner} api={api} installer={installer} sessions={scope.sessions} conversation={scope.conversation} locale={scope.locale} {...storage === undefined ? {} : { storage }} /></SkillMarketBoundary>))
  }, 'paimind-skill-market: Settings section')
  try { await mounted } catch (error) { await disposeRemote(); throw error }
  return async () => { await mounted.dispose(); await disposeRemote() }
}
