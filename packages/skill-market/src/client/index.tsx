import {
  Component,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { zip } from 'fflate'
import type {
  PaimindSessionBusinessSkillSelectionReplaceInput,
  PaimindSessionBusinessSkillSelectionV1,
  PaimindSystemSkillCatalogSnapshot,
  PaimindSystemSkillReference,
  PaimindUserSkillPolicyReplaceInput,
  PaimindUserSkillPolicyV1,
} from '@paimind/contracts'
import {
  contributePaimindExtension,
  type HarnessRemoteMountService,
  type HarnessRemoteResult,
  type HarnessSessionService,
  type PaimindClientContext,
  type PaimindLocaleSource,
} from '@paimind/harness-compat'
import {
  PaimindCheckIcon,
  PaimindCloseIcon,
  PaimindEditIcon,
  PaimindPlusIcon,
  PaimindSearchIcon,
  PaimindSkillIcon,
  PaimindTrashIcon,
  PaimindUploadIcon,
  PaimindWarningIcon,
} from '@paimind/harness-compat/client-icons'
import {
  isPaimindProductSurfaceAvailable,
  installPaimindProductCenterHost,
  installPaimindProductSurfaceInteraction,
  PaimindProductSurfaceController,
  requestPaimindProductSurface,
  resolvePaimindProductCenterHost,
  type PaimindProductCenterHost,
} from '@paimind/harness-compat/client-surface'
import {
  PAIMIND_SKILL_UPLOAD_PATH,
  SKILL_PRODUCT_CATEGORIES,
  metadataForSkill,
  type SkillProductCategory,
  type SkillProductCategoryFilter,
} from '../catalog.js'
import type {
  SkillInstallRecord,
  SkillInstallResult,
  SkillInstallerSnapshot,
  SkillRemovalRecord,
  SkillAuthoringDraft,
  SkillPackageDirectoryPage,
  SkillPackageDocument,
  SkillPackageEntry,
  SkillPackageFile,
  SkillPackageSaveInput,
  SkillSourceDocument,
  SkillSourceSaveInput,
  SkillUploadPreview,
} from '../installer.js'
import type { SkillCatalogItem, SkillCatalogSnapshot } from '../recommended.js'
import TYPERT_REMOTE from '../remote.js'
import { SKILL_CENTER_STYLE } from './styles.js'

const BASE_INJECT = ['slots', 'locale', 'remote', 'sessions'] as const
export const inject = [...BASE_INJECT]
const STYLE_ID = '@paimind/skill-market'
const MARKET_PAGE_SIZE = 50

const CATEGORY_LABELS: Readonly<Record<SkillProductCategory, Readonly<{ zh: string; en: string }>>> = Object.freeze({
  general: Object.freeze({ zh: '通用', en: 'General' }),
  research: Object.freeze({ zh: '研究与检索', en: 'Research' }),
  data: Object.freeze({ zh: '数据与分析', en: 'Data & analysis' }),
  content: Object.freeze({ zh: '内容创作', en: 'Content creation' }),
  product: Object.freeze({ zh: '产品与业务', en: 'Product & business' }),
  engineering: Object.freeze({ zh: '开发与工程', en: 'Engineering' }),
  'agent-tools': Object.freeze({ zh: 'Agent 与自动化', en: 'Agents & automation' }),
})

function categoryLabel(category: SkillProductCategory, zh: boolean): string {
  return zh ? CATEGORY_LABELS[category].zh : CATEGORY_LABELS[category].en
}

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

interface SkillInstallerRemoteNamespace {
  listCatalog(): Promise<HarnessRemoteResult<Readonly<SkillCatalogSnapshot>>>
  inspectCatalog(input: { readonly catalogId: string; readonly version: string }): Promise<HarnessRemoteResult<Readonly<SkillUploadPreview>>>
  inspectUpload(input: { readonly uploadId: string }): Promise<HarnessRemoteResult<Readonly<SkillUploadPreview>>>
  installUpload(input: { readonly uploadId: string; readonly digest: string }): Promise<HarnessRemoteResult<Readonly<SkillInstallResult>>>
  listInstalled(): Promise<HarnessRemoteResult<Readonly<SkillInstallerSnapshot>>>
  getSkillSource(input: { readonly skillId: string }): Promise<HarnessRemoteResult<Readonly<SkillSourceDocument>>>
  saveSkillSource(input: SkillSourceSaveInput): Promise<HarnessRemoteResult<Readonly<SkillInstallResult>>>
  getSkillPackage(input: { readonly skillId: string }): Promise<HarnessRemoteResult<Readonly<SkillPackageDocument>>>
  listSkillPackageDirectory(input: { readonly skillId: string; readonly path?: string; readonly cursor?: string; readonly limit?: number }): Promise<HarnessRemoteResult<Readonly<SkillPackageDirectoryPage>>>
  readSkillPackageFile(input: { readonly skillId: string; readonly path: string }): Promise<HarnessRemoteResult<Readonly<SkillPackageFile>>>
  saveSkillPackage(input: SkillPackageSaveInput): Promise<HarnessRemoteResult<Readonly<SkillInstallResult>>>
  getAuthoringDraft(input: { readonly sessionId: string }): Promise<HarnessRemoteResult<Readonly<SkillAuthoringDraft> | null>>
  dismissAuthoringDraft(input: { readonly sessionId: string; readonly draftId: string }): Promise<HarnessRemoteResult<Readonly<{ readonly dismissed: boolean }>>>
  listSystemSkills?(): Promise<HarnessRemoteResult<Readonly<PaimindSystemSkillCatalogSnapshot>>>
  getSessionBusinessSkillSelection?(input: { readonly sessionId: string }): Promise<HarnessRemoteResult<Readonly<PaimindSessionBusinessSkillSelectionV1>>>
  replaceSessionBusinessSkillSelection?(input: PaimindSessionBusinessSkillSelectionReplaceInput): Promise<HarnessRemoteResult<Readonly<PaimindSessionBusinessSkillSelectionV1>>>
  getUserSkillPolicy?(): Promise<HarnessRemoteResult<Readonly<PaimindUserSkillPolicyV1>>>
  replaceUserSkillPolicy?(input: PaimindUserSkillPolicyReplaceInput): Promise<HarnessRemoteResult<Readonly<PaimindUserSkillPolicyV1>>>
  uninstall(input: { readonly skillId: string; readonly version?: string }): Promise<HarnessRemoteResult<Readonly<SkillRemovalRecord>>>
}

interface SkillMarketRemote extends HarnessRemoteMountService {
  readonly paimindSkillInstaller?: SkillInstallerRemoteNamespace
}

interface SkillMarketClientContext extends PaimindClientContext {
  readonly remote: SkillMarketRemote
  readonly sessions: HarnessSessionService
  inject(
    services: readonly string[],
    install: (scope: SkillMarketClientContext) => void | (() => void),
    label?: string,
  ): PromiseLike<unknown> & { dispose(): Promise<void> }
}

export interface SkillMarketSectionProps {
  readonly close: () => void
  readonly installer: SkillInstallerRemoteNamespace
  readonly sessions: HarnessSessionService
  readonly locale: PaimindLocaleSource
}

type CatalogState = { readonly status: 'loading'; readonly items: readonly []; readonly error: null }
  | { readonly status: 'ready'; readonly items: readonly SkillCatalogItem[]; readonly error: null }
  | { readonly status: 'error'; readonly items: readonly []; readonly error: string }

type SystemSkillState = { readonly status: 'loading' | 'unavailable'; readonly items: readonly []; readonly error: null }
  | { readonly status: 'ready'; readonly items: readonly Readonly<PaimindSystemSkillReference>[]; readonly error: null }
  | { readonly status: 'error'; readonly items: readonly []; readonly error: string }

type UserPolicyState = { readonly status: 'loading' | 'unavailable'; readonly value: null; readonly error: null }
  | { readonly status: 'ready'; readonly value: Readonly<PaimindUserSkillPolicyV1>; readonly error: null }
  | { readonly status: 'error'; readonly value: null; readonly error: string }

type SessionSelectionState = { readonly status: 'no-session' | 'loading' | 'unavailable'; readonly value: null; readonly error: null }
  | { readonly status: 'ready'; readonly value: Readonly<PaimindSessionBusinessSkillSelectionV1>; readonly error: null }
  | { readonly status: 'error'; readonly value: null; readonly error: string }

type SkillCenterView = 'market' | 'builtin' | 'installed'

interface SkillEditorDraft {
  readonly skillId?: string
  readonly expectedDigest?: string
  readonly entries: readonly Readonly<SkillPackageEntry>[]
  readonly files: readonly Readonly<SkillEditorFile>[]
  readonly directories: readonly Readonly<SkillEditorDirectory>[]
  readonly expandedPaths: readonly string[]
  readonly selectedPath: string
  readonly selectedDirectoryPath: string
  readonly sourceSessionId?: string
  readonly authoringDraftId?: string
}

interface SkillEditorFile extends SkillPackageFile {
  readonly state: 'clean' | 'modified' | 'new' | 'deleted'
  readonly originalDigest?: string
}

interface SkillEditorDirectory {
  readonly path: string
  readonly state: 'clean' | 'new'
  readonly nextCursor?: string
}

function skillMarkdown(input: { readonly name: string; readonly description: string; readonly instructions: string }): string {
  const description = JSON.stringify(input.description.trim())
  return `---\nname: ${input.name.trim()}\ndescription: ${description}\n---\n\n${input.instructions.trim()}\n`
}

function editablePackageFile(path: string, content: string): Readonly<SkillPackageFile> {
  return Object.freeze({ path, kind: 'text', size: new TextEncoder().encode(content).byteLength, digest: `sha256:${'0'.repeat(64)}`, content })
}

function editorFile(file: Readonly<SkillPackageFile>, state: SkillEditorFile['state'] = 'clean'): Readonly<SkillEditorFile> {
  return Object.freeze({ ...file, state, ...(state === 'new' ? {} : { originalDigest: file.digest }) })
}

function entryForFile(file: Readonly<SkillPackageFile>): Readonly<SkillPackageEntry> {
  return Object.freeze({ path: file.path, name: basenameOfSkillPath(file.path), kind: file.kind, size: file.size, digest: file.digest })
}

function initialSkillPackage(): SkillEditorDraft {
  const source = `---\nname: my-skill\ndescription: "说明这个 Skill 做什么，以及在什么情况下应该加载。"\n---\n\n# My Skill\n\n在这里编写工作流程、输入、输出、示例与边界。\n`
  const file = editablePackageFile('SKILL.md', source)
  return {
    entries: Object.freeze([entryForFile(file)]), files: Object.freeze([editorFile(file, 'new')]),
    directories: Object.freeze([{ path: '', state: 'clean' }]), expandedPaths: Object.freeze([]),
    selectedPath: 'SKILL.md', selectedDirectoryPath: '',
  }
}

interface SkillPackageTreeRow {
  readonly path: string
  readonly label: string
  readonly depth: number
  readonly kind: 'folder' | 'file' | 'more'
  readonly entry?: Readonly<SkillPackageEntry>
}

function dirnameOfSkillPath(path: string): string {
  const parts = path.split('/')
  return parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
}

function editorChildName(raw: string): string | undefined {
  const name = raw.trim()
  if (name === '' || name === '.' || name === '..' || name.length > 255 || name.includes('/') || name.includes('\\') || /[\u0000-\u001f\u007f]/.test(name)) {
    return undefined
  }
  return name
}

function skillPackageTree(editor: SkillEditorDraft): readonly SkillPackageTreeRow[] {
  const rows: SkillPackageTreeRow[] = []
  const visit = (directory: string, depth: number): void => {
    const children = editor.entries
      .filter(entry => dirnameOfSkillPath(entry.path) === directory)
      .sort((left, right) => left.kind === right.kind
        ? left.name.localeCompare(right.name)
        : left.kind === 'directory' ? -1 : right.kind === 'directory' ? 1 : left.name.localeCompare(right.name))
    for (const entry of children) {
      rows.push({ path: entry.path, label: entry.name, depth, kind: entry.kind === 'directory' ? 'folder' : 'file', entry })
      if (entry.kind === 'directory' && editor.expandedPaths.includes(entry.path)) visit(entry.path, depth + 1)
    }
    const page = editor.directories.find(item => item.path === directory)
    if (page?.nextCursor !== undefined) rows.push({ path: directory, label: 'more', depth, kind: 'more' })
  }
  visit('', 0)
  return Object.freeze(rows)
}

function basenameOfSkillPath(path: string): string { return path.split('/').at(-1) ?? path }

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
  const [tab, setTab] = useState<SkillCenterView>('market')
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading', items: [], error: null })
  const [systemSkills, setSystemSkills] = useState<SystemSkillState>({ status: 'unavailable', items: [], error: null })
  const [userPolicy, setUserPolicy] = useState<UserPolicyState>({ status: 'unavailable', value: null, error: null })
  const [sessionSelection, setSessionSelection] = useState<SessionSelectionState>({ status: 'no-session', value: null, error: null })
  const [installed, setInstalled] = useState<readonly SkillInstallRecord[]>([])
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<SkillProductCategoryFilter>('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'installed' | 'available'>('all')
  const [visibleMarketCount, setVisibleMarketCount] = useState(MARKET_PAGE_SIZE)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<SkillUploadPreview | null>(null)
  const [uploadGuideOpen, setUploadGuideOpen] = useState(false)
  const [uninstallTarget, setUninstallTarget] = useState<SkillInstallRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [selectedInstalled, setSelectedInstalled] = useState<string | null>(null)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [editor, setEditor] = useState<SkillEditorDraft | null>(null)
  const [newEditorFileName, setNewEditorFileName] = useState('')
  const [newEditorDirectoryName, setNewEditorDirectoryName] = useState('')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const folderUploadRef = useRef<HTMLInputElement>(null)
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
    if (props.installer.listSystemSkills === undefined) {
      setSystemSkills({ status: 'unavailable', items: [], error: null })
      return
    }
    let current = true
    setSystemSkills({ status: 'loading', items: [], error: null })
    void (async () => {
      try {
        const value = remoteValue(await props.installer.listSystemSkills!())
        if (current) setSystemSkills({ status: 'ready', items: value.items, error: null })
      } catch (reason) {
        if (current) setSystemSkills({ status: 'error', items: [], error: messageOf(reason) })
      }
    })()
    return () => { current = false }
  }, [props.installer, revision])

  useEffect(() => {
    if (props.installer.getUserSkillPolicy === undefined) {
      setUserPolicy({ status: 'unavailable', value: null, error: null })
      return
    }
    let current = true
    setUserPolicy({ status: 'loading', value: null, error: null })
    void (async () => {
      try {
        const value = remoteValue(await props.installer.getUserSkillPolicy!())
        if (current) setUserPolicy({ status: 'ready', value, error: null })
      } catch (reason) {
        if (current) setUserPolicy({ status: 'error', value: null, error: messageOf(reason) })
      }
    })()
    return () => { current = false }
  }, [props.installer, revision])

  useEffect(() => {
    if (sessionId === undefined) {
      setSessionSelection({ status: 'no-session', value: null, error: null })
      return
    }
    if (props.installer.getSessionBusinessSkillSelection === undefined) {
      setSessionSelection({ status: 'unavailable', value: null, error: null })
      return
    }
    let current = true
    setSessionSelection({ status: 'loading', value: null, error: null })
    void (async () => {
      try {
        const value = remoteValue(await props.installer.getSessionBusinessSkillSelection!({ sessionId }))
        if (current) setSessionSelection({ status: 'ready', value, error: null })
      } catch (reason) {
        if (current) setSessionSelection({ status: 'error', value: null, error: messageOf(reason) })
      }
    })()
    return () => { current = false }
  }, [props.installer, revision, sessionId])

  useEffect(() => {
    if (sessionId === undefined) return
    let current = true
    void props.installer.getAuthoringDraft({ sessionId }).then(result => {
      if (!current) return
      const draft = remoteValue(result)
      if (draft !== null) {
        const source = skillMarkdown(draft)
        const file = editablePackageFile('SKILL.md', source)
        setEditor({
          entries: Object.freeze([entryForFile(file)]), files: Object.freeze([editorFile(file, 'new')]),
          directories: Object.freeze([{ path: '', state: 'clean' }]), expandedPaths: Object.freeze([]),
          selectedPath: 'SKILL.md', selectedDirectoryPath: '',
          sourceSessionId: draft.sessionId, authoringDraftId: draft.draftId,
        })
      }
    }, () => undefined)
    return () => { current = false }
  }, [props.installer, sessionId])

  useEffect(() => { if (preview !== null) previewPrimary.current?.focus() }, [preview])
  useEffect(() => { if (uploadGuideOpen) uploadGuidePrimary.current?.focus() }, [uploadGuideOpen])
  useEffect(() => { if (uninstallTarget !== null) uninstallPrimary.current?.focus() }, [uninstallTarget])

  const installedNames = useMemo(() => new Set(installed.map(item => item.name)), [installed])
  const installedByName = useMemo(() => new Map(installed.map(item => [item.name, item])), [installed])
  const recommendedByName = useMemo(() => new Map((catalog.status === 'ready' ? catalog.items : []).map(item => [item.name, item])), [catalog])
  const catalogRows = useMemo(() => catalog.status !== 'ready' ? [] : catalog.items.map(item => ({
    item, metadata: metadataForSkill(item),
  })), [catalog])
  const sources = useMemo(() => [...new Set(catalogRows.map(row => row.item.source))].sort((left, right) => left.localeCompare(right)), [catalogRows])
  const categoryCounts = useMemo(() => {
    const counts = new Map<SkillProductCategory, number>()
    for (const row of catalogRows) counts.set(row.metadata.category, (counts.get(row.metadata.category) ?? 0) + 1)
    return counts
  }, [catalogRows])
  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return catalogRows
      .filter(row => categoryFilter === 'all' || row.metadata.category === categoryFilter)
      .filter(row => sourceFilter === 'all' || row.item.source === sourceFilter)
      .filter(row => statusFilter === 'all' || (statusFilter === 'installed' ? installedNames.has(row.item.name) : !installedNames.has(row.item.name)))
      .filter(row => normalizedQuery === '' || [
        row.item.name,
        row.item.description,
        row.item.source,
        row.metadata.category,
        categoryLabel(row.metadata.category, zh),
        ...row.metadata.tags,
      ].some(value => value.toLocaleLowerCase().includes(normalizedQuery)))
  }, [catalogRows, categoryFilter, installedNames, query, sourceFilter, statusFilter, zh])
  const visibleRows = useMemo(() => rows.slice(0, visibleMarketCount), [rows, visibleMarketCount])
  const detailRow = visibleRows.find(row => row.item.id === selected) ?? visibleRows[0]
  const detail = detailRow?.item
  useEffect(() => { setVisibleMarketCount(MARKET_PAGE_SIZE) }, [categoryFilter, query, sourceFilter, statusFilter])
  const installedRows = useMemo(() => installed.filter(item => query.trim() === '' || `${item.name} ${item.description} ${item.whenToUse ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [installed, query])
  const systemRows = useMemo(() => systemSkills.status !== 'ready' ? [] : systemSkills.items.filter(item => query.trim() === '' || `${item.name} ${item.description} ${item.whenToUse ?? ''} ${item.sourcePluginId}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [query, systemSkills])
  const installedDetail = installedRows.find(item => item.skillId === selectedInstalled) ?? installedRows[0]
  const editorTree = editor === null ? Object.freeze([]) : skillPackageTree(editor)
  const selectedEditorFile = editor?.files.find(file => file.path === editor.selectedPath && file.state !== 'deleted')

  const inspectRecommended = async (item: SkillCatalogItem): Promise<void> => {
    setBusy(true); setError(null); setPreview(null)
    try { setPreview(remoteValue(await props.installer.inspectCatalog({ catalogId: item.id, version: item.version }))) }
    catch (reason) { setError(messageOf(reason)) } finally { setBusy(false) }
  }
  const chooseUpload = (): void => { setError(null); setAddMenuOpen(false); setUploadGuideOpen(true) }
  const openUploadPicker = (): void => {
    uploadRef.current?.click()
    setUploadGuideOpen(false)
  }
  const openFolderPicker = (): void => {
    folderUploadRef.current?.click()
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
  const inspectFolder = async (files: FileList): Promise<void> => {
    const rows = [...files]
    if (rows.length === 0) return
    if (rows.length > 50_000) { setError(zh ? 'Skill 文件夹超过 50000 个文件。' : 'The Skill folder exceeds 50,000 files.'); return }
    setBusy(true); setUploading(true); setError(null); setNotice(null)
    try {
      const paths = rows.map(file => file.webkitRelativePath || file.name)
      const root = paths[0]!.split('/')[0]!
      if (paths.some(path => path.split('/')[0] !== root)) throw new Error(zh ? '请选择一个完整的 Skill 文件夹。' : 'Choose one complete Skill folder.')
      const total = rows.reduce((sum, file) => sum + file.size, 0)
      if (total > 200 * 1024 * 1024) throw new Error(zh ? 'Skill 文件夹超过 200 MB。' : 'The Skill folder exceeds 200 MB.')
      const entries: Record<string, Uint8Array> = {}
      for (let index = 0; index < rows.length; index += 1) {
        entries[paths[index]!] = new Uint8Array(await rows[index]!.arrayBuffer())
      }
      const archive = await new Promise<Uint8Array>((resolveArchive, rejectArchive) => {
        zip(entries, { level: 6 }, (reason, value) => { if (reason !== null) rejectArchive(reason); else resolveArchive(value) })
      })
      await inspectFile(new File([new Uint8Array(archive)], `${root || 'skill'}.zip`, { type: 'application/zip' }))
    } catch (reason) {
      setError(messageOf(reason))
    } finally { setBusy(false); setUploading(false) }
  }
  const confirmInstall = async (): Promise<void> => {
    if (preview === null) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = remoteValue(await props.installer.installUpload({ uploadId: preview.uploadId, digest: preview.digest }))
      setPreview(null); setRevision(value => value + 1); setTab('installed'); setSelectedInstalled(result.record.skillId)
      setNotice(result.operation === 'updated' ? (zh ? `${preview.name} 已原子更新；失败时旧版本会自动回退。` : `${preview.name} updated atomically; the prior version is restored on failure.`) : (zh ? `${preview.name} 已保存到技能中心。` : `${preview.name} saved to the Skill Center.`))
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

  const replaceBusinessPolicy = async (name: string, field: 'enabled' | 'direct', checked: boolean): Promise<void> => {
    if (userPolicy.status !== 'ready' || props.installer.replaceUserSkillPolicy === undefined) {
      setError(zh ? '用户技能策略服务尚未接通，未更改任何运行范围。' : 'User Skill Policy is not connected; no runtime scope was changed.')
      return
    }
    const enabled = new Set(userPolicy.value.enabledBusinessSkillNames)
    const direct = new Set(userPolicy.value.directBusinessSkillNames)
    if (field === 'enabled') {
      if (checked) enabled.add(name)
      else { enabled.delete(name); direct.delete(name) }
    } else if (checked) direct.add(name)
    else direct.delete(name)
    setBusy(true); setError(null); setNotice(null)
    try {
      const value = remoteValue(await props.installer.replaceUserSkillPolicy({
        expectedRevision: userPolicy.value.revision,
        enabledOptionalSystemSkillNames: userPolicy.value.enabledOptionalSystemSkillNames,
        enabledBusinessSkillNames: [...enabled].sort(),
        directBusinessSkillNames: [...direct].sort(),
      }))
      setUserPolicy({ status: 'ready', value, error: null })
      setNotice(field === 'enabled'
        ? checked ? (zh ? `${name} 已允许用于技能范围。` : `${name} is now eligible for Skill scopes.`) : (zh ? `${name} 已停用，并从普通对话默认范围移除。` : `${name} is disabled and removed from the direct-chat default scope.`)
        : checked ? (zh ? `${name} 已加入普通对话默认范围。` : `${name} is now used by default in direct chats.`) : (zh ? `${name} 已移出普通对话默认范围。` : `${name} is no longer a direct-chat default.`))
    } catch (reason) { setError(messageOf(reason)) } finally { setBusy(false) }
  }

  const replaceSystemPolicy = async (skill: Readonly<PaimindSystemSkillReference>, checked: boolean): Promise<void> => {
    if (skill.availability !== 'optional' || skill.userControl !== 'atomic') return
    if (userPolicy.status !== 'ready' || props.installer.replaceUserSkillPolicy === undefined) {
      setError(zh ? '用户技能策略服务尚未接通，未更改系统技能。' : 'User Skill Policy is not connected; no System Skill was changed.')
      return
    }
    const enabled = new Set(userPolicy.value.enabledOptionalSystemSkillNames)
    if (checked) enabled.add(skill.name)
    else enabled.delete(skill.name)
    setBusy(true); setError(null); setNotice(null)
    try {
      const value = remoteValue(await props.installer.replaceUserSkillPolicy({
        expectedRevision: userPolicy.value.revision,
        enabledOptionalSystemSkillNames: [...enabled].sort(),
        enabledBusinessSkillNames: userPolicy.value.enabledBusinessSkillNames,
        directBusinessSkillNames: userPolicy.value.directBusinessSkillNames,
      }))
      setUserPolicy({ status: 'ready', value, error: null })
      window.dispatchEvent(new CustomEvent('paimind:user-skill-policy-changed', { detail: value }))
      setNotice(checked
        ? (zh ? `${skill.name} 已启用。` : `${skill.name} enabled.`)
        : (zh ? `${skill.name} 已停用。` : `${skill.name} disabled.`))
      // Harness can hot-apply the Host lifecycle. GenUI also contributes a
      // browser module graph, so refresh only the application shell after the
      // policy transaction succeeds; the Harness process is not restarted.
      if (skill.name === 'genui') setTimeout(() => { window.location.reload() }, 120)
    } catch (reason) { setError(messageOf(reason)) } finally { setBusy(false) }
  }

  const replaceSessionPolicy = async (name: string, checked: boolean): Promise<void> => {
    if (sessionId === undefined || sessionSelection.status !== 'ready' || props.installer.replaceSessionBusinessSkillSelection === undefined) {
      setError(zh ? '当前对话临时范围尚未就绪，未更改任何 Skill。' : 'The current conversation scope is not ready; no Skill was changed.')
      return
    }
    const selected = new Set(sessionSelection.value.skillNames)
    const alreadySelected = selected.has(name)
    const userEnabled = userPolicy.status === 'ready' && userPolicy.value.enabledBusinessSkillNames.includes(name)
    if (checked && !alreadySelected && !userEnabled) {
      setError(zh ? '请先启用这个业务 Skill，再添加到当前对话。' : 'Enable this Business Skill before adding it to the current conversation.')
      return
    }
    if (checked) selected.add(name)
    else selected.delete(name)
    const targetSessionId = sessionId
    setBusy(true); setError(null); setNotice(null)
    try {
      const value = remoteValue(await props.installer.replaceSessionBusinessSkillSelection({
        sessionId: targetSessionId,
        expectedRevision: sessionSelection.value.revision,
        skillNames: [...selected].sort(),
      }))
      if (props.sessions.list.getSnapshot().current === targetSessionId) {
        setSessionSelection({ status: 'ready', value, error: null })
      }
      setNotice(checked
        ? (zh ? `${name} 已临时加入当前对话；宿主重启后会清空。` : `${name} was added to this runtime Session and clears when the host restarts.`)
        : (zh ? `${name} 已从当前对话临时范围移除。` : `${name} was removed from this runtime Session.`))
    } catch (reason) {
      const failure = messageOf(reason)
      let refreshed = false
      if (props.installer.getSessionBusinessSkillSelection !== undefined) {
        try {
          const value = remoteValue(await props.installer.getSessionBusinessSkillSelection({ sessionId: targetSessionId }))
          if (props.sessions.list.getSnapshot().current === targetSessionId) {
            setSessionSelection({ status: 'ready', value, error: null })
            refreshed = true
          }
        } catch { /* preserve the original write failure */ }
      }
      setError(refreshed
        ? `${failure}${zh ? '；已刷新当前对话的最新临时状态。' : '; the latest runtime Session state has been refreshed.'}`
        : failure)
    } finally { setBusy(false) }
  }

  const createSkill = (): void => {
    setEditor(initialSkillPackage())
    setNewEditorFileName(''); setNewEditorDirectoryName('')
    setAddMenuOpen(false); setError(null); setNotice(null)
  }
  const editSkill = async (skillId: string): Promise<void> => {
    setBusy(true); setError(null); setNotice(null)
    try {
      const source = remoteValue(await props.installer.getSkillPackage({ skillId }))
      if (!source.managed) throw new Error(zh ? '这个 Skill 由外部来源管理，不能在技能中心直接修改。' : 'This Skill is externally managed and cannot be edited here.')
      const skillFile = remoteValue(await props.installer.readSkillPackageFile({ skillId, path: 'SKILL.md' }))
      const rootEntries = source.root.entries.some(entry => entry.path === 'SKILL.md')
        ? source.root.entries
        : Object.freeze([...source.root.entries, entryForFile(skillFile)])
      setEditor({
        skillId, expectedDigest: source.digest, entries: rootEntries,
        files: Object.freeze([editorFile(skillFile)]),
        directories: Object.freeze([{ path: '', state: 'clean', ...(source.root.nextCursor === undefined ? {} : { nextCursor: source.root.nextCursor }) }]),
        expandedPaths: Object.freeze([]), selectedPath: 'SKILL.md', selectedDirectoryPath: '',
      })
      setNewEditorFileName(''); setNewEditorDirectoryName('')
    } catch (reason) { setError(messageOf(reason)) } finally { setBusy(false) }
  }
  const loadEditorDirectory = async (path: string, cursor?: string): Promise<void> => {
    const skillId = editor?.skillId
    if (skillId === undefined) return
    setBusy(true); setError(null)
    try {
      const page = remoteValue(await props.installer.listSkillPackageDirectory({ skillId, ...(path === '' ? {} : { path }), ...(cursor === undefined ? {} : { cursor }) }))
      setEditor(current => {
        if (current === null || current.skillId !== skillId) return current
        const byPath = new Map(current.entries.map(entry => [entry.path, entry]))
        for (const entry of page.entries) byPath.set(entry.path, entry)
        const previous = current.directories.find(item => item.path === path)
        const directories = current.directories.filter(item => item.path !== path)
        return {
          ...current,
          entries: Object.freeze([...byPath.values()]),
          directories: Object.freeze([...directories, {
            path, state: previous?.state ?? 'clean',
            ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          }]),
        }
      })
    } catch (reason) { setError(messageOf(reason)) } finally { setBusy(false) }
  }
  const toggleEditorDirectory = async (path: string): Promise<void> => {
    if (editor === null) return
    if (editor.expandedPaths.includes(path)) {
      setEditor({
        ...editor, selectedDirectoryPath: path,
        expandedPaths: Object.freeze(editor.expandedPaths.filter(item => item !== path)),
      })
      return
    }
    setEditor({ ...editor, selectedDirectoryPath: path })
    if (!editor.directories.some(item => item.path === path)) await loadEditorDirectory(path)
    setEditor(current => current === null ? current : {
      ...current,
      selectedDirectoryPath: path,
      expandedPaths: current.expandedPaths.includes(path) ? current.expandedPaths : Object.freeze([...current.expandedPaths, path]),
    })
  }
  const selectEditorFile = async (entry: Readonly<SkillPackageEntry>): Promise<void> => {
    if (editor === null || entry.kind === 'directory') return
    const local = editor.files.find(file => file.path === entry.path && file.state !== 'deleted')
    if (local !== undefined) {
      setEditor({ ...editor, selectedPath: entry.path, selectedDirectoryPath: dirnameOfSkillPath(entry.path) })
      return
    }
    if (editor.skillId === undefined) return
    const skillId = editor.skillId
    setBusy(true); setError(null)
    try {
      const file = remoteValue(await props.installer.readSkillPackageFile({ skillId, path: entry.path }))
      setEditor(current => current === null || current.skillId !== skillId ? current : {
        ...current,
        files: Object.freeze([...current.files, editorFile(file)]),
        selectedPath: entry.path, selectedDirectoryPath: dirnameOfSkillPath(entry.path),
      })
    } catch (reason) { setError(messageOf(reason)) } finally { setBusy(false) }
  }
  const updateEditorFile = (content: string): void => {
    setEditor(current => current === null ? current : {
      ...current,
      files: Object.freeze(current.files.map(file => file.path === current.selectedPath
        ? Object.freeze({
            ...file, content, size: new TextEncoder().encode(content).byteLength,
            state: file.state === 'new' ? 'new' as const : 'modified' as const,
          })
        : file)),
    })
  }
  const addEditorFile = (): void => {
    if (editor === null) return
    const name = editorChildName(newEditorFileName)
    const parent = editor.selectedDirectoryPath
    if (name === undefined || !editor.directories.some(directory => directory.path === parent)) {
      setError(zh ? '请先选择目标目录，再输入不包含斜杠的安全文件名。' : 'Select a target directory, then enter a safe file name without slashes.')
      return
    }
    const path = parent === '' ? name : `${parent}/${name}`
    if (name === '.paimind-install.json' || editor.entries.some(entry => entry.path === path) || editor.files.some(file => file.path === path)) {
      setError(zh ? '这个文件路径已经存在或由系统保留。' : 'That path already exists or is reserved.')
      return
    }
    const file = editablePackageFile(path, '')
    const byPath = new Map(editor.entries.map(entry => [entry.path, entry]))
    const expanded = new Set(editor.expandedPaths)
    if (parent !== '') expanded.add(parent)
    byPath.set(path, entryForFile(file))
    setEditor({
      ...editor, entries: Object.freeze([...byPath.values()]),
      files: Object.freeze([...editor.files, editorFile(file, 'new')]),
      expandedPaths: Object.freeze([...expanded]), selectedPath: path, selectedDirectoryPath: parent,
    })
    setNewEditorFileName(''); setError(null)
  }
  const addEditorDirectory = (): void => {
    if (editor === null) return
    const name = editorChildName(newEditorDirectoryName)
    const parent = editor.selectedDirectoryPath
    if (name === undefined || !editor.directories.some(directory => directory.path === parent)) {
      setError(zh ? '请先选择目标目录，再输入不包含斜杠的安全文件夹名称。' : 'Select a target directory, then enter a safe folder name without slashes.')
      return
    }
    const path = parent === '' ? name : `${parent}/${name}`
    if (name === '.paimind-install.json' || editor.entries.some(entry => entry.path === path) || editor.files.some(file => file.path === path)) {
      setError(zh ? '这个文件夹路径已经存在或由系统保留。' : 'That folder path already exists or is reserved.')
      return
    }
    const expanded = new Set(editor.expandedPaths)
    if (parent !== '') expanded.add(parent)
    expanded.add(path)
    setEditor({
      ...editor,
      entries: Object.freeze([...editor.entries, { path, name, kind: 'directory', size: 0 }]),
      directories: Object.freeze([...editor.directories, { path, state: 'new' }]),
      expandedPaths: Object.freeze([...expanded]), selectedDirectoryPath: path,
    })
    setNewEditorDirectoryName(''); setError(null)
  }
  const removeEditorFile = (): void => {
    if (editor === null || editor.selectedPath === 'SKILL.md') return
    const target = editor.files.find(file => file.path === editor.selectedPath)
    if (target === undefined) return
    const files = target.state === 'new'
      ? editor.files.filter(file => file.path !== target.path)
      : editor.files.map(file => file.path === target.path ? Object.freeze({ ...file, state: 'deleted' as const }) : file)
    const entries = editor.entries.filter(entry => entry.path !== target.path)
    setEditor({ ...editor, entries: Object.freeze(entries), files: Object.freeze(files), selectedPath: 'SKILL.md' })
  }
  const closeEditor = async (): Promise<void> => {
    const draft = editor
    setEditor(null)
    if (draft?.sourceSessionId !== undefined && draft.authoringDraftId !== undefined) {
      await props.installer.dismissAuthoringDraft({ sessionId: draft.sourceSessionId, draftId: draft.authoringDraftId }).catch(() => undefined)
    }
  }
  const saveEditor = async (): Promise<void> => {
    if (editor === null) return
    const changes = [
      ...editor.directories.filter(directory => directory.state === 'new').map(directory => (
        Object.freeze({ operation: 'mkdir' as const, path: directory.path })
      )),
      ...editor.files.filter(file => file.state !== 'clean').map(file => file.state === 'deleted'
        ? Object.freeze({ operation: 'delete' as const, path: file.path, ...(file.originalDigest === undefined ? {} : { expectedDigest: file.originalDigest }) })
        : Object.freeze({ operation: 'write' as const, path: file.path, content: file.content ?? '', ...(file.originalDigest === undefined ? {} : { expectedDigest: file.originalDigest }) })),
    ].sort((left, right) => {
      if (left.path === 'SKILL.md') return -1
      if (right.path === 'SKILL.md') return 1
      const depth = left.path.split('/').length - right.path.split('/').length
      return depth === 0 ? left.path.localeCompare(right.path) : depth
    })
    if (changes.length === 0) { setNotice(zh ? '没有需要保存的文件变更。' : 'There are no file changes to save.'); return }
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = remoteValue(await props.installer.saveSkillPackage({
        ...(editor.skillId === undefined ? {} : { skillId: editor.skillId }),
        ...(editor.expectedDigest === undefined ? {} : { expectedDigest: editor.expectedDigest }),
        changes,
      }))
      if (editor.sourceSessionId !== undefined && editor.authoringDraftId !== undefined) {
        await props.installer.dismissAuthoringDraft({ sessionId: editor.sourceSessionId, draftId: editor.authoringDraftId }).catch(() => undefined)
      }
      setEditor(null); setRevision(value => value + 1); setTab('installed'); setSelectedInstalled(result.record.skillId)
      setNotice(result.operation === 'installed'
        ? (zh ? `${result.record.name} 已创建并保存。` : `${result.record.name} created and saved.`)
        : (zh ? `${result.record.name} 已保存新版本。` : `${result.record.name} saved as a new version.`))
    } catch (reason) { setError(messageOf(reason)) } finally { setBusy(false) }
  }

  const activateAll = (): void => { setTab('market'); setMobileDetailOpen(false) }
  const activateBuiltIn = (): void => { setTab('builtin'); setMobileDetailOpen(false) }
  const activateInstalled = (): void => { setTab('installed'); setMobileDetailOpen(false) }
  const detailInstall = detail === undefined ? undefined : installedByName.get(detail.name)
  const detailCurrent = detail !== undefined && detailInstall?.digest === detail.digest
  const installedRecommended = installedDetail === undefined ? undefined : recommendedByName.get(installedDetail.name)
  const installedCurrent = installedDetail !== undefined && installedRecommended?.digest === installedDetail.digest
  const policyConnected = userPolicy.status === 'ready' && props.installer.replaceUserSkillPolicy !== undefined
  const installedUserEnabled = installedDetail !== undefined && userPolicy.status === 'ready' && userPolicy.value.enabledBusinessSkillNames.includes(installedDetail.name)
  const installedDirectDefault = installedDetail !== undefined && userPolicy.status === 'ready' && userPolicy.value.directBusinessSkillNames.includes(installedDetail.name)
  const installedSessionSelected = installedDetail !== undefined && sessionSelection.status === 'ready' && sessionSelection.value.skillNames.includes(installedDetail.name)
  const sessionPolicyConnected = sessionId !== undefined && sessionSelection.status === 'ready' && props.installer.replaceSessionBusinessSkillSelection !== undefined
  const sessionToggleDisabled = !sessionPolicyConnected || busy || (!installedSessionSelected && !installedUserEnabled)
  const sessionScopeCopy = sessionSelection.status === 'no-session'
    ? (zh ? '请先打开一个对话。临时选择不会写入个人默认或智能体。' : 'Open a conversation first. Temporary selection never changes personal defaults or an Agent.')
    : sessionSelection.status === 'unavailable'
      ? (zh ? '当前版本未提供真实的 Session 临时选择接口。' : 'This version does not expose the real Session selection API.')
      : sessionSelection.status === 'loading'
        ? (zh ? '正在读取当前对话的临时范围…' : 'Reading the current runtime Session scope…')
        : sessionSelection.status === 'error'
          ? (zh ? `读取失败：${sessionSelection.error}` : `Could not load: ${sessionSelection.error}`)
          : props.installer.replaceSessionBusinessSkillSelection === undefined
            ? (zh ? '当前版本未提供真实的 Session 临时选择写入接口。' : 'This version does not expose the real Session selection write API.')
            : installedSessionSelected && !installedUserEnabled
            ? (zh ? '这个 Skill 已停用，但仍可从当前对话移除；宿主重启后也会清空。' : 'This Skill is disabled but can still be removed here; it also clears when the host restarts.')
            : !installedUserEnabled
              ? (zh ? '请先启用这个业务 Skill；临时选择仅在当前 Session 生效。' : 'Enable this Business Skill first; temporary selection applies only to this Session.')
              : (zh ? 'Runtime 临时范围：仅当前 Session 生效，宿主重启后清空。' : 'Runtime-ephemeral: only this Session is affected, and the selection clears when the host restarts.')
  const filtersActive = tab === 'market'
    ? query.trim() !== '' || categoryFilter !== 'all' || sourceFilter !== 'all' || statusFilter !== 'all'
    : query.trim() !== ''
  const resetFilters = (): void => { setQuery(''); setCategoryFilter('all'); setSourceFilter('all'); setStatusFilter('all'); setVisibleMarketCount(MARKET_PAGE_SIZE) }
  const agentCenterAvailable = isPaimindProductSurfaceAvailable('agent-center')
  const openAgentCenterForAttachment = (): void => {
    if (!isPaimindProductSurfaceAvailable('agent-center')) {
      setError(zh ? '智能体中心当前不可用，未挂载任何 Skill。' : 'Agent Center is unavailable. No Skill was attached.')
      return
    }
    setError(null); setNotice(null)
    requestPaimindProductSurface('agent-center')
    props.close()
  }

  return <section data-paimind-skill-market aria-label={zh ? '技能中心' : 'Skill Center'}>
    <header data-paimind-skill-hero>
      <div><p data-paimind-skill-eyebrow><PaimindSkillIcon size={16} />{zh ? '技能与能力' : 'Skills and capabilities'}</p><h1 id="paimind-skill-center-title">{editor === null ? (zh ? '技能中心' : 'Skill Center') : (editor.expectedDigest === undefined ? (zh ? '创建 Skill' : 'Create Skill') : (zh ? '编辑 Skill' : 'Edit Skill'))}</h1><p data-paimind-skill-intro>{zh ? '发现、添加并管理技能，按需要用于普通对话或智能体。' : 'Discover, add, and manage Skills for direct chats or Agents.'}</p></div>
      <div data-paimind-skill-head-actions>{editor === null && <div data-paimind-skill-add><button type="button" data-paimind-skill-button data-primary="true" aria-haspopup="menu" aria-expanded={addMenuOpen} onClick={() => { setAddMenuOpen(value => !value) }} disabled={busy}><PaimindPlusIcon size={15} />{zh ? '添加 Skill' : 'Add Skill'}</button>{addMenuOpen && <div role="menu" data-paimind-skill-add-menu><button role="menuitem" type="button" onClick={createSkill}><PaimindEditIcon size={15} /><span><strong>{zh ? '手动创建' : 'Create manually'}</strong><small>{zh ? '打开文件树与内容编辑器' : 'Open the file tree and content editor'}</small></span></button><button role="menuitem" type="button" onClick={chooseUpload}><PaimindUploadIcon size={15} /><span><strong>{zh ? '从本地导入' : 'Import from device'}</strong><small>{zh ? '文件夹 / ZIP / SKILL.md' : 'Folder / ZIP / SKILL.md'}</small></span></button><button role="menuitem" type="button" disabled title={zh ? '请在普通对话中说“创建一个 Skill”' : 'Ask to create a Skill in a regular conversation'}><PaimindSkillIcon size={15} /><span><strong>{zh ? '用 AI 创建' : 'Create with AI'}</strong><small>{zh ? '从普通对话触发，未保存前不会入库' : 'Starts in chat and stays unsaved until review'}</small></span></button><button role="menuitem" type="button" disabled title={zh ? 'GitHub 安装服务尚未接通' : 'GitHub installer is not connected'}><PaimindPlusIcon size={15} /><span><strong>{zh ? '从 GitHub 安装' : 'Install from GitHub'}</strong><small>{zh ? '待安装服务接入' : 'Installer contract required'}</small></span></button></div>}</div>}<button type="button" data-paimind-skill-center-close aria-label={zh ? '关闭技能中心' : 'Close Skill Center'} onClick={props.close}><PaimindCloseIcon size={18} /></button></div>
    </header>
    <input ref={uploadRef} hidden type="file" accept=".zip,.md" aria-label={zh ? '选择技能包' : 'Choose Skill package'} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file !== undefined) void inspectFile(file) }} />
    <input ref={folderUploadRef} hidden type="file" multiple aria-label={zh ? '选择技能文件夹' : 'Choose Skill folder'} {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={event => { const files = event.currentTarget.files; event.currentTarget.value = ''; if (files !== null) void inspectFolder(files) }} />
    <div data-paimind-skill-feedback aria-live="polite" aria-atomic="true">
      {uploading && <div role="status" data-paimind-skill-notice><span>{zh ? '正在安全读取并检查本地 Skill…' : 'Securely reading and inspecting the local Skill…'}</span><button type="button" data-paimind-skill-inline-action onClick={() => { uploadAbort.current?.abort() }}>{zh ? '取消' : 'Cancel'}</button></div>}
      {notice !== null && <div role="status" data-paimind-skill-notice data-success="true"><PaimindCheckIcon size={15} /><span>{notice}</span><button type="button" data-paimind-skill-inline-action onClick={() => { setNotice(null) }}>{zh ? '关闭' : 'Dismiss'}</button></div>}
      {error !== null && <div role="alert" data-paimind-skill-notice data-error="true"><PaimindWarningIcon size={15} /><span>{error}</span><button type="button" data-paimind-skill-inline-action onClick={() => { setError(null) }}>{zh ? '关闭' : 'Dismiss'}</button></div>}
    </div>

    {editor !== null ? <section data-paimind-skill-editor aria-label={zh ? 'Skill 文件夹编辑器' : 'Skill folder editor'}>
      <div data-paimind-skill-editor-head><div><p data-paimind-skill-eyebrow>{editor.authoringDraftId === undefined ? (editor.expectedDigest === undefined ? (zh ? '新建技能包' : 'New Skill package') : (zh ? '编辑已安装技能包' : 'Edit installed Skill package')) : (zh ? 'AI 已准备 · 尚未保存' : 'Prepared by AI · not saved')}</p><h2>{editor.skillId ?? (zh ? '未保存的 Skill 文件夹' : 'Unsaved Skill folder')}</h2><p>{zh ? 'SKILL.md 是入口文件；scripts、references、assets 与其他文件都属于同一个可原子保存的技能包。' : 'SKILL.md is the entry file. Scripts, references, assets, and other files belong to the same atomically saved package.'}</p></div><span data-paimind-skill-policy>{zh ? `${new Set([...editor.entries.filter(entry => entry.kind !== 'directory').map(entry => entry.path), ...editor.files.filter(file => file.state !== 'deleted').map(file => file.path)]).size} 个已加载文件` : `${new Set([...editor.entries.filter(entry => entry.kind !== 'directory').map(entry => entry.path), ...editor.files.filter(file => file.state !== 'deleted').map(file => file.path)]).size} loaded files`}</span></div>
      <div data-paimind-skill-package-editor>
        <aside data-paimind-skill-package-tree aria-label={zh ? 'Skill 文件树' : 'Skill file tree'}>
          <div data-paimind-skill-package-tree-head><strong>{zh ? '文件与目录' : 'Files and folders'}</strong><small>{zh ? `当前目标：${editor.selectedDirectoryPath === '' ? '根目录 /' : editor.selectedDirectoryPath}` : `Target: ${editor.selectedDirectoryPath === '' ? 'root /' : editor.selectedDirectoryPath}`}</small></div>
          <div data-paimind-skill-package-create>
            <label><span>{zh ? '新建文件' : 'New file'}</span><span><input aria-label={zh ? '新文件名称' : 'New file name'} value={newEditorFileName} disabled={busy} placeholder="example.md" onChange={event => { setNewEditorFileName(event.currentTarget.value) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addEditorFile() } }} /><button type="button" data-paimind-skill-button aria-label={zh ? '创建文件' : 'Create file'} disabled={busy || newEditorFileName.trim() === ''} onClick={addEditorFile}><PaimindPlusIcon size={14} /></button></span></label>
            <label><span>{zh ? '新建文件夹' : 'New folder'}</span><span><input aria-label={zh ? '新文件夹名称' : 'New folder name'} value={newEditorDirectoryName} disabled={busy} placeholder="references" onChange={event => { setNewEditorDirectoryName(event.currentTarget.value) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addEditorDirectory() } }} /><button type="button" data-paimind-skill-button aria-label={zh ? '创建文件夹' : 'Create folder'} disabled={busy || newEditorDirectoryName.trim() === ''} onClick={addEditorDirectory}><PaimindPlusIcon size={14} /></button></span></label>
          </div>
          <div data-paimind-skill-package-tree-rows><button type="button" data-paimind-skill-package-folder data-selected={editor.selectedDirectoryPath === ''} style={{ '--skill-tree-depth': 0 } as CSSProperties} aria-label={zh ? '选择目录: 根目录' : 'Select directory: root'} onClick={() => { setEditor({ ...editor, selectedDirectoryPath: '' }) }}><span>⌂</span><span>{zh ? '根目录 /' : 'root /'}</span></button>{editorTree.map(row => row.kind === 'folder'
            ? <button key={`folder:${row.path}`} type="button" data-paimind-skill-package-folder data-selected={editor.selectedDirectoryPath === row.path} data-expanded={editor.expandedPaths.includes(row.path)} style={{ '--skill-tree-depth': row.depth + 1 } as CSSProperties} aria-expanded={editor.expandedPaths.includes(row.path)} aria-label={`${zh ? '选择目录' : 'Select directory'}: ${row.path}`} onClick={() => { void toggleEditorDirectory(row.path) }}><span>{editor.expandedPaths.includes(row.path) ? '⌄' : '›'}</span><span>{row.label}</span></button>
            : row.kind === 'more'
              ? <button key={`more:${row.path}`} type="button" data-paimind-skill-package-more style={{ '--skill-tree-depth': row.depth + 1 } as CSSProperties} disabled={busy} onClick={() => { const page = editor.directories.find(item => item.path === row.path); if (page?.nextCursor !== undefined) void loadEditorDirectory(row.path, page.nextCursor) }}>{zh ? '加载更多…' : 'Load more…'}</button>
              : <button key={`file:${row.path}`} type="button" data-paimind-skill-package-file data-selected={editor.selectedPath === row.path} data-binary={row.entry?.kind === 'binary'} style={{ '--skill-tree-depth': row.depth + 1 } as CSSProperties} aria-label={`${zh ? '打开文件' : 'Open file'}: ${row.path}`} onClick={() => { if (row.entry !== undefined) void selectEditorFile(row.entry) }}><span>{row.entry?.kind === 'binary' ? '◆' : '·'}</span><span>{row.label}</span></button>)}</div>
        </aside>
        <section data-paimind-skill-package-workbench aria-label={zh ? 'Skill 文件内容' : 'Skill file content'}>
          <header data-paimind-skill-package-path><div><strong>{selectedEditorFile?.path ?? (zh ? '选择文件' : 'Select a file')}</strong>{selectedEditorFile !== undefined && <small>{selectedEditorFile.kind === 'text' ? (zh ? `${selectedEditorFile.size} 字节 · 可编辑${selectedEditorFile.state === 'clean' ? '' : ' · 未保存'}` : `${selectedEditorFile.size} bytes · editable${selectedEditorFile.state === 'clean' ? '' : ' · unsaved'}`) : (zh ? `${selectedEditorFile.size} 字节 · 二进制文件` : `${selectedEditorFile.size} bytes · binary`)}</small>}</div><button type="button" data-paimind-skill-button data-danger="true" disabled={busy || selectedEditorFile === undefined || selectedEditorFile.path === 'SKILL.md'} onClick={removeEditorFile}><PaimindTrashIcon size={14} />{zh ? '删除文件' : 'Delete file'}</button></header>
          {selectedEditorFile === undefined ? <div data-paimind-skill-package-empty>{zh ? '从左侧选择一个文件。' : 'Choose a file from the tree.'}</div> : selectedEditorFile.kind === 'binary' ? <div data-paimind-skill-package-empty><strong>{zh ? '二进制资源保持原样' : 'Binary asset preserved'}</strong><p>{zh ? '图片、字体和其他二进制资源会随技能包保存，但不会在文本编辑器中改写。可通过重新导入文件夹替换。' : 'Images, fonts, and other binary assets remain in the package but are not rewritten by the text editor. Re-import the folder to replace them.'}</p></div> : <textarea data-paimind-skill-package-source aria-label={zh ? 'Skill 文件编辑器' : 'Skill file editor'} spellCheck={false} value={selectedEditorFile.content ?? ''} disabled={busy} onChange={event => { updateEditorFile(event.currentTarget.value) }} />}
        </section>
      </div>
      <div data-paimind-skill-editor-actions><button type="button" data-paimind-skill-button onClick={() => { void closeEditor() }} disabled={busy}>{zh ? '取消' : 'Cancel'}</button><button type="button" data-paimind-skill-button data-primary="true" onClick={() => { void saveEditor() }} disabled={busy || !editor.files.some(file => file.path === 'SKILL.md' && file.kind === 'text')}><PaimindCheckIcon size={14} />{busy ? (zh ? '正在保存整个文件夹…' : 'Saving folder…') : (zh ? '保存整个 Skill 文件夹' : 'Save Skill folder')}</button></div>
    </section> : <div data-paimind-skill-workspace>
      <div role="tablist" aria-label={zh ? '技能中心主视图' : 'Skill Center views'} data-paimind-skill-primary-tabs>
        <button role="tab" type="button" aria-label={zh ? '市场' : 'Market'} aria-selected={tab === 'market'} tabIndex={tab === 'market' ? 0 : -1} onKeyDown={handleScopeKey} onClick={activateAll}>{zh ? '市场' : 'Market'}<span>{catalog.status === 'ready' ? catalog.items.length : 0}</span></button>
        <button role="tab" type="button" aria-label={zh ? '内置' : 'Built-in'} aria-selected={tab === 'builtin'} tabIndex={tab === 'builtin' ? 0 : -1} onKeyDown={handleScopeKey} onClick={activateBuiltIn}>{zh ? '内置' : 'Built-in'}<span>{systemSkills.status === 'ready' ? systemSkills.items.length : 0}</span></button>
        <button role="tab" type="button" aria-label={zh ? '已安装' : 'Installed'} aria-selected={tab === 'installed'} tabIndex={tab === 'installed' ? 0 : -1} onKeyDown={handleScopeKey} onClick={activateInstalled}>{zh ? '已安装' : 'Installed'}<span>{installed.length}</span></button>
      </div>

      <section data-paimind-skill-catalog aria-label={zh ? '技能目录' : 'Skill catalog'}>
        <div data-paimind-skill-toolbar>
          <div data-paimind-skill-search-wrap><span data-paimind-skill-search-icon><PaimindSearchIcon size={17} /></span><input type="search" aria-label={zh ? '搜索技能' : 'Search Skills'} value={query} onChange={event => { setQuery(event.currentTarget.value) }} placeholder={zh ? '搜索名称、说明、来源或标签' : 'Search name, description, source, or tag'} /></div>
          <span data-paimind-skill-result-count>{tab === 'market' && visibleRows.length < rows.length
            ? (zh ? `显示 ${visibleRows.length} / ${rows.length} 个结果` : `Showing ${visibleRows.length} of ${rows.length} results`)
            : (zh ? `${tab === 'market' ? rows.length : tab === 'builtin' ? systemRows.length : installedRows.length} 个结果` : `${tab === 'market' ? rows.length : tab === 'builtin' ? systemRows.length : installedRows.length} results`)}</span>
        </div>
        <div data-paimind-skill-filterbar>
          {tab === 'market' ? <div data-paimind-skill-filters>
            <select data-paimind-skill-select-filter aria-label={zh ? '按业务分类筛选' : 'Filter by business category'} value={categoryFilter} onChange={event => { setCategoryFilter(event.currentTarget.value as SkillProductCategoryFilter) }}>
              <option value="all">{zh ? `全部分类 (${catalogRows.length})` : `All categories (${catalogRows.length})`}</option>
              {SKILL_PRODUCT_CATEGORIES.filter((category): category is SkillProductCategory => category !== 'all' && (categoryCounts.get(category) ?? 0) > 0).map(category => <option key={category} value={category}>{`${categoryLabel(category, zh)} (${categoryCounts.get(category) ?? 0})`}</option>)}
            </select>
            <select data-paimind-skill-select-filter aria-label={zh ? '按来源筛选' : 'Filter by source'} value={sourceFilter} onChange={event => { setSourceFilter(event.currentTarget.value) }}><option value="all">{zh ? '全部来源' : 'All sources'}</option>{sources.map(source => <option key={source} value={source}>{source}</option>)}</select>
            <select data-paimind-skill-select-filter aria-label={zh ? '按安装状态筛选' : 'Filter by install status'} value={statusFilter} onChange={event => { setStatusFilter(event.currentTarget.value as typeof statusFilter) }}><option value="all">{zh ? '全部状态' : 'All statuses'}</option><option value="installed">{zh ? '已安装' : 'Installed'}</option><option value="available">{zh ? '可安装' : 'Available'}</option></select>
          </div> : <span data-paimind-skill-result-count>{tab === 'builtin' ? (zh ? '平台提供' : 'Provided by the platform') : (zh ? '个人技能' : 'Personal Skills')}</span>}
          {filtersActive && <button type="button" data-paimind-skill-inline-action onClick={resetFilters}>{zh ? '清除筛选' : 'Clear filters'}</button>}
        </div>

        {tab === 'market' ? <div data-paimind-skill-grid>
          <section data-paimind-skill-panel aria-label={zh ? '技能目录列表' : 'Catalog Skill list'}>{catalog.status === 'loading' ? <div data-paimind-skill-state aria-busy="true"><span data-paimind-skill-loading-dot />{zh ? '正在读取真实目录…' : 'Reading the live catalog…'}</div> : catalog.status === 'error' ? <div data-paimind-skill-state data-error="true" role="alert"><p>{catalog.error}</p><button type="button" data-paimind-skill-button onClick={() => { setRevision(value => value + 1) }}>{zh ? '重试' : 'Retry'}</button></div> : rows.length === 0 ? <div data-paimind-skill-state><p>{zh ? '没有匹配的 Skill。调整筛选或清除搜索即可继续。' : 'No matching Skills. Adjust filters or clear search to continue.'}</p><button type="button" data-paimind-skill-button onClick={resetFilters}>{zh ? '清除筛选' : 'Clear filters'}</button></div> : <ul data-paimind-skill-list>{visibleRows.map(row => <li key={row.item.id} data-paimind-skill-row data-selected={detail?.id === row.item.id}><button type="button" data-paimind-skill-select onClick={() => { setSelected(row.item.id); setMobileDetailOpen(true) }} aria-label={`${zh ? '查看' : 'View'}: ${row.item.name}`}><span data-paimind-skill-row-icon><PaimindSkillIcon size={20} /></span><span data-paimind-skill-row-copy><span data-paimind-skill-name>{row.item.name}</span><span data-paimind-skill-description>{row.item.description}</span></span><span data-paimind-skill-row-badges><span data-paimind-skill-category>{categoryLabel(row.metadata.category, zh)}</span><span data-paimind-skill-policy>{installedNames.has(row.item.name) ? (zh ? '已安装' : 'Installed') : (zh ? '可安装' : 'Available')}</span></span></button></li>)}{visibleRows.length < rows.length && <li data-paimind-skill-load-more><button type="button" data-paimind-skill-button onClick={() => { setVisibleMarketCount(value => value + MARKET_PAGE_SIZE) }}>{zh ? `加载更多（剩余 ${rows.length - visibleRows.length} 个）` : `Load more (${rows.length - visibleRows.length} remaining)`}</button></li>}</ul>}</section>
          <aside data-paimind-skill-panel data-paimind-skill-detail data-mobile-open={mobileDetailOpen} aria-label={zh ? '技能详情' : 'Skill details'}><button type="button" data-paimind-skill-mobile-close aria-label={zh ? '返回技能列表' : 'Back to Skill list'} onClick={() => { setMobileDetailOpen(false) }}><PaimindCloseIcon size={17} /></button>{detail === undefined ? <p>{zh ? '选择一个 Skill 查看详情。' : 'Select a Skill.'}</p> : <><span data-paimind-skill-detail-icon><PaimindSkillIcon size={25} /></span><div><h2>{detail.name}</h2><p data-paimind-skill-detail-subtitle>{detail.description}</p></div><div data-paimind-skill-statuses>{detailRow !== undefined && <span data-paimind-skill-category>{categoryLabel(detailRow.metadata.category, zh)}</span>}{detailInstall !== undefined && <span data-paimind-skill-policy>{zh ? '已安装' : 'Installed'}</span>}{detailInstall?.runtimeRequirements.length ? <span data-paimind-skill-policy data-warning="true">{zh ? '运行环境待确认' : 'Runtime setup to verify'}</span> : null}</div><details data-paimind-skill-disclosure><summary>{zh ? '来源与包信息' : 'Source and package details'}</summary><dl data-paimind-skill-meta><div data-paimind-skill-meta-row><dt>{zh ? '版本' : 'Version'}</dt><dd>{detail.version}</dd></div><div data-paimind-skill-meta-row><dt>{zh ? '来源' : 'Source'}</dt><dd>{detail.source}</dd></div><div data-paimind-skill-meta-row><dt>{zh ? '许可' : 'License'}</dt><dd>{detail.license}</dd></div></dl></details><div data-paimind-skill-actions>{detailInstall === undefined ? <button type="button" data-paimind-skill-button data-primary="true" disabled={busy} onClick={() => { void inspectRecommended(detail) }}><PaimindCheckIcon size={14} />{zh ? '检查并安装' : 'Review and install'}</button> : !detailCurrent ? <button type="button" data-paimind-skill-button data-primary="true" disabled={busy} onClick={() => { void inspectRecommended(detail) }}><PaimindCheckIcon size={14} />{zh ? '更新' : 'Update'}</button> : null}</div></>}</aside>
        </div> : tab === 'builtin' ? systemSkills.status === 'loading' ? <div data-paimind-skill-state aria-busy="true"><span data-paimind-skill-loading-dot />{zh ? '正在读取内置技能…' : 'Reading built-in Skills…'}</div> : systemSkills.status === 'error' ? <div data-paimind-skill-state data-error="true" role="alert"><p>{systemSkills.error}</p><button type="button" data-paimind-skill-button onClick={() => { setRevision(value => value + 1) }}>{zh ? '重试' : 'Retry'}</button></div> : systemSkills.status === 'unavailable' ? <div data-paimind-skill-state data-paimind-skill-contract-state><span data-paimind-skill-policy>{zh ? '未连接' : 'Not connected'}</span><h2>{zh ? '内置技能来源尚未接通' : 'Built-in Skill descriptors are not connected'}</h2><p>{zh ? '当前版本没有提供可验证的系统技能定义。这里不会按名称猜测，也不会提供只修改界面的虚假开关。' : 'This version does not expose verified System Skill descriptors. This view does not guess by name or expose UI-only switches.'}</p><small>{zh ? '接入来源插件的定义与生命周期契约后，内置技能会自动显示在这里。' : 'Built-in Skills appear here after Source Plugins expose their descriptor and lifecycle contract.'}</small></div> : systemRows.length === 0 ? <div data-paimind-skill-state><p>{zh ? '没有匹配的内置 Skill。' : 'No matching built-in Skills.'}</p>{query.trim() !== '' && <button type="button" data-paimind-skill-button onClick={resetFilters}>{zh ? '清除搜索' : 'Clear search'}</button>}</div> : <ul data-paimind-system-list>{systemRows.map(skill => {
          const mandatory = skill.availability === 'mandatory'
          const checked = mandatory || (userPolicy.status === 'ready' && userPolicy.value.enabledOptionalSystemSkillNames.includes(skill.name))
          return <li key={skill.canonicalId} data-paimind-system-row><span data-paimind-skill-row-icon><PaimindSkillIcon size={20} /></span><span data-paimind-skill-row-copy><span data-paimind-skill-name>{skill.name}</span><span data-paimind-skill-description>{skill.description}</span></span>{mandatory ? <span data-paimind-skill-policy>{zh ? '必需 · 锁定' : 'Mandatory · locked'}</span> : <label data-paimind-system-control><span>{checked ? (zh ? '已开启' : 'On') : (zh ? '已关闭' : 'Off')}</span><input type="checkbox" role="switch" aria-label={zh ? `启用 ${skill.name}` : `Enable ${skill.name}`} checked={checked} disabled={!policyConnected || busy} onChange={event => { void replaceSystemPolicy(skill, event.currentTarget.checked) }} /></label>}</li>
        })}</ul> : installedRows.length === 0 ? <div data-paimind-skill-state><p>{zh ? '还没有已安装的个人 Skill。可从市场安装，或导入本地 SKILL.md / ZIP。' : 'No personal Skills installed. Install from the market or import a local SKILL.md / ZIP.'}</p><div data-paimind-skill-actions><button type="button" data-paimind-skill-button data-primary="true" onClick={activateAll}>{zh ? '浏览市场' : 'Browse market'}</button><button type="button" data-paimind-skill-button onClick={chooseUpload}>{zh ? '本地导入' : 'Import local'}</button></div></div> : <div data-paimind-skill-grid>
          <section data-paimind-skill-panel aria-label={zh ? '已安装技能列表' : 'Installed Skill list'}><ul data-paimind-skill-list>{installedRows.map(item => <li key={item.skillId} data-paimind-skill-row data-selected={installedDetail?.skillId === item.skillId}><button type="button" data-paimind-skill-select onClick={() => { setSelectedInstalled(item.skillId); setMobileDetailOpen(true) }} aria-label={`${zh ? '查看已安装' : 'View installed'}: ${item.name}`}><span data-paimind-skill-row-icon><PaimindSkillIcon size={20} /></span><span data-paimind-skill-row-copy><span data-paimind-skill-name>{item.name}</span><span data-paimind-skill-description>{item.description}</span></span><span data-paimind-skill-policy>{item.managed ? (zh ? '可编辑' : 'Editable') : (zh ? '外部管理' : 'External')}</span></button></li>)}</ul></section>
          <aside data-paimind-skill-panel data-paimind-skill-detail data-mobile-open={mobileDetailOpen} aria-label={zh ? '已安装技能详情' : 'Installed Skill details'}>
            <button type="button" data-paimind-skill-mobile-close aria-label={zh ? '返回已安装列表' : 'Back to installed list'} onClick={() => { setMobileDetailOpen(false) }}><PaimindCloseIcon size={17} /></button>
            {installedDetail !== undefined && <>
              <span data-paimind-skill-detail-icon><PaimindSkillIcon size={25} /></span>
              <div><h2>{installedDetail.name}</h2><p data-paimind-skill-detail-subtitle>{installedDetail.description}</p></div>
              <div data-paimind-skill-statuses><span data-paimind-skill-policy>{installedDetail.managed ? (zh ? '技能中心管理' : 'Managed here') : (zh ? '外部管理' : 'Externally managed')}</span>{installedDetail.runtimeRequirements.length > 0 && <span data-paimind-skill-policy data-warning="true">{zh ? '运行环境待确认' : 'Runtime setup to verify'}</span>}</div>
              <section data-paimind-skill-usage aria-label={zh ? '使用范围' : 'Usage scopes'}>
                <div data-paimind-skill-usage-head><div><strong>{zh ? '使用范围' : 'Usage scopes'}</strong><small>{zh ? '安装后先启用，再决定用在哪里。' : 'Enable an installed Skill, then choose where to use it.'}</small></div>{!policyConnected && <span data-paimind-skill-policy data-warning="true">{zh ? '服务未就绪' : 'Service unavailable'}</span>}</div>
                <label data-paimind-skill-usage-row><span><strong>{zh ? '允许使用' : 'Eligible for use'}</strong><small>{zh ? '启用后，才能把这个 Skill 加入普通对话、当前对话或智能体。' : 'Enable this Skill before adding it to direct chats, the current conversation, or an Agent.'}</small></span><input type="checkbox" role="switch" aria-label={zh ? `允许使用 ${installedDetail.name}` : `Enable ${installedDetail.name}`} checked={installedUserEnabled} disabled={!policyConnected || busy} onChange={event => { void replaceBusinessPolicy(installedDetail.name, 'enabled', event.currentTarget.checked) }} /></label>
                <label data-paimind-skill-usage-row><span><strong>{zh ? '普通对话默认使用' : 'Use by default in direct chats'}</strong><small>{zh ? '只进入普通对话，不自动进入智能体会话。' : 'Applies to direct chats only, never Agent Sessions automatically.'}</small></span><input type="checkbox" role="switch" aria-label={zh ? `普通对话默认使用 ${installedDetail.name}` : `Use ${installedDetail.name} by default in direct chats`} checked={installedDirectDefault} disabled={!policyConnected || !installedUserEnabled || busy} onChange={event => { void replaceBusinessPolicy(installedDetail.name, 'direct', event.currentTarget.checked) }} /></label>
                <label data-paimind-skill-usage-row data-paimind-skill-session-scope><span><strong>{zh ? '用于当前对话' : 'Use in current conversation'}</strong><small data-paimind-skill-session-state>{sessionScopeCopy}</small></span><input type="checkbox" role="switch" aria-label={zh ? `用于当前对话 ${installedDetail.name}` : `Use ${installedDetail.name} in current conversation`} checked={installedSessionSelected} disabled={sessionToggleDisabled} onChange={event => { void replaceSessionPolicy(installedDetail.name, event.currentTarget.checked) }} /></label>
                <div data-paimind-skill-usage-row><span><strong>{zh ? '用于智能体' : 'Use with an Agent'}</strong><small>{zh ? '前往智能体中心选择目标智能体；只有保存并回读成功后才算挂载。' : 'Choose the target in Agent Center. Attachment is complete only after save and read-back succeed.'}</small></span><button type="button" data-paimind-skill-button disabled={!agentCenterAvailable} title={agentCenterAvailable ? undefined : (zh ? '智能体中心未安装或当前不可用' : 'Agent Center is not installed or is currently unavailable')} onClick={openAgentCenterForAttachment}>{zh ? '从智能体中心挂载' : 'Attach in Agent Center'}</button></div>
                {!policyConnected && <p data-paimind-skill-contract-note role={userPolicy.status === 'error' ? 'alert' : 'status'}><PaimindWarningIcon size={14} />{userPolicy.status === 'error' ? userPolicy.error : (zh ? '用户技能策略接口缺失，开关保持锁定且不会伪造成功。' : 'User Skill Policy API is unavailable; controls stay locked and never fake success.')}</p>}
              </section>
              <details data-paimind-skill-disclosure><summary>{zh ? '来源信息' : 'Source details'}</summary><dl data-paimind-skill-meta><div data-paimind-skill-meta-row><dt>{zh ? '来源' : 'Source'}</dt><dd>{installedRecommended?.source ?? (zh ? '用户创建或导入' : 'Created or imported by user')}</dd></div><div data-paimind-skill-meta-row><dt>{zh ? '管理' : 'Managed'}</dt><dd>{installedDetail.managed ? (zh ? '技能中心管理；修改和卸载均保留备份' : 'Managed here with recoverable edits and uninstall') : (zh ? '请回到原来源管理' : 'Manage from its original source')}</dd></div></dl></details>
              <div data-paimind-skill-actions>{installedDetail.managed && <button type="button" data-paimind-skill-button data-primary="true" disabled={busy} onClick={() => { void editSkill(installedDetail.skillId) }}><PaimindEditIcon size={14} />{zh ? '编辑' : 'Edit'}</button>}{installedRecommended !== undefined && !installedCurrent && <button type="button" data-paimind-skill-button disabled={busy} onClick={() => { void inspectRecommended(installedRecommended) }}><PaimindCheckIcon size={14} />{zh ? '更新' : 'Update'}</button>}{installedDetail.managed ? <button type="button" data-paimind-skill-button data-danger="true" disabled={busy} onClick={() => { setUninstallTarget(installedDetail) }}><PaimindTrashIcon size={14} />{zh ? '卸载' : 'Uninstall'}</button> : <button type="button" data-paimind-skill-button disabled>{zh ? '由原来源管理' : 'Managed externally'}</button>}</div>
            </>}
          </aside>
        </div>}
      </section>
    </div>}
    {uploadGuideOpen && <div data-paimind-skill-dialog-backdrop><section role="dialog" aria-modal="true" aria-labelledby="paimind-skill-import-guide-title" aria-describedby="paimind-skill-import-guide-copy" data-paimind-skill-dialog data-paimind-skill-import-guide onKeyDown={event => { handleDialogKey(event, () => { setUploadGuideOpen(false) }) }}>
      <div data-paimind-skill-dialog-head><span data-paimind-skill-detail-icon><PaimindUploadIcon size={24} /></span><div><p data-paimind-skill-eyebrow>{zh ? '本地个人导入' : 'Local personal import'}</p><h2 id="paimind-skill-import-guide-title">{zh ? '选择一个可识别的 Skill 包' : 'Choose a recognizable Skill package'}</h2></div></div>
      <p id="paimind-skill-import-guide-copy">{zh ? '导入前先确认包结构。选择文件后会先进行安全检查和预览，只有再次确认才会安装。' : 'Check the package structure first. After selection, PAIMind performs a safety review and preview before anything is installed.'}</p>
      <div data-paimind-skill-import-formats><section><strong>SKILL.md</strong><p>{zh ? '适合只有一份说明文件的 Skill。文件必须包含 YAML Frontmatter（至少 name 与 description）。' : 'For a single-file Skill. It must include YAML frontmatter with at least name and description.'}</p></section><section><strong>ZIP</strong><p>{zh ? '适合包含脚本、参考资料或资源的 Skill。ZIP 根目录必须能找到 SKILL.md。' : 'For Skills with scripts, references, or assets. SKILL.md must be discoverable at the ZIP root.'}</p></section></div>
      <div data-paimind-skill-import-tree aria-label={zh ? 'Skill 包结构示例' : 'Skill package structure example'}><code>my-skill/<br />├── SKILL.md <b>{zh ? '必需' : 'required'}</b><br />├── scripts/ <i>{zh ? '可选' : 'optional'}</i><br />├── references/ <i>{zh ? '可选' : 'optional'}</i><br />└── assets/ <i>{zh ? '可选' : 'optional'}</i></code></div>
      <ul data-paimind-skill-import-rules><li>{zh ? '不要包含密码、令牌或其他凭证。' : 'Do not include passwords, tokens, or other credentials.'}</li><li>{zh ? '本阶段只安装到当前用户的个人 Skill 范围。' : 'This phase installs only to the current user’s personal Skill scope.'}</li><li>{zh ? 'PAIMind 负责检查与安装；Harness 继续负责发现和执行。' : 'PAIMind reviews and installs; Harness remains responsible for discovery and execution.'}</li></ul>
      <div data-paimind-skill-dialog-actions><button ref={uploadGuidePrimary} type="button" data-paimind-skill-button data-primary="true" onClick={openFolderPicker}><PaimindUploadIcon size={14} />{zh ? '选择文件夹' : 'Choose folder'}</button><button type="button" data-paimind-skill-button onClick={openUploadPicker}>{zh ? '选择 ZIP / SKILL.md' : 'Choose ZIP / SKILL.md'}</button><button type="button" data-paimind-skill-button onClick={() => { setUploadGuideOpen(false) }}>{zh ? '取消' : 'Cancel'}</button></div>
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
    aria-current={snapshot.open ? 'page' : undefined}
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
  if (!snapshot.open) return null
  return <MountedSkillCenterSurface {...props} />
}

