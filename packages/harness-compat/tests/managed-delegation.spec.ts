// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManagedHarnessDelegationProviders } from '../src/managed-delegation.js'
import { installManagedHarnessOriginGuard } from '../src/managed-origins.js'

const local = createRequire(import.meta.url), native = createRequire(local.resolve('@deepseek-ai/dsh/package.json'))
const web = createRequire(native.resolve('@deepseek-ai/dsh-web-app/package.json'))
const { Context, symbols } = web('@deepseek-ai/cordis'), { AgentLoop } = web('@deepseek-ai/dsh-agent-loop')
const serviceInstance = (value: any) => value[symbols.original] ?? value
const { SessionStore } = web('@deepseek-ai/dsh-session'), { SystemPrompt } = web('@deepseek-ai/dsh-system-prompt')
const { LlmRuntime, LlmAdapter, createUserMessage } = web('@deepseek-ai/dsh-llm'), { ToolRuntime } = web('@deepseek-ai/dsh-tools')
const spawn = native('@deepseek-ai/dsh-subagent-spawn-in-process')
const fork = native('@deepseek-ai/dsh-subagent-fork-in-process')
const { JsonlSessionPersistence } = web('@deepseek-ai/dsh-session-persistence-jsonl')
const { SkillRegistry, renderSkillContent } = native('@deepseek-ai/dsh-skill'), ToolSkill = native('@deepseek-ai/dsh-tool-skill')
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const origin = (letter: string) => `paimind-origin-v1.e30.${letter.repeat(43)}`
const text = (value: string) => [{ type: 'text', text: value }]
const aborted = (signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true })
})
const skillId = '11111111-1111-4111-8111-111111111111'
const skillOrigin = (letter: string, requirements: readonly string[]) => 'paimind-origin-v1.'
  + Buffer.from(JSON.stringify({ requiredSkillIds: requirements })).toString('base64url') + '.' + letter.repeat(43)
async function fixture(holdChild = false, persist = false, skillMode?: 'tool' | 'nested-failure' | 'nested-cancel') {
  const root = new Context(), parentEntered = Promise.withResolvers<void>(), childEntered = Promise.withResolvers<AbortSignal>()
  const childRelease = Promise.withResolvers<void>()
  const childHook = { visit: undefined as ((call: number) => Promise<void>) | undefined }
  const parentRelease = Promise.withResolvers<void>(), parentFollowupEntered = Promise.withResolvers<AbortSignal>()
  const parentFlow = { calls: 0, holdAfterFirst: false }
  let childCalls = 0
  const insertions: any[] = [], checks: any[] = [], childRequests: any[] = [], revokedSkills = new Set<string>()
  const derive = vi.fn(async (input: any, _signal: AbortSignal) => ({ nativeSessionId: input.targetSessionId,
    sources: [skillMode ? skillOrigin(input.targetSessionId === 'hansen-parent' ? 's' : 'c', input.requirements ?? [])
      : origin(input.targetSessionId === 'hansen-parent' ? 's' : 'c')] }))
  const check = vi.fn(async (input: any) => {
    checks.push(input)
    if (!skillMode) return
    // Explicit authority fixture, not cryptographic verification or PG proof.
    const inherited = input.sources.flatMap((value: string) => JSON.parse(Buffer.from(value.split('.')[1]!, 'base64url').toString('utf8')).requiredSkillIds ?? [])
    const ids = [...new Set<string>([...(input.requirements ?? []), ...inherited])].sort()
    if (ids.some(id => revokedSkills.has(id))) throw Error('Explicit current Skill denial')
    return ids
  })
  const skillCheck = vi.fn(async (_input: any, value: any) => {
    if (revokedSkills.has(skillId)) throw Error('Explicit current loaded Skill denial')
    return { name: value.name, publicationId: skillId, packageDigest: 'sha256:' + 'b'.repeat(64) }
  })
  installManagedHarnessOriginGuard(root, check, skillMode ? { check: skillCheck, render: renderSkillContent } : undefined)
  const managed = createManagedHarnessDelegationProviders(root, derive, [spawn, fork])
  let directory: string | undefined
  if (persist) {
    directory = await mkdtemp(join(tmpdir(), 'paimind-native-delegation-'))
    const ownDirectory = directory; cleanups.push(() => rm(ownDirectory, { recursive: true, force: true }))
  }
  cleanups.push(async () => { for (const agent of root.get('agents')?.list() ?? []) agent.cancel({ kind: 'user' }); await root.fiber.dispose() })
  let subagentsPlugin: Awaited<ReturnType<typeof root.plugin>>
  // Original run_code dispatch with an explicit local code-provider fixture.
  if (skillMode?.startsWith('nested-')) root.provide('codeRuntime', { language: 'typescript', isolation: 'process', async run(request: any) {
    const value = await request.bindings[0].functions.skill(JSON.parse(request.program))
    if (skillMode === 'nested-cancel') root.agents.requireInitiator().cancel({ kind: 'user' })
    return skillMode === 'nested-failure' ? { logs: [], error: { kind: 'runtime', message: 'Explicit error after original Skill load' } } : { logs: [], value }
  } })
  for (const [plugin, config] of [[SessionStore], [managed.Agents], [SystemPrompt, {}], [LlmRuntime],
    [ToolRuntime, skillMode?.startsWith('nested-') ? { mode: 'code' } : {}], [managed.Subagents], ...(skillMode ? [[SkillRegistry], [ToolSkill, {}]] : [])]) {
    const installed = await root.plugin(plugin, config)
    if (plugin === managed.Subagents) subagentsPlugin = installed
  }
  if (directory) await root.plugin(JsonlSessionPersistence, { root: directory, compression: 'none' })
  if (skillMode) root.subagents.registerContinuableSetup(async (context: any) => {
    await context.plugin({ name: 'fixture-child-scoped-method', inject: ['skills'], apply(ctx: any) {
      ctx.skills.register({ name: 'hansen-method', description: 'Hansen child scoped method', content: 'Protected child method body', source: 'custom' })
    } })
  })
  // Explicit preset-owner fixture; original child metadata/composition and
  // Agent/Session/Inbox/loop/providers are real installed rc.2 implementations.
  const selectedPreset = { value: 'standard', childValue: undefined as string | undefined }
  root.provide('agentPresets', { composedPreset: (ctx: any) => ctx.agent?.session.header.origin === 'subagent'
    ? selectedPreset.childValue ?? ctx.agent.session.header.agentPreset : selectedPreset.value, composeFrom: () => {} })
  root.llm.registerAdapter(['parent-local-only'], new class extends LlmAdapter {
    async *stream(request: { signal: AbortSignal }) {
      parentFlow.calls++; parentEntered.resolve()
      if (parentFlow.calls > 1 && parentFlow.holdAfterFirst) {
        parentFollowupEntered.resolve(request.signal); await aborted(request.signal); return
      }
      await Promise.race([aborted(request.signal), parentRelease.promise])
      if (request.signal.aborted) return
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Synthetic parent result, no external model' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Synthetic parent result, no external model' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }())
  root.llm.registerAdapter(['child-local-only'], new class extends LlmAdapter {
    async *stream(request: { signal: AbortSignal }) {
      childRequests.push(request)
      childCalls++; childEntered.resolve(request.signal)
      if (holdChild) { await Promise.race([aborted(request.signal), childRelease.promise]); if (request.signal.aborted) return }
      await childHook.visit?.(childCalls)
      if (skillMode && childCalls === 1) {
        const name = skillMode === 'tool' ? 'skill' : 'run_code', args = { name: 'hansen-method' }
        const input = JSON.stringify(skillMode === 'tool' ? args : { code: JSON.stringify(args), description: 'Explicit nested Skill fixture' })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: 'child-skill-load', name, argumentsDelta: input }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'child-skill-load', name, arguments: input } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }; return
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Synthetic child result, no external model' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Synthetic child result, no external model' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }())
  await root.plugin(AgentLoop, { agents: [] })
  const spawnPlugin = await root.plugin(managed.selectProvider(spawn), { providerName: 'original-spawn' })
  await root.plugin(managed.selectProvider(fork), { providerName: 'original-fork' })
  root.on('agent/inbox/inserted', ({ message, agent }: any) => insertions.push({ agentId: agent?.id, message: structuredClone(message) }))
  const parent = await root.agents.create({ sessionId: 'hansen-parent', meta: { agentPreset: 'standard' },
    agentOptions: { provider: 'parent-local-only', model: 'synthetic' } })
  parent.agent.followup(createUserMessage({ source: { kind: 'user', rpcId: origin('h') }, content: text('Hold parent while native child runs') }))
  await parentEntered.promise
  const request = (signal = new AbortController().signal) => ({ parent: parent.agent, prompt: text('核对报价'), signal,
    agentOptions: { provider: 'child-local-only', model: 'synthetic' }, persona: '核对当前报价', maxDepth: 3 })
  const start = (signal?: AbortSignal) => root.subagents.start('original-spawn', request(signal))
  const startContinuable = async () => {
    const { signal, ...input } = request()
    return root.subagents.startContinuable({ provider: 'original-spawn', label: '报价核对', request: input, signal })
  }
  const followup = (childId: string, body = '继续核对', signal = new AbortController().signal) => root.subagents.followup(parent.agent, childId, text(body), {
    source: { kind: 'coordinator', form: 'relay', senderSessionId: parent.agent.id }, signal,
  })
  return { root, parent, managed, subagentsPlugin: subagentsPlugin!, spawnPlugin, derive, check, checks, insertions, request, start, startContinuable, followup,
    childEntered, childRelease, childHook, childCalls: () => childCalls, selectedPreset, directory,
    parentFlow, parentRelease, parentFollowupEntered, skillCheck, revokedSkills, childRequests }
}

