// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_PROFILE_FILE,
  AGENT_SKILL_SCOPE_DIRECTORY,
  PaimindAgentProfileService,
  effectivePresetForFirstTurn,
  isPaimindAgentAuthoringSession,
  removePresetSkillFilesystemOverride,
  replacePresetPersona,
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
  it('keeps the Standard prompt intact and loads authoring only through the canonical bundled Skill', async () => {
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
    let composedPreset: string | undefined = 'standard'
    let guard: ((execution: { readonly name: string; readonly agent?: { readonly session?: typeof session } }) => string | undefined) | undefined
    let assemble: ((
      assembly: { readonly sections?: readonly unknown[]; readonly contexts?: readonly unknown[]; readonly tools: readonly unknown[] },
      context: { readonly agent?: typeof agent },
      next: () => Promise<{ readonly sections?: readonly unknown[]; readonly contexts?: readonly unknown[]; readonly tools: readonly unknown[] }>,
    ) => Promise<{ readonly sections?: readonly unknown[]; readonly contexts?: readonly unknown[]; readonly tools: readonly unknown[] }>) | undefined
    const registerSkill = vi.fn(() => () => {})
    const registerGlobalTool = vi.fn(() => () => {})
    const context = {
      reflect: { provide: () => {} }, get: () => undefined,
      effect(install: () => void | (() => void)) { install() },
      sessions: { get: (id: string) => id === sessionId ? session : undefined },
      agents: { get: (id: string) => id === sessionId ? agent : undefined, list: () => [] },
      tools: { guard(listener: typeof guard) { guard = listener; return () => {} }, register: registerGlobalTool },
      skills: { register: registerSkill },
      agentPresets: { composedPreset: () => composedPreset },
      on(event: string, listener: typeof assemble) { if (event === 'system-prompt/assemble') assemble = listener; return () => {} },
    }
    const service = new PaimindAgentProfileService(context as never)

    await expect(service.sealAuthoringSession({ sessionId })).resolves.toEqual({
      sessionId, agentPreset: 'standard', sealed: true,
    })
    await expect(service.prepareAuthoringTurn({
      sessionId,
      draft: { ...authoringDraft, name: 'First {{secret}} <!--FAKE-->' },
      skills: [{ name: 'web-research', description: 'Research {{hidden}} <script>&' }],
      locale: 'zh-CN',
    })).resolves.toEqual({ sessionId, agentPreset: 'standard', prepared: true })
    await expect(service.sealAuthoringSession({ sessionId })).resolves.toEqual({
      sessionId, agentPreset: 'standard', sealed: true,
    })
    expect(session.events).toHaveLength(0)
    expect(isPaimindAgentAuthoringSession(session)).toBe(true)
    expect(section).not.toHaveBeenCalled()
    expect(suppressRuntimeContext).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    expect(registerSkill).toHaveBeenCalledOnce()
    expect(registerGlobalTool.mock.calls.map(call => (call[0] as { readonly name?: string }).name).sort()).toEqual([
      'paimind_agent_prepare_create', 'paimind_agent_skill_binding',
    ])
    expect(registerSkill).toHaveBeenCalledWith(expect.objectContaining({
      name: 'paimind-agent-authoring', source: 'bundled',
      invocation: { modelInvocable: true, userInvocable: true },
    }))
    const canonicalSkill = registerSkill.mock.calls[0]?.[0]
    expect(canonicalSkill?.content).toContain('# PAIMind Agent authoring')
    expect(canonicalSkill?.content).toContain('call `paimind_agent_prepare_create` once')
    expect(canonicalSkill?.content).not.toContain('CURRENT_DRAFT=')
    expect(guard?.({ name: 'ask_user_question', agent: { session } })).toBeUndefined()
    expect(guard?.({ name: 'paimind_skill_inspect_github', agent: { session } })).toBeUndefined()
    expect(guard?.({ name: 'paimind_skill_install', agent: { session } })).toBeUndefined()
    expect(guard?.({ name: 'paimind_agent_prepare_create', agent: { session } })).toBeUndefined()
    expect(guard?.({ name: 'skill', agent: { session } })).toBeUndefined()
    expect(guard?.({ name: 'paimind_agent_skill_binding', agent: { session } })).toContain('paimind_skill_install')
    expect(guard?.({ name: 'bash', agent: { session } })).toContain('paimind_skill_install')
    expect(guard?.({ name: 'write', agent: { session } })).toContain('paimind_skill_install')
    expect(guard?.({ name: 'write', agent: { session: { ...session, id: 'ordinary' } } })).toBeUndefined()
    const standardSection = Object.freeze({ name: 'standard', text: 'native Standard foundation' })
    const skillCatalogSection = Object.freeze({ name: 'skill-catalog', text: 'paimind-agent-authoring' })
    const nativeContext = Object.freeze({ name: 'cwd', text: '/workspace' })
    const skillTool = Object.freeze({ name: 'skill', schema: Object.freeze({}) })
    const askTool = Object.freeze({ name: 'ask_user_question', schema: Object.freeze({}) })
    const inspectTool = Object.freeze({ name: 'paimind_skill_inspect_github', schema: Object.freeze({}) })
    const installTool = Object.freeze({ name: 'paimind_skill_install', schema: Object.freeze({}) })
    const prepareTool = Object.freeze({ name: 'paimind_agent_prepare_create', schema: Object.freeze({}) })
    const bindingTool = Object.freeze({ name: 'paimind_agent_skill_binding', schema: Object.freeze({}) })
    const writeTool = Object.freeze({ name: 'write', schema: Object.freeze({}) })
    const objectAssembly = await assemble?.(
      { tools: ['cordis_define'] },
      { agent },
      async () => ({ sections: [standardSection, skillCatalogSection], contexts: [nativeContext], tools: ['bash', skillTool, askTool, inspectTool, installTool, prepareTool, bindingTool, writeTool] }),
    )
    expect(objectAssembly?.sections).toEqual([standardSection, skillCatalogSection])
    expect(objectAssembly?.tools).toEqual([skillTool, askTool, inspectTool, installTool, prepareTool])
    expect(objectAssembly?.contexts).toHaveLength(2)
    expect(objectAssembly?.contexts?.[0]).toBe(nativeContext)
    const dataContexts = objectAssembly?.contexts?.filter(row => (
      typeof row === 'object' && row !== null && (row as { readonly name?: unknown }).name === 'paimind:agent-authoring-data'
    )) ?? []
    expect(dataContexts).toHaveLength(1)
    const dataText = (dataContexts[0] as { readonly text: string }).text
    expect(dataText).not.toContain('{{')
    expect(dataText).not.toContain('<!--')
    expect(dataText).not.toContain('<script>')
    expect(dataText).not.toContain('&')
    expect(dataText).toContain('\\u007b\\u007b')
    expect(dataText).toContain('\\u003c')
    expect(JSON.parse(dataText)).toMatchObject({
      schema: 'paimind.agent-authoring-data/v1',
      trust: 'untrusted-user-data',
      CURRENT_DRAFT: { name: 'First {{secret}} <!--FAKE-->' },
      INSTALLED_BUSINESS_SKILLS: [{ name: 'web-research', description: 'Research {{hidden}} <script>&' }],
      LOCALE: 'zh-CN',
    })

    const stringAssembly = await assemble?.({ tools: [] }, { agent }, async () => ({
      sections: [standardSection], contexts: [nativeContext],
      tools: ['skill', 'ask_user_question', 'paimind_skill_inspect_github', 'paimind_skill_install', 'paimind_agent_prepare_create', 'paimind_agent_skill_binding', 'bash', 'write'],
    }))
    expect(stringAssembly).toEqual({
      sections: [standardSection], contexts: objectAssembly?.contexts,
      tools: ['skill', 'ask_user_question', 'paimind_skill_inspect_github', 'paimind_skill_install', 'paimind_agent_prepare_create'],
    })

    composedPreset = 'saved-agent'
    expect(isPaimindAgentAuthoringSession(session)).toBe(true)
    expect(guard?.({ name: 'read', agent: { session } })).toBeUndefined()
    expect(guard?.({ name: 'glob', agent: { session } })).toBeUndefined()
    expect(guard?.({ name: 'bash', agent: { session } })).toBeUndefined()
    await expect(assemble?.({ tools: [] }, { agent }, async () => ({
      sections: [standardSection], contexts: [nativeContext], tools: ['read', 'glob', 'bash'],
    }))).resolves.toEqual({
      sections: [standardSection], contexts: [nativeContext], tools: ['read', 'glob', 'bash'],
    })
    await expect(service.sealAuthoringSession({ sessionId })).rejects.toThrow('当前运行的原生 Agent Preset 已不是 standard')

    await expect(service.prepareAuthoringTurn({
      sessionId, draft: authoringDraft, skills: [{ name: 'web-research', description: 'Research the web' }], locale: 'zh-CN',
    })).rejects.toThrow('当前运行的原生 Agent Preset 已不是 standard')

    composedPreset = undefined
    expect(guard?.({ name: 'bash', agent: { session } })).toContain('paimind_skill_install')
    const missingLivePresetAssembly = await assemble?.({ tools: [] }, { agent }, async () => ({
      sections: [standardSection], contexts: [nativeContext], tools: ['read', 'glob', 'bash'],
    }))
    expect(missingLivePresetAssembly?.tools).toEqual([])
    expect(missingLivePresetAssembly?.contexts).toEqual(objectAssembly?.contexts)
  })

  it('hot toggles Agent authoring off-on-off-on without duplicate registration while binding and guards stay active', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-agent-authoring-lifecycle-'))
    roots.push(base)
    const activeSkills = new Set<string>()
    const activeTools = new Set<string>()
    const skillRegistrations = new Map<string, number>()
    const toolRegistrations = new Map<string, number>()
    const skillDisposals = new Map<string, number>()
    const toolDisposals = new Map<string, number>()
    let guard: ((execution: { readonly name: string; readonly agent?: { readonly session?: unknown } }) => string | undefined) | undefined
    const increment = (table: Map<string, number>, key: string): void => { table.set(key, (table.get(key) ?? 0) + 1) }
    const context = {
      reflect: { provide: () => {} }, get: () => undefined,
      effect(install: () => void | (() => void | Promise<void>)) { install() },
      sessions: { get: () => undefined },
      agents: { get: () => undefined, list: () => [] },
      tools: {
        guard(listener: typeof guard) { guard = listener; return () => {} },
        register(definition: unknown) {
          const toolName = (definition as { readonly name?: unknown }).name
          if (typeof toolName !== 'string') throw new Error('test Tool has no name')
          if (activeTools.has(toolName)) throw new Error(`duplicate Tool: ${toolName}`)
          activeTools.add(toolName)
          increment(toolRegistrations, toolName)
          let disposed = false
          return () => {
            if (disposed) return
            disposed = true
            activeTools.delete(toolName)
            increment(toolDisposals, toolName)
          }
        },
      },
      skills: {
        register(definition: { readonly name: string }) {
          if (activeSkills.has(definition.name)) throw new Error(`duplicate Skill: ${definition.name}`)
          activeSkills.add(definition.name)
          increment(skillRegistrations, definition.name)
          let disposed = false
          return () => {
            if (disposed) return
            disposed = true
            activeSkills.delete(definition.name)
            increment(skillDisposals, definition.name)
          }
        },
      },
      agentPresets: { composedPreset: () => 'standard' },
      on: () => () => {},
    }
    const service = new PaimindAgentProfileService(context as never, {
      presetRoot: join(base, 'presets'), skillRoot: join(base, 'skills'), stateRoot: join(base, 'state'),
    })
    await service.prepareRuntime()

    const descriptor = service.describeAgentAuthoringCapability()
    expect(descriptor).toEqual({
      name: 'paimind-agent-authoring',
      description: expect.stringContaining('Create or configure a PAIMind Agent'),
      sourcePluginId: '@paimind/agent-builder',
    })
    expect(Object.isFrozen(descriptor)).toBe(true)
    expect(activeSkills).toEqual(new Set(['paimind-agent-authoring']))
    expect(activeTools).toEqual(new Set(['paimind_agent_prepare_create', 'paimind_agent_skill_binding']))

    service.setAgentAuthoringEnabled(false)
    expect(activeSkills.size).toBe(0)
    expect(activeTools).toEqual(new Set(['paimind_agent_skill_binding']))
    const dedicatedSession = { id: 'paimind-authoring-123e4567-e89b-12d3-a456-426614174000' }
    expect(guard?.({ name: 'bash', agent: { session: dedicatedSession } })).toContain('paimind_skill_install')
    const reassignedBlankSession = {
      id: dedicatedSession.id,
      header: { agentPreset: 'standard' },
      events: [
        { type: 'agent-preset/selected', data: { agentPreset: 'saved-agent' } },
        { type: 'user/message', data: { source: { kind: 'user' } } },
      ],
    }
    expect(guard?.({ name: 'bash', agent: { session: reassignedBlankSession } })).toBeUndefined()

    service.setAgentAuthoringEnabled(true)
    service.setAgentAuthoringEnabled(true)
    service.setAgentAuthoringEnabled(false)
    service.setAgentAuthoringEnabled(false)
    service.setAgentAuthoringEnabled(true)

    expect(activeSkills).toEqual(new Set(['paimind-agent-authoring']))
    expect(activeTools).toEqual(new Set(['paimind_agent_prepare_create', 'paimind_agent_skill_binding']))
    expect(skillRegistrations.get('paimind-agent-authoring')).toBe(3)
    expect(skillDisposals.get('paimind-agent-authoring')).toBe(2)
    expect(toolRegistrations.get('paimind_agent_prepare_create')).toBe(3)
    expect(toolDisposals.get('paimind_agent_prepare_create')).toBe(2)
    expect(toolRegistrations.get('paimind_agent_skill_binding')).toBe(1)
    expect(toolDisposals.get('paimind_agent_skill_binding')).toBeUndefined()
  })

  it('rolls back the private prepare Tool when Agent authoring Skill registration fails and permits a clean retry', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-agent-authoring-rollback-'))
    roots.push(base)
    const activeSkills = new Set<string>()
    const activeTools = new Set<string>()
    let failNextAuthoringSkill = false
    let prepareRegistrations = 0
    let bindingRegistrations = 0
    const context = {
      reflect: { provide: () => {} }, get: () => undefined,
      effect(install: () => void | (() => void | Promise<void>)) { install() },
      sessions: { get: () => undefined },
      agents: { get: () => undefined, list: () => [] },
      tools: {
        guard: () => () => {},
        register(definition: unknown) {
          const toolName = (definition as { readonly name?: unknown }).name
          if (typeof toolName !== 'string') throw new Error('test Tool has no name')
          if (activeTools.has(toolName)) throw new Error(`duplicate Tool: ${toolName}`)
          activeTools.add(toolName)
          if (toolName === 'paimind_agent_prepare_create') prepareRegistrations += 1
          if (toolName === 'paimind_agent_skill_binding') bindingRegistrations += 1
          let disposed = false
          return () => {
            if (disposed) return
            disposed = true
            activeTools.delete(toolName)
          }
        },
      },
      skills: {
        register(definition: { readonly name: string }) {
          if (failNextAuthoringSkill && definition.name === 'paimind-agent-authoring') {
            failNextAuthoringSkill = false
            throw new Error('injected authoring Skill failure')
          }
          if (activeSkills.has(definition.name)) throw new Error(`duplicate Skill: ${definition.name}`)
          activeSkills.add(definition.name)
          let disposed = false
          return () => {
            if (disposed) return
            disposed = true
            activeSkills.delete(definition.name)
          }
        },
      },
      agentPresets: { composedPreset: () => 'standard' },
      on: () => () => {},
    }
    const service = new PaimindAgentProfileService(context as never, {
      presetRoot: join(base, 'presets'), skillRoot: join(base, 'skills'), stateRoot: join(base, 'state'),
    })
    await service.prepareRuntime()
    service.setAgentAuthoringEnabled(false)
    failNextAuthoringSkill = true

    expect(() => { service.setAgentAuthoringEnabled(true) }).toThrow('injected authoring Skill failure')
    expect(activeSkills.size).toBe(0)
    expect(activeTools).toEqual(new Set(['paimind_agent_skill_binding']))
    expect(bindingRegistrations).toBe(1)

    service.setAgentAuthoringEnabled(true)
    expect(activeSkills).toEqual(new Set(['paimind-agent-authoring']))
    expect(activeTools).toEqual(new Set(['paimind_agent_prepare_create', 'paimind_agent_skill_binding']))
    expect(prepareRegistrations).toBe(3)
    expect(bindingRegistrations).toBe(1)
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
    )).resolves.toEqual({
      sections: [{ name: 'ordinary', text: 'ordinary prompt' }], contexts: [{ name: 'cwd' }],
      tools: ['bash', 'ask_user_question', 'paimind_agent_prepare_create'],
    })
    expect(section).not.toHaveBeenCalled()
    expect(suppressRuntimeContext).not.toHaveBeenCalled()
    await expect(service.prepareAuthoringTurn({
      sessionId, draft: authoringDraft, skills: [{ name: 'web-research', description: 'Research the web' }], locale: 'zh-CN',
    })).rejects.toThrow('智能体创建会话')
  })

  it('uses an ordinary Tool result for Builder recovery without sealing the Standard Session', async () => {
    const sessionId = 'ordinary-promoted-session'
    const session = {
      id: sessionId,
      header: { id: sessionId, agentPreset: 'standard' },
      events: [
        { type: 'tool/call', seq: 20, data: { callId: 'call-create', name: 'paimind_agent_prepare_create' } },
        { type: 'tool/result', seq: 21, data: { message: { source: { callId: 'call-create' }, content: [{ type: 'text', text: '<!--PAIMIND_AGENT_DRAFT\n{"name":"Risk Agent"}\n-->' }] } } },
      ],
    }
    const agent = { id: sessionId, session, ctx: { systemPrompt: { section: () => () => {}, suppressRuntimeContext: () => () => {} }, tools: { register: () => () => {} } } }
    let assemble: ((
      assembly: { readonly sections?: readonly unknown[]; readonly contexts?: readonly unknown[]; readonly tools: readonly unknown[] },
      context: { readonly agent?: typeof agent },
      next: () => Promise<{ readonly sections?: readonly unknown[]; readonly contexts?: readonly unknown[]; readonly tools: readonly unknown[] }>,
    ) => Promise<{ readonly sections?: readonly unknown[]; readonly contexts?: readonly unknown[]; readonly tools: readonly unknown[] }>) | undefined
    let guard: ((execution: { readonly name: string; readonly agent?: { readonly session?: typeof session } }) => string | undefined) | undefined
    const context = {
      reflect: { provide: () => {} }, get: () => undefined,
      effect(install: () => void | (() => void)) { install() },
      sessions: { get: (id: string) => id === sessionId ? session : undefined },
      agents: { get: (id: string) => id === sessionId ? agent : undefined, list: () => [] },
      tools: { guard(listener: typeof guard) { guard = listener; return () => {} } },
      agentPresets: { composedPreset: () => 'standard' },
      on(event: string, listener: typeof assemble) { if (event === 'system-prompt/assemble') assemble = listener; return () => {} },
    }
    const service = new PaimindAgentProfileService(context as never)
    expect(isPaimindAgentAuthoringSession(session)).toBe(true)
    await expect(service.sealAuthoringSession({ sessionId })).resolves.toEqual({
      sessionId, agentPreset: 'standard', sealed: true,
    })
    expect(guard?.({ name: 'bash', agent: { session } })).toBeUndefined()
    expect(guard?.({ name: 'write', agent: { session } })).toBeUndefined()
    await expect(assemble?.({ tools: [] }, { agent }, async () => ({
      sections: [{ name: 'ordinary', text: 'ordinary prompt' }], contexts: [{ name: 'cwd', text: '/workspace' }],
      tools: ['skill', 'ask_user_question', 'paimind_agent_prepare_create', 'bash'],
    }))).resolves.toEqual({
      sections: [{ name: 'ordinary', text: 'ordinary prompt' }], contexts: [{ name: 'cwd', text: '/workspace' }],
      tools: ['skill', 'ask_user_question', 'paimind_agent_prepare_create', 'bash'],
    })
  })

  it('merges structured draft edits and validates Business Skills against the live repository', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-agent-authoring-skills-'))
    roots.push(base)
    const skillRoot = join(base, 'skills')
    await mkdir(join(skillRoot, 'web-research'), { recursive: true })
    await writeFile(join(skillRoot, 'web-research', 'SKILL.md'), '---\nname: web-research\ndescription: Research the web\n---\n')
    const sessionId = 'paimind-authoring-323e4567-e89b-12d3-a456-426614174000'
    const session = { id: sessionId, header: { id: sessionId, agentPreset: 'standard' }, events: [] }
    const ordinarySession = { id: 'ordinary-live-skill-session', header: { id: 'ordinary-live-skill-session', agentPreset: 'standard' }, events: [] }
    const section = vi.fn(() => () => {})
    const suppressRuntimeContext = vi.fn(() => () => {})
    const agent = { id: sessionId, session, ctx: { systemPrompt: { section, suppressRuntimeContext }, tools: { register: vi.fn(() => () => {}) } } }
    const ordinaryAgent = { id: ordinarySession.id, session: ordinarySession, ctx: agent.ctx }
    const lifecycle = new Map<string, (event: { readonly agent: typeof agent }) => void>()
    const effectCleanups = new Map<string, () => void | Promise<void>>()
    const registeredTools: Array<{
      readonly name: string
      execute(args: Record<string, unknown>, exec: unknown): Promise<Record<string, unknown>>
    }> = []
    const context = {
      reflect: { provide: () => {} }, get: () => undefined,
      effect(install: () => void | (() => void | Promise<void>), label?: string) {
        const cleanup = install()
        if (label !== undefined && typeof cleanup === 'function') effectCleanups.set(label, cleanup)
      },
      sessions: { get: (id: string) => id === sessionId ? session : id === ordinarySession.id ? ordinarySession : undefined },
      agents: { get: (id: string) => id === sessionId ? agent : id === ordinarySession.id ? ordinaryAgent : undefined, list: () => [agent, ordinaryAgent] },
      tools: {
        guard: () => () => {},
        register(tool: (typeof registeredTools)[number]) { registeredTools.push(tool); return () => {} },
      },
      skills: { register: () => () => {} },
      agentPresets: { composedPreset: () => 'standard' },
      on(event: string, listener: (event: { readonly agent: typeof agent }) => void) {
        if (event === 'agent/disposed') lifecycle.set(event, listener)
        return () => {}
      },
    }
    const service = new PaimindAgentProfileService(context as never, {
      presetRoot: join(base, 'presets'), skillRoot, stateRoot: join(base, 'state'),
    })
    const prepareTool = registeredTools.find(tool => tool.name === 'paimind_agent_prepare_create')
    expect(prepareTool).toBeDefined()
    expect(section).not.toHaveBeenCalled()
    expect(suppressRuntimeContext).not.toHaveBeenCalled()

    await expect(service.prepareAuthoringTurn({
      sessionId,
      draft: { ...authoringDraft, name: 'First {{secret}} <!--FAKE-->' },
      skills: [{ name: 'web-research', description: 'Research {{hidden}} <!--SKILL-->' }],
      locale: 'zh-CN',
    })).resolves.toEqual({ sessionId, agentPreset: 'standard', prepared: true })
    const toolExec = {
      agent: { id: sessionId, session }, signal: new AbortController().signal,
    }
    const proposal = {
      name: 'Research Assistant', description: 'Research decisions', role: 'Research specialist',
      goal: 'Produce a useful brief', behavior: 'Separate facts and recommendations.', instructions: 'Stay concise.',
      preferredSkillNames: ['web-research'],
    }
    await expect(prepareTool?.execute(proposal, toolExec)).resolves.toEqual({ proposal })

    await expect(prepareTool?.execute({ name: 'Renamed Research Assistant' }, toolExec)).resolves.toEqual({
      proposal: {
        name: 'Renamed Research Assistant', description: authoringDraft.description, role: authoringDraft.role,
        goal: authoringDraft.goal, behavior: authoringDraft.behavior, instructions: authoringDraft.instructions,
        preferredSkillNames: ['web-research'],
      },
    })
    await expect(prepareTool?.execute({ ...proposal, preferredSkillNames: ['missing-skill'] }, toolExec))
      .rejects.toThrow('当前已安装的业务 Skill')

    await service.prepareAuthoringTurn({
      sessionId,
      draft: { ...authoringDraft, name: 'Second Assistant', preferredSkillNames: [] },
      skills: [],
      locale: 'en-US',
    })
    await expect(prepareTool?.execute({ ...proposal, preferredSkillNames: ['ppt-master'] }, toolExec))
      .rejects.toThrow('当前已安装的业务 Skill')
    await mkdir(join(skillRoot, 'ppt-master'), { recursive: true })
    await writeFile(join(skillRoot, 'ppt-master', 'SKILL.md'), '---\nname: ppt-master\ndescription: Build presentations\n---\n')
    await expect(prepareTool?.execute({ ...proposal, preferredSkillNames: ['ppt-master'] }, toolExec)).resolves.toMatchObject({
      proposal: { preferredSkillNames: ['ppt-master'] },
    })

    lifecycle.get('agent/disposed')?.({ agent })
    await expect(prepareTool?.execute(proposal, toolExec)).resolves.toEqual({ proposal })
    await service.prepareAuthoringTurn({
      sessionId, draft: authoringDraft, skills: [{ name: 'web-research', description: 'Research the web' }], locale: 'zh-CN',
    })
    await effectCleanups.get('paimind-agent-builder: startup legacy Provider retirement and ephemeral authoring lifecycle')?.()
    await expect(prepareTool?.execute(proposal, toolExec)).resolves.toEqual({ proposal })
    await expect(prepareTool?.execute(proposal, {
      agent: { id: ordinarySession.id, session: ordinarySession }, signal: new AbortController().signal,
    })).resolves.toEqual({ proposal })
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
    const emptySelection = await service.businessSkillNamesForPreset('stable-agent')
    expect(emptySelection).toEqual([])
    expect(Object.isFrozen(emptySelection)).toBe(true)
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
    expect(result).not.toContain('Capability terminology:')
    expect(result).not.toContain('Agent Business Skills')
    expect(result).not.toContain('web-research')
    expect(result).not.toContain('Global Skills')
    expect(result).toContain("- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'")
  })

  it('removes the retired Agent filesystem override and preserves native Standard discovery idempotently', () => {
    const source = "# PAIMind skill scope: v1-test\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n  config:\n    providerName: 'paimind-agent-scope'\n    includeDefaultRoots: false\n    customSkillDirs:\n      - \"/tmp/agent-scope\"\n\n- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n"
    const first = removePresetSkillFilesystemOverride(source)
    const second = removePresetSkillFilesystemOverride(first)
    expect(second).toBe(first)
    expect(first).toContain("- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'")
    expect(first).not.toContain('includeDefaultRoots: false')
    expect(first).not.toContain('customSkillDirs:')
    expect(first).not.toContain('paimind-agent-scope')
    expect(first).not.toContain('.paimind-skills')
    expect(first).toContain("- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'")
  })

  it('persists only Agent Skill references and removes the retired filesystem provider without projecting a second catalog', async () => {
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
    await expect(stat(scopeRoot)).rejects.toThrow()
    const composition = await readFile(join(source, 'agent.cordis.yml'), 'utf8')
    expect(composition).toContain("- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'")
    expect(composition).not.toContain('includeDefaultRoots: false')
    expect(composition).not.toContain('customSkillDirs:')
    expect(composition).not.toContain('paimind-agent-scope')
    expect(composition).not.toContain('selected-skill')
    const persistedProfile = JSON.parse(await readFile(join(source, AGENT_PROFILE_FILE), 'utf8')) as AgentBusinessProfile
    expect(persistedProfile.preferredSkillNames).toEqual(['selected-skill'])
    const selectedNames = await service.businessSkillNamesForPreset('my-agent')
    expect(selectedNames).toEqual(['selected-skill'])
    expect(Object.isFrozen(selectedNames)).toBe(true)
    await expect(service.businessSkillNamesForPreset('missing-agent')).resolves.toBeUndefined()
    expect(PAIMIND_AGENT_PROFILE_REMOTE_DESCRIPTORS.map(descriptor => String(descriptor.method))).not.toContain('businessSkillNamesForPreset')

    await mkdir(join(scopeRoot, 'selected-skill'), { recursive: true })
    await writeFile(join(scopeRoot, 'selected-skill', 'SKILL.md'), 'legacy duplicate provider\n')
    await writeFile(join(source, 'agent.cordis.yml'), composition.replace(
      "- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n",
      `# PAIMind skill scope: legacy\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n  config:\n    providerName: 'paimind-agent-scope'\n    includeDefaultRoots: false\n    customSkillDirs:\n      - ${JSON.stringify(scopeRoot)}\n`,
    ))
    const listed = await service.listProfiles()
    expect(listed.profiles[0]?.health).toBe('healthy')
    await expect(stat(scopeRoot)).rejects.toThrow()
    const repairedComposition = await readFile(join(source, 'agent.cordis.yml'), 'utf8')
    expect(repairedComposition).not.toContain('paimind-agent-scope')
    expect(repairedComposition).not.toContain('customSkillDirs:')
    expect(repairedComposition).not.toContain('.paimind-skills')
    expect(repairedComposition.match(/^- id:\s*skill-filesystem\s*$/gm)).toHaveLength(1)
  })

  it('retires legacy Agent providers during Plugin startup and blocks already-mounted historical Agents until rebuilt', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-agent-startup-retirement-'))
    roots.push(base)
    const presetRoot = join(base, '.agent-presets')
    const stateRoot = join(base, '.state')
    const source = join(presetRoot, 'legacy-agent')
    const scopeRoot = join(source, AGENT_SKILL_SCOPE_DIRECTORY)
    await mkdir(join(scopeRoot, 'selected-skill'), { recursive: true })
    await writeFile(join(scopeRoot, 'selected-skill', 'SKILL.md'), 'legacy duplicate provider\n')
    await writeFile(join(source, 'agent.cordis.yml'), `# PAIMind skill scope: legacy\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n  config:\n    providerName: 'paimind-agent-scope'\n    includeDefaultRoots: false\n    customSkillDirs:\n      - ${JSON.stringify(scopeRoot)}\n\n- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n`)
    await writeFile(join(source, AGENT_PROFILE_FILE), `${JSON.stringify({
      ...profile, agentId: 'legacy-agent', presetId: 'legacy-agent', preferredSkillNames: [],
    })}\n`)
    const session = { id: 'historical-session', header: { id: 'historical-session', agentPreset: 'legacy-agent' }, events: [] }
    const childContext = {
      systemPrompt: { section: () => () => {}, suppressRuntimeContext: () => () => {} },
      tools: { register: () => () => {} },
    }
    const historicalAgent = { id: session.id, session, ctx: childContext }
    let created: ((event: { readonly agent: typeof historicalAgent }) => void) | undefined
    let preStep: ((event: { readonly agent: typeof historicalAgent }, next: () => Promise<unknown>) => Promise<unknown>) | undefined
    const context = {
      reflect: { provide: () => {} }, get: () => undefined,
      effect(install: () => void | (() => void | Promise<void>)) { install() },
      sessions: { get: () => session },
      agents: { get: () => historicalAgent, list: () => [historicalAgent] },
      tools: { guard: () => () => {}, register: () => () => {} },
      skills: { register: () => () => {}, list: async () => [] },
      agentPresets: { composedPreset: () => 'legacy-agent' },
      on(event: string, listener: unknown) {
        if (event === 'agent/created') created = listener as typeof created
        if (event === 'agent/pre-step') preStep = listener as typeof preStep
        return () => {}
      },
    }
    const service = new PaimindAgentProfileService(context as never, {
      presetRoot, stateRoot, skillRoot: join(base, 'skills'), now: () => 42,
    })

    await service.prepareRuntime()
    await expect(stat(scopeRoot)).rejects.toThrow()
    const repaired = await readFile(join(source, 'agent.cordis.yml'), 'utf8')
    expect(repaired).not.toContain('paimind-agent-scope')
    expect(repaired).not.toContain('customSkillDirs:')
    expect(repaired.match(/^- id:\s*skill-filesystem\s*$/gm)).toHaveLength(1)
    const historicalNext = vi.fn(async () => ({ kind: 'enter' }))
    await expect(preStep?.({ agent: historicalAgent }, historicalNext)).rejects.toThrow(/迁移前创建/)
    expect(historicalNext).not.toHaveBeenCalled()

    const rebuiltAgent = { ...historicalAgent }
    created?.({ agent: rebuiltAgent })
    const rebuiltNext = vi.fn(async () => ({ kind: 'enter' }))
    await expect(preStep?.({ agent: rebuiltAgent }, rebuiltNext)).resolves.toEqual({ kind: 'enter' })
    expect(rebuiltNext).toHaveBeenCalledOnce()
  })

  it('reports that a bound Business Skill takes effect in the current Agent Session on its next turn', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-agent-binding-message-'))
    roots.push(base)
    const presetRoot = join(base, '.agent-presets')
    const skillRoot = join(base, 'skills')
    const source = join(presetRoot, 'message-agent')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n")
    await writeFile(join(source, 'preset.yml'), 'name: Message Agent\n')
    await mkdir(join(skillRoot, 'review-method'), { recursive: true })
    await writeFile(join(skillRoot, 'review-method', 'SKILL.md'), '---\nname: review-method\ndescription: Review method\n---\n')
    const session = { id: 'message-session', header: { id: 'message-session', agentPreset: 'message-agent' }, events: [] }
    const agent = {
      id: session.id, session,
      ctx: {
        systemPrompt: { section: () => () => {}, suppressRuntimeContext: () => () => {} },
        tools: { register: () => () => {} },
      },
    }
    const registeredTools: Array<{ readonly name: string; execute(args: unknown, exec: unknown): Promise<Record<string, unknown>> }> = []
    const context = {
      reflect: { provide: () => {} }, get: () => undefined,
      effect(install: () => void | (() => void | Promise<void>)) { install() },
      sessions: { get: (id: string) => id === session.id ? session : undefined },
      agents: { get: (id: string) => id === agent.id ? agent : undefined, list: () => [] },
      tools: {
        guard: () => () => {},
        register(tool: (typeof registeredTools)[number]) { registeredTools.push(tool); return () => {} },
      },
      skills: { register: () => () => {}, list: async () => [] },
      agentPresets: { composedPreset: () => 'message-agent' },
      on: () => () => {},
    }
    const service = new PaimindAgentProfileService(context as never, {
      presetRoot, skillRoot, stateRoot: join(base, '.state'), now: () => 42,
    })
    await service.prepareRuntime()
    await service.saveProfile({
      agentId: 'message-agent', presetId: 'message-agent', name: 'Message Agent', description: '',
      basePresetId: 'standard', role: 'Reviewer', goal: 'Review evidence', behavior: 'Be precise',
      preferredSkillNames: [], instructions: '',
    })
    const bindingTool = registeredTools.find(tool => tool.name === 'paimind_agent_skill_binding')
    await expect(bindingTool?.execute(
      { operation: 'bind', skill_name: 'review-method' },
      { agent: { id: session.id, session }, signal: new AbortController().signal },
    )).resolves.toMatchObject({
      bound: true,
      message: 'Skill 已绑定当前 Agent；当前 Agent Session 从下一轮开始使用更新后的配置，历史消息不会改写。',
    })
    await expect(service.businessSkillNamesForPreset('message-agent')).resolves.toEqual(['review-method'])
  })

  it('rejects Agent attachment when an installed Business Skill now collides with a visible System Skill', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-agent-skill-collision-'))
    roots.push(base)
    const presetRoot = join(base, '.agent-presets')
    const skillRoot = join(base, 'skills')
    const source = join(presetRoot, 'collision-agent')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n\n- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n")
    await mkdir(join(skillRoot, 'future-system'), { recursive: true })
    await writeFile(join(skillRoot, 'future-system', 'SKILL.md'), '---\nname: future-system\ndescription: business copy\n---\n')
    const context = {
      ...authoringPolicyStubs,
      reflect: { provide: () => {} },
      effect(install: () => void) { install() },
      get: () => undefined,
      skills: { register: () => () => {}, list: async () => [{ name: 'future-system' }] },
    }
    const service = new PaimindAgentProfileService(context as never, {
      presetRoot, skillRoot, stateRoot: join(base, '.state'),
    })

    await expect(service.saveProfile({
      agentId: 'collision-agent', presetId: 'collision-agent', name: 'Collision Agent', description: '',
      basePresetId: 'standard', role: 'Reviewer', goal: 'Avoid ambiguous capability ownership',
      behavior: 'Fail closed', preferredSkillNames: ['future-system'], instructions: '',
    })).rejects.toThrow(/与当前系统能力冲突/)
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
