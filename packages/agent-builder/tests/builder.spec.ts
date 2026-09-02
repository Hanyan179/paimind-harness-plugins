import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
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
  it('seals namespaced Standard authoring Sessions to the native question tool and a complete prompt scope', async () => {
    const sessionId = 'paimind-authoring-123e4567-e89b-12d3-a456-426614174000'
    const session = {
      id: sessionId, header: { id: sessionId, agentPreset: 'standard' }, events: [],
    }
    const section = vi.fn(() => () => {})
    const suppressRuntimeContext = vi.fn(() => () => {})
    const register = vi.fn(() => () => {})
    const agent = {
      id: sessionId,
      session,
      ctx: { systemPrompt: { section, suppressRuntimeContext }, tools: { register } },
    }
    let composedPreset = 'standard'
    let guard: ((execution: { readonly name: string; readonly agent?: { readonly session?: typeof session } }) => string | undefined) | undefined
    let assemble: ((
      assembly: { readonly tools: readonly unknown[] },
      context: { readonly agent?: typeof agent },
      next: () => Promise<{ readonly tools: readonly unknown[] }>,
    ) => Promise<{ readonly sections?: readonly unknown[]; readonly contexts?: readonly unknown[]; readonly tools: readonly unknown[] }>) | undefined
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
      sessionId, agentPreset: 'standard', sealed: true,
    })
    await expect(service.sealAuthoringSession({ sessionId })).resolves.toEqual({
      sessionId, agentPreset: 'standard', sealed: true,
    })
    expect(session.events).toHaveLength(0)
    expect(isPaimindAgentAuthoringSession(session)).toBe(true)
    expect(section).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledOnce()
    expect(section).toHaveBeenCalledWith(expect.objectContaining({ complete: true, name: 'paimind:agent-authoring' }))
    const defaultPrompt = section.mock.calls[0]?.[0]?.text
    expect(typeof defaultPrompt === 'function' ? defaultPrompt({}) : defaultPrompt).toContain('LOCALE="auto"')
    expect(suppressRuntimeContext).toHaveBeenCalledOnce()
    expect(guard?.({ name: 'ask_user_question', agent: { session } })).toBeUndefined()
    expect(guard?.({ name: 'paimind_agent_prepare_create', agent: { session } })).toBeUndefined()
    expect(guard?.({ name: 'bash', agent: { session } })).toContain('ask_user_question and paimind_agent_prepare_create')
    expect(guard?.({ name: 'write', agent: { session: { ...session, id: 'ordinary' } } })).toBeUndefined()
    const askTool = Object.freeze({ name: 'ask_user_question', schema: Object.freeze({}) })
    const prepareTool = Object.freeze({ name: 'paimind_agent_prepare_create', schema: Object.freeze({}) })
    await expect(assemble?.({ tools: ['cordis_define'] }, { agent }, async () => ({ tools: ['bash', askTool, prepareTool] }))).resolves.toMatchObject({ tools: [askTool, prepareTool], contexts: [] })
    await expect(assemble?.({ tools: [] }, { agent }, async () => ({ tools: ['ask_user_question', 'paimind_agent_prepare_create', 'bash'] }))).resolves.toMatchObject({ tools: ['ask_user_question', 'paimind_agent_prepare_create'], contexts: [] })

    session.header.agentPreset = 'cordis'
    composedPreset = 'cordis'
    expect(isPaimindAgentAuthoringSession(session)).toBe(true)
    expect(guard?.({ name: 'ask_user_question', agent: { session } })).toBeUndefined()
    expect(guard?.({ name: 'paimind_agent_prepare_create', agent: { session } })).toBeUndefined()
    expect(guard?.({ name: 'bash', agent: { session } })).toContain('ask_user_question and paimind_agent_prepare_create')
    await expect(assemble?.({ tools: ['cordis_define'] }, { agent }, async () => ({ tools: ['ask_user_question', 'paimind_agent_prepare_create', 'bash'] }))).resolves.toMatchObject({ tools: ['ask_user_question', 'paimind_agent_prepare_create'], contexts: [] })
    await expect(service.sealAuthoringSession({ sessionId })).rejects.toThrow('Harness standard')

    session.header.agentPreset = 'standard'
    await expect(service.sealAuthoringSession({ sessionId })).rejects.toThrow('当前运行的原生 Agent Preset 已不是 standard')
    await expect(service.prepareAuthoringTurn({
      sessionId, draft: authoringDraft, skills: [{ name: 'web-research', description: 'Research the web' }], locale: 'zh-CN',
    })).rejects.toThrow('当前运行的原生 Agent Preset 已不是 standard')
  })

  it('does not turn an ordinary Standard Session into an authoring capability', async () => {
    const sessionId = 'ordinary-standard-session'
    const session = {
      id: sessionId,
      header: { id: sessionId, agentPreset: 'standard' },
      events: [],
    }
    const section = vi.fn(() => () => {})
    const suppressRuntimeContext = vi.fn(() => () => {})
    const agent = { id: sessionId, session, ctx: { systemPrompt: { section, suppressRuntimeContext }, tools: { register: vi.fn(() => () => {}) } } }
    let assemble: ((
      assembly: { readonly sections?: readonly unknown[]; readonly contexts?: readonly unknown[]; readonly tools: readonly unknown[] },
      context: { readonly agent?: typeof agent },
      next: () => Promise<{ readonly sections?: readonly unknown[]; readonly contexts?: readonly unknown[]; readonly tools: readonly unknown[] }>,
    ) => Promise<{ readonly sections?: readonly unknown[]; readonly contexts?: readonly unknown[]; readonly tools: readonly unknown[] }>) | undefined
    const context = {
      reflect: { provide: () => {} }, get: () => undefined,
      effect(install: () => void | (() => void)) { install() },
      sessions: { get: (id: string) => id === sessionId ? session : undefined },
      agents: { get: (id: string) => id === sessionId ? agent : undefined, list: () => [] },
      tools: { guard: () => () => {} },
      agentPresets: { composedPreset: () => 'standard' },
      on(event: string, listener: typeof assemble) { if (event === 'system-prompt/assemble') assemble = listener; return () => {} },
    }

    const service = new PaimindAgentProfileService(context as never)
    expect(isPaimindAgentAuthoringSession(session)).toBe(false)
    await expect(assemble?.(
      { sections: [{ name: 'ordinary', text: 'ordinary prompt' }], contexts: [{ name: 'cwd' }], tools: ['bash'] },
      { agent },
      async () => ({ sections: [{ name: 'ordinary', text: 'ordinary prompt' }], contexts: [{ name: 'cwd' }], tools: ['bash', 'ask_user_question', 'paimind_agent_prepare_create'] }),
    )).resolves.toMatchObject({ sections: [{ name: 'ordinary', text: 'ordinary prompt' }], contexts: [{ name: 'cwd' }] })
    expect(section).not.toHaveBeenCalled()
    expect(suppressRuntimeContext).not.toHaveBeenCalled()
    await expect(service.prepareAuthoringTurn({
      sessionId, draft: authoringDraft, skills: [{ name: 'web-research', description: 'Research the web' }], locale: 'zh-CN',
    })).rejects.toThrow('智能体创建会话')
  })

  it('promotes an ordinary Session only after a real prepare-create Tool result', async () => {
    const sessionId = 'ordinary-promoted-session'
    const session = {
      id: sessionId,
      header: { id: sessionId, agentPreset: 'paimind' },
      events: [
        { type: 'tool/call', seq: 20, data: { callId: 'call-create', name: 'paimind_agent_prepare_create' } },
        { type: 'tool/result', seq: 21, data: { message: { source: { callId: 'call-create' }, content: [{ type: 'text', text: '<!--PAIMIND_AGENT_DRAFT\n{"name":"Risk Agent"}\n-->' }] } } },
      ],
    }
    const agent = { id: sessionId, session, ctx: { systemPrompt: { section: () => () => {}, suppressRuntimeContext: () => () => {} }, tools: { register: () => () => {} } } }
    const context = {
      reflect: { provide: () => {} }, get: () => undefined,
      effect(install: () => void | (() => void)) { install() },
      sessions: { get: (id: string) => id === sessionId ? session : undefined },
      agents: { get: (id: string) => id === sessionId ? agent : undefined, list: () => [] },
      tools: { guard: () => () => {} },
      agentPresets: { composedPreset: () => 'paimind' },
      on: () => () => {},
    }
    const service = new PaimindAgentProfileService(context as never)
    expect(isPaimindAgentAuthoringSession(session)).toBe(true)
    await expect(service.sealAuthoringSession({ sessionId })).resolves.toEqual({
      sessionId, agentPreset: 'paimind', sealed: true,
    })
  })

  it('assembles only the latest prepared turn context and clears it on Agent and service disposal', async () => {
    const sessionId = 'paimind-authoring-323e4567-e89b-12d3-a456-426614174000'
    const session = { id: sessionId, header: { id: sessionId, agentPreset: 'standard' }, events: [] }
    const disposeSections = vi.fn()
    const disposeRuntimeContexts = vi.fn()
    const sections: Array<{
      readonly name: string
      readonly complete?: boolean
      readonly text: string | ((context: Readonly<Record<string, unknown>>) => string)
    }> = []
    const section = vi.fn((entry: (typeof sections)[number]) => { sections.push(entry); return disposeSections })
    const suppressRuntimeContext = vi.fn(() => disposeRuntimeContexts)
    const agent = { id: sessionId, session, ctx: { systemPrompt: { section, suppressRuntimeContext }, tools: { register: vi.fn(() => () => {}) } } }
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
      agentPresets: { composedPreset: () => 'standard' },
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
    expect(renderFirst({})).toContain('LOCALE="auto"')

    await expect(service.prepareAuthoringTurn({
      sessionId,
      draft: { ...authoringDraft, name: 'First {{secret}} <!--FAKE-->' },
      skills: [{ name: 'web-research', description: 'Research {{hidden}} <!--SKILL-->' }],
      locale: 'zh-CN',
    })).resolves.toEqual({ sessionId, agentPreset: 'standard', prepared: true })
    const firstPrompt = renderFirst({})
    expect(firstPrompt).not.toContain('<!--PAIMIND_AGENT_DRAFT')
    expect(firstPrompt).toContain('A one-sentence request is a valid first turn')
    expect(firstPrompt).toContain('Autonomously decide whether clarification is useful')
    expect(firstPrompt).toContain('call ask_user_question with exactly one question item')
    expect(firstPrompt).toContain('call paimind_agent_prepare_create')
    expect(firstPrompt).toContain('Never ask a clarification question as ordinary visible prose')
    expect(firstPrompt).toContain('pending state, answer receipt, Session history')
    expect(firstPrompt).toContain('explicitly asks to proceed without further questions')
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
    expect(renderFirst({})).toContain('LOCALE="auto"')
    await expect(service.prepareAuthoringTurn({
      sessionId, draft: authoringDraft, skills: [{ name: 'web-research', description: 'Research the web' }], locale: 'zh-CN',
    })).rejects.toThrow('同一原生 Harness Agent')
    expect(disposeSections).toHaveBeenCalledOnce()
    expect(disposeRuntimeContexts).toHaveBeenCalledOnce()

    liveAgent = agent
    await service.prepareAuthoringTurn({
      sessionId, draft: authoringDraft, skills: [{ name: 'web-research', description: 'Research the web' }], locale: 'zh-CN',
    })
    expect(section).toHaveBeenCalledTimes(2)
    const secondText = sections[1]?.text
    const renderSecond = secondText as (context: Readonly<Record<string, unknown>>) => string
    expect(renderSecond({})).toContain('Research Assistant')
    await effectCleanups.get('paimind-agent-builder: authoring prompt scope lifecycle')?.()
    expect(renderSecond({})).toContain('LOCALE="auto"')
    expect(disposeSections).toHaveBeenCalledTimes(2)
    expect(disposeRuntimeContexts).toHaveBeenCalledTimes(2)
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
    expect(resultSchema?.parse({ sessionId: input.sessionId, agentPreset: 'standard', prepared: true })).toEqual({
      sessionId: input.sessionId, agentPreset: 'standard', prepared: true,
    })
  })

  it('accepts only namespaced Standard authoring Sessions', async () => {
    const wrongId = 'paimind-authoring-123e4567-e89b-12d3-a456-426614174000'
    const startedId = 'paimind-authoring-223e4567-e89b-12d3-a456-426614174000'
    const sessions = new Map<string, { id: string; header: { id: string; agentPreset: string }; events: unknown[] }>()
    sessions.set(wrongId, { id: wrongId, header: { id: wrongId, agentPreset: 'cordis' }, events: [] })
    sessions.set(startedId, {
      id: startedId, header: { id: startedId, agentPreset: 'standard' }, events: [{ type: 'turn/start', data: { turn: 1 } }],
    })
    const context = {
      reflect: { provide: () => {} }, effect(install: () => void) { install() }, get: () => undefined,
      sessions: { get: (id: string) => sessions.get(id) },
      agents: { get: (id: string) => {
        const session = sessions.get(id)
        return session === undefined ? undefined : {
          id,
          session,
          ctx: { systemPrompt: { section: () => () => {}, suppressRuntimeContext: () => () => {} }, tools: { register: () => () => {} } },
        }
      }, list: () => [] },
      tools: { guard: () => () => {} },
      agentPresets: { composedPreset: () => 'standard' },
      on: () => () => {},
    }
    const service = new PaimindAgentProfileService(context as never)
    await expect(service.sealAuthoringSession({ sessionId: wrongId })).rejects.toThrow('Harness standard')
    await expect(service.sealAuthoringSession({ sessionId: startedId })).resolves.toMatchObject({ sessionId: startedId, sealed: true })
    sessions.set('ordinary', { id: 'ordinary', header: { id: 'ordinary', agentPreset: 'standard' }, events: [] })
    await expect(service.sealAuthoringSession({ sessionId: 'ordinary' })).rejects.toThrow('不是智能体创建会话')
  })

  it('keeps Business Agent placement across the strict Remote contract', () => {
    const descriptor = PAIMIND_AGENT_PROFILE_REMOTE_DESCRIPTORS.find(row => row.method === 'saveProfile')
    const inputSchema = (descriptor?.parameters[0] as { codec?: { schema?: { parse(value: unknown): unknown } } } | undefined)?.codec?.schema
    const resultSchema = (descriptor?.result as { schema?: { parse(value: unknown): unknown } } | undefined)?.schema
    const businessPlacement = { productKind: 'business', businessCategory: '产品与 PDM', businessCategoryId: 'product-pdm', avatarId: 'creator' }
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
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n")
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
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n")
    const context = { ...authoringPolicyStubs, reflect: { provide: () => {} }, effect(install: () => void) { install() }, get: () => undefined }
    const service = new PaimindAgentProfileService(context as never, { presetRoot, stateRoot: join(base, '.state'), now: () => 42 })
    const input = {
      agentId: 'stable-agent', presetId: 'stable-agent', name: 'Stable Agent', description: '',
      basePresetId: 'standard', role: 'Stable owner', goal: 'Keep one identity', behavior: 'Use the standard base',
      preferredSkillNames: [], instructions: '', authoringSessionId: 'paimind-authoring-stable', authoringCursor: 12,
    } as const

    const created = await service.saveProfile(input)
    expect(created).toMatchObject({
      agentId: 'stable-agent', presetId: 'stable-agent', basePresetId: 'standard', revision: 1,
      authoringSessionId: 'paimind-authoring-stable', authoringCursor: 12,
    })
    await expect(service.saveProfile({
      ...input, basePresetId: 'minimal', expectedVersion: created.configVersion,
    })).rejects.toThrow('旧版智能体需要先基于标准模板重新创建')

    const { authoringSessionId: _authoringSessionId, authoringCursor: _authoringCursor, ...inputWithoutAuthoringSession } = input
    const edited = await service.saveProfile({
      ...inputWithoutAuthoringSession, behavior: 'Keep the original base and accept valid edits', expectedVersion: created.configVersion,
    })
    expect(edited).toMatchObject({
      agentId: 'stable-agent', presetId: 'stable-agent', basePresetId: 'standard', revision: 2,
      behavior: 'Keep the original base and accept valid edits', authoringSessionId: 'paimind-authoring-stable', authoringCursor: 12,
    })
    await expect(service.saveProfile({
      ...input, behavior: 'Overwrite from a stale edit', expectedVersion: created.configVersion,
    })).rejects.toThrow('智能体已更新，请刷新后重试')
  })

  it('replaces only the native persona row without duplicating the runtime Skill catalog', () => {
    const source = "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n\n- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n"
    const result = replacePresetPersona(source, profile)
    expect(result).toContain('You are Evidence Agent')
    expect(result).toContain('Start every answer with [EVIDENCE].')
    expect(result).toContain('Capability terminology:')
    expect(result).toContain('Agent Business Skills selected in Agent Center: web-research')
    expect(result).toContain('Never rename or count Tools as Skills.')
    expect(result).not.toContain('Session-injected Skills:')
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
    const service = new PaimindAgentProfileService(context as never, { presetRoot, skillRoot, stateRoot, now: () => 42 })
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
    const listed = await service.listProfiles()
    expect(listed.profiles[0]?.health).toBe('healthy')
    await expect(realpath(join(scopeRoot, 'selected-skill'))).resolves.toBe(await realpath(join(skillRoot, 'selected-skill')))
    await expect(readFile(join(source, 'agent.cordis.yml'), 'utf8')).resolves.not.toContain('Session-injected Skills:')
  })

  it('rejects non-standard Agent foundations at the host boundary', async () => {
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
    })).rejects.toThrow('PAIMind 智能体必须使用标准基座')
  })

  it('persists Business Agent placement beside the real native Preset', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-business-agent-'))
    roots.push(base)
    const presetRoot = join(base, '.agent-presets')
    const source = join(presetRoot, 'pdm-assistant')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n")
    await writeFile(join(source, 'preset.yml'), 'name: PDM Assistant\n')
    const context = { ...authoringPolicyStubs, reflect: { provide: () => {} }, effect(install: () => void) { install() }, get: () => undefined }
    const service = new PaimindAgentProfileService(context as never, { presetRoot, stateRoot: join(base, '.state'), now: () => 77 })

    const saved = await service.saveProfile({
      agentId: 'pdm-assistant', presetId: 'pdm-assistant', name: 'PDM Assistant', description: 'Product work', basePresetId: 'standard',
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
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n")
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
      basePresetId: 'standard', role: 'Delivery owner', goal: 'Ship a verified result', behavior: 'Use real evidence',
      preferredSkillNames: [], instructions: '',
    })
    await service.bindSession({
      sessionId: 'session-source', agentId: first.agentId, presetId: first.presetId, configVersion: first.configVersion, purpose: 'builder-test',
    })
    await expect(service.listSessionBindings()).resolves.toEqual({ bindings: [expect.objectContaining({
      sessionId: 'session-source', purpose: 'builder-test',
    })] })
    sessions.set('session-source', { events: [
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Finish the delivery' }] } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'I will verify it.' }] } } },
    ] })
    const second = await service.saveProfile({
      agentId: 'delivery-agent', presetId: 'delivery-agent', name: 'Delivery Agent', description: 'Ships verified results',
      basePresetId: 'standard', role: 'Delivery owner', goal: 'Ship a verified result', behavior: 'Verify before reporting',
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
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Here is the plan\n<!--PAIMIND_AGENT_DRAFT\n{"name":"Internal draft"}\n-->' }] } } },
    ], 'old-session')
    expect(summary).toContain('Need a plan')
    expect(summary).toContain('Here is the plan')
    expect(summary).toContain('old-session')
    expect(summary).toContain('已使用最新版智能体继续。')
    expect(summary).not.toContain('secret internal call')
    expect(summary).not.toContain('hidden injection')
    expect(summary).not.toContain('PAIMIND_AGENT_DRAFT')
    expect(summary).not.toContain('Internal draft')
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
        { type: 'assistant/message', seq: 13, data: { message: { content: [{ type: 'text', text: '最终答复。\n<!--PAIMIND_AGENT_DRAFT\n{"goal":"内部字段"}\n-->' }] } } },
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