describe('original subagent plugin unload and reload with local-only models', () => {
  it.each(['one-shot', 'continuable'])('cancels an unpublished %s creation without waiting for the parent to stop', async mode => {
    const f = await fixture(true, true), entered = Promise.withResolvers<AbortSignal>()
    f.derive.mockImplementationOnce(async (_input, signal) => { entered.resolve(signal); return new Promise(() => {}) })
    const pending = mode === 'one-shot' ? f.start() : f.startContinuable()
    const outcome = pending.then(() => 'unexpectedly accepted', () => 'rejected'), signal = await entered.promise
    await f.subagentsPlugin.dispose()
    expect(signal.aborted).toBe(true); expect(await outcome).toBe('rejected')
    expect(f.root.agents.list().map((agent: any) => agent.id)).toEqual([f.parent.agent.id])
    expect(f.childCalls()).toBe(0)
    expect(f.parent.agent.status).toBe('running')
    expect(f.insertions.filter(row => row.agentId !== f.parent.agent.id)).toHaveLength(0)
  })
  it.each(['followup', 'report'])('cancels a pending %s derivation when only its service plugin unloads', async operation => {
    const f = await fixture(true, true), { childId } = await f.startContinuable(), child = f.root.agents.get(childId)
    await f.childEntered.promise
    const old = f.root.subagents, entered = Promise.withResolvers<AbortSignal>()
    const originalAgents = serviceInstance(f.root.agents), originalSessions = serviceInstance(f.root.sessions), originalTools = serviceInstance(f.root.tools)
    f.derive.mockImplementationOnce(async (_input, signal) => { entered.resolve(signal); return new Promise(() => {}) })
    const pending = operation === 'followup' ? f.followup(childId) : old.reportFrom(child, text('pending old report'), {
      delivery: 'quiet', signal: new AbortController().signal,
    })
    const outcome = pending.then(() => 'unexpectedly accepted', () => 'rejected')
    const signal = await entered.promise
    await f.subagentsPlugin.dispose()
    expect(signal.aborted).toBe(true)
    expect(await outcome).toBe('rejected')
    expect(f.managed.ownsSubagents(old)).toBe(false)
    expect(f.root.get('subagents') === undefined, 'subagent service is absent').toBe(true)
    expect(serviceInstance(f.root.agents) === originalAgents, 'same Agent Registry').toBe(true)
    expect(serviceInstance(f.root.sessions) === originalSessions, 'same Session Store').toBe(true)
    expect(serviceInstance(f.root.tools) === originalTools, 'same Tool Runtime').toBe(true)
    expect(f.root.agents.get(f.parent.agent.id) === f.parent.agent, 'same original parent').toBe(true)
    expect(Object.hasOwn(child, 'followup')).toBe(false)
    for (const method of ['followup', 'steer', 'inject']) expect(Object.hasOwn(f.parent.agent, method)).toBe(false)
    await expect(old.followup(f.parent.agent, childId, text('stale retained service'), {
      source: { kind: 'user', rpcId: origin('u') }, signal: new AbortController().signal,
    })).rejects.toThrow()
  })
  it('withdraws a pending terminal proof and all temporary parent hooks on service unload', async () => {
    const f = await fixture(true, true), { childId } = await f.startContinuable(), child = f.root.agents.get(childId)
    await f.childEntered.promise
    const entered = Promise.withResolvers<AbortSignal>()
    f.derive.mockImplementationOnce(async (_input, signal) => { entered.resolve(signal); return new Promise(() => {}) })
    f.childRelease.resolve(); const signal = await entered.promise
    await f.subagentsPlugin.dispose()
    expect(signal.aborted).toBe(true)
    expect(f.root.agents.get(childId) === undefined).toBe(true)
    expect(Object.hasOwn(child, 'followup')).toBe(false)
    for (const method of ['followup', 'steer', 'inject']) expect(Object.hasOwn(f.parent.agent, method)).toBe(false)
    expect(f.insertions.filter(row => row.message.source.kind === 'subagent-settled'
      && row.message.source.paimindOrigins !== undefined)).toHaveLength(0)
    expect(f.root.agents.get(f.parent.agent.id) === f.parent.agent).toBe(true)
  })
  it.each(['provider', 'service'])('keeps an already returned one-shot run under its original holder when the %s plugin is removed and restored', async mode => {
    const f = await fixture(true, true), run = await f.start()
    try {
      const signal = await f.childEntered.promise
      const old = f.root.subagents
      await (mode === 'provider' ? f.spawnPlugin : f.subagentsPlugin).dispose()
      if (mode === 'provider') expect(f.root.subagents.list()).toEqual(['original-fork'])
      else expect(f.root.get('subagents') === undefined).toBe(true)
      await expect(old.start('original-spawn', f.request())).rejects.toThrow()
      expect(signal.aborted).toBe(false)
      f.childRelease.resolve(); expect((await run.result).stopReason).toBe('completed')
      const restored = mode === 'provider' ? await f.root.plugin(f.managed.selectProvider(spawn), { providerName: 'original-spawn' })
        : await f.root.plugin(f.managed.Subagents)
      try {
        await vi.waitFor(() => expect(f.root.subagents.list().sort()).toEqual(['original-fork', 'original-spawn']))
        const next = await f.start()
        try { expect((await next.result).stopReason).toBe('completed') } finally { await next.dispose() }
        expect(f.childCalls()).toBe(2)
      } finally { await restored.dispose() }
    } finally { await run.dispose() }
  })
  it('reloads the original service and provider contributions, then cold-continues the same child without replacing parent owners', async () => {
    const f = await fixture(false, true), { childId } = await f.startContinuable()
    await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined())
    const old = f.root.subagents, originalAgents = serviceInstance(f.root.agents), originalSessions = serviceInstance(f.root.sessions), originalTools = serviceInstance(f.root.tools)
    const before = await f.root.sessionPersistence.readRaw(childId)
    await f.subagentsPlugin.dispose()
    expect(f.managed.ownsSubagents(old)).toBe(false)
    expect(f.root.agents.get(f.parent.agent.id) === f.parent.agent, 'same original parent after unload').toBe(true)
    expect((await f.root.sessionPersistence.readRaw(childId)).content).toBe(before.content)
    const replacement = await f.root.plugin(f.managed.Subagents)
    try {
      await vi.waitFor(() => expect(f.root.subagents.list().sort()).toEqual(['original-fork', 'original-spawn']))
      expect(serviceInstance(f.root.subagents) !== serviceInstance(old), 'new Subagent Runtime').toBe(true); expect(f.managed.ownsSubagents(f.root.subagents)).toBe(true)
      const mark = f.insertions.length
      f.derive.mockResolvedValueOnce({ nativeSessionId: childId, sources: [origin('d')] })
      const messageId = await f.followup(childId)
      await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined())
      expect((await f.root.sessionPersistence.readRaw(childId)).content.startsWith(before.content)).toBe(true)
      expect(f.insertions.slice(mark).find(row => row.message.id === messageId)?.message.source.paimindOrigins).toEqual([origin('d')])
      expect(f.insertions.slice(mark).filter(row => row.message.source.kind === 'subagent-settled')).toHaveLength(1)
      expect(f.insertions.slice(mark).find(row => row.message.source.kind === 'subagent-settled')?.message.source.paimindOrigins).toEqual([origin('s')])
      expect(serviceInstance(f.root.agents) === originalAgents, 'same Agent Registry after reload').toBe(true)
      expect(serviceInstance(f.root.sessions) === originalSessions, 'same Session Store after reload').toBe(true)
      expect(serviceInstance(f.root.tools) === originalTools, 'same Tool Runtime after reload').toBe(true)
      expect(f.root.agents.get(f.parent.agent.id) === f.parent.agent, 'same original parent after reload').toBe(true)
      for (const method of ['followup', 'steer', 'inject']) expect(Object.hasOwn(f.parent.agent, method)).toBe(false)
      await expect(old.start('original-spawn', f.request())).rejects.toThrow()
      expect(f.childCalls()).toBe(2)
      const second = f.root.subagents
      await replacement.restart()
      await vi.waitFor(() => expect(f.root.subagents.list().sort()).toEqual(['original-fork', 'original-spawn']))
      expect(serviceInstance(f.root.subagents) !== serviceInstance(second)).toBe(true)
      await expect(second.start('original-spawn', f.request())).rejects.toThrow()
      const afterRestart = f.insertions.length
      f.derive.mockResolvedValueOnce({ nativeSessionId: childId, sources: [origin('e')] })
      const nextId = await f.followup(childId)
      await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined())
      expect(f.insertions.slice(afterRestart).find(row => row.message.id === nextId)?.message.source.paimindOrigins).toEqual([origin('e')])
      expect(f.insertions.slice(afterRestart).filter(row => row.message.source.kind === 'subagent-settled')).toHaveLength(1)
      expect(f.childCalls()).toBe(3)
      expect(serviceInstance(f.root.agents) === originalAgents).toBe(true)
      expect(f.root.agents.get(f.parent.agent.id) === f.parent.agent).toBe(true)
    } finally { await replacement.dispose() }
  })
})

