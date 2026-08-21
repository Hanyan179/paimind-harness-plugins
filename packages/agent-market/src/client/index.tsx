import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
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
  type HarnessSessionAuthoringApi,
  type HarnessSessionService,
  type HarnessWorkspaceService,
  type PaimindClientContext,
  type PaimindLocaleSource,
} from '@paimind/harness-compat'
import {
  PaimindAgentIcon,
  PaimindCheckIcon,
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
  PaimindWarningIcon,
} from '@paimind/harness-compat/client-icons'
import {
  PaimindAgentBuilderRequestController,
  PaimindProductSurfaceController,
  installPaimindProductCenterHost,
  installPaimindProductSurfaceInteraction,
  resolvePaimindProductCenterHost,
  setPaimindProductCenterNativeConversation,
  type PaimindAgentBuilderRequestSnapshot,
  type PaimindProductCenterHost,
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
import { AGENT_AUTHORING_PROPOSAL_TOOL, AGENT_AUTHORING_SESSION_PREFIX } from '@paimind/agent-builder/client-contract'
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
  sealAuthoringSession(input: { readonly sessionId: string }): Promise<HarnessRemoteResult<Readonly<{
    readonly sessionId: string
    readonly agentPreset: 'cordis'
    readonly sealed: true
  }>>>
  prepareAuthoringTurn(input: {
    readonly sessionId: string
    readonly draft: AgentAuthoringDraftContext
    readonly skills: readonly { readonly name: string; readonly description: string }[]
    readonly locale: string
  }): Promise<HarnessRemoteResult<Readonly<{ readonly sessionId: string; readonly prepared: true }>>>
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
  get(name: 'connection'): { readonly api: {
    readonly agentPresets: HarnessAgentPresetApi
    readonly sessions: HarnessSessionAuthoringApi
  } }
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

async function boundedAuthoringRpc<Value>(
  label: string,
  deadline: number,
  maximumMs: number,
  call: (signal: AbortSignal) => Promise<Value>,
): Promise<Value> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error(`${label}超时`)
  const controller = new AbortController()
  let expired = false
  const timer = setTimeout(() => {
    expired = true
    controller.abort(new Error(`${label}超时`))
  }, Math.max(1, Math.min(remaining, maximumMs)))
  try {
    return await call(controller.signal)
  } catch (error) {
    if (expired) throw new Error(`${label}超时`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function boundedAuthoringPromise<Value>(
  label: string,
  deadline: number,
  maximumMs: number,
  call: () => Promise<Value>,
): Promise<Value> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error(`${label}超时`)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      call(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error(`${label}超时`)) }, Math.max(1, Math.min(remaining, maximumMs)))
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export interface AgentAuthoringDraftContext {
  readonly productKind: 'personal' | 'business'
  readonly businessCategory: string
  readonly name: string
  readonly description: string
  readonly basePresetId: string
  readonly role: string
  readonly goal: string
  readonly behavior: string
  readonly instructions: string
  readonly preferredSkillNames: readonly string[]
}

export interface AgentAuthoringProposal {
  readonly businessCategory?: string
  readonly name?: string
  readonly description?: string
  readonly role?: string
  readonly goal?: string
  readonly behavior?: string
  readonly instructions?: string
  readonly preferredSkillNames?: readonly string[]
}

export interface AgentAuthoringTurnResult {
  readonly sessionId: string
  readonly turn: number
  readonly endSeq: number
  readonly text: string
  readonly proposal: AgentAuthoringProposal | null
}

export interface AgentAuthoringWatchCallbacks {
  readonly onRunning?: () => void
  readonly onIdle?: () => void
  readonly onTurn: (result: Readonly<AgentAuthoringTurnResult>) => void | Promise<void>
  readonly onError: (error: Error) => void
}

const AUTHORING_PROPOSAL_STRING_LIMITS = Object.freeze({
  businessCategory: 80,
  name: 80,
  description: 500,
  role: 2_000,
  goal: 2_000,
  behavior: 4_000,
  instructions: 4_000,
} as const)
const AUTHORING_PROPOSAL_FIELDS = new Set<string>([
  ...Object.keys(AUTHORING_PROPOSAL_STRING_LIMITS),
  'preferredSkillNames',
])
const AUTHORING_PROPOSAL_CONTROL = /[\u0000-\u001f\u007f]/g

function assistantTextFromHistoryEvent(event: { readonly type: string; readonly data?: unknown }): string {
  if (event.type !== 'assistant/message' || typeof event.data !== 'object' || event.data === null) return ''
  const data = event.data as { readonly message?: { readonly content?: unknown } }
  if (!Array.isArray(data.message?.content)) return ''
  return data.message.content
    .filter((block): block is { readonly type: 'text'; readonly text: string } => (
      typeof block === 'object' && block !== null &&
      (block as { readonly type?: unknown }).type === 'text' &&
      typeof (block as { readonly text?: unknown }).text === 'string'
    ))
    .map(block => block.text)
    .join('\n')
    .trim()
}

function parseAuthoringProposalArguments(
  payload: string,
  installedSkills: readonly { readonly name: string }[],
): Readonly<AgentAuthoringProposal> {
  let parsed: unknown
  try { parsed = JSON.parse(payload) } catch { throw new Error('Harness cordis 返回的说明书提案不是有效 JSON') }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Harness cordis 返回的说明书提案必须是 JSON 对象')
  const record = parsed as Readonly<Record<string, unknown>>
  const unknown = Object.keys(record).filter(key => !AUTHORING_PROPOSAL_FIELDS.has(key))
  if (unknown.length > 0) throw new Error(`Harness cordis 返回了不允许修改的字段：${unknown.join('、')}`)
  const proposal: Record<string, string | readonly string[]> = {}
  for (const [field, limit] of Object.entries(AUTHORING_PROPOSAL_STRING_LIMITS)) {
    const value = record[field]
    if (value === undefined) continue
    if (typeof value !== 'string') throw new Error(`Harness cordis 返回的 ${field} 字段类型无效`)
    const normalized = value.replace(AUTHORING_PROPOSAL_CONTROL, ' ').trim()
    if (normalized.length > limit) throw new Error(`Harness cordis 返回的 ${field} 字段过长`)
    proposal[field] = normalized
  }
  if (record.preferredSkillNames !== undefined) {
    if (!Array.isArray(record.preferredSkillNames) || record.preferredSkillNames.length > 40
      || !record.preferredSkillNames.every(value => typeof value === 'string')) {
      throw new Error('Harness cordis 返回的 preferredSkillNames 字段类型无效')
    }
    const installed = new Set(installedSkills.map(skill => skill.name))
    const requested = record.preferredSkillNames as string[]
    const unknownSkills = requested.filter(name => name !== name.trim() || name === '' || !installed.has(name))
    if (unknownSkills.length > 0) throw new Error(`Harness cordis 返回了未安装或非精确名称的 Skill：${unknownSkills.join('、')}`)
    if (new Set(requested).size !== requested.length) throw new Error('Harness cordis 返回了重复的 Skill')
    proposal.preferredSkillNames = Object.freeze([...requested])
  }
  return Object.freeze(proposal) as Readonly<AgentAuthoringProposal>
}

function historySeq(event: { readonly seq?: number }): number { return typeof event.seq === 'number' ? event.seq : -1 }

function turnEndReason(event: { readonly type: string; readonly data?: unknown }): string | null {
  if (event.type !== 'turn/end' || typeof event.data !== 'object' || event.data === null) return null
  const reason = (event.data as { readonly reason?: { readonly kind?: unknown } }).reason?.kind
  return typeof reason === 'string' ? reason : null
}

function historyTurn(event: { readonly type: string; readonly data?: unknown }, type: 'turn/start' | 'turn/end'): number | null {
  if (event.type !== type || typeof event.data !== 'object' || event.data === null) return null
  const turn = (event.data as { readonly turn?: unknown }).turn
  return typeof turn === 'number' && Number.isInteger(turn) ? turn : null
}

function authoringPromptRpcId(event: { readonly type: string; readonly data?: unknown }): string | null {
  if (event.type !== 'user/message' || typeof event.data !== 'object' || event.data === null) return null
  const source = (event.data as { readonly source?: { readonly kind?: unknown; readonly rpcId?: unknown } }).source
  return source?.kind === 'user' && typeof source.rpcId === 'string' ? source.rpcId : null
}

function authoringInboxMessageId(
  event: { readonly type: string; readonly data?: unknown },
  rpcId: string,
): string | null {
  if (event.type !== 'agent/inbox/spliced' || typeof event.data !== 'object' || event.data === null) return null
  const inserted = (event.data as { readonly inserted?: unknown }).inserted
  if (!Array.isArray(inserted)) return null
  for (const candidate of inserted) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const message = candidate as {
      readonly id?: unknown
      readonly source?: { readonly kind?: unknown; readonly rpcId?: unknown }
    }
    if (message.source?.kind === 'user' && message.source.rpcId === rpcId && typeof message.id === 'string') return message.id
  }
  return null
}

function assistantTurn(event: { readonly type: string; readonly data?: unknown }): number | null {
  if (event.type !== 'assistant/message' || typeof event.data !== 'object' || event.data === null) return null
  const turn = (event.data as { readonly turn?: unknown }).turn
  return typeof turn === 'number' && Number.isInteger(turn) ? turn : null
}

interface CorrelatedAuthoringProposal {
  readonly proposal: Readonly<AgentAuthoringProposal>
  readonly resultSeq: number
}

/** Extract one successful native Proposal Tool call/result pair from the exact completed Turn. */
function correlatedAuthoringProposal(
  events: readonly { readonly type: string; readonly seq?: number; readonly data?: unknown }[],
  turn: number,
  afterSeq: number,
  beforeSeq: number,
  installedSkills: readonly { readonly name: string }[],
): CorrelatedAuthoringProposal {
  const window = events.filter(event => historySeq(event) > afterSeq && historySeq(event) < beforeSeq)
  const calls = window.filter(event => {
    if (event.type !== 'tool/call' || typeof event.data !== 'object' || event.data === null) return false
    return (event.data as { readonly turn?: unknown }).turn === turn
  })
  const unexpected = calls.filter(event => (
    (event.data as { readonly name?: unknown }).name !== AGENT_AUTHORING_PROPOSAL_TOOL
  ))
  if (unexpected.length > 0) throw new Error('Harness cordis 创建轮次调用了未授权工具')
  if (calls.length !== 1) {
    throw new Error(calls.length === 0
      ? 'Harness cordis 创建轮次没有提交原生说明书提案'
      : 'Harness cordis 创建轮次提交了多份原生说明书提案')
  }
  const call = calls[0]
  if (call === undefined) throw new Error('Harness cordis 创建轮次没有提交原生说明书提案')
  const callData = call.data as {
    readonly callId?: unknown
    readonly arguments?: unknown
  }
  if (typeof callData.callId !== 'string' || typeof callData.arguments !== 'string') {
    throw new Error('Harness cordis 原生说明书提案调用缺少关联字段')
  }
  const results = window.filter(event => {
    if (event.type !== 'tool/result' || historySeq(event) <= historySeq(call) || typeof event.data !== 'object' || event.data === null) return false
    const data = event.data as {
      readonly turn?: unknown
      readonly message?: {
        readonly source?: { readonly kind?: unknown; readonly callId?: unknown }
        readonly content?: unknown
      }
    }
    return data.turn === turn && data.message?.source?.kind === 'tool' && data.message.source.callId === callData.callId
  })
  if (results.length !== 1) throw new Error('Harness cordis 原生说明书提案结果无法唯一关联')
  const result = results[0]
  if (result === undefined) throw new Error('Harness cordis 原生说明书提案结果无法唯一关联')
  const resultData = result.data as {
    readonly error?: unknown
    readonly message?: { readonly content?: unknown }
  }
  const resultBlocks = resultData.message?.content
  const resultBlock = Array.isArray(resultBlocks) ? resultBlocks.find(block => (
    typeof block === 'object' && block !== null
    && (block as { readonly type?: unknown }).type === 'tool-result'
    && (block as { readonly toolCallId?: unknown }).toolCallId === callData.callId
  )) as { readonly isError?: unknown } | undefined : undefined
  if (resultData.error !== undefined || resultBlock === undefined || resultBlock.isError === true) {
    throw new Error('Harness cordis 原生说明书提案未被 Host 接受')
  }
  return Object.freeze({
    proposal: parseAuthoringProposalArguments(callData.arguments, installedSkills),
    resultSeq: historySeq(result),
  })
}

function correlateAuthoringTurn(
  events: readonly { readonly type: string; readonly seq?: number; readonly data?: unknown }[],
  rpcId: string,
): { readonly turn: number; readonly userSeq: number } | null {
  let openTurn: number | null = null
  for (const event of [...events].sort((left, right) => historySeq(left) - historySeq(right))) {
    const started = historyTurn(event, 'turn/start')
    if (started !== null) openTurn = started
    if (authoringPromptRpcId(event) === rpcId) {
      const userSeq = historySeq(event)
      if (openTurn === null || userSeq < 0) throw new Error('Harness cordis 创建消息缺少原生 Turn 边界')
      return Object.freeze({ turn: openTurn, userSeq })
    }
    const ended = historyTurn(event, 'turn/end')
    if (ended !== null && ended === openTurn) openTurn = null
  }
  return null
}

function hasAuthoringTurnCollision(
  events: readonly { readonly type: string; readonly seq?: number; readonly data?: unknown }[],
  target: { readonly turn: number; readonly userSeq: number },
  rpcId: string,
): boolean {
  let openTurn: number | null = null
  for (const event of [...events].sort((left, right) => historySeq(left) - historySeq(right))) {
    const started = historyTurn(event, 'turn/start')
    if (started !== null) openTurn = started
    if (openTurn === target.turn && event.type === 'user/message') {
      const otherRpcId = authoringPromptRpcId(event)
      if (otherRpcId !== null && otherRpcId !== rpcId) return true
    }
    const ended = historyTurn(event, 'turn/end')
    if (ended !== null && ended === openTurn) openTurn = null
  }
  return false
}

function turnEndFailure(event: { readonly type: string; readonly data?: unknown }): string {
  const reason = turnEndReason(event) ?? 'unknown'
  if (reason !== 'error' || typeof event.data !== 'object' || event.data === null) return reason
  const message = (event.data as { readonly reason?: { readonly error?: { readonly message?: unknown } } }).reason?.error?.message
  return typeof message === 'string' && message.trim() !== '' ? `${reason}: ${message.trim()}` : reason
}

