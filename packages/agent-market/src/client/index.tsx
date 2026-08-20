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
  installHarnessAgentPresetSettingsNavigation,
  resolveHarnessAgentPresetSeatControl,
  type HarnessAgentPresetApi,
  type HarnessAgentPresetEntry,
  type HarnessAgentPresetRoster,
  type HarnessAgentPresetSeatControl,
  type HarnessConversationDraftService,
  type HarnessInspectableSlotRegistry,
  type HarnessRemoteMountService,
  type HarnessRemoteResult,
  type HarnessSessionService,
  type HarnessWorkspaceService,
  type PaimindClientContext,
  type PaimindLocaleSource,
} from '@paimind/harness-compat'
import {
  PaimindAgentIcon,
  PaimindCloseIcon,
  PaimindEditIcon,
  PaimindNewConversationIcon,
  PaimindPlayIcon,
  PaimindPlusIcon,
  PaimindSearchIcon,
  PaimindSettingsIcon,
  PaimindSkillIcon,
  PaimindTrashIcon,
  PaimindUserIcon,
} from '@paimind/harness-compat/client-icons'
import {
  PaimindProductSurfaceController,
  installPaimindProductSurfaceInteraction,
  isPaimindProductSurfaceAvailable,
  requestPaimindProductSurface,
} from '@paimind/harness-compat/client-surface'
import type {
  AgentBusinessProfile,
  AgentBusinessProfileInput,
  AgentMigrationPlan,
  AgentMigrationRecord,
  AgentProfileSnapshot,
  AgentSessionBinding,
  AgentVerificationRecord,
} from '@paimind/agent-builder'
import type { SkillInstallerSnapshot, SkillInstallRecord } from '@paimind/skill-market'
import {
  SKILL_PRODUCT_CATEGORIES,
  metadataForSkill,
  type SkillProductCategoryFilter,
} from '@paimind/skill-market/catalog'
import AGENT_TYPERT_REMOTE from '@paimind/agent-builder/remote'
import {
  collectBusinessAgentCategories,
  metadataForPreset,
  type AgentProductMode,
} from '../index.js'
import { AGENT_CENTER_STYLE } from './styles.js'

const BASE_INJECT = ['slots', 'locale', 'remote', 'sessions', 'workspaces', 'conversation'] as const
export const inject = [...BASE_INJECT]
const STYLE_ID = '@paimind/agent-market'

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID; style.dataset.paimindPlugin = STYLE_ID; style.textContent = AGENT_CENTER_STYLE
  document.head.append(style)
  return () => { style.remove() }
}

interface AgentProfilesRemoteNamespace {
  listProfiles(): Promise<HarnessRemoteResult<Readonly<AgentProfileSnapshot>>>
  saveProfile(input: AgentBusinessProfileInput): Promise<HarnessRemoteResult<Readonly<AgentBusinessProfile>>>
  setDefault(input: { readonly presetId: string }): Promise<HarnessRemoteResult<{ readonly presetId: string }>>
  bindSession(input: Omit<AgentSessionBinding, 'boundAt'>): Promise<HarnessRemoteResult<Readonly<AgentSessionBinding>>>
  migrationPlan(input: { readonly sourceSessionId: string }): Promise<HarnessRemoteResult<Readonly<AgentMigrationPlan> | null>>
  recordMigration(input: Omit<AgentMigrationRecord, 'migratedAt'>): Promise<HarnessRemoteResult<Readonly<AgentMigrationRecord>>>
  verifySession(input: { readonly sessionId: string }): Promise<HarnessRemoteResult<Readonly<AgentVerificationRecord>>>
  listAudit(): Promise<HarnessRemoteResult<{ readonly migrations: readonly AgentMigrationRecord[]; readonly verifications: readonly AgentVerificationRecord[] }>>
}

interface InstalledSkillsRemoteNamespace {
  listInstalled(): Promise<HarnessRemoteResult<Readonly<SkillInstallerSnapshot>>>
}

async function listInstalledSkills(
  skills: InstalledSkillsRemoteNamespace,
  timeoutMs = 5_000,
): Promise<HarnessRemoteResult<Readonly<SkillInstallerSnapshot>>> {
  const started = Date.now()
  while (typeof (skills as Partial<InstalledSkillsRemoteNamespace>).listInstalled !== 'function') {
    if (Date.now() - started >= timeoutMs) throw new Error('Skill Installer Remote did not finish mounting')
    await new Promise(resolve => { setTimeout(resolve, 25) })
  }
  return await skills.listInstalled()
}

interface AgentCenterRemote extends HarnessRemoteMountService {
  readonly paimindAgentProfiles?: AgentProfilesRemoteNamespace
  readonly paimindSkillInstaller?: InstalledSkillsRemoteNamespace
}

interface AgentCenterClientContext extends PaimindClientContext {
  readonly slots: HarnessInspectableSlotRegistry
  readonly remote: AgentCenterRemote
  readonly sessions: HarnessSessionService
  readonly workspaces: HarnessWorkspaceService
  readonly conversation: HarnessConversationDraftService
  get(name: 'connection'): { readonly api: { readonly agentPresets: HarnessAgentPresetApi } }
  inject(
    services: readonly string[],
    install: (scope: AgentCenterClientContext) => void | (() => void),
    label?: string,
  ): PromiseLike<unknown> & { dispose(): Promise<void> }
}

function remoteValue<Value>(result: HarnessRemoteResult<Value>): Value {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }

async function waitForBlankSession(sessions: HarnessSessionService, workspaces: HarnessWorkspaceService, timeoutMs = 10_000): Promise<string> {
  const before = sessions.list.getSnapshot()
  const previous = before.current
  if (previous !== undefined && before.byId[previous]?.blank === true) return previous
  return await new Promise<string>((resolveSession, reject) => {
    let done = false
    let timer: ReturnType<typeof setTimeout>
    const inspect = (): void => {
      if (done) return
      const snapshot = sessions.list.getSnapshot()
      const current = snapshot.current
      if (current === undefined || snapshot.byId[current]?.blank !== true) return
      if (current === previous) return
      done = true; clearTimeout(timer); unsubscribe(); resolveSession(current)
    }
    const unsubscribe = sessions.list.subscribe(inspect)
    timer = setTimeout(() => { done = true; unsubscribe(); reject(new Error('创建真实空白对话超时')) }, timeoutMs)
    workspaces.startSession()
    inspect()
  })
}

async function selectPresetInNativeSeat(
  seat: HarnessAgentPresetSeatControl | null,
  sessions: HarnessSessionService,
  sessionId: string,
  presetId: string,
): Promise<void> {
  if (seat === null) throw new Error('当前 Harness 版本未提供可用的智能体选择器')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (sessions.list.getSnapshot().current !== sessionId) throw new Error('新对话未保持为当前会话')
    await seat.select(presetId)
    let stableSince: number | null = null
    for (let poll = 0; poll < 30; poll += 1) {
      const sessionSnapshot = sessions.list.getSnapshot()
      if (sessionSnapshot.current !== sessionId) throw new Error('新对话在智能体绑定期间被替换')
      const row = sessionSnapshot.byId[sessionId]
      const selector = seat.getSnapshot()
      if (selector.error !== null) throw new Error(selector.error)
      const synchronized = row?.agentPreset === presetId && selector.current === presetId && !selector.busy
      if (synchronized) {
        stableSince ??= Date.now()
        if (Date.now() - stableSince >= 200) return
      } else {
        stableSince = null
      }
      await new Promise(resolve => { setTimeout(resolve, 50) })
    }
  }
  throw new Error('智能体已选择，但会话绑定或顶部显示未同步')
}