describe('original automatic settlement with terminal provenance and local-only models', () => {
  it.each(['tool', 'nested-failure', 'nested-cancel'] as const)('carries newly loaded Skill through original %s settlement and cold child recovery', async mode => {
    const f = await fixture(true, true, mode), { childId } = await f.startContinuable()
    await f.childEntered.promise
    const initial = f.derive.mock.calls.find(([input]) => input.targetSessionId === childId)![0]
    expect(initial.requirements ?? []).toEqual([])
    f.childRelease.resolve()
    await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined(), { timeout: 4000 })
    expect(f.skillCheck).toHaveBeenCalledOnce()
    const notice = f.insertions.find(row => row.message.source.kind === 'subagent-settled').message
    const terminal = f.derive.mock.calls.find(([input]) => input.targetSessionId === f.parent.agent.id)![0]
    expect(terminal.requirements).toEqual([skillId])
    expect(JSON.parse(Buffer.from(notice.source.paimindOrigins[0].split('.')[1], 'base64url').toString('utf8')).requiredSkillIds).toEqual([skillId])
    const before = await f.root.sessionPersistence.readRaw(childId)
    expect(before.content).toContain('paimindSkillUse')
    expect(f.root.sessions.get(childId)).toBeUndefined()
    // Resume through the original continuable manager and JSONL owner, never
    // constructing a second Session or guessing a replacement child identity.
    f.revokedSkills.add(skillId)
    const calls = f.childCalls(), mark = f.check.mock.calls.length
    await f.followup(childId, 'Continue the stored protected result')
    await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined(), { timeout: 4000 })
    if (mode === 'nested-cancel') {
      // The original cancellation discarded the not-yet-consumed note. Native
      // code mode did not expose the intermediate body to the model either:
      // cold history contains only the aborted tool result. Do not reintroduce
      // canceled raw-log context into this unrelated later request.
      expect(f.childCalls()).toBe(calls + 1)
      const request = f.childRequests.at(-1)
      expect(JSON.stringify(request.messages)).not.toContain('Protected child method body')
      expect(request.messages.some((message: any) => message.source?.paimindSkillUse)).toBe(false)
      expect(f.check.mock.calls.slice(mark).filter(([input]) => input.nativeSessionId === childId)
        .every(([input]) => !input.requirements?.includes(skillId))).toBe(true)
    } else {
      expect(f.childCalls()).toBe(calls)
      expect(f.check.mock.calls.slice(mark).some(([input]) => input.nativeSessionId === childId && input.requirements?.includes(skillId))).toBe(true)
    }
    expect((await f.root.sessionPersistence.readRaw(childId)).content.startsWith(before.content)).toBe(true)
    f.parentRelease.resolve(); await f.parent.agent.whenIdle()
    expect(f.parentFlow.calls).toBe(1)
    // A second unsigned failure notice may reject the batch before contacting
    // authority; either way no new parent request may run under the old login.
    expect(f.parent.agent.session.events.findLast((event: any) => event.type === 'turn/end').data.reason.kind).not.toBe('completed')
  })

  it('refuses terminal signing when a newly loaded Skill is revoked before original final flush', async () => {
    const f = await fixture(true, true, 'tool'), { childId } = await f.startContinuable()
    await f.childEntered.promise
    f.childHook.visit = async call => { if (call === 2) f.revokedSkills.add(skillId) }
    f.childRelease.resolve()
    await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined(), { timeout: 4000 })
    expect(f.skillCheck).toHaveBeenCalledOnce()
    const notice = f.insertions.find(row => row.message.source.kind === 'subagent-settled').message
    expect(notice.source.paimindOrigins).toBeUndefined()
    expect(f.derive.mock.calls.some(([input]) => input.targetSessionId === f.parent.agent.id)).toBe(false)
    expect((await f.root.sessionPersistence.readRaw(childId)).content).toContain('paimindSkillUse')
    f.parentRelease.resolve(); await f.parent.agent.whenIdle()
    expect(f.parentFlow.calls).toBe(1)
    for (const method of ['followup', 'steer', 'inject']) expect(Object.hasOwn(f.parent.agent, method)).toBe(false)
  })

  it.each(['completed', 'error', 'aborted'])('signs the original %s notice after native release without changing its id, framing or queue', async outcome => {
    const f = await fixture(true, true)
    if (outcome === 'error') f.childHook.visit = async () => { throw Error('synthetic child failure') }
    const started = await f.startContinuable(), child = f.root.agents.get(started.childId)
    await f.childEntered.promise
    if (outcome === 'aborted') child.cancel({ kind: 'user' })
    else f.childRelease.resolve()
    await vi.waitFor(() => expect(f.root.agents.get(child.id)).toBeUndefined())
    await vi.waitFor(() => expect(f.insertions.some(row => row.message.source.kind === 'subagent-settled')).toBe(true))
    const notice = f.insertions.find(row => row.message.source.kind === 'subagent-settled').message
    expect(notice.source).toMatchObject({ form: 'notice', senderSessionId: child.id, paimindOrigins: [origin('s')] })
    expect(notice.content[0].text).toContain(`Background subagent ${child.id}`)
    expect(notice.content.slice(1)).toEqual(outcome === 'completed'
      ? [...text('Its closing message:'), ...text('Synthetic child result, no external model')] : text('It left no closing message.'))
    expect(f.parent.agent.inbox.nextStep.find((message: any) => message.id === notice.id)).toEqual(notice)
    expect(f.derive.mock.calls.find(([input]) => input.targetSessionId === f.parent.agent.id)?.[0]).toMatchObject({
      nativeSessionId: child.id, presetId: 'standard', sources: [origin('c')],
    })
    for (const method of ['followup', 'steer', 'inject']) expect(Object.hasOwn(f.parent.agent, method)).toBe(false)
  })
  it('wakes an idle parent from the child source alone and verifies native cold lineage', async () => {
    const f = await fixture(true, true), started = await f.startContinuable(), child = f.root.agents.get(started.childId)
    await f.childEntered.promise
    f.parentFlow.holdAfterFirst = true; f.parentRelease.resolve(); await f.parent.agent.whenIdle()
    f.childRelease.resolve()
    const parentSignal = await f.parentFollowupEntered.promise
    expect(parentSignal.aborted).toBe(false)
    expect(f.root.agents.get(child.id)).toBeUndefined()
    expect(f.checks.findLast(input => input.nativeSessionId === f.parent.agent.id).sources).toEqual([origin('s')])
    expect(f.parent.agent.session.events.some((event: any) => event.type === 'user/message'
      && event.data.source.kind === 'subagent-settled' && event.data.source.paimindOrigins[0] === origin('s'))).toBe(true)
  })
  it.each(['signer-rejected', 'echo', 'wrong-target', 'parent-preset-changed'])('does not authorize a notice on %s, and still releases the child', async mode => {
    const f = await fixture(true, true), started = await f.startContinuable(), child = f.root.agents.get(started.childId)
    await f.childEntered.promise
    f.derive.mockImplementation(async input => {
      if (mode === 'signer-rejected') throw Error('synthetic revoked authority')
      if (mode === 'parent-preset-changed') f.selectedPreset.value = 'different'
      return { nativeSessionId: mode === 'wrong-target' ? 'wrong' : input.targetSessionId,
        sources: mode === 'echo' ? input.sources : [origin('s')] }
    })
    f.childRelease.resolve()
    await vi.waitFor(() => expect(f.root.agents.get(child.id)).toBeUndefined())
    const notice = f.insertions.find(row => row.message.source.kind === 'subagent-settled').message
    expect(notice.source.paimindOrigins).toBeUndefined()
    for (const method of ['followup', 'steer', 'inject']) expect(Object.hasOwn(f.parent.agent, method)).toBe(false)
  })
  it('includes both the earlier closing output and a later failed direct-user turn', async () => {
    const f = await fixture(true, true), started = await f.startContinuable(), child = f.root.agents.get(started.childId)
    await f.childEntered.promise
    f.childHook.visit = async call => {
      if (call === 1) child.followup(createUserMessage({ source: { kind: 'user', rpcId: origin('u') }, content: text('第二个登录的追问') }))
      else throw Error('second native turn failed without replacing first closing output')
    }
    f.childRelease.resolve()
    await vi.waitFor(() => expect(f.root.agents.get(child.id)).toBeUndefined())
    expect(f.childCalls()).toBe(2)
    expect(f.derive.mock.calls.find(([input]) => input.targetSessionId === f.parent.agent.id)?.[0].sources).toEqual([origin('c'), origin('u')])
    const notice = f.insertions.find(row => row.message.source.kind === 'subagent-settled').message
    expect(notice.content[0].text).toContain('failed')
    expect(notice.content.slice(2)).toEqual(text('Synthetic child result, no external model'))
  })
  it('uses the new cold epoch source rather than a previous completed login', async () => {
    const f = await fixture(false, true), { childId } = await f.startContinuable()
    await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined())
    f.derive.mockResolvedValueOnce({ nativeSessionId: childId, sources: [origin('d')] })
    await f.followup(childId, '新的原生驻留期')
    await vi.waitFor(() => expect(f.insertions.filter(row => row.message.source.kind === 'subagent-settled')).toHaveLength(2))
    const inputs = f.derive.mock.calls.filter(([input]) => input.targetSessionId === f.parent.agent.id).map(([input]) => input.sources)
    expect(inputs).toEqual([[origin('c')], [origin('d')]])
  })
  it.each([false, true])('accounts for unrun canceled input after the closing turn, replacement=%s', async replace => {
    const f = await fixture(true, true), started = await f.startContinuable(), child = f.root.agents.get(started.childId)
    await f.childEntered.promise
    let handled = false
    f.root.on('agent/status', ({ agent, status }: any) => {
      if (agent !== child || status !== 'idle' || handled) return
      handled = true
      child.inject(createUserMessage({ source: { kind: 'user', rpcId: origin(replace ? 'r' : 'u') }, content: text('未执行输入') }))
      if (replace) child.inbox.splice('next-step', 0, 1, [createUserMessage({ source: { kind: 'user', rpcId: origin('u') }, content: text('替换后未执行输入') })])
      child.cancel({ kind: 'user' })
    })
    f.childRelease.resolve()
    await vi.waitFor(() => expect(f.root.agents.get(child.id)).toBeUndefined())
    expect(f.childCalls()).toBe(1)
    expect(f.derive.mock.calls.find(([input]) => input.targetSessionId === f.parent.agent.id)?.[0].sources).toEqual([origin('c'), origin('u')])
    expect(f.insertions.find(row => row.message.source.kind === 'subagent-settled').message.content[0].text).toContain('stopped')
  })
  it('signs an announced child canceled before its first model step from its actually discarded input', async () => {
    const f = await fixture(false, true)
    f.root.on('agent/inbox/inserted', ({ agent, message }: any) => {
      if (agent.session.header.origin === 'subagent' && message.source.kind === 'coordinator') agent.cancel({ kind: 'user' })
    })
    const { childId } = await f.startContinuable()
    await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined())
    expect(f.childCalls()).toBe(0)
    const notice = f.insertions.find(row => row.message.source.kind === 'subagent-settled').message
    expect(notice.source.paimindOrigins).toEqual([origin('s')]); expect(notice.content[0].text).toContain('stopped')
  })
  it('keeps sibling notices separate and restores all parent send methods after the last native delivery', async () => {
    const f = await fixture(true, true), one = await f.startContinuable(), two = await f.startContinuable()
    await vi.waitFor(() => expect(f.childCalls()).toBe(2))
    f.childRelease.resolve()
    await vi.waitFor(() => expect(f.insertions.filter(row => row.message.source.kind === 'subagent-settled')).toHaveLength(2))
    const notices = f.insertions.filter(row => row.message.source.kind === 'subagent-settled').map(row => row.message)
    expect(new Set(notices.map(message => message.source.senderSessionId))).toEqual(new Set([one.childId, two.childId]))
    expect(new Set(notices.map(message => message.id)).size).toBe(2)
    expect(notices.every(message => message.source.paimindOrigins?.[0] === origin('s'))).toBe(true)
    for (const method of ['followup', 'steer', 'inject']) expect(Object.hasOwn(f.parent.agent, method)).toBe(false)
  })
  it('does not let a valid original parent login conceal revocation of a queued settlement source', async () => {
    const f = await fixture(true, true), { childId } = await f.startContinuable()
    f.childRelease.resolve(); await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined())
    f.check.mockImplementation(async input => { if (input.sources.includes(origin('s'))) throw Error('settlement source revoked') })
    f.parentRelease.resolve(); await f.parent.agent.whenIdle()
    expect(f.parentFlow.calls).toBe(1)
    expect(f.checks.some(input => input.nativeSessionId === f.parent.agent.id && input.sources.includes(origin('h')))).toBe(true)
    expect(f.check.mock.calls.some(([input]) => input.sources.includes(origin('s')))).toBe(true)
    expect(f.parent.agent.session.events.findLast((event: any) => event.type === 'turn/end').data.reason.kind).not.toBe('completed')
  })
  it('retains native notification and child release when an independent final-flush listener fails', async () => {
    const f = await fixture(true, true), { childId } = await f.startContinuable()
    f.root.on('session/flush', (session: any) => { if (session.id === childId) throw Error('synthetic independent durability failure') })
    f.childRelease.resolve(); await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined())
    expect(f.insertions.find(row => row.message.source.kind === 'subagent-settled').message.source.paimindOrigins).toEqual([origin('s')])
    expect(f.root.agents.list().map((agent: any) => agent.id)).toEqual([f.parent.agent.id])
  })
  it('keeps a closing parent quiet and removes transient send projections during original parent disposal', async () => {
    const f = await fixture(true, true), { childId } = await f.startContinuable()
    await f.childEntered.promise
    f.parent.agent.cancel({ kind: 'user' }); await f.parent.agent.whenIdle()
    // A detached continuable activation is drained through the original
    // host-teardown contract, not through an unrelated raw AgentHandle.
    await f.root.subagents.drainContinuableDescendants([f.parent.agent])
    expect(f.root.agents.get(childId) === undefined).toBe(true)
    expect(f.parent.agent.status).toBe('idle')
    const notice = f.insertions.find(row => row.message.source.kind === 'subagent-settled').message
    expect(notice.source.paimindOrigins).toEqual([origin('s')])
    expect(f.parent.agent.inbox.nextStep.some((message: any) => message.id === notice.id)).toBe(true)
    await f.parent.dispose()
    expect(f.root.agents.get(f.parent.agent.id) === undefined).toBe(true)
    expect(f.parentFlow.calls).toBe(1)
    for (const method of ['followup', 'steer', 'inject']) expect(Object.hasOwn(f.parent.agent, method)).toBe(false)
  })
  it('does not send or retain a signing projection after the exact original parent is absent', async () => {
    const f = await fixture(true, true), { childId } = await f.startContinuable()
    await f.childEntered.promise
    await f.parent.dispose()
    expect(f.root.agents.get(f.parent.agent.id) === undefined).toBe(true)
    f.childRelease.resolve()
    await vi.waitFor(() => expect(f.root.agents.get(childId) === undefined).toBe(true))
    expect(f.insertions.some(row => row.message.source.kind === 'subagent-settled')).toBe(false)
    expect(f.derive.mock.calls.some(([input]) => input.targetSessionId === f.parent.agent.id)).toBe(false)
    for (const method of ['followup', 'steer', 'inject']) expect(Object.hasOwn(f.parent.agent, method)).toBe(false)
  })
  it('preserves a competing parent sender without signing through it or partially installing other methods', async () => {
    const f = await fixture(true, true), { childId } = await f.startContinuable()
    await f.childEntered.promise
    const original = f.parent.agent.steer, competing = vi.fn(function (message: any) { return original.call(f.parent.agent, message) })
    Object.defineProperty(f.parent.agent, 'steer', { value: competing, configurable: true, writable: true })
    f.childRelease.resolve()
    await vi.waitFor(() => expect(f.root.agents.get(childId) === undefined).toBe(true))
    expect(f.parent.agent.steer).toBe(competing)
    expect(competing).toHaveBeenCalledOnce()
    expect(f.insertions.find(row => row.message.source.kind === 'subagent-settled').message.source.paimindOrigins).toBeUndefined()
    for (const method of ['followup', 'inject']) expect(Object.hasOwn(f.parent.agent, method)).toBe(false)
    Reflect.deleteProperty(f.parent.agent, 'steer')
  })
  it('bounds a stalled terminal signer and still releases the original child and waiting ownership', async () => {
    const f = await fixture(true, true), { childId } = await f.startContinuable()
    await f.childEntered.promise
    const entered = Promise.withResolvers<AbortSignal>()
    f.derive.mockImplementation(async (_input, signal) => { entered.resolve(signal); await aborted(signal); throw Error('stalled signing aborted') })
    f.childRelease.resolve()
    const signal = await entered.promise
    await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined(), { timeout: 5500 })
    expect(signal.aborted).toBe(true)
    const notice = f.insertions.find(row => row.message.source.kind === 'subagent-settled').message
    expect(notice.source.paimindOrigins).toBeUndefined()
    for (const method of ['followup', 'steer', 'inject']) expect(Object.hasOwn(f.parent.agent, method)).toBe(false)
  }, 8000)
})

