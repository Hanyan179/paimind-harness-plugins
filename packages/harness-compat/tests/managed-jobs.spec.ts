// @vitest-environment node
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManagedHarnessJobsProvider } from '../src/managed-jobs.js'
import { installManagedHarnessOriginGuard } from '../src/managed-origins.js'

const local = createRequire(import.meta.url), native = createRequire(local.resolve('@deepseek-ai/dsh/package.json'))
const web = createRequire(native.resolve('@deepseek-ai/dsh-web-app/package.json'))
const { Context, symbols } = web('@deepseek-ai/cordis'), { AgentLoop } = web('@deepseek-ai/dsh-agent-loop')
const { AgentRegistry } = web('@deepseek-ai/dsh-agent'), { SessionStore } = web('@deepseek-ai/dsh-session')
const { SystemPrompt } = web('@deepseek-ai/dsh-system-prompt'), { ToolRuntime } = web('@deepseek-ai/dsh-tools')
const { LlmRuntime, LlmAdapter, createUserMessage } = web('@deepseek-ai/dsh-llm')
const { LocalJobRegistry } = native('@deepseek-ai/dsh-jobs-local')
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const origin = (letter: string) => `paimind-origin-v1.c291cmNl.${letter.repeat(43)}`
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
async function fixture(managed = true, initialRequirements: readonly string[] = []) {
  const root = new Context(), revoked = new Set<string>(), pending: any[] = []
  const revokedRequirements = new Set<string>(), selection = new Map([['hansen', initialRequirements]])
  const entered = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
  const release = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
  const check = vi.fn(async (input: any, _signal: AbortSignal) => {
    if (input.sources.some((source: string) => revoked.has(source))) throw Error('revoked fixture principal')
    const requirements = [...new Set([...(input.requirements ?? []),
      ...(input.skillSelection === 'captured' ? [] : selection.get(input.nativeSessionId) ?? [])])]
    if (requirements.some((id: string) => revokedRequirements.has(id))) throw Error('revoked used requirement')
    return requirements
  }), exit = vi.fn()
  installManagedHarnessOriginGuard(root, check)
  const adapter = createManagedHarnessJobsProvider(root, LocalJobRegistry, check, exit)
  cleanups.push(async () => {
    for (const row of pending) row.done.resolve({ status: 'killed' })
    for (const agent of root.get('agents')?.list() ?? []) agent.cancel({ kind: 'user' })
    await root.fiber.dispose()
  })
  for (const [plugin, config] of [[SessionStore], [AgentRegistry], [SystemPrompt, {}], [LlmRuntime], [ToolRuntime, {}]]) {
    await root.plugin(plugin, config)
  }
  const jobPlugin = await root.plugin(managed ? adapter.Provider : LocalJobRegistry, { maxConcurrentJobsPerOwner: 2 })
  const detachController = root.jobs.attachController('original-controller-fixture')
  root.llm.registerAdapter(['local-only'], new class extends LlmAdapter {
    async *stream(request: { signal: AbortSignal; sessionId?: string }) {
      // Each Agent uses a distinct model name; fixtures never call a provider.
      const key = (request as any).model
      entered.get(key)!.resolve()
      await Promise.race([release.get(key)!.promise, new Promise<void>(resolve => {
        if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', () => resolve(), { once: true })
      })])
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }())
  await root.plugin(AgentLoop, { agents: [] })
  const member = async (name: string, letter: string) => {
    entered.set(name, Promise.withResolvers()); release.set(name, Promise.withResolvers())
    const handle = await root.agents.create({ sessionId: name, meta: { agentPreset: 'standard' },
      agentOptions: { provider: 'local-only', model: name } })
    handle.agent.followup(createUserMessage({ source: { kind: 'user', rpcId: origin(letter) },
      content: [{ type: 'text', text: 'Start an owned native task' }] }))
    await entered.get(name)!.promise
    return { handle, agent: handle.agent, origin: origin(letter), async finishTurn() {
      release.get(name)!.resolve(); await handle.agent.whenIdle()
    } }
  }
  const hansen = await member('hansen', 'h'), alex = await member('alex', 'a')
  vi.useFakeTimers({ shouldClearNativeTimers: true })
  const start = (owner = hansen.agent, extra = {}) => {
    const done = Promise.withResolvers<any>()
    const cancel = vi.fn(() => done.resolve({ status: 'killed' }))
    const hooks = { done: done.promise, cancel }, run = vi.fn(() => hooks)
    pending.push({ done })
    const id = root.jobs.start({ kind: 'bash', label: owner.id + ' task', owner, run, ...extra })
    return { id, done, cancel, run, hooks }
  }
  return { root, check, exit, revoked, revokedRequirements, selection, adapter, jobPlugin, detachController, hansen, alex, start }
}
describe('native job lifetime authority with original jobs and local-only model fixtures', () => {
  it('does not attach later parent choices to an independent job, but still revokes its captured dependency', async () => {
    const f = await fixture(true, ['initial-skill']), hansen = f.start(), alex = f.start(f.alex.agent)
    await f.hansen.finishTurn(); await f.alex.finishTurn(); await flush()
    f.selection.set('hansen', ['later-unrelated-skill']); f.revokedRequirements.add('later-unrelated-skill')
    await vi.advanceTimersByTimeAsync(1100)
    expect(hansen.cancel).not.toHaveBeenCalled(); expect(alex.cancel).not.toHaveBeenCalled()
    expect(f.check.mock.calls.filter(([input]) => input.nativeSessionId === 'hansen').at(-1)?.[0])
      .toMatchObject({ requirements: ['initial-skill'], skillSelection: 'captured' })
    f.revokedRequirements.add('initial-skill')
    await vi.advanceTimersByTimeAsync(1100)
    expect(hansen.cancel).toHaveBeenCalledOnce(); expect(alex.cancel).not.toHaveBeenCalled()
    expect(f.exit).not.toHaveBeenCalled()
  })
  it('retains initiating Skill requirements after the parent finishes and deselects, without cancelling Alex', async () => {
    const f = await fixture(true, ['fixed-skill']), hansen = f.start(), alex = f.start(f.alex.agent)
    await f.hansen.finishTurn(); await f.alex.finishTurn(); await flush()
    f.selection.clear(); f.revokedRequirements.add('fixed-skill')
    await vi.advanceTimersByTimeAsync(1100)
    expect(hansen.cancel).toHaveBeenCalledOnce(); expect(alex.cancel).not.toHaveBeenCalled()
    expect(f.check.mock.calls.filter(([input]) => input.nativeSessionId === 'hansen').at(-1)?.[0].requirements).toEqual(['fixed-skill'])
    expect(f.exit).not.toHaveBeenCalled()
  })
  it('reproduces the old idle-owner revocation gap with the unadapted native provider', async () => {
    const f = await fixture(false), task = f.start()
    await f.hansen.finishTurn(); f.revoked.add(f.hansen.origin)
    await vi.advanceTimersByTimeAsync(5500)
    expect(task.cancel).not.toHaveBeenCalled()
    expect(f.root.jobs.get(task.id, f.hansen.agent).status).toBe('running')
  })
  it('rechecks the initiating principal after its turn ends and cancels only that members task', async () => {
    const f = await fixture(), hansenTask = f.start(), alexTask = f.start(f.alex.agent)
    await f.hansen.finishTurn(); await f.alex.finishTurn(); await flush()
    const oldCount = f.check.mock.calls.length
    f.revoked.add(f.hansen.origin)
    await vi.advanceTimersByTimeAsync(1100)
    expect(hansenTask.cancel).toHaveBeenCalledOnce(); expect(alexTask.cancel).not.toHaveBeenCalled()
    expect(f.root.jobs.get(hansenTask.id, f.hansen.agent)).toMatchObject({ status: 'killed', reported: true, ownerSession: 'hansen' })
    expect(f.root.jobs.get(alexTask.id, f.alex.agent).status).toBe('running')
    expect(f.check.mock.calls.slice(oldCount).map(([input]) => input.sources)).toContainEqual([f.hansen.origin])
    expect(f.exit).not.toHaveBeenCalled()
  })
  it('preserves native output, predictably allocated ids, owner fencing and first-wins settlement', async () => {
    const f = await fixture(), h = f.start(), a = f.start(f.alex.agent), listener = vi.fn()
    f.root.jobs.onJobDone(listener)
    expect([h.id, a.id]).toEqual(['bash-1', 'bash-2'])
    expect(f.root.jobs.list(f.alex.agent).map((row: any) => row.id)).toEqual([a.id])
    for (const operation of ['get', 'read', 'kill']) expect(() => f.root.jobs[operation](h.id, f.alex.agent)).toThrow()
    await expect(f.root.jobs.wait(h.id, 1, f.alex.agent)).rejects.toThrow()
    h.done.resolve({ status: 'completed', output: 'Hansen only' }); await flush()
    expect(f.root.jobs.read(h.id, f.hansen.agent).text).toBe('Hansen only')
    expect(f.root.jobs.read(h.id, f.hansen.agent).text).toBe('Hansen only')
    expect(listener).toHaveBeenCalledOnce(); expect(h.cancel).not.toHaveBeenCalled()
    expect(listener.mock.calls[0]![1]).toBe(f.hansen.agent)
  })
  it('retains native preflight with zero producer starts for absent controllers and owner capacity', async () => {
    const f = await fixture(), run = vi.fn()
    f.start(); f.start()
    expect(() => f.start(f.hansen.agent, { run })).toThrow('limit')
    f.detachController()
    expect(() => f.start(f.alex.agent, { run })).toThrow('controller')
    expect(run).not.toHaveBeenCalled()
  })
  it('rejects unowned, foreign and idle starts without consuming an id or running a producer', async () => {
    const f = await fixture(), run = vi.fn()
    expect(() => f.start(f.hansen.agent, { owner: undefined, run })).toThrow()
    expect(() => f.start(f.hansen.agent, { owner: { ...f.alex.agent, id: 'hansen' }, run })).toThrow()
    await f.hansen.finishTurn()
    expect(() => f.start(f.hansen.agent, { run })).toThrow()
    expect(run).not.toHaveBeenCalled()
    expect(f.start(f.alex.agent).id).toBe('bash-1')
  })
  it('does not cancel an accepted job merely because its creating turn or controller ends', async () => {
    const f = await fixture(), task = f.start()
    await f.hansen.finishTurn(); f.detachController(); await flush()
    await vi.advanceTimersByTimeAsync(6500)
    expect(task.cancel).not.toHaveBeenCalled(); expect(f.exit).not.toHaveBeenCalled()
    expect(f.root.jobs.get(task.id, f.hansen.agent).status).toBe('running')
    task.done.resolve({ status: 'completed' }); await flush()
    const checks = f.check.mock.calls.filter(([input]) => input.nativeSessionId === 'hansen').length
    await vi.advanceTimersByTimeAsync(6500)
    expect(f.check.mock.calls.filter(([input]) => input.nativeSessionId === 'hansen')).toHaveLength(checks)
  })
  it('aborts a stalled check on completion without allowing its late failure to cancel another job', async () => {
    const f = await fixture(), entered = Promise.withResolvers<AbortSignal>(), response = Promise.withResolvers<void>()
    f.check.mockImplementationOnce(async (_input, signal) => { entered.resolve(signal); return response.promise })
    const task = f.start(), signal = await entered.promise
    task.done.resolve({ status: 'completed' }); await flush()
    expect(signal.aborted).toBe(true)
    const other = f.start(f.alex.agent)
    response.reject(Error('late check')); await flush()
    expect(task.cancel).not.toHaveBeenCalled(); expect(other.cancel).not.toHaveBeenCalled()
  })
  it('expires a stalled check and does not renew freshness from a late successful reply', async () => {
    const f = await fixture(), task = f.start()
    await f.hansen.finishTurn(); await f.alex.finishTurn(); await flush()
    f.check.mockImplementation(async () => new Promise(resolve => setTimeout(resolve, 3900)))
    await vi.advanceTimersByTimeAsync(5000)
    // First late success began at +1000, hence expires at +6000. The next
    // still-pending check must not carry it to +9900.
    await vi.advanceTimersByTimeAsync(1100)
    expect(task.cancel).toHaveBeenCalledOnce(); expect(f.exit).not.toHaveBeenCalled()
  })
  it('cancels a first authorization renewal which never returns and aborts that exact request', async () => {
    const f = await fixture(), entered = Promise.withResolvers<AbortSignal>()
    f.check.mockImplementationOnce(async (_input, signal) => { entered.resolve(signal); return new Promise(() => {}) })
    const task = f.start(), signal = await entered.promise
    await f.hansen.finishTurn(); await f.alex.finishTurn()
    await vi.advanceTimersByTimeAsync(4001)
    expect(signal.aborted).toBe(true); expect(task.cancel).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(5000)
    expect(task.cancel).toHaveBeenCalledOnce(); expect(f.exit).not.toHaveBeenCalled()
  })
  it('keeps the original streaming producer receiver and consuming cursor', async () => {
    const f = await fixture(), done = Promise.withResolvers<any>()
    const hooks = { remaining: 'original stream', done: done.promise, cancel: () => done.resolve({ status: 'killed' }),
      readOutput() { const text = this.remaining; this.remaining = ''; return text } }
    const task = f.start(f.hansen.agent, { run: () => hooks })
    expect(f.root.jobs.read(task.id, f.hansen.agent).text).toBe('original stream')
    expect(f.root.jobs.read(task.id, f.hansen.agent).text).toBe('')
    done.resolve({ status: 'completed' }); await flush()
    expect(f.root.jobs.get(task.id, f.hansen.agent).status).toBe('completed')
  })
  it('cancels when the original mounted preset changes while the job remains alive', async () => {
    const f = await fixture(), task = f.start()
    await f.hansen.finishTurn(); await flush()
    f.root.provide('agentPresets', { composedPreset: () => 'different-preset' })
    await vi.advanceTimersByTimeAsync(1100)
    expect(task.cancel).toHaveBeenCalledOnce()
  })
  it('withdraws exactly the original service and rejects stale references after native reload', async () => {
    const f = await fixture(), old = f.root.jobs, task = f.start()
    const agents = f.root.agents[symbols.original], sessions = f.root.sessions[symbols.original]
    await f.jobPlugin.dispose(); await flush()
    expect(task.cancel).toHaveBeenCalledOnce(); expect(f.adapter.owns(old)).toBe(false)
    expect(() => old.start({ owner: f.alex.agent, kind: 'bash', label: 'stale', run: vi.fn() })).toThrow()
    await f.root.plugin(f.adapter.Provider, { maxConcurrentJobsPerOwner: 2 })
    f.root.jobs.attachController('new-controller')
    expect(f.adapter.owns(f.root.jobs)).toBe(true); expect(f.start(f.alex.agent).id).toBe('bash-1')
    expect(f.root.agents[symbols.original]).toBe(agents); expect(f.root.sessions[symbols.original]).toBe(sessions)
  })
  it('requests the owned cell shutdown if the original producer violates cancellation contract', async () => {
    const f = await fixture(), task = f.start()
    task.cancel.mockImplementation(() => { throw Error('private producer failure') })
    await f.hansen.finishTurn(); await flush(); f.revoked.add(f.hansen.origin)
    await vi.advanceTimersByTimeAsync(1100)
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(1)
    // This is an exit request, not proof that an uncooperative body stopped.
    expect(f.root.jobs.get(task.id, f.hansen.agent).status).toBe('running')
  })
})