export class AgentCenterRuntime {
  private disposed = false
  private readonly busySessions = new Set<string>()
  private readonly offSessions: () => void
  private notice: string | null = null
  private error: string | null = null
  private snapshot: { readonly notice: string | null; readonly error: string | null } = Object.freeze({ notice: null, error: null })
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly seat: HarnessAgentPresetSeatControl | null,
    private readonly remote: AgentProfilesRemoteNamespace,
    private readonly sessions: HarnessSessionService,
    private readonly workspaces: HarnessWorkspaceService,
    private readonly conversation: HarnessConversationDraftService,
  ) {
    this.offSessions = sessions.list.subscribe(() => { void this.inspectCurrentSession() })
    void this.inspectCurrentSession()
  }

  getSnapshot = (): { readonly notice: string | null; readonly error: string | null } => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  async start(presetId: string, profile?: AgentBusinessProfile): Promise<string> {
    this.error = null; this.publish()
    const sessionId = await waitForBlankSession(this.sessions, this.workspaces)
    await selectPresetInNativeSeat(this.seat, this.sessions, sessionId, presetId)
    if (profile !== undefined) {
      remoteValue(await this.remote.bindSession({ sessionId, agentId: profile.agentId, presetId, configVersion: profile.configVersion }))
      this.watchFirstRun(sessionId)
    }
    const binding = this.sessions.binding?.(sessionId)
    if (binding?.ctx === undefined) throw new Error('真实对话尚未就绪')
    this.conversation.input.for(binding.ctx).setDraft('请介绍一下你可以如何帮助我，并给出一个简短示例。')
    this.sessions.open(sessionId)
    return sessionId
  }

  dispose(): void { this.disposed = true; this.offSessions(); this.listeners.clear() }

  private async inspectCurrentSession(): Promise<void> {
    if (this.disposed) return
    const sourceSessionId = this.sessions.list.getSnapshot().current
    if (sourceSessionId === undefined || this.busySessions.has(sourceSessionId)) return
    this.busySessions.add(sourceSessionId)
    try {
      const audit = remoteValue(await this.remote.listAudit())
      const existing = [...audit.migrations].reverse().find(row => row.sourceSessionId === sourceSessionId)
      if (existing !== undefined && this.sessions.list.getSnapshot().byId[existing.targetSessionId] !== undefined) {
        this.notice = '已使用最新版智能体继续。'
        this.sessions.open(existing.targetSessionId); this.publish(); return
      }
      const plan = remoteValue(await this.remote.migrationPlan({ sourceSessionId }))
      if (plan === null) return
      const targetSessionId = await waitForBlankSession(this.sessions, this.workspaces)
      await selectPresetInNativeSeat(this.seat, this.sessions, targetSessionId, plan.presetId)
      const binding = this.sessions.binding?.(targetSessionId)
      if (binding?.session.prompt === undefined) throw new Error('新版对话尚未就绪')
      const accepted = await binding.session.prompt([{ type: 'text', text: plan.summary }], 'queue')
      if (!accepted.ok) throw new Error(accepted.error.message)
      remoteValue(await this.remote.recordMigration({ ...plan, targetSessionId }))
      this.watchFirstRun(targetSessionId)
      this.notice = '已使用最新版智能体继续。'
      this.sessions.open(targetSessionId)
    } catch (cause) {
      this.error = `智能体版本迁移失败：${messageOf(cause)}`
    } finally { this.busySessions.delete(sourceSessionId); this.publish() }
  }

  private watchFirstRun(sessionId: string): void {
    const binding = this.sessions.binding?.(sessionId)
    if (binding === undefined) return
    let ran = false
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    let off = (): void => {}
    const verify = (): void => {
      const snapshot = binding.session.getSnapshot()
      if (snapshot.running || (snapshot.chat?.timeline.turnOrder.length ?? 0) === 0) return
      off()
      void this.remote.verifySession({ sessionId }).then(result => {
        const verification = remoteValue(result)
        this.notice = verification.result === 'passed' ? '真实首轮验证通过。' : verification.message
        this.publish()
      }, cause => { this.error = messageOf(cause); this.publish() })
    }
    const inspect = (): void => {
      const snapshot = binding.session.getSnapshot()
      if (snapshot.running) {
        ran = true
        if (settleTimer !== undefined) clearTimeout(settleTimer)
        settleTimer = undefined
      }
      if (!ran || snapshot.running || (snapshot.chat?.timeline.turnOrder.length ?? 0) === 0) return
      if (settleTimer !== undefined) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => { settleTimer = undefined; verify() }, 750)
    }
    off = binding.session.subscribe(inspect)
    inspect()
  }

  private publish(): void {
    this.snapshot = Object.freeze({ notice: this.notice, error: this.error })
    for (const listener of this.listeners) listener()
  }
}

type RosterState = { readonly status: 'loading'; readonly roster: null; readonly error: null }
  | { readonly status: 'ready'; readonly roster: HarnessAgentPresetRoster; readonly error: null }
  | { readonly status: 'error'; readonly roster: null; readonly error: string }

interface Draft {
  readonly editing: AgentBusinessProfile | null
  readonly copiedFromPlatform: string | null
  readonly productKind: 'personal' | 'business'
  readonly businessCategory: string
  readonly businessCategoryId: string | null
  readonly name: string
  readonly description: string
  readonly basePresetId: string
  readonly role: string
  readonly goal: string
  readonly behavior: string
  readonly preferredSkillNames: readonly string[]
  readonly instructions: string
}

function emptyDraft(basePresetId: string, productKind: 'personal' | 'business' = 'personal'): Draft {
  return { editing: null, copiedFromPlatform: null, productKind, businessCategory: '', businessCategoryId: null, name: '', description: '', basePresetId, role: '', goal: '', behavior: '', preferredSkillNames: [], instructions: '' }
}

function editDraft(profile: AgentBusinessProfile): Draft {
  return {
    editing: profile, copiedFromPlatform: null, productKind: profile.productKind === 'business' ? 'business' : 'personal',
    businessCategory: profile.businessCategory ?? '', businessCategoryId: profile.businessCategoryId ?? null,
    name: profile.name, description: profile.description, basePresetId: profile.basePresetId, role: profile.role,
    goal: profile.goal, behavior: profile.behavior,
    preferredSkillNames: profile.basePresetId === 'minimal' ? [] : profile.preferredSkillNames, instructions: profile.instructions,
  }
}

function copyDraft(preset: HarnessAgentPresetEntry, zh: boolean): Draft {
  const name = preset.name ?? (zh ? '平台智能体' : 'Platform Agent')
  const metadata = metadataForPreset(preset)
  const productKind = metadata.kind === 'business-agent' ? 'business' : 'personal'
  return {
    ...emptyDraft(preset.id, productKind),
    copiedFromPlatform: name,
    businessCategory: metadata.category === undefined ? '' : businessCategoryLabel(metadata.category, zh),
    businessCategoryId: metadata.category?.id ?? null,
    name: zh ? `${name} · 我的版本` : `${name} · My version`,
    description: preset.description ?? '',
  }
}

function skillCategoryLabel(category: SkillProductCategoryFilter, zh: boolean): string {
  const labels: Record<SkillProductCategoryFilter, readonly [string, string]> = {
    all: ['全部', 'All'], general: ['通用', 'General'], research: ['调研与知识', 'Research'],
    data: ['数据分析', 'Data'], content: ['内容与演示', 'Content'], product: ['产品与 PDM', 'Product & PDM'],
    engineering: ['工程研发', 'Engineering'], 'agent-tools': ['智能体工具', 'Agent tools'],
  }
  return labels[category][zh ? 0 : 1]
}