describe('real original one-shot creation with synthetic authority and no external model', () => {
  it('stamps the first native inbox insertion, retains native identity/lineage/result and restores the method', async () => {
    const f = await fixture(), run = await f.start()
    try {
      const result = await run.result
      expect(result.stopReason).toBe('completed')
      expect(result.output).toEqual(text('Synthetic child result, no external model'))
      expect(f.childCalls()).toBe(1); expect(f.derive).toHaveBeenCalledOnce()
      const child = run.localAgent
      expect(child.id).not.toBe(f.parent.agent.id)
      expect(child.session.header).toMatchObject({ parentSession: f.parent.agent.id, origin: 'subagent', agentPreset: 'standard' })
      expect(f.root.agents.isOwnedBy(child.id, f.parent.agent)).toBe(true)
      expect(f.derive.mock.calls[0]?.[0]).toEqual({ nativeSessionId: f.parent.agent.id, presetId: 'standard', sources: [origin('h')], targetSessionId: child.id })
      const message = child.session.events.find((event: any) => event.type === 'user/message').data
      expect(message.content).toEqual(text('核对报价'))
      expect(message.source).toEqual({ kind: 'coordinator', form: 'relay', senderSessionId: f.parent.agent.id, paimindOrigins: [origin('c')] })
      expect(f.insertions.filter(row => row.message.id === message.id)).toHaveLength(1)
      expect(f.insertions.find(row => row.message.id === message.id).message).toEqual(message)
      expect(Object.hasOwn(child, 'followup')).toBe(false)
      expect(f.checks.some(input => input.nativeSessionId === child.id && input.sources[0] === origin('c'))).toBe(true)
    } finally { await run.dispose() }
  })
  it('refuses unrecognized providers before invoking them, while preserving the original provider identity', async () => {
    const f = await fixture(), start = vi.fn(async () => { throw Error('must not start') })
    f.root.subagents.registerProvider({ name: 'other', start, capabilities: { persona: true, outputSchema: true, depthLimit: true, toolFilter: true } })
    await expect(f.root.subagents.start('other', f.request())).rejects.toThrow()
    expect(start).not.toHaveBeenCalled(); expect(f.derive).not.toHaveBeenCalled()
    expect(f.root.subagents.getProvider('original-spawn').name).toBe('original-spawn')
  })
  it.each(['deny', 'wrong-child', 'empty', 'echo', 'switch-parent', 'cancel'])('rolls unpublished child back on %s without an inbox insertion or model call', async mode => {
    const f = await fixture(false, mode === 'deny'), abort = new AbortController()
    f.derive.mockImplementation(async input => {
      if (mode === 'deny') throw Error('private signing secret')
      if (mode === 'switch-parent') f.selectedPreset.value = 'changed'
      if (mode === 'cancel') abort.abort()
      return { nativeSessionId: mode === 'wrong-child' ? 'unrelated' : input.targetSessionId,
        sources: mode === 'empty' ? [] : mode === 'echo' ? input.sources : [origin('c')] }
    })
    const before = f.insertions.length
    await expect(f.start(abort.signal)).rejects.toThrow()
    expect(f.root.agents.list().map((agent: any) => agent.id)).toEqual([f.parent.agent.id])
    expect(f.insertions).toHaveLength(before); expect(f.childCalls()).toBe(0)
    if (mode === 'deny') expect((await f.root.sessionPersistence.listSnapshots()).filter((row: any) => row.header.origin === 'subagent')).toHaveLength(0)
  })
  it('does not infer authority from an idle parent or an unguarded Session header', async () => {
    const f = await fixture(); f.parent.agent.cancel({ kind: 'user' }); await f.parent.agent.whenIdle()
    await expect(f.start()).rejects.toThrow(); expect(f.derive).not.toHaveBeenCalled()
    expect(f.childCalls()).toBe(0)
  })
  it('retains the original one-shot cancellation lifecycle after the child starts', async () => {
    const f = await fixture(true), abort = new AbortController(), run = await f.start(abort.signal)
    try {
      const signal = await f.childEntered.promise; abort.abort()
      expect((await run.result).stopReason).toBe('aborted'); expect(signal.aborted).toBe(true)
      expect(f.childCalls()).toBe(1)
    } finally { await run.dispose() }
  })
  it('cancels the actual child after its current origin check fails', async () => {
    const f = await fixture(true), run = await f.start()
    try {
      const signal = await f.childEntered.promise
      f.check.mockImplementation(async input => { if (input.nativeSessionId === run.localAgent.id) throw Error('child source revoked') })
      await vi.waitFor(() => expect(signal.aborted).toBe(true), { timeout: 5000 })
      expect((await run.result).stopReason).not.toBe('completed')
      expect(f.parent.agent.status).toBe('running')
    } finally { await run.dispose() }
  })
  it('preserves the signed first insertion in the original JSONL log and cold inspection across persistence restart', async () => {
    const f = await fixture(false, true), run = await f.start(), id = run.localAgent.id
    await run.result; await f.root.sessions.flush(run.localAgent.session)
    const stored = await f.root.sessionPersistence.readRaw(id)
    const current = await f.root.sessionPersistence.inspect(id)
    expect(stored.content).toContain('paimindOrigins')
    await run.dispose(); f.parent.agent.cancel({ kind: 'user' }); await f.root.fiber.dispose()
    const cold = new Context(); cleanups.push(() => cold.fiber.dispose())
    await cold.plugin(SessionStore); await cold.plugin(JsonlSessionPersistence, { root: f.directory, compression: 'none' })
    expect(await cold.sessionPersistence.inspect(id)).toEqual(current)
    expect((await cold.sessionPersistence.readRaw(id)).content).toBe(stored.content)
    expect(cold.sessions.list()).toHaveLength(0)
  })
  it('uses the original fork provider without substituting its creation driver or descriptor', async () => {
    const f = await fixture(), run = await f.root.subagents.start('original-fork', f.request())
    try {
      expect((await run.result).stopReason).toBe('completed')
      expect(run.localAgent.session.header.parentSession).toBe(f.parent.agent.id)
      expect(run.localAgent.session.events.find((event: any) => event.type === 'user/message').data.source.paimindOrigins).toEqual([origin('c')])
      expect(f.derive).toHaveBeenCalledOnce()
    } finally { await run.dispose() }
  })
  it('aborts an unpublished child derivation when the original owner is disposed', async () => {
    const f = await fixture(), entered = Promise.withResolvers<AbortSignal>()
    f.derive.mockImplementation(async (_input, signal) => { entered.resolve(signal); return new Promise(() => {}) })
    const pending = f.start(), rejected = expect(pending).rejects.toThrow()
    const signal = await entered.promise
    await f.root.fiber.dispose(); await rejected
    expect(signal.aborted).toBe(true); expect(f.childCalls()).toBe(0)
  })
  it('stamps a real continuable child initial message without transferring post-acceptance cancellation from its manager', async () => {
    const f = await fixture(true, true), abort = new AbortController()
    const { signal: _signal, ...request } = f.request()
    const result = await f.root.subagents.startContinuable({ provider: 'original-spawn', label: '报价核对', request, signal: abort.signal })
    const child = f.root.agents.get(result.childId), childSignal = await f.childEntered.promise
    expect(child.session.header.parentSession).toBe(f.parent.agent.id)
    expect(f.root.agents.isOwnedBy(child.id, f.parent.agent)).toBe(false) // native manager, not a guessed creation owner
    expect(child.session.events.find((event: any) => event.type === 'user/message').data).toMatchObject({ id: result.messageId,
      source: { kind: 'coordinator', senderSessionId: f.parent.agent.id, paimindOrigins: [origin('c')] } })
    abort.abort(); expect(childSignal.aborted).toBe(false)
    f.root.subagents.interrupt(child.id, { kind: 'agent', agent: f.parent.agent })
    await vi.waitFor(() => expect(childSignal.aborted).toBe(true))
    await child.whenIdle()
  })
})

