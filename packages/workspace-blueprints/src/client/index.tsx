import { PAIMIND_UI_FOUNDATION_CSS } from '@hansen/ui-foundation'
import {
  Component,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  markHarnessClientStyle,
  contributePaimindExtension,
  type HarnessRemoteMountService,
  type HarnessRemoteResult,
  type HarnessSessionAuthoringApi,
  type HarnessSessionService,
  type HarnessWorkspaceService,
  type HarnessWorkspaceView,
  type PaimindClientContext,
  type PaimindLocaleSource,
} from '@hansen/harness-compat'
import {
  PaimindAgentIcon,
  PaimindCheckIcon,
  PaimindCloseIcon,
  PaimindEditIcon,
  PaimindTemplateIcon,
  PaimindPlusIcon,
  PaimindSearchIcon,
  PaimindSkillIcon,
  PaimindTrashIcon,
  PaimindUploadIcon,
  PaimindWarningIcon,
} from '@hansen/harness-compat/client-icons'
import {
  installPaimindProductCenterHost,
  installPaimindProductSurfaceInteraction,
  PaimindProductSurfaceController,
  resolvePaimindProductCenterHost,
  type PaimindProductCenterHost,
} from '@hansen/harness-compat/client-surface'
import {
  WORKSPACE_BLUEPRINT_CATEGORIES,
  type WorkspaceBlueprintAgentChoice,
  type WorkspaceBlueprintBindEntryAgentSessionInput,
  type WorkspaceBlueprintBindEntryAgentSessionResult,
  type WorkspaceBlueprintCatalogItem,
  type WorkspaceBlueprintCatalogPage,
  type WorkspaceBlueprintCategory,
  type WorkspaceBlueprintCategoryFilter,
  type WorkspaceBlueprintComposition,
  type WorkspaceBlueprintCompositionChoices,
  type WorkspaceBlueprintDeleteEntryInput,
  type WorkspaceBlueprintDetail,
  type WorkspaceBlueprintIdentityInput,
  type WorkspaceBlueprintListInput,
  type WorkspaceBlueprintManifest,
  type WorkspaceBlueprintMaterializeInput,
  type WorkspaceBlueprintMaterializeResult,
  type WorkspaceBlueprintMutationInput,
  type WorkspaceBlueprintMutationResult,
  type WorkspaceBlueprintPublishInput,
  type WorkspaceBlueprintReadTextInput,
  type WorkspaceBlueprintTextFile,
  type WorkspaceBlueprintUpdateCompositionInput,
  type WorkspaceBlueprintWriteTextInput,
} from '../contract.js'
import TYPERT_REMOTE from '../remote.js'
import { WORKSPACE_BLUEPRINT_CENTER_STYLE } from './styles.js'

const BASE_INJECT = ['slots', 'locale', 'remote', 'workspaces', 'sessions'] as const
export const inject = [...BASE_INJECT]
const STYLE_ID = '@hansen/workspace-blueprints'
const PAGE_SIZE = 50
const CHOICES_RETRY_DELAY_MS = 150
const EMPTY_COMPOSITION_CHOICES = Object.freeze({
  schema: 'paimind.workspace-blueprint-composition-choices/v1' as const,
  agents: Object.freeze({ status: 'unavailable' as const, items: Object.freeze([]) }),
  businessSkills: Object.freeze({ status: 'unavailable' as const, items: Object.freeze([]) }),
})

const CATEGORY_LABELS: Readonly<Record<WorkspaceBlueprintCategoryFilter, Readonly<{ zh: string; en: string }>>> = Object.freeze({
  all: Object.freeze({ zh: '全部', en: 'All' }),
  general: Object.freeze({ zh: '通用', en: 'General' }),
  'project-delivery': Object.freeze({ zh: '项目交付', en: 'Project delivery' }),
  research: Object.freeze({ zh: '研究', en: 'Research' }),
  data: Object.freeze({ zh: '数据', en: 'Data' }),
  content: Object.freeze({ zh: '内容', en: 'Content' }),
  engineering: Object.freeze({ zh: '工程', en: 'Engineering' }),
})

export function installWorkspaceBlueprintCenterStyle(): () => void {
  const existing = document.getElementById(STYLE_ID)
  const style = existing?.tagName === 'STYLE' ? existing as HTMLStyleElement : document.createElement('style')
  if (existing?.tagName !== 'STYLE') {
    style.id = STYLE_ID
    style.dataset.paimindPlugin = STYLE_ID; markHarnessClientStyle(style, STYLE_ID)
    document.head.append(style)
  }
  style.textContent = `${PAIMIND_UI_FOUNDATION_CSS}\n${WORKSPACE_BLUEPRINT_CENTER_STYLE}`
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

export interface WorkspaceBlueprintRemoteNamespace {
  listBlueprints(input?: Readonly<WorkspaceBlueprintListInput>): Promise<HarnessRemoteResult<Readonly<WorkspaceBlueprintCatalogPage>>>
  getCompositionChoices(): Promise<HarnessRemoteResult<Readonly<WorkspaceBlueprintCompositionChoices>>>
  materializeBlueprint(input: Readonly<WorkspaceBlueprintMaterializeInput>): Promise<HarnessRemoteResult<Readonly<WorkspaceBlueprintMaterializeResult>>>
  bindEntryAgentSession(input: Readonly<WorkspaceBlueprintBindEntryAgentSessionInput>): Promise<HarnessRemoteResult<Readonly<WorkspaceBlueprintBindEntryAgentSessionResult>>>
  publishBlueprint(input: Readonly<WorkspaceBlueprintPublishInput>): Promise<HarnessRemoteResult<Readonly<WorkspaceBlueprintManifest>>>
  getBlueprint(input: Readonly<WorkspaceBlueprintIdentityInput>): Promise<HarnessRemoteResult<Readonly<WorkspaceBlueprintDetail>>>
  readBlueprintText(input: Readonly<WorkspaceBlueprintReadTextInput>): Promise<HarnessRemoteResult<Readonly<WorkspaceBlueprintTextFile>>>
  writeBlueprintText(input: Readonly<WorkspaceBlueprintWriteTextInput>): Promise<HarnessRemoteResult<Readonly<WorkspaceBlueprintMutationResult>>>
  createBlueprintDirectory(input: Readonly<WorkspaceBlueprintMutationInput>): Promise<HarnessRemoteResult<Readonly<WorkspaceBlueprintMutationResult>>>
  deleteBlueprintFile(input: Readonly<WorkspaceBlueprintDeleteEntryInput>): Promise<HarnessRemoteResult<Readonly<WorkspaceBlueprintMutationResult>>>
  updateBlueprintComposition(input: Readonly<WorkspaceBlueprintUpdateCompositionInput>): Promise<HarnessRemoteResult<Readonly<WorkspaceBlueprintMutationResult>>>
}

interface WorkspaceBlueprintRemote extends HarnessRemoteMountService {
  readonly paimindWorkspaceBlueprints?: WorkspaceBlueprintRemoteNamespace
}

interface WorkspaceBlueprintClientContext extends PaimindClientContext {
  readonly remote: WorkspaceBlueprintRemote
  readonly workspaces: HarnessWorkspaceService
  readonly sessions: HarnessSessionService
  get(name: 'connection'): { readonly api: { readonly sessions: HarnessSessionAuthoringApi } }
  inject(
    services: readonly string[],
    install: (scope: WorkspaceBlueprintClientContext) => void | (() => void),
    label?: string,
  ): PromiseLike<unknown> & { dispose(): Promise<void> }
}

type CatalogState =
  | { readonly status: 'loading'; readonly items: readonly []; readonly nextCursor: null; readonly error: null }
  | { readonly status: 'ready'; readonly items: readonly Readonly<WorkspaceBlueprintCatalogItem>[]; readonly nextCursor: string | null; readonly error: null }
  | { readonly status: 'error'; readonly items: readonly []; readonly nextCursor: null; readonly error: string }

type DetailState =
  | { readonly status: 'idle' | 'loading'; readonly value: null; readonly error: null }
  | { readonly status: 'ready'; readonly value: Readonly<WorkspaceBlueprintDetail>; readonly error: null }
  | { readonly status: 'error'; readonly value: null; readonly error: string }

type OperationStage = 'idle' | 'validating' | 'picking' | 'registering' | 'materializing' | 'starting' | 'binding' | 'warning' | 'error'
type CatalogScope = 'market' | 'mine'
type CenterMode = 'browse' | 'publish'
type CompositionChoiceKind = 'agent' | 'business-skill'

interface PublishDraft {
  readonly workspaceId: string
  readonly blueprintId: string
  readonly version: string
  readonly name: string
  readonly description: string
  readonly category: WorkspaceBlueprintCategory
  readonly tags: string
  readonly agentKey: string
  readonly skillNames: readonly string[]
}

interface PendingWorkspace {
  readonly workspace: Readonly<HarnessWorkspaceView>
  readonly blueprint: Readonly<WorkspaceBlueprintCatalogItem>
}

function remoteValue<Value>(result: HarnessRemoteResult<Value>): Value {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : 'Unknown error'
}

const ZH_ERROR_MESSAGES = new Map<string, string>([
  ['Unknown error', '未知错误'],
  ['Workspace Blueprint target already has Sessions', '目标工作区已有会话，不能采用此模板'],
  ['Workspace Blueprint target must be empty', '目标文件夹必须为空'],
  ['Workspace Blueprint digest conflict', '模板版本已变化，请刷新后重试'],
  ['Workspace Blueprint materialization verification failed', '模板文件复制后校验失败'],
  ['Workspace Blueprint publication verification failed', '个人模板发布后校验失败'],
  ['Workspace Blueprint target changed before materialization', '目标文件夹在复制开始前已变化'],
  ['Workspace Blueprint target changed during materialization', '目标文件夹在复制过程中已变化'],
  ['Workspace Blueprint patch version is exhausted', '模板补丁版本号已用尽'],
  ['Built-in Workspace Blueprints are read-only', '内置工作区模板为只读'],
  ['Workspace Blueprint file is too large', '模板文件超出大小限制'],
  ['Workspace Blueprint exceeds the total size limit', '模板超出总大小限制'],
  ['Workspace Blueprint mutation parent is not a safe directory', '父目录不存在或不可用，请先逐级创建父目录'],
  ['Published Workspace Blueprint identity did not match the request', '宿主返回的模板与当前发布请求不一致，已停止后续操作'],
  ['Native entry Session did not preserve the saved Agent Preset', '入口会话未保留模板绑定的精确智能体版本'],
  ['Workspace Blueprint entry Session binding did not match the materialized package composition', '入口智能体绑定校验失败，已停止打开会话'],
  ['Workspace Blueprint result did not match the requested Workspace, path, and package identity', '宿主返回的复制结果与当前请求不一致，已停止后续操作'],
])

const ZH_ERROR_PREFIXES: readonly (readonly [string, string])[] = Object.freeze([
  ['Workspace Blueprint not found: ', '找不到工作区模板：'],
  ['Workspace Blueprint version already exists: ', '模板版本已存在：'],
  ['Workspace Blueprint text file not found: ', '找不到模板文本文件：'],
  ['Workspace Blueprint entry not found: ', '找不到模板文件或文件夹：'],
  ['Workspace Blueprint file is too large: ', '模板文件超出大小限制：'],
  ['Workspace Blueprint contains an excluded path: ', '模板包含已排除路径：'],
  ['Workspace Blueprint contains a sensitive path: ', '模板包含敏感路径：'],
  ['Symbolic links are not supported in Workspace Blueprints: ', '工作区模板不支持符号链接：'],
  ['Unknown Harness Workspace: ', '找不到 Harness 工作区：'],
])

const ZH_ERROR_PATTERNS: readonly (readonly [RegExp, string])[] = Object.freeze([
  [/digest (?:conflict|mismatch)|changed before mutation/i, '模板已被更新或内容版本不一致，请刷新后重试'],
  [/Built-in Workspace Blueprint.*read-only/i, '内置模板只读；如需修改，请先从工作区发布为个人模板'],
  [/version already exists|Duplicate Workspace Blueprint version/i, '该模板版本已存在，请刷新后继续编辑'],
  [/path traversal|path escapes|file target is unsafe|target escapes its repository|identity root escapes/i, '该路径不安全，操作已被阻止'],
  [/is not a safe directory|cannot be a filesystem root|Unsupported Workspace Blueprint entry type/i, '该文件夹或文件类型不受支持'],
  [/exceeds \d+ files/i, '模板文件数量超出限制'],
  [/manifest is invalid|catalog contains an unsafe entry|version is not a safe directory|path identity mismatch|source is invalid/i, '模板目录损坏或格式不兼容，请检查模板文件后重试'],
  [/composition receipt is (?:invalid|unsafe|too large)|receipt does not match its immutable package/i, '工作区模板回执损坏或与已保存版本不一致，已停止加载'],
  [/non-empty directory deletion requires recursive=true/i, '目录中仍有内容，请确认递归删除'],
])

function localizedErrorMessage(error: unknown, zh: boolean): string {
  const message = errorMessage(error)
  if (!zh) return message
  const exact = ZH_ERROR_MESSAGES.get(message)
  if (exact !== undefined) return exact
  const prefix = ZH_ERROR_PREFIXES.find(([source]) => message.startsWith(source))
  if (prefix !== undefined) return `${prefix[1]}${message.slice(prefix[0].length)}`
  const pattern = ZH_ERROR_PATTERNS.find(([matcher]) => matcher.test(message))
  return pattern?.[1] ?? '操作未完成，请重试；如问题持续，请查看运行日志。'
}

function localizedWarningMessage(message: string, zh: boolean): string {
  if (!zh) return message
  const prefix = 'The original empty Workspace directory remains recoverable at '
  return message.startsWith(prefix)
    ? `原空工作区目录未能自动清理，仍可在以下位置恢复：${message.slice(prefix.length)}`
    : '模板文件已复制，但清理临时目录时出现警告。'
}

function itemKey(item: Pick<WorkspaceBlueprintIdentityInput, 'blueprintId' | 'version'>): string {
  return `${item.blueprintId}@${item.version}`
}

function formatBytes(value: number, locale: string): string {
  if (value < 1024) return `${new Intl.NumberFormat(locale).format(value)} B`
  const units = ['KB', 'MB', 'GB'] as const
  let amount = value / 1024
  let unit: typeof units[number] = 'KB'
  for (const candidate of units.slice(1)) {
    if (amount < 1024) break
    amount /= 1024
    unit = candidate
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: amount < 10 ? 1 : 0 }).format(amount)} ${unit}`
}

function categoryLabel(category: WorkspaceBlueprintCategoryFilter, zh: boolean): string {
  return zh ? CATEGORY_LABELS[category].zh : CATEGORY_LABELS[category].en
}

function stageLabel(stage: OperationStage, zh: boolean): string {
  if (stage === 'validating') return zh ? '正在核验模板…' : 'Validating template…'
  if (stage === 'picking') return zh ? '正在选择文件夹…' : 'Choosing a folder…'
  if (stage === 'registering') return zh ? '正在注册工作区…' : 'Registering Workspace…'
  if (stage === 'materializing') return zh ? '正在复制模板文件…' : 'Copying template files…'
  if (stage === 'starting') return zh ? '正在创建首个对话…' : 'Creating entry conversation…'
  if (stage === 'binding') return zh ? '正在设置首个对话的智能体…' : 'Binding entry Agent…'
  return ''
}

function nextPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(version)
  return match === null ? '1.0.0' : `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