function MountedSkillCenterSurface(props: SkillCenterSurfaceProps): ReactNode {
  const [host, setHost] = useState<Readonly<PaimindProductCenterHost> | null>(null)
  const surface = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const target = resolvePaimindProductCenterHost()
    if (target === null) {
      props.controller.close(false)
      return
    }
    const release = installPaimindProductCenterHost(target)
    if (release === null) {
      props.controller.close(false)
      return
    }
    setHost(target)
    return release
  }, [props.controller])

  useEffect(() => {
    if (host === null || surface.current === null) return
    return installPaimindProductSurfaceInteraction(surface.current, props.controller)
  }, [host, props.controller])

  if (host === null) return null
  return createPortal(<main
    ref={surface}
    data-paimind-product-surface="skill-center"
    aria-labelledby="paimind-skill-center-title"
  >
    <SkillMarketSection {...props} close={() => { props.controller.close() }} />
  </main>, host.mount)
}

class SkillMarketBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('[paimind-skill-market]', error, info) }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

/** Open the existing Skill Center when the system authoring Tool prepares an unsaved draft. */
export function installSkillAuthoringDraftNavigation(
  sessions: HarnessSessionService,
  installer: SkillInstallerRemoteNamespace,
  surface: PaimindProductSurfaceController,
): () => void {
  let disposed = false
  let observedSessionId: string | undefined
  let offBinding: () => void = () => {}
  let inspecting = false
  let queued = false
  let authoringEnabled = installer.getUserSkillPolicy === undefined
  const seenDraftIds = new Set<string>()
  const applyPolicy = (policy: Readonly<PaimindUserSkillPolicyV1>): void => {
    authoringEnabled = policy.enabledOptionalSystemSkillNames.includes('paimind-skill-authoring')
  }
  const refreshPolicy = async (): Promise<void> => {
    if (installer.getUserSkillPolicy === undefined) return
    try { applyPolicy(remoteValue(await installer.getUserSkillPolicy())) } catch { authoringEnabled = false }
  }
  const inspect = async (): Promise<void> => {
    const sessionId = sessions.list.getSnapshot().current
    if (disposed || !authoringEnabled || sessionId === undefined) return
    if (inspecting) { queued = true; return }
    inspecting = true
    try {
      const draft = remoteValue(await installer.getAuthoringDraft({ sessionId }))
      if (disposed || draft === null || seenDraftIds.has(draft.draftId)) return
      seenDraftIds.add(draft.draftId)
      surface.open()
    } catch { /* authoring navigation is progressive enhancement */ }
    finally {
      inspecting = false
      if (queued && !disposed) { queued = false; void inspect() }
    }
  }
  const synchronize = (): void => {
    const sessionId = sessions.list.getSnapshot().current
    if (sessionId !== observedSessionId) {
      offBinding()
      offBinding = () => {}
      observedSessionId = sessionId
      if (sessionId !== undefined) offBinding = sessions.binding?.(sessionId)?.session.subscribe(() => { void inspect() }) ?? (() => {})
    }
    void inspect()
  }
  const policyChanged = (event: Event): void => {
    const policy = (event as CustomEvent<Readonly<PaimindUserSkillPolicyV1>>).detail
    if (policy?.schema === 'paimind.user-skill-policy/v1') applyPolicy(policy)
    else void refreshPolicy()
  }
  const offList = sessions.list.subscribe(synchronize)
  window.addEventListener('paimind:user-skill-policy-changed', policyChanged)
  void refreshPolicy().finally(synchronize)
  return () => {
    disposed = true
    offBinding()
    offList()
    window.removeEventListener('paimind:user-skill-policy-changed', policyChanged)
  }
}

export async function apply(ctx: SkillMarketClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const mounted = ctx.inject([...BASE_INJECT, 'remote.paimindSkillInstaller'], scope => {
    const installer = scope.remote.paimindSkillInstaller
    if (installer === undefined) throw new Error('PAIMind Skill Installer Remote did not mount')
    const surfaceController = new PaimindProductSurfaceController('skill-center')
    scope.effect(installSkillMarketStyle, 'paimind-skill-market: style')
    scope.effect(() => () => { surfaceController.dispose() }, 'paimind-skill-market: surface controller')
    scope.effect(() => installSkillAuthoringDraftNavigation(scope.sessions, installer, surfaceController), 'paimind-skill-market: authoring draft navigation')
    contributePaimindExtension(scope.slots, {
      id: 'paimind:skill-market', packageName: '@paimind/skill-market', category: 'skills-tools',
      nameZh: '技能中心', nameEn: 'Skill Center',
      descriptionZh: '发现、创建、编辑和安装业务技能。',
      descriptionEn: 'Discover, create, edit, and install Business Skills.',
      surface: 'shell', maturity: 'available', order: 30,
    })
    const injectProps = () => ({
      controller: surfaceController,
      installer,
      sessions: scope.sessions,
      locale: scope.locale,
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