describe('real native reports with synthetic authority and no external model', () => {
  async function reporting() {
    const f = await fixture(true, true), { childId } = await f.startContinuable()
    await f.childEntered.promise
    const child = f.root.agents.get(childId)
    f.derive.mockImplementation(async input => ({ nativeSessionId: input.targetSessionId, sources: [origin('r')] }))
    const report = (delivery = 'quiet', content = text('报价核对完成'), signal = new AbortController().signal) =>
      f.root.subagents.reportFrom(child, content, { delivery, signal })
    return { ...f, child, report }
  }
  it.each(['quiet', 'next-step'])('preserves the original %s frame, message id and queue, restoring the synchronous parent slot', async delivery => {
    const f = await reporting(), id = await f.report(delivery)
    const inserted = f.insertions.find(row => row.message.id === id)
    expect(inserted.agentId).toBe(f.parent.agent.id)
    expect(inserted.message.content).toEqual([{ type: 'text', text: `Background subagent ${f.child.id} reported:` }, ...text('报价核对完成')])
    expect(inserted.message.source).toEqual({ kind: 'subagent-report', form: 'relay', senderSessionId: f.child.id, paimindOrigins: [origin('r')] })
    expect(f.parent.agent.inbox.nextStep.map((message: any) => message.id)).toContain(id)
    expect(f.parent.agent.inbox.nextTurn).toHaveLength(0)
    expect(Object.hasOwn(f.parent.agent, delivery === 'quiet' ? 'inject' : 'steer')).toBe(false)
    expect(f.derive.mock.calls.at(-1)?.[0]).toEqual({ nativeSessionId: f.child.id, presetId: 'standard', sources: [origin('c')], targetSessionId: f.parent.agent.id })
  })
  it('keeps quiet delivery quiet for an idle parent without borrowing its ended login turn', async () => {
    const f = await reporting(), caller = new AbortController()
    f.parent.agent.cancel({ kind: 'user' }); await f.parent.agent.whenIdle()
    const id = await f.report('quiet', text('安静回报'), caller.signal)
    caller.abort(); await Promise.resolve()
    expect(f.parent.agent.status).toBe('idle'); expect(f.parentFlow.calls).toBe(1)
    expect(f.parent.agent.inbox.nextStep.map((message: any) => message.id)).toContain(id)
    expect((await f.childEntered.promise).aborted).toBe(false)
  })
  it('wakes an idle parent from the reporting child source alone through the actual native pre-step guard', async () => {
    const f = await reporting(); f.parentFlow.holdAfterFirst = true
    f.parent.agent.cancel({ kind: 'user' }); await f.parent.agent.whenIdle()
    const caller = new AbortController(), id = await f.report('next-step', text('恢复父任务'), caller.signal)
    const signal = await f.parentFollowupEntered.promise
    expect(f.checks.some(row => row.nativeSessionId === f.parent.agent.id && row.sources.length === 1 && row.sources[0] === origin('r'))).toBe(true)
    expect(f.parent.agent.session.events.find((event: any) => event.type === 'user/message' && event.data.id === id).data.source.kind).toBe('subagent-report')
    caller.abort(); expect(signal.aborted).toBe(false)
  })
  it.each(['cancel', 'deny', 'parent-preset', 'child-ended'])('rejects %s before report admission and does not leave a parent projection', async mode => {
    const f = await reporting(), entered = Promise.withResolvers<void>(), answer = Promise.withResolvers<any>(), caller = new AbortController()
    f.derive.mockImplementationOnce(async () => { entered.resolve(); return answer.promise })
    const pending = f.report('next-step', text('本次不应入队'), caller.signal), rejected = expect(pending).rejects.toThrow()
    await entered.promise
    if (mode === 'cancel') caller.abort()
    if (mode === 'parent-preset') f.selectedPreset.value = 'other-preset'
    if (mode === 'child-ended') { f.childRelease.resolve(); await f.child.whenIdle() }
    if (mode === 'deny') answer.reject(Error('private authority error'))
    else answer.resolve({ nativeSessionId: f.parent.agent.id, sources: [origin('r')] })
    await rejected
    expect(f.insertions.filter(row => row.message.source.kind === 'subagent-report')).toHaveLength(0)
    expect(Object.hasOwn(f.parent.agent, 'steer')).toBe(false)
  })
  it('retains the original rejection of a one-shot child as a continuable reporter', async () => {
    const f = await fixture(true, true), run = await f.start(); await f.childEntered.promise
    f.derive.mockImplementation(async input => ({ nativeSessionId: input.targetSessionId, sources: [origin('r')] }))
    try {
      await expect(f.root.subagents.reportFrom(run.localAgent, text('不合法回报'), { delivery: 'quiet', signal: new AbortController().signal })).rejects.toThrow(/not a live continuable/)
      expect(f.insertions.filter(row => row.message.source.kind === 'subagent-report')).toHaveLength(0)
      expect(Object.hasOwn(f.parent.agent, 'inject')).toBe(false)
    } finally { await run.dispose() }
  })
  it('does not overwrite a competing parent mutation owner', async () => {
    const f = await reporting(), own = vi.fn()
    Object.defineProperty(f.parent.agent, 'inject', { value: own, configurable: true })
    try {
      await expect(f.report()).rejects.toThrow(); expect(f.parent.agent.inject).toBe(own); expect(own).not.toHaveBeenCalled()
    } finally { Reflect.deleteProperty(f.parent.agent, 'inject') }
  })
  it('freezes the original report scheduling choice across asynchronous signing', async () => {
    const f = await reporting(), answer = Promise.withResolvers<any>(), entered = Promise.withResolvers<void>()
    f.parent.agent.cancel({ kind: 'user' }); await f.parent.agent.whenIdle()
    f.derive.mockImplementationOnce(async () => { entered.resolve(); return answer.promise })
    const options = { delivery: 'quiet', signal: new AbortController().signal }
    const pending = f.root.subagents.reportFrom(f.child, text('不应被改为唤醒'), options)
    await entered.promise; options.delivery = 'next-step'
    answer.resolve({ nativeSessionId: f.parent.agent.id, sources: [origin('r')] }); await pending
    expect(f.parent.agent.status).toBe('idle'); expect(f.parentFlow.calls).toBe(1)
    expect(Object.hasOwn(f.parent.agent, 'inject')).toBe(false); expect(Object.hasOwn(f.parent.agent, 'steer')).toBe(false)
  })
  it('separates concurrently derived reports even when authority completes in reverse order', async () => {
    const f = await reporting(), first = Promise.withResolvers<any>(), second = Promise.withResolvers<any>()
    f.derive.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    const one = f.report('quiet', text('第一份报告')), two = f.report('quiet', text('第二份报告'))
    second.resolve({ nativeSessionId: f.parent.agent.id, sources: [origin('s')] }); const idTwo = await two
    first.resolve({ nativeSessionId: f.parent.agent.id, sources: [origin('r')] }); const idOne = await one
    const reports = f.insertions.filter(row => [idOne, idTwo].includes(row.message.id)).map(row => row.message)
    expect(reports.map(row => [row.id, row.content[1].text, row.source.paimindOrigins])).toEqual([
      [idTwo, '第二份报告', [origin('s')]], [idOne, '第一份报告', [origin('r')]],
    ])
  })
  it('does not let the parent original valid login conceal revocation of an accepted child report', async () => {
    const f = await reporting(), id = await f.report('next-step')
    f.check.mockImplementation(async input => { if (input.sources.includes(origin('r'))) throw Error('report login revoked') })
    f.parentRelease.resolve(); await f.parent.agent.whenIdle()
    expect(f.parentFlow.calls).toBe(1)
    expect(f.check.mock.calls.some(([input]) => input.nativeSessionId === f.parent.agent.id && input.sources.includes(origin('r')))).toBe(true)
    expect(f.insertions.filter(row => row.message.id === id)).toHaveLength(1)
    expect(f.parent.agent.session.events.findLast((event: any) => event.type === 'turn/end').data.reason.kind).not.toBe('completed')
  })
  it('uses real cold child history while an admitted parent report step remains active, preserving original report bytes', async () => {
    const f = await reporting(); f.parentFlow.holdAfterFirst = true
    const id = await f.report('next-step'); f.parentRelease.resolve()
    const signal = await f.parentFollowupEntered.promise
    await f.root.sessions.flush(f.parent.agent.session)
    expect((await f.root.sessionPersistence.readRaw(f.parent.agent.id)).content).toContain(id)
    expect(f.parent.agent.session.events.find((event: any) => event.type === 'user/message' && event.data.id === id).data.source.paimindOrigins).toEqual([origin('r')])
    const inspect = vi.spyOn(f.root.sessionPersistence, 'inspect')
    try {
      f.childRelease.resolve(); await vi.waitFor(() => expect(f.root.agents.get(f.child.id)).toBeUndefined())
      const stored = await f.root.sessionPersistence.readRaw(f.child.id)
      await vi.waitFor(() => expect(inspect.mock.calls.some(([childId]) => childId === f.child.id)).toBe(true), { timeout: 3500 })
      expect(signal.aborted).toBe(false); expect(f.parent.agent.status).toBe('running')
      expect((await f.root.sessionPersistence.readRaw(f.child.id)).content).toBe(stored.content)
    } finally { inspect.mockRestore() }
  })
})

