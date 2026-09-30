// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManagedHarnessJobsProvider } from '../src/managed-jobs.js'
import { installManagedHarnessOriginGuard } from '../src/managed-origins.js'
import { createManagedHarnessDelegationProviders } from '../src/managed-delegation.js'

const local = createRequire(import.meta.url), native = createRequire(local.resolve('@deepseek-ai/dsh/package.json'))
const web = createRequire(native.resolve('@deepseek-ai/dsh-web-app/package.json'))
const { Context, symbols } = web('@deepseek-ai/cordis'), { AgentLoop } = web('@deepseek-ai/dsh-agent-loop')
const { AgentRegistry } = web('@deepseek-ai/dsh-agent'), { SessionStore } = web('@deepseek-ai/dsh-session')
const { SystemPrompt } = web('@deepseek-ai/dsh-system-prompt'), { ToolRuntime } = web('@deepseek-ai/dsh-tools')
const { LlmRuntime, LlmAdapter, createUserMessage } = web('@deepseek-ai/dsh-llm')
const { LocalJobRegistry } = native('@deepseek-ai/dsh-jobs-local'), controller = native('@deepseek-ai/dsh-tool-jobs')
const { JsonlSessionPersistence } = web('@deepseek-ai/dsh-session-persistence-jsonl')
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const origin = (letter: string) => `paimind-origin-v1.e30.${letter.repeat(43)}`
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }
async function fixture(delivery: 'quiet' | 'wakeup' = 'wakeup', withChild = false) {
  const directory = await mkdtemp(join(tmpdir(), 'paimind-native-job-completion-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const root = new Context(), jobs: any[] = [], states = new Map<string, any>(), notices: any[] = []
  const revoked = new Set<string>(), sourceLinks = new Map<string, readonly string[]>()
  const check = vi.fn(async (input: any) => {
    if (input.sources.some((value: string) => (sourceLinks.get(value) ?? [value]).some(value => revoked.has(value)))) throw Error('Fixture original principal revoked')
  })
  let nonce = 0
  const seal = vi.fn(async (input: any, _signal: AbortSignal) => {
    await check(input)
    const value = 'paimind-origin-v1.' + Buffer.from(JSON.stringify({ nativeJobId: input.nativeJobId,
      nativeSessionId: input.nativeSessionId, delegatedPresetId: input.presetId, nonce: nonce++ })).toString('base64url') + '.' + 'j'.repeat(43)
    sourceLinks.set(value, input.sources)
    return { nativeSessionId: input.nativeSessionId, sources: [value] }
  }), exit = vi.fn()
  installManagedHarnessOriginGuard(root, check)
  const spawn = native('@deepseek-ai/dsh-subagent-spawn-in-process')
  const delegation = withChild ? createManagedHarnessDelegationProviders(root, async input => ({ nativeSessionId: input.targetSessionId, sources: [origin('c')] }), [spawn]) : undefined
  const managed = createManagedHarnessJobsProvider(root, LocalJobRegistry, check, exit, { controller, seal,
    ownsFollowup: (agent, method) => delegation?.ownsFollowup(agent, method) ?? false })
  cleanups.push(async () => {
    for (const job of jobs) job.done.resolve({ status: 'killed' })
    for (const agent of root.get('agents')?.list() ?? []) agent.cancel({ kind: 'user' })
    await root.fiber.dispose()
  })
  let service: any
  for (const [plugin, config] of [[SessionStore], [delegation?.Agents ?? AgentRegistry], [SystemPrompt, {}], [LlmRuntime], [ToolRuntime, {}], [managed.Provider, { maxConcurrentJobsPerOwner: 10 }]]) {
    const installed = await root.plugin(plugin, config)
    if (plugin === managed.Provider) service = installed
  }
  await root.plugin(JsonlSessionPersistence, { root: directory, compression: 'none' })
  root.llm.registerAdapter(['local-only'], new class extends LlmAdapter {
    async *stream(request: any) {
      const state = states.get(request.model); state.calls++; state.entered.resolve()
      await Promise.race([state.release.promise, new Promise<void>(resolve => {
        if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', () => resolve(), { once: true })
      })])
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Local fixture task collected' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Local fixture task collected' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }())
  await root.plugin(AgentLoop, { agents: [] })
  if (delegation) {
    root.provide('agentPresets', { composedPreset: (ctx: any) => ctx.agent?.session.header.agentPreset, composeFrom: () => {} })
    await root.plugin(delegation.Subagents)
    await root.plugin(delegation.selectProvider(spawn), { providerName: 'native-spawn' })
  }
  const originalJobs = root.jobs[symbols.original]
  const controllerPlugin = await root.plugin(managed.selectController(controller), { completionDelivery: delivery, maxConsecutiveWakes: 2 })
  root.on('agent/inbox/inserted', ({ agent, message }: any) => {
    if (message.source.plugin === 'tool-jobs') notices.push({ owner: agent, message })
  })
  const member = async (name: string, letter: string) => {
    const state = { calls: 0, entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }; states.set(name, state)
    const handle = await root.agents.create({ sessionId: name, meta: { agentPreset: 'standard', delegationDepth: 0 }, agentOptions: { provider: 'local-only', model: name } })
    handle.agent.followup(createUserMessage({ source: { kind: 'user', rpcId: origin(letter) }, content: [{ type: 'text', text: 'Start tasks' }] }))
    await state.entered.promise
    return { handle, agent: handle.agent, source: origin(letter), state, async finish() { state.release.resolve(); await handle.agent.whenIdle() } }
  }
  const hansen = await member('hansen', 'h'), alex = await member('alex', 'a')
  const start = (member: { agent: any } = hansen) => {
    const done = Promise.withResolvers<any>(), cancel = vi.fn(() => done.resolve({ status: 'killed' }))
    const id = root.jobs.start({ kind: 'bash', label: member.agent.id + ' original producer', owner: member.agent,
      run: () => ({ done: done.promise, cancel }) })
    const job = { id, done, cancel }; jobs.push(job); return job
  }
  const completed = (job: any) => { job.done.resolve({ status: 'completed', output: 'original output' }) }
  const child = async () => {
    if (!delegation) throw Error('Child fixture not selected')
    const state = { calls: 0, entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }; states.set('child', state)
    const result = await root.subagents.startContinuable({ provider: 'native-spawn', label: 'Original child', signal: new AbortController().signal,
      request: { parent: hansen.agent, prompt: [{ type: 'text', text: 'Run an original owned job' }], persona: 'Original child fixture', maxDepth: 3,
        agentOptions: { provider: 'local-only', model: 'child' } } })
    await state.entered.promise
    return { agent: root.agents.get(result.childId), state }
  }
  return { root, directory, managed, originalJobs, controllerPlugin, service, seal, check, revoked, exit, notices, hansen, alex, start, completed, child }
}
describe('original native job completion controller with explicit local-only signatures/models', () => {
  it('composes with the exact managed native child followup owner without replacing it', async () => {
    const f = await fixture('wakeup', true), child = await f.child(), originalFollowup = child.agent.followup
    expect(Object.hasOwn(child.agent, 'followup')).toBe(true)
    const job = f.start(child); f.completed(job)
    await vi.waitFor(() => expect(f.notices).toHaveLength(1))
    expect(f.notices[0].owner).toBe(child.agent)
    expect(child.agent.inbox.nextStep[0].source).toMatchObject({ nativeJobId: job.id, plugin: 'tool-jobs' })
    expect(child.agent.followup).toBe(originalFollowup); expect(Object.hasOwn(child.agent, 'inject')).toBe(false)
    expect(f.hansen.state.calls).toBe(1); expect(f.alex.state.calls).toBe(1)
  })
  it('wakes the exact idle owner with a job/preset constrained notice and original output', async () => {
    const f = await fixture(), job = f.start(); await f.hansen.finish(); f.completed(job)
    await vi.waitFor(() => expect(f.hansen.state.calls).toBe(2)); await f.hansen.agent.whenIdle()
    expect(f.notices).toHaveLength(1); expect(f.notices[0].owner).toBe(f.hansen.agent)
    expect(f.seal.mock.calls[0]?.[0]).toMatchObject({ nativeSessionId: 'hansen', nativeJobId: job.id,
      requirements: [], skillSelection: 'captured' })
    expect(f.notices[0].message.source).toMatchObject({ kind: 'plugin', plugin: 'tool-jobs', form: 'notice', nativeJobId: job.id })
    expect(f.notices[0].message.content[0].text).toContain('background job ' + job.id)
    expect(f.root.jobs.read(job.id, f.hansen.agent).text).toBe('original output')
    expect(f.alex.state.calls).toBe(1); expect(f.root.jobs[symbols.original]).toBe(f.originalJobs)
    expect(Object.hasOwn(f.hansen.agent, 'followup')).toBe(false); expect(Object.hasOwn(f.hansen.agent, 'inject')).toBe(false)
  })
  it('preserves the exact signed notice in native history across persistence service reconstruction without publishing a session', async () => {
    const f = await fixture(), job = f.start(); await f.hansen.finish(); f.completed(job)
    await vi.waitFor(() => expect(f.hansen.state.calls).toBe(2)); await f.hansen.agent.whenIdle()
    await f.root.sessions.flush(f.hansen.agent.session)
    const id = f.hansen.agent.id, stored = await f.root.sessionPersistence.readRaw(id)
    const inspected = await f.root.sessionPersistence.inspect(id)
    expect(stored.content).toContain(f.notices[0].message.source.paimindOrigins[0])
    expect(stored.content).toContain('nativeJobId')
    await f.hansen.handle.dispose(); f.alex.agent.cancel({ kind: 'user' }); await f.root.fiber.dispose()
    const cold = new Context(); cleanups.push(() => cold.fiber.dispose())
    await cold.plugin(SessionStore); await cold.plugin(JsonlSessionPersistence, { root: f.directory, compression: 'none' })
    expect(await cold.sessionPersistence.inspect(id)).toEqual(inspected)
    expect((await cold.sessionPersistence.readRaw(id)).content).toBe(stored.content)
    expect(cold.sessions.list()).toHaveLength(0)
  })
  it.each(['busy', 'quiet'])('preserves original %s next-step delivery without fabricating a human prompt', async mode => {
    const f = await fixture(mode === 'quiet' ? 'quiet' : 'wakeup'), job = f.start()
    if (mode === 'quiet') await f.hansen.finish()
    f.completed(job); await vi.waitFor(() => expect(f.notices).toHaveLength(1))
    expect(f.hansen.state.calls).toBe(1)
    expect(f.hansen.agent.inbox.nextStep.map((message: any) => message.id)).toContain(f.notices[0].message.id)
    expect(f.hansen.agent.inbox.nextTurn).toHaveLength(0)
    expect(f.notices[0].message.source.kind).toBe('plugin')
  })
  it('keeps native consecutive-wakeup accounting on the original Agent identity', async () => {
    const f = await fixture(), jobs = [f.start(), f.start(), f.start()]; await f.hansen.finish()
    for (const [index, job] of jobs.entries()) {
      f.completed(job); await vi.waitFor(() => expect(f.notices).toHaveLength(index + 1))
      await f.hansen.agent.whenIdle()
    }
    expect(f.hansen.state.calls).toBe(3) // first interactive turn + two allowed native wakes
    expect(f.hansen.agent.inbox.nextStep).toHaveLength(1)
    expect(f.root.jobs.list(f.hansen.agent).every((row: any) => row.status === 'completed')).toBe(true)
  })
  it.each(['read', 'cancel', 'controller-unload', 'service-unload', 'owner-release'])('suppresses a pending notification when original %s wins', async mode => {
    const f = await fixture(), job = f.start(), entered = Promise.withResolvers<AbortSignal>(), held = Promise.withResolvers<void>()
    const seal = f.seal.getMockImplementation()!
    f.seal.mockImplementationOnce(async (input, signal) => { entered.resolve(signal); await held.promise; return seal(input, signal) })
    await f.hansen.finish(); f.completed(job); const signal = await entered.promise
    if (mode === 'read') f.root.jobs.read(job.id, f.hansen.agent)
    else if (mode === 'cancel') f.root.jobs.kill(job.id, f.hansen.agent)
    else if (mode === 'controller-unload') await f.controllerPlugin.dispose()
    else if (mode === 'service-unload') await f.service.dispose()
    else await f.hansen.handle.dispose()
    if (mode.endsWith('unload') || mode === 'owner-release') expect(signal.aborted).toBe(true)
    held.resolve(); await flush()
    expect(f.notices).toHaveLength(0); expect(f.hansen.state.calls).toBe(1)
  })
  it('rejects revoked original authority even if another valid login exists in the same session', async () => {
    const f = await fixture(), job = f.start(), entered = Promise.withResolvers<void>(), held = Promise.withResolvers<void>()
    const seal = f.seal.getMockImplementation()!
    f.seal.mockImplementationOnce(async (input, signal) => { entered.resolve(); await held.promise; return seal(input, signal) })
    await f.hansen.finish(); f.completed(job); await entered.promise
    f.revoked.add(f.hansen.source)
    f.hansen.agent.followup(web('@deepseek-ai/dsh-llm').createUserMessage({ source: { kind: 'user', rpcId: origin('n') }, content: [{ type: 'text', text: 'New login is distinct' }] }))
    await f.hansen.agent.whenIdle(); expect(f.hansen.state.calls).toBe(2)
    held.resolve(); await flush(); expect(f.notices).toHaveLength(0)
    expect(f.root.jobs.get(job.id, f.hansen.agent).status).toBe('completed')
  })
  it('keeps unknown method ownership intact and does not partially install a second send path', async () => {
    const f = await fixture(), job = f.start(); await f.hansen.finish()
    const original = f.hansen.agent.followup, other = vi.fn()
    Object.defineProperty(f.hansen.agent, 'followup', { value: other, configurable: true, writable: true })
    f.completed(job); await vi.waitFor(() => expect(f.seal).toHaveBeenCalledOnce()); await flush()
    expect(f.hansen.agent.followup).toBe(other); expect(Object.hasOwn(f.hansen.agent, 'inject')).toBe(false)
    expect(f.notices).toHaveLength(0); expect(other).not.toHaveBeenCalled()
    Reflect.deleteProperty(f.hansen.agent, 'followup'); expect(f.hansen.agent.followup).toBe(original)
  })
  it.each(['job', 'preset', 'echo'])('refuses invalid %s provenance without moving the completed job or notifying another member', async mode => {
    const f = await fixture(), job = f.start(); await f.hansen.finish()
    const original = f.seal.getMockImplementation()!
    f.seal.mockImplementationOnce(async (input, signal) => mode === 'echo' ? { nativeSessionId: input.nativeSessionId, sources: input.sources }
      : original({ ...input, ...(mode === 'job' ? { nativeJobId: 'other-job' } : { presetId: 'other-preset' }) }, signal))
    f.completed(job); await vi.waitFor(() => expect(f.seal).toHaveBeenCalledOnce()); await flush()
    expect(f.notices).toHaveLength(0); expect(f.hansen.state.calls).toBe(1); expect(f.alex.state.calls).toBe(1)
    expect(f.root.jobs.get(job.id, f.hansen.agent).status).toBe('completed')
  })
})