function agentKey(profile: Pick<WorkspaceBlueprintAgentChoice, 'agentId' | 'presetId' | 'configVersion'>): string {
  return `${profile.agentId}\u0000${profile.presetId}\u0000${profile.configVersion}`
}

function emptyPublishDraft(): PublishDraft {
  return {
    workspaceId: '', blueprintId: `workspace-template-${Date.now().toString(36)}`, version: '1.0.0', name: '', description: '',
    category: 'general', tags: '', agentKey: '', skillNames: Object.freeze([]),
  }
}

function wait(delay: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, delay) })
}

function entryIsVisible(path: string, expandedDirectories: ReadonlySet<string>): boolean {
  const segments = path.split('/')
  for (let index = 1; index < segments.length; index += 1) {
    if (!expandedDirectories.has(segments.slice(0, index).join('/'))) return false
  }
  return true
}

function choiceStateCopy(
  kind: CompositionChoiceKind,
  status: 'ready' | 'unavailable' | 'error',
  itemCount: number,
  loading: boolean,
  requestError: string | null,
  zh: boolean,
): Readonly<{ readonly message: string; readonly alert: boolean; readonly retry: boolean }> | null {
  const noun = kind === 'agent' ? (zh ? '智能体' : 'Agent') : (zh ? '业务技能' : 'Business Skill')
  if (loading) return { message: zh ? `正在加载${noun}选项…` : `Loading ${noun} choices…`, alert: false, retry: false }
  if (requestError !== null) return { message: zh ? `${noun}选项加载失败：${requestError}` : `${noun} choices failed to load: ${requestError}`, alert: true, retry: true }
  if (status === 'unavailable') return { message: zh ? `${noun}中心当前未连接；可以保持不绑定。` : `${noun} Center is not connected. You can leave this unbound.`, alert: false, retry: true }
  if (status === 'error') return { message: zh ? `${noun}列表读取失败；可以重试或保持不绑定。` : `${noun} choices could not be read. Retry or leave this unbound.`, alert: true, retry: true }
  if (itemCount === 0) return { message: zh ? `暂无可选择的${noun}。` : `No ${noun} choices are currently available.`, alert: false, retry: false }
  return null
}

/** Fail closed when a saved exact binding is missing, disabled, unhealthy, or changed. */
export function preflightWorkspaceBlueprintComposition(
  composition: Readonly<WorkspaceBlueprintComposition>,
  choices: Readonly<WorkspaceBlueprintCompositionChoices>,
  zh = false,
): void {
  if (composition.agent !== null) {
    if (choices.agents.status !== 'ready') throw new Error(zh ? '智能体中心当前不可用，无法核验模板保存的智能体版本。' : 'Agent Center is unavailable, so the saved Agent revision cannot be validated.')
    const profile = choices.agents.items.find(candidate => (
      candidate.agentId === composition.agent?.agentId
      && candidate.presetId === composition.agent.presetId
      && candidate.configVersion === composition.agent.configVersion
    ))
    if (profile === undefined) throw new Error(zh ? '模板绑定的智能体版本已不存在或已变更。请由模板作者发布新版本。' : 'The exact Agent revision saved by this package no longer exists. Ask the author to publish a new package version.')
  }
  if (composition.businessSkills.length === 0) return
  if (choices.businessSkills.status !== 'ready') throw new Error(zh ? '技能中心当前不可用，无法核验模板保存的业务技能。' : 'Skill Center is unavailable, so the saved Business Skills cannot be validated.')
  for (const binding of composition.businessSkills) {
    const current = choices.businessSkills.items.find(candidate => candidate.name === binding.name)
    if (current === undefined) throw new Error(zh ? `业务技能 ${binding.name} 未安装或未启用。` : `Business Skill ${binding.name} is not installed or enabled.`)
    if (current.digest !== binding.digest) throw new Error(zh ? `业务技能 ${binding.name} 的实时文件夹版本已变化。请由模板作者发布新版本。` : `The managed-folder revision of Business Skill ${binding.name} changed. Ask the author to publish a new package version.`)
  }
}

export interface WorkspaceBlueprintCenterProps {
  readonly close: (restoreFocus?: boolean) => void
  readonly acquireCloseBlock?: () => () => void
  readonly blueprints: WorkspaceBlueprintRemoteNamespace
  readonly workspaces: HarnessWorkspaceService
  readonly locale: PaimindLocaleSource
  readonly sessions?: HarnessSessionService
  readonly sessionApi?: HarnessSessionAuthoringApi
}