function businessCategoryLabel(category: { readonly labelZh: string; readonly labelEn: string }, zh: boolean): string {
  return zh ? category.labelZh : category.labelEn
}

function modeLabel(mode: AgentProductMode, zh: boolean): string {
  if (mode === 'standard') return zh ? '标准模式' : 'Standard mode'
  if (mode === 'ptc') return zh ? 'PTC 模式' : 'PTC mode'
  if (mode === 'minimal') return zh ? '极简模式' : 'Minimal mode'
  if (mode === 'creator') return zh ? '创造模式' : 'Creator mode'
  return zh ? '自定义模式' : 'Custom mode'
}

function privatePresetId(name: string, roster: HarnessAgentPresetRoster): string {
  const ascii = name.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28)
  const base = ascii === '' ? 'my-agent' : ascii
  let value = `${base}-${crypto.randomUUID().slice(0, 6)}`
  while (roster.presets.some(row => row.id === value)) value = `${base}-${crypto.randomUUID().slice(0, 6)}`
  return value
}

export interface AgentCenterSectionProps {
  readonly close: () => void
  readonly api: HarnessAgentPresetApi
  readonly profiles: AgentProfilesRemoteNamespace
  readonly skills: InstalledSkillsRemoteNamespace
  readonly runtime: AgentCenterRuntime
  readonly locale: PaimindLocaleSource
  readonly openAdvanced: () => boolean
}