function visibleAuthoringPartial(blocks: readonly { readonly kind: string; readonly text?: string }[]): string {
  return blocks
    .filter((block): block is { readonly kind: 'text'; readonly text: string } => block.kind === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}

interface AgentAuthoringProposalToolRowProps {
  readonly block: {
    readonly kind?: string
    readonly isError?: boolean
    readonly error?: { readonly code?: string }
  }
  readonly locale: PaimindLocaleSource
}

/** Compact native Tool row; deliberately never reads or renders proposal arguments or result content. */
function AgentAuthoringProposalToolRow({ block, locale }: AgentAuthoringProposalToolRowProps): React.JSX.Element {
  const activeLocale = useSyncExternalStore(
    locale.subscribe.bind(locale),
    () => locale.getLocale().active,
    () => locale.getLocale().active,
  )
  const zh = activeLocale.startsWith('zh')
  const settled = block.kind === 'tool-result'
  const failed = settled && block.isError === true
  const label = !settled
    ? (zh ? '正在生成配置提案' : 'Generating configuration proposal')
    : failed
      ? (zh ? '配置提案生成失败' : 'Configuration proposal failed')
      : (zh ? '已生成待确认配置提案' : 'Configuration proposal ready for review')
  return (
    <div
      role="status"
      data-paimind-agent-proposal-tool-row
      data-state={!settled ? 'running' : failed ? 'error' : 'ok'}
      aria-label={label}
    >
      <span aria-hidden="true">{failed ? <PaimindWarningIcon size={14} /> : <PaimindCheckIcon size={14} />}</span>
      <span>{label}</span>
    </div>
  )
}

/** Derive one intentional first-turn CTA from the saved Agent brief. */
export function starterPromptForProfile(profile: AgentBusinessProfile | undefined): string {
  if (profile === undefined) return ''
  const trigger = /when the user says\s*[“"'‘]([^”"'’]{1,160})[”"'’]/i.exec(profile.instructions)?.[1]?.trim()
  return trigger ?? ''
}

async function waitForBlankSession(sessions: HarnessSessionService, workspaces: HarnessWorkspaceService, timeoutMs = 10_000): Promise<string> {
  const before = sessions.list.getSnapshot()
  const previous = before.current
  if (previous !== undefined && before.byId[previous]?.blank === true) return previous
  const workspaceSnapshot = workspaces.list.getSnapshot()
  const workspaceId = workspaceSnapshot.items.find(item => previous !== undefined && item.sessionIds.includes(previous))?.workspaceId
    ?? workspaceSnapshot.recentWorkspaceId
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
    workspaces.startSession(workspaceId)
    inspect()
  })
}

