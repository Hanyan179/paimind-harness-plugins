import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  PAIMIND_AGENT_PREPARE_CREATE_TOOL,
  PAIMIND_BUSINESS_SKILL_REPOSITORY_DIRECTORY,
  PAIMIND_SKILL_INSPECT_GITHUB_TOOL,
  PAIMIND_SKILL_INSTALL_TOOL,
  PAIMIND_STANDARD_AGENT_BASE_PRESET_ID,
  PAIMIND_SYSTEM_SKILL_NAMES,
} from '@paimind/contracts'
import {
  definePaimindHarnessTool,
  PaimindHostRemoteService,
  describePaimindHostSettings,
  markPaimindHostRemoteMethods,
  mutatePaimindHostSettings,
  type PaimindHostSettingsFacility,
  type PaimindHostToolRegistry,
  type PaimindToolRunContext,
} from '@paimind/harness-compat/host'
export { AGENT_AUTHORING_SESSION_PREFIX } from './client-contract.js'

export const name = 'paimind-agent-builder'
export const inject = ['settings', 'sessions', 'tools', 'skills', 'agents', 'agentPresets', 'systemPrompt']
export const AGENT_PROFILE_FILE = '.paimind-agent.json'
export const AGENT_PRESET_ID = /^[a-z0-9][a-z0-9-_]*$/
/** Legacy directory removed during profile save/read repair; runtime no longer scans it. */
export const AGENT_SKILL_SCOPE_DIRECTORY = '.paimind-skills'
const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/
const CONTROL = /[\u0000-\u001f\u007f]/g
const STATE_VERSION = 1
const PAIMIND_AGENT_AUTHORING_SKILL = 'paimind-agent-authoring'
const PAIMIND_AGENT_SKILL_BINDING_TOOL = 'paimind_agent_skill_binding'
const PAIMIND_AGENT_AUTHORING_SKILL_DESCRIPTION = 'Create or configure a PAIMind Agent from an ordinary conversation and hand a complete draft to the reviewable Agent Builder. Use when the user asks to create, build, configure, or revise an Agent or intelligent assistant.'
const PAIMIND_AGENT_AUTHORING_SOURCE_PLUGIN_ID = '@paimind/agent-builder'

function packagedSkillBody(url: URL): string {
  const source = readFileSync(url, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!source.startsWith('---\n')) throw new Error(`Packaged Skill is missing YAML frontmatter: ${url.pathname}`)
  const end = source.indexOf('\n---', 4)
  if (end < 0) throw new Error(`Packaged Skill frontmatter is incomplete: ${url.pathname}`)
  return source.slice(end + 4).replace(/^\n+/, '').trimEnd()
}

export type AgentProfileKind = 'personal' | 'business'

export interface AgentBusinessProfileInput {
  readonly agentId: string
  readonly presetId: string
  readonly name: string
  readonly description: string
  readonly basePresetId: string
  readonly role: string
  readonly goal: string
  readonly behavior: string
  readonly preferredSkillNames: readonly string[]
  readonly connectionIds?: readonly string[]
  readonly instructions: string
  /** Presentation-only portrait selected from the shared PAIMind avatar pool. */
  readonly avatarId?: string
  /** Product placement only; execution and Preset ownership remain Harness-native. */
  readonly productKind?: AgentProfileKind
  readonly businessCategory?: string
  readonly businessCategoryId?: string
  /** Native Harness authoring Session that owns this saved configuration flow. */
  readonly authoringSessionId?: string
  /** Last authoring event already represented by this saved Profile revision. */
  readonly authoringCursor?: number
  readonly expectedVersion?: string
}

export interface AgentBusinessProfile extends Omit<AgentBusinessProfileInput, 'expectedVersion'> {
  readonly revision: number
  readonly configVersion: string
  readonly updatedAt: number
  readonly health: 'healthy' | 'broken'
  readonly healthMessage?: string
}

export interface AgentProfileSnapshot {
  readonly profiles: readonly Readonly<AgentBusinessProfile>[]
}

export interface AgentSessionBinding {
  readonly sessionId: string
  readonly agentId: string
  readonly presetId: string
  readonly configVersion: string
  /** Product purpose of the native Session; absent legacy rows are ordinary conversations. */
  readonly purpose?: 'conversation' | 'builder-test'
  readonly boundAt: number
}

export interface AgentMigrationPlan {
  readonly sourceSessionId: string
  readonly agentId: string
  readonly presetId: string
  readonly fromVersion: string
  readonly toVersion: string
  readonly summary: string
}

export interface AgentMigrationRecord extends AgentMigrationPlan {
  readonly targetSessionId: string
  readonly migratedAt: number
}

export interface AgentVerificationRecord {
  readonly sessionId: string
  readonly agentId: string
  readonly presetId: string
  readonly configVersion: string
  readonly firstTurnId: string
  readonly result: 'passed' | 'failed'
  readonly message: string
  readonly verifiedAt: number
}

interface AgentCenterState {
  readonly schemaVersion: 1
  readonly bindings: Readonly<Record<string, AgentSessionBinding>>
  readonly migrations: readonly AgentMigrationRecord[]
  readonly verifications: readonly AgentVerificationRecord[]
}

export interface AgentBuilderHostSession {
  readonly id?: string
  readonly header?: { readonly id?: string; readonly agentPreset?: string }
  readonly events?: readonly unknown[]
}

export interface AgentBuilderHostToolExecution {
  readonly name: string
  readonly agent?: { readonly session?: AgentBuilderHostSession }
}