export function AgentCenterSection(props: AgentCenterSectionProps): React.JSX.Element {
  const activeLocale = useSyncExternalStore(props.locale.subscribe.bind(props.locale), () => props.locale.getLocale().active, () => props.locale.getLocale().active)
  const runtimeState = useSyncExternalStore(props.runtime.subscribe, props.runtime.getSnapshot, props.runtime.getSnapshot)
  const zh = activeLocale.startsWith('zh')
  const [tab, setTab] = useState<'platform' | 'mine'>('platform')
  const [platformView, setPlatformView] = useState<'modes' | 'business'>('modes')
  const [businessCategory, setBusinessCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [roster, setRoster] = useState<RosterState>({ status: 'loading', roster: null, error: null })
  const [profileRows, setProfileRows] = useState<readonly AgentBusinessProfile[]>([])
  const [installedSkills, setInstalledSkills] = useState<readonly Readonly<SkillInstallRecord>[]>([])
  const [skillQuery, setSkillQuery] = useState('')
  const [skillCategory, setSkillCategory] = useState<SkillProductCategoryFilter>('all')
  const [selectedSkillsOnly, setSelectedSkillsOnly] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const builderRef = useRef<HTMLElement>(null)
  const builderTriggerRef = useRef<HTMLElement | null>(null)
  const busyRef = useRef(false)
  const builderOpen = draft !== null

  useEffect(() => { busyRef.current = busy }, [busy])

  useEffect(() => {
    if (!builderOpen) return
    const builder = builderRef.current
    if (builder === null) return
    const selector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    const focusable = (): HTMLElement[] => [...builder.querySelectorAll<HTMLElement>(selector)].filter(node => !node.hasAttribute('hidden'))
    ;(builder.querySelector<HTMLElement>('[data-paimind-builder-autofocus]') ?? focusable()[0])?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        setDraft(null)
        window.setTimeout(() => { builderTriggerRef.current?.focus() }, 0)
        return
      }
      if (event.key !== 'Tab') return
      const nodes = focusable()
      if (nodes.length === 0) return
      const first = nodes[0]!
      const last = nodes[nodes.length - 1]!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    builder.addEventListener('keydown', onKeyDown)
    return () => { builder.removeEventListener('keydown', onKeyDown) }
  }, [builderOpen])

  const openBuilder = (nextDraft: Draft): void => {
    builderTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setError(null)
    setDraft(nextDraft)
  }
  const closeBuilder = (): void => {
    if (busyRef.current) return
    setDraft(null)
    window.setTimeout(() => { builderTriggerRef.current?.focus() }, 0)
  }

  useEffect(() => {
    let current = true
    setRoster({ status: 'loading', roster: null, error: null })
    void Promise.all([props.api.list({}), props.profiles.listProfiles(), listInstalledSkills(props.skills)]).then(([native, profiles, skills]) => {
      if (!current) return
      if (!native.result.ok) setRoster({ status: 'error', roster: null, error: native.result.error.message })
      else setRoster({ status: 'ready', roster: native.result.value, error: null })
      setProfileRows(remoteValue(profiles).profiles)
      setInstalledSkills(remoteValue(skills).items)
    }, cause => { if (current) setRoster({ status: 'error', roster: null, error: messageOf(cause) }) })
    return () => { current = false }
  }, [props.api, props.profiles, props.skills, revision])

  const systemPresets = useMemo(() => roster.status !== 'ready' ? [] : roster.roster.presets.filter(row => row.trust === 'system'), [roster])
  const platformSource = useMemo(() => systemPresets.filter(row => {
    const metadata = metadataForPreset(row)
    return [row.name ?? '', row.description ?? '', metadata.mode, metadata.category?.id ?? '', metadata.category?.labelZh ?? '', metadata.category?.labelEn ?? '']
      .some(value => value.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  }), [query, systemPresets])
  const platformModeCount = useMemo(() => systemPresets.filter(row => metadataForPreset(row).kind === 'platform-mode').length, [systemPresets])
  const officialBusinessAgentCount = useMemo(() => systemPresets.filter(row => metadataForPreset(row).kind === 'business-agent').length, [systemPresets])
  const businessProfiles = useMemo(() => profileRows.filter(row => row.productKind === 'business'), [profileRows])
  const personalProfiles = useMemo(() => profileRows.filter(row => row.productKind !== 'business'), [profileRows])
  const businessAgentCount = officialBusinessAgentCount + businessProfiles.length
  const businessCategories = useMemo(() => {
    const categories = new Map(collectBusinessAgentCategories(systemPresets).map(category => [category.id, category]))
    for (const profile of businessProfiles) {
      if (profile.businessCategory === undefined || profile.businessCategoryId === undefined) continue
      const current = categories.get(profile.businessCategoryId)
      categories.set(profile.businessCategoryId, {
        id: profile.businessCategoryId, labelZh: profile.businessCategory, labelEn: profile.businessCategory,
        count: (current?.count ?? 0) + 1,
      })
    }
    return [...categories.values()].sort((left, right) => businessCategoryLabel(left, zh).localeCompare(businessCategoryLabel(right, zh)))
  }, [businessProfiles, systemPresets, zh])
  const platform = useMemo(() => platformSource.filter(row => {
    const metadata = metadataForPreset(row)
    if (platformView === 'modes') return metadata.kind === 'platform-mode'
    return metadata.kind === 'business-agent' && (businessCategory === 'all' || metadata.category?.id === businessCategory)
  }), [businessCategory, platformSource, platformView])
  const visibleBusinessProfiles = useMemo(() => businessProfiles.filter(row => {
    if (businessCategory !== 'all' && row.businessCategoryId !== businessCategory) return false
    return `${row.name} ${row.description} ${row.role} ${row.goal} ${row.businessCategory ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  }), [businessCategory, businessProfiles, query])
  const mine = useMemo(() => personalProfiles.filter(row => `${row.name} ${row.description} ${row.role} ${row.goal}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [personalProfiles, query])
  const templates = roster.status === 'ready' ? roster.roster.presets.filter(row => row.broken === undefined && row.trust === 'system' && metadataForPreset(row).kind === 'platform-mode' && row.id !== 'cordis') : []
  const skillCategoryCounts = useMemo(() => Object.fromEntries(SKILL_PRODUCT_CATEGORIES.map(category => [category, category === 'all'
    ? installedSkills.length
    : installedSkills.filter(skill => metadataForSkill(skill).category === category).length])) as Record<SkillProductCategoryFilter, number>, [installedSkills])
  const visibleSkills = useMemo(() => {
    const normalizedQuery = skillQuery.trim().toLocaleLowerCase()
    return installedSkills.filter(skill => {
      const metadata = metadataForSkill(skill)
      if (skillCategory !== 'all' && metadata.category !== skillCategory) return false
      if (selectedSkillsOnly && !draft?.preferredSkillNames.includes(skill.name)) return false
      return normalizedQuery === '' || [skill.name, skill.description, skill.whenToUse ?? '', ...metadata.tags]
        .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
    })
  }, [draft?.preferredSkillNames, installedSkills, selectedSkillsOnly, skillCategory, skillQuery])

  const start = async (preset: HarnessAgentPresetEntry, profile?: AgentBusinessProfile): Promise<void> => {
    if (preset.broken !== undefined || busy) return
    setBusy(true); setError(null)
    try { await props.runtime.start(preset.id, profile); props.close() } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }
  const save = async (): Promise<void> => {
    if (draft === null || roster.status !== 'ready' || busy) return
    if (draft.name.trim() === '' || draft.role.trim() === '' || draft.goal.trim() === '' || draft.behavior.trim() === '') { setError(zh ? '请填写名称、角色、目标和行为规范。' : 'Complete name, role, goal, and behavior.'); return }
    if (draft.productKind === 'business' && draft.businessCategory.trim() === '') { setError(zh ? '请填写业务分类。' : 'Choose or create a business category.'); return }
    setBusy(true); setError(null)
    let createdPreset: string | null = null
    try {
      const presetId = draft.editing?.presetId ?? privatePresetId(draft.name, roster.roster)
      if (draft.editing === null) {
        const copied = await props.api.copy({ from: draft.basePresetId, agentPreset: presetId, name: draft.name.trim() })
        if (!copied.result.ok) throw new Error(copied.result.error.message)
        createdPreset = presetId
      }
      const profile = remoteValue(await props.profiles.saveProfile({
        agentId: draft.editing?.agentId ?? presetId, presetId, name: draft.name, description: draft.description,
        basePresetId: draft.basePresetId, role: draft.role, goal: draft.goal, behavior: draft.behavior,
        preferredSkillNames: draft.basePresetId === 'minimal' ? [] : draft.preferredSkillNames, instructions: draft.instructions,
        productKind: draft.productKind,
        ...(draft.productKind === 'business' ? {
          businessCategory: draft.businessCategory,
          ...(draft.businessCategoryId === null ? {} : { businessCategoryId: draft.businessCategoryId }),
        } : {}),
        ...(draft.editing === null ? {} : { expectedVersion: draft.editing.configVersion }),
      }))
      const reread = await props.api.list({})
      if (!reread.result.ok) throw new Error(reread.result.error.message)
      const native = reread.result.value.presets.find(row => row.id === profile.presetId)
      if (native === undefined || native.broken !== undefined) throw new Error(native?.broken ?? '保存后未找到真实预设')
      setDraft(null); window.setTimeout(() => { builderTriggerRef.current?.focus() }, 0); setRevision(value => value + 1)
      if (draft.productKind === 'business') { setTab('platform'); setPlatformView('business') } else setTab('mine')
    } catch (cause) {
      if (createdPreset !== null) await props.api.remove({ agentPreset: createdPreset }).catch(() => undefined)
      setError(messageOf(cause))
    } finally { setBusy(false) }
  }
  const remove = async (profile: AgentBusinessProfile): Promise<void> => {
    if (!window.confirm(zh ? `删除“${profile.name}”？已有对话会保留历史记录。` : `Delete “${profile.name}”? Existing conversations keep their history.`)) return
    setBusy(true); setError(null)
    try {
      const result = await props.api.remove({ agentPreset: profile.presetId })
      if (!result.result.ok) throw new Error(result.result.error.message)
      setRevision(value => value + 1)
    } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }
  const setDefault = async (profile: AgentBusinessProfile): Promise<void> => {
    setBusy(true); setError(null)
    try { remoteValue(await props.profiles.setDefault({ presetId: profile.presetId })); setRevision(value => value + 1) }
    catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }

  const createPersonalAgent = (): void => {
    setTab('mine')
    setSkillQuery(''); setSkillCategory('all'); setSelectedSkillsOnly(false)
    openBuilder(emptyDraft(templates[0]?.id ?? 'standard'))
  }
  const createBusinessAgent = (): void => {
    setTab('platform'); setPlatformView('business')
    setSkillQuery(''); setSkillCategory('all'); setSelectedSkillsOnly(false)
    openBuilder(emptyDraft(templates[0]?.id ?? 'standard', 'business'))
  }
  const copyPlatformAgent = (preset: HarnessAgentPresetEntry): void => {
    if (preset.broken !== undefined || preset.id === 'cordis') return
    setSkillQuery(''); setSkillCategory('all'); setSelectedSkillsOnly(false)
    openBuilder(copyDraft(preset, zh))
  }
  const openAdvanced = (): void => {
    setError(null)
    if (!props.openAdvanced()) setError(zh ? '未能定位 Harness 原生智能体预设页面，请从“设置”中打开。' : 'Could not locate the native Harness Agent Presets page. Open it from Settings.')
  }
  const visibleCount = tab === 'platform'
    ? platform.length + (platformView === 'business' ? visibleBusinessProfiles.length : 0)
    : mine.length
  const primaryCreateBusiness = tab === 'platform' && platformView === 'business'

  const managedProfileCard = (profile: AgentBusinessProfile): React.JSX.Element => {
    const preset = roster.status === 'ready' ? roster.roster.presets.find(row => row.id === profile.presetId) : undefined
    const basePreset = roster.status === 'ready' ? roster.roster.presets.find(row => row.id === profile.basePresetId) : undefined
    const runtimeMode = basePreset === undefined ? 'custom' : metadataForPreset(basePreset).mode
    const broken = preset === undefined || preset.broken !== undefined
    const business = profile.productKind === 'business'
    return <li key={profile.agentId} data-paimind-agent-card data-paimind-agent-id={profile.agentId} data-broken={broken} data-product-kind={business ? 'business' : 'personal'}>
      <div data-paimind-agent-card-head><span data-paimind-agent-card-icon data-paimind-agent-avatar-seat="" data-paimind-agent-id={profile.agentId} data-paimind-agent-avatar-kind={business ? 'business' : 'personal'} role="img" aria-label={zh ? `${profile.name} 头像` : `${profile.name} avatar`}><span data-paimind-agent-avatar-fallback="" aria-hidden="true">{business ? <PaimindAgentIcon size={23} /> : <PaimindUserIcon size={23} />}</span></span><div data-paimind-agent-card-title><h3>{profile.name}</h3><span data-paimind-agent-card-kicker>{business ? (zh ? '业务智能体 · 本地维护' : 'Business Agent · Locally managed') : (zh ? '个人智能体' : 'Personal Agent')}</span></div></div>
      <div data-paimind-agent-badges><span data-paimind-agent-badge data-category="true">{business ? profile.businessCategory : (zh ? '个人' : 'Personal')}</span><span data-paimind-agent-badge>{modeLabel(runtimeMode, zh)}</span><span data-paimind-agent-badge>{zh ? `第 ${profile.revision} 版` : `Revision ${profile.revision}`}</span>{preset?.isDefault === true && <span data-paimind-agent-badge data-success="true">{zh ? '默认' : 'Default'}</span>}{broken && <span data-paimind-agent-badge>{zh ? '需修复' : 'Needs repair'}</span>}</div>
      <p>{profile.description || profile.role}</p>
      <div data-paimind-agent-card-context><span><PaimindSkillIcon size={13} />{profile.preferredSkillNames.length === 0 ? (zh ? '未封装会话技能' : 'No packaged session Skills') : (zh ? `${profile.preferredSkillNames.length} 个会话技能` : `${profile.preferredSkillNames.length} session Skills`)}</span><span>{zh ? 'Harness 原生预设' : 'Native Harness Preset'}</span></div>
      {broken && <p role="alert" data-paimind-agent-card-alert>{zh ? '原生预设缺失或损坏，请编辑或前往高级配置修复。' : 'The native Preset is missing or damaged. Edit it or repair it in advanced configuration.'}</p>}
      <div data-paimind-agent-actions><button type="button" data-paimind-agent-button data-primary="true" disabled={busy || broken} onClick={() => { if (preset !== undefined) void start(preset, profile) }}><PaimindNewConversationIcon size={14} />{zh ? '开始对话' : 'Start conversation'}</button><button type="button" data-paimind-agent-button disabled={busy} onClick={() => { setSkillQuery(''); setSkillCategory('all'); setSelectedSkillsOnly(false); openBuilder(editDraft(profile)) }}><PaimindEditIcon size={14} />{zh ? '编辑' : 'Edit'}</button><button type="button" data-paimind-agent-button data-quiet="true" disabled={busy || preset?.isDefault === true} onClick={() => { void setDefault(profile) }}>{zh ? '设为默认' : 'Set default'}</button><button type="button" data-paimind-agent-button data-danger="true" data-icon-only="true" aria-label={`${zh ? '删除' : 'Delete'} ${profile.name}`} disabled={busy} onClick={() => { void remove(profile) }}><PaimindTrashIcon size={14} /></button></div>
    </li>
  }

  return <section data-paimind-agent-center aria-label={zh ? '智能体中心' : 'Agent Center'} aria-busy={busy}>
    <header data-paimind-agent-hero>
      <div>
        <p data-paimind-agent-eyebrow><PaimindAgentIcon size={15} />{zh ? '真实 Harness 智能体' : 'Live Harness Agents'}</p>
        <h1 id="paimind-agent-center-title" tabIndex={-1} data-paimind-product-initial-focus>{zh ? '智能体中心' : 'Agent Center'}</h1>
        <p data-paimind-agent-hero-copy>{zh ? '发现合适的工作模式，配置业务与个人智能体，然后直接开始真实对话。' : 'Find a working mode, configure business or personal Agents, and start a real conversation.'}</p>
      </div>
      <div data-paimind-agent-hero-actions>
        <div data-paimind-agent-search-wrap><span data-paimind-agent-search-icon><PaimindSearchIcon size={17} /></span><input data-paimind-agent-search type="search" aria-label={zh ? '搜索智能体' : 'Search Agents'} placeholder={zh ? '搜索名称、说明、角色或目标' : 'Search names, descriptions, roles, or goals'} value={query} onChange={event => { setQuery(event.currentTarget.value) }} /></div>
        <div data-paimind-agent-hero-buttons>
          <button type="button" data-paimind-agent-button onClick={openAdvanced}><PaimindSettingsIcon size={15} />{zh ? '高级配置' : 'Advanced configuration'}</button>
          <button type="button" data-paimind-agent-button data-primary="true" onClick={primaryCreateBusiness ? createBusinessAgent : createPersonalAgent} disabled={busy || templates.length === 0}><PaimindPlusIcon size={15} />{primaryCreateBusiness ? (zh ? '创建业务智能体' : 'Create Business Agent') : (zh ? '创建个人智能体' : 'Create Personal Agent')}</button>
        </div>
      </div>
    </header>

    <div data-paimind-agent-tabs-shell>
      <div role="tablist" aria-label={zh ? '智能体类型' : 'Agent types'} data-paimind-agent-tabs>
        <button role="tab" type="button" data-paimind-agent-tab aria-label={zh ? '平台模式' : 'Platform modes'} aria-selected={tab === 'platform' && platformView === 'modes'} onClick={() => { setTab('platform'); setPlatformView('modes'); setQuery('') }}><PaimindAgentIcon size={16} />{zh ? '平台模式' : 'Platform modes'}<span data-paimind-agent-count>{platformModeCount}</span></button>
        <button role="tab" type="button" data-paimind-agent-tab aria-label={zh ? '业务智能体' : 'Business Agents'} aria-selected={tab === 'platform' && platformView === 'business'} onClick={() => { setTab('platform'); setPlatformView('business'); setQuery('') }}><PaimindAgentIcon size={16} />{zh ? '业务智能体' : 'Business Agents'}<span data-paimind-agent-count>{businessAgentCount}</span></button>
        <button role="tab" type="button" data-paimind-agent-tab aria-label={zh ? '我的智能体' : 'My Agents'} aria-selected={tab === 'mine'} onClick={() => { setTab('mine'); setQuery('') }}><PaimindUserIcon size={16} />{zh ? '我的智能体' : 'My Agents'}<span data-paimind-agent-count>{personalProfiles.length}</span></button>
      </div>
      {tab === 'platform' && platformView === 'business' && businessCategories.length > 0 && <label data-paimind-agent-business-filter>{zh ? '业务分类' : 'Business category'}<select aria-label={zh ? '业务分类' : 'Business category'} value={businessCategory} onChange={event => { setBusinessCategory(event.currentTarget.value) }}><option value="all">{zh ? '全部业务分类' : 'All business categories'}</option>{businessCategories.map(category => <option key={category.id} value={category.id}>{businessCategoryLabel(category, zh)} · {category.count}</option>)}</select></label>}
    </div>

    {(runtimeState.notice !== null || runtimeState.error !== null) && <p data-paimind-agent-note role="status">{runtimeState.error ?? runtimeState.notice}</p>}
    {error !== null && <p role="alert" data-paimind-agent-error>{error}</p>}
    <div data-paimind-agent-section-head><div><h2>{tab === 'platform' ? (platformView === 'modes' ? (zh ? '选择工作模式' : 'Choose a working mode') : (zh ? '业务智能体' : 'Business Agents')) : (zh ? '我的智能体' : 'My Agents')}</h2><p>{tab === 'mine' ? (zh ? '为自己的高频任务配置稳定角色、目标和会话技能。' : 'Configure stable roles, goals, and session Skills for your recurring work.') : platformView === 'business' ? (zh ? '按业务场景选择官方或本地维护的智能体。' : 'Choose an official or locally maintained Agent for a business scenario.') : (zh ? '平台模式决定对话的基础运行方式，可直接使用，也可复制为自己的智能体。' : 'Platform modes define the base runtime. Start directly or copy one into your own Agent.')}</p></div><div data-paimind-agent-section-actions><span data-paimind-agent-result-count>{zh ? `${visibleCount} 个结果` : `${visibleCount} results`}</span></div></div>
    {roster.status === 'loading' && <div data-paimind-agent-loading-grid aria-busy="true" aria-label={zh ? '正在读取智能体' : 'Reading Agents'}>{[0, 1, 2, 3].map(index => <div key={index} data-paimind-agent-loading-card><span /><strong /><i /></div>)}</div>}
    {roster.status === 'error' && <div data-paimind-agent-status role="alert"><span data-paimind-agent-status-icon><PaimindSettingsIcon size={22} /></span><strong>{zh ? '智能体连接失败' : 'Agent connection failed'}</strong><p>{roster.error}</p><button type="button" data-paimind-agent-button onClick={() => { setRevision(value => value + 1) }}>{zh ? '重新加载' : 'Retry'}</button></div>}
    {roster.status === 'ready' && tab === 'platform' && (visibleCount === 0 ? <div data-paimind-agent-status><span data-paimind-agent-status-icon><PaimindSearchIcon size={22} /></span><strong>{query.trim() !== '' ? (zh ? '没有匹配结果' : 'No matching results') : platformView === 'business' ? (zh ? '暂无业务智能体' : 'No Business Agents yet') : (zh ? '暂无平台模式' : 'No platform modes yet')}</strong><p>{query.trim() !== '' ? (zh ? '试试更短的关键词，或清空搜索。' : 'Try a shorter search or clear the query.') : (zh ? '当前 Harness 还没有提供此类可用预设。' : 'The current Harness does not expose an available Preset in this category.')}</p>{query.trim() !== '' && <button type="button" data-paimind-agent-button onClick={() => { setQuery('') }}>{zh ? '清空搜索' : 'Clear search'}</button>}{query.trim() === '' && platformView === 'business' && <button type="button" data-paimind-agent-button data-primary="true" onClick={createBusinessAgent} disabled={templates.length === 0}><PaimindPlusIcon size={14} />{zh ? '创建业务智能体' : 'Create Business Agent'}</button>}</div> : <ul data-paimind-agent-grid>{platform.map(preset => { const metadata = metadataForPreset(preset); return <li key={preset.id} data-paimind-agent-card data-broken={preset.broken !== undefined}>
      <div data-paimind-agent-card-head><span data-paimind-agent-card-icon><PaimindAgentIcon size={23} /></span><div data-paimind-agent-card-title><h3>{preset.name ?? (zh ? '平台智能体' : 'Platform Agent')}</h3><span data-paimind-agent-card-kicker>{metadata.kind === 'platform-mode' ? (zh ? '平台模式 · Harness 原生预设' : 'Platform mode · Native Harness Preset') : (zh ? '官方业务智能体' : 'Official Business Agent')}</span></div></div>
      <div data-paimind-agent-badges>{metadata.kind === 'business-agent' && metadata.category !== undefined && <span data-paimind-agent-badge data-category="true">{businessCategoryLabel(metadata.category, zh)}</span>}<span data-paimind-agent-badge>{modeLabel(metadata.mode, zh)}</span><span data-paimind-agent-badge>{zh ? '官方维护' : 'Official'}</span>{preset.isDefault && <span data-paimind-agent-badge data-success="true">{zh ? '默认' : 'Default'}</span>}{preset.broken !== undefined && <span data-paimind-agent-badge>{zh ? '需修复' : 'Needs repair'}</span>}</div>
      <p>{preset.description ?? (zh ? '平台提供的真实能力模板。' : 'A real platform-provided capability template.')}</p>
      {preset.broken !== undefined && <p role="alert">{zh ? `当前不可用：${preset.broken}` : `Unavailable: ${preset.broken}`}</p>}
      <div data-paimind-agent-actions>{preset.id === 'cordis' ? <button type="button" data-paimind-agent-button disabled={busy} onClick={openAdvanced}><PaimindSettingsIcon size={14} />{zh ? '管理预设' : 'Manage Presets'}</button> : <button type="button" data-paimind-agent-button disabled={busy || preset.broken !== undefined} onClick={() => { copyPlatformAgent(preset) }}><PaimindEditIcon size={14} />{zh ? '复制并编辑' : 'Copy and edit'}</button>}<button type="button" data-paimind-agent-button data-primary="true" disabled={busy || preset.broken !== undefined} onClick={() => { void start(preset) }}><PaimindPlayIcon size={14} />{zh ? '开始对话' : 'Start conversation'}</button></div>
    </li> })}{platformView === 'business' && visibleBusinessProfiles.map(managedProfileCard)}</ul>)}
    {roster.status === 'ready' && tab === 'mine' && (mine.length === 0 ? <div data-paimind-agent-status><span data-paimind-agent-status-icon><PaimindUserIcon size={22} /></span><strong>{query.trim() === '' ? (zh ? '还没有个人智能体' : 'No personal Agents yet') : (zh ? '没有匹配的个人智能体' : 'No matching personal Agents')}</strong><p>{query.trim() === '' ? (zh ? '从一个平台模式开始，配置你的角色、目标与会话技能。' : 'Start from a platform mode and configure your role, goal, and session Skills.') : (zh ? '试试更短的关键词，或清空搜索。' : 'Try a shorter search or clear the query.')}</p><button type="button" data-paimind-agent-button data-primary="true" onClick={query.trim() === '' ? createPersonalAgent : () => { setQuery('') }} disabled={query.trim() === '' && templates.length === 0}><PaimindPlusIcon size={14} />{query.trim() === '' ? (zh ? '创建个人智能体' : 'Create Personal Agent') : (zh ? '清空搜索' : 'Clear search')}</button></div> : <ul data-paimind-agent-grid>{mine.map(managedProfileCard)}</ul>)}

    {draft !== null && <div data-paimind-agent-builder-layer>
      <section ref={builderRef} data-paimind-agent-form role="dialog" aria-modal="true" aria-labelledby="paimind-agent-builder-title">
        <header data-paimind-agent-form-head><div><p data-paimind-agent-form-kicker>{draft.productKind === 'business' ? (zh ? '业务智能体' : 'Business Agent') : (zh ? '个人智能体' : 'Personal Agent')}</p><h2 id="paimind-agent-builder-title">{draft.editing !== null ? (draft.productKind === 'business' ? (zh ? '编辑业务智能体' : 'Edit Business Agent') : (zh ? '编辑个人智能体' : 'Edit Personal Agent')) : draft.copiedFromPlatform !== null ? (zh ? '复制并编辑' : 'Copy and edit') : draft.productKind === 'business' ? (zh ? '创建业务智能体' : 'Create Business Agent') : (zh ? '创建个人智能体' : 'Create Personal Agent')}</h2><p>{draft.copiedFromPlatform !== null ? (zh ? `基于“${draft.copiedFromPlatform}”创建可编辑版本，官方原版保持不变。` : `Create an editable version from “${draft.copiedFromPlatform}”; the official original stays unchanged.`) : (zh ? '定义稳定的工作边界，并选择只在该智能体会话中启用的技能。' : 'Define stable working boundaries and select Skills enabled only in this Agent’s sessions.')}</p></div><button type="button" data-paimind-agent-builder-close aria-label={zh ? '关闭创建面板' : 'Close builder'} disabled={busy} onClick={closeBuilder}><PaimindCloseIcon size={18} /></button></header>
        <div data-paimind-agent-form-message>{error !== null && <p role="alert" data-paimind-agent-form-error>{error}</p>}</div>
        <div data-paimind-agent-form-body>
          <div data-paimind-agent-form-column>
            <section data-paimind-agent-form-panel aria-labelledby="paimind-agent-identity-title">
              <div data-paimind-agent-panel-head><span>01</span><div><h3 id="paimind-agent-identity-title">{zh ? '身份与运行模式' : 'Identity and runtime'}</h3><p>{zh ? '保存时会创建或更新真实 Harness Agent Preset。' : 'Saving creates or updates a real Harness Agent Preset.'}</p></div></div>
              <div data-paimind-agent-fields>
                <label data-paimind-agent-field>{zh ? '名称' : 'Name'}<input data-paimind-builder-autofocus value={draft.name} maxLength={80} onChange={event => { setDraft({ ...draft, name: event.currentTarget.value }) }} /></label>
                <label data-paimind-agent-field>{zh ? '运行模式' : 'Runtime mode'}<select aria-label={zh ? '运行模式' : 'Runtime mode'} value={draft.basePresetId} disabled={draft.editing !== null} onChange={event => { const basePresetId = event.currentTarget.value; setDraft({ ...draft, basePresetId, preferredSkillNames: basePresetId === 'minimal' ? [] : draft.preferredSkillNames }) }}>{templates.map(row => <option key={row.id} value={row.id}>{modeLabel(metadataForPreset(row).mode, zh)} · {row.name ?? (zh ? '平台模板' : 'Platform template')}</option>)}</select></label>
                {draft.productKind === 'business' && <label data-paimind-agent-field data-wide="true">{zh ? '业务分类' : 'Business category'}<input type="search" list="paimind-agent-business-category-options" value={draft.businessCategory} maxLength={80} placeholder={zh ? '选择现有分类或输入新分类' : 'Choose an existing category or enter a new one'} onChange={event => { const businessCategory = event.currentTarget.value; const matched = businessCategories.find(category => businessCategoryLabel(category, zh) === businessCategory); setDraft({ ...draft, businessCategory, businessCategoryId: matched?.id ?? null }) }} /><datalist id="paimind-agent-business-category-options">{businessCategories.map(category => <option key={category.id} value={businessCategoryLabel(category, zh)} />)}</datalist></label>}
                <label data-paimind-agent-field data-wide="true">{zh ? '描述' : 'Description'}<input value={draft.description} maxLength={500} placeholder={zh ? '一句话说明这个智能体适合完成什么任务' : 'One sentence describing the task this Agent handles'} onChange={event => { setDraft({ ...draft, description: event.currentTarget.value }) }} /></label>
              </div>
            </section>
            <section data-paimind-agent-form-panel aria-labelledby="paimind-agent-definition-title">
              <div data-paimind-agent-panel-head><span>02</span><div><h3 id="paimind-agent-definition-title">{zh ? '工作定义' : 'Working definition'}</h3><p>{zh ? '这些内容会写入真实 Persona，并随 Preset 进入新会话。' : 'These fields become the real Persona used by the Preset in new sessions.'}</p></div></div>
              <div data-paimind-agent-fields>
                <label data-paimind-agent-field>{zh ? '角色' : 'Role'}<textarea value={draft.role} maxLength={2000} placeholder={zh ? '它以什么身份工作' : 'Who this Agent works as'} onChange={event => { setDraft({ ...draft, role: event.currentTarget.value }) }} /></label>
                <label data-paimind-agent-field>{zh ? '目标' : 'Goal'}<textarea value={draft.goal} maxLength={2000} placeholder={zh ? '它最终要交付什么结果' : 'The outcome this Agent should deliver'} onChange={event => { setDraft({ ...draft, goal: event.currentTarget.value }) }} /></label>
                <label data-paimind-agent-field data-wide="true">{zh ? '行为规范' : 'Behavior'}<textarea value={draft.behavior} maxLength={4000} placeholder={zh ? '工作原则、边界和质量要求' : 'Working principles, boundaries, and quality requirements'} onChange={event => { setDraft({ ...draft, behavior: event.currentTarget.value }) }} /></label>
                <label data-paimind-agent-field data-wide="true">{zh ? '自然语言补充要求' : 'Additional instructions'}<textarea value={draft.instructions} maxLength={4000} placeholder={zh ? '例如：回答优先使用中文，所有结论都要给出证据来源。' : 'For example: answer concisely and cite evidence for every conclusion.'} onChange={event => { setDraft({ ...draft, instructions: event.currentTarget.value }) }} /></label>
              </div>
            </section>
          </div>
          <div data-paimind-agent-form-column data-secondary="true">
            <section data-paimind-agent-runtime-proof><span><PaimindAgentIcon size={20} /></span><div><strong>{zh ? '真实运行链路' : 'Real runtime path'}</strong><p>{zh ? 'Harness 拥有 Preset、Session 与运行历史；PAIMind 只保存可编辑配置并绑定会话。' : 'Harness owns Presets, Sessions, and run history. PAIMind stores editable configuration and binds Sessions.'}</p></div></section>
            <section data-paimind-agent-form-panel aria-labelledby="paimind-agent-skills-title">
              <div data-paimind-agent-panel-head><span>03</span><div><h3 id="paimind-agent-skills-title">{zh ? '会话技能' : 'Session Skills'}</h3><p>{zh ? '只选择完成该智能体任务所必需的技能。' : 'Select only the Skills required for this Agent’s task.'}</p></div></div>
              <fieldset data-paimind-agent-field data-paimind-agent-skill-picker disabled={draft.basePresetId === 'minimal'}>
                <legend>{zh ? '会话注入技能' : 'Session-injected Skills'}</legend>
                <p data-paimind-agent-skill-policy>{zh ? '只有这里封装的技能会进入该智能体的新会话；其他已安装技能仍留在技能中心。' : 'Only packaged Skills enter new sessions for this Agent. Other installed Skills remain in Skill Center.'}</p>
                {draft.basePresetId === 'minimal' ? <div data-paimind-agent-skill-empty>{zh ? '极简模式不注入技能，请选择标准模式或 PTC 模式。' : 'Minimal mode does not inject Skills. Choose Standard or PTC.'}</div> : installedSkills.length === 0 ? <div data-paimind-agent-skill-empty>{zh ? '暂无已安装技能' : 'No installed Skills'}</div> : <>
                  <div data-paimind-agent-skill-toolbar>
                    <label data-paimind-agent-skill-search><PaimindSearchIcon size={15} /><input type="search" aria-label={zh ? '搜索会话技能' : 'Search session Skills'} placeholder={zh ? '搜索名称、说明或标签' : 'Search names, descriptions, or tags'} value={skillQuery} onChange={event => { setSkillQuery(event.currentTarget.value) }} /></label>
                    <button type="button" data-paimind-agent-skill-selected aria-pressed={selectedSkillsOnly} onClick={() => { setSelectedSkillsOnly(value => !value) }}>{zh ? `只看已选 ${draft.preferredSkillNames.length}` : `Selected ${draft.preferredSkillNames.length}`}</button>
                  </div>
                  <div data-paimind-agent-skill-categories role="group" aria-label={zh ? '技能分类' : 'Skill categories'}>{SKILL_PRODUCT_CATEGORIES.map(category => <button key={category} type="button" aria-label={`${skillCategoryLabel(category, zh)} ${skillCategoryCounts[category]}`} aria-pressed={skillCategory === category} onClick={() => { setSkillCategory(category) }}><span>{skillCategoryLabel(category, zh)}</span><small>{skillCategoryCounts[category]}</small></button>)}</div>
                  <div data-paimind-agent-skill-summary><span>{zh ? `已封装 ${draft.preferredSkillNames.length} / 已安装 ${installedSkills.length}` : `${draft.preferredSkillNames.length} packaged / ${installedSkills.length} installed`}</span><span>{zh ? `${visibleSkills.length} 个当前结果` : `${visibleSkills.length} current results`}</span></div>
                  <div data-paimind-agent-skill-results>{visibleSkills.length === 0 ? <div data-paimind-agent-skill-empty>{zh ? '当前筛选没有匹配技能。' : 'No Skills match the current filters.'}</div> : visibleSkills.map(skill => { const metadata = metadataForSkill(skill); return <label key={skill.name} data-paimind-agent-skill data-selected={draft.preferredSkillNames.includes(skill.name)}><input type="checkbox" checked={draft.preferredSkillNames.includes(skill.name)} onChange={event => { setDraft({ ...draft, preferredSkillNames: event.currentTarget.checked ? [...draft.preferredSkillNames, skill.name] : draft.preferredSkillNames.filter(value => value !== skill.name) }) }} /><span><strong>{skill.name}</strong><small>{skillCategoryLabel(metadata.category, zh)}</small><em>{skill.description}</em></span></label> })}</div>
                </>}
              </fieldset>
            </section>
          </div>
        </div>
        <div data-paimind-agent-form-actions><p>{zh ? '保存后可立即在真实 Harness Session 中开始对话。' : 'After saving, start immediately in a real Harness Session.'}</p><div><button type="button" data-paimind-agent-button disabled={busy} onClick={closeBuilder}>{zh ? '取消' : 'Cancel'}</button><button type="button" data-paimind-agent-button data-primary="true" disabled={busy} onClick={() => { void save() }}>{busy ? (zh ? '保存中…' : 'Saving…') : draft.productKind === 'business' ? (zh ? '保存业务智能体' : 'Save Business Agent') : (zh ? '保存个人智能体' : 'Save Personal Agent')}</button></div></div>
      </section>
    </div>}
  </section>
}

export function AgentCenterTrigger(props: {
  readonly wide: boolean
  readonly controller: PaimindProductSurfaceController
  readonly locale: PaimindLocaleSource
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot, props.controller.getSnapshot)
  const locale = useSyncExternalStore(props.locale.subscribe.bind(props.locale), () => props.locale.getLocale().active, () => props.locale.getLocale().active)
  const zh = locale.startsWith('zh')
  return <button
    type="button"
    data-paimind-agent-trigger
    data-paimind-product-trigger="agent-center"
    data-wide={props.wide}
    aria-expanded={snapshot.open}
    aria-label={zh ? '打开智能体中心' : 'Open Agent Center'}
    onClick={event => { props.controller.toggle(event.currentTarget) }}
  >
    <PaimindAgentIcon size={props.wide ? 16 : 18} />
    {props.wide && <span data-paimind-agent-trigger-label>{zh ? '智能体中心' : 'Agent Center'}</span>}
  </button>
}

export interface AgentCenterSurfaceProps extends Omit<AgentCenterSectionProps, 'close'> {
  readonly controller: PaimindProductSurfaceController
}

export function AgentCenterSurface(props: AgentCenterSurfaceProps): ReactNode {
  const snapshot = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot, props.controller.getSnapshot)
  const locale = useSyncExternalStore(props.locale.subscribe.bind(props.locale), () => props.locale.getLocale().active, () => props.locale.getLocale().active)
  const root = useRef<HTMLDivElement>(null)
  const zh = locale.startsWith('zh')
  const skillAvailable = snapshot.open && isPaimindProductSurfaceAvailable('skill-center')

  useEffect(() => {
    if (!snapshot.open || root.current === null) return
    return installPaimindProductSurfaceInteraction(root.current, props.controller)
  }, [props.controller, snapshot.open])

  if (!snapshot.open) return null
  return createPortal(<div ref={root} data-paimind-product-surface="agent-center" role="dialog" aria-modal="true" aria-labelledby="paimind-agent-center-title">
    <header data-paimind-product-bar>
      <div data-paimind-product-brand><span data-paimind-product-brand-icon><PaimindAgentIcon size={18} /></span><span>PAIMind</span></div>
      <nav data-paimind-product-switcher aria-label={zh ? 'PAIMind 产品中心' : 'PAIMind product centers'}>
        <button type="button" data-paimind-product-switch aria-current="page"><PaimindAgentIcon size={15} /><span>{zh ? '智能体中心' : 'Agent Center'}</span></button>
        <button type="button" data-paimind-product-switch disabled={!skillAvailable} onClick={() => { requestPaimindProductSurface('skill-center') }}><PaimindSkillIcon size={15} /><span>{zh ? '技能中心' : 'Skill Center'}</span></button>
      </nav>
      <div data-paimind-product-bar-actions>
        <button type="button" data-paimind-product-return onClick={() => { props.controller.close() }}><PaimindNewConversationIcon size={15} /><span>{zh ? '返回对话' : 'Back to conversation'}</span></button>
        <button type="button" data-paimind-product-close aria-label={zh ? '关闭智能体中心' : 'Close Agent Center'} onClick={() => { props.controller.close() }}><PaimindCloseIcon size={16} /></button>
      </div>
    </header>
    <main data-paimind-product-body><AgentCenterSection {...props} close={() => { props.controller.close() }} /></main>
  </div>, document.body)
}

class AgentCenterBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('[paimind-agent-market]', error, info) }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

export async function apply(ctx: AgentCenterClientContext): Promise<() => Promise<void>> {
  const disposeAgentRemote = await ctx.remote.$mount(AGENT_TYPERT_REMOTE)
  const mounted = ctx.inject([...BASE_INJECT, 'remote.paimindAgentProfiles', 'remote.paimindSkillInstaller'], scope => {
    const profiles = scope.remote.paimindAgentProfiles
    const skills = scope.remote.paimindSkillInstaller
    if (profiles === undefined || skills === undefined) throw new Error('Agent Center services did not mount')
    const api = scope.get('connection').api.agentPresets
    const seat = resolveHarnessAgentPresetSeatControl(scope.slots)
    const runtime = new AgentCenterRuntime(seat, profiles, scope.sessions, scope.workspaces, scope.conversation)
    const surfaceController = new PaimindProductSurfaceController('agent-center')
    const presetSettings = installHarnessAgentPresetSettingsNavigation(scope.slots)
    scope.effect(installStyle, 'paimind-agent-market: style')
    scope.effect(() => () => { runtime.dispose() }, 'paimind-agent-market: runtime')
    scope.effect(() => () => { surfaceController.dispose() }, 'paimind-agent-market: surface controller')
    scope.effect(() => () => { presetSettings.dispose() }, 'paimind-agent-market: native Preset navigation')
    contributePaimindExtension(scope.slots, {
      id: 'paimind:agent-market', packageName: '@paimind/agent-market', category: 'agents',
      nameZh: '智能体中心', nameEn: 'Agent Center',
      descriptionZh: '配置个人智能体并在真实 Harness 对话中运行。',
      descriptionEn: 'Configure personal Agents and run them in real Harness conversations.',
      surface: 'shell', maturity: 'available', order: 10,
    })
    const injectProps = () => ({
      controller: surfaceController,
      api,
      profiles,
      skills,
      runtime,
      locale: scope.locale,
      openAdvanced: () => {
        const opened = presetSettings.open()
        if (opened) surfaceController.close(false)
        return opened
      },
    })
    scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
      name: 'sidebar.footer.action', id: 'paimind-agent-center-trigger', order: -12,
      label: () => scope.locale.getLocale().active.startsWith('zh') ? '智能体中心' : 'Agent Center',
      inject: () => ({ controller: surfaceController, locale: scope.locale }),
    }, (props: { readonly wide: boolean; readonly controller: PaimindProductSurfaceController; readonly locale: PaimindLocaleSource }) => <AgentCenterBoundary><AgentCenterTrigger {...props} /></AgentCenterBoundary>))
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay', id: 'paimind-agent-center-surface', order: 10, inject: injectProps,
    }, (props: AgentCenterSurfaceProps) => <AgentCenterBoundary><AgentCenterSurface {...props} /></AgentCenterBoundary>))
  }, 'paimind-agent-market: full-page product surface')
  try { await mounted } catch (error) {
    await disposeAgentRemote()
    throw error
  }
  return async () => {
    await mounted.dispose()
    await disposeAgentRemote()
  }
}
