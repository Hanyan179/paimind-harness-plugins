import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_AUTHORING_PROPOSAL_TOOL,
  AGENT_PROFILE_FILE,
  AGENT_SKILL_SCOPE_DIRECTORY,
  PaimindAgentProfileService,
  effectivePresetForFirstTurn,
  isPaimindAgentAuthoringSession,
  replacePresetPersona,
  replacePresetSkillScope,
  summarizeConversationEvents,
  visibleAssistantReplyForFirstTurn,
  type AgentAuthoringDraftContext,
  type AgentBusinessProfile,
} from '../src/index.js'
import { PAIMIND_AGENT_PROFILE_REMOTE_DESCRIPTORS } from '../src/remote.js'

const roots: string[] = []
const authoringPolicyStubs = {
  agents: { get: (_id: string) => undefined, list: () => [] },
  tools: { guard: (_listener: unknown) => () => {} },
  agentPresets: { composedPreset: (_agentContext: unknown) => undefined },
  on: (_event: string, _listener: unknown) => () => {},
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const profile: AgentBusinessProfile = {
  agentId: 'my-agent', presetId: 'my-agent', name: 'Evidence Agent', description: 'Evidence first',
  basePresetId: 'standard', role: 'Act as a product analyst.', goal: 'Produce decision-ready findings.',
  behavior: 'Start every answer with [EVIDENCE].', preferredSkillNames: ['web-research'],
  instructions: 'Keep responses concise.', revision: 1, configVersion: 'v1-test', updatedAt: 1, health: 'healthy',
}

const authoringDraft: AgentAuthoringDraftContext = {
  productKind: 'personal', businessCategory: '', name: 'Research Assistant', description: 'Research decisions',
  basePresetId: 'standard', role: 'Act as a research specialist.', goal: 'Produce a useful brief.',
  behavior: 'Separate facts and recommendations.', instructions: 'Stay concise.', preferredSkillNames: ['web-research'],
}

describe('headless Agent profile workflow', () => {
  it('seals one namespaced native cordis Session with a complete prompt scope and monotonic tool denial', async () => {
    const sessionId = 'paimind-authoring-123e4567-e89b-12d3-a456-426614174000'
    const session = {
      id: sessionId, header: { id: sessionId, agentPreset: 'cordis' }, events: [],
    }
    const section = vi.fn(() => () => {})
    const suppressRuntimeContext = vi.fn(() => () => {})
    const presentAs = vi.fn(() => () => {})
    const restrict = vi.fn(() => () => {})
    let proposalTool: {
      readonly name: string
      execute(args: unknown, execution: unknown): Promise<unknown>
      presentCall?: (args: unknown) => unknown
      presentResult?: (args: unknown, result: { readonly isError: boolean }) => unknown
    } | undefined
    const register = vi.fn((definition: typeof proposalTool) => { proposalTool = definition; return () => {} })
    const agent = {
      id: sessionId,
      session,
      ctx: { systemPrompt: { section, suppressRuntimeContext }, tools: { presentAs, restrict, register } },
    }
    let composedPreset = 'cordis'
    let guard: ((execution: { readonly name: string; readonly agent?: typeof agent }) => string | undefined) | undefined
    let assemble: ((
      assembly: { readonly tools: readonly unknown[] },
      context: { readonly agent?: { readonly session?: typeof session } },
      next: () => Promise<{ readonly tools: readonly unknown[] }>,
    ) => Promise<{ readonly tools: readonly unknown[] }>) | undefined
    const context = {
      reflect: { provide: () => {} }, get: () => undefined,
      effect(install: () => void | (() => void)) { install() },
      sessions: { get: (id: string) => id === sessionId ? session : undefined },
      agents: { get: (id: string) => id === sessionId ? agent : undefined, list: () => [] },
      tools: { guard(listener: typeof guard) { guard = listener; return () => {} } },
      agentPresets: { composedPreset: () => composedPreset },
      on(event: string, listener: typeof assemble) { if (event === 'system-prompt/assemble') assemble = listener; return () => {} },
    }
    const service = new PaimindAgentProfileService(context as never)

    await expect(service.sealAuthoringSession({ sessionId })).resolves.toEqual({
      sessionId, agentPreset: 'cordis', sealed: true,
    })
    await expect(service.sealAuthoringSession({ sessionId })).resolves.toEqual({
      sessionId, agentPreset: 'cordis', sealed: true,
    })
    expect(session.events).toHaveLength(0)
    expect(isPaimindAgentAuthoringSession(session)).toBe(true)
    expect(section).toHaveBeenCalledOnce()
    expect(section).toHaveBeenCalledWith(expect.objectContaining({ complete: true, name: 'paimind:agent-authoring' }))
    expect(suppressRuntimeContext).toHaveBeenCalledOnce()
    expect(presentAs).toHaveBeenCalledWith('native')
    expect(restrict).toHaveBeenCalledWith({ allow: [] })
    expect(register).toHaveBeenCalledOnce()
    expect(proposalTool?.name).toBe(AGENT_AUTHORING_PROPOSAL_TOOL)
    expect(guard?.({ name: AGENT_AUTHORING_PROPOSAL_TOOL, agent })).toBeUndefined()
    expect(guard?.({ name: 'bash', agent })).toContain(`only ${AGENT_AUTHORING_PROPOSAL_TOOL}`)
    expect(guard?.({ name: 'bash', agent: { ...agent, session: { ...session, id: 'ordinary' } } })).toBeUndefined()
    const proposalSchema = { name: AGENT_AUTHORING_PROPOSAL_TOOL }
    await expect(assemble?.({ tools: [] }, { agent: { session } }, async () => ({ tools: [proposalSchema, { name: 'bash' }] }))).resolves.toEqual({ tools: [proposalSchema] })
    await expect(assemble?.({ tools: [] }, { agent: { session: { ...session, id: 'ordinary' } } }, async () => ({ tools: [{ name: 'bash' }] }))).resolves.toEqual({ tools: [{ name: 'bash' }] })

    await service.prepareAuthoringTurn({
      sessionId, draft: authoringDraft, skills: [{ name: 'web-research', description: 'Research the web' }], locale: 'zh-CN',
    })
    await expect(proposalTool?.execute({ name: '周末助手', preferredSkillNames: ['web-research'] }, {})).resolves.toEqual({ accepted: true })
    await expect(proposalTool?.execute({ name: '周末助手', basePresetId: 'minimal' }, {})).rejects.toThrow('不允许的字段')
    await expect(proposalTool?.execute({ preferredSkillNames: ['ppt-master'] }, {})).rejects.toThrow('未安装或非精确名称')
    expect(proposalTool?.presentCall?.({ secret: 'never render me' })).toEqual({
      card: 'generic', title: 'Agent brief proposal', kind: 'other',
    })
    expect(proposalTool?.presentResult?.({}, { isError: false })).toEqual({
      card: 'generic', title: '已生成待确认配置提案', content: [],
    })

    session.header.agentPreset = 'standard'
    composedPreset = 'standard'
    expect(isPaimindAgentAuthoringSession(session)).toBe(true)
    expect(guard?.({ name: AGENT_AUTHORING_PROPOSAL_TOOL, agent })).toContain(`only ${AGENT_AUTHORING_PROPOSAL_TOOL}`)
    await expect(assemble?.({ tools: [] }, { agent: { session } }, async () => ({ tools: [proposalSchema, { name: 'bash' }] }))).resolves.toEqual({ tools: [proposalSchema] })
    await expect(service.sealAuthoringSession({ sessionId })).rejects.toThrow('Harness cordis')

    session.header.agentPreset = 'cordis'
    await expect(service.sealAuthoringSession({ sessionId })).rejects.toThrow('当前运行的原生 Agent Preset 已不是 cordis')
    await expect(service.prepareAuthoringTurn({
      sessionId, draft: authoringDraft, skills: [{ name: 'web-research', description: 'Research the web' }], locale: 'zh-CN',
    })).rejects.toThrow('当前运行的原生 Agent Preset 已不是 cordis')
  })

  it('assembles only the latest prepared turn context and clears it on Agent and service disposal', async () => {
    const sessionId = 'paimind-authoring-323e4567-e89b-12d3-a456-426614174000'
    const session = { id: sessionId, header: { id: sessionId, agentPreset: 'cordis' }, events: [] }
    const disposeSections = vi.fn()
    const disposeRuntimeContexts = vi.fn()
    const disposePresentations = vi.fn()
    const disposeRestrictions = vi.fn()
    const disposeProposalTools = vi.fn()
    const sections: Array<{
      readonly name: string
      readonly complete?: boolean
      readonly text: string | ((context: Readonly<Record<string, unknown>>) => string)
    }> = []
    const section = vi.fn((entry: (typeof sections)[number]) => { sections.push(entry); return disposeSections })
    const suppressRuntimeContext = vi.fn(() => disposeRuntimeContexts)
    const agent = { id: sessionId, session, ctx: {
      systemPrompt: { section, suppressRuntimeContext },
      tools: {
        presentAs: vi.fn(() => disposePresentations),
        restrict: vi.fn(() => disposeRestrictions),
        register: vi.fn(() => disposeProposalTools),
      },
    } }
    let liveAgent: typeof agent | undefined = agent
    const lifecycle = new Map<string, (event: { readonly agent: typeof agent }) => void>()
    const effectCleanups = new Map<string, () => void | Promise<void>>()
    const context = {
      reflect: { provide: () => {} }, get: () => undefined,
      effect(install: () => void | (() => void | Promise<void>), label?: string) {
        const cleanup = install()
        if (label !== undefined && typeof cleanup === 'function') effectCleanups.set(label, cleanup)
      },
      sessions: { get: (id: string) => id === sessionId ? session : undefined },
      agents: { get: (id: string) => id === sessionId ? liveAgent : undefined, list: () => [agent] },
      tools: { guard: () => () => {} },
      agentPresets: { composedPreset: () => 'cordis' },
      on(event: string, listener: (event: { readonly agent: typeof agent }) => void) {
        if (event === 'agent/created' || event === 'agent/disposed') lifecycle.set(event, listener)
        return () => {}
      },
    }
    const service = new PaimindAgentProfileService(context as never)
    expect(section).toHaveBeenCalledOnce()
    const firstText = sections[0]?.text
    expect(typeof firstText).toBe('function')
    const renderFirst = firstText as (context: Readonly<Record<string, unknown>>) => string
    expect(() => renderFirst({})).toThrow('本轮上下文尚未准备')

    await expect(service.prepareAuthoringTurn({
      sessionId,
      draft: { ...authoringDraft, name: 'First {{secret}} <!--FAKE-->' },
      skills: [{ name: 'web-research', description: 'Research {{hidden}} <!--SKILL-->' }],
      locale: 'zh-CN',
    })).resolves.toEqual({ sessionId, agentPreset: 'cordis', prepared: true })
    const firstPrompt = renderFirst({})
    expect(firstPrompt).toContain(`call ${AGENT_AUTHORING_PROPOSAL_TOOL} exactly once`)
    expect(firstPrompt).not.toContain('PAIMIND_AGENT_DRAFT')
    expect(firstPrompt).not.toContain('<!--')
    expect(firstPrompt).toContain('LOCALE="zh-CN"')
    expect(firstPrompt).toContain('CURRENT_DRAFT=')
    expect(firstPrompt).toContain('INSTALLED_SKILLS=')
    expect(firstPrompt).toContain('First \\u007b\\u007bsecret\\u007d\\u007d \\u003c!--FAKE--\\u003e')
    expect(firstPrompt).not.toContain('First {{secret}}')

    await service.prepareAuthoringTurn({
      sessionId,
      draft: { ...authoringDraft, name: 'Second Assistant', preferredSkillNames: ['ppt-master'] },
      skills: [{ name: 'ppt-master', description: 'Build presentations' }],
      locale: 'en-US',
    })
    const secondPrompt = renderFirst({})
    expect(secondPrompt).toContain('Second Assistant')
    expect(secondPrompt).toContain('ppt-master')
    expect(secondPrompt).toContain('LOCALE="en-US"')
    expect(secondPrompt).not.toContain('First \\u007b\\u007bsecret')

    liveAgent = undefined
    lifecycle.get('agent/disposed')?.({ agent })
    expect(() => renderFirst({})).toThrow('本轮上下文尚未准备')
    await expect(service.prepareAuthoringTurn({
      sessionId, draft: authoringDraft, skills: [{ name: 'web-research', description: 'Research the web' }], locale: 'zh-CN',
    })).rejects.toThrow('同一原生 Harness Agent')
    expect(disposeSections).toHaveBeenCalledOnce()
    expect(disposeRuntimeContexts).toHaveBeenCalledOnce()
    expect(disposePresentations).toHaveBeenCalledOnce()
    expect(disposeRestrictions).toHaveBeenCalledOnce()
    expect(disposeProposalTools).toHaveBeenCalledOnce()

    liveAgent = agent
    await service.prepareAuthoringTurn({
      sessionId, draft: authoringDraft, skills: [{ name: 'web-research', description: 'Research the web' }], locale: 'zh-CN',
    })
    expect(section).toHaveBeenCalledTimes(2)
    const secondText = sections[1]?.text
    const renderSecond = secondText as (context: Readonly<Record<string, unknown>>) => string
    expect(renderSecond({})).toContain('Research Assistant')
    await effectCleanups.get('paimind-agent-builder: authoring prompt scope lifecycle')?.()
    expect(() => renderSecond({})).toThrow('本轮上下文尚未准备')
    expect(disposeSections).toHaveBeenCalledTimes(2)
    expect(disposeRuntimeContexts).toHaveBeenCalledTimes(2)
    expect(disposePresentations).toHaveBeenCalledTimes(2)
    expect(disposeRestrictions).toHaveBeenCalledTimes(2)
    expect(disposeProposalTools).toHaveBeenCalledTimes(2)
  })

  it('publishes a strict Remote contract for preparing one authoring turn', () => {
    const descriptor = PAIMIND_AGENT_PROFILE_REMOTE_DESCRIPTORS.find(row => row.method === 'prepareAuthoringTurn')
    const inputSchema = (descriptor?.parameters[0] as { codec?: { schema?: { parse(value: unknown): unknown } } } | undefined)?.codec?.schema
    const resultSchema = (descriptor?.result as { schema?: { parse(value: unknown): unknown } } | undefined)?.schema
    const input = {
      sessionId: 'paimind-authoring-423e4567-e89b-12d3-a456-426614174000',
      draft: authoringDraft,
      skills: [{ name: 'web-research', description: 'Research the web' }],
      locale: 'zh-CN',
    }
    expect(inputSchema?.parse(input)).toEqual(input)
    expect(() => inputSchema?.parse({ ...input, shadowState: true })).toThrow()
    expect(() => inputSchema?.parse({ ...input, locale: '../unsafe' })).toThrow()
    expect(resultSchema?.parse({ sessionId: input.sessionId, agentPreset: 'cordis', prepared: true })).toEqual({
      sessionId: input.sessionId, agentPreset: 'cordis', prepared: true,
    })
  })

  it('rejects a non-cordis/non-namespaced Session and re-applies scope safely to a resumed native conversation', async () => {
    const wrongId = 'paimind-authoring-123e4567-e89b-12d3-a456-426614174000'
    const startedId = 'paimind-authoring-223e4567-e89b-12d3-a456-426614174000'
    const sessions = new Map<string, { id: string; header: { id: string; agentPreset: string }; events: unknown[] }>()
    sessions.set(wrongId, { id: wrongId, header: { id: wrongId, agentPreset: 'standard' }, events: [] })
    sessions.set(startedId, {
      id: startedId, header: { id: startedId, agentPreset: 'cordis' }, events: [{ type: 'turn/start', data: { turn: 1 } }],
    })
    const context = {
      reflect: { provide: () => {} }, effect(install: () => void) { install() }, get: () => undefined,
      sessions: { get: (id: string) => sessions.get(id) },
      agents: { get: (id: string) => {
        const session = sessions.get(id)
        return session === undefined ? undefined : {
          id,
          session,
          ctx: {
            systemPrompt: { section: () => () => {}, suppressRuntimeContext: () => () => {} },
            tools: { presentAs: () => () => {}, restrict: () => () => {}, register: () => () => {} },
          },
        }
      }, list: () => [] },
      tools: { guard: () => () => {} },
      agentPresets: { composedPreset: () => 'cordis' },
      on: () => () => {},
    }
    const service = new PaimindAgentProfileService(context as never)
    await expect(service.sealAuthoringSession({ sessionId: wrongId })).rejects.toThrow('Harness cordis')
    sessions.get(wrongId)!.events.push({ type: 'agent-preset/selected', data: { agentPreset: 'cordis' } })
    await expect(service.sealAuthoringSession({ sessionId: wrongId })).resolves.toMatchObject({ sessionId: wrongId, sealed: true })
    await expect(service.sealAuthoringSession({ sessionId: startedId })).resolves.toMatchObject({ sessionId: startedId, sealed: true })
    sessions.set('ordinary', { id: 'ordinary', header: { id: 'ordinary', agentPreset: 'cordis' }, events: [] })
    await expect(service.sealAuthoringSession({ sessionId: 'ordinary' })).rejects.toThrow('authoring 原生命名空间')
  })

  it('keeps Business Agent placement across the strict Remote contract', () => {
    const descriptor = PAIMIND_AGENT_PROFILE_REMOTE_DESCRIPTORS.find(row => row.method === 'saveProfile')
    const inputSchema = (descriptor?.parameters[0] as { codec?: { schema?: { parse(value: unknown): unknown } } } | undefined)?.codec?.schema
    const resultSchema = (descriptor?.result as { schema?: { parse(value: unknown): unknown } } | undefined)?.schema
    const businessPlacement = { productKind: 'business', businessCategory: '产品与 PDM', businessCategoryId: 'product-pdm' }
    const input = { ...profile, ...businessPlacement }
    expect(inputSchema?.parse(input)).toMatchObject(businessPlacement)
    expect(resultSchema?.parse(input)).toMatchObject(businessPlacement)
  })

  it('rejects a new Profile whose Agent and Preset identities differ', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-agent-identity-'))
    roots.push(base)
    const presetRoot = join(base, '.agent-presets')
    const source = join(presetRoot, 'identity-agent')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n")
    const context = { ...authoringPolicyStubs, reflect: { provide: () => {} }, effect(install: () => void) { install() }, get: () => undefined }
    const service = new PaimindAgentProfileService(context as never, { presetRoot, stateRoot: join(base, '.state') })

    await expect(service.saveProfile({
      agentId: 'different-agent', presetId: 'identity-agent', name: 'Identity Agent', description: '',
      basePresetId: 'minimal', role: 'Identity owner', goal: 'Keep one identity', behavior: 'Stay consistent',
      preferredSkillNames: [], instructions: '',
    })).rejects.toThrow('智能体标识必须与预设标识一致')
    await expect(stat(join(source, AGENT_PROFILE_FILE))).rejects.toThrow()
  })

  it('keeps one identity through create and edit, and rejects base Preset drift', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-agent-stable-identity-'))
    roots.push(base)
    const presetRoot = join(base, '.agent-presets')
    const source = join(presetRoot, 'stable-agent')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n")
    const context = { ...authoringPolicyStubs, reflect: { provide: () => {} }, effect(install: () => void) { install() }, get: () => undefined }
    const service = new PaimindAgentProfileService(context as never, { presetRoot, stateRoot: join(base, '.state'), now: () => 42 })
    const input = {
      agentId: 'stable-agent', presetId: 'stable-agent', name: 'Stable Agent', description: '',
      basePresetId: 'minimal', role: 'Stable owner', goal: 'Keep one identity', behavior: 'Use the original base',
      preferredSkillNames: [], instructions: '',
    } as const

    const created = await service.saveProfile(input)
    expect(created).toMatchObject({ agentId: 'stable-agent', presetId: 'stable-agent', basePresetId: 'minimal', revision: 1 })
    await expect(service.saveProfile({
      ...input, basePresetId: 'standard', expectedVersion: created.configVersion,
    })).rejects.toThrow('基础能力模板不可修改')

    const edited = await service.saveProfile({
      ...input, behavior: 'Keep the original base and accept valid edits', expectedVersion: created.configVersion,
    })
    expect(edited).toMatchObject({
      agentId: 'stable-agent', presetId: 'stable-agent', basePresetId: 'minimal', revision: 2,
      behavior: 'Keep the original base and accept valid edits',
    })
    await expect(service.saveProfile({
      ...input, behavior: 'Overwrite from a stale edit', expectedVersion: created.configVersion,
    })).rejects.toThrow('智能体已更新，请刷新后重试')
  })

  it('serializes concurrent saves so one shared expectedVersion can commit only once', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-agent-concurrent-save-'))
    roots.push(base)
    const presetRoot = join(base, '.agent-presets')
    const source = join(presetRoot, 'concurrent-agent')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n")
    const context = { ...authoringPolicyStubs, reflect: { provide: () => {} }, effect(install: () => void) { install() }, get: () => undefined }
    const service = new PaimindAgentProfileService(context as never, { presetRoot, stateRoot: join(base, '.state'), now: () => 42 })
    const input = {
      agentId: 'concurrent-agent', presetId: 'concurrent-agent', name: 'Concurrent Agent', description: '',
      basePresetId: 'minimal', role: 'Concurrency owner', goal: 'Commit one revision',
      behavior: 'Use optimistic concurrency', preferredSkillNames: [], instructions: '',
    } as const
    const created = await service.saveProfile(input)

    const attempts = await Promise.allSettled([
      service.saveProfile({ ...input, behavior: 'First concurrent edit', expectedVersion: created.configVersion }),
      service.saveProfile({ ...input, behavior: 'Second concurrent edit', expectedVersion: created.configVersion }),
    ])
    const fulfilled = attempts.filter((result): result is PromiseFulfilledResult<Readonly<AgentBusinessProfile>> => result.status === 'fulfilled')
    const rejected = attempts.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toEqual(expect.objectContaining({ message: '智能体已更新，请刷新后重试' }))
    expect(fulfilled[0]?.value).toMatchObject({ revision: 2 })

    const persisted = JSON.parse(await readFile(join(source, AGENT_PROFILE_FILE), 'utf8')) as AgentBusinessProfile
    expect(persisted).toMatchObject({
      revision: 2,
      configVersion: fulfilled[0]?.value.configVersion,
      behavior: fulfilled[0]?.value.behavior,
    })
  })

  it('replaces only the native persona row and embeds business behavior and preferred Skills', () => {
    const source = "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n\n- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n"
    const result = replacePresetPersona(source, profile)
    expect(result).toContain('You are Evidence Agent')
    expect(result).toContain('Start every answer with [EVIDENCE].')
    expect(result).toContain('Session-injected Skills:')
    expect(result).toContain('- web-research')
    expect(result).toContain("- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'")
  })

  it('replaces native filesystem discovery with one idempotent per-Agent Skill projection', () => {
    const source = "- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n\n- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n"
    const first = replacePresetSkillScope(source, '/tmp/agent-scope', 'v1-test')
    const second = replacePresetSkillScope(first, '/tmp/agent-scope', 'v1-test')
    expect(second).toBe(first)
    expect(first).toContain('includeDefaultRoots: false')
    expect(first).toContain('customSkillDirs:')
    expect(first).toContain('"/tmp/agent-scope"')
    expect(first.match(/# PAIMind skill scope:/g)).toHaveLength(1)
    expect(first).toContain("- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'")
  })

  it('projects only packaged installed Skills into the copied native Preset and repairs scope drift', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-agent-scope-'))
    roots.push(base)
    const presetRoot = join(base, '.agent-presets')
    const stateRoot = join(base, '.state')
    const skillRoot = join(base, 'skills')
    const source = join(presetRoot, 'my-agent')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n\n- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n")
    await writeFile(join(source, 'preset.yml'), 'name: Old\n')
    for (const name of ['selected-skill', 'unselected-skill']) {
      await mkdir(join(skillRoot, name), { recursive: true })
      await writeFile(join(skillRoot, name, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`)
    }
    const context = { ...authoringPolicyStubs, reflect: { provide: () => {} }, effect(install: () => void) { install() }, get: () => undefined }
    const service = new PaimindAgentProfileService(context as never, { presetRoot, stateRoot, now: () => 42 })
    await service.saveProfile({
      agentId: 'my-agent', presetId: 'my-agent', name: 'Scoped Agent', description: 'Scoped', basePresetId: 'standard',
      role: 'Researcher', goal: 'Use only packaged capabilities', behavior: 'Be precise',
      preferredSkillNames: ['selected-skill'], instructions: '',
    })
    const scopeRoot = join(source, AGENT_SKILL_SCOPE_DIRECTORY)
    await expect(realpath(join(scopeRoot, 'selected-skill'))).resolves.toBe(await realpath(join(skillRoot, 'selected-skill')))
    await expect(stat(join(scopeRoot, 'unselected-skill'))).rejects.toThrow()
    const composition = await readFile(join(source, 'agent.cordis.yml'), 'utf8')
    expect(composition).toContain('includeDefaultRoots: false')
    expect(composition).toContain(JSON.stringify(scopeRoot))

    await rm(scopeRoot, { recursive: true, force: true })
    await writeFile(join(source, 'agent.cordis.yml'), composition.replace('Session-injected Skills:', 'Preferred installed Skills:'))
    const listed = await service.listProfiles()
    expect(listed.profiles[0]?.health).toBe('healthy')
    await expect(realpath(join(scopeRoot, 'selected-skill'))).resolves.toBe(await realpath(join(skillRoot, 'selected-skill')))
    await expect(readFile(join(source, 'agent.cordis.yml'), 'utf8')).resolves.toContain('Session-injected Skills:')
  })

  it('rejects Skill injection for Minimal mode at the host boundary', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-agent-minimal-'))
    roots.push(base)
    const presetRoot = join(base, '.agent-presets')
    const source = join(presetRoot, 'minimal-agent')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n")
    const context = { ...authoringPolicyStubs, reflect: { provide: () => {} }, effect(install: () => void) { install() }, get: () => undefined }
    const service = new PaimindAgentProfileService(context as never, { presetRoot, stateRoot: join(base, '.state') })
    await expect(service.saveProfile({
      agentId: 'minimal-agent', presetId: 'minimal-agent', name: 'Minimal Agent', description: '', basePresetId: 'minimal',
      role: 'Minimal', goal: 'No skills', behavior: 'Stay minimal', preferredSkillNames: ['selected-skill'], instructions: '',
    })).rejects.toThrow('极简模式不可封装 Skill')
  })

  it('persists Business Agent placement beside the real native Preset', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-business-agent-'))
    roots.push(base)
    const presetRoot = join(base, '.agent-presets')
    const source = join(presetRoot, 'pdm-assistant')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n")
    await writeFile(join(source, 'preset.yml'), 'name: PDM Assistant\n')
    const context = { ...authoringPolicyStubs, reflect: { provide: () => {} }, effect(install: () => void) { install() }, get: () => undefined }
    const service = new PaimindAgentProfileService(context as never, { presetRoot, stateRoot: join(base, '.state'), now: () => 77 })

    const saved = await service.saveProfile({
      agentId: 'pdm-assistant', presetId: 'pdm-assistant', name: 'PDM Assistant', description: 'Product work', basePresetId: 'minimal',
      role: 'PDM analyst', goal: 'Maintain product decisions', behavior: 'Use product evidence', preferredSkillNames: [], instructions: '',
      productKind: 'business', businessCategory: '产品与 PDM',
    })

    expect(saved.productKind).toBe('business')
    expect(saved.businessCategory).toBe('产品与 PDM')
    expect(saved.businessCategoryId).toMatch(/^category-[a-f0-9]{12}$/)
    await expect(service.listProfiles()).resolves.toEqual({ profiles: [expect.objectContaining({
      presetId: 'pdm-assistant', productKind: 'business', businessCategory: '产品与 PDM', businessCategoryId: saved.businessCategoryId,
    })] })
    await expect(readFile(join(source, '.paimind-agent.json'), 'utf8')).resolves.toContain('"productKind": "business"')
  })

  it('binds a native Session, plans a version migration, and records a verified real first turn', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-agent-lifecycle-'))
    roots.push(base)
    const presetRoot = join(base, '.agent-presets')
    const source = join(presetRoot, 'delivery-agent')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n")
    await writeFile(join(source, 'preset.yml'), 'name: Delivery Agent\n')
    const sessions = new Map<string, { header?: { agentPreset?: string }; events?: readonly unknown[] }>()
    let clock = 100
    const context = {
      ...authoringPolicyStubs,
      reflect: { provide: () => {} }, effect(install: () => void) { install() }, get: () => undefined,
      sessions: { get: (id: string) => sessions.get(id) },
    }
    const service = new PaimindAgentProfileService(context as never, {
      presetRoot, stateRoot: join(base, '.state'), now: () => { clock += 1; return clock },
    })
    const first = await service.saveProfile({
      agentId: 'delivery-agent', presetId: 'delivery-agent', name: 'Delivery Agent', description: 'Ships verified results',
      basePresetId: 'minimal', role: 'Delivery owner', goal: 'Ship a verified result', behavior: 'Use real evidence',
      preferredSkillNames: [], instructions: '',
    })
    await service.bindSession({
      sessionId: 'session-source', agentId: first.agentId, presetId: first.presetId, configVersion: first.configVersion,
    })
    sessions.set('session-source', { events: [
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Finish the delivery' }] } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'I will verify it.' }] } } },
    ] })
    const second = await service.saveProfile({
      agentId: 'delivery-agent', presetId: 'delivery-agent', name: 'Delivery Agent', description: 'Ships verified results',
      basePresetId: 'minimal', role: 'Delivery owner', goal: 'Ship a verified result', behavior: 'Verify before reporting',
      preferredSkillNames: [], instructions: '', expectedVersion: first.configVersion,
    })

    const plan = await service.migrationPlan({ sourceSessionId: 'session-source' })
    expect(plan).toMatchObject({
      sourceSessionId: 'session-source', agentId: 'delivery-agent', presetId: 'delivery-agent',
      fromVersion: first.configVersion, toVersion: second.configVersion,
    })
    expect(plan?.summary).toContain('Finish the delivery')
    await service.recordMigration({ ...plan!, targetSessionId: 'session-target' })
    sessions.set('session-target', {
      header: { agentPreset: 'minimal' },
      events: [
        { type: 'agent-preset/selected', data: { agentPreset: 'delivery-agent' } },
        { type: 'user/message', seq: 20, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue' }] } },
        { type: 'assistant/message', seq: 21, data: { message: { content: [{ type: 'text', text: 'Verified delivery complete.' }] } } },
      ],
    })
    const verification = await service.verifySession({ sessionId: 'session-target' })
    expect(verification).toMatchObject({ result: 'passed', firstTurnId: 'event:21', configVersion: second.configVersion })
    await expect(service.listAudit()).resolves.toMatchObject({
      migrations: [expect.objectContaining({ sourceSessionId: 'session-source', targetSessionId: 'session-target' })],
      verifications: [expect.objectContaining({ sessionId: 'session-target', result: 'passed' })],
    })
  })

  it('builds migration summaries from visible human and assistant messages only', () => {
    const summary = summarizeConversationEvents([
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Need a plan' }] } },
      { type: 'tool/call', data: { arguments: 'secret internal call' } },
      { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'hidden injection' }] } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Here is the plan' }] } } },
    ], 'old-session')
    expect(summary).toContain('Need a plan')
    expect(summary).toContain('Here is the plan')
    expect(summary).toContain('old-session')
    expect(summary).toContain('已使用最新版智能体继续。')
    expect(summary).not.toContain('secret internal call')
    expect(summary).not.toContain('hidden injection')
  })

  it('folds native preset-selection events before the first human turn', () => {
    expect(effectivePresetForFirstTurn({
      header: { agentPreset: 'paimind' },
      events: [
        { type: 'agent-preset/selected', data: { agentPreset: 'my-agent' } },
        { type: 'user/message', data: { source: { kind: 'user' } } },
        { type: 'agent-preset/selected', data: { agentPreset: 'too-late' } },
      ],
    })).toBe('my-agent')
  })

  it('uses the visible first-turn reply instead of a tool-only assistant step', () => {
    expect(visibleAssistantReplyForFirstTurn({
      events: [
        { type: 'user/message', data: { source: { kind: 'user' } } },
        { type: 'assistant/message', seq: 11, data: { message: { content: [{ type: 'tool-call', name: 'skill' }] } } },
        { type: 'assistant/message', seq: 12, data: { message: { content: [{ type: 'text', text: '正在查询。' }] } } },
        { type: 'assistant/message', seq: 13, data: { message: { content: [{ type: 'text', text: '最终答复。' }] } } },
        { type: 'user/message', data: { source: { kind: 'user' } } },
        { type: 'assistant/message', seq: 14, data: { message: { content: [{ type: 'text', text: '第二轮。' }] } } },
      ],
    })).toEqual({ seq: 13, text: '最终答复。' })
  })

  it('is a headless package with no independent client page', async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'packages/agent-builder/package.json'), 'utf8')) as { dsh?: unknown; paimindBuild?: { client?: unknown } }
    expect(manifest.dsh).toBeUndefined()
    expect(manifest.paimindBuild?.client).toBeUndefined()
  })
})