describe('real native continuable delivery with synthetic authority and no external model', () => {
  it('keeps concurrent deliveries and original FIFO message identities distinct, including reversed signing completion', async () => {
    const f = await fixture(true, true), { childId } = await f.startContinuable()
    await f.childEntered.promise
    const first = Promise.withResolvers<any>(), second = Promise.withResolvers<any>()
    f.derive.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    const one = f.followup(childId, '核对第一份报价'), two = f.followup(childId, '核对第二份报价')
    await vi.waitFor(() => expect(f.derive).toHaveBeenCalledTimes(3))
    second.resolve({ nativeSessionId: childId, sources: [origin('e')] }); const idTwo = await two
    first.resolve({ nativeSessionId: childId, sources: [origin('d')] }); const idOne = await one
    const messages = f.insertions.filter(row => [idOne, idTwo].includes(row.message.id)).map(row => row.message)
    expect(idOne).not.toBe(idTwo)
    expect(messages.map(message => message.id)).toEqual([idTwo, idOne])
    expect(messages.map(message => [message.content[0].text, message.source.paimindOrigins])).toEqual([
      ['核对第二份报价', [origin('e')]], ['核对第一份报价', [origin('d')]],
    ])
    expect(messages.every(message => message.source.senderSessionId === f.parent.agent.id)).toBe(true)
    expect(f.childCalls()).toBe(1) // accepted queue work is not a model reply
  })
  it('preserves direct user identity and post-acceptance ownership even when the live parent has no active turn', async () => {
    const f = await fixture(true, true), { childId } = await f.startContinuable(), signal = await f.childEntered.promise
    f.parent.agent.cancel({ kind: 'user' }); await f.parent.agent.whenIdle(); f.derive.mockClear()
    const caller = new AbortController(), source = { kind: 'user', rpcId: origin('u') }
    const id = await f.root.subagents.followup(f.parent.agent, childId, text('用户直接追问'), { source, signal: caller.signal })
    expect(f.insertions.find(row => row.message.id === id).message.source).toEqual(source)
    expect(f.derive).not.toHaveBeenCalled()
    caller.abort(); expect(signal.aborted).toBe(false)
  })
  it.each(['caller-cancel', 'parent-ended', 'preset-changed', 'deny'])('rejects %s during derivation before accepting any follow-up', async mode => {
    const f = await fixture(true, true), { childId } = await f.startContinuable()
    await f.childEntered.promise
    const entered = Promise.withResolvers<void>(), answer = Promise.withResolvers<any>(), caller = new AbortController()
    f.derive.mockImplementationOnce(async () => { entered.resolve(); return answer.promise })
    const before = f.insertions.length, pending = f.followup(childId, '不能借过期权限', caller.signal), rejected = expect(pending).rejects.toThrow()
    await entered.promise
    if (mode === 'caller-cancel') caller.abort()
    if (mode === 'parent-ended') { f.parent.agent.cancel({ kind: 'user' }); await f.parent.agent.whenIdle() }
    if (mode === 'preset-changed') f.selectedPreset.value = 'changed'
    if (mode === 'deny') answer.reject(Error('private denial detail'))
    else answer.resolve({ nativeSessionId: childId, sources: [origin('d')] })
    await rejected
    expect(f.insertions).toHaveLength(before); expect(f.childCalls()).toBe(1)
  })
  it('retains the original direct-parent rejection for a different live member Session', async () => {
    const f = await fixture(true, true), { childId } = await f.startContinuable()
    const alex = await f.root.agents.create({ sessionId: 'alex-parent', meta: { agentPreset: 'standard' },
      agentOptions: { provider: 'parent-local-only', model: 'synthetic' } })
    alex.agent.followup(createUserMessage({ source: { kind: 'user', rpcId: origin('a') }, content: text('Alex独立任务') }))
    await vi.waitFor(() => expect(alex.agent.session.events.some((event: any) => event.type === 'step/start')).toBe(true))
    const before = f.insertions.length
    await expect(f.root.subagents.followup(alex.agent, childId, text('越权追问'), {
      source: { kind: 'coordinator', form: 'relay', senderSessionId: alex.agent.id }, signal: new AbortController().signal,
    })).rejects.toThrow(/another parent/)
    expect(f.insertions).toHaveLength(before)
  })
  it.each([
    { kind: 'coordinator', form: 'relay', senderSessionId: 'alex-parent' },
    { kind: 'coordinator', form: 'notice', senderSessionId: 'hansen-parent' },
    { kind: 'coordinator', form: 'relay', senderSessionId: 'hansen-parent', paimindOrigins: [origin('a')] },
    { kind: 'plugin', plugin: 'untrusted' },
  ])('does not accept a self-asserted coordinator or background identity: %j', async source => {
    const f = await fixture(true, true), { childId } = await f.startContinuable()
    f.derive.mockClear(); const before = f.insertions.length
    await expect(f.root.subagents.followup(f.parent.agent, childId, text('不能自报来源'), { source, signal: new AbortController().signal })).rejects.toThrow()
    expect(f.derive).not.toHaveBeenCalled(); expect(f.insertions).toHaveLength(before)
  })
  it('cold-resumes through the original manager with the same durable id, history and freshly derived source', async () => {
    const f = await fixture(false, true), { childId } = await f.startContinuable()
    await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined())
    const before = await f.root.sessionPersistence.readRaw(childId)
    f.derive.mockResolvedValueOnce({ nativeSessionId: childId, sources: [origin('d')] })
    const id = await f.followup(childId, '从原历史继续')
    await vi.waitFor(() => expect(f.childCalls()).toBe(2))
    await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined())
    const after = await f.root.sessionPersistence.readRaw(childId)
    expect(after.content.startsWith(before.content)).toBe(true)
    const events = (await f.root.sessionPersistence.inspect(childId)).events
    expect(events.find((event: any) => event.type === 'user/message' && event.data.id === id).data).toMatchObject({
      content: text('从原历史继续'), source: { kind: 'coordinator', senderSessionId: f.parent.agent.id, paimindOrigins: [origin('d')] },
    })
    expect(f.insertions.filter(row => row.message.id === id)).toHaveLength(1)
  })
  it('refuses a different actually composed cold preset without publishing a replacement or changing stored history', async () => {
    const f = await fixture(false, true), { childId } = await f.startContinuable()
    await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined())
    const before = await f.root.sessionPersistence.readRaw(childId), insertions = f.insertions.length
    f.selectedPreset.childValue = 'different-preset'
    await expect(f.followup(childId)).rejects.toThrow()
    expect(f.root.agents.get(childId)).toBeUndefined(); expect(f.childCalls()).toBe(1)
    expect(f.insertions).toHaveLength(insertions)
    expect((await f.root.sessionPersistence.readRaw(childId)).content).toBe(before.content)
  })
  it('rechecks the actual resident preset at the synchronous inbox boundary', async () => {
    const f = await fixture(true, true), { childId } = await f.startContinuable()
    await f.childEntered.promise; const before = f.insertions.length
    f.selectedPreset.childValue = 'different-preset'
    await expect(f.followup(childId)).rejects.toThrow()
    expect(f.insertions).toHaveLength(before); expect(f.childCalls()).toBe(1)
  })
  it('keeps cold materialization cancellation in the native transaction without changing stored history', async () => {
    const f = await fixture(false, true), { childId } = await f.startContinuable()
    await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined())
    const before = await f.root.sessionPersistence.readRaw(childId), caller = new AbortController(), inserted = f.insertions.length
    const remove = f.root.subagents.registerContinuableSetup(() => { caller.abort(); return () => {} })
    try { await expect(f.followup(childId, '已取消的恢复', caller.signal)).rejects.toThrow() } finally { remove() }
    expect(f.root.agents.get(childId)).toBeUndefined(); expect(f.childCalls()).toBe(1)
    expect(f.insertions).toHaveLength(inserted)
    expect((await f.root.sessionPersistence.readRaw(childId)).content).toBe(before.content)
  })
  it.each(['one-shot', 'continuable'])('does not carry a completed delivery context into a new %s delegation executed by the cold-resumed child', async mode => {
    const f = await fixture(false, true), { childId } = await f.startContinuable(), nested = Promise.withResolvers<any>()
    await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined())
    f.childHook.visit = async call => {
      if (call !== 2) return
      try {
        const { signal, ...request } = { ...f.request(), parent: f.root.agents.get(childId), prompt: text('真实孙任务') }
        if (mode === 'one-shot') {
          const run = await f.root.subagents.start('original-spawn', { ...request, signal })
          try { nested.resolve({ id: run.localAgent.id, result: await run.result,
            parent: run.localAgent.session.header.parentSession }) } finally { await run.dispose() }
        } else {
          const start = await f.root.subagents.startContinuable({ provider: 'original-spawn', label: '持续孙任务', request, signal })
          const grandchild = f.root.agents.get(start.childId)
          await vi.waitFor(() => expect(grandchild.session.events.some((event: any) => event.type === 'turn/end')).toBe(true))
          nested.resolve({ id: grandchild.id, parent: grandchild.session.header.parentSession,
            result: { stopReason: grandchild.session.events.findLast((event: any) => event.type === 'turn/end').data.reason.kind } })
        }
      } catch (error) { nested.reject(error); throw error }
    }
    f.derive.mockResolvedValueOnce({ nativeSessionId: childId, sources: [origin('d')] })
    await f.followup(childId)
    expect(await nested.promise).toMatchObject({ parent: childId, result: { stopReason: 'completed' } })
    expect(f.childCalls()).toBe(3)
    await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined())
  })
  it('revokes an accepted follow-up at actual execution while keeping acceptance distinct from a successful reply', async () => {
    const f = await fixture(true, true), { childId } = await f.startContinuable()
    await f.childEntered.promise
    f.derive.mockResolvedValueOnce({ nativeSessionId: childId, sources: [origin('d')] })
    const id = await f.followup(childId)
    f.check.mockImplementation(async input => { if (input.sources.includes(origin('d'))) throw Error('follow-up login revoked') })
    f.childRelease.resolve()
    await vi.waitFor(() => expect(f.root.agents.get(childId)).toBeUndefined())
    expect(f.check.mock.calls.some(([input]) => input.nativeSessionId === childId && input.sources.includes(origin('d')))).toBe(true)
    expect(f.childCalls()).toBe(1)
    expect(f.insertions.filter(row => row.message.id === id)).toHaveLength(1)
  })
  it('disposes only its own continuation hook and denies a retained service during pending signing', async () => {
    const f = await fixture(true, true), { childId } = await f.startContinuable(), child = f.root.agents.get(childId)
    const service = f.root.subagents, entered = Promise.withResolvers<AbortSignal>()
    f.derive.mockImplementationOnce(async (_input, signal) => { entered.resolve(signal); return new Promise(() => {}) })
    const pending = f.followup(childId), rejected = expect(pending).rejects.toThrow(), signal = await entered.promise
    await f.root.fiber.dispose(); await rejected
    expect(signal.aborted).toBe(true); expect(Object.hasOwn(child, 'followup')).toBe(false)
    await expect(service.followup(f.parent.agent, childId, text('stale'), { source: { kind: 'user', rpcId: origin('u') }, signal: new AbortController().signal })).rejects.toThrow()
  })
})
