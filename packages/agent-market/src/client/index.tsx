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
  contributePaimindExtension,
  installHarnessAgentPresetSettingsNavigation,
  type HarnessAgentPresetApi,
  type HarnessAgentPresetEntry,
  type HarnessAgentPresetRoster,
  type HarnessConversationDraftService,
  type HarnessInspectableSlotRegistry,
  type HarnessRemoteMountService,
  type HarnessRemoteResult,
  type HarnessSessionService,
  type HarnessSettingsSectionOwnerProps,
  type HarnessWorkspaceService,
  type PaimindClientContext,
  type PaimindLocaleSource,
} from '@paimind/harness-compat'
import type {
  AgentBusinessProfile,
  AgentBusinessProfileInput,
  AgentMigrationPlan,
  AgentMigrationRecord,
  AgentProfileSnapshot,
  AgentSessionBinding,
  AgentVerificationRecord,
} from '@paimind/agent-builder'
import type { SkillInstallerSnapshot } from '@paimind/skill-market'
import AGENT_TYPERT_REMOTE from '@paimind/agent-builder/remote'

const BASE_INJECT = ['slots', 'locale', 'remote', 'sessions', 'workspaces', 'conversation'] as const
export const inject = [...BASE_INJECT]
const STYLE_ID = '@paimind/agent-market'
const STYLE = `
[data-paimind-agent-center]{box-sizing:border-box;min-height:100%;padding:24px;color:var(--dsw-alias-label-primary,#202124);font:inherit}
[data-paimind-agent-center] *{box-sizing:border-box}
[data-paimind-agent-header]{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
[data-paimind-agent-header] h2{margin:0;font-size:22px;line-height:30px}
[data-paimind-agent-header] p{margin:5px 0 0;max-width:720px;color:var(--dsw-alias-label-secondary,#626872);font-size:13px;line-height:20px}
[data-paimind-agent-tabs],[data-paimind-agent-actions],[data-paimind-agent-skills]{display:flex;gap:7px;flex-wrap:wrap}
[data-paimind-agent-tabs]{margin:14px 0 12px}
[data-paimind-agent-button],[data-paimind-agent-tab]{min-height:34px;padding:7px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.24));border-radius:9px;color:var(--dsw-alias-label-secondary,#626872);background:transparent;font:inherit;font-size:12px;line-height:18px;cursor:pointer}
[data-paimind-agent-button][data-primary='true']{border-color:transparent;color:#fff;background:var(--dsw-alias-state-business-primary,#4f7ff8)}
[data-paimind-agent-button][data-danger='true']{color:var(--dsw-alias-state-error-primary,#d04444)}
[data-paimind-agent-button]:disabled{opacity:.45;cursor:not-allowed}
[data-paimind-agent-tab][aria-selected='true']{border-color:var(--dsw-alias-state-business-primary,#4f7ff8);color:var(--dsw-alias-state-business-primary,#4f7ff8);background:color-mix(in srgb,currentColor 8%,transparent)}
[data-paimind-agent-search]{width:100%;min-height:38px;margin-bottom:12px;padding:8px 11px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.24));border-radius:10px;color:inherit;background:transparent;font:inherit}
[data-paimind-agent-grid]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:0;margin:0;list-style:none}
[data-paimind-agent-card]{display:grid;gap:10px;min-width:0;padding:14px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:13px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.025))}
[data-paimind-agent-card][data-broken='true']{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d04444) 55%,transparent)}
[data-paimind-agent-card] h3{margin:0;font-size:15px;line-height:21px;overflow-wrap:anywhere}
[data-paimind-agent-card] p{margin:0;color:var(--dsw-alias-label-secondary,#626872);font-size:12px;line-height:18px;overflow-wrap:anywhere}
[data-paimind-agent-badges]{display:flex;gap:5px;flex-wrap:wrap}
[data-paimind-agent-badge]{padding:2px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.09));color:var(--dsw-alias-label-secondary,#626872);font-size:10px;line-height:16px}
[data-paimind-agent-badge][data-success='true']{color:var(--dsw-alias-state-success-primary,#238c55);background:color-mix(in srgb,currentColor 10%,transparent)}
[data-paimind-agent-status]{padding:24px 8px;color:var(--dsw-alias-label-secondary,#626872);font-size:12px;line-height:18px;text-align:center}
[data-paimind-agent-error]{margin:10px 0;color:var(--dsw-alias-state-error-primary,#d04444);font-size:12px;line-height:18px;overflow-wrap:anywhere}
[data-paimind-agent-form]{display:grid;gap:12px;margin:12px 0 16px;padding:15px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 38%,transparent);border-radius:14px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 5%,transparent)}
[data-paimind-agent-form] h3{margin:0;font-size:16px}
[data-paimind-agent-fields]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
[data-paimind-agent-field]{display:grid;gap:5px;min-width:0;color:var(--dsw-alias-label-secondary,#626872);font-size:12px}
[data-paimind-agent-field][data-wide='true']{grid-column:1/-1}
[data-paimind-agent-field] :is(input,select,textarea){width:100%;min-width:0;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.24));border-radius:9px;color:var(--dsw-alias-label-primary,#202124);background:var(--dsw-alias-bg-layer-1,transparent);font:inherit;font-size:13px}
[data-paimind-agent-field] textarea{min-height:82px;resize:vertical;line-height:19px}
[data-paimind-agent-skill]{display:flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:8px}
[data-paimind-agent-note]{margin:0;padding:9px 11px;border-radius:9px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08));color:var(--dsw-alias-label-secondary,#626872);font-size:11px;line-height:18px}
@media(max-width:760px){[data-paimind-agent-center]{padding:16px 12px}[data-paimind-agent-grid],[data-paimind-agent-fields]{grid-template-columns:1fr}[data-paimind-agent-field][data-wide='true']{grid-column:auto}}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID; style.dataset.paimindPlugin = STYLE_ID; style.textContent = STYLE
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
  const previousWasBlank = previous !== undefined && before.byId[previous]?.blank === true
  return await new Promise<string>((resolveSession, reject) => {
    let done = false
    let timer: ReturnType<typeof setTimeout>
    const inspect = (): void => {
      if (done) return
      const snapshot = sessions.list.getSnapshot()
      const current = snapshot.current
      if (current === undefined || snapshot.byId[current]?.blank !== true) return
      if (!previousWasBlank && current === previous) return
      done = true; clearTimeout(timer); unsubscribe(); resolveSession(current)
    }
    const unsubscribe = sessions.list.subscribe(inspect)
    timer = setTimeout(() => { done = true; unsubscribe(); reject(new Error('创建真实空白对话超时')) }, timeoutMs)
    workspaces.startSession()
    inspect()
  })
}

async function selectPresetTwice(api: HarnessAgentPresetApi, sessions: HarnessSessionService, sessionId: string, presetId: string): Promise<void> {
  await new Promise(resolve => { setTimeout(resolve, 650) })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const selected = await api.select({ sessionId, agentPreset: presetId })
    if (!selected.result.ok) throw new Error(selected.result.error.message)
    sessions.noteAgentPreset?.(sessionId, selected.result.value.agentPreset)
    if (attempt === 0) await new Promise(resolve => { setTimeout(resolve, 650) })
  }
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
    private readonly api: HarnessAgentPresetApi,
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
    await selectPresetTwice(this.api, this.sessions, sessionId, presetId)
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
      await selectPresetTwice(this.api, this.sessions, targetSessionId, plan.presetId)
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
  readonly name: string
  readonly description: string
  readonly basePresetId: string
  readonly role: string
  readonly goal: string
  readonly behavior: string
  readonly preferredSkillNames: readonly string[]
  readonly instructions: string
}

function emptyDraft(basePresetId: string): Draft {
  return { editing: null, name: '', description: '', basePresetId, role: '', goal: '', behavior: '', preferredSkillNames: [], instructions: '' }
}

function editDraft(profile: AgentBusinessProfile): Draft {
  return { editing: profile, name: profile.name, description: profile.description, basePresetId: profile.basePresetId, role: profile.role, goal: profile.goal, behavior: profile.behavior, preferredSkillNames: profile.basePresetId === 'minimal' ? [] : profile.preferredSkillNames, instructions: profile.instructions }
}

function privatePresetId(name: string, roster: HarnessAgentPresetRoster): string {
  const ascii = name.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28)
  const base = ascii === '' ? 'my-agent' : ascii
  let value = `${base}-${crypto.randomUUID().slice(0, 6)}`
  while (roster.presets.some(row => row.id === value)) value = `${base}-${crypto.randomUUID().slice(0, 6)}`
  return value
}

export interface AgentCenterSectionProps extends HarnessSettingsSectionOwnerProps {
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
  const [query, setQuery] = useState('')
  const [roster, setRoster] = useState<RosterState>({ status: 'loading', roster: null, error: null })
  const [profileRows, setProfileRows] = useState<readonly AgentBusinessProfile[]>([])
  const [skillNames, setSkillNames] = useState<readonly string[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let current = true
    setRoster({ status: 'loading', roster: null, error: null })
    void Promise.all([props.api.list({}), props.profiles.listProfiles(), listInstalledSkills(props.skills)]).then(([native, profiles, skills]) => {
      if (!current) return
      if (!native.result.ok) setRoster({ status: 'error', roster: null, error: native.result.error.message })
      else setRoster({ status: 'ready', roster: native.result.value, error: null })
      setProfileRows(remoteValue(profiles).profiles)
      setSkillNames(remoteValue(skills).items.map(row => row.name))
    }, cause => { if (current) setRoster({ status: 'error', roster: null, error: messageOf(cause) }) })
    return () => { current = false }
  }, [props.api, props.profiles, props.skills, revision])

  const platform = useMemo(() => roster.status !== 'ready' ? [] : roster.roster.presets.filter(row => row.trust === 'system' && `${row.name ?? ''} ${row.description ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [query, roster])
  const mine = useMemo(() => profileRows.filter(row => `${row.name} ${row.description} ${row.role} ${row.goal}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [profileRows, query])
  const templates = roster.status === 'ready' ? roster.roster.presets.filter(row => row.broken === undefined && row.trust === 'system' && row.id !== 'cordis') : []

  const start = async (preset: HarnessAgentPresetEntry, profile?: AgentBusinessProfile): Promise<void> => {
    if (preset.broken !== undefined || busy) return
    setBusy(true); setError(null)
    try { await props.runtime.start(preset.id, profile); props.close() } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }
  const save = async (): Promise<void> => {
    if (draft === null || roster.status !== 'ready' || busy) return
    if (draft.name.trim() === '' || draft.role.trim() === '' || draft.goal.trim() === '' || draft.behavior.trim() === '') { setError(zh ? '请填写名称、角色、目标和行为规范。' : 'Complete name, role, goal, and behavior.'); return }
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
        ...(draft.editing === null ? {} : { expectedVersion: draft.editing.configVersion }),
      }))
      const reread = await props.api.list({})
      if (!reread.result.ok) throw new Error(reread.result.error.message)
      const native = reread.result.value.presets.find(row => row.id === profile.presetId)
      if (native === undefined || native.broken !== undefined) throw new Error(native?.broken ?? '保存后未找到真实预设')
      setDraft(null); setRevision(value => value + 1); setTab('mine')
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

  return <section data-paimind-agent-center aria-label={zh ? '智能体中心' : 'Agent Center'}>
    <header data-paimind-agent-header><div><h2>{zh ? '智能体中心' : 'Agent Center'}</h2><p>{zh ? '选择平台智能体，或配置自己的角色、目标、行为和技能。开始对话会进入真实 Harness 会话。' : 'Choose a platform Agent or configure your own role, goals, behavior, and Skills. Start creates a real Harness conversation.'}</p></div><div data-paimind-agent-actions><button type="button" data-paimind-agent-button onClick={() => { if (!props.openAdvanced()) setError(zh ? '当前 Harness 版本暂不支持从这里打开高级配置。' : 'Advanced configuration is unavailable in this Harness version.') }}>{zh ? '高级配置' : 'Advanced configuration'}</button>{tab === 'mine' && <button type="button" data-paimind-agent-button data-primary="true" onClick={() => { setDraft(emptyDraft(templates[0]?.id ?? 'standard')) }} disabled={busy || templates.length === 0}>{zh ? '创建智能体' : 'Create Agent'}</button>}</div></header>
    <div role="tablist" data-paimind-agent-tabs><button role="tab" type="button" data-paimind-agent-tab aria-selected={tab === 'platform'} onClick={() => { setTab('platform'); setDraft(null) }}>{zh ? '平台智能体' : 'Platform Agents'}</button><button role="tab" type="button" data-paimind-agent-tab aria-selected={tab === 'mine'} onClick={() => { setTab('mine') }}>{zh ? '我的智能体' : 'My Agents'}</button></div>
    {(runtimeState.notice !== null || runtimeState.error !== null) && <p data-paimind-agent-note role="status">{runtimeState.error ?? runtimeState.notice}</p>}
    {draft !== null && <section data-paimind-agent-form aria-label={draft.editing === null ? (zh ? '创建智能体' : 'Create Agent') : (zh ? '编辑智能体' : 'Edit Agent')}><h3>{draft.editing === null ? (zh ? '创建智能体' : 'Create Agent') : (zh ? '编辑智能体' : 'Edit Agent')}</h3><div data-paimind-agent-fields>
      <label data-paimind-agent-field>{zh ? '名称' : 'Name'}<input value={draft.name} maxLength={80} onChange={event => { setDraft({ ...draft, name: event.currentTarget.value }) }} /></label>
      <label data-paimind-agent-field>{zh ? '基础能力模板' : 'Base template'}<select value={draft.basePresetId} disabled={draft.editing !== null} onChange={event => { const basePresetId = event.currentTarget.value; setDraft({ ...draft, basePresetId, preferredSkillNames: basePresetId === 'minimal' ? [] : draft.preferredSkillNames }) }}>{templates.map(row => <option key={row.id} value={row.id}>{row.name ?? (zh ? '平台模板' : 'Platform template')}</option>)}</select></label>
      <label data-paimind-agent-field data-wide="true">{zh ? '描述' : 'Description'}<input value={draft.description} maxLength={500} onChange={event => { setDraft({ ...draft, description: event.currentTarget.value }) }} /></label>
      <label data-paimind-agent-field>{zh ? '角色' : 'Role'}<textarea value={draft.role} maxLength={2000} onChange={event => { setDraft({ ...draft, role: event.currentTarget.value }) }} /></label>
      <label data-paimind-agent-field>{zh ? '目标' : 'Goal'}<textarea value={draft.goal} maxLength={2000} onChange={event => { setDraft({ ...draft, goal: event.currentTarget.value }) }} /></label>
      <label data-paimind-agent-field data-wide="true">{zh ? '行为规范' : 'Behavior'}<textarea value={draft.behavior} maxLength={4000} onChange={event => { setDraft({ ...draft, behavior: event.currentTarget.value }) }} /></label>
      <fieldset data-paimind-agent-field data-wide="true" disabled={draft.basePresetId === 'minimal'}><legend>{zh ? '首选已安装技能' : 'Preferred installed Skills'}</legend><div data-paimind-agent-skills>{draft.basePresetId === 'minimal' ? <span>{zh ? '极简模式不加载技能，请选择标准模式或 PTC 模式。' : 'Minimal mode does not load Skills. Choose Standard or PTC.'}</span> : skillNames.length === 0 ? <span>{zh ? '暂无已安装技能' : 'No installed Skills'}</span> : skillNames.map(name => <label key={name} data-paimind-agent-skill><input type="checkbox" checked={draft.preferredSkillNames.includes(name)} onChange={event => { setDraft({ ...draft, preferredSkillNames: event.currentTarget.checked ? [...draft.preferredSkillNames, name] : draft.preferredSkillNames.filter(value => value !== name) }) }} />{name}</label>)}</div></fieldset>
      <label data-paimind-agent-field data-wide="true">{zh ? '自然语言补充要求' : 'Additional instructions'}<textarea value={draft.instructions} maxLength={4000} onChange={event => { setDraft({ ...draft, instructions: event.currentTarget.value }) }} /></label>
    </div><div data-paimind-agent-actions><button type="button" data-paimind-agent-button data-primary="true" disabled={busy} onClick={() => { void save() }}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存' : 'Save')}</button><button type="button" data-paimind-agent-button disabled={busy} onClick={() => { setDraft(null) }}>{zh ? '取消' : 'Cancel'}</button></div></section>}
    {error !== null && <p role="alert" data-paimind-agent-error>{error}</p>}
    <input data-paimind-agent-search type="search" aria-label={zh ? '搜索智能体' : 'Search Agents'} placeholder={zh ? '搜索名称或说明' : 'Search name or description'} value={query} onChange={event => { setQuery(event.currentTarget.value) }} />
    {roster.status === 'loading' && <div data-paimind-agent-status aria-busy="true">{zh ? '正在读取智能体…' : 'Reading Agents…'}</div>}
    {roster.status === 'error' && <div data-paimind-agent-status role="alert">{roster.error}</div>}
    {roster.status === 'ready' && tab === 'platform' && (platform.length === 0 ? <div data-paimind-agent-status>{zh ? '没有匹配的平台智能体。' : 'No matching platform Agents.'}</div> : <ul data-paimind-agent-grid>{platform.map(preset => <li key={preset.id} data-paimind-agent-card data-broken={preset.broken !== undefined}><h3>{preset.name ?? (zh ? '平台智能体' : 'Platform Agent')}</h3><p>{preset.description ?? (zh ? '平台提供的通用能力模板。' : 'A platform-provided capability template.')}</p><div data-paimind-agent-badges><span data-paimind-agent-badge>{zh ? '平台提供' : 'Platform'}</span>{preset.isDefault && <span data-paimind-agent-badge data-success="true">{zh ? '默认' : 'Default'}</span>}</div>{preset.broken !== undefined && <p role="alert">{zh ? '当前不可用' : 'Unavailable'}</p>}<div data-paimind-agent-actions><button type="button" data-paimind-agent-button data-primary="true" disabled={busy || preset.broken !== undefined} onClick={() => { void start(preset) }}>{zh ? '开始对话' : 'Start conversation'}</button></div></li>)}</ul>)}
    {roster.status === 'ready' && tab === 'mine' && (mine.length === 0 ? <div data-paimind-agent-status>{zh ? '还没有个人智能体。点击“创建智能体”开始配置。' : 'No personal Agents yet. Create one to get started.'}</div> : <ul data-paimind-agent-grid>{mine.map(profile => { const preset = roster.roster.presets.find(row => row.id === profile.presetId); const broken = preset === undefined || preset.broken !== undefined; return <li key={profile.agentId} data-paimind-agent-card data-broken={broken}><h3>{profile.name}</h3><p>{profile.description || profile.role}</p><div data-paimind-agent-badges><span data-paimind-agent-badge>{zh ? '个人' : 'Personal'}</span>{preset?.isDefault === true && <span data-paimind-agent-badge data-success="true">{zh ? '默认' : 'Default'}</span>}{broken && <span data-paimind-agent-badge>{zh ? '需修复' : 'Needs repair'}</span>}</div><div data-paimind-agent-actions><button type="button" data-paimind-agent-button data-primary="true" disabled={busy || broken} onClick={() => { if (preset !== undefined) void start(preset, profile) }}>{zh ? '开始对话' : 'Start conversation'}</button><button type="button" data-paimind-agent-button disabled={busy} onClick={() => { setDraft(editDraft(profile)) }}>{zh ? '编辑' : 'Edit'}</button><button type="button" data-paimind-agent-button disabled={busy || preset?.isDefault === true} onClick={() => { void setDefault(profile) }}>{zh ? '设为默认' : 'Set default'}</button><button type="button" data-paimind-agent-button data-danger="true" disabled={busy} onClick={() => { void remove(profile) }}>{zh ? '删除' : 'Delete'}</button></div></li> })}</ul>)}
  </section>
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
    const runtime = new AgentCenterRuntime(api, profiles, scope.sessions, scope.workspaces, scope.conversation)
    const presetSettings = installHarnessAgentPresetSettingsNavigation(scope.slots)
    scope.effect(installStyle, 'paimind-agent-market: style')
    scope.effect(() => () => { runtime.dispose() }, 'paimind-agent-market: runtime')
    scope.effect(() => () => { presetSettings.dispose() }, 'paimind-agent-market: native Preset navigation')
    contributePaimindExtension(scope.slots, {
      id: 'paimind:agent-market', packageName: '@paimind/agent-market', category: 'agents',
      nameZh: '智能体中心', nameEn: 'Agent Center',
      descriptionZh: '配置个人智能体并在真实 Harness 对话中运行。',
      descriptionEn: 'Configure personal Agents and run them in real Harness conversations.',
      surface: 'settings', maturity: 'available', order: 10,
    })
    scope.slots.inject('settings.section', () => scope.slots.register({
      name: 'settings.section', id: 'paimind-agent-center', order: 18,
      label: () => scope.locale.getLocale().active.startsWith('zh') ? '智能体中心' : 'Agent Center',
    }, (owner: HarnessSettingsSectionOwnerProps) => <AgentCenterBoundary><AgentCenterSection {...owner} api={api} profiles={profiles} skills={skills} runtime={runtime} locale={scope.locale} openAdvanced={() => presetSettings.open()} /></AgentCenterBoundary>))
  }, 'paimind-agent-market: Settings section')
  try { await mounted } catch (error) {
    await disposeAgentRemote()
    throw error
  }
  return async () => {
    await mounted.dispose()
    await disposeAgentRemote()
  }
}