export function WorkspaceBlueprintCenter(props: WorkspaceBlueprintCenterProps): React.JSX.Element {
  const locale = useSyncExternalStore(props.locale.subscribe.bind(props.locale), () => props.locale.getLocale().active, () => props.locale.getLocale().active)
  const workspaceSnapshot = useSyncExternalStore(props.workspaces.list.subscribe.bind(props.workspaces.list), props.workspaces.list.getSnapshot.bind(props.workspaces.list), props.workspaces.list.getSnapshot.bind(props.workspaces.list))
  const zh = locale.startsWith('zh')
  const [mode, setMode] = useState<CenterMode>('browse')
  const [scope, setScope] = useState<CatalogScope>('market')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<WorkspaceBlueprintCategoryFilter>('all')
  const [refresh, setRefresh] = useState(0)
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading', items: [], nextCursor: null, error: null })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailState>({ status: 'idle', value: null, error: null })
  const [selectedEntryPath, setSelectedEntryPath] = useState<string | null>(null)
  const [textFile, setTextFile] = useState<Readonly<WorkspaceBlueprintTextFile> | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const [newPath, setNewPath] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [stage, setStage] = useState<OperationStage>('idle')
  const [operationError, setOperationError] = useState<string | null>(null)
  const [operationWarning, setOperationWarning] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingWorkspace | null>(null)
  const [publishDraft, setPublishDraft] = useState<PublishDraft>(emptyPublishDraft)
  const [publishIsRevision, setPublishIsRevision] = useState(false)
  const [publishCompositionExpanded, setPublishCompositionExpanded] = useState(false)
  const [publishSkillQuery, setPublishSkillQuery] = useState('')
  const [choices, setChoices] = useState<Readonly<WorkspaceBlueprintCompositionChoices>>(EMPTY_COMPOSITION_CHOICES)
  const [choicesLoading, setChoicesLoading] = useState(false)
  const [choicesRequestError, setChoicesRequestError] = useState<string | null>(null)
  const [compositionEditing, setCompositionEditing] = useState(false)
  const [compositionExpanded, setCompositionExpanded] = useState(false)
  const [compositionAgentKey, setCompositionAgentKey] = useState('')
  const [compositionSkillNames, setCompositionSkillNames] = useState<readonly string[]>(Object.freeze([]))
  const [compositionSkillQuery, setCompositionSkillQuery] = useState('')
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(() => new Set())
  const requestGeneration = useRef(0)
  const detailGeneration = useRef(0)
  const choicesGeneration = useRef(0)
  const operationInFlight = useRef(false)
  const loadMoreInFlight = useRef(false)
  const mounted = useRef(true)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  useEffect(() => {
    const generation = ++requestGeneration.current
    let active = true
    setCatalog({ status: 'loading', items: [], nextCursor: null, error: null })
    setLoadingMore(false)
    const input: WorkspaceBlueprintListInput = {
      category, source: scope === 'market' ? 'builtin' : 'user', limit: PAGE_SIZE,
      ...(query.trim() === '' ? {} : { query: query.trim() }),
    }
    void props.blueprints.listBlueprints(input).then(result => {
      if (!active || generation !== requestGeneration.current) return
      const page = remoteValue(result)
      setCatalog({ status: 'ready', items: page.items, nextCursor: page.nextCursor ?? null, error: null })
    }).catch(error => {
      if (!active || generation !== requestGeneration.current) return
      setCatalog({ status: 'error', items: [], nextCursor: null, error: localizedErrorMessage(error, zh) })
    })
    return () => { active = false }
  }, [category, props.blueprints, query, refresh, scope])

  const selected = useMemo(() => catalog.status === 'ready'
    ? catalog.items.find(item => itemKey(item) === selectedKey) ?? catalog.items[0] ?? null
    : null, [catalog, selectedKey])

  useEffect(() => {
    const generation = ++detailGeneration.current
    setSelectedEntryPath(null); setTextFile(null); setTextDraft(''); setCompositionEditing(false); setCompositionExpanded(false); setCompositionSkillQuery(''); setExpandedDirectories(new Set())
    if (selected === null) { setDetail({ status: 'idle', value: null, error: null }); return }
    setDetail({ status: 'loading', value: null, error: null })
    void props.blueprints.getBlueprint({ blueprintId: selected.blueprintId, version: selected.version }).then(result => {
      const value = remoteValue(result)
      if (generation === detailGeneration.current) {
        setDetail({ status: 'ready', value, error: null })
        setExpandedDirectories(new Set(value.entries.filter(entry => entry.kind === 'directory').map(entry => entry.path)))
      }
    }).catch(error => {
      if (generation === detailGeneration.current) setDetail({ status: 'error', value: null, error: localizedErrorMessage(error, zh) })
    })
  }, [props.blueprints, selected])

  const loadChoices = async (): Promise<Readonly<WorkspaceBlueprintCompositionChoices>> => {
    const generation = ++choicesGeneration.current
    setChoicesLoading(true); setChoicesRequestError(null)
    try {
      let failure: unknown = null
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const value = remoteValue(await props.blueprints.getCompositionChoices())
          if (mounted.current && generation === choicesGeneration.current) setChoices(value)
          return value
        } catch (error) {
          failure = error
          if (attempt === 0) await wait(CHOICES_RETRY_DELAY_MS)
        }
      }
      throw failure
    } catch (error) {
      if (mounted.current && generation === choicesGeneration.current) {
        setChoices(EMPTY_COMPOSITION_CHOICES)
        setChoicesRequestError(localizedErrorMessage(error, zh))
      }
      throw error
    } finally {
      if (mounted.current && generation === choicesGeneration.current) setChoicesLoading(false)
    }
  }

  const openPublish = (seed?: Readonly<WorkspaceBlueprintCatalogItem>): void => {
    const blank = emptyPublishDraft()
    setPublishDraft(seed === undefined ? blank : {
      ...blank, blueprintId: seed.blueprintId, version: nextPatchVersion(seed.version), name: seed.name,
      description: seed.description, category: seed.category, tags: seed.tags.join(', '),
      agentKey: seed.composition.agent === null ? '' : agentKey(seed.composition.agent),
      skillNames: Object.freeze(seed.composition.businessSkills.map(skill => skill.name)),
    })
    setPublishIsRevision(seed !== undefined); setPublishCompositionExpanded(false); setPublishSkillQuery('')
    setChoices(EMPTY_COMPOSITION_CHOICES); setChoicesRequestError(null); setMode('publish'); setOperationError(null); setNotice(null)
  }

  const compositionFor = (savedAgentKey: string, savedSkillNames: readonly string[], available = choices): Readonly<WorkspaceBlueprintComposition> => {
    const agent = savedAgentKey === '' ? null : available.agents.items.find(profile => agentKey(profile) === savedAgentKey)
    if (savedAgentKey !== '' && agent === undefined) throw new Error(zh ? '请选择当前可用的精确智能体版本。' : 'Choose an available exact Agent revision.')
    const businessSkills = savedSkillNames.map(name => {
      const skill = available.businessSkills.items.find(candidate => candidate.name === name)
      if (skill === undefined) throw new Error(zh ? `业务技能 ${name} 当前不可用。` : `Business Skill ${name} is unavailable.`)
      return Object.freeze({ name: skill.name, digest: skill.digest })
    })
    return Object.freeze({
      agent: agent === null || agent === undefined ? null : Object.freeze({ agentId: agent.agentId, presetId: agent.presetId, configVersion: agent.configVersion }),
      businessSkills: Object.freeze(businessSkills),
    })
  }

  const registerLocalFolder = async (): Promise<void> => {
    if (operationInFlight.current) return
    if (props.workspaces.pickDirectory === undefined || props.workspaces.create === undefined) {
      setOperationError(zh ? '当前 Harness 不支持安全选择并注册本地文件夹。' : 'This Harness host cannot safely choose and register a local folder.')
      return
    }
    operationInFlight.current = true; setStage('picking'); setOperationError(null)
    try {
      const path = await props.workspaces.pickDirectory()
      if (path === null) return
      const existing = props.workspaces.list.getSnapshot().items.find(workspace => workspace.path === path)
      const workspace = existing ?? await (async () => { setStage('registering'); return await props.workspaces.create!({ path }) })()
      setPublishDraft(current => ({ ...current, workspaceId: workspace.workspaceId }))
      setNotice(existing === undefined
        ? (zh ? '本地文件夹已注册为 Harness 工作区，可以发布模板。' : 'The local folder is now a registered Harness Workspace and can be published.')
        : (zh ? '这个文件夹已经是 Harness 工作区，已直接复用。' : 'This folder is already a Harness Workspace and was reused.'))
    } catch (error) { setOperationError(localizedErrorMessage(error, zh)) }
    finally { operationInFlight.current = false; setStage('idle') }
  }

  const publishBlueprint = async (): Promise<void> => {
    if (operationInFlight.current) return
    operationInFlight.current = true
    const release = props.acquireCloseBlock?.() ?? (() => {})
    setStage('validating'); setOperationError(null); setNotice(null)
    try {
      if (!workspaceSnapshot.baselinesReady || workspaceSnapshot.state !== 'idle') throw new Error(zh ? '工作区目录尚未就绪。' : 'The Workspace registry is not ready.')
      if (!workspaceSnapshot.items.some(workspace => workspace.workspaceId === publishDraft.workspaceId)) throw new Error(zh ? '请选择已注册的来源工作区。' : 'Choose a registered source Workspace.')
      const available = publishDraft.agentKey !== '' || publishDraft.skillNames.length > 0 ? await loadChoices() : choices
      const composition = compositionFor(publishDraft.agentKey, publishDraft.skillNames, available)
      const value = remoteValue(await props.blueprints.publishBlueprint({
        workspaceId: publishDraft.workspaceId,
        blueprintId: publishDraft.blueprintId,
        version: publishDraft.version,
        name: publishDraft.name,
        description: publishDraft.description,
        category: publishDraft.category,
        tags: publishDraft.tags.split(',').map(tag => tag.trim()).filter(Boolean),
        composition,
      }))
      if (value.source !== 'user' || value.blueprintId !== publishDraft.blueprintId || value.version !== publishDraft.version) throw new Error('Published Workspace Blueprint identity did not match the request')
      setSelectedKey(itemKey(value)); setScope('mine'); setMode('browse'); setRefresh(current => current + 1)
      setNotice(zh ? `个人模板 ${value.name} v${value.version} 已发布。` : `Personal template ${value.name} v${value.version} was published.`)
    } catch (error) { setStage('error'); setOperationError(localizedErrorMessage(error, zh)) }
    finally {
      release(); operationInFlight.current = false
      if (mounted.current) setStage(current => current === 'error' ? current : 'idle')
    }
  }

  const startEntrySession = async (workspace: Readonly<HarnessWorkspaceView>, item: Readonly<WorkspaceBlueprintCatalogItem>): Promise<string|undefined> => {
    const agent = item.composition.agent
    if (agent === null) {
      if(props.sessionApi!==undefined&&props.sessions!==undefined){
        const created=remoteValue((await props.sessionApi.create({workspaceId:workspace.workspaceId})).result)
        if(!created.sessionId.trim())throw new Error('Native entry Session identity is missing')
        props.sessions.open(created.sessionId)
        return created.sessionId
      }
      props.workspaces.startSession(workspace.workspaceId)
      return
    }
    if (props.sessionApi === undefined || props.sessions === undefined) {
      throw new Error(zh ? '当前 Harness 未提供精确创建入口智能体对话的契约。' : 'This Harness host cannot create an entry conversation with the exact saved Agent.')
    }
    const created = remoteValue((await props.sessionApi.create({ workspaceId: workspace.workspaceId, agentPreset: agent.presetId })).result)
    if (created.sessionId.trim() === '' || created.agentPreset !== agent.presetId) throw new Error('Native entry Session did not preserve the saved Agent Preset')
    setStage('binding')
    const binding = remoteValue(await props.blueprints.bindEntryAgentSession({
      workspaceId: workspace.workspaceId,
      sessionId: created.sessionId,
      blueprintId: item.blueprintId,
      version: item.version,
      expectedDigest: item.digest,
    }))
    if (binding.workspaceId !== workspace.workspaceId || binding.sessionId !== created.sessionId
      || binding.blueprintId !== item.blueprintId || binding.version !== item.version || binding.digest !== item.digest
      || binding.agent.agentId !== agent.agentId || binding.agent.presetId !== agent.presetId
      || binding.agent.configVersion !== agent.configVersion) {
      throw new Error('Workspace Blueprint entry Session binding did not match the materialized package composition')
    }
    props.sessions.open(created.sessionId)
    return created.sessionId
  }

  const [adoptionPath,setAdoptionPath]=useState('')
  const adoptBlueprint = async (item: Readonly<WorkspaceBlueprintCatalogItem>): Promise<void> => {
    if (operationInFlight.current) return
    if ((props.workspaces.pickDirectory === undefined && !adoptionPath.trim()) || props.workspaces.create === undefined) {
      setStage('error'); setOperationError(zh ? '当前 Harness 不支持目录选择或工作区注册。' : 'This Harness host does not support directory picking or Workspace registration.'); return
    }
    const baseline = props.workspaces.list.getSnapshot()
    if (!baseline.baselinesReady || baseline.state !== 'idle') {
      setStage('error')
      setOperationError(baseline.state === 'error'
        ? (zh ? `原生工作区列表不可用：${baseline.error?.message ?? '未知错误'}` : `The native Workspace list is unavailable: ${baseline.error?.message ?? 'Unknown error'}`)
        : (zh ? '原生工作区列表尚未就绪，请稍后重试。' : 'The native Workspace list is not ready yet. Try again shortly.'))
      return
    }
    operationInFlight.current = true
    const release = props.acquireCloseBlock?.() ?? (() => {})
    let registeredWorkspace: HarnessWorkspaceView | null = null
    let closeAfterSuccess = false
    setOperationError(null); setOperationWarning(null); setNotice(null); setPending(null)
    try {
      setStage('validating')
      if (item.composition.agent !== null || item.composition.businessSkills.length > 0) {
        preflightWorkspaceBlueprintComposition(item.composition, await loadChoices(), zh)
      }
      if (item.composition.agent !== null && (props.sessionApi === undefined || props.sessions === undefined)) throw new Error(zh ? '当前 Harness 缺少入口智能体对话绑定能力。' : 'This Harness host is missing entry Agent conversation binding support.')
      setStage('picking')
      const path = adoptionPath.trim() || await props.workspaces.pickDirectory?.() || null
      if (path === null) { setStage('idle'); return }
      setStage('registering')
      const workspace = await props.workspaces.create({ path })
      registeredWorkspace = workspace
      setStage('materializing')
      const result = remoteValue(await props.blueprints.materializeBlueprint({ workspaceId: workspace.workspaceId, blueprintId: item.blueprintId, version: item.version, expectedDigest: item.digest }))
      if (result.workspaceId !== workspace.workspaceId || result.path !== workspace.path || result.blueprintId !== item.blueprintId || result.version !== item.version || result.digest !== item.digest) throw new Error('Workspace Blueprint result did not match the requested Workspace, path, and package identity')
      if (result.warnings.length > 0) {
        setPending({ workspace, blueprint: item }); setStage('warning')
        setOperationWarning(zh
          ? `模板文件已经复制，但清理临时目录时出现警告：${result.warnings.map(message => localizedWarningMessage(message, zh)).join('；')}。确认后再创建首个对话。`
          : `The template files were copied, but cleanup reported: ${result.warnings.join('; ')}. Review this warning before creating the entry conversation.`)
        return
      }
      setStage('starting'); const sessionId=await startEntrySession(workspace, item); window.dispatchEvent(new CustomEvent('paimind:workspace-adopted',{detail:{workspaceId:workspace.workspaceId,sessionId}})); closeAfterSuccess = true
    } catch (error) {
      setStage('error')
      const reason = localizedErrorMessage(error, zh)
      setOperationError(registeredWorkspace === null ? reason : (zh
        ? `原生工作区已注册并保留，但后续采用流程未完成；系统没有自动删除所选目录。原因：${reason}`
        : `The native Workspace registration was kept, but adoption did not finish. The selected directory was not deleted. Reason: ${reason}`))
    } finally {
      release(); operationInFlight.current = false
      if (closeAfterSuccess) props.close(false)
    }
  }

  const openPendingWorkspace = async (): Promise<void> => {
    if (pending === null || operationInFlight.current) return
    operationInFlight.current = true
    const release = props.acquireCloseBlock?.() ?? (() => {})
    let closeAfterSuccess = false
    setOperationError(null)
    try { setStage('starting'); const sessionId=await startEntrySession(pending.workspace, pending.blueprint); window.dispatchEvent(new CustomEvent('paimind:workspace-adopted',{detail:{workspaceId:pending.workspace.workspaceId,sessionId}})); closeAfterSuccess = true }
    catch (error) { setStage('error'); setOperationError(localizedErrorMessage(error, zh)) }
    finally {
      release(); operationInFlight.current = false
      if (closeAfterSuccess) props.close(false)
    }
  }

  const loadMore = async (): Promise<void> => {
    if (catalog.status !== 'ready' || catalog.nextCursor === null || loadMoreInFlight.current) return
    loadMoreInFlight.current = true
    const generation = requestGeneration.current
    setLoadingMore(true)
    try {
      const page = remoteValue(await props.blueprints.listBlueprints({ category, source: scope === 'market' ? 'builtin' : 'user', cursor: catalog.nextCursor, limit: PAGE_SIZE, ...(query.trim() === '' ? {} : { query: query.trim() }) }))
      if (generation !== requestGeneration.current) return
      setCatalog(current => {
        if (current.status !== 'ready') return current
        const merged = new Map(current.items.map(item => [itemKey(item), item]))
        for (const item of page.items) merged.set(itemKey(item), item)
        return { status: 'ready', items: [...merged.values()], nextCursor: page.nextCursor ?? null, error: null }
      })
    } catch (error) { if (generation === requestGeneration.current) setOperationError(localizedErrorMessage(error, zh)) }
    finally { loadMoreInFlight.current = false; if (generation === requestGeneration.current) setLoadingMore(false) }
  }

  const selectEntry = async (path: string): Promise<void> => {
    if (selected === null || detail.status !== 'ready') return
    const entry = detail.value.entries.find(candidate => candidate.path === path)
    setSelectedEntryPath(path); setTextFile(null); setTextDraft(''); setOperationError(null)
    if (entry?.kind !== 'text') return
    try {
      const file = remoteValue(await props.blueprints.readBlueprintText({ blueprintId: selected.blueprintId, version: selected.version, path }))
      setTextFile(file); setTextDraft(file.text)
    } catch (error) { setOperationError(localizedErrorMessage(error, zh)) }
  }

  const completeMutation = (baseVersion: string, result: Readonly<WorkspaceBlueprintMutationResult>): void => {
    setSelectedKey(itemKey(result)); setRefresh(current => current + 1); setSelectedEntryPath(null); setTextFile(null); setTextDraft(''); setNewPath(''); setCompositionEditing(false)
    setNotice(zh ? `修改已保存为 v${result.version}，原版本 v${baseVersion} 保持不变。` : `Changes were saved as v${result.version}; the original v${baseVersion} remains unchanged.`)
  }

  const mutationInput = (item: Readonly<WorkspaceBlueprintCatalogItem>, path: string): WorkspaceBlueprintMutationInput => ({ blueprintId: item.blueprintId, version: item.version, expectedDigest: item.digest, path })

  const mutate = async (run: () => Promise<HarnessRemoteResult<Readonly<WorkspaceBlueprintMutationResult>>>): Promise<void> => {
    if (selected === null || selected.source !== 'user' || operationInFlight.current) return
    operationInFlight.current = true
    const release = props.acquireCloseBlock?.() ?? (() => {})
    setStage('validating'); setOperationError(null); setNotice(null)
    try { completeMutation(selected.version, remoteValue(await run())) }
    catch (error) { setStage('error'); setOperationError(localizedErrorMessage(error, zh)) }
    finally {
      release(); operationInFlight.current = false
      if (mounted.current) setStage(current => current === 'error' ? current : 'idle')
    }
  }

  const saveText = (): void => {
    if (selected === null || textFile === null) return
    void mutate(async () => await props.blueprints.writeBlueprintText({ ...mutationInput(selected, textFile.path), text: textDraft }))
  }

  const beginCompositionEdit = async (): Promise<void> => {
    if (selected === null || selected.source !== 'user') return
    setOperationError(null)
    const savedAgentKey = selected.composition.agent === null ? '' : agentKey(selected.composition.agent)
    setCompositionAgentKey(savedAgentKey)
    setCompositionSkillNames(Object.freeze(selected.composition.businessSkills.map(skill => skill.name)))
    setCompositionSkillQuery('')
    setCompositionEditing(true)
    let available: Readonly<WorkspaceBlueprintCompositionChoices>
    try { available = await loadChoices() }
    catch { return }
    const missingAgent = savedAgentKey !== '' && !available.agents.items.some(profile => agentKey(profile) === savedAgentKey)
    const missingSkill = selected.composition.businessSkills.some(skill => !available.businessSkills.items.some(candidate => candidate.name === skill.name && candidate.digest === skill.digest))
    if (missingAgent || missingSkill) {
      setOperationError(zh ? '当前组合中的某个精确版本已不可用；不能静默替换，请先恢复原版本或从来源工作区发布新模板版本。' : 'An exact revision in this composition is unavailable. It cannot be silently replaced; restore that revision or publish a new package version from a source Workspace.')
      return
    }
  }

  const saveComposition = (): void => {
    if (selected === null) return
    let composition: Readonly<WorkspaceBlueprintComposition>
    try { composition = compositionFor(compositionAgentKey, compositionSkillNames) }
    catch (error) { setOperationError(localizedErrorMessage(error, zh)); return }
    void mutate(async () => {
      return await props.blueprints.updateBlueprintComposition({ blueprintId: selected.blueprintId, version: selected.version, expectedDigest: selected.digest, composition })
    })
  }

  const hostSupported = props.workspaces.create !== undefined && (props.workspaces.pickDirectory !== undefined || adoptionPath.trim()!=='')
  const workspaceReady = workspaceSnapshot.baselinesReady && workspaceSnapshot.state === 'idle'
  const busy = operationInFlight.current || !['idle', 'error', 'warning'].includes(stage)
  const resultCount = catalog.status === 'ready' ? catalog.items.length : 0
  const selectedEntry = detail.status === 'ready' && selectedEntryPath !== null ? detail.value.entries.find(entry => entry.path === selectedEntryPath) ?? null : null
  const visibleEntries = detail.status === 'ready' ? detail.value.entries.filter(entry => entryIsVisible(entry.path, expandedDirectories)) : []
  const normalizedPublishSkillQuery = publishSkillQuery.trim().toLocaleLowerCase(locale)
  const publishSkills = choices.businessSkills.items.filter(skill => normalizedPublishSkillQuery === '' || `${skill.name}\n${skill.displayName ?? ''}\n${skill.description}`.toLocaleLowerCase(locale).includes(normalizedPublishSkillQuery))
  const normalizedCompositionSkillQuery = compositionSkillQuery.trim().toLocaleLowerCase(locale)
  const compositionSkills = choices.businessSkills.items.filter(skill => normalizedCompositionSkillQuery === '' || `${skill.name}\n${skill.displayName ?? ''}\n${skill.description}`.toLocaleLowerCase(locale).includes(normalizedCompositionSkillQuery))
  const publishCompositionCount = (publishDraft.agentKey === '' ? 0 : 1) + publishDraft.skillNames.length
  const selectedCompositionCount = selected === null ? 0 : (selected.composition.agent === null ? 0 : 1) + selected.composition.businessSkills.length
  const publishAgentState = choiceStateCopy('agent', choices.agents.status, choices.agents.items.length, choicesLoading, choicesRequestError, zh)
  const publishSkillState = choiceStateCopy('business-skill', choices.businessSkills.status, choices.businessSkills.items.length, choicesLoading, choicesRequestError, zh)

  const retryChoices = (): void => { void loadChoices().catch(() => {}) }
  const togglePublishComposition = (): void => {
    const expanded = !publishCompositionExpanded
    setPublishCompositionExpanded(expanded)
    if (expanded) retryChoices()
  }
  const toggleDirectory = (path: string): void => {
    setExpandedDirectories(current => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return <section data-paimind-ui-scope="workspace-blueprints" data-paimind-workspace-blueprints aria-labelledby="paimind-workspace-blueprints-title">
    <header data-paimind-workspace-blueprints-header>
      <div data-paimind-workspace-blueprints-header-copy>
        <p data-paimind-workspace-blueprints-eyebrow>{zh ? '可复用的项目起点' : 'Reusable Workspace foundations'}</p>
        <h1 id="paimind-workspace-blueprints-title">{zh ? '工作区模板中心' : 'Workspace Template Center'}</h1>
        <p>{zh ? '选择模板，创建可继续编辑和开展工作的新工作区。' : 'Choose a template to start a new Workspace for your project.'}</p>
      </div>
      <div data-paimind-workspace-blueprints-head-actions>
        {mode === 'browse' && <button type="button" data-paimind-workspace-blueprints-button data-primary="true" disabled={busy} onClick={() => { openPublish() }}><PaimindPlusIcon size={15} />{zh ? '创建个人模板' : 'Create personal template'}</button>}
        <button type="button" data-paimind-workspace-blueprints-close data-paimind-product-initial-focus aria-label={zh ? '关闭工作区模板中心' : 'Close Workspace Template Center'} disabled={busy} onClick={() => { props.close() }}><PaimindCloseIcon size={18} /></button>
      </div>
    </header>

    {mode === 'publish' ? <main data-paimind-workspace-blueprints-publish>
      <div data-paimind-workspace-blueprints-publish-head>
        <div><p data-paimind-workspace-blueprints-eyebrow>{zh ? '创建模板' : 'Create template'}</p><h2>{zh ? '将工作区文件夹保存为模板' : 'Save a Workspace folder as a template'}</h2><p>{zh ? '先明确选择文件夹来源。智能体与业务技能是可选扩展，不添加也可以保存完整模板。' : 'Choose the folder source explicitly. Agent and Business Skill bindings are optional extensions; a folder-only template is complete.'}</p></div>
        <button type="button" data-paimind-workspace-blueprints-button disabled={busy} onClick={() => { setMode('browse'); setOperationError(null) }}>{zh ? '返回模板中心' : 'Back to templates'}</button>
      </div>
      <div data-paimind-workspace-blueprints-publish-grid>
        <section data-paimind-workspace-blueprints-form>
          <div data-paimind-workspace-blueprints-source-choice><label>{zh ? '模板内容来源' : 'Template folder source'}<select aria-label={zh ? '来源工作区' : 'Source Workspace'} value={publishDraft.workspaceId} disabled={busy || !workspaceReady} onChange={event => { const value = event.currentTarget.value; setPublishDraft(current => ({ ...current, workspaceId: value })) }}><option value="">{zh ? '请选择一个已有工作区' : 'Choose an existing Workspace'}</option>{workspaceSnapshot.items.map(workspace => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title} · {workspace.path}</option>)}</select></label><span>{zh ? '或' : 'or'}</span><button type="button" data-paimind-workspace-blueprints-button disabled={busy || !hostSupported || !workspaceReady} onClick={() => { void registerLocalFolder() }}><PaimindUploadIcon size={15} />{zh ? '选择本地文件夹' : 'Choose local folder'}</button></div>
          <label>{zh ? '名称' : 'Name'}<input aria-label={zh ? '名称' : 'Name'} value={publishDraft.name} disabled={busy} onChange={event => { const value = event.currentTarget.value; setPublishDraft(current => ({ ...current, name: value })) }} /></label>
          <label>{zh ? '用途说明' : 'Description'}<textarea aria-label={zh ? '用途说明' : 'Description'} value={publishDraft.description} disabled={busy} rows={4} onChange={event => { const value = event.currentTarget.value; setPublishDraft(current => ({ ...current, description: value })) }} /></label>
          <div data-paimind-workspace-blueprints-field-row><label>{zh ? '分类' : 'Category'}<select aria-label={zh ? '分类' : 'Category'} value={publishDraft.category} disabled={busy} onChange={event => { const value = event.currentTarget.value as WorkspaceBlueprintCategory; setPublishDraft(current => ({ ...current, category: value })) }}>{WORKSPACE_BLUEPRINT_CATEGORIES.filter(value => value !== 'all').map(value => <option key={value} value={value}>{categoryLabel(value, zh)}</option>)}</select></label><label>{zh ? '标签（逗号分隔）' : 'Tags (comma separated)'}<input aria-label={zh ? '标签（逗号分隔）' : 'Tags (comma separated)'} value={publishDraft.tags} disabled={busy} onChange={event => { const value = event.currentTarget.value; setPublishDraft(current => ({ ...current, tags: value })) }} /></label></div>
          <details data-paimind-workspace-blueprints-advanced><summary>{zh ? '高级设置' : 'Advanced settings'}</summary><div data-paimind-workspace-blueprints-field-row><label>{zh ? '模板标识' : 'Template identifier'}<input aria-label={zh ? '模板标识' : 'Template identifier'} value={publishDraft.blueprintId} disabled={busy} placeholder="project-delivery-starter" onChange={event => { const value = event.currentTarget.value; setPublishDraft(current => ({ ...current, blueprintId: value })) }} /></label><label>{zh ? '版本号' : 'Version number'}<input aria-label={zh ? '版本号' : 'Version number'} value={publishDraft.version} disabled={busy} placeholder="1.0.0" onChange={event => { const value = event.currentTarget.value; setPublishDraft(current => ({ ...current, version: value })) }} /></label></div></details>
        </section>
        <aside data-paimind-workspace-blueprints-composer data-collapsed={!publishCompositionExpanded}>
          <div data-paimind-workspace-blueprints-composer-summary><div><h3>{zh ? '智能体与业务技能（可选）' : 'Agent and Business Skills (optional)'}</h3><p>{publishCompositionCount === 0 ? (zh ? '当前是纯文件夹模板。' : 'This is currently a folder-only template.') : (zh ? `已选择 ${publishCompositionCount} 项扩展。` : `${publishCompositionCount} extensions selected.`)}</p></div><button type="button" data-paimind-workspace-blueprints-button aria-expanded={publishCompositionExpanded} disabled={busy} onClick={togglePublishComposition}>{publishCompositionExpanded ? (zh ? '收起' : 'Collapse') : (zh ? '配置可选扩展' : 'Configure optional extensions')}</button></div>
          {publishCompositionExpanded && <>
            <label>{zh ? '首个对话使用的智能体' : 'Agent for the first conversation'}<select aria-label={zh ? '入口智能体' : 'Entry Agent'} value={publishDraft.agentKey} disabled={busy || choicesLoading || choices.agents.status !== 'ready'} onChange={event => { const value = event.currentTarget.value; setPublishDraft(current => ({ ...current, agentKey: value })) }}><option value="">{zh ? '使用默认助手' : 'No Agent binding'}</option>{choices.agents.items.map(profile => <option key={agentKey(profile)} value={agentKey(profile)}>{profile.name}</option>)}</select></label>
            {publishAgentState !== null && <div data-paimind-workspace-blueprints-choice-state role={publishAgentState.alert ? 'alert' : 'status'}><span>{publishAgentState.message}</span>{publishAgentState.retry && <button type="button" aria-label={zh ? '重试加载智能体选项' : 'Retry Agent choices'} disabled={choicesLoading} onClick={retryChoices}>{zh ? '重试' : 'Retry'}</button>}</div>}
            <fieldset disabled={busy || choicesLoading || choices.businessSkills.status !== 'ready'}><legend>{zh ? '工作区内可用的业务技能' : 'Business Skills available in this Workspace'}</legend>{choices.businessSkills.status === 'ready' && choices.businessSkills.items.length > 0 && <label data-paimind-workspace-blueprints-choice-search><PaimindSearchIcon size={14} /><input type="search" aria-label={zh ? '搜索业务技能' : 'Search Business Skills'} value={publishSkillQuery} placeholder={zh ? '搜索业务技能' : 'Search Business Skills'} onChange={event => { setPublishSkillQuery(event.currentTarget.value) }} /></label>}{publishSkills.map(skill => <label key={skill.name} data-paimind-workspace-blueprints-choice><input type="checkbox" checked={publishDraft.skillNames.includes(skill.name)} onChange={event => { const checked = event.currentTarget.checked; setPublishDraft(current => ({ ...current, skillNames: checked ? Object.freeze([...current.skillNames, skill.name]) : Object.freeze(current.skillNames.filter(name => name !== skill.name)) })) }} /><span><strong>{skill.displayName ?? skill.name}</strong><small>{skill.description}</small></span></label>)}</fieldset>
            {publishSkillState !== null && <div data-paimind-workspace-blueprints-choice-state role={publishSkillState.alert ? 'alert' : 'status'}><span>{publishSkillState.message}</span>{publishSkillState.retry && <button type="button" aria-label={zh ? '重试加载业务技能选项' : 'Retry Business Skill choices'} disabled={choicesLoading} onClick={retryChoices}>{zh ? '重试' : 'Retry'}</button>}</div>}
            <p data-paimind-workspace-blueprints-note><PaimindWarningIcon size={14} />{zh ? '业务技能会用于新工作区的所有对话；智能体仅用于采用时创建的首个对话。' : 'Business Skills apply to every conversation in the new Workspace. The Agent applies only to the first conversation created during adoption.'}</p>
          </>}
        </aside>
      </div>
      <div data-paimind-workspace-blueprints-publish-actions>
        <div>{operationError !== null && <p data-paimind-workspace-blueprints-feedback role="alert">{operationError}</p>}{notice !== null && <p data-paimind-workspace-blueprints-feedback role="status">{notice}</p>}</div>
        <button type="button" data-paimind-workspace-blueprints-button onClick={() => { setMode('browse') }} disabled={busy}>{zh ? '取消' : 'Cancel'}</button>
        <button type="button" data-paimind-workspace-blueprints-button data-primary="true" onClick={() => { void publishBlueprint() }} disabled={busy || publishDraft.workspaceId === '' || publishDraft.blueprintId.trim() === '' || publishDraft.name.trim() === '' || publishDraft.description.trim() === ''}><PaimindCheckIcon size={15} />{busy ? stageLabel(stage, zh) : publishIsRevision ? (zh ? '发布新版本' : 'Publish new version') : (zh ? '保存模板' : 'Save template')}</button>
      </div>
    </main> : <>
      <nav data-paimind-workspace-blueprints-scopes aria-label={zh ? '模板范围' : 'Template scope'}><button type="button" aria-current={scope === 'market' ? 'page' : undefined} disabled={busy} onClick={() => { setScope('market'); setSelectedKey(null) }}>{zh ? '内置模板' : 'Built-in templates'}</button><button type="button" aria-current={scope === 'mine' ? 'page' : undefined} disabled={busy} onClick={() => { setScope('mine'); setSelectedKey(null) }}>{zh ? '我的模板' : 'My templates'}</button></nav>
      <div data-paimind-workspace-blueprints-toolbar>
        <label data-paimind-workspace-blueprints-search><PaimindSearchIcon size={16} /><input type="search" value={query} disabled={busy} aria-label={zh ? '搜索工作区模板' : 'Search Workspace templates'} placeholder={zh ? '搜索名称、用途或标签' : 'Search names, uses, or tags'} onChange={event => { setQuery(event.currentTarget.value) }} /></label>
        <div data-paimind-workspace-blueprints-categories role="group" aria-label={zh ? '模板分类' : 'Template categories'}>{WORKSPACE_BLUEPRINT_CATEGORIES.map(value => <button key={value} type="button" data-paimind-workspace-blueprints-filter disabled={busy} aria-pressed={category === value} onClick={() => { setCategory(value) }}>{categoryLabel(value, zh)}</button>)}</div>
      </div>
      <div data-paimind-workspace-blueprints-results aria-live="polite">{catalog.status === 'loading' ? (zh ? '正在加载模板…' : 'Loading templates…') : catalog.status === 'ready' ? (zh ? `已显示 ${resultCount} 个模板` : `${resultCount} templates shown`) : (zh ? '模板目录暂不可用' : 'Template catalog unavailable')}</div>
      <div data-paimind-workspace-blueprints-layout>
        <div data-paimind-workspace-blueprints-catalog aria-label={zh ? '工作区模板列表' : 'Workspace template list'}>
          {catalog.status === 'loading' && <div data-paimind-workspace-blueprints-state role="status"><p>{zh ? '正在读取模板目录…' : 'Reading the template catalog…'}</p></div>}
          {catalog.status === 'error' && <div data-paimind-workspace-blueprints-state role="alert"><PaimindWarningIcon size={22} /><p>{catalog.error}</p><button type="button" onClick={() => { setRefresh(value => value + 1) }}>{zh ? '重试' : 'Retry'}</button></div>}
          {catalog.status === 'ready' && catalog.items.length === 0 && <div data-paimind-workspace-blueprints-state><p>{scope === 'mine' ? (zh ? '还没有个人模板。你可以从现有工作区或本地文件夹发布第一个。' : 'No personal templates yet. Publish one from a registered Workspace or local folder.') : (zh ? '没有符合当前条件的模板。' : 'No templates match the current filters.')}</p></div>}
          {catalog.status === 'ready' && catalog.items.map(item => <button key={itemKey(item)} type="button" data-paimind-workspace-blueprints-card disabled={busy} aria-current={selected === item} aria-label={zh ? `查看模板：${item.name}` : `View template: ${item.name}`} onClick={() => { setSelectedKey(itemKey(item)); setOperationError(null); setOperationWarning(null); setPending(null); setStage('idle') }}><span data-paimind-workspace-blueprints-card-icon><PaimindTemplateIcon size={18} /></span><span data-paimind-workspace-blueprints-card-copy><strong>{item.name}</strong><p>{item.description}</p><span data-paimind-workspace-blueprints-card-meta><span>{categoryLabel(item.category, zh)}</span><span>v{item.version}</span><span>{zh ? `${item.fileCount} 个文件` : `${item.fileCount} files`}</span>{item.versionCount > 1 && <span>{zh ? `${item.versionCount} 个版本` : `${item.versionCount} versions`}</span>}</span></span></button>)}
          {catalog.status === 'ready' && catalog.nextCursor !== null && <button type="button" data-paimind-workspace-blueprints-load-more disabled={loadingMore} onClick={() => { void loadMore() }}>{loadingMore ? (zh ? '加载中…' : 'Loading…') : (zh ? '加载更多' : 'Load more')}</button>}
        </div>
        <aside data-paimind-workspace-blueprints-detail aria-live="polite">
          {selected === null ? <div data-paimind-workspace-blueprints-state><p>{zh ? '选择一个模板查看文件夹内容。' : 'Choose a template to inspect its folder contents.'}</p></div> : <>
            <div data-paimind-workspace-blueprints-detail-head><span data-paimind-workspace-blueprints-detail-icon><PaimindTemplateIcon size={22} /></span><div><h2>{selected.name}</h2><p>{selected.description}</p><div data-paimind-workspace-blueprints-tags><span data-paimind-workspace-blueprints-tag>{selected.source === 'builtin' ? (zh ? '内置模板' : 'Built-in') : (zh ? '个人模板' : 'Personal')}</span><span data-paimind-workspace-blueprints-tag>v{selected.version}</span>{selected.tags.map(tag => <span key={tag} data-paimind-workspace-blueprints-tag>{tag}</span>)}</div></div></div>
            <div data-paimind-workspace-blueprints-sections>
              <section data-paimind-workspace-blueprints-section>
                <div data-paimind-workspace-blueprints-section-head><h3>{zh ? `文件夹内容 · ${selected.fileCount} 个文件 · ${formatBytes(selected.totalBytes, locale)}` : `Folder contents · ${selected.fileCount} files · ${formatBytes(selected.totalBytes, locale)}`}</h3>{selected.source === 'user' && <span>{zh ? '保存修改会创建新版本' : 'Saving changes creates a new version'}</span>}</div>
                {detail.status === 'loading' && <p data-paimind-workspace-blueprints-feedback role="status">{zh ? '正在读取目录树…' : 'Loading folder tree…'}</p>}
                {detail.status === 'error' && <p data-paimind-workspace-blueprints-feedback role="alert">{detail.error}</p>}
                {detail.status === 'ready' && <div data-paimind-workspace-blueprints-editor>
                  <div data-paimind-workspace-blueprints-tree>{detail.value.entries.length === 0 ? <p>{zh ? '空文件夹模板' : 'Empty folder template'}</p> : visibleEntries.map(entry => {
                    const expanded = entry.kind === 'directory' && expandedDirectories.has(entry.path)
                    return <button key={entry.path} type="button" data-kind={entry.kind} data-selected={selectedEntryPath === entry.path} style={{ '--wb-depth': Math.max(0, entry.path.split('/').length - 1) } as CSSProperties} aria-expanded={entry.kind === 'directory' ? expanded : undefined} aria-label={entry.kind === 'directory' ? `${expanded ? (zh ? '折叠目录' : 'Collapse folder') : (zh ? '展开目录' : 'Expand folder')}: ${entry.path}` : `${zh ? '打开条目' : 'Open entry'}: ${entry.path}`} onClick={() => { if (entry.kind === 'directory') toggleDirectory(entry.path); void selectEntry(entry.path) }}><span>{entry.kind === 'directory' ? (expanded ? '▾' : '▸') : entry.kind === 'binary' ? '◆' : '·'}</span><code>{entry.path.split('/').at(-1)}</code></button>
                  })}</div>
                  <div data-paimind-workspace-blueprints-source>{selectedEntry === null ? <div data-paimind-workspace-blueprints-source-empty>{zh ? '从左侧选择文件查看内容。' : 'Choose a file from the tree.'}</div> : selectedEntry.kind === 'directory' ? <div data-paimind-workspace-blueprints-source-empty><strong>{selectedEntry.path}/</strong><p>{zh ? '目录用于组织模板资源。' : 'This directory organizes package resources.'}</p>{selected.source === 'user' && <button type="button" data-paimind-workspace-blueprints-button data-danger="true" disabled={busy} onClick={() => { if (selected !== null) void mutate(async () => await props.blueprints.deleteBlueprintFile({ ...mutationInput(selected, selectedEntry.path), recursive: true })) }}><PaimindTrashIcon size={14} />{zh ? '递归删除并发布新版本' : 'Delete recursively in new version'}</button>}</div> : selectedEntry.kind === 'binary' ? <div data-paimind-workspace-blueprints-source-empty><strong>{selectedEntry.path}</strong><p>{zh ? '二进制资源会随模板复制，但不会在文本编辑器中改写。' : 'Binary resources are copied with the package and are not rewritten in the text editor.'}</p>{selected.source === 'user' && <button type="button" data-paimind-workspace-blueprints-button data-danger="true" disabled={busy} onClick={() => { if (selected !== null) void mutate(async () => await props.blueprints.deleteBlueprintFile(mutationInput(selected, selectedEntry.path))) }}><PaimindTrashIcon size={14} />{zh ? '删除并发布新版本' : 'Delete in new version'}</button>}</div> : textFile === null ? <div data-paimind-workspace-blueprints-source-empty>{zh ? '正在读取文件…' : 'Loading file…'}</div> : <><div data-paimind-workspace-blueprints-source-head><code>{textFile.path}</code><span>{formatBytes(new TextEncoder().encode(textDraft).byteLength, locale)}</span></div><textarea aria-label={zh ? '模板文本文件编辑器' : 'Template text file editor'} readOnly={selected.source !== 'user'} spellCheck={false} value={textDraft} onChange={event => { setTextDraft(event.currentTarget.value) }} />{selected.source === 'user' && <div data-paimind-workspace-blueprints-source-actions><button type="button" data-paimind-workspace-blueprints-button data-danger="true" disabled={busy} onClick={() => { if (selected !== null) void mutate(async () => await props.blueprints.deleteBlueprintFile(mutationInput(selected, textFile.path))) }}><PaimindTrashIcon size={14} />{zh ? '删除文件并发布新版本' : 'Delete file in new version'}</button><button type="button" data-paimind-workspace-blueprints-button data-primary="true" disabled={busy || textDraft === textFile.text} onClick={saveText}><PaimindCheckIcon size={14} />{zh ? '保存为新版本' : 'Save as new version'}</button></div>}</>}</div>
                </div>}
                {selected.source === 'user' && <div data-paimind-workspace-blueprints-new-entry><input aria-label={zh ? '新文件或目录路径' : 'New file or folder path'} value={newPath} disabled={busy} placeholder="references/example.md" onChange={event => { setNewPath(event.currentTarget.value) }} /><button type="button" data-paimind-workspace-blueprints-button disabled={busy || newPath.trim() === ''} onClick={() => { if (selected !== null) void mutate(async () => await props.blueprints.createBlueprintDirectory(mutationInput(selected, newPath.trim()))) }}><PaimindPlusIcon size={14} />{zh ? '新建目录' : 'New folder'}</button><button type="button" data-paimind-workspace-blueprints-button disabled={busy || newPath.trim() === ''} onClick={() => { if (selected !== null) void mutate(async () => await props.blueprints.writeBlueprintText({ ...mutationInput(selected, newPath.trim()), text: '' })) }}><PaimindEditIcon size={14} />{zh ? '新建文本文件' : 'New text file'}</button></div>}
              </section>
              <section data-paimind-workspace-blueprints-section data-paimind-workspace-blueprints-optional>
                <div data-paimind-workspace-blueprints-section-head><h3>{zh ? '可选扩展' : 'Optional extensions'}</h3><div data-paimind-workspace-blueprints-inline-actions>{selectedCompositionCount > 0 && !compositionEditing && <button type="button" data-paimind-workspace-blueprints-link disabled={busy} aria-expanded={compositionExpanded} onClick={() => { if (!compositionExpanded) void loadChoices().catch(() => {}); setCompositionExpanded(current => !current) }}>{compositionExpanded ? (zh ? '收起' : 'Collapse') : (zh ? '查看配置' : 'View configuration')}</button>}{selected.source === 'user' && !compositionEditing && <button type="button" data-paimind-workspace-blueprints-link disabled={busy} onClick={() => { void beginCompositionEdit() }}>{selectedCompositionCount === 0 ? (zh ? '添加' : 'Add') : (zh ? '编辑' : 'Edit')}</button>}</div></div>
                {compositionEditing ? <div data-paimind-workspace-blueprints-composition-editor>
                  <label>{zh ? '首个对话使用的智能体' : 'Agent for the first conversation'}<select aria-label={zh ? '编辑首个对话的智能体' : 'Edit entry Agent'} value={compositionAgentKey} disabled={busy || choicesLoading || choices.agents.status !== 'ready'} onChange={event => { setCompositionAgentKey(event.currentTarget.value) }}><option value="">{zh ? '使用默认助手' : 'No Agent binding'}</option>{choices.agents.items.map(profile => <option key={agentKey(profile)} value={agentKey(profile)}>{profile.name}</option>)}</select></label>
                  {publishAgentState !== null && <div data-paimind-workspace-blueprints-choice-state role={publishAgentState.alert ? 'alert' : 'status'}><span>{publishAgentState.message}</span>{publishAgentState.retry && <button type="button" aria-label={zh ? '重试加载智能体选项' : 'Retry Agent choices'} disabled={choicesLoading} onClick={retryChoices}>{zh ? '重试' : 'Retry'}</button>}</div>}
                  <fieldset disabled={busy || choicesLoading || choices.businessSkills.status !== 'ready'}><legend>{zh ? '工作区内可用的业务技能' : 'Business Skills available in this Workspace'}</legend>{choices.businessSkills.status === 'ready' && choices.businessSkills.items.length > 0 && <label data-paimind-workspace-blueprints-choice-search><PaimindSearchIcon size={14} /><input type="search" aria-label={zh ? '搜索编辑业务技能' : 'Search edited Business Skills'} value={compositionSkillQuery} placeholder={zh ? '搜索业务技能' : 'Search Business Skills'} onChange={event => { setCompositionSkillQuery(event.currentTarget.value) }} /></label>}{compositionSkills.map(skill => <label key={skill.name} data-paimind-workspace-blueprints-choice><input type="checkbox" checked={compositionSkillNames.includes(skill.name)} onChange={event => { const checked = event.currentTarget.checked; setCompositionSkillNames(current => checked ? Object.freeze([...current, skill.name]) : Object.freeze(current.filter(name => name !== skill.name))) }} /><span><strong>{skill.displayName ?? skill.name}</strong><small>{skill.description}</small></span></label>)}</fieldset>
                  {publishSkillState !== null && <div data-paimind-workspace-blueprints-choice-state role={publishSkillState.alert ? 'alert' : 'status'}><span>{publishSkillState.message}</span>{publishSkillState.retry && <button type="button" aria-label={zh ? '重试加载业务技能选项' : 'Retry Business Skill choices'} disabled={choicesLoading} onClick={retryChoices}>{zh ? '重试' : 'Retry'}</button>}</div>}
                  <div data-paimind-workspace-blueprints-actions><button type="button" data-paimind-workspace-blueprints-button disabled={busy} onClick={() => { setCompositionEditing(false) }}>{zh ? '取消' : 'Cancel'}</button><button type="button" data-paimind-workspace-blueprints-button data-primary="true" disabled={busy || choicesLoading || (compositionAgentKey !== '' && choices.agents.status !== 'ready') || (compositionSkillNames.length > 0 && choices.businessSkills.status !== 'ready')} onClick={saveComposition}><PaimindCheckIcon size={14} />{zh ? '保存扩展配置' : 'Save extension settings'}</button></div>
                </div> : selectedCompositionCount === 0 ? <p data-paimind-workspace-blueprints-compact-composition><PaimindCheckIcon size={14} />{zh ? '纯文件夹模板，没有添加智能体或业务技能。' : 'Folder-only template with no Agent or Business Skill extensions.'}</p> : !compositionExpanded ? <p data-paimind-workspace-blueprints-compact-composition><PaimindCheckIcon size={14} />{zh ? `已由作者配置 ${selectedCompositionCount} 项扩展。` : `${selectedCompositionCount} extensions configured by the author.`}</p> : <>{choicesLoading && <p role="status">{zh ? '正在读取扩展名称…' : 'Loading extension names…'}</p>}{choicesRequestError !== null && <p role="alert">{choicesRequestError} <button type="button" onClick={retryChoices}>{zh ? '重试' : 'Retry'}</button></p>}<div data-paimind-workspace-blueprints-bindings>{selected.composition.agent !== null && <div data-paimind-workspace-blueprints-binding><PaimindAgentIcon size={18} /><span><strong>{choices.agents.items.find(candidate => candidate.agentId === selected.composition.agent?.agentId && candidate.presetId === selected.composition.agent.presetId)?.name ?? (zh ? '已选智能体（名称暂不可用）' : 'Selected agent (name unavailable)')}</strong><small>{zh ? '用于采用时创建的首个对话' : 'Used for the first conversation created during adoption'}</small></span></div>}{selected.composition.businessSkills.map(skill => <div key={`${skill.name}:${skill.digest}`} data-paimind-workspace-blueprints-binding><PaimindSkillIcon size={18} /><span><strong>{choices.businessSkills.items.find(candidate => candidate.name === skill.name)?.displayName ?? skill.name}</strong><small>{zh ? '已固定保存此技能版本' : 'This Skill revision is saved exactly'}</small></span></div>)}</div><p data-paimind-workspace-blueprints-note><PaimindWarningIcon size={14} />{zh ? '业务技能用于新工作区的所有对话；智能体仅用于首个对话，不会修改用户默认设置。' : 'Business Skills apply to every conversation in the new Workspace. The Agent applies only to the first conversation and does not change user defaults.'}</p></>}
              </section>
              <section data-paimind-workspace-blueprints-section>
                <label>{zh ? '目标文件夹（可选）' : 'Destination folder (optional)'}<input aria-label={zh ? '目标文件夹路径' : 'Destination folder path'} value={adoptionPath} disabled={busy} placeholder={zh ? '填写已有空文件夹路径，或留空使用目录选择器' : 'Existing empty folder path, or leave blank to use the picker'} onChange={event=>setAdoptionPath(event.currentTarget.value)}/></label>
                <div data-paimind-workspace-blueprints-actions>{selected.source === 'user' && <button type="button" data-paimind-workspace-blueprints-button disabled={busy} onClick={() => { openPublish(selected) }}><PaimindEditIcon size={14} />{zh ? '从工作区发布新版本' : 'Publish new version from Workspace'}</button>}<button type="button" data-paimind-workspace-blueprints-button data-primary="true" disabled={busy || (pending === null && (!hostSupported || !workspaceReady))} onClick={() => { if (pending === null) void adoptBlueprint(selected); else void openPendingWorkspace() }}>{busy || pending !== null ? <PaimindCheckIcon size={15} /> : <PaimindPlusIcon size={15} />}{busy ? stageLabel(stage, zh) : pending !== null ? (zh ? '创建首个对话' : 'Create entry conversation') : (zh ? '复制为新工作区' : 'Copy to new Workspace')}</button></div>
                {pending === null && hostSupported && <p data-paimind-workspace-blueprints-copy-hint>{zh ? '继续后请选择一个空文件夹；模板会复制到新工作区。' : 'Continue by choosing an empty folder. The template will be copied into a native Harness Workspace.'}</p>}
                {!hostSupported && <p data-paimind-workspace-blueprints-feedback role="alert">{zh ? '当前环境暂不支持选择文件夹和创建工作区。' : 'This Harness host does not expose directory picking and Workspace registration.'}</p>}
                {operationError !== null && <p data-paimind-workspace-blueprints-feedback role="alert">{operationError}</p>}{operationWarning !== null && <p data-paimind-workspace-blueprints-feedback role="alert">{operationWarning}</p>}{notice !== null && <p data-paimind-workspace-blueprints-feedback role="status">{notice}</p>}
              </section>
            </div>
          </>}
        </aside>
      </div>
    </>}
  </section>
}

