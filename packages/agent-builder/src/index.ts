import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  PaimindHostRemoteService,
  describePaimindHostSettings,
  markPaimindHostRemoteMethods,
  mutatePaimindHostSettings,
  type PaimindHostSettingsFacility,
} from '@paimind/harness-compat/host'

export const name = 'paimind-agent-builder'
export const inject = ['settings', 'sessions']
export const AGENT_PROFILE_FILE = '.paimind-agent.json'
export const AGENT_PRESET_ID = /^[a-z0-9][a-z0-9-_]*$/
export const AGENT_SKILL_SCOPE_DIRECTORY = '.paimind-skills'
const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/
const CONTROL = /[\u0000-\u001f\u007f]/g
const STATE_VERSION = 1

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
  readonly instructions: string
  /** Product placement only; execution and Preset ownership remain Harness-native. */
  readonly productKind?: AgentProfileKind
  readonly businessCategory?: string
  readonly businessCategoryId?: string
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
  readonly header?: { readonly agentPreset?: string }
  readonly events?: readonly unknown[]
}

export interface AgentBuilderHostContext {
  readonly sessions?: { get(id: string): AgentBuilderHostSession | undefined }
  get(name: 'settings'): PaimindHostSettingsFacility | undefined
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

export interface AgentBuilderOptions {
  readonly presetRoot?: string
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
  const name = bounded(input.name, 80, '名称', true)
  const description = bounded(input.description, 500, '描述')
  const role = bounded(input.role, 2_000, '角色', true)
  const goal = bounded(input.goal, 2_000, '目标', true)
  const behavior = bounded(input.behavior, 4_000, '行为规范', true)
  const instructions = bounded(input.instructions, 4_000, '补充要求')
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
  if (basePresetId === 'minimal' && preferredSkillNames.length > 0) throw new Error('极简模式不可封装 Skill')
  const seed = {
    agentId, presetId, name, description, basePresetId, role, goal, behavior, preferredSkillNames, instructions,
    productKind, ...businessPlacement, revision,
  }
  const digest = createHash('sha256').update(JSON.stringify(seed)).digest('hex').slice(0, 16)
  return Object.freeze({ ...seed, configVersion: `v${revision}-${digest}`, updatedAt, health: 'healthy' })
}

function personaText(profile: AgentBusinessProfile): string {
  return [
    `You are ${profile.name}, an agent running on DeepSeek Harness. Your working directory is {{cwd}}.`,
    '', 'Role:', profile.role,
    '', 'Goal:', profile.goal,
    '', 'Behavior rules:', profile.behavior,
    ...(profile.preferredSkillNames.length === 0 ? [] : ['', 'Session-injected Skills:', profile.preferredSkillNames.map(value => `- ${value}`).join('\n')]),
    ...(profile.instructions === '' ? [] : ['', 'Additional requirements:', profile.instructions]),
  ].join('\n')
}

/** Restrict one copied native Preset to its explicitly packaged Skill projection. */
export function replacePresetSkillScope(content: string, skillScopeRoot: string, configVersion: string): string {
  const match = /(?:^# PAIMind skill scope:[^\n]*\n)?^- id:\s*skill-filesystem\s*$/m.exec(content)
  if (match === null) throw new Error('基础能力模板缺少 skill-filesystem 配置')
  const start = match.index
  const rowStart = content.indexOf('- id:', start)
  const next = content.slice(rowStart + 1).search(/^- id:\s*/m)
  const end = next < 0 ? content.length : rowStart + 1 + next
  const replacement = [
    `# PAIMind skill scope: ${configVersion}`,
    '- id: skill-filesystem',
    "  name: '@deepseek-ai/dsh-skill-filesystem'",
    '  config:',
    "    providerName: 'paimind-agent-scope'",
    '    includeDefaultRoots: false',
    '    customSkillDirs:',
    `      - ${JSON.stringify(resolve(skillScopeRoot))}`,
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

function textBlocks(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.map(block => {
    if (typeof block !== 'object' || block === null) return ''
    const candidate = block as { readonly type?: unknown; readonly text?: unknown }
    return candidate.type === 'text' && typeof candidate.text === 'string' ? candidate.text : ''
  }).filter(Boolean).join('\n')
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
      const text = textBlocks(data.message?.content).trim()
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
    const text = textBlocks(data?.message?.content).trim()
    if (text !== '') reply = Object.freeze({ seq: event.seq, text })
  }
  return reply
}

/** Headless workflow service. Native Harness Presets remain the runtime source of truth. */
export class PaimindAgentProfileService extends PaimindHostRemoteService {
  static inject = ['settings', 'sessions']
  private readonly presetRoot: string
  private readonly skillRoot: string
  private readonly stateRoot: string
  private readonly stateFile: string
  private readonly now: () => number
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(private readonly agentCtx: AgentBuilderHostContext, options: AgentBuilderOptions = {}) {
    super(agentCtx, 'paimindAgentProfiles')
    this.presetRoot = resolve(options.presetRoot ?? dshHomePath('.agent-presets'))
    this.skillRoot = resolve(options.presetRoot === undefined ? dshHomePath('skills') : join(dirname(this.presetRoot), 'skills'))
    this.stateRoot = resolve(options.stateRoot ?? dshHomePath('.paimind-agent-center'))
    this.stateFile = join(this.stateRoot, 'state.json')
    this.now = options.now ?? Date.now
    markPaimindHostRemoteMethods(this, [
      'listProfiles', 'saveProfile', 'setDefault', 'bindSession', 'migrationPlan',
      'recordMigration', 'recordVerification', 'verifySession', 'listAudit',
    ])
  }

  async listProfiles(): Promise<Readonly<AgentProfileSnapshot>> {
    let entries
    try { entries = await readdir(this.presetRoot, { withFileTypes: true }) } catch { return Object.freeze({ profiles: Object.freeze([]) }) }
    const profiles: AgentBusinessProfile[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !AGENT_PRESET_ID.test(entry.name)) continue
      const root = join(this.presetRoot, entry.name)
      const profile = await this.readProfile(root)
      if (profile === undefined) continue
      try {
        await this.ensureSkillScope(root, profile)
        profiles.push(profile)
      } catch (error) {
        profiles.push(Object.freeze({ ...profile, health: 'broken', healthMessage: `会话技能范围不可用：${String(error)}` }))
      }
    }
    return Object.freeze({ profiles: Object.freeze(profiles.sort((left, right) => right.updatedAt - left.updatedAt)) })
  }

  async saveProfile(input: AgentBusinessProfileInput): Promise<Readonly<AgentBusinessProfile>> {
    const presetId = validateId(input.presetId, '预设标识')
    const source = join(this.presetRoot, presetId)
    const sourceStat = await stat(source).catch(() => undefined)
    if (sourceStat?.isDirectory() !== true) throw new Error('请先通过 Harness 创建个人预设')
    const previous = await this.readProfile(source)
    if (input.expectedVersion !== undefined && previous?.configVersion !== input.expectedVersion) throw new Error('智能体已更新，请刷新后重试')
    const profile = stableProfile(input, (previous?.revision ?? 0) + 1, this.now())
    const staging = join(this.stateRoot, 'staging', `${presetId}-${randomUUID()}`)
    const backup = join(this.stateRoot, 'backups', `${presetId}-${this.now()}-${randomUUID()}`)
    await mkdir(dirname(staging), { recursive: true, mode: 0o700 })
    await mkdir(dirname(backup), { recursive: true, mode: 0o700 })
    await cp(source, staging, { recursive: true, force: false })
    try {
      const compositionFile = join(staging, 'agent.cordis.yml')
      const composition = await readFile(compositionFile, 'utf8')
      const withPersona = replacePresetPersona(composition, profile)
      const scopedComposition = profile.basePresetId === 'minimal'
        ? withPersona
        : replacePresetSkillScope(withPersona, join(source, AGENT_SKILL_SCOPE_DIRECTORY), profile.configVersion)
      await this.createSkillScope(staging, profile)
      await writeFile(compositionFile, scopedComposition, { mode: 0o600 })
      await writeFile(join(staging, 'preset.yml'), presetMetadata(profile), { mode: 0o600 })
      await writeFile(join(staging, AGENT_PROFILE_FILE), `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 })
      await rename(source, backup)
      try { await rename(staging, source) } catch (error) { await rename(backup, source); throw error }
      return profile
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
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

  async bindSession(input: Omit<AgentSessionBinding, 'boundAt'>): Promise<Readonly<AgentSessionBinding>> {
    const profile = (await this.listProfiles()).profiles.find(row => row.agentId === input.agentId)
    if (profile === undefined || profile.presetId !== input.presetId || profile.configVersion !== input.configVersion) throw new Error('智能体配置版本不匹配')
    const binding = Object.freeze({ ...input, sessionId: bounded(input.sessionId, 200, '会话标识', true), boundAt: this.now() })
    await this.mutateState(state => ({ ...state, bindings: Object.freeze({ ...state.bindings, [binding.sessionId]: binding }) }))
    return binding
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
        health: 'healthy',
      }) as AgentBusinessProfile
    } catch { return undefined }
  }

  private async ensureSkillScope(root: string, profile: AgentBusinessProfile): Promise<void> {
    if (profile.basePresetId === 'minimal') return
    const compositionFile = join(root, 'agent.cordis.yml')
    const composition = await readFile(compositionFile, 'utf8')
    const withPersona = replacePresetPersona(composition, profile)
    const installedSkills = await this.validateInstalledSkills(profile.preferredSkillNames)
    if (composition.includes(`# PAIMind skill scope: ${profile.configVersion}`)
      && withPersona === composition && await this.skillScopeMatches(root, installedSkills)) return
    const staging = join(this.stateRoot, 'staging', `${profile.presetId}-scope-${randomUUID()}`)
    const backup = join(this.stateRoot, 'backups', `${profile.presetId}-scope-${this.now()}-${randomUUID()}`)
    await mkdir(dirname(staging), { recursive: true, mode: 0o700 })
    await mkdir(dirname(backup), { recursive: true, mode: 0o700 })
    await cp(root, staging, { recursive: true, force: false })
    try {
      await this.createSkillScope(staging, profile)
      await writeFile(
        join(staging, 'agent.cordis.yml'),
        replacePresetSkillScope(withPersona, join(root, AGENT_SKILL_SCOPE_DIRECTORY), profile.configVersion),
        { mode: 0o600 },
      )
      await rename(root, backup)
      try { await rename(staging, root) } catch (error) { await rename(backup, root); throw error }
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  private async createSkillScope(stagingPresetRoot: string, profile: AgentBusinessProfile): Promise<void> {
    const scopeRoot = join(stagingPresetRoot, AGENT_SKILL_SCOPE_DIRECTORY)
    await rm(scopeRoot, { recursive: true, force: true })
    await mkdir(scopeRoot, { recursive: true, mode: 0o700 })
    if (profile.basePresetId === 'minimal') return
    const skills = await this.validateInstalledSkills(profile.preferredSkillNames)
    for (const skill of skills) {
      await symlink(skill.path, join(scopeRoot, skill.name), process.platform === 'win32' ? 'junction' : 'dir')
    }
  }

  private async skillScopeMatches(
    presetRoot: string,
    expected: readonly { readonly name: string; readonly path: string }[],
  ): Promise<boolean> {
    const scopeRoot = join(presetRoot, AGENT_SKILL_SCOPE_DIRECTORY)
    const entries = await readdir(scopeRoot, { withFileTypes: true }).catch(() => undefined)
    if (entries === undefined || entries.length !== expected.length) return false
    const byName = new Map(expected.map(row => [row.name, row.path]))
    for (const entry of entries) {
      const expectedPath = byName.get(entry.name)
      if (expectedPath === undefined) return false
      const actualPath = await realpath(join(scopeRoot, entry.name)).catch(() => undefined)
      if (actualPath !== expectedPath) return false
    }
    return true
  }

  private async validateInstalledSkills(names: readonly string[]): Promise<readonly { readonly name: string; readonly path: string }[]> {
    const root = await realpath(this.skillRoot).catch(() => this.skillRoot)
    const rows: Array<{ readonly name: string; readonly path: string }> = []
    for (const name of names) {
      if (!SKILL_NAME.test(name)) throw new Error(`Skill 名称无效：${name}`)
      const candidate = join(this.skillRoot, name)
      const resolved = await realpath(candidate).catch(() => undefined)
      if (resolved === undefined || !(await stat(resolved)).isDirectory()) throw new Error(`已封装 Skill 不再存在：${name}`)
      const rel = relative(root, resolved)
      if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Skill 路径越界：${name}`)
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
    const pending = this.mutationTail.then(execute, execute)
    this.mutationTail = pending.catch(() => {})
    await pending
  }
}

export function apply(ctx: AgentBuilderHostContext): void {
  new PaimindAgentProfileService(ctx)
}