async function createProjectedNativeSession(
  sessions: HarnessSessionService,
  workspaces: HarnessWorkspaceService,
  sessionId?: string,
): Promise<string> {
  if (sessions.create === undefined) throw new Error('当前 Harness 版本未提供可投影的原生会话创建能力')
  const workspaceSnapshot = workspaces.list.getSnapshot()
  const currentSessionId = sessions.list.getSnapshot().current
  const workspaceId = workspaceSnapshot.items.find(item => currentSessionId !== undefined && item.sessionIds.includes(currentSessionId))?.workspaceId
    ?? workspaceSnapshot.recentWorkspaceId
  const createdSessionId = await sessions.create({
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(sessionId === undefined ? {} : { sessionId }),
  })
  sessions.open(createdSessionId)
  return createdSessionId
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

const authoringTurnBusySessions = new WeakMap<object, Set<string>>()
const authoringContextQueues = new WeakMap<object, Map<string, Promise<void>>>()

function busyAuthoringSessions(runtime: object): Set<string> {
  const existing = authoringTurnBusySessions.get(runtime)
  if (existing !== undefined) return existing
  const created = new Set<string>()
  authoringTurnBusySessions.set(runtime, created)
  return created
}

function queuedAuthoringContexts(runtime: object): Map<string, Promise<void>> {
  const existing = authoringContextQueues.get(runtime)
  if (existing !== undefined) return existing
  const created = new Map<string, Promise<void>>()
  authoringContextQueues.set(runtime, created)
  return created
}

export class AgentCenterRuntime {
  private disposed = false
  private authoringTurnBusy = false
  private authoringContextQueue: Promise<void> = Promise.resolve()
  private readonly busySessions = new Set<string>()
  private readonly offSessions: () => void
  private notice: string | null = null
  private error: string | null = null
  private snapshot: { readonly notice: string | null; readonly error: string | null } = Object.freeze({ notice: null, error: null })
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly seat: HarnessAgentPresetSeatControl | null | (() => HarnessAgentPresetSeatControl | null),
    private readonly remote: AgentProfilesRemoteNamespace,
    private readonly sessions: HarnessSessionService,
    private readonly workspaces: HarnessWorkspaceService,
    private readonly conversation: HarnessConversationDraftService,
    private readonly authoringApi?: HarnessSessionAuthoringApi,
  ) {
    this.offSessions = sessions.list.subscribe(() => { void this.inspectCurrentSession() })
    void this.inspectCurrentSession()
  }

  getSnapshot = (): { readonly notice: string | null; readonly error: string | null } => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  async start(presetId: string, profile?: AgentBusinessProfile): Promise<string> {
    this.error = null; this.publish()
    const sessionId = await waitForBlankSession(this.sessions, this.workspaces)
    await selectPresetInNativeSeat(this.seatControl(), this.sessions, sessionId, presetId)
    if (profile !== undefined) {
      remoteValue(await this.remote.bindSession({ sessionId, agentId: profile.agentId, presetId, configVersion: profile.configVersion }))
      this.watchFirstRun(sessionId)
    }
    const binding = this.sessions.binding?.(sessionId)
    if (binding?.ctx === undefined) throw new Error('真实对话尚未就绪')
    this.conversation.input.for(binding.ctx).setDraft(starterPromptForProfile(profile))
    this.sessions.open(sessionId)
    return sessionId
  }

  /** Run one saved Profile revision in a real Harness Session for Builder QA. */
  async test(presetId: string, profile: AgentBusinessProfile, prompt: string): Promise<string> {
    const sessionId = await this.beginTest(presetId, profile)
    const binding = this.sessions.binding?.(sessionId)
    if (binding?.session.prompt === undefined) throw new Error('真实测试对话尚未就绪')
    const accepted = await binding.session.prompt([{ type: 'text', text: prompt }], 'queue')
    if (!accepted.ok) throw new Error(accepted.error.message)
    return sessionId
  }

  /** Prepare a saved Preset in a native blank Session; its native composer owns every test turn. */
  async beginTest(presetId: string, profile: AgentBusinessProfile): Promise<string> {
    this.error = null; this.publish()
    const sessionId = await createProjectedNativeSession(this.sessions, this.workspaces)
    await selectPresetInNativeSeat(this.seatControl(), this.sessions, sessionId, presetId)
    remoteValue(await this.remote.bindSession({
      sessionId,
      agentId: profile.agentId,
      presetId,
      configVersion: profile.configVersion,
    }))
    this.watchFirstRun(sessionId)
    return sessionId
  }

  /**
   * Create an empty native cordis Session for editing an existing Profile.
   * The first visible user message is still submitted by Harness's own
   * Conversation composer; authoring context never becomes a fake user bubble.
   */
  async beginAuthoring(input: {
    readonly draft: AgentAuthoringDraftContext
    readonly skills: readonly { readonly name: string; readonly description: string }[]
    readonly locale: string
  }): Promise<Readonly<{ readonly sessionId: string; readonly endSeq: number }>> {
    const api = this.authoringApi
    if (api === undefined) throw new Error('当前 Harness 版本未提供真实智能体创建会话')
    const deadline = Date.now() + 30_000
    const requestedSessionId = `${AGENT_AUTHORING_SESSION_PREFIX}${crypto.randomUUID()}`
    const sessionId = await boundedAuthoringPromise(
      '创建可投影的 Harness 会话', deadline, 15_000,
      async () => await createProjectedNativeSession(this.sessions, this.workspaces, requestedSessionId),
    )
    if (sessionId !== requestedSessionId) throw new Error('Harness 未保留创建助手的指定会话标识')
    await boundedAuthoringPromise(
      '绑定 Harness cordis 身份', deadline, 10_000,
      async () => { await selectPresetInNativeSeat(this.seatControl(), this.sessions, sessionId, 'cordis') },
    )
    const sealed = remoteValue(await boundedAuthoringPromise(
      '封锁 Harness 创建会话工具', deadline, 10_000,
      async () => await this.remote.sealAuthoringSession({ sessionId }),
    ))
    if (sealed.sessionId !== sessionId || sealed.agentPreset !== 'cordis' || !sealed.sealed) {
      throw new Error('Harness cordis 创建会话未完成原生工具封锁')
    }
    const prepared = remoteValue(await boundedAuthoringPromise(
      '准备 Harness 创建上下文', deadline, 10_000,
      async () => await this.remote.prepareAuthoringTurn({
        sessionId,
        draft: input.draft,
        skills: input.skills,
        locale: input.locale,
      }),
    ))
    if (prepared.sessionId !== sessionId || !prepared.prepared) throw new Error('Harness cordis 创建上下文未就绪')
    const prefix = input.locale.startsWith('zh') ? '智能体配置' : 'Agent authoring'
    const subject = input.draft.name.trim() || input.draft.description.trim() || (input.locale.startsWith('zh') ? '智能体' : 'Agent')
    await boundedAuthoringRpc('命名 Harness 创建会话', deadline, 5_000, async signal => (
      await api.rename({ sessionId, title: `${prefix} · ${subject}`.slice(0, 80) }, signal)
    )).catch(() => undefined)
    const history = remoteValue((await boundedAuthoringRpc('读取 Harness 创建会话', deadline, 8_000, async signal => (
      await api.history({ sessionId, maxMessages: 20 }, signal)
    ))).result)
    return Object.freeze({
      sessionId,
      endSeq: history.events.reduce((latest, entry) => Math.max(latest, historySeq(entry.event)), -1),
    })
  }

  /** Run the embedded configuration chat as a real, native cordis Session. */
  async author(input: {
    readonly sessionId: string | null
    readonly draft: AgentAuthoringDraftContext
    readonly prompt: string
    readonly skills: readonly { readonly name: string; readonly description: string }[]
    readonly locale: string
    readonly onSessionCreated?: (sessionId: string) => void
    readonly onSessionInvalidated?: () => void
    readonly onProgress?: (visibleText: string) => void
  }): Promise<Readonly<AgentAuthoringTurnResult>> {
    let disposeProgress: () => void = () => {}
    const api = this.authoringApi
    const deadline = Date.now() + 180_000
    let sessionId = input.sessionId
    let baselineSeq = -1
    let expectedTurn: number | null = null
    let targetUserSeq = -1
    let targetRpcId: string | null = null
    let targetMessageId: string | null = null
    let submittedPromptText = ''
    let promptIssued = false
    let promptAccepted = false
    let turnSettled = false
    let sessionContaminated = false
    let progressAttached = false
    let publishProgress = (): void => {}
    let busySessionId: string | null = null
    const busySessions = busyAuthoringSessions(this)
    const acquireSession = (candidate: string): void => {
      if (busySessions.has(candidate)) {
        throw new Error('这个 Harness cordis 创建会话仍在处理上一条消息')
      }
      busySessions.add(candidate)
      this.authoringTurnBusy = true
      busySessionId = candidate
    }
    if (sessionId !== null) acquireSession(sessionId)
    const requireSessionId = (): string => {
      if (sessionId === null) throw new Error('Harness cordis 创建会话尚未就绪')
      return sessionId
    }
    const history = async (maximumMs = 10_000, beforeSeq?: number, operationDeadline = deadline) => {
      if (api === undefined || sessionId === null) throw new Error('当前 Harness 版本未提供真实智能体创建会话')
      return remoteValue((await boundedAuthoringRpc('读取 Harness 创建会话', operationDeadline, maximumMs, async signal => (
        await api.history({ sessionId: requireSessionId(), maxMessages: 20, ...(beforeSeq === undefined ? {} : { beforeSeq }) }, signal)
      ))).result)
    }
    const historyForTarget = async (maximumMs = 10_000, operationDeadline = deadline) => {
      const tail = await history(maximumMs, undefined, operationDeadline)
      const collected = [...tail.events]
      let hasMore = tail.hasMore
      const rpcId = targetRpcId
      while (
        rpcId !== null
        && !collected.some(entry => authoringPromptRpcId(entry.event) === rpcId || authoringInboxMessageId(entry.event, rpcId) !== null)
        && hasMore
      ) {
        const beforeSeq = collected.reduce((earliest, entry) => Math.min(earliest, historySeq(entry.event)), Number.POSITIVE_INFINITY)
        if (!Number.isFinite(beforeSeq) || beforeSeq <= baselineSeq + 1) break
        const page = await history(maximumMs, beforeSeq, operationDeadline)
        const known = new Set(collected.map(entry => historySeq(entry.event)))
        collected.push(...page.events.filter(entry => !known.has(historySeq(entry.event))))
        hasMore = page.hasMore
      }
      return Object.freeze({
        events: Object.freeze(collected.sort((left, right) => historySeq(left.event) - historySeq(right.event))),
        hasMore,
      })
    }
    const attachProgress = (): void => {
      if (progressAttached || input.onProgress === undefined || sessionId === null) return
      const observable = this.sessions.binding?.(sessionId)?.session
      if (observable === undefined) return
      const publish = (): void => {
        if (expectedTurn === null) return
        const partial = observable.getSnapshot().partial
        if (partial?.turn !== expectedTurn) return
        input.onProgress?.(visibleAuthoringPartial(partial.blocks))
      }
      publishProgress = publish
      disposeProgress = observable.subscribe(publish)
      progressAttached = true
      publish()
    }
    const cancelAndSettle = async (): Promise<boolean> => {
      if (!promptIssued || api === undefined || sessionId === null) return !sessionContaminated
      if (turnSettled) {
        if (sessionContaminated) input.onSessionInvalidated?.()
        return !sessionContaminated
      }
      const settlementDeadline = Date.now() + 15_000
      if (!promptAccepted || targetRpcId === null) {
        await boundedAuthoringRpc('取消不确定的 Harness 创建轮次', settlementDeadline, 5_000, async signal => (
          await api.cancel({ sessionId: requireSessionId() }, signal)
        )).catch(() => undefined)
        input.onSessionInvalidated?.()
        return false
      }
      const rpcId = targetRpcId
      let cancelSent = false
      while (Date.now() < settlementDeadline) {
        try {
          const snapshot = await historyForTarget(3_000, settlementDeadline)
          const events = snapshot.events.map(entry => entry.event).filter(event => historySeq(event) > baselineSeq)
          targetMessageId ??= events.map(event => authoringInboxMessageId(event, rpcId)).find(id => id !== null) ?? null
          const correlated = correlateAuthoringTurn(events, rpcId)
          if (correlated !== null) {
            expectedTurn = correlated.turn
            targetUserSeq = correlated.userSeq
          }
          if (expectedTurn !== null && events.some(event => historyTurn(event, 'turn/end') === expectedTurn)) {
            turnSettled = true
            if (sessionContaminated) input.onSessionInvalidated?.()
            return !sessionContaminated
          }
          if (expectedTurn !== null && !cancelSent) {
            cancelSent = true
            await boundedAuthoringRpc('取消 Harness 创建轮次', settlementDeadline, 5_000, async signal => (
              await api.cancel({ sessionId: requireSessionId() }, signal)
            )).catch(() => undefined)
          }
        } catch {
          if (expectedTurn !== null && !cancelSent) {
            cancelSent = true
            await boundedAuthoringRpc('取消 Harness 创建轮次', settlementDeadline, 5_000, async signal => (
              await api.cancel({ sessionId: requireSessionId() }, signal)
            )).catch(() => undefined)
          }
        }
        if (expectedTurn === null) {
          const queueBinding = this.sessions.binding?.(requireSessionId())?.session
          if (targetMessageId !== null && queueBinding !== undefined && queueBinding.updateQueue !== undefined) {
            const removed = await queueBinding.updateQueue(targetMessageId, { kind: 'remove' }).catch(() => undefined)
            if (removed?.ok === true) { turnSettled = true; return true }
          }
        }
        await new Promise(resolve => { setTimeout(resolve, 250) })
      }
      input.onSessionInvalidated?.()
      return false
    }
    try {
      if (api === undefined) throw new Error('当前 Harness 版本未提供真实智能体创建会话')
      if (sessionId === null) {
        if (this.sessions.create === undefined) {
          const workspaces = this.workspaces.list.getSnapshot()
          const currentSessionId = this.sessions.list.getSnapshot().current
          const workspaceId = workspaces.items.find(item => currentSessionId !== undefined && item.sessionIds.includes(currentSessionId))?.workspaceId
            ?? workspaces.recentWorkspaceId
          const requestedSessionId = `${AGENT_AUTHORING_SESSION_PREFIX}${crypto.randomUUID()}`
          const created = remoteValue((await boundedAuthoringRpc('创建 Harness cordis 会话', deadline, 15_000, async signal => (
            await api.create({ sessionId: requestedSessionId, agentPreset: 'cordis', ...(workspaceId === undefined ? {} : { workspaceId }) }, signal)
          ))).result)
          if (created.sessionId !== requestedSessionId || created.agentPreset !== 'cordis') throw new Error('真实创建会话未使用指定的 Harness cordis 身份')
          sessionId = created.sessionId
        } else {
          const requestedSessionId = `${AGENT_AUTHORING_SESSION_PREFIX}${crypto.randomUUID()}`
          sessionId = await boundedAuthoringPromise(
            '创建可投影的 Harness 会话', deadline, 15_000,
            async () => await createProjectedNativeSession(this.sessions, this.workspaces, requestedSessionId),
          )
          if (sessionId !== requestedSessionId) throw new Error('Harness 未保留创建助手的指定会话标识')
          await boundedAuthoringPromise(
            '绑定 Harness cordis 身份', deadline, 10_000,
            async () => { await selectPresetInNativeSeat(this.seatControl(), this.sessions, requireSessionId(), 'cordis') },
          )
        }
        acquireSession(requireSessionId())
        input.onSessionCreated?.(requireSessionId())
      }
      const sealed = remoteValue(await boundedAuthoringPromise(
        '封锁 Harness 创建会话工具', deadline, 10_000,
        async () => await this.remote.sealAuthoringSession({ sessionId: requireSessionId() }),
      ))
      if (sealed.sessionId !== sessionId || sealed.agentPreset !== 'cordis' || !sealed.sealed) {
        throw new Error('Harness cordis 创建会话未完成原生工具封锁')
      }
      const prepared = remoteValue(await boundedAuthoringPromise(
        '准备 Harness 创建上下文', deadline, 10_000,
        async () => await this.remote.prepareAuthoringTurn({
          sessionId: requireSessionId(), draft: input.draft, skills: input.skills, locale: input.locale,
        }),
      ))
      if (prepared.sessionId !== sessionId || !prepared.prepared) throw new Error('Harness cordis 创建上下文未就绪')
      if (input.sessionId === null) {
        const prefix = input.locale.startsWith('zh') ? '智能体配置' : 'Agent authoring'
        const subject = input.draft.name.trim() || input.draft.description.trim() || (input.locale.startsWith('zh') ? '新智能体' : 'New Agent')
        await boundedAuthoringRpc('命名 Harness 创建会话', deadline, 5_000, async signal => (
          await api.rename({ sessionId: requireSessionId(), title: `${prefix} · ${subject}`.slice(0, 80) }, signal)
        )).catch(() => undefined)
      }

      const before = await history()
      baselineSeq = before.events.reduce((latest, entry) => Math.max(latest, historySeq(entry.event)), -1)
      submittedPromptText = input.prompt.trim().slice(0, 4_000)
      input.onProgress?.('')
      attachProgress()
      promptIssued = true
      const promptResponse = await boundedAuthoringRpc('提交 Harness 创建消息', deadline, 15_000, async signal => await api.prompt({
        sessionId: requireSessionId(),
        mode: 'queue',
        content: [{ type: 'text', text: submittedPromptText }],
      }, signal))
      if (typeof promptResponse.rpcId !== 'string' || promptResponse.rpcId.trim() === '') throw new Error('Harness 创建消息未返回原生 rpcId')
      targetRpcId = promptResponse.rpcId
      const accepted = remoteValue(promptResponse.result)
      if (!accepted.accepted) throw new Error('真实创建会话未接受配置消息')
      promptAccepted = true

      while (Date.now() < deadline) {
        if (this.disposed) throw new Error('智能体中心已关闭')
        attachProgress()
        const latest = await historyForTarget()
        const events = latest.events.map(entry => entry.event).filter(event => historySeq(event) > baselineSeq)
        const rpcId = targetRpcId
        if (rpcId === null) throw new Error('Harness 创建消息缺少原生 rpcId')
        targetMessageId ??= events.map(event => authoringInboxMessageId(event, rpcId)).find(id => id !== null) ?? null
        if (expectedTurn === null) {
          const correlated = correlateAuthoringTurn(events, rpcId)
          if (correlated !== null) {
            expectedTurn = correlated.turn
            targetUserSeq = correlated.userSeq
            attachProgress()
            publishProgress()
          }
        }
        if (expectedTurn !== null && hasAuthoringTurnCollision(events, { turn: expectedTurn, userSeq: targetUserSeq }, rpcId)) {
          sessionContaminated = true
          throw new Error('Harness cordis 创建轮次混入了另一条用户消息，已作废本轮提案')
        }
        const completedTurn = expectedTurn
        const ended = completedTurn === null ? undefined : events.find(event => historyTurn(event, 'turn/end') === completedTurn)
        if (ended !== undefined && completedTurn !== null) {
          turnSettled = true
          const reason = turnEndReason(ended)
          if (reason !== 'completed') throw new Error(`Harness cordis 创建轮次未正常完成：${turnEndFailure(ended)}`)
          const endSeq = historySeq(ended)
          const correlatedProposal = correlatedAuthoringProposal(
            events, completedTurn, targetUserSeq, endSeq, input.skills,
          )
          const text = [...events]
            .filter(event => assistantTurn(event) === completedTurn
              && historySeq(event) > correlatedProposal.resultSeq
              && historySeq(event) < endSeq)
            .reverse().map(assistantTextFromHistoryEvent).find(value => value !== '') ?? ''
          if (text === '') throw new Error('Harness cordis 已结束，但没有返回可见回复')
          return Object.freeze({
            sessionId: requireSessionId(), turn: completedTurn, endSeq,
            text, proposal: correlatedProposal.proposal,
          })
        }
        await new Promise(resolve => { setTimeout(resolve, 500) })
      }
      throw new Error('Harness cordis 创建助手响应超时')
    } catch (error) {
      const reusable = await cancelAndSettle()
      if (!reusable) throw new Error(`${messageOf(error)}；原会话未确认结束，下一次将创建新的 cordis 会话`)
      throw error
    } finally {
      disposeProgress()
      if (busySessionId !== null) busySessions.delete(busySessionId)
      this.authoringTurnBusy = busySessions.size > 0
    }
  }

  async prepareAuthoringContext(input: {
    readonly sessionId: string
    readonly draft: AgentAuthoringDraftContext
    readonly skills: readonly { readonly name: string; readonly description: string }[]
    readonly locale: string
  }): Promise<void> {
    const queues = queuedAuthoringContexts(this)
    const previous = queues.get(input.sessionId) ?? Promise.resolve()
    const queued = previous.then(async () => {
      const prepared = remoteValue(await this.remote.prepareAuthoringTurn(input))
      if (prepared.sessionId !== input.sessionId || !prepared.prepared) throw new Error('Harness cordis 创建上下文未就绪')
    })
    const tail = queued.catch(() => undefined)
    queues.set(input.sessionId, tail)
    this.authoringContextQueue = tail
    try {
      await queued
    } finally {
      if (queues.get(input.sessionId) === tail) queues.delete(input.sessionId)
      if (this.authoringContextQueue === tail) this.authoringContextQueue = Promise.resolve()
    }
  }

  /**
   * Observe turns submitted by the existing native Conversation composer. The
   * cursor starts after the programmatic opening turn, so one durable turn is
   * projected into the form exactly once without owning a second transcript.
   */
  watchAuthoringSession(
    sessionId: string,
    afterSeq: number,
    skills: readonly { readonly name: string }[],
    callbacks: AgentAuthoringWatchCallbacks,
  ): () => void {
    const api = this.authoringApi
    const binding = this.sessions.binding?.(sessionId)
    if (api === undefined || binding === undefined) {
      callbacks.onError(new Error('当前 Harness 版本未提供原生创建对话观察能力'))
      return () => {}
    }
    let cursor = afterSeq
    let disposed = false
    let inspecting = false
    let queued = false
    let settleTimer: ReturnType<typeof setTimeout> | undefined

    const inspect = async (): Promise<void> => {
      if (disposed || inspecting) { queued = true; return }
      const snapshot = binding.session.getSnapshot()
      if (snapshot.running) { callbacks.onRunning?.(); return }
      inspecting = true
      try {
        const deadline = Date.now() + 15_000
        const tail = remoteValue((await boundedAuthoringRpc('读取原生创建对话', deadline, 8_000, async signal => (
          await api.history({ sessionId, maxMessages: 20 }, signal)
        ))).result)
        const collected = [...tail.events]
        let hasMore = tail.hasMore
        while (hasMore && collected.every(entry => historySeq(entry.event) > cursor)) {
          const beforeSeq = collected.reduce((earliest, entry) => Math.min(earliest, historySeq(entry.event)), Number.POSITIVE_INFINITY)
          if (!Number.isFinite(beforeSeq)) break
          const page = remoteValue((await boundedAuthoringRpc('读取较早创建对话', deadline, 8_000, async signal => (
            await api.history({ sessionId, maxMessages: 20, beforeSeq }, signal)
          ))).result)
          const known = new Set(collected.map(entry => historySeq(entry.event)))
          collected.push(...page.events.filter(entry => !known.has(historySeq(entry.event))))
          hasMore = page.hasMore
        }
        const events = collected.map(entry => entry.event).sort((left, right) => historySeq(left) - historySeq(right))
        const completed = events.filter(event => event.type === 'turn/end' && historySeq(event) > cursor)
        for (const ended of completed) {
          const turn = historyTurn(ended, 'turn/end')
          const endSeq = historySeq(ended)
          if (turn === null || endSeq < 0) continue
          const started = [...events].reverse().find(event => historyTurn(event, 'turn/start') === turn && historySeq(event) < endSeq)
          const startSeq = started === undefined ? cursor : historySeq(started)
          const hasHumanMessage = events.some(event => (
            event.type === 'user/message'
            && historySeq(event) > startSeq
            && historySeq(event) < endSeq
            && typeof event.data === 'object'
            && event.data !== null
            && (event.data as { readonly source?: { readonly kind?: unknown } }).source?.kind === 'user'
          ))
          cursor = endSeq
          if (!hasHumanMessage) continue
          const reason = turnEndReason(ended)
          if (reason !== 'completed') throw new Error(`Harness cordis 创建轮次未正常完成：${turnEndFailure(ended)}`)
          const correlatedProposal = correlatedAuthoringProposal(events, turn, startSeq, endSeq, skills)
          const text = [...events]
            .filter(event => assistantTurn(event) === turn
              && historySeq(event) > correlatedProposal.resultSeq
              && historySeq(event) < endSeq)
            .reverse().map(assistantTextFromHistoryEvent).find(value => value !== '') ?? ''
          if (text === '') throw new Error('Harness cordis 已结束，但没有返回可见回复')
          await callbacks.onTurn(Object.freeze({
            sessionId, turn, endSeq, text,
            proposal: correlatedProposal.proposal,
          }))
        }
        callbacks.onIdle?.()
      } catch (error) {
        callbacks.onError(error instanceof Error ? error : new Error(String(error)))
      } finally {
        inspecting = false
        if (queued && !disposed) { queued = false; void inspect() }
      }
    }
    const schedule = (): void => {
      if (disposed) return
      const snapshot = binding.session.getSnapshot()
      if (snapshot.running) {
        if (settleTimer !== undefined) clearTimeout(settleTimer)
        settleTimer = undefined
        callbacks.onRunning?.()
        return
      }
      if (settleTimer !== undefined) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => { settleTimer = undefined; void inspect() }, 250)
    }
    const off = binding.session.subscribe(schedule)
    schedule()
    return () => {
      disposed = true
      if (settleTimer !== undefined) clearTimeout(settleTimer)
      off()
    }
  }

  sessionState(sessionId: string): { readonly running: boolean; readonly completed: boolean; readonly error: string | null } {
    const row = this.sessions.list.getSnapshot().byId[sessionId]
    const snapshot = this.sessions.binding?.(sessionId)?.session.getSnapshot()
    return Object.freeze({
      running: row?.running === true || snapshot?.running === true,
      completed: row?.completed === true || ((snapshot?.chat?.timeline.turnOrder.length ?? 0) > 0 && snapshot?.running === false),
      error: snapshot?.lastAgentError ?? null,
    })
  }

  subscribeSessions(listener: () => void): () => void { return this.sessions.list.subscribe(listener) }

  currentSessionId(): string | null { return this.sessions.list.getSnapshot().current ?? null }

  openSession(sessionId: string): () => void {
    if (this.sessions.list.getSnapshot().byId[sessionId] !== undefined) {
      this.sessions.open(sessionId)
      return () => {}
    }
    let active = true
    let dispose = (): void => {}
    let timeout: ReturnType<typeof setTimeout> | undefined
    const stopWaiting = (): void => {
      if (!active) return
      active = false
      dispose()
      if (timeout !== undefined) clearTimeout(timeout)
    }
    const openWhenReady = (): void => {
      if (!active || this.sessions.list.getSnapshot().byId[sessionId] === undefined) return
      stopWaiting()
      this.sessions.open(sessionId)
    }
    dispose = this.sessions.list.subscribe(openWhenReady)
    timeout = setTimeout(stopWaiting, 10_000)
    openWhenReady()
    return stopWaiting
  }

  dispose(): void {
    this.disposed = true
    authoringTurnBusySessions.delete(this)
    authoringContextQueues.delete(this)
    this.authoringTurnBusy = false
    this.authoringContextQueue = Promise.resolve()
    this.offSessions()
    this.listeners.clear()
  }

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
      await selectPresetInNativeSeat(this.seatControl(), this.sessions, targetSessionId, plan.presetId)
      const binding = this.sessions.binding?.(targetSessionId)
      if (binding?.session.prompt === undefined) throw new Error('新版对话尚未就绪')
      this.watchFirstRun(targetSessionId)
      const accepted = await binding.session.prompt([{ type: 'text', text: plan.summary }], 'queue')
      if (!accepted.ok) throw new Error(accepted.error.message)
      remoteValue(await this.remote.recordMigration({ ...plan, targetSessionId }))
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
      const hasTurn = (snapshot.chat?.timeline.turnOrder.length ?? 0) > 0
      if (snapshot.running) {
        ran = true
        if (settleTimer !== undefined) clearTimeout(settleTimer)
        settleTimer = undefined
      }
      if (!ran && hasTurn && !snapshot.running) ran = true
      if (!ran || snapshot.running || !hasTurn) return
      if (settleTimer !== undefined) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => { settleTimer = undefined; verify() }, 750)
    }
    off = binding.session.subscribe(inspect)
    inspect()
  }

  private seatControl(): HarnessAgentPresetSeatControl | null {
    return typeof this.seat === 'function' ? this.seat() : this.seat
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

interface PendingDraftUpdate {
  readonly previous: Draft
  readonly changed: readonly string[]
}

const IDLE_BUILDER_REQUEST: PaimindAgentBuilderRequestSnapshot = Object.freeze({ revision: 0, productKind: 'personal' })
const subscribeNever = (): (() => void) => () => {}
const idleBuilderRequest = (): PaimindAgentBuilderRequestSnapshot => IDLE_BUILDER_REQUEST

function draftSignature(draft: Draft): string {
  return JSON.stringify({
    productKind: draft.productKind,
    businessCategory: draft.businessCategory,
    businessCategoryId: draft.businessCategoryId,
    name: draft.name,
    description: draft.description,
    basePresetId: draft.basePresetId,
    role: draft.role,
    goal: draft.goal,
    behavior: draft.behavior,
    preferredSkillNames: [...draft.preferredSkillNames].sort(),
    instructions: draft.instructions,
  })
}

function authoringDraftContext(draft: Draft): AgentAuthoringDraftContext {
  return Object.freeze({
    productKind: draft.productKind,
    businessCategory: draft.businessCategory,
    name: draft.name,
    description: draft.description,
    basePresetId: draft.basePresetId,
    role: draft.role,
    goal: draft.goal,
    behavior: draft.behavior,
    instructions: draft.instructions,
    preferredSkillNames: draft.preferredSkillNames,
  })
}

function applyAuthoringProposal(
  draft: Draft,
  proposal: AgentAuthoringProposal | null,
  installedSkills: readonly Readonly<SkillInstallRecord>[],
  businessCategories: readonly { readonly id: string; readonly labelZh: string; readonly labelEn: string }[],
  zh: boolean,
): {
  readonly draft: Draft
  readonly changed: readonly string[]
} {
  if (proposal === null) return { draft, changed: [] }
  let next = draft
  const changed: string[] = []
  const assign = <Key extends keyof Pick<Draft, 'businessCategory' | 'name' | 'description' | 'role' | 'goal' | 'behavior' | 'instructions'>>(
    field: Key, value: string | undefined, label: string, maxLength: number, allowEmpty = false,
  ): void => {
    if (value === undefined) return
    const normalized = value.trim().slice(0, maxLength)
    if ((!allowEmpty && normalized === '') || next[field] === normalized) return
    next = { ...next, [field]: normalized }
    changed.push(label)
  }
  if (draft.productKind === 'business' && proposal.businessCategory !== undefined) {
    const businessCategory = proposal.businessCategory.trim().slice(0, 80)
    if (businessCategory !== '' && businessCategory !== next.businessCategory) {
      const normalized = businessCategory.toLocaleLowerCase()
      const matched = businessCategories.find(category => category.labelZh.toLocaleLowerCase() === normalized || category.labelEn.toLocaleLowerCase() === normalized)
      next = { ...next, businessCategory, businessCategoryId: matched?.id ?? null }
      changed.push(zh ? '业务分类' : 'Business category')
    }
  }
  assign('name', proposal.name, zh ? '名称' : 'Name', 80)
  assign('description', proposal.description, zh ? '用途说明' : 'Purpose', 500)
  assign('role', proposal.role, zh ? '角色' : 'Role', 2_000)
  assign('goal', proposal.goal, zh ? '目标' : 'Goal', 2_000)
  assign('behavior', proposal.behavior, zh ? '行为规范' : 'Behavior', 4_000)
  assign('instructions', proposal.instructions, zh ? '补充要求' : 'Instructions', 4_000, true)
  if (proposal.preferredSkillNames !== undefined) {
    const installed = new Set(installedSkills.map(skill => skill.name))
    const preferredSkillNames = draft.basePresetId === 'minimal' ? [] : [...new Set(proposal.preferredSkillNames
      .map(name => name.trim())
      .filter(name => installed.has(name)))]
    if (JSON.stringify(preferredSkillNames) !== JSON.stringify(next.preferredSkillNames)) {
      next = { ...next, preferredSkillNames }
      changed.push(zh ? '会话技能' : 'Session Skills')
    }
  }
  return { draft: next, changed }
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

function platformPresetPresentation(preset: HarnessAgentPresetEntry, zh: boolean): { readonly name: string; readonly description: string } {
  if (preset.id === 'cordis') return {
    name: zh ? '个人智能体创建助手' : 'Personal Agent creation assistant',
    description: zh
      ? '使用 Harness 原生创造模式，引导你创建和配置个人智能体。'
      : 'Use the native Harness Creator mode to create and configure a personal Agent.',
  }
  return {
    name: preset.name ?? (zh ? '平台智能体' : 'Platform Agent'),
    description: preset.description ?? (zh ? '平台提供的真实能力模板。' : 'A real platform-provided capability template.'),
  }
}

function privatePresetId(name: string, roster: HarnessAgentPresetRoster): string {
  const ascii = name.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28)
  const base = ascii === '' ? 'my-agent' : ascii
  let value = `${base}-${crypto.randomUUID().slice(0, 6)}`
  while (roster.presets.some(row => row.id === value)) value = `${base}-${crypto.randomUUID().slice(0, 6)}`
  return value
}

export interface AgentCenterSectionProps {
  /** Pass false only when the Center intentionally navigated to a new native Session. */
  readonly close: (restorePreviousSession?: boolean) => void
  readonly api: HarnessAgentPresetApi
  readonly profiles: AgentProfilesRemoteNamespace
  readonly skills: InstalledSkillsRemoteNamespace
  readonly runtime: AgentCenterRuntime
  readonly locale: PaimindLocaleSource
  readonly openAdvanced: () => boolean
  readonly builderRequests?: PaimindAgentBuilderRequestController
  readonly onNativeConversationChange?: (state: Readonly<{
    readonly sessionId: string | null
    readonly interactive: boolean
  }>) => void
}

export function AgentCenterSection(props: AgentCenterSectionProps): React.JSX.Element {
  const activeLocale = useSyncExternalStore(props.locale.subscribe.bind(props.locale), () => props.locale.getLocale().active, () => props.locale.getLocale().active)
  const runtimeState = useSyncExternalStore(props.runtime.subscribe, props.runtime.getSnapshot, props.runtime.getSnapshot)
  const builderRequest = useSyncExternalStore(
    props.builderRequests?.subscribe ?? subscribeNever,
    props.builderRequests?.getSnapshot ?? idleBuilderRequest,
    props.builderRequests?.getSnapshot ?? idleBuilderRequest,
  )
  const zh = activeLocale.startsWith('zh')
  const [tab, setTab] = useState<'platform' | 'mine'>('mine')
  const [platformView, setPlatformView] = useState<'modes' | 'business'>('modes')
  const [businessCategory, setBusinessCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [roster, setRoster] = useState<RosterState>({ status: 'loading', roster: null, error: null })
  const [profileRows, setProfileRows] = useState<readonly AgentBusinessProfile[]>([])
  const [installedSkills, setInstalledSkills] = useState<readonly Readonly<SkillInstallRecord>[]>([])
  const [skillQuery, setSkillQuery] = useState('')
  const [skillCategory, setSkillCategory] = useState<SkillProductCategoryFilter>('all')
  const [selectedSkillsOnly, setSelectedSkillsOnly] = useState(false)
  const [starterDraft, setStarterDraft] = useState<Draft | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [authoringSessionId, setAuthoringSessionId] = useState<string | null>(null)
  const [authoringCursor, setAuthoringCursor] = useState<number | null>(null)
  const [authoringContextReady, setAuthoringContextReady] = useState(false)
  const [authoringStatus, setAuthoringStatus] = useState<'idle' | 'running' | 'error'>('idle')
  const [builderTab, setBuilderTab] = useState<'configure' | 'test'>('configure')
  const [skillPickerOpen, setSkillPickerOpen] = useState(false)
  const [pendingUpdate, setPendingUpdate] = useState<PendingDraftUpdate | null>(null)
  const [savedSignature, setSavedSignature] = useState<string | null>(null)
  const [savedProfile, setSavedProfile] = useState<AgentBusinessProfile | null>(null)
  const [testSessionId, setTestSessionId] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<'idle' | 'starting' | 'ready' | 'error'>('idle')
  const handledBuilderRequest = useRef(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const builderRef = useRef<HTMLElement>(null)
  const starterRef = useRef<HTMLElement>(null)
  const starterPurposeRef = useRef<HTMLTextAreaElement>(null)
  const builderTriggerRef = useRef<HTMLElement | null>(null)
  const busyRef = useRef(false)
  const draftRef = useRef<Draft | null>(null)
  const nativeTurnSourceSignature = useRef<string | null>(null)
  const nativeTurnRunning = useRef(false)
  const contextSyncRevision = useRef(0)
  const lastPreparedSignature = useRef<string | null>(null)
  const builderOpen = draft !== null
  const onNativeConversationChange = props.onNativeConversationChange

  useEffect(() => { busyRef.current = busy }, [busy])
  useEffect(() => { draftRef.current = draft }, [draft])

  useEffect(() => {
    if (starterDraft === null) return
    starterPurposeRef.current?.focus()
    const dialog = starterRef.current
    if (dialog === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        if (!busyRef.current) {
          setStarterDraft(null)
          window.setTimeout(() => { builderTriggerRef.current?.focus() }, 0)
        }
        return
      }
      if (event.key !== 'Tab') return
      const nodes = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')]
      const first = nodes[0]; const last = nodes.at(-1)
      if (first === undefined || last === undefined) return
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    dialog.addEventListener('keydown', onKeyDown)
    return () => { dialog.removeEventListener('keydown', onKeyDown) }
  }, [starterDraft])

  useEffect(() => {
    if (!builderOpen) return
    const builder = builderRef.current
    if (builder === null) return
    const center = builder.closest<HTMLElement>('[data-paimind-agent-center]')
    if (center !== null) center.scrollTop = 0
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!busyRef.current) {
        setDraft(null)
        window.setTimeout(() => { builderTriggerRef.current?.focus() }, 0)
      }
    }
    builder.ownerDocument.addEventListener('keydown', onKeyDown)
    return () => { builder.ownerDocument.removeEventListener('keydown', onKeyDown) }
  }, [builderOpen])

  const openBuilder = (nextDraft: Draft, preserveTrigger = false): void => {
    if (!preserveTrigger) builderTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setError(null)
    setAuthoringSessionId(null)
    setAuthoringCursor(null)
    setAuthoringContextReady(false)
    nativeTurnRunning.current = false
    nativeTurnSourceSignature.current = null
    lastPreparedSignature.current = null
    setAuthoringStatus('idle')
    setBuilderTab('configure')
    setSkillPickerOpen(false)
    setPendingUpdate(null)
    setSavedProfile(nextDraft.editing)
    setSavedSignature(nextDraft.editing === null ? null : draftSignature(nextDraft))
    setTestSessionId(null)
    setTestStatus('idle')
    setDraft(nextDraft)
  }
  const openStarter = (nextDraft: Draft): void => {
    builderTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setError(null); setStarterDraft(nextDraft)
  }
  const closeStarter = (): void => {
    setStarterDraft(null)
    window.setTimeout(() => { builderTriggerRef.current?.focus() }, 0)
  }
  const runAuthoringTurn = async (sourceDraft: Draft, text: string, sessionId: string | null): Promise<void> => {
    const prompt = text.trim()
    if (prompt === '' || busyRef.current) return
    const sourceSignature = draftSignature(sourceDraft)
    busyRef.current = true
    setError(null)
    setAuthoringStatus('running')
    setAuthoringContextReady(false)
    setBusy(true)
    let retainedSessionId = sessionId
    try {
      const result = await props.runtime.author({
        sessionId,
        draft: authoringDraftContext(sourceDraft),
        prompt,
        skills: installedSkills.map(skill => ({ name: skill.name, description: skill.description })),
        locale: activeLocale,
        onSessionCreated: createdSessionId => {
          retainedSessionId = createdSessionId
          setAuthoringSessionId(createdSessionId)
          setAuthoringContextReady(false)
        },
        onSessionInvalidated: () => {
          retainedSessionId = null
          setAuthoringSessionId(null)
          setAuthoringCursor(null)
          setAuthoringContextReady(false)
        },
      })
      setAuthoringSessionId(result.sessionId)
      setAuthoringCursor(result.endSeq)
      const current = draftRef.current
      let changed: readonly string[] = []
      if (current !== null && draftSignature(current) === sourceSignature) {
        const refined = applyAuthoringProposal(current, result.proposal, installedSkills, businessCategories, zh)
        changed = refined.changed
        if (changed.length > 0) {
          setPendingUpdate({ previous: current, changed })
          setDraft(refined.draft)
          setAuthoringContextReady(false)
        }
      } else if (result.proposal !== null) {
        setError(zh
          ? '模型回复已收到，但说明书在思考期间被手动修改，因此没有自动覆盖。请重新发送调整要求。'
          : 'The model replied, but the brief changed while it was thinking, so no fields were overwritten. Send the request again.')
      }
      setAuthoringStatus('idle')
      if (changed.length === 0) setAuthoringContextReady(true)
    } catch (cause) {
      setAuthoringStatus('error')
      setAuthoringContextReady(false)
      setError(zh
        ? `真实创建助手调用失败：${messageOf(cause)}${retainedSessionId === null ? '' : '。已创建的 Harness 会话仍显示在右侧，草稿没有丢失。'}`
        : `Real creation assistant failed: ${messageOf(cause)}${retainedSessionId === null ? '' : '. The created Harness Session remains visible on the right and the draft is preserved.'}`)
    } finally { busyRef.current = false; setBusy(false) }
  }
  const continueStarter = (): void => {
    if (starterDraft === null) return
    if (creatorPreset === undefined || creatorPreset.broken !== undefined) {
      setError(zh ? 'Harness cordis 创建助手当前不可用，无法生成真实 AI 说明书。' : 'Harness cordis is unavailable, so a real AI brief cannot be generated.')
      return
    }
    const purpose = starterDraft.description.trim()
    if (purpose === '') { setError(zh ? '请先描述这个智能体要完成什么。' : 'Describe what this Agent should accomplish.'); return }
    const nextDraft = { ...starterDraft, name: starterDraft.name.trim(), description: purpose }
    setStarterDraft(null)
    openBuilder(nextDraft, true)
    void runAuthoringTurn(nextDraft, purpose, null)
  }
  const closeBuilder = (): void => {
    if (busyRef.current) return
    setDraft(null)
    setPendingUpdate(null)
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
    const presentation = platformPresetPresentation(row, zh)
    return [presentation.name, presentation.description, row.name ?? '', row.description ?? '', metadata.mode, metadata.category?.id ?? '', metadata.category?.labelZh ?? '', metadata.category?.labelEn ?? '']
      .some(value => value.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  }), [query, systemPresets, zh])
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
  const creatorPreset = roster.status === 'ready' ? roster.roster.presets.find(row => row.id === 'cordis' && row.trust === 'system') : undefined
  const currentSignature = draft === null ? null : draftSignature(draft)
  const draftDirty = draft !== null && currentSignature !== savedSignature
  const canTestDraft = draft !== null && !draftDirty && savedProfile !== null
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

  const applyNativeAuthoringResult = useCallback((
    result: Readonly<AgentAuthoringTurnResult>,
    sourceSignature: string,
  ): void => {
    setAuthoringCursor(result.endSeq)
    const current = draftRef.current
    if (current === null) return
    if (draftSignature(current) !== sourceSignature) {
      if (result.proposal !== null) setError(zh
        ? '模型回复已收到，但说明书在思考期间被手动修改，因此没有覆盖字段。请在右侧原生对话中重新发送要求。'
        : 'The model replied, but the brief changed while it was thinking, so no fields were overwritten. Send the request again in the native conversation.')
      return
    }
    const refined = applyAuthoringProposal(current, result.proposal, installedSkills, businessCategories, zh)
    if (refined.changed.length === 0) {
      setAuthoringContextReady(true)
      return
    }
    setPendingUpdate({ previous: current, changed: refined.changed })
    setDraft(refined.draft)
    setAuthoringContextReady(false)
  }, [businessCategories, installedSkills, zh])

  useEffect(() => {
    const sourceDraft = draftRef.current
    if (!builderOpen || builderTab !== 'configure' || sourceDraft === null
      || authoringSessionId !== null || authoringStatus !== 'idle') return
    let active = true
    const sourceSignature = draftSignature(sourceDraft)
    busyRef.current = true
    setBusy(true)
    setError(null)
    setAuthoringStatus('running')
    setAuthoringContextReady(false)
    const previousSessionId = props.runtime.currentSessionId()
    let projectedSession = false
    const stopProjectingSession = props.runtime.subscribeSessions(() => {
      if (!active || projectedSession) return
      const currentSessionId = props.runtime.currentSessionId()
      if (currentSessionId === null || currentSessionId === previousSessionId
        || !currentSessionId.startsWith(AGENT_AUTHORING_SESSION_PREFIX)) return
      projectedSession = true
      setAuthoringSessionId(currentSessionId)
    })
    void props.runtime.beginAuthoring({
      draft: authoringDraftContext(sourceDraft),
      skills: installedSkills.map(skill => ({ name: skill.name, description: skill.description })),
      locale: activeLocale,
    }).then(result => {
      if (!active) return
      setAuthoringSessionId(result.sessionId)
      setAuthoringCursor(result.endSeq)
      const current = draftRef.current
      const unchanged = current !== null && draftSignature(current) === sourceSignature
      lastPreparedSignature.current = unchanged ? sourceSignature : null
      setAuthoringContextReady(unchanged)
      setAuthoringStatus('idle')
      busyRef.current = false
      setBusy(false)
    }, cause => {
      if (!active) return
      setAuthoringStatus('error')
      setAuthoringContextReady(false)
      setError(zh ? `真实配置会话创建失败：${messageOf(cause)}` : `Could not create the native configuration conversation: ${messageOf(cause)}`)
      busyRef.current = false
      setBusy(false)
    })
    return () => { active = false; stopProjectingSession() }
  }, [activeLocale, builderOpen, builderTab, installedSkills, props.runtime, zh])

  useEffect(() => {
    if (!builderOpen || builderTab !== 'configure' || authoringSessionId === null || authoringCursor === null) return
    return props.runtime.watchAuthoringSession(
      authoringSessionId,
      authoringCursor,
      installedSkills.map(skill => ({ name: skill.name })),
      {
        onRunning: () => {
          if (!nativeTurnRunning.current) {
            const current = draftRef.current
            nativeTurnSourceSignature.current = current === null ? null : draftSignature(current)
            nativeTurnRunning.current = true
          }
          busyRef.current = true
          setBusy(true)
          setError(null)
          setAuthoringStatus('running')
          setAuthoringContextReady(false)
        },
        onTurn: result => {
          const current = draftRef.current
          const sourceSignature = nativeTurnSourceSignature.current ?? (current === null ? '' : draftSignature(current))
          applyNativeAuthoringResult(result, sourceSignature)
          nativeTurnRunning.current = false
          nativeTurnSourceSignature.current = null
        },
        onIdle: () => {
          nativeTurnRunning.current = false
          nativeTurnSourceSignature.current = null
          busyRef.current = false
          setBusy(false)
          setAuthoringStatus('idle')
        },
        onError: cause => {
          nativeTurnRunning.current = false
          nativeTurnSourceSignature.current = null
          busyRef.current = false
          setBusy(false)
          setAuthoringStatus('error')
          setAuthoringContextReady(false)
          setError(zh ? `原生创建对话同步失败：${cause.message}` : `Native authoring conversation sync failed: ${cause.message}`)
        },
      },
    )
  }, [applyNativeAuthoringResult, authoringCursor, authoringSessionId, builderOpen, builderTab, installedSkills, props.runtime, zh])

  useEffect(() => {
    if (!builderOpen || builderTab !== 'configure' || draft === null || authoringSessionId === null
      || authoringStatus !== 'idle' || pendingUpdate !== null) return
    const signature = draftSignature(draft)
    if (lastPreparedSignature.current === signature && authoringContextReady) return
    const syncRevision = contextSyncRevision.current + 1
    contextSyncRevision.current = syncRevision
    setAuthoringContextReady(false)
    void props.runtime.prepareAuthoringContext({
      sessionId: authoringSessionId,
      draft: authoringDraftContext(draft),
      skills: installedSkills.map(skill => ({ name: skill.name, description: skill.description })),
      locale: activeLocale,
    }).then(() => {
      if (contextSyncRevision.current !== syncRevision) return
      lastPreparedSignature.current = signature
      setAuthoringContextReady(true)
    }, cause => {
      if (contextSyncRevision.current !== syncRevision) return
      setAuthoringContextReady(false)
      setError(zh ? `创建上下文同步失败：${messageOf(cause)}` : `Authoring context sync failed: ${messageOf(cause)}`)
    })
  }, [activeLocale, authoringContextReady, authoringSessionId, authoringStatus, builderOpen, builderTab, draft, installedSkills, pendingUpdate, props.runtime, zh])

  useEffect(() => {
    if (!builderOpen) {
      onNativeConversationChange?.({ sessionId: null, interactive: false })
      return
    }
    if (builderTab === 'configure') {
      onNativeConversationChange?.({
        sessionId: authoringSessionId,
        interactive: !busy && authoringSessionId !== null && authoringStatus === 'idle' && pendingUpdate === null && authoringContextReady,
      })
      return
    }
    onNativeConversationChange?.({
      sessionId: canTestDraft ? testSessionId : null,
      interactive: !busy && canTestDraft && testSessionId !== null && testStatus === 'ready',
    })
  }, [authoringContextReady, authoringSessionId, authoringStatus, builderOpen, builderTab, busy, canTestDraft, onNativeConversationChange, pendingUpdate, testSessionId, testStatus])

  useEffect(() => () => {
    onNativeConversationChange?.({ sessionId: null, interactive: false })
  }, [onNativeConversationChange])

  useEffect(() => {
    if (builderRequest.revision === 0 || builderRequest.revision <= handledBuilderRequest.current || templates.length === 0) return
    handledBuilderRequest.current = builderRequest.revision
    const next = {
      ...emptyDraft(templates[0]!.id, builderRequest.productKind),
      ...(builderRequest.brief === undefined ? {} : { description: builderRequest.brief }),
    }
    if (builderRequest.productKind === 'business') { setTab('platform'); setPlatformView('business') } else setTab('mine')
    setSkillQuery(''); setSkillCategory('all'); setSelectedSkillsOnly(false)
    openStarter(next)
  }, [builderRequest, templates])

  const start = async (preset: HarnessAgentPresetEntry, profile?: AgentBusinessProfile): Promise<void> => {
    if (preset.broken !== undefined || busyRef.current) return
    busyRef.current = true
    setBusy(true); setError(null)
    try { await props.runtime.start(preset.id, profile); props.close(false) } catch (cause) { setError(messageOf(cause)) } finally { busyRef.current = false; setBusy(false) }
  }
  const save = async (): Promise<void> => {
    if (draft === null || roster.status !== 'ready' || busyRef.current) return
    if (pendingUpdate !== null) { setError(zh ? '请先保留或撤销创建助手的待确认更新。' : 'Keep or undo the pending creation-assistant update before saving.'); return }
    if (!roster.roster.authorable) { setError(zh ? '当前 Harness 环境未开放智能体创建权限。' : 'This Harness deployment does not allow Agent authoring.'); return }
    if (draft.name.trim() === '' || draft.role.trim() === '' || draft.goal.trim() === '' || draft.behavior.trim() === '') { setError(zh ? '请填写名称、角色、目标和行为规范。' : 'Complete name, role, goal, and behavior.'); return }
    if (draft.productKind === 'business' && draft.businessCategory.trim() === '') { setError(zh ? '请填写业务分类。' : 'Choose or create a business category.'); return }
    busyRef.current = true
    setBusy(true); setError(null)
    let createdPreset: string | null = null
    let committed = false
    try {
      const presetId = draft.editing?.presetId ?? privatePresetId(draft.name, roster.roster)
      if (draft.editing === null) {
        const copied = await props.api.copy({ from: draft.basePresetId, agentPreset: presetId, name: draft.name.trim() })
        if (!copied.result.ok) throw new Error(copied.result.error.message)
        if (copied.result.value.agentPreset !== presetId) throw new Error('Harness 返回的个人预设标识与请求不一致')
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
      committed = true
      const savedDraft = editDraft(profile)
      setDraft(savedDraft)
      setSavedProfile(profile)
      setSavedSignature(draftSignature(savedDraft))
      setTestSessionId(null)
      setTestStatus('idle')
      setPendingUpdate(null)
      setRevision(value => value + 1)
      if (draft.productKind === 'business') { setTab('platform'); setPlatformView('business') } else setTab('mine')
      try {
        const reread = await props.api.list({})
        if (!reread.result.ok) throw new Error(reread.result.error.message)
        const native = reread.result.value.presets.find(row => row.id === profile.presetId)
        if (native === undefined || native.broken !== undefined) throw new Error(native?.broken ?? '保存后未找到真实预设')
      } catch (verifyError) {
        setError(zh
          ? `配置已经保存，但原生预设回读验证失败：${messageOf(verifyError)}`
          : `The configuration was saved, but native Preset read-back failed: ${messageOf(verifyError)}`)
      }
    } catch (cause) {
      if (!committed && createdPreset !== null) await props.api.remove({ agentPreset: createdPreset }).catch(() => undefined)
      setError(messageOf(cause))
    } finally { busyRef.current = false; setBusy(false) }
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

  useEffect(() => {
    if (builderTab !== 'test' || !canTestDraft || savedProfile === null || testSessionId !== null || testStatus !== 'idle') return
    let active = true
    setTestStatus('starting')
    setError(null)
    void props.runtime.beginTest(savedProfile.presetId, savedProfile).then(sessionId => {
      if (!active) return
      setTestSessionId(sessionId)
      setTestStatus('ready')
    }, cause => {
      if (!active) return
      setTestStatus('error')
      setError(messageOf(cause))
    })
    return () => { active = false }
  }, [builderTab, canTestDraft, props.runtime, savedProfile, testSessionId])

  const createPersonalAgent = (): void => {
    setTab('mine')
    setSkillQuery(''); setSkillCategory('all'); setSelectedSkillsOnly(false)
    openStarter(emptyDraft(templates[0]?.id ?? 'standard'))
  }
  const createBusinessAgent = (): void => {
    setTab('platform'); setPlatformView('business')
    setSkillQuery(''); setSkillCategory('all'); setSelectedSkillsOnly(false)
    openStarter(emptyDraft(templates[0]?.id ?? 'standard', 'business'))
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
  const nativeConversationStatus = builderTab === 'configure'
    ? authoringStatus === 'error'
      ? { tone: 'error', title: zh ? '原生配置对话连接失败' : 'Native configuration conversation failed', detail: zh ? '说明书草稿仍保留；返回中心后重新进入即可重试。' : 'The brief is preserved. Return to the Center and reopen it to retry.' }
      : authoringSessionId === null || authoringStatus === 'running'
        ? { tone: 'busy', title: zh ? '正在连接 Harness 原生配置对话' : 'Connecting the native Harness configuration conversation', detail: zh ? '右侧会直接显示主对话的消息与输入区，不创建第二套聊天界面。' : 'The native message timeline and composer will appear on the right; no second chat UI is created.' }
        : pendingUpdate !== null
          ? { tone: 'warning', title: zh ? '请先确认本轮建议' : 'Confirm this proposal first', detail: zh ? '保留或撤销说明书更新后，右侧原生输入区会继续可用。' : 'Keep or undo the brief update to re-enable the native composer.' }
          : !authoringContextReady
            ? { tone: 'busy', title: zh ? '正在同步说明书上下文' : 'Syncing the brief context', detail: zh ? '同步完成后可直接在右侧主对话继续调整。' : 'Continue in the native conversation after synchronization completes.' }
            : { tone: 'ready', title: zh ? '右侧是 Harness 原生配置对话' : 'Harness native configuration conversation is on the right', detail: zh ? '消息历史、流式回复和输入区全部由主对话原生组件提供。' : 'The native Conversation owns history, streaming replies, and the composer.' }
    : !canTestDraft
      ? { tone: 'warning', title: zh ? '请先保存智能体配置' : 'Save the Agent configuration first', detail: zh ? '测试对话只运行已保存的同一个 Agent Preset，不会为未保存草稿创建副本。' : 'Test Chat runs the same saved Agent Preset; it never copies an unsaved draft.' }
      : testStatus === 'error'
        ? { tone: 'error', title: zh ? '原生测试对话创建失败' : 'Native test conversation failed', detail: zh ? '已保存配置保持不变；重新进入测试页即可重试。' : 'The saved configuration is unchanged. Reopen Test Chat to retry.' }
        : testSessionId === null || testStatus === 'starting'
          ? { tone: 'busy', title: zh ? '正在创建 Harness 原生测试对话' : 'Creating a native Harness test conversation', detail: zh ? '右侧就绪后，请使用主对话输入区直接测试。' : 'When the right side is ready, test directly in the native composer.' }
          : { tone: 'ready', title: zh ? '右侧是 Harness 原生测试对话' : 'Harness native test conversation is on the right', detail: zh ? '它运行刚刚保存的同一个 Agent Preset。' : 'It runs the exact Agent Preset revision you just saved.' }

  const managedProfileCard = (profile: AgentBusinessProfile): React.JSX.Element => {
    const preset = roster.status === 'ready' ? roster.roster.presets.find(row => row.id === profile.presetId) : undefined
    const basePreset = roster.status === 'ready' ? roster.roster.presets.find(row => row.id === profile.basePresetId) : undefined
    const runtimeMode = basePreset === undefined ? 'custom' : metadataForPreset(basePreset).mode
    const broken = preset === undefined || preset.broken !== undefined
    const business = profile.productKind === 'business'
    return <li key={profile.agentId} data-paimind-agent-card data-paimind-agent-id={profile.agentId} data-broken={broken} data-product-kind={business ? 'business' : 'personal'}>
      <div data-paimind-agent-card-head><span data-paimind-agent-card-icon data-paimind-agent-avatar-seat="" data-paimind-agent-id={profile.agentId} data-paimind-agent-avatar-kind={business ? 'business' : 'personal'} role="img" aria-label={zh ? `${profile.name} 头像` : `${profile.name} avatar`}><span data-paimind-agent-avatar-fallback="" aria-hidden="true">{business ? <PaimindAgentIcon size={23} /> : <PaimindUserIcon size={23} />}</span></span><div data-paimind-agent-card-title><h3>{profile.name}</h3><span data-paimind-agent-card-kicker>{business ? (zh ? '业务智能体 · 本地维护' : 'Business Agent · Locally managed') : (zh ? '个人智能体' : 'Personal Agent')}</span></div></div>
      <div data-paimind-agent-badges>{business && <span data-paimind-agent-badge data-category="true">{profile.businessCategory}</span>}<span data-paimind-agent-badge>{modeLabel(runtimeMode, zh)}</span><span data-paimind-agent-badge>{zh ? `第 ${profile.revision} 版` : `Revision ${profile.revision}`}</span>{preset?.isDefault === true && <span data-paimind-agent-badge data-success="true">{zh ? '默认' : 'Default'}</span>}{broken && <span data-paimind-agent-badge>{zh ? '需修复' : 'Needs repair'}</span>}</div>
      <p>{profile.description || profile.role}</p>
      <div data-paimind-agent-card-context><span><PaimindSkillIcon size={13} />{profile.preferredSkillNames.length === 0 ? (zh ? '未封装会话技能' : 'No packaged session Skills') : (zh ? `${profile.preferredSkillNames.length} 个会话技能` : `${profile.preferredSkillNames.length} session Skills`)}</span></div>
      {broken && <p role="alert" data-paimind-agent-card-alert>{zh ? '原生预设缺失或损坏，请编辑或前往高级配置修复。' : 'The native Preset is missing or damaged. Edit it or repair it in advanced configuration.'}</p>}
      <div data-paimind-agent-actions><button type="button" data-paimind-agent-button data-primary="true" disabled={busy || broken} onClick={() => { if (preset !== undefined) void start(preset, profile) }}><PaimindNewConversationIcon size={14} />{zh ? '开始对话' : 'Start conversation'}</button><button type="button" data-paimind-agent-button disabled={busy} onClick={() => { setSkillQuery(''); setSkillCategory('all'); setSelectedSkillsOnly(false); openBuilder(editDraft(profile)) }}><PaimindEditIcon size={14} />{zh ? '编辑' : 'Edit'}</button>{preset?.isDefault !== true && <button type="button" data-paimind-agent-button data-quiet="true" data-icon-only="true" aria-label={zh ? `将 ${profile.name} 设为默认` : `Set ${profile.name} as default`} title={zh ? '设为默认' : 'Set default'} disabled={busy} onClick={() => { void setDefault(profile) }}><PaimindCheckIcon size={14} /></button>}<button type="button" data-paimind-agent-button data-danger="true" data-icon-only="true" aria-label={`${zh ? '删除' : 'Delete'} ${profile.name}`} title={zh ? '删除' : 'Delete'} disabled={busy} onClick={() => { void remove(profile) }}><PaimindTrashIcon size={14} /></button></div>
    </li>
  }

  return <section data-paimind-agent-center aria-label={zh ? '智能体中心' : 'Agent Center'} aria-busy={busy}>
    <header data-paimind-agent-hero>
      <div>
        <p data-paimind-agent-eyebrow><PaimindAgentIcon size={15} />{zh ? '真实 Harness 智能体' : 'Live Harness Agents'}</p>
        <h1 id="paimind-agent-center-title" tabIndex={-1} data-paimind-product-initial-focus>{zh ? '智能体中心' : 'Agent Center'}</h1>
        <p data-paimind-agent-hero-copy>{zh ? '选择适合当前任务的智能体，然后直接开始对话。' : 'Choose the right Agent for the task, then start a conversation.'}</p>
      </div>
      <div data-paimind-agent-hero-actions>
        <div data-paimind-agent-search-row><div data-paimind-agent-search-wrap><span data-paimind-agent-search-icon><PaimindSearchIcon size={17} /></span><input data-paimind-agent-search type="search" aria-label={zh ? '搜索智能体' : 'Search Agents'} placeholder={zh ? '搜索名称、说明、角色或目标' : 'Search names, descriptions, roles, or goals'} value={query} onChange={event => { setQuery(event.currentTarget.value) }} /></div><button type="button" data-paimind-agent-button data-icon-only="true" aria-label={zh ? '返回对话' : 'Back to conversation'} onClick={() => { props.close() }}><PaimindCloseIcon size={16} /></button></div>
      </div>
    </header>

    <div data-paimind-agent-tabs-shell>
      <div role="tablist" aria-label={zh ? '智能体类型' : 'Agent types'} data-paimind-agent-tabs>
        <button role="tab" type="button" data-paimind-agent-tab aria-label={zh ? '平台模式' : 'Platform modes'} aria-selected={tab === 'platform' && platformView === 'modes'} onClick={() => { setTab('platform'); setPlatformView('modes'); setQuery('') }}><PaimindAgentIcon size={16} />{zh ? '平台模式' : 'Platform modes'}<span data-paimind-agent-count>{platformModeCount}</span></button>
        <button role="tab" type="button" data-paimind-agent-tab aria-label={zh ? '业务智能体' : 'Business Agents'} aria-selected={tab === 'platform' && platformView === 'business'} onClick={() => { setTab('platform'); setPlatformView('business'); setQuery('') }}><PaimindAgentIcon size={16} />{zh ? '业务智能体' : 'Business Agents'}<span data-paimind-agent-count>{businessAgentCount}</span></button>
        <button role="tab" type="button" data-paimind-agent-tab aria-label={zh ? '我的智能体' : 'My Agents'} aria-selected={tab === 'mine'} onClick={() => { setTab('mine'); setQuery('') }}><PaimindUserIcon size={16} />{zh ? '我的智能体' : 'My Agents'}<span data-paimind-agent-count>{personalProfiles.length}</span></button>
      </div>
      {tab === 'platform' && platformView === 'business' && businessCategories.length > 0 && <label data-paimind-agent-business-filter>{zh ? '业务分类' : 'Business category'}<select aria-label={zh ? '业务分类' : 'Business category'} value={businessCategory} onChange={event => { setBusinessCategory(event.currentTarget.value) }}><option value="all">{zh ? '全部业务分类' : 'All business categories'}</option>{businessCategories.map(category => <option key={category.id} value={category.id}>{businessCategoryLabel(category, zh)} · {category.count}</option>)}</select></label>}
      <div data-paimind-agent-hero-buttons>
        <button type="button" data-paimind-agent-button data-quiet="true" onClick={openAdvanced}><PaimindSettingsIcon size={15} />{zh ? '高级配置' : 'Advanced configuration'}</button>
        <button type="button" data-paimind-agent-button data-primary="true" onClick={primaryCreateBusiness ? createBusinessAgent : createPersonalAgent} disabled={busy || templates.length === 0}><PaimindPlusIcon size={15} />{primaryCreateBusiness ? (zh ? '创建业务智能体' : 'Create Business Agent') : (zh ? '创建个人智能体' : 'Create Personal Agent')}</button>
      </div>
    </div>

    {(runtimeState.notice !== null || runtimeState.error !== null) && <p data-paimind-agent-note role="status">{runtimeState.error ?? runtimeState.notice}</p>}
    {error !== null && <p role="alert" data-paimind-agent-error>{error}</p>}
    <div data-paimind-agent-section-head><div><h2 data-paimind-agent-visually-hidden>{tab === 'platform' ? (platformView === 'modes' ? (zh ? '选择工作模式' : 'Choose a working mode') : (zh ? '业务智能体' : 'Business Agents')) : (zh ? '我的智能体' : 'My Agents')}</h2><p>{tab === 'mine' ? (zh ? '为高频任务保存稳定角色、目标和会话技能。' : 'Save stable roles, goals, and session Skills for recurring work.') : platformView === 'business' ? (zh ? '按业务场景选择官方或本地维护的智能体。' : 'Choose an official or locally maintained Agent for a business scenario.') : (zh ? '平台模式决定对话的基础运行方式。' : 'Platform modes define the base conversation runtime.')}</p></div><div data-paimind-agent-section-actions><span data-paimind-agent-result-count aria-live="polite">{zh ? `${visibleCount} 个结果` : `${visibleCount} results`}</span></div></div>
    {roster.status === 'loading' && <div data-paimind-agent-loading-grid aria-busy="true" aria-label={zh ? '正在读取智能体' : 'Reading Agents'}>{[0, 1, 2, 3].map(index => <div key={index} data-paimind-agent-loading-card><span /><strong /><i /></div>)}</div>}
    {roster.status === 'error' && <div data-paimind-agent-status role="alert"><span data-paimind-agent-status-icon><PaimindSettingsIcon size={22} /></span><strong>{zh ? '智能体连接失败' : 'Agent connection failed'}</strong><p>{roster.error}</p><button type="button" data-paimind-agent-button onClick={() => { setRevision(value => value + 1) }}>{zh ? '重新加载' : 'Retry'}</button></div>}
    {roster.status === 'ready' && tab === 'platform' && (visibleCount === 0 ? <div data-paimind-agent-status><span data-paimind-agent-status-icon><PaimindSearchIcon size={22} /></span><strong>{query.trim() !== '' ? (zh ? '没有匹配结果' : 'No matching results') : platformView === 'business' ? (zh ? '暂无业务智能体' : 'No Business Agents yet') : (zh ? '暂无平台模式' : 'No platform modes yet')}</strong><p>{query.trim() !== '' ? (zh ? '试试更短的关键词，或清空搜索。' : 'Try a shorter search or clear the query.') : (zh ? '当前 Harness 还没有提供此类可用预设。' : 'The current Harness does not expose an available Preset in this category.')}</p>{query.trim() !== '' && <button type="button" data-paimind-agent-button onClick={() => { setQuery('') }}>{zh ? '清空搜索' : 'Clear search'}</button>}{query.trim() === '' && platformView === 'business' && <button type="button" data-paimind-agent-button data-primary="true" onClick={createBusinessAgent} disabled={templates.length === 0}><PaimindPlusIcon size={14} />{zh ? '创建业务智能体' : 'Create Business Agent'}</button>}</div> : <ul data-paimind-agent-grid>{platform.map(preset => { const metadata = metadataForPreset(preset); const presentation = platformPresetPresentation(preset, zh); return <li key={preset.id} data-paimind-agent-card data-paimind-agent-preset-id={preset.id} data-broken={preset.broken !== undefined}>
      <div data-paimind-agent-card-head><span data-paimind-agent-card-icon><PaimindAgentIcon size={23} /></span><div data-paimind-agent-card-title><h3>{presentation.name}</h3><span data-paimind-agent-card-kicker>{metadata.kind === 'platform-mode' ? (zh ? '平台模式' : 'Platform mode') : (zh ? '官方业务智能体' : 'Official Business Agent')}</span></div></div>
      <div data-paimind-agent-badges>{metadata.kind === 'business-agent' && metadata.category !== undefined && <span data-paimind-agent-badge data-category="true">{businessCategoryLabel(metadata.category, zh)}</span>}<span data-paimind-agent-badge>{modeLabel(metadata.mode, zh)}</span><span data-paimind-agent-badge>{zh ? '官方维护' : 'Official'}</span>{preset.isDefault && <span data-paimind-agent-badge data-success="true">{zh ? '默认' : 'Default'}</span>}{preset.broken !== undefined && <span data-paimind-agent-badge>{zh ? '需修复' : 'Needs repair'}</span>}</div>
      <p>{presentation.description}</p>
      {preset.broken !== undefined && <p role="alert">{zh ? `当前不可用：${preset.broken}` : `Unavailable: ${preset.broken}`}</p>}
      <div data-paimind-agent-actions>{preset.id === 'cordis' ? <><button type="button" data-paimind-agent-button data-primary="true" disabled={busy || preset.broken !== undefined || templates.length === 0} onClick={createPersonalAgent}><PaimindPlusIcon size={14} />{zh ? '创建个人智能体' : 'Create Personal Agent'}</button><button type="button" data-paimind-agent-button disabled={busy} onClick={openAdvanced}><PaimindSettingsIcon size={14} />{zh ? '管理预设' : 'Manage Presets'}</button></> : <><button type="button" data-paimind-agent-button data-primary="true" disabled={busy || preset.broken !== undefined} onClick={() => { void start(preset) }}><PaimindPlayIcon size={14} />{zh ? '开始对话' : 'Start conversation'}</button><button type="button" data-paimind-agent-button disabled={busy || preset.broken !== undefined} onClick={() => { copyPlatformAgent(preset) }}><PaimindEditIcon size={14} />{zh ? '复制并编辑' : 'Copy and edit'}</button></>}</div>
    </li> })}{platformView === 'business' && visibleBusinessProfiles.map(managedProfileCard)}</ul>)}
    {roster.status === 'ready' && tab === 'mine' && (mine.length === 0 ? <div data-paimind-agent-status><span data-paimind-agent-status-icon><PaimindUserIcon size={22} /></span><strong>{query.trim() === '' ? (zh ? '还没有个人智能体' : 'No personal Agents yet') : (zh ? '没有匹配的个人智能体' : 'No matching personal Agents')}</strong><p>{query.trim() === '' ? (zh ? '从一个平台模式开始，配置你的角色、目标与会话技能。' : 'Start from a platform mode and configure your role, goal, and session Skills.') : (zh ? '试试更短的关键词，或清空搜索。' : 'Try a shorter search or clear the query.')}</p><button type="button" data-paimind-agent-button data-primary="true" onClick={query.trim() === '' ? createPersonalAgent : () => { setQuery('') }} disabled={query.trim() === '' && templates.length === 0}><PaimindPlusIcon size={14} />{query.trim() === '' ? (zh ? '创建个人智能体' : 'Create Personal Agent') : (zh ? '清空搜索' : 'Clear search')}</button></div> : <ul data-paimind-agent-grid>{mine.map(managedProfileCard)}</ul>)}

    {starterDraft !== null && <div data-paimind-agent-starter-backdrop>
      <section ref={starterRef} data-paimind-agent-starter role="dialog" aria-modal="true" aria-labelledby="paimind-agent-starter-title">
        <header data-paimind-agent-starter-head><div data-paimind-agent-starter-icon aria-hidden="true">{starterDraft.productKind === 'business' ? <PaimindAgentIcon size={25} /> : <PaimindUserIcon size={25} />}</div><div data-paimind-agent-starter-copy><p data-paimind-agent-form-kicker>{starterDraft.productKind === 'business' ? (zh ? '业务智能体' : 'Business Agent') : (zh ? '个人智能体' : 'Personal Agent')}</p><h2 id="paimind-agent-starter-title">{zh ? '你的智能体应该做什么？' : 'What should your Agent do?'}</h2><p>{zh ? '先描述用途。创建助手会生成一份可编辑说明书，保存前不会写入运行配置。' : 'Describe the purpose first. The creation assistant will generate an editable brief; nothing is written until you save.'}</p></div><button type="button" data-paimind-agent-builder-close aria-label={zh ? '关闭创建弹窗' : 'Close creation dialog'} onClick={closeStarter}><PaimindCloseIcon size={17} /></button></header>
        {error !== null && <p role="alert" data-paimind-agent-starter-error>{error}</p>}
        <label data-paimind-agent-starter-purpose>{zh ? '描述它要完成什么' : 'Describe what it should accomplish'}<textarea ref={starterPurposeRef} value={starterDraft.description} maxLength={500} placeholder={zh ? '例如：帮助我诊断人际互动中的难点，给出可落地的沟通建议。' : 'For example: diagnose difficult interactions and suggest practical communication steps.'} onChange={event => { setError(null); setStarterDraft({ ...starterDraft, description: event.currentTarget.value }) }} /></label>
        <div data-paimind-agent-starter-suggestions><span>{zh ? '试试这些示例' : 'Try an example'}</span><div>{[
          zh ? '帮助我建立更好的人际关系' : 'Help me build better relationships',
          zh ? '帮助我定义产品需求' : 'Help me define product requirements',
          zh ? '帮助我准备求职面试' : 'Help me prepare for interviews',
        ].map(example => <button key={example} type="button" onClick={() => { setStarterDraft({ ...starterDraft, description: example }) }}>{example}</button>)}</div></div>
        <div data-paimind-agent-starter-fields>
          <label data-paimind-agent-field>{zh ? '智能体名称（可稍后修改）' : 'Agent name (editable later)'}<input value={starterDraft.name} maxLength={80} placeholder={zh ? '留空将根据用途自动生成' : 'Leave blank to generate from the purpose'} onChange={event => { setError(null); setStarterDraft({ ...starterDraft, name: event.currentTarget.value }) }} /></label>
          <label data-paimind-agent-field>{zh ? '基础模式' : 'Base mode'}<select value={starterDraft.basePresetId} onChange={event => { setStarterDraft({ ...starterDraft, basePresetId: event.currentTarget.value }) }}>{templates.map(row => <option key={row.id} value={row.id}>{modeLabel(metadataForPreset(row).mode, zh)} · {row.name ?? (zh ? '平台模板' : 'Platform template')}</option>)}</select></label>
        </div>
        <div data-paimind-agent-starter-note><PaimindAgentIcon size={16} /><span>{zh ? '保存前不会生效；从平台模式开始时，官方模板保持不变。' : 'Nothing takes effect until you save; platform templates remain unchanged.'}</span></div>
        <div data-paimind-agent-starter-actions><button type="button" data-paimind-agent-button onClick={closeStarter}>{zh ? '取消' : 'Cancel'}</button><button type="button" data-paimind-agent-button data-primary="true" disabled={busy || creatorPreset === undefined || creatorPreset.broken !== undefined} onClick={continueStarter}>{creatorPreset === undefined || creatorPreset.broken !== undefined ? (zh ? '真实创建助手不可用' : 'Real creator unavailable') : (zh ? '生成智能体说明书' : 'Generate Agent brief')}</button></div>
      </section>
    </div>}

    {draft !== null && <div data-paimind-agent-builder-layer data-paimind-product-escape-scope>
      <section ref={builderRef} data-paimind-agent-form role="region" aria-labelledby="paimind-agent-builder-title">
        <header data-paimind-agent-form-head><button type="button" data-paimind-agent-builder-close aria-label={zh ? '返回智能体中心' : 'Back to Agent Center'} disabled={busy} onClick={closeBuilder}><PaimindCloseIcon size={18} /></button><div><p data-paimind-agent-form-kicker>{draft.productKind === 'business' ? (zh ? '业务智能体' : 'Business Agent') : (zh ? '个人智能体' : 'Personal Agent')}</p><h2 id="paimind-agent-builder-title">{draft.editing !== null ? (zh ? '编辑智能体' : 'Edit Agent') : (zh ? '创建智能体' : 'Create Agent')}</h2><p>{draft.copiedFromPlatform !== null ? (zh ? `基于“${draft.copiedFromPlatform}”生成可编辑版本，官方原版保持不变。` : `Create an editable version from “${draft.copiedFromPlatform}”; the official original stays unchanged.`) : (zh ? '通过说明书和配置对话完成创建；编辑也使用同一条流程。' : 'Create through the brief and configuration chat; editing uses the same flow.')}</p></div><span data-paimind-agent-save-state data-dirty={draftDirty}>{draftDirty ? (zh ? '草稿未保存' : 'Unsaved draft') : (zh ? '已保存' : 'Saved')}</span></header>
        <div data-paimind-agent-form-message>{error !== null && <p role="alert" data-paimind-agent-form-error>{error}</p>}</div>
        <div data-paimind-agent-native-toolbar>
          <div role="tablist" aria-label={zh ? '创建助手模式' : 'Creation assistant modes'} data-paimind-agent-conversation-tabs><button type="button" role="tab" aria-selected={builderTab === 'configure'} disabled={busy} onClick={() => { setBuilderTab('configure') }}>{zh ? '配置对话' : 'Configuration chat'}</button><button type="button" role="tab" aria-selected={builderTab === 'test'} disabled={busy} onClick={() => { setBuilderTab('test') }}>{zh ? '测试对话' : 'Test chat'}</button></div>
          <div data-paimind-agent-native-status data-tone={nativeConversationStatus.tone} role="status" aria-live="polite">{nativeConversationStatus.tone === 'ready' ? <PaimindCheckIcon size={16} /> : nativeConversationStatus.tone === 'busy' ? <PaimindAgentIcon size={16} /> : <PaimindWarningIcon size={16} />}<span><strong>{nativeConversationStatus.title}</strong><small>{nativeConversationStatus.detail}</small></span></div>
        </div>
        <div data-paimind-agent-form-body>
          <div data-paimind-agent-form-main>
            {pendingUpdate !== null && <div data-paimind-agent-ai-update role="status"><span><PaimindCheckIcon size={15} />{zh ? `创建助手已更新：${pendingUpdate.changed.join('、')}` : `Creation assistant updated: ${pendingUpdate.changed.join(', ')}`}</span><div><button type="button" onClick={() => { setPendingUpdate(null) }}>{zh ? '保留更新' : 'Keep changes'}</button><button type="button" onClick={() => { setDraft(pendingUpdate.previous); setPendingUpdate(null) }}>{zh ? '撤销' : 'Undo'}</button></div></div>}
            <fieldset data-paimind-agent-editable-fields disabled={busy || pendingUpdate !== null}>
            <section data-paimind-agent-brief-head aria-labelledby="paimind-agent-brief-title"><div><h2 id="paimind-agent-brief-title">{zh ? '智能体说明书' : 'Agent brief'}</h2><p>{zh ? '完善以下信息，定义你的智能体。' : 'Complete the information below to define your Agent.'}</p></div><div data-paimind-agent-identity-row><label data-paimind-agent-field>{zh ? '智能体名称' : 'Agent name'}<input value={draft.name} maxLength={80} onChange={event => { setDraft({ ...draft, name: event.currentTarget.value }) }} /></label><label data-paimind-agent-field>{zh ? '基础模式' : 'Base mode'}<select aria-label={zh ? '基础模式' : 'Base mode'} value={draft.basePresetId} disabled={draft.editing !== null} onChange={event => { const basePresetId = event.currentTarget.value; setDraft({ ...draft, basePresetId, preferredSkillNames: basePresetId === 'minimal' ? [] : draft.preferredSkillNames }) }}>{templates.map(row => <option key={row.id} value={row.id}>{modeLabel(metadataForPreset(row).mode, zh)} · {row.name ?? (zh ? '平台模板' : 'Platform template')}</option>)}</select></label>{draft.productKind === 'business' && <label data-paimind-agent-field>{zh ? '业务分类' : 'Business category'}<input type="search" list="paimind-agent-business-category-options" value={draft.businessCategory} maxLength={80} onChange={event => { const businessCategory = event.currentTarget.value; const matched = businessCategories.find(category => businessCategoryLabel(category, zh) === businessCategory); setDraft({ ...draft, businessCategory, businessCategoryId: matched?.id ?? null }) }} /><datalist id="paimind-agent-business-category-options">{businessCategories.map(category => <option key={category.id} value={businessCategoryLabel(category, zh)} />)}</datalist></label>}<label data-paimind-agent-field data-wide="true">{zh ? '用途说明' : 'Purpose'}<input value={draft.description} maxLength={500} placeholder={zh ? '一句话说明它适合完成什么任务' : 'One sentence describing the task this Agent handles'} onChange={event => { setDraft({ ...draft, description: event.currentTarget.value }) }} /></label></div></section>

            <section data-paimind-agent-form-panel aria-labelledby="paimind-agent-role-title"><div data-paimind-agent-panel-head><span>1</span><div><h3 id="paimind-agent-role-title">{zh ? '它是谁' : 'Who it is'}</h3><p>{zh ? '定义智能体的角色、身份与定位。' : 'Define the Agent’s role and identity.'}</p></div></div><label data-paimind-agent-field><span>{zh ? '角色' : 'Role'}</span><textarea value={draft.role} maxLength={2000} placeholder={zh ? '例如：你是一位擅长帮助用户建立高质量人际关系的沟通教练。' : 'For example: You are a communication coach who helps users build stronger relationships.'} onChange={event => { setDraft({ ...draft, role: event.currentTarget.value }) }} /></label></section>
            <section data-paimind-agent-form-panel aria-labelledby="paimind-agent-goal-title"><div data-paimind-agent-panel-head><span>2</span><div><h3 id="paimind-agent-goal-title">{zh ? '要完成什么' : 'What it accomplishes'}</h3><p>{zh ? '明确核心目标与可交付结果。' : 'Define the core goal and expected outcome.'}</p></div></div><label data-paimind-agent-field><span>{zh ? '目标' : 'Goal'}</span><textarea value={draft.goal} maxLength={2000} placeholder={zh ? '例如：诊断互动难点，提供可落地的策略与沟通建议。' : 'For example: diagnose interaction problems and provide practical strategies.'} onChange={event => { setDraft({ ...draft, goal: event.currentTarget.value }) }} /></label></section>
            <section data-paimind-agent-form-panel aria-labelledby="paimind-agent-behavior-title"><div data-paimind-agent-panel-head><span>3</span><div><h3 id="paimind-agent-behavior-title">{zh ? '如何工作' : 'How it works'}</h3><p>{zh ? '描述工作流程、方法与原则。' : 'Describe its workflow, methods, and principles.'}</p></div></div><div data-paimind-agent-fields><label data-paimind-agent-field data-wide="true"><span>{zh ? '行为规范' : 'Behavior'}</span><textarea value={draft.behavior} maxLength={4000} placeholder={zh ? '工作原则、边界和质量要求' : 'Working principles, boundaries, and quality requirements'} onChange={event => { setDraft({ ...draft, behavior: event.currentTarget.value }) }} /></label><label data-paimind-agent-field data-wide="true">{zh ? '补充要求（可选）' : 'Additional requirements (optional)'}<textarea value={draft.instructions} maxLength={4000} placeholder={zh ? '例如：优先使用中文，所有结论给出证据。' : 'For example: answer concisely and cite evidence.'} onChange={event => { setDraft({ ...draft, instructions: event.currentTarget.value }) }} /></label></div></section>

            <section data-paimind-agent-form-panel data-paimind-agent-skills-panel aria-labelledby="paimind-agent-skills-title"><button type="button" data-paimind-agent-skills-toggle aria-expanded={skillPickerOpen} onClick={() => { setSkillPickerOpen(value => !value) }}><span data-paimind-agent-panel-head><span><PaimindSkillIcon size={15} /></span><span><strong id="paimind-agent-skills-title">{zh ? '会话技能（可选）' : 'Session Skills (optional)'}</strong><small>{zh ? '为智能体添加完成任务所需要的技能。' : 'Add only the Skills required for this Agent.'}</small></span></span><span>{zh ? `已选择 ${draft.preferredSkillNames.length} 项` : `${draft.preferredSkillNames.length} selected`}</span></button>{skillPickerOpen && <fieldset data-paimind-agent-field data-paimind-agent-skill-picker disabled={draft.basePresetId === 'minimal'}><legend>{zh ? '会话注入技能' : 'Session-injected Skills'}</legend><p data-paimind-agent-skill-policy>{zh ? '只有选中的技能会进入这个智能体的新对话。' : 'Only selected Skills enter new conversations for this Agent.'}</p>{draft.basePresetId === 'minimal' ? <div data-paimind-agent-skill-empty>{zh ? '极简模式不启用会话技能。' : 'Minimal mode does not enable Session Skills.'}</div> : installedSkills.length === 0 ? <div data-paimind-agent-skill-empty>{zh ? '暂无已安装技能' : 'No installed Skills'}</div> : <><div data-paimind-agent-skill-toolbar><label data-paimind-agent-skill-search><PaimindSearchIcon size={15} /><input type="search" aria-label={zh ? '搜索会话技能' : 'Search session Skills'} placeholder={zh ? '搜索名称、说明或标签' : 'Search names, descriptions, or tags'} value={skillQuery} onChange={event => { setSkillQuery(event.currentTarget.value) }} /></label><button type="button" data-paimind-agent-skill-selected aria-pressed={selectedSkillsOnly} onClick={() => { setSelectedSkillsOnly(value => !value) }}>{zh ? `只看已选 ${draft.preferredSkillNames.length}` : `Selected ${draft.preferredSkillNames.length}`}</button></div><div data-paimind-agent-skill-categories role="group" aria-label={zh ? '技能分类' : 'Skill categories'}>{SKILL_PRODUCT_CATEGORIES.map(category => <button key={category} type="button" aria-label={`${skillCategoryLabel(category, zh)} ${skillCategoryCounts[category]}`} aria-pressed={skillCategory === category} onClick={() => { setSkillCategory(category) }}><span>{skillCategoryLabel(category, zh)}</span><small>{skillCategoryCounts[category]}</small></button>)}</div><div data-paimind-agent-skill-summary><span>{zh ? `已选择 ${draft.preferredSkillNames.length} / 已安装 ${installedSkills.length}` : `${draft.preferredSkillNames.length} selected / ${installedSkills.length} installed`}</span><span>{zh ? `${visibleSkills.length} 个结果` : `${visibleSkills.length} results`}</span></div><div data-paimind-agent-skill-results>{visibleSkills.length === 0 ? <div data-paimind-agent-skill-empty>{zh ? '当前筛选没有匹配技能。' : 'No Skills match the filters.'}</div> : visibleSkills.map(skill => { const metadata = metadataForSkill(skill); return <label key={skill.name} data-paimind-agent-skill data-selected={draft.preferredSkillNames.includes(skill.name)}><input type="checkbox" checked={draft.preferredSkillNames.includes(skill.name)} onChange={event => { setDraft({ ...draft, preferredSkillNames: event.currentTarget.checked ? [...draft.preferredSkillNames, skill.name] : draft.preferredSkillNames.filter(value => value !== skill.name) }) }} /><span><strong>{skill.name}</strong><small>{skillCategoryLabel(metadata.category, zh)}</small><em>{skill.description}</em></span></label> })}</div></>}</fieldset>}</section>
            <p data-paimind-agent-runtime-note>{zh ? '运行时资源与权限由 Harness 平台统一管理与执行。' : 'Runtime resources and permissions are managed and executed by Harness.'}</p>
            </fieldset>
          </div>

        </div>
        <div data-paimind-agent-form-actions><p>{pendingUpdate !== null ? (zh ? '创建助手的本轮建议尚未确认，暂时不能保存。' : 'The creation assistant proposal is still pending and cannot be saved yet.') : (zh ? '保存后的配置会用于这里的测试对话和之后的新对话。' : 'Saved configuration is used by Test Chat here and by future conversations.')}</p><div><button type="button" data-paimind-agent-button disabled={busy} onClick={closeBuilder}>{zh ? '返回中心' : 'Back to Center'}</button><button type="button" data-paimind-agent-button data-primary="true" disabled={busy || pendingUpdate !== null || !draftDirty} onClick={() => { void save() }}>{authoringStatus === 'running' ? (zh ? '创建助手思考中…' : 'Creation assistant thinking…') : busy ? (zh ? '保存中…' : 'Saving…') : draftDirty ? (draft.productKind === 'business' ? (zh ? '保存业务智能体' : 'Save Business Agent') : (zh ? '保存个人智能体' : 'Save Personal Agent')) : (zh ? '已保存' : 'Saved')}</button></div></div>
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
    aria-current={snapshot.open ? 'page' : undefined}
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

const HIDDEN_NATIVE_CONVERSATION: Readonly<{ readonly sessionId: string | null; readonly interactive: boolean }> = Object.freeze({ sessionId: null, interactive: false })

export function AgentCenterSurface(props: AgentCenterSurfaceProps): ReactNode {
  const snapshot = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot, props.controller.getSnapshot)
  const root = useRef<HTMLDivElement>(null)
  const [host, setHost] = useState<PaimindProductCenterHost | null>(null)
  const [nativeConversation, setNativeConversation] = useState(HIDDEN_NATIVE_CONVERSATION)
  const previousSessionId = useRef<string | null | undefined>(undefined)
  const suppressRestore = useRef(false)

  const restorePreviousSession = useCallback((clear = false): void => {
    const previous = previousSessionId.current
    if (!suppressRestore.current && previous !== undefined && previous !== null && props.runtime.currentSessionId() !== previous) {
      props.runtime.openSession(previous)
    }
    if (clear) {
      previousSessionId.current = undefined
      suppressRestore.current = false
    }
  }, [props.runtime])

  const handleNativeConversationChange = useCallback((next: Readonly<{
    readonly sessionId: string | null
    readonly interactive: boolean
  }>): void => {
    if (previousSessionId.current === undefined) previousSessionId.current = props.runtime.currentSessionId()
    props.onNativeConversationChange?.(next)
    setNativeConversation(current => current.sessionId === next.sessionId && current.interactive === next.interactive
      ? current
      : Object.freeze({ sessionId: next.sessionId, interactive: next.interactive }))
  }, [props.onNativeConversationChange, props.runtime])

  useLayoutEffect(() => {
    if (!snapshot.open) {
      setNativeConversation(HIDDEN_NATIVE_CONVERSATION)
      restorePreviousSession(true)
      setHost(null)
      return
    }
    const nextHost = resolvePaimindProductCenterHost()
    if (nextHost === null) {
      props.controller.close(false)
      setHost(null)
      return
    }
    const disposeHost = installPaimindProductCenterHost(nextHost)
    if (disposeHost === null) {
      props.controller.close(false)
      setHost(null)
      return
    }
    suppressRestore.current = false
    setHost(nextHost)
    return () => {
      setPaimindProductCenterNativeConversation(nextHost, false, false)
      restorePreviousSession(true)
      setHost(null)
      disposeHost()
    }
  }, [props.controller, restorePreviousSession, snapshot.open])

  useLayoutEffect(() => {
    if (!snapshot.open || host === null) return
    const sessionId = nativeConversation.sessionId
    if (sessionId === null) {
      setPaimindProductCenterNativeConversation(host, false, false)
      restorePreviousSession()
      return
    }
    setPaimindProductCenterNativeConversation(host, false, false)
    const synchronize = (): void => {
      const ready = props.runtime.currentSessionId() === sessionId
      setPaimindProductCenterNativeConversation(host, ready, ready && nativeConversation.interactive)
    }
    const disposeSessions = props.runtime.subscribeSessions(synchronize)
    const cancelOpen = props.runtime.openSession(sessionId)
    synchronize()
    return () => {
      cancelOpen()
      disposeSessions()
      setPaimindProductCenterNativeConversation(host, false, false)
    }
  }, [host, nativeConversation.interactive, nativeConversation.sessionId, props.runtime, restorePreviousSession, snapshot.open])

  useEffect(() => {
    if (!snapshot.open || host === null || root.current === null) return
    return installPaimindProductSurfaceInteraction(root.current, props.controller)
  }, [host, props.controller, snapshot.open])

  if (!snapshot.open || host === null) return null
  return createPortal(<div ref={root} data-paimind-product-surface="agent-center" role="main" aria-labelledby="paimind-agent-center-title">
    <div data-paimind-product-body><AgentCenterSection {...props} onNativeConversationChange={handleNativeConversationChange} close={(restorePreviousSession = true) => {
      if (!restorePreviousSession) suppressRestore.current = true
      props.controller.close()
    }} /></div>
  </div>, host.mount)
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
    const connectionApi = scope.get('connection').api
    const api = connectionApi.agentPresets
    const runtime = new AgentCenterRuntime(
      () => resolveHarnessAgentPresetSeatControl(scope.slots),
      profiles,
      scope.sessions,
      scope.workspaces,
      scope.conversation,
      connectionApi.sessions,
    )
    const surfaceController = new PaimindProductSurfaceController('agent-center')
    const builderRequests = new PaimindAgentBuilderRequestController(surfaceController)
    const presetSettings = installHarnessAgentPresetSettingsNavigation(scope.slots)
    scope.effect(installStyle, 'paimind-agent-market: style')
    scope.effect(() => () => { runtime.dispose() }, 'paimind-agent-market: runtime')
    scope.effect(() => () => { surfaceController.dispose() }, 'paimind-agent-market: surface controller')
    scope.effect(() => () => { builderRequests.dispose() }, 'paimind-agent-market: builder requests')
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
      builderRequests,
      locale: scope.locale,
      openAdvanced: () => {
        const opened = presetSettings.open()
        if (opened) surfaceController.close(false)
        return opened
      },
    })
    scope.slots.inject('tool.call.toolview', () => scope.slots.register({
      name: 'tool.call.toolview', key: AGENT_AUTHORING_PROPOSAL_TOOL,
    }, (props: Omit<AgentAuthoringProposalToolRowProps, 'locale'>) => (
      <AgentAuthoringProposalToolRow {...props} locale={scope.locale} />
    )))
    scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
      name: 'sidebar.footer.action', id: 'paimind-agent-center-trigger', order: -12,
      label: () => scope.locale.getLocale().active.startsWith('zh') ? '智能体中心' : 'Agent Center',
      inject: () => ({ controller: surfaceController, locale: scope.locale }),
    }, (props: { readonly wide: boolean; readonly controller: PaimindProductSurfaceController; readonly locale: PaimindLocaleSource }) => <AgentCenterBoundary><AgentCenterTrigger {...props} /></AgentCenterBoundary>))
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay', id: 'paimind-agent-center-surface', order: 10, inject: injectProps,
    }, (props: AgentCenterSurfaceProps) => <AgentCenterBoundary><AgentCenterSurface {...props} /></AgentCenterBoundary>))
  }, 'paimind-agent-market: Harness center surface')
  try { await mounted } catch (error) {
    await disposeAgentRemote()
    throw error
  }
  return async () => {
    await mounted.dispose()
    await disposeAgentRemote()
  }
}