export function WorkspaceBlueprintCenterTrigger(props: {
  readonly wide: boolean
  readonly controller: PaimindProductSurfaceController
  readonly locale: PaimindLocaleSource
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot, props.controller.getSnapshot)
  const locale = useSyncExternalStore(props.locale.subscribe.bind(props.locale), () => props.locale.getLocale().active, () => props.locale.getLocale().active)
  const zh = locale.startsWith('zh')
  return <button type="button" data-paimind-workspace-blueprints-trigger data-paimind-product-trigger="workspace-blueprints" data-paimind-navigation-label={zh ? '模板' : 'Templates'} data-paimind-navigation-description={zh ? '从现成工作区开始' : 'Start from a ready workspace'} data-paimind-navigation-group={zh ? '工作区' : 'Workspaces'} data-wide={props.wide} aria-expanded={snapshot.open} aria-current={snapshot.open ? 'page' : undefined} aria-label={zh ? '打开工作区模板中心' : 'Open Workspace Template Center'} onClick={event => { props.controller.toggle(event.currentTarget) }}><PaimindTemplateIcon size={props.wide ? 16 : 18} />{props.wide && <span data-paimind-workspace-blueprints-trigger-label>{zh ? '工作区模板' : 'Workspace Templates'}</span>}</button>
}