export interface AgentBuilderHostPromptAssembly {
  readonly sections?: readonly unknown[]
  readonly contexts?: readonly unknown[]
  readonly variables?: Readonly<Record<string, unknown>>
  readonly tools: readonly unknown[]
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

export interface AgentAuthoringSkillContext {
  readonly name: string
  readonly description: string
}

export interface AgentAuthoringTurnInput {
  readonly sessionId: string
  readonly draft: AgentAuthoringDraftContext
  readonly skills: readonly AgentAuthoringSkillContext[]
  readonly locale: string
}

export interface AgentAuthoringCapabilityDescriptor {
  readonly name: typeof PAIMIND_AGENT_AUTHORING_SKILL
  readonly description: string
  readonly sourcePluginId: typeof PAIMIND_AGENT_AUTHORING_SOURCE_PLUGIN_ID
}

const AGENT_AUTHORING_CAPABILITY_DESCRIPTOR: Readonly<AgentAuthoringCapabilityDescriptor> = Object.freeze({
  name: PAIMIND_AGENT_AUTHORING_SKILL,
  description: PAIMIND_AGENT_AUTHORING_SKILL_DESCRIPTION,
  sourcePluginId: PAIMIND_AGENT_AUTHORING_SOURCE_PLUGIN_ID,
})

/** Same-process source contract for Agent-owned Skill selection and authoring lifecycle. */
export interface AgentBusinessSkillSelectionSource {
  businessSkillNamesForPreset(presetId: string): Promise<readonly string[] | undefined>
  describeAgentAuthoringCapability(): Readonly<AgentAuthoringCapabilityDescriptor>
  setAgentAuthoringEnabled(enabled: boolean): void
}

export interface AgentBuilderHostAgent {
  readonly id: string
  readonly session: AgentBuilderHostSession
  readonly ctx: {
    readonly systemPrompt: {
      section(section: {
        readonly name: string
        readonly order: number
        readonly text: string | ((context: Readonly<Record<string, unknown>>) => string)
        readonly complete?: boolean
      }): () => void
      suppressRuntimeContext(): () => void
    }
    readonly tools: Pick<PaimindHostToolRegistry, 'register'>
  }
}

export interface AgentBuilderHostContext {
  /** Structurally injected Agent selection source for a runtime Skill Scope Resolver. */
  readonly paimindAgentProfiles?: AgentBusinessSkillSelectionSource
  readonly sessions: { get(id: string): AgentBuilderHostSession | undefined }
  readonly agents: {
    get(id: string): AgentBuilderHostAgent | undefined
    list(): readonly AgentBuilderHostAgent[]
  }
  readonly tools: {
    guard(check: (execution: AgentBuilderHostToolExecution) => string | undefined): () => void
    register?(definition: unknown): () => void
  }
  readonly skills?: {
    list?(): Promise<readonly { readonly name: string }[]>
    register(skill: {
      readonly name: string
      readonly description: string
      readonly content: string
      readonly source: 'bundled'
      readonly invocation: { readonly modelInvocable: true; readonly userInvocable: true }
    }): () => void
  }
  readonly agentPresets: {
    composedPreset(agentContext: AgentBuilderHostAgent['ctx']): string | undefined
    remove?(id: string): Promise<void>
  }
  get(name: 'settings'): PaimindHostSettingsFacility | undefined
  get(name: 'paimindAgentProfiles'): AgentBusinessSkillSelectionSource | undefined
  get(name: 'paimindMcpConnections'): { validateSelection(ids: readonly string[]): Promise<void>; bindingsChanged(): Promise<void> } | undefined
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
  on(
    event: 'system-prompt/assemble',
    listener: (
      assembly: AgentBuilderHostPromptAssembly,
      context: { readonly agent?: AgentBuilderHostAgent },
      next: () => Promise<AgentBuilderHostPromptAssembly>,
    ) => Promise<AgentBuilderHostPromptAssembly>,
    options?: { readonly prepend?: boolean },
  ): () => void
  on(
    event: 'agent/created' | 'agent/disposed',
    listener: (event: { readonly agent: AgentBuilderHostAgent }) => void,
  ): () => void
  on(
    event: 'agent/pre-step',
    listener: (
      event: { readonly agent: AgentBuilderHostAgent },
      next: () => Promise<unknown>,
    ) => Promise<unknown>,
  ): () => void
}

export interface AgentBuilderOptions {
  readonly presetRoot?: string
  readonly skillRoot?: string
  readonly stateRoot?: string
  readonly now?: () => number
}

function bounded(value: string, max: number, field: string, required = false): string {
  const normalized = value.replace(CONTROL, ' ').trim()
  if ((required && normalized === '') || normalized.length > max) throw new Error(`${field} 无效`)
  return normalized
}

function validateId(value: string, field: string): string {
  const normalized = value.trim()
  if (!AGENT_PRESET_ID.test(normalized)) throw new Error(`${field} 无效`)
  return normalized
}

function stableProfile(input: AgentBusinessProfileInput, revision: number, updatedAt: number): AgentBusinessProfile {
  const agentId = validateId(input.agentId, '智能体标识')
  const presetId = validateId(input.presetId, '预设标识')
  const basePresetId = validateId(input.basePresetId, '基础能力模板')
  if (basePresetId !== PAIMIND_STANDARD_AGENT_BASE_PRESET_ID) throw new Error('PAIMind 智能体必须使用标准基座')
  const name = bounded(input.name, 80, '名称', true)
  const description = bounded(input.description, 500, '描述')
  const role = bounded(input.role, 2_000, '角色', true)
  const goal = bounded(input.goal, 2_000, '目标', true)
  const behavior = bounded(input.behavior, 4_000, '行为规范', true)
  const instructions = bounded(input.instructions, 4_000, '补充要求')
  const avatarId = input.avatarId === undefined ? undefined : validateId(input.avatarId, '头像标识')
  const authoringSessionId = input.authoringSessionId === undefined
    ? undefined
    : bounded(input.authoringSessionId, 200, '创建会话标识', true)
  const authoringCursor = input.authoringCursor
  if (authoringCursor !== undefined && (!Number.isInteger(authoringCursor) || authoringCursor < 0)) throw new Error('创建会话进度无效')
  if (input.productKind !== undefined && input.productKind !== 'personal' && input.productKind !== 'business') throw new Error('智能体类型无效')
  const productKind: AgentProfileKind = input.productKind === 'business' ? 'business' : 'personal'
  const businessPlacement = productKind === 'business' ? (() => {
    const businessCategory = bounded(input.businessCategory ?? '', 80, '业务分类', true)
    const businessCategoryId = input.businessCategoryId === undefined
      ? `category-${createHash('sha256').update(businessCategory).digest('hex').slice(0, 12)}`
      : validateId(input.businessCategoryId, '业务分类标识')
    return { businessCategory, businessCategoryId }
  })() : {}
  const preferredSkillNames = Object.freeze([...new Set(input.preferredSkillNames.map(value => value.trim()).filter(value => {
    if (!SKILL_NAME.test(value)) throw new Error(`Skill 名称无效：${value}`)
    return true
  }))])
  if ((input.connectionIds?.length ?? 0) > 100) throw new Error('最多选择 100 条连接')
  const connectionIds = Object.freeze([...new Set((input.connectionIds ?? []).map(value => {
    if (!/^[a-f0-9]{32}$/.test(value)) throw new Error('连接引用无效')
    return value
  }))])
  const seed = {
    ...(connectionIds.length === 0 ? {} : { connectionIds }),
    agentId, presetId, name, description, basePresetId, role, goal, behavior, preferredSkillNames, instructions,
    productKind, ...businessPlacement, ...(avatarId === undefined ? {} : { avatarId }), revision,
  }
  const digest = createHash('sha256').update(JSON.stringify(seed)).digest('hex').slice(0, 16)
  return Object.freeze({
    ...seed,
    ...(authoringSessionId === undefined ? {} : { authoringSessionId }),
    ...(authoringCursor === undefined ? {} : { authoringCursor }),
    configVersion: `v${revision}-${digest}`,
    updatedAt,
    health: 'healthy',
  })
}

function personaText(profile: AgentBusinessProfile): string {
  return [
    `You are ${profile.name}, an agent running on DeepSeek Harness. Your working directory is {{cwd}}.`,
    '', 'Role:', profile.role,
    '', 'Goal:', profile.goal,
    '', 'Behavior rules:', profile.behavior,
    ...(profile.instructions === '' ? [] : ['', 'Additional requirements:', profile.instructions]),
  ].join('\n')
}

/** Remove the retired Agent-owned filesystem provider while preserving native Standard discovery. */
export function removePresetSkillFilesystemOverride(content: string): string {
  const match = /(?:^# PAIMind skill scope:[^\n]*\n)?^- id:\s*skill-filesystem\s*$/m.exec(content)
  if (match === null) return content
  const start = match.index
  const rowStart = content.indexOf('- id:', start)
  const next = content.slice(rowStart + 1).search(/^- id:\s*/m)
  const end = next < 0 ? content.length : rowStart + 1 + next
  const row = content.slice(start, end)
  if (!row.includes('# PAIMind skill scope:') && !/providerName:\s*(['"])paimind-agent-scope\1/.test(row)) {
    return content
  }
  const replacement = [
    '- id: skill-filesystem',
    "  name: '@deepseek-ai/dsh-skill-filesystem'",
    '',
  ].join('\n')
  return `${content.slice(0, start)}${replacement}${content.slice(end).replace(/^\n+/, '')}`
}

export function replacePresetPersona(content: string, profile: AgentBusinessProfile): string {
  const start = content.search(/^- id:\s*persona\s*$/m)
  if (start < 0) throw new Error('基础能力模板缺少 persona 配置')
  const next = content.slice(start + 1).search(/^\- id:\s*/m)
  const end = next < 0 ? content.length : start + 1 + next
  const text = personaText(profile).split('\n').map(line => `      ${line}`).join('\n')
  const replacement = `- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: |-\n${text}\n\n`
  return `${content.slice(0, start)}${replacement}${content.slice(end).replace(/^\n+/, '')}`
}

function presetMetadata(profile: AgentBusinessProfile): string {
  return `name: ${JSON.stringify(profile.name)}\ndescription: ${JSON.stringify(profile.description)}\n`
}

function defaultState(): AgentCenterState {
  return Object.freeze({ schemaVersion: STATE_VERSION, bindings: Object.freeze({}), migrations: Object.freeze([]), verifications: Object.freeze([]) })
}

const AGENT_AUTHORING_QUESTION_TOOL = 'ask_user_question'
const AGENT_AUTHORING_SKILL_TOOL = 'skill'
const AGENT_AUTHORING_ALLOWED_TOOLS = new Set([
  AGENT_AUTHORING_SKILL_TOOL,
  AGENT_AUTHORING_QUESTION_TOOL,
  PAIMIND_SKILL_INSPECT_GITHUB_TOOL,
  PAIMIND_SKILL_INSTALL_TOOL,
  PAIMIND_AGENT_PREPARE_CREATE_TOOL,
])

interface PreparedAgentAuthoringTurn {
  readonly draft: Readonly<AgentAuthoringDraftContext>
  readonly skills: readonly Readonly<AgentAuthoringSkillContext>[]
  readonly locale: string
}

type AgentAuthoringProposal = Readonly<{
  businessCategory?: string
  name: string
  description: string
  role: string
  goal: string
  behavior: string
  instructions: string
  preferredSkillNames: readonly string[]
}>

function authoringProposalFromToolArguments(
  args: Readonly<Record<string, unknown>>,
  context: PreparedAgentAuthoringTurn,
): AgentAuthoringProposal {
  const allowed = new Set(['businessCategory', 'name', 'description', 'role', 'goal', 'behavior', 'instructions', 'preferredSkillNames'])
  const unknown = Object.keys(args).filter(key => !allowed.has(key))
  if (unknown.length > 0) throw new Error(`创建草稿包含不允许的字段：${unknown.join('、')}`)
  const requestedSkillNames = args.preferredSkillNames ?? context.draft.preferredSkillNames
  if (!Array.isArray(requestedSkillNames) || !requestedSkillNames.every(value => typeof value === 'string')) {
    throw new Error('创建草稿的 preferredSkillNames 无效')
  }
  const preferredSkillNames = Object.freeze([...new Set(requestedSkillNames.map(value => value.trim()))])
  if (preferredSkillNames.some(name => !SKILL_NAME.test(name))) throw new Error('创建草稿的 preferredSkillNames 无效')
  return Object.freeze({
    name: bounded((args.name ?? context.draft.name) as string, 80, '名称', true),
    description: bounded((args.description ?? context.draft.description) as string, 500, '描述'),
    role: bounded((args.role ?? context.draft.role) as string, 2_000, '角色', true),
    goal: bounded((args.goal ?? context.draft.goal) as string, 2_000, '目标', true),
    behavior: bounded((args.behavior ?? context.draft.behavior) as string, 4_000, '行为规范', true),
    instructions: bounded((args.instructions ?? context.draft.instructions) as string, 4_000, '补充要求'),
    preferredSkillNames,
    ...(context.draft.productKind === 'business'
      ? { businessCategory: bounded((args.businessCategory ?? context.draft.businessCategory) as string, 80, '业务分类', true) }
      : {}),
  })
}

const AUTHORING_PROPOSAL_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    name: { type: 'string', required: true }, description: { type: 'string', required: true },
    role: { type: 'string', required: true }, goal: { type: 'string', required: true },
    behavior: { type: 'string', required: true }, instructions: { type: 'string', required: true },
    businessCategory: { type: 'string' },
    preferredSkillNames: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const AUTHORING_PROPOSAL_INPUT_PROPERTIES = {
  name: { type: 'string' }, description: { type: 'string' },
  role: { type: 'string' }, goal: { type: 'string' },
  behavior: { type: 'string' }, instructions: { type: 'string' },
  businessCategory: { type: 'string' },
  preferredSkillNames: { type: 'array', items: { type: 'string' } },
} as const

const AUTHORING_LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i
const AUTHORING_CONTEXT_LIMIT = 40
const AGENT_AUTHORING_DATA_CONTEXT = 'paimind:agent-authoring-data'

const NATIVE_ENTRY_AUTHORING_CONTEXT: PreparedAgentAuthoringTurn = Object.freeze({
  draft: Object.freeze({
    productKind: 'personal', businessCategory: '', name: '', description: '', basePresetId: 'standard',
    role: '', goal: '', behavior: '', instructions: '', preferredSkillNames: Object.freeze([]),
  }),
  skills: Object.freeze([]),
  locale: 'auto',
})

function normalizeAuthoringTurn(input: AgentAuthoringTurnInput): PreparedAgentAuthoringTurn {
  if (input.draft.productKind !== 'personal' && input.draft.productKind !== 'business') throw new Error('智能体创建上下文类型无效')
  if (!Array.isArray(input.draft.preferredSkillNames) || input.draft.preferredSkillNames.length > AUTHORING_CONTEXT_LIMIT) {
    throw new Error('智能体创建上下文的已选 Skill 无效')
  }
  if (!Array.isArray(input.skills) || input.skills.length > AUTHORING_CONTEXT_LIMIT) throw new Error('智能体创建上下文的已安装 Skill 无效')
  const preferredSkillNames = input.draft.preferredSkillNames.map(value => {
    const name = value.trim()
    if (!SKILL_NAME.test(name)) throw new Error(`Skill 名称无效：${name}`)
    return name
  })
  if (new Set(preferredSkillNames).size !== preferredSkillNames.length) throw new Error('智能体创建上下文的已选 Skill 不可重复')
  const seenSkills = new Set<string>()
  const skills = input.skills.map(value => {
    const name = value.name.trim()
    if (!SKILL_NAME.test(name) || seenSkills.has(name)) throw new Error(`已安装 Skill 名称无效或重复：${name}`)
    seenSkills.add(name)
    return Object.freeze({ name, description: bounded(value.description, 500, 'Skill 描述') })
  })
  if (preferredSkillNames.some(name => !seenSkills.has(name))) throw new Error('智能体创建上下文包含未安装的已选 Skill')
  if (input.draft.basePresetId !== PAIMIND_STANDARD_AGENT_BASE_PRESET_ID) throw new Error('智能体创建上下文必须使用标准基座')
  const locale = bounded(input.locale, 35, '语言', true)
  if (!AUTHORING_LOCALE.test(locale)) throw new Error('智能体创建上下文语言无效')
  const draft = Object.freeze({
    productKind: input.draft.productKind,
    businessCategory: bounded(input.draft.businessCategory, 80, '业务分类'),
    name: bounded(input.draft.name, 80, '名称'),
    description: bounded(input.draft.description, 500, '描述'),
    basePresetId: PAIMIND_STANDARD_AGENT_BASE_PRESET_ID,
    role: bounded(input.draft.role, 2_000, '角色'),
    goal: bounded(input.draft.goal, 2_000, '目标'),
    behavior: bounded(input.draft.behavior, 4_000, '行为规范'),
    instructions: bounded(input.draft.instructions, 4_000, '补充要求'),
    preferredSkillNames: Object.freeze(preferredSkillNames),
  })
  return Object.freeze({ draft, skills: Object.freeze(skills), locale })
}

function safeAuthoringDataJson(value: unknown): string {
  // Escape framing-sensitive characters in the serialized document, not in
  // each source string. JSON.parse therefore restores the original business
  // text while the model-facing snapshot contains no raw template or HTML
  // delimiter that can escape the data envelope.
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/\{\{/g, '\\u007b\\u007b')
    .replace(/\}\}/g, '\\u007d\\u007d')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
}

/** Data-only context. The canonical SKILL.md remains the sole authoring workflow definition. */
function preparedAuthoringDataContext(context: PreparedAgentAuthoringTurn): Readonly<{ name: string; text: string }> {
  return Object.freeze({
    name: AGENT_AUTHORING_DATA_CONTEXT,
    text: safeAuthoringDataJson({
      schema: 'paimind.agent-authoring-data/v1',
      trust: 'untrusted-user-data',
      CURRENT_DRAFT: context.draft,
      INSTALLED_BUSINESS_SKILLS: context.skills,
      LOCALE: context.locale,
    }),
  })
}

function assembledContextName(context: unknown): string | undefined {
  if (typeof context !== 'object' || context === null) return undefined
  const name = (context as { readonly name?: unknown }).name
  return typeof name === 'string' ? name : undefined
}

function assembledToolName(tool: unknown): string | undefined {
  if (typeof tool === 'string') return tool
  if (typeof tool !== 'object' || tool === null) return undefined
  const name = (tool as { readonly name?: unknown }).name
  return typeof name === 'string' ? name : undefined
}

const AGENT_AUTHORING_SESSION_ID = /^paimind-authoring-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isDedicatedPaimindAgentAuthoringSession(session: AgentBuilderHostSession | undefined): boolean {
  if (session === undefined) return false
  const sessionId = session?.id ?? session?.header?.id
  if (typeof sessionId !== 'string' || !AGENT_AUTHORING_SESSION_ID.test(sessionId)) return false
  const effectivePreset = effectivePresetForFirstTurn(session)
  // Keep partial/missing host snapshots fail-closed, but stop applying the
  // authoring allowlist once an untouched authoring-shaped blank Session has
  // been reassigned to a real saved Agent before its first human turn.
  return effectivePreset === undefined || effectivePreset === PAIMIND_STANDARD_AGENT_BASE_PRESET_ID
}

function isDedicatedPaimindAgentAuthoringRuntime(
  session: AgentBuilderHostSession | undefined,
  context: Pick<AgentBuilderHostContext, 'agents' | 'agentPresets'>,
): boolean {
  if (!isDedicatedPaimindAgentAuthoringSession(session)) return false
  const sessionId = session?.id ?? session?.header?.id
  if (typeof sessionId !== 'string') return true
  const liveAgent = context.agents.get(sessionId)
  if (liveAgent === undefined) return true
  const livePreset = context.agentPresets.composedPreset(liveAgent.ctx)
  return livePreset === undefined || livePreset === PAIMIND_STANDARD_AGENT_BASE_PRESET_ID
}

function nestedAuthoringResultText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(nestedAuthoringResultText).filter(Boolean).join('\n')
  if (typeof value !== 'object' || value === null) return ''
  const row = value as Readonly<Record<string, unknown>>
  if (row.type === 'text' && typeof row.text === 'string') return row.text
  return nestedAuthoringResultText(row.content)
}

/** A real completed prepare-create Tool result is the durable activation marker for an ordinary Session. */
export function hasPreparedAgentDraft(session: AgentBuilderHostSession | undefined): boolean {
  const calls = new Map<string, string>()
  for (const raw of session?.events ?? []) {
    if (typeof raw !== 'object' || raw === null) continue
    const event = raw as { readonly type?: unknown; readonly data?: unknown }
    if (event.type === 'tool/call' && typeof event.data === 'object' && event.data !== null) {
      const data = event.data as { readonly callId?: unknown; readonly name?: unknown }
      if (typeof data.callId === 'string' && typeof data.name === 'string') calls.set(data.callId, data.name)
      continue
    }
    if (event.type !== 'tool/result' || typeof event.data !== 'object' || event.data === null) continue
    const data = event.data as { readonly message?: { readonly source?: { readonly callId?: unknown }; readonly content?: unknown } }
    const callId = data.message?.source?.callId
    if (typeof callId !== 'string' || calls.get(callId) !== PAIMIND_AGENT_PREPARE_CREATE_TOOL) continue
    if (/<!--\s*PAIMIND_AGENT_DRAFT\b/i.test(nestedAuthoringResultText(data.message?.content))) return true
  }
  return false
}

/** Dedicated Sessions are authoring from birth; ordinary Sessions activate only through a real Tool result. */
export function isPaimindAgentAuthoringSession(session: AgentBuilderHostSession | undefined): boolean {
  const sessionId = session?.id ?? session?.header?.id
  return (typeof sessionId === 'string' && AGENT_AUTHORING_SESSION_ID.test(sessionId)) || hasPreparedAgentDraft(session)
}

function textBlocks(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.map(block => {
    if (typeof block !== 'object' || block === null) return ''
    const candidate = block as { readonly type?: unknown; readonly text?: unknown }
    return candidate.type === 'text' && typeof candidate.text === 'string' ? candidate.text : ''
  }).filter(Boolean).join('\n')
}

const AUTHORING_CONTROL_PAYLOAD = /<!--\s*PAIMIND_AGENT_DRAFT\s*\n?[\s\S]*?\s*-->/gi
const AUTHORING_CONTROL_MARKER = /<!--\s*PAIMIND_AGENT_DRAFT/i

function visibleAgentAuthoringText(value: string): string {
  const visible = value.replace(AUTHORING_CONTROL_PAYLOAD, '').trim()
  AUTHORING_CONTROL_PAYLOAD.lastIndex = 0
  const marker = AUTHORING_CONTROL_MARKER.exec(visible)
  AUTHORING_CONTROL_MARKER.lastIndex = 0
  return (marker === null ? visible : visible.slice(0, marker.index)).trim()
}

export function summarizeConversationEvents(events: readonly unknown[], sourceSessionId: string): string {
  const rows: { role: '用户' | '智能体'; text: string }[] = []
  for (const event of events) {
    if (typeof event !== 'object' || event === null) continue
    const row = event as { readonly type?: unknown; readonly data?: unknown }
    if (row.type === 'user/message' && typeof row.data === 'object' && row.data !== null) {
      const message = row.data as { readonly source?: { readonly kind?: unknown }; readonly content?: unknown }
      if (message.source?.kind !== 'user') continue
      const text = textBlocks(message.content).trim()
      if (text !== '') rows.push({ role: '用户', text })
    }
    if (row.type === 'assistant/message' && typeof row.data === 'object' && row.data !== null) {
      const data = row.data as { readonly message?: { readonly content?: unknown } }
      const text = visibleAgentAuthoringText(textBlocks(data.message?.content))
      if (text !== '') rows.push({ role: '智能体', text })
    }
  }
  const selected = rows.slice(-8).map(row => `${row.role}：${row.text.replace(/\s+/g, ' ').slice(0, 700)}`)
  return [
    '[PAIMind 会话迁移摘要]',
    '已使用最新版智能体继续。',
    '以下是旧对话中仍需承接的可见上下文；旧工具记录与内部提示未复制。',
    ...(selected.length === 0 ? ['旧对话没有可迁移的可见消息。'] : selected),
    `原对话：${sourceSessionId}`,
  ].join('\n\n').slice(0, 6_000)
}

/** Resolve the native preset that was effective when the first human turn began. */
export function effectivePresetForFirstTurn(session: AgentBuilderHostSession): string | undefined {
  let effective = session.header?.agentPreset
  for (const row of session.events ?? []) {
    if (typeof row !== 'object' || row === null) continue
    const event = row as { readonly type?: unknown; readonly data?: unknown }
    if (event.type === 'user/message') {
      const data = event.data as { readonly source?: { readonly kind?: unknown } } | undefined
      if (data?.source?.kind === 'user') break
    }
    if (event.type !== 'agent-preset/selected') continue
    const data = event.data as { readonly agentPreset?: unknown } | undefined
    if (typeof data?.agentPreset === 'string' && AGENT_PRESET_ID.test(data.agentPreset)) effective = data.agentPreset
  }
  return effective
}

/** Find the last visible assistant reply before the second human turn. Tool-only steps do not complete verification. */
export function visibleAssistantReplyForFirstTurn(session: AgentBuilderHostSession): Readonly<{ seq?: unknown; text: string }> | undefined {
  let sawHuman = false
  let reply: Readonly<{ seq?: unknown; text: string }> | undefined
  for (const row of session.events ?? []) {
    if (typeof row !== 'object' || row === null) continue
    const event = row as { readonly type?: unknown; readonly seq?: unknown; readonly data?: unknown }
    if (event.type === 'user/message') {
      const data = event.data as { readonly source?: { readonly kind?: unknown } } | undefined
      if (data?.source?.kind !== 'user') continue
      if (sawHuman) break
      sawHuman = true
      continue
    }
    if (!sawHuman || event.type !== 'assistant/message') continue
    const data = event.data as { readonly message?: { readonly content?: unknown } } | undefined
    const text = visibleAgentAuthoringText(textBlocks(data?.message?.content))
    if (text !== '') reply = Object.freeze({ seq: event.seq, text })
  }
  return reply
}

/** Headless workflow service. Native Harness Presets remain the runtime source of truth. */
export class PaimindAgentProfileService extends PaimindHostRemoteService implements AgentBusinessSkillSelectionSource {
  static inject = ['settings', 'sessions', 'tools', 'agents', 'agentPresets', 'systemPrompt']
  private readonly presetRoot: string
  private readonly skillRoot: string
  private readonly stateRoot: string
  private readonly stateFile: string
  private readonly now: () => number
  /** Ephemeral structured draft context only. Skill availability is always validated against the live repository. */
  private readonly authoringTurnContexts = new Map<AgentBuilderHostAgent, PreparedAgentAuthoringTurn>()
  /** Agents already alive while a legacy filesystem projection is retired must be rebuilt; their child scope is immutable. */
  private readonly agentsStartedBeforeRuntimeReady = new WeakSet<AgentBuilderHostAgent>()
  private readonly retiredLegacyPresetIds = new Set<string>()
  private readonly blockedLegacyPresetIds = new Set<string>()
  private runtimePreparationError: unknown
  private runtimeReady = false
  private readonly runtimePreparation: Promise<void>
  private mutationTail: Promise<void> = Promise.resolve()
  private agentAuthoringCapabilityDisposer: (() => void) | undefined

  constructor(private readonly agentCtx: AgentBuilderHostContext, options: AgentBuilderOptions = {}) {
    super(agentCtx, 'paimindAgentProfiles')
    this.presetRoot = resolve(options.presetRoot ?? dshHomePath('.agent-presets'))
    this.skillRoot = resolve(options.skillRoot ?? (options.presetRoot === undefined
      ? dshHomePath(PAIMIND_BUSINESS_SKILL_REPOSITORY_DIRECTORY)
      : join(dirname(this.presetRoot), '.paimind-skill-market', 'skills')))
    this.stateRoot = resolve(options.stateRoot ?? dshHomePath('.paimind-agent-center'))
    this.stateFile = join(this.stateRoot, 'state.json')
    this.now = options.now ?? Date.now
    for (const agent of agentCtx.agents.list()) this.agentsStartedBeforeRuntimeReady.add(agent)
    this.runtimePreparation = this.retireLegacySkillFilesystemProvidersAtStartup()
      .catch(error => { this.runtimePreparationError = error })
      .finally(() => { this.runtimeReady = true })
    markPaimindHostRemoteMethods(this, [
      'listProfiles', 'saveProfile', 'setDefault', 'sealAuthoringSession', 'prepareAuthoringTurn', 'bindSession', 'migrationPlan',
      'listSessionBindings', 'recordMigration', 'recordVerification', 'verifySession', 'listAudit',
    ])
    agentCtx.effect(
      () => agentCtx.tools.register?.(this.agentSkillBindingTool()),
      'paimind-agent-builder: persistent Agent Skill binding Tool',
    )
    agentCtx.effect(() => {
      // Test/minimal hosts may omit one registry. Production injects both; an
      // explicit enable call still fails closed through the public actuator.
      if (agentCtx.skills === undefined || agentCtx.tools.register === undefined) return
      this.setAgentAuthoringEnabled(true)
      return () => { this.setAgentAuthoringEnabled(false) }
    }, 'paimind-agent-builder: atomic Agent authoring System Skill lifecycle')
    agentCtx.effect(() => agentCtx.on(
      'system-prompt/assemble',
      async (_assembly, context, next) => {
        const agent = context.agent
        // A normal Standard Session may contain a completed prepare-create Tool
        // result so the client can reopen its reviewable draft. That historical
        // result must not permanently downgrade the Session's Tool registry.
        // Only the dedicated authoring namespace is a sealed runtime boundary.
        if (!isDedicatedPaimindAgentAuthoringRuntime(agent?.session, agentCtx)) return next()
        const assembled = await next()
        const preparedContext = agent === undefined
          ? NATIVE_ENTRY_AUTHORING_CONTEXT
          : this.authoringTurnContexts.get(agent) ?? NATIVE_ENTRY_AUTHORING_CONTEXT
        return Object.freeze({
          ...assembled,
          contexts: Object.freeze([
            ...(assembled.contexts ?? []).filter(row => assembledContextName(row) !== AGENT_AUTHORING_DATA_CONTEXT),
            preparedAuthoringDataContext(preparedContext),
          ]),
          tools: Object.freeze(assembled.tools.filter(tool => {
            const name = assembledToolName(tool)
            return name !== undefined && AGENT_AUTHORING_ALLOWED_TOOLS.has(name)
          })),
        })
      },
      { prepend: true },
    ), 'paimind-agent-builder: authoring Tool allowlist with native Skill loading')
    agentCtx.effect(() => agentCtx.tools.guard(execution => {
      if (!isDedicatedPaimindAgentAuthoringRuntime(execution.agent?.session, agentCtx) || AGENT_AUTHORING_ALLOWED_TOOLS.has(execution.name)) return undefined
      return `PAIMind Agent authoring Sessions may call only ${[...AGENT_AUTHORING_ALLOWED_TOOLS].join(' and ')}; every other tool stays sealed until the user confirms and saves in the Agent Center.`
    }), 'paimind-agent-builder: dedicated authoring tool guard')
    agentCtx.effect(() => {
      const stopCreated = agentCtx.on('agent/created', ({ agent }) => {
        if (!this.runtimeReady) this.agentsStartedBeforeRuntimeReady.add(agent)
      })
      const stopPreStep = agentCtx.on('agent/pre-step', async ({ agent }, next) => {
        await this.runtimePreparation
        await this.assertNoLegacyFilesystemProvider(agent)
        return await next()
      })
      const stopDisposed = agentCtx.on('agent/disposed', ({ agent }) => {
        this.authoringTurnContexts.delete(agent)
        this.agentsStartedBeforeRuntimeReady.delete(agent)
      })
      return () => {
        try { stopDisposed() } finally {
          try { stopPreStep() } finally {
            stopCreated()
            this.authoringTurnContexts.clear()
          }
        }
      }
    }, 'paimind-agent-builder: startup legacy Provider retirement and ephemeral authoring lifecycle')
  }

  /** Source-owned control-plane metadata remains available while the capability is disabled. */
  describeAgentAuthoringCapability(): Readonly<AgentAuthoringCapabilityDescriptor> {
    return AGENT_AUTHORING_CAPABILITY_DESCRIPTOR
  }

  /**
   * Atomically expose or withdraw the Agent authoring Skill and its private
   * prepare Tool. Agent Skill binding and dedicated-Session guards are core
   * safety capabilities and intentionally remain outside this lifecycle.
   */
  setAgentAuthoringEnabled(enabled: boolean): void {
    if (!enabled) {
      const dispose = this.agentAuthoringCapabilityDisposer
      if (dispose === undefined) return
      dispose()
      this.agentAuthoringCapabilityDisposer = undefined
      return
    }
    if (this.agentAuthoringCapabilityDisposer !== undefined) return

    const skills = this.agentCtx.skills
    const tools = this.agentCtx.tools
    if (skills === undefined || tools.register === undefined) {
      throw new Error('Agent authoring System Skill 原子生命周期当前不可用')
    }

    // Parse the canonical body before changing either registry. The private
    // Tool then becomes callable before the public Skill summary appears.
    const content = packagedSkillBody(new URL('../SKILL.md', import.meta.url))
    let disposePrepare: (() => void) | undefined
    try {
      disposePrepare = tools.register(this.globalPrepareCreateTool())
      const disposeSkill = skills.register({
        name: PAIMIND_AGENT_AUTHORING_SKILL,
        description: PAIMIND_AGENT_AUTHORING_SKILL_DESCRIPTION,
        content,
        source: 'bundled',
        invocation: { modelInvocable: true, userInvocable: true },
      })
      this.agentAuthoringCapabilityDisposer = () => {
        // Hide discovery/body before withdrawing the Tool it describes.
        try { disposeSkill() } finally { disposePrepare?.() }
      }
    } catch (error) {
      try {
        disposePrepare?.()
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Agent authoring System Skill 启用失败且 Tool 回滚不完整',
        )
      }
      throw error
    }
  }

  /** Cordis awaits this barrier before declaring the source Plugin active. */
  async prepareRuntime(): Promise<void> {
    await this.runtimePreparation
  }

  private async retireLegacySkillFilesystemProvidersAtStartup(): Promise<void> {
    await this.withMutationLock(async () => {
      let entries
      try {
        entries = await readdir(this.presetRoot, { withFileTypes: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || !AGENT_PRESET_ID.test(entry.name)) continue
        try {
          if (await this.retireLegacySkillFilesystemProvider(join(this.presetRoot, entry.name))) {
            this.retiredLegacyPresetIds.add(entry.name)
          }
        } catch {
          // Keep the Plugin active so its pre-step guard can fail closed for
          // this exact Preset instead of leaving the legacy Provider usable.
          this.blockedLegacyPresetIds.add(entry.name)
        }
      }
    })
  }

  private async assertNoLegacyFilesystemProvider(agent: AgentBuilderHostAgent): Promise<void> {
    const presetId = effectivePresetForFirstTurn(agent.session)
    if (presetId === undefined || !AGENT_PRESET_ID.test(presetId)) return
    if (this.agentsStartedBeforeRuntimeReady.has(agent) && this.retiredLegacyPresetIds.has(presetId)) {
      throw new Error(`智能体 ${presetId} 的旧 Skill Provider 已在启动时迁移；当前 Session 在迁移前创建，必须重新打开后再执行`)
    }
    if (!this.blockedLegacyPresetIds.has(presetId) && this.runtimePreparationError === undefined) return
    let retired: boolean
    try {
      retired = await this.withMutationLock(async () => (
        await this.retireLegacySkillFilesystemProvider(join(this.presetRoot, presetId))
      ))
      this.blockedLegacyPresetIds.delete(presetId)
    } catch (error) {
      this.blockedLegacyPresetIds.add(presetId)
      throw new Error(`智能体 ${presetId} 的旧 Skill Provider 无法安全迁移，已阻止当前 Session 执行`, { cause: error })
    }
    if (!retired) return
    this.retiredLegacyPresetIds.add(presetId)
    this.agentsStartedBeforeRuntimeReady.add(agent)
    throw new Error(`智能体 ${presetId} 的旧 Skill Provider 刚刚完成迁移；当前 Session 已加载旧作用域，必须重新打开后再执行`)
  }

  /** Remove only the retired PAIMind filesystem row/directory; Profile references remain untouched. */
  private async retireLegacySkillFilesystemProvider(root: string): Promise<boolean> {
    const compositionFile = join(root, 'agent.cordis.yml')
    const composition = await readFile(compositionFile, 'utf8')
    const repairedComposition = removePresetSkillFilesystemOverride(composition)
    const legacyScope = join(root, AGENT_SKILL_SCOPE_DIRECTORY)
    if (repairedComposition === composition && await lstat(legacyScope).catch(() => undefined) === undefined) return false
    const presetId = root.slice(root.lastIndexOf(sep) + 1)
    const staging = join(this.stateRoot, 'staging', `${presetId}-runtime-${randomUUID()}`)
    const backup = join(this.stateRoot, 'backups', `${presetId}-runtime-${this.now()}-${randomUUID()}`)
    await mkdir(dirname(staging), { recursive: true, mode: 0o700 })
    await mkdir(dirname(backup), { recursive: true, mode: 0o700 })
    await cp(root, staging, { recursive: true, force: false })
    try {
      await rm(join(staging, AGENT_SKILL_SCOPE_DIRECTORY), { recursive: true, force: true })
      await writeFile(join(staging, 'agent.cordis.yml'), repairedComposition, { mode: 0o600 })
      await rename(root, backup)
      try { await rename(staging, root) } catch (error) { await rename(backup, root); throw error }
      return true
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  private globalPrepareCreateTool(): unknown {
    return definePaimindHarnessTool({
      name: PAIMIND_AGENT_PREPARE_CREATE_TOOL,
      description: 'Prepare one complete PAIMind Agent draft and activate the reviewable Agent Builder for the current Session. This does not save an Agent.',
      parameters: AUTHORING_PROPOSAL_INPUT_PROPERTIES,
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: { proposal: { ...AUTHORING_PROPOSAL_SCHEMA, required: true } },
        },
        render(_args, value) {
          return [{
            type: 'text',
            text: `<!--PAIMIND_AGENT_DRAFT\n${JSON.stringify(value.proposal)}\n-->\nThe Agent draft is ready for user review.`,
          }]
        },
      },
      execute: async (args, exec: PaimindToolRunContext) => {
        if (exec.agent === undefined) throw new Error('创建智能体需要当前 Harness Session')
        const live = this.agentCtx.sessions.get(exec.agent.id)
        if (live === undefined) throw new Error('当前 Harness Session 已失效')
        const liveAgent = this.agentCtx.agents.get(exec.agent.id)
        const context = liveAgent === undefined ? NATIVE_ENTRY_AUTHORING_CONTEXT : this.authoringTurnContexts.get(liveAgent) ?? NATIVE_ENTRY_AUTHORING_CONTEXT
        const proposal = authoringProposalFromToolArguments(args, context)
        try {
          await this.validateInstalledSkills(proposal.preferredSkillNames)
        } catch {
          throw new Error('创建草稿只能选择技能中心中当前已安装的业务 Skill')
        }
        return { proposal }
      },
      presentCall: () => ({ card: 'generic', title: 'Prepare Agent draft', kind: 'edit' }),
    })
  }

  private agentSkillBindingTool(): unknown {
    return definePaimindHarnessTool({
      name: PAIMIND_AGENT_SKILL_BINDING_TOOL,
      description: 'Inspect or update Business Skill binding for the PAIMind-managed Agent running the current Session. Call bind only after explicit user confirmation.',
      parameters: {
        operation: { type: 'string', required: true, enum: ['status', 'bind'] },
        skill_name: { type: 'string', required: true },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            operation: { type: 'string', required: true },
            bindable: { type: 'boolean', required: true },
            bound: { type: 'boolean', required: true },
            skillName: { type: 'string', required: true },
            agentId: { type: 'string' }, agentName: { type: 'string' },
            message: { type: 'string', required: true },
          },
        },
        render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] },
      },
      execute: async (args, exec: PaimindToolRunContext) => {
        if (exec.agent === undefined) throw new Error('Skill 绑定需要当前 Harness Session')
        const operation = args.operation
        if (operation !== 'status' && operation !== 'bind') throw new Error('不支持的 Skill 绑定操作')
        const skillName = bounded(args.skill_name as string, 120, 'Skill 名称', true)
        if (!SKILL_NAME.test(skillName)) throw new Error('Skill 名称无效')
        const skillFile = join(this.skillRoot, skillName, 'SKILL.md')
        if ((await stat(skillFile).catch(() => undefined))?.isFile() !== true) throw new Error('技能中心中未安装这个业务 Skill')
        const profile = await this.profileForSession(exec.agent.id)
        if (profile === undefined) {
          return {
            operation, bindable: false, bound: false, skillName,
            message: '当前 Session 未绑定 PAIMind 托管的 Agent；Skill 已保留在技能中心，不执行 Agent 绑定。',
          }
        }
        const alreadyBound = profile.preferredSkillNames.includes(skillName)
        if (operation === 'status' || alreadyBound) {
          return {
            operation, bindable: true, bound: alreadyBound, skillName,
            agentId: profile.agentId, agentName: profile.name,
            message: alreadyBound ? '该 Skill 已绑定当前 Agent。' : '当前 Agent 可以绑定该 Skill；绑定前需要用户明确确认。',
          }
        }
        const saved = await this.saveProfile({
          agentId: profile.agentId, presetId: profile.presetId, name: profile.name, description: profile.description,
          basePresetId: profile.basePresetId, role: profile.role, goal: profile.goal, behavior: profile.behavior,
          preferredSkillNames: [...profile.preferredSkillNames, skillName], instructions: profile.instructions,
          ...(profile.avatarId === undefined ? {} : { avatarId: profile.avatarId }),
          productKind: profile.productKind ?? 'personal',
          ...(profile.businessCategory === undefined ? {} : { businessCategory: profile.businessCategory }),
          ...(profile.businessCategoryId === undefined ? {} : { businessCategoryId: profile.businessCategoryId }),
          ...(profile.authoringSessionId === undefined ? {} : { authoringSessionId: profile.authoringSessionId }),
          ...(profile.authoringCursor === undefined ? {} : { authoringCursor: profile.authoringCursor }),
          expectedVersion: profile.configVersion,
        })
        return {
          operation, bindable: true, bound: true, skillName,
          agentId: saved.agentId, agentName: saved.name,
          message: 'Skill 已绑定当前 Agent；当前 Agent Session 从下一轮开始使用更新后的配置，历史消息不会改写。',
        }
      },
      presentCall: args => ({ card: 'generic', title: args.operation === 'bind' ? 'Bind Skill to Agent' : 'Check Agent Skill binding', kind: args.operation === 'bind' ? 'edit' : 'read' }),
    })
  }

  private async profileForSession(sessionId: string): Promise<Readonly<AgentBusinessProfile> | undefined> {
    const state = await this.readState()
    const binding = state.bindings[sessionId]
    const session = this.agentCtx.sessions.get(sessionId)
    const presetId = binding?.presetId ?? (session === undefined ? undefined : effectivePresetForFirstTurn(session))
    return (await this.listProfiles()).profiles.find(profile => profile.presetId === presetId)
  }

  private requireLiveAuthoringAgent(inputSessionId: string): Readonly<{
    sessionId: string
    agent: AgentBuilderHostAgent
    session: AgentBuilderHostSession
    agentPreset: string
  }> {
    const sessionId = bounded(inputSessionId, 200, '会话标识', true)
    const agent = this.agentCtx.agents.get(sessionId)
    const session = this.agentCtx.sessions.get(sessionId)
    if (agent === undefined || session === undefined || agent.id !== sessionId || agent.session !== session) {
      throw new Error('智能体创建会话尚未作为同一原生 Harness Agent 就绪')
    }
    const namespaceSession = AGENT_AUTHORING_SESSION_ID.test(sessionId)
    const effectivePreset = effectivePresetForFirstTurn(session)
    const composedPreset = this.agentCtx.agentPresets.composedPreset(agent.ctx) ?? effectivePreset
    if (namespaceSession && effectivePreset !== PAIMIND_STANDARD_AGENT_BASE_PRESET_ID) throw new Error('专用智能体创建会话必须使用 Harness standard 预设')
    if (namespaceSession && composedPreset !== PAIMIND_STANDARD_AGENT_BASE_PRESET_ID) {
      throw new Error('专用智能体创建会话当前运行的原生 Agent Preset 已不是 standard')
    }
    if (!isPaimindAgentAuthoringSession(session)) throw new Error('当前原生 Harness Session 不是智能体创建会话')
    const nativeSessionId = session.id ?? session.header?.id
    if (nativeSessionId !== sessionId) throw new Error('智能体创建会话与原生 Harness Agent 身份不一致')
    return Object.freeze({ sessionId, agent, session, agentPreset: composedPreset ?? PAIMIND_STANDARD_AGENT_BASE_PRESET_ID })
  }

  async listProfiles(): Promise<Readonly<AgentProfileSnapshot>> {
    return await this.withMutationLock(async () => {
      let entries
      try { entries = await readdir(this.presetRoot, { withFileTypes: true }) } catch { return Object.freeze({ profiles: Object.freeze([]) }) }
      const profiles: AgentBusinessProfile[] = []
      for (const entry of entries) {
        if (!entry.isDirectory() || !AGENT_PRESET_ID.test(entry.name)) continue
        const root = join(this.presetRoot, entry.name)
        const profile = await this.readProfile(root)
        if (profile === undefined) continue
        try {
          await this.ensureProfileProjection(root, profile)
          profiles.push(profile)
        } catch (error) {
          profiles.push(Object.freeze({ ...profile, health: 'broken', healthMessage: `智能体配置不可用：${String(error)}` }))
        }
      }
      return Object.freeze({ profiles: Object.freeze(profiles.sort((left, right) => right.updatedAt - left.updatedAt)) })
    })
  }

  /** Read the authoritative profile selection without projecting, repairing, or persisting any Skill state. */
  async connectionIdsForPreset(presetId: string): Promise<readonly string[]> {
    const profile = await this.readProfile(join(this.presetRoot, validateId(presetId, '预设标识')))
    return profile?.connectionIds ?? []
  }

  async businessSkillNamesForPreset(inputPresetId: string): Promise<readonly string[] | undefined> {
    const presetId = validateId(inputPresetId, '预设标识')
    const profile = await this.readProfile(join(this.presetRoot, presetId))
    if (profile === undefined || profile.presetId !== presetId) return undefined
    return Object.freeze([...profile.preferredSkillNames])
  }

  async saveProfile(input: AgentBusinessProfileInput): Promise<Readonly<AgentBusinessProfile>> {
    const saved = await this.withMutationLock(async () => {
      const agentId = validateId(input.agentId, '智能体标识')
      const presetId = validateId(input.presetId, '预设标识')
      const basePresetId = validateId(input.basePresetId, '基础能力模板')
      if (agentId !== presetId) throw new Error('智能体标识必须与预设标识一致')
      const source = join(this.presetRoot, presetId)
      const sourceStat = await stat(source).catch(() => undefined)
      if (sourceStat?.isDirectory() !== true) throw new Error('请先通过 Harness 创建个人预设')
      const previous = await this.readProfile(source)
      if (input.expectedVersion !== undefined && previous?.configVersion !== input.expectedVersion) throw new Error('智能体已更新，请刷新后重试')
      if (previous !== undefined && (previous.agentId !== agentId || previous.presetId !== presetId)) throw new Error('智能体标识和预设标识不可修改')
      if (previous !== undefined && previous.basePresetId !== basePresetId) {
        throw new Error('旧版智能体需要先基于标准模板重新创建')
      }
      const connections = this.agentCtx.get('paimindMcpConnections') as { validateSelection(ids: readonly string[]): Promise<void>; bindingsChanged(): Promise<void> } | undefined
      const connectionIds = input.connectionIds ?? previous?.connectionIds ?? []
      const additions = connectionIds.filter(id => !previous?.connectionIds?.includes(id))
      if (additions.length > 0) {
        if (connections === undefined) throw new Error('连接中心不可用')
        await connections.validateSelection(additions)
      }
      const profile = stableProfile({
        ...input, connectionIds,
        ...(input.authoringSessionId === undefined && previous?.authoringSessionId !== undefined ? { authoringSessionId: previous.authoringSessionId } : {}),
        ...(input.authoringCursor === undefined && previous?.authoringCursor !== undefined ? { authoringCursor: previous.authoringCursor } : {}),
      }, (previous?.revision ?? 0) + 1, this.now())
      const staging = join(this.stateRoot, 'staging', `${presetId}-${randomUUID()}`)
      const backup = join(this.stateRoot, 'backups', `${presetId}-${this.now()}-${randomUUID()}`)
      await mkdir(dirname(staging), { recursive: true, mode: 0o700 })
      await mkdir(dirname(backup), { recursive: true, mode: 0o700 })
      await cp(source, staging, { recursive: true, force: false })
      try {
        const compositionFile = join(staging, 'agent.cordis.yml')
        const composition = await readFile(compositionFile, 'utf8')
        const withPersona = replacePresetPersona(composition, profile)
        await this.validateInstalledSkills(profile.preferredSkillNames)
        await rm(join(staging, AGENT_SKILL_SCOPE_DIRECTORY), { recursive: true, force: true })
        await writeFile(compositionFile, removePresetSkillFilesystemOverride(withPersona), { mode: 0o600 })
        await writeFile(join(staging, 'preset.yml'), presetMetadata(profile), { mode: 0o600 })
        await writeFile(join(staging, AGENT_PROFILE_FILE), `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 })
        await rename(source, backup)
        try { await rename(staging, source) } catch (error) { await rename(backup, source); throw error }
        return profile
      } catch (error) {
        await rm(staging, { recursive: true, force: true })
        throw error
      }
    })
    await (this.agentCtx.get('paimindMcpConnections') as { bindingsChanged(): Promise<void> } | undefined)?.bindingsChanged()
    return saved
  }

  async setDefault(input: { readonly presetId: string }): Promise<{ readonly presetId: string }> {
    const presetId = validateId(input.presetId, '预设标识')
    const settings = this.agentCtx.get('settings')
    if (settings === undefined) throw new Error('当前 Harness 设置不可用')
    const descriptor = describePaimindHostSettings(settings, 'agent-presets')
    if (descriptor === undefined || !descriptor.writable) throw new Error('当前 Harness 设置不可写')
    await mutatePaimindHostSettings(settings, 'agent-presets', 'default', presetId, descriptor.revision)
    return Object.freeze({ presetId })
  }

  /**
   * Delete an unreferenced PAIMind Agent through its native Preset owner.
   * A durable Session can only be reconstructed while its selected Preset
   * still exists, so deleting a referenced Preset would corrupt cold resume.
   */
  async removeProfile(input: { readonly presetId: string }): Promise<Readonly<{
    readonly presetId: string
    readonly removed: true
  }>> {
    const presetId = validateId(input.presetId, '预设标识')
    const profile = (await this.listProfiles()).profiles.find(row => row.presetId === presetId)
    if (profile === undefined) throw new Error('智能体不存在或已经删除')
    const state = await this.readState()
    const referenced = Object.values(state.bindings).filter(binding => binding.presetId === presetId)
    if (referenced.length > 0) {
      throw new Error(`该智能体仍被 ${referenced.length} 个历史会话使用；请先迁移或删除这些会话，再删除智能体`)
    }
    if (this.agentCtx.agentPresets.remove === undefined) throw new Error('当前 Harness 不支持删除个人智能体')
    await this.agentCtx.agentPresets.remove(presetId)
    return Object.freeze({ presetId, removed: true })
  }

  /** Validate one native Standard authoring Session. Its workflow comes from the canonical bundled Skill. */
  async sealAuthoringSession(input: { readonly sessionId: string }): Promise<Readonly<{
    readonly sessionId: string
    readonly agentPreset: string
    readonly sealed: true
  }>> {
    const { sessionId, agentPreset } = this.requireLiveAuthoringAgent(input.sessionId)
    return Object.freeze({ sessionId, agentPreset, sealed: true })
  }

  /** Replace the ephemeral validation context used by the structured prepare-create Tool. */
  async prepareAuthoringTurn(input: AgentAuthoringTurnInput): Promise<Readonly<{
    readonly sessionId: string
    readonly agentPreset: string
    readonly prepared: true
  }>> {
    const { sessionId, agent, agentPreset } = this.requireLiveAuthoringAgent(input.sessionId)
    const context = normalizeAuthoringTurn(input)
    this.authoringTurnContexts.set(agent, context)
    return Object.freeze({ sessionId, agentPreset, prepared: true })
  }

  async bindSession(input: Omit<AgentSessionBinding, 'boundAt'>): Promise<Readonly<AgentSessionBinding>> {
    const profile = (await this.listProfiles()).profiles.find(row => row.agentId === input.agentId)
    if (profile === undefined || profile.presetId !== input.presetId || profile.configVersion !== input.configVersion) throw new Error('智能体配置版本不匹配')
    const binding = Object.freeze({ ...input, sessionId: bounded(input.sessionId, 200, '会话标识', true), boundAt: this.now() })
    await this.mutateState(state => ({ ...state, bindings: Object.freeze({ ...state.bindings, [binding.sessionId]: binding }) }))
    return binding
  }

  /** Read durable native Session bindings so product surfaces can project their own Session types. */
  async listSessionBindings(): Promise<Readonly<{ bindings: readonly Readonly<AgentSessionBinding>[] }>> {
    const state = await this.readState()
    return Object.freeze({
      bindings: Object.freeze(Object.values(state.bindings).sort((left, right) => right.boundAt - left.boundAt)),
    })
  }

  async migrationPlan(input: { readonly sourceSessionId: string }): Promise<Readonly<AgentMigrationPlan> | null> {
    const state = await this.readState()
    const binding = state.bindings[input.sourceSessionId]
    if (binding === undefined || state.migrations.some(row => row.sourceSessionId === input.sourceSessionId && row.fromVersion === binding.configVersion)) return null
    const profile = (await this.listProfiles()).profiles.find(row => row.agentId === binding.agentId)
    if (profile === undefined || profile.configVersion === binding.configVersion) return null
    const events = this.agentCtx.sessions?.get(input.sourceSessionId)?.events ?? []
    return Object.freeze({
      sourceSessionId: input.sourceSessionId, agentId: binding.agentId,
      presetId: profile.presetId, fromVersion: binding.configVersion, toVersion: profile.configVersion,
      summary: summarizeConversationEvents(events, input.sourceSessionId),
    })
  }

  async recordMigration(input: Omit<AgentMigrationRecord, 'migratedAt'>): Promise<Readonly<AgentMigrationRecord>> {
    const record = Object.freeze({ ...input, migratedAt: this.now() })
    await this.mutateState(state => ({
      ...state,
      bindings: Object.freeze({ ...state.bindings, [record.targetSessionId]: Object.freeze({
        sessionId: record.targetSessionId, agentId: record.agentId, presetId: record.presetId,
        configVersion: record.toVersion, boundAt: record.migratedAt,
      }) }),
      migrations: Object.freeze([...state.migrations, record].slice(-200)),
    }))
    return record
  }

  async recordVerification(input: Omit<AgentVerificationRecord, 'verifiedAt'>): Promise<Readonly<AgentVerificationRecord>> {
    const record = Object.freeze({ ...input, message: bounded(input.message, 1_000, '验收说明', true), verifiedAt: this.now() })
    await this.mutateState(state => ({
      ...state,
      verifications: Object.freeze([
        ...state.verifications.filter(row => !(row.sessionId === record.sessionId
          && row.configVersion === record.configVersion && row.firstTurnId === record.firstTurnId)),
        record,
      ].slice(-200)),
    }))
    return record
  }

  async verifySession(input: { readonly sessionId: string }): Promise<Readonly<AgentVerificationRecord>> {
    const state = await this.readState()
    const binding = state.bindings[input.sessionId]
    if (binding === undefined) throw new Error('会话未绑定个人智能体')
    const profile = (await this.listProfiles()).profiles.find(row => row.agentId === binding.agentId)
    const session = this.agentCtx.sessions?.get(input.sessionId)
    const events = session?.events ?? []
    const firstUser = events.find(event => {
      if (typeof event !== 'object' || event === null || (event as { type?: unknown }).type !== 'user/message') return false
      const data = (event as { readonly data?: unknown }).data as { readonly source?: { readonly kind?: unknown } } | undefined
      return data?.source?.kind === 'user'
    }) as { readonly seq?: unknown } | undefined
    const firstAssistant = session === undefined ? undefined : visibleAssistantReplyForFirstTurn(session)
    const valid = profile !== undefined && profile.configVersion === binding.configVersion
      && session !== undefined && effectivePresetForFirstTurn(session) === binding.presetId
      && firstUser !== undefined && firstAssistant !== undefined
    return await this.recordVerification({
      sessionId: input.sessionId, agentId: binding.agentId, presetId: binding.presetId,
      configVersion: binding.configVersion, firstTurnId: `event:${String(firstAssistant?.seq ?? 'unknown')}`,
      result: valid ? 'passed' : 'failed',
      message: valid ? '真实首轮已完成，预设绑定与配置版本一致。' : '真实首轮、预设绑定或配置版本校验失败。',
    })
  }

  async listAudit(): Promise<Readonly<{ migrations: readonly AgentMigrationRecord[]; verifications: readonly AgentVerificationRecord[] }>> {
    const state = await this.readState()
    return Object.freeze({ migrations: state.migrations, verifications: state.verifications })
  }

  private async readProfile(root: string): Promise<AgentBusinessProfile | undefined> {
    try {
      const value = JSON.parse(await readFile(join(root, AGENT_PROFILE_FILE), 'utf8')) as Partial<AgentBusinessProfile>
      if (typeof value.agentId !== 'string' || typeof value.presetId !== 'string' || typeof value.name !== 'string'
        || typeof value.description !== 'string' || typeof value.basePresetId !== 'string' || typeof value.role !== 'string'
        || typeof value.goal !== 'string' || typeof value.behavior !== 'string' || !Array.isArray(value.preferredSkillNames)
        || typeof value.instructions !== 'string' || typeof value.revision !== 'number' || typeof value.configVersion !== 'string'
        || typeof value.updatedAt !== 'number') return undefined
      const productKind: AgentProfileKind = value.productKind === undefined ? 'personal' : value.productKind
      if (productKind !== 'personal' && productKind !== 'business') return undefined
      if (productKind === 'business' && (typeof value.businessCategory !== 'string' || value.businessCategory.trim() === ''
        || typeof value.businessCategoryId !== 'string' || !AGENT_PRESET_ID.test(value.businessCategoryId))) return undefined
      return Object.freeze({
        ...value, productKind,
        preferredSkillNames: Object.freeze(value.preferredSkillNames.filter((row): row is string => typeof row === 'string')),
        ...(value.connectionIds === undefined ? {} : { connectionIds: Array.isArray(value.connectionIds) && value.connectionIds.every(id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id)) ? Object.freeze([...value.connectionIds]) : (() => { throw new Error('持久连接引用无效') })() }),
        health: 'healthy',
      }) as AgentBusinessProfile
    } catch { return undefined }
  }

  private async ensureProfileProjection(root: string, profile: AgentBusinessProfile): Promise<void> {
    if (profile.basePresetId !== PAIMIND_STANDARD_AGENT_BASE_PRESET_ID) throw new Error('旧版智能体未迁移到标准基座')
    const compositionFile = join(root, 'agent.cordis.yml')
    const composition = await readFile(compositionFile, 'utf8')
    await this.validateInstalledSkills(profile.preferredSkillNames)
    const repairedComposition = removePresetSkillFilesystemOverride(replacePresetPersona(composition, profile))
    const legacyScope = join(root, AGENT_SKILL_SCOPE_DIRECTORY)
    if (repairedComposition === composition && await stat(legacyScope).catch(() => undefined) === undefined) return
    const staging = join(this.stateRoot, 'staging', `${profile.presetId}-profile-${randomUUID()}`)
    const backup = join(this.stateRoot, 'backups', `${profile.presetId}-profile-${this.now()}-${randomUUID()}`)
    await mkdir(dirname(staging), { recursive: true, mode: 0o700 })
    await mkdir(dirname(backup), { recursive: true, mode: 0o700 })
    await cp(root, staging, { recursive: true, force: false })
    try {
      await rm(join(staging, AGENT_SKILL_SCOPE_DIRECTORY), { recursive: true, force: true })
      await writeFile(join(staging, 'agent.cordis.yml'), repairedComposition, { mode: 0o600 })
      await rename(root, backup)
      try { await rename(staging, root) } catch (error) { await rename(backup, root); throw error }
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  private async validateInstalledSkills(names: readonly string[]): Promise<readonly { readonly name: string; readonly path: string }[]> {
    const systemNames = new Set<string>(PAIMIND_SYSTEM_SKILL_NAMES)
    for (const skill of await this.agentCtx.skills?.list?.() ?? []) systemNames.add(skill.name)
    const collision = names.find(name => systemNames.has(name))
    if (collision !== undefined) throw new Error(`Skill 名称与当前系统能力冲突：${collision}`)
    const root = await realpath(this.skillRoot).catch(() => this.skillRoot)
    const rows: Array<{ readonly name: string; readonly path: string }> = []
    for (const name of names) {
      if (!SKILL_NAME.test(name)) throw new Error(`Skill 名称无效：${name}`)
      const candidate = join(this.skillRoot, name)
      const resolved = await realpath(candidate).catch(() => undefined)
      if (resolved === undefined || !(await stat(resolved)).isDirectory()) throw new Error(`已封装 Skill 不再存在：${name}`)
      const rel = relative(root, resolved)
      if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Skill 路径越界：${name}`)
      if ((await stat(join(resolved, 'SKILL.md')).catch(() => undefined))?.isFile() !== true) throw new Error(`已封装 Skill 缺少 SKILL.md：${name}`)
      rows.push(Object.freeze({ name, path: resolved }))
    }
    return Object.freeze(rows)
  }

  private async readState(): Promise<AgentCenterState> {
    try {
      const value = JSON.parse(await readFile(this.stateFile, 'utf8')) as Partial<AgentCenterState>
      if (value.schemaVersion !== STATE_VERSION || typeof value.bindings !== 'object' || value.bindings === null
        || !Array.isArray(value.migrations) || !Array.isArray(value.verifications)) return defaultState()
      return Object.freeze({ schemaVersion: STATE_VERSION, bindings: Object.freeze(value.bindings), migrations: Object.freeze(value.migrations), verifications: Object.freeze(value.verifications) }) as AgentCenterState
    } catch { return defaultState() }
  }

  private async mutateState(update: (state: AgentCenterState) => AgentCenterState): Promise<void> {
    const execute = async (): Promise<void> => {
      const next = update(await this.readState())
      await mkdir(this.stateRoot, { recursive: true, mode: 0o700 })
      const temporary = join(this.stateRoot, `state-${randomUUID()}.tmp`)
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, this.stateFile)
    }
    await this.withMutationLock(execute)
  }

  /** One service-local queue protects every filesystem read-check-write transaction and repair swap. */
  private async withMutationLock<Result>(execute: () => Promise<Result>): Promise<Result> {
    const pending = this.mutationTail.then(execute, execute)
    this.mutationTail = pending.then(() => undefined, () => undefined)
    return await pending
  }
}

export async function apply(ctx: AgentBuilderHostContext): Promise<void> {
  const service = new PaimindAgentProfileService(ctx)
  await service.prepareRuntime()
}