export interface WorkspaceBlueprintCenterSurfaceProps extends Omit<WorkspaceBlueprintCenterProps, 'close'> {
  readonly controller: PaimindProductSurfaceController
}

export function WorkspaceBlueprintCenterSurface(props: WorkspaceBlueprintCenterSurfaceProps): ReactNode {
  const snapshot = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot, props.controller.getSnapshot)
  if (!snapshot.open) return null
  return <MountedWorkspaceBlueprintCenterSurface {...props} />
}

function MountedWorkspaceBlueprintCenterSurface(props: WorkspaceBlueprintCenterSurfaceProps): ReactNode {
  const [host, setHost] = useState<Readonly<PaimindProductCenterHost> | null>(null)
  const surface = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const target = resolvePaimindProductCenterHost()
    if (target === null) { props.controller.close(false); return }
    const release = installPaimindProductCenterHost(target)
    if (release === null) { props.controller.close(false); return }
    setHost(target)
    return release
  }, [props.controller])
  useEffect(() => {
    if (host === null || surface.current === null) return
    return installPaimindProductSurfaceInteraction(surface.current, props.controller)
  }, [host, props.controller])
  if (host === null) return null
  return createPortal(<main ref={surface} data-paimind-ui-scope="workspace-blueprints" data-paimind-product-surface="workspace-blueprints" aria-labelledby="paimind-workspace-blueprints-title"><WorkspaceBlueprintCenter {...props} close={restoreFocus => { props.controller.close(restoreFocus) }} acquireCloseBlock={() => props.controller.blockClose()} /></main>, host.mount)
}

class WorkspaceBlueprintCenterBoundary extends Component<{ readonly children: ReactNode; readonly onError: () => void }, { readonly failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('[paimind-workspace-blueprints]', error, info); this.props.onError() }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

export async function apply(ctx: WorkspaceBlueprintClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const mounted = ctx.inject([...BASE_INJECT, 'remote.paimindWorkspaceBlueprints'], scope => {
    const blueprints = scope.remote.paimindWorkspaceBlueprints
    if (blueprints === undefined) throw new Error('Workspace Blueprint Remote did not mount')
    const controller = new PaimindProductSurfaceController('workspace-blueprints')
    const sessionApi = scope.get('connection').api.sessions
    scope.effect(installWorkspaceBlueprintCenterStyle, 'paimind-workspace-blueprints: style')
    scope.effect(() => () => { controller.dispose() }, 'paimind-workspace-blueprints: surface controller')
    contributePaimindExtension(scope.slots, {
      id: 'paimind:workspace-blueprints', packageName: '@hansen/workspace-blueprints', category: 'content-rendering',
      nameZh: '工作区模板中心', nameEn: 'Workspace Template Center',
      descriptionZh: '使用现成的文件夹、资料和工作方法，快速开始新项目。',
      descriptionEn: 'Create native Harness Workspaces from reusable folder templates.',
      surface: 'shell', maturity: 'technical-preview', order: 25,
    })
    const injectProps = () => ({ controller, blueprints, workspaces: scope.workspaces, sessions: scope.sessions, sessionApi, locale: scope.locale })
    scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
      name: 'sidebar.footer.action', id: 'paimind-workspace-blueprints-trigger', order: -10,
      label: () => scope.locale.getLocale().active.startsWith('zh') ? '工作区模板' : 'Workspace Templates',
      inject: () => ({ controller, locale: scope.locale }),
    }, (props: { readonly wide: boolean; readonly controller: PaimindProductSurfaceController; readonly locale: PaimindLocaleSource }) => <WorkspaceBlueprintCenterBoundary onError={() => { controller.closeWhenUnblocked(false) }}><WorkspaceBlueprintCenterTrigger {...props} /></WorkspaceBlueprintCenterBoundary>))
    scope.slots.inject('shell.overlay', () => scope.slots.register({ name: 'shell.overlay', id: 'paimind-workspace-blueprints-surface', order: 12, inject: injectProps }, (props: WorkspaceBlueprintCenterSurfaceProps) => <WorkspaceBlueprintCenterBoundary onError={() => { controller.closeWhenUnblocked(false) }}><WorkspaceBlueprintCenterSurface {...props} /></WorkspaceBlueprintCenterBoundary>))
  }, 'paimind-workspace-blueprints: product center')
  try { await mounted } catch (error) {
    await disposeRemote()
    throw error
  }
  return async () => {
    await mounted.dispose()
    await disposeRemote()
  }
}
