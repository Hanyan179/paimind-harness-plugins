// @vitest-environment node
import { Context } from '@deepseek-ai/cordis'
import { TOOL_RUNTIME_SCHEDULER, ToolRuntime, type ToolDefinition, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertPaimindManagedOriginGuard, definePaimindHarnessTool } from '../src/host.js'
import { installManagedHarnessOriginGuard, installManagedHarnessToolGuard } from '../src/managed-runtime.js'
import { captureManagedHarnessOrigins } from '../src/managed-origins.js'

const roots: Context[] = []
afterEach(async () => { try { for (const root of roots.splice(0)) await root.fiber.dispose() } finally { vi.useRealTimers() } })
const source = (letter = 'h') => `paimind-origin-v1.c291cmNl.${letter.repeat(43)}`
const message = (rpcId = source()) => ({ source: { kind: 'user', rpcId } })
async function fixture() {
  const root = new Context(); roots.push(root)
  const check = vi.fn(async (..._args: any[]): Promise<void | readonly string[]> => {}), body = vi.fn(async () => ({ ran: true }))
  installManagedHarnessToolGuard(root, () => undefined)
  installManagedHarnessOriginGuard(root, check)
  await root.plugin(SystemPrompt, {}); await root.plugin(ToolRuntime, {})
  root.tools.register(definePaimindHarnessTool({ name: 'read', description: 'Fixture behind original dispatcher', parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: { ran: { type: 'boolean', required: true } } }, render: () => [] }, execute: body }) as ToolDefinition)
  const events: { type: string; data: any }[] = [{ type: 'turn/start', data: { turn: 1 } }]
  const header = { agentPreset: 'hansen-personal' }
  const nativeAbort = new AbortController(), cancel = vi.fn((cause: unknown) => nativeAbort.abort(cause))
  // Explicit active-hook fixture, not a persisted/model-visible history. Real
  // surface, replacement and restore coverage uses the native Session owner.
  const agent = { id: 'agent-hansen', cancel, session: { id: 'session-hansen', header, events, surface: { nodes: [] } } } as unknown as NonNullable<ToolExecutionInput['agent']>
  const step = (messages: unknown[] = [message()], number = 1) => root.waterfall('agent/pre-step', {
    agent, turn: 1, step: number, messages, signal: nativeAbort.signal,
  } as never, () => Promise.resolve({ kind: 'enter', messages } as never))
  const tool = () => root.tools.execute({ name: 'read', agent, callId: 'origin-test' as ToolExecutionInput['callId'], arguments: {}, signal: new AbortController().signal })
  const accept = () => { events.push({ type: 'step/start', data: { turn: 1, step: 1 } }, { type: 'user/message', data: message() }) }
  const prepare = () => root.tools[TOOL_RUNTIME_SCHEDULER].prepare({ name: 'read', agent, callId: 'origin-staged' as ToolExecutionInput['callId'],
    arguments: {}, signal: new AbortController().signal })
  return { root, check, body, events, header, agent, nativeAbort, cancel, step, tool, accept, prepare }
}
describe('native step and tool origin gates with explicit event fixtures', () => {
  it.each(['success', 'missing-listener', 'failure'])('checks versioned native durability before model admission: %s', async outcome => {
    const f = await fixture(), order: string[] = []
    const flush = vi.fn(async () => { order.push('flush'); if (outcome === 'failure') throw Error('private disk failure'); return outcome === 'success' })
    f.root.provide('sessions', { flush })
    f.check.mockImplementation(async () => { order.push('authority') })
    const rpcId = 'paimind-origin-v1.' + Buffer.from(JSON.stringify({ nativeSessionId: 'session-hansen',
      clientRpcId: 'haas-turn-v1.explicit-barrier-probe' })).toString('base64url') + '.' + 'A'.repeat(43)
    if (outcome === 'success') { await f.step([message(rpcId)]); expect(order).toEqual(['flush', 'authority']) }
    else { await expect(f.step([message(rpcId)])).rejects.toThrow(); expect(order).toEqual(['flush']); expect(f.check).not.toHaveBeenCalled() }
    expect(flush).toHaveBeenCalledWith(f.agent.session)
  })

  it('publishes only a scoped installation witness, never an execution permission or a cross-root grant', async () => {
    const absent = new Context(); roots.push(absent)
    expect(() => assertPaimindManagedOriginGuard(absent)).toThrow('来源与权限守卫')
    const f = await fixture()
    expect(() => assertPaimindManagedOriginGuard(f.root)).not.toThrow()
    expect(f.check).not.toHaveBeenCalled()
    expect(() => assertPaimindManagedOriginGuard(absent)).toThrow()
    f.check.mockRejectedValue(Error('Current authority is unavailable'))
    await expect(f.step()).rejects.toThrow()
    expect(f.check).toHaveBeenCalledOnce()
    const retained = f.root.get('paimindManagedOriginGuard') as { assertReady(): void }
    await f.root.fiber.dispose()
    expect(() => retained.assertReady()).toThrow()
    expect(() => assertPaimindManagedOriginGuard(f.root)).toThrow()
  })
  it.each([undefined, {}, { schema: 'wrong', assertReady() {} },
    { schema: 'paimind.managed-origin-guard/v1', assertReady() { return true } },
    { schema: 'paimind.managed-origin-guard/v1', async assertReady() {} },
  ])('does not accept a malformed or asynchronous installation witness: %j', value => {
    expect(() => assertPaimindManagedOriginGuard({ get: () => value })).toThrow('来源与权限守卫')
  })
  it('does not publish readiness after only part of the native lifecycle was registered', async () => {
    const root = new Context(); roots.push(root)
    const on = root.on.bind(root)
    const hook = vi.spyOn(root, 'on').mockImplementation(((name: string, ...args: unknown[]) => {
      if (name === 'tools/execute') throw Error('Explicit hook installation failure')
      return (on as (...args: unknown[]) => unknown)(name, ...args)
    }) as typeof root.on)
    try {
      expect(() => installManagedHarnessOriginGuard(root, async () => {})).toThrow('Explicit hook installation failure')
      expect(() => assertPaimindManagedOriginGuard(root)).toThrow('来源与权限守卫')
    } finally { hook.mockRestore() }
  })

  it('treats exact native Skill context metadata as data, never another source or a standalone grant', async () => {
    const f = await fixture()
    const context = [{ source: { kind: 'skill-catalog', form: 'catalog', entries: [{ name: 'customer-notes', description: 'Routing summary only' }] } },
      { source: { kind: 'skill-invocation', form: 'instructions', name: 'customer-notes' } }]
    await expect(f.step(context)).rejects.toThrow(); expect(f.check).not.toHaveBeenCalled()
    await f.step([message(), ...context]); expect(f.check.mock.calls[0]?.[0].sources).toEqual([source()])
    f.check.mockRejectedValue(Error('Original signed identity revoked'))
    await expect(f.step([message(), ...context])).rejects.toThrow()
  })

  it.each([
    { kind: 'skill-invocation', form: 'request', name: 'customer-notes' },
    { kind: 'skill-invocation', form: 'instructions', name: '../foreign' },
    { kind: 'skill-invocation', form: 'instructions', name: 'customer-notes', paimindOrigins: [source('a')] },
    { kind: 'skill-catalog', form: 'catalog', entries: null },
    { kind: 'skill-catalog', form: 'catalog', entries: [], update: false },
    { kind: 'skill-catalog', form: 'catalog', entries: [], update: undefined },
    { kind: 'skill-catalog', form: 'catalog', entries: [], rpcId: source('a') },
    { kind: 'skill-catalog', form: 'notice', entries: [] },
    { kind: 'skill-catalog', form: 'catalog', entries: [{ name: 'customer-notes', description: 1 }] },
    { kind: 'skill-catalog', form: 'catalog', entries: [{ name: 'customer-notes', description: 'Summary', role: 'admin' }] },
    { kind: 'skill-catalog', form: 'catalog', entries: [{ name: 'customer-notes', description: 'One' }, { name: 'customer-notes', description: 'Duplicate' }] },
  ])('refuses malformed native Skill metadata even beside a valid login: %j', async context => {
    const f = await fixture()
    await expect(f.step([message(), { source: context }])).rejects.toThrow(); expect(f.check).not.toHaveBeenCalled()
  })
  it('accepts only a job-marked, preset-constrained source and still invokes current authorization', async () => {
    const f = await fixture(), payload = { nativeJobId: 'bash-1', nativeSessionId: 'session-hansen', delegatedPresetId: 'hansen-personal' }
    const seal = (value: object) => 'paimind-origin-v1.' + Buffer.from(JSON.stringify(value)).toString('base64url') + '.' + 's'.repeat(43)
    const source = { kind: 'plugin', plugin: 'tool-jobs', form: 'notice', summary: 'Task done', nativeJobId: 'bash-1', paimindOrigins: [seal(payload)] }
    await f.step([{ source }]); expect(f.check).toHaveBeenCalledOnce()
    for (const value of [{ ...payload, nativeJobId: 'bash-2' }, { ...payload, nativeSessionId: 'session-alex' },
      { ...payload, delegatedPresetId: 'other-preset' }, {}]) {
      await expect(f.step([{ source: { ...source, paimindOrigins: [seal(value)] } }, message()])).rejects.toThrow()
    }
    await expect(f.step([{ source: { ...source, paimindOrigins: [message().source.rpcId] } }, message()])).rejects.toThrow()
    await expect(f.step([{ source: { ...source, nativeJobId: '' } }, message()])).rejects.toThrow()
    expect(f.check).toHaveBeenCalledOnce()
    f.check.mockRejectedValue(Error('signature or current login invalid'))
    await expect(f.step([{ source }, message()])).rejects.toThrow()
  })
  it('checks native accepted messages and repeats the check at tool preparation and dispatch', async () => {
    const f = await fixture(); await f.step(); f.accept()
    expect((await f.tool()).isError).toBe(false); expect(f.body).toHaveBeenCalledOnce(); expect(f.check).toHaveBeenCalledTimes(3)
    expect(f.check.mock.calls[0]?.[0]).toEqual({ nativeSessionId: 'session-hansen', presetId: 'hansen-personal', sources: [source()] })
  })
  it('carries earlier messages in the same turn through an empty subsequent step and includes steering from another login', async () => {
    const f = await fixture(); f.accept(); await f.step([], 2)
    await f.step([message(source('a'))], 2)
    expect(f.check.mock.calls.at(-1)?.[0]).toEqual({ nativeSessionId: 'session-hansen', presetId: 'hansen-personal', sources: [source('a'), source()].sort() })
  })
  it('does not borrow old-turn or arbitrary plugin authority', async () => {
    const f = await fixture(); f.accept(); f.events.push({ type: 'turn/end', data: {} }, { type: 'turn/start', data: { turn: 2 } })
    await expect(f.step([])).rejects.toThrow()
    const g = await fixture()
    await expect(g.step([message(), { source: { kind: 'plugin', plugin: 'unrelated-job' } }])).rejects.toThrow()
    await expect(g.step([message('caller-id')])).rejects.toThrow(); expect(g.check).not.toHaveBeenCalled()
  })
  it('checks a strict coordinator projection against the original durable parent relation', async () => {
    const f = await fixture(); Object.assign(f.header, { origin: 'subagent', parentSession: 'parent-hansen' })
    const source = { kind: 'coordinator', form: 'relay', senderSessionId: 'parent-hansen', paimindOrigins: [message().source.rpcId] }
    await f.step([{ source }])
    expect(f.check.mock.calls.at(-1)?.[0]).toMatchObject({ nativeSessionId: 'session-hansen', sources: source.paimindOrigins })
  })
  it.each(['parent', 'unsigned', 'empty', 'duplicate', 'extra', 'form'])('rejects an invalid coordinator %s even beside a valid user message', async mode => {
    const f = await fixture(); Object.assign(f.header, { origin: 'subagent', parentSession: 'parent-hansen' })
    const source = { kind: 'coordinator', form: mode === 'form' ? 'notice' : 'relay',
      senderSessionId: mode === 'parent' ? 'foreign' : 'parent-hansen', paimindOrigins: mode === 'empty' ? []
        : mode === 'unsigned' ? ['arbitrary-login'] : mode === 'duplicate' ? [message().source.rpcId, message().source.rpcId] : [message().source.rpcId],
      ...(mode === 'extra' ? { role: 'admin' } : {}) }
    await expect(f.step([message(), { source }])).rejects.toThrow()
    expect(f.check).not.toHaveBeenCalled()
  })
  it('inspects the final native pre-step decision rather than the original mutable proposal', async () => {
    const f = await fixture()
    f.root.on('agent/pre-step', async () => ({ kind: 'enter', messages: [message('untrusted-replacement')] } as never))
    await expect(f.step()).rejects.toThrow(); expect(f.check).not.toHaveBeenCalled()
  })
  it('rejects current source failure without executing a tool or exposing internal failures', async () => {
    const f = await fixture(); await f.step(); f.accept(); f.check.mockRejectedValue(Error('secret database details'))
    const result = await f.tool(); expect(result.isError).toBe(true); expect(f.body).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('secret database details')
  })
  it.each(['revoked', 'changed-turn', 'changed-preset'])('rechecks %s after the actual native scheduler has prepared a call', async mode => {
    const f = await fixture(); await f.step(); f.accept()
    const prepared = await f.prepare(); expect(prepared.kind).toBe('dispatch')
    if (prepared.kind !== 'dispatch') throw Error('Fixture not prepared')
    if (mode === 'revoked') f.check.mockRejectedValue(Error('Revoked only after approval/preparation'))
    else if (mode === 'changed-preset') f.header.agentPreset = 'alex-personal'
    else f.events.push({ type: 'turn/end', data: {} }, { type: 'turn/start', data: { turn: 2 } },
      { type: 'step/start', data: { turn: 2, step: 1 } }, { type: 'user/message', data: message(source('a')) })
    const scheduler = f.root.tools[TOOL_RUNTIME_SCHEDULER], result = await scheduler.dispatch(prepared.exec)
    const completed = result.kind === 'post-result' ? await scheduler.finalize(prepared.exec, result.result) : scheduler.finish(prepared.exec, result.result)
    expect(completed.isError).toBe(true); expect(f.body).not.toHaveBeenCalled()
  })
  it('uses the mounted preset owner and never falls back to an apparently valid session header', async () => {
    const f = await fixture(), owner = { composedPreset: vi.fn((): string | undefined => 'mounted-preset') }
    Object.assign(f.agent, { ctx: { get: () => owner } })
    await f.step(); expect(f.check.mock.calls.at(-1)?.[0]).toMatchObject({ presetId: 'mounted-preset' })
    owner.composedPreset.mockReturnValue(undefined)
    await expect(f.step()).rejects.toThrow(); expect(f.check).toHaveBeenCalledOnce()
    const g = await fixture(); g.header.agentPreset = ''
    await expect(g.step()).rejects.toThrow(); expect(g.check).not.toHaveBeenCalled()
  })
  it('rejects a mounted preset changed while the async permission read is in flight', async () => {
    const f = await fixture()
    f.check.mockImplementation(async () => { f.header.agentPreset = 'other-preset' })
    await expect(f.step()).rejects.toThrow()
  })
  it('does not enter downstream preparation when the preset changes during its permission read', async () => {
    const f = await fixture(); await f.step(); f.accept()
    const downstream = vi.fn()
    f.root.on('tools/pre-execute', async (_execution, next) => { downstream(); return next() })
    f.check.mockImplementation(async () => { f.header.agentPreset = 'other-preset' })
    expect((await f.tool()).isError).toBe(true)
    expect(downstream).not.toHaveBeenCalled(); expect(f.body).not.toHaveBeenCalled()
  })
  it('rejects a changed native turn during async checks and aborts pending checks on disposal', async () => {
    const f = await fixture(), entered = Promise.withResolvers<AbortSignal>()
    f.check.mockImplementation(async (_input: unknown, signal: AbortSignal) => { entered.resolve(signal); await new Promise(() => {}) })
    const pending = f.step(), rejected = expect(pending).rejects.toThrow()
    const signal = await entered.promise; await f.root.fiber.dispose(); await rejected; expect(signal.aborted).toBe(true)
    const g = await fixture(); g.check.mockImplementation(async () => { g.events.push({ type: 'turn/end', data: {} }) })
    await expect(g.step()).rejects.toThrow()
  })
})

describe('signed native reports and native reverse-lineage ownership', () => {
  const report = (senderSessionId = 'hansen-child') => ({ source: { kind: 'subagent-report', form: 'relay', senderSessionId,
    paimindOrigins: [source('r')] } })
  async function reporting(cold = false) {
    const f = await fixture(), header = { id: 'hansen-child', origin: 'subagent', parentSession: 'session-hansen' }
    const live = { value: cold ? undefined : { id: header.id, header } } as { value: { id: string; header: typeof header } | undefined }
    const get = vi.fn(() => live.value), inspect = vi.fn(async (_id: string, _signal: AbortSignal) => ({ meta: { ...header } }))
    f.root.provide('sessions', { get } as never)
    f.root.provide('sessionPersistence', { inspect } as never)
    return { ...f, childHeader: header, live, get, inspect }
  }
  it.each([false, true])('checks native %s cold ownership before and after current login authorization without publishing a child', async cold => {
    const f = await reporting(cold)
    await f.step([message(), report()])
    expect(f.check.mock.calls.at(-1)?.[0]).toEqual({ nativeSessionId: 'session-hansen', presetId: 'hansen-personal', sources: [source(), source('r')].sort() })
    expect(f.inspect).toHaveBeenCalledTimes(cold ? 2 : 0)
    expect(f.live.value === undefined).toBe(cold)
  })
  it.each([false, true])('checks a signed automatic notice against its native child lineage, cold=%s', async cold => {
    const f = await reporting(cold), input: any = report()
    Object.assign(input.source, { kind: 'subagent-settled', form: 'notice', summary: 'Background child finished' })
    await f.step([input])
    expect(f.check.mock.calls.at(-1)?.[0].sources).toEqual([source('r')])
    expect(f.inspect).toHaveBeenCalledTimes(cold ? 2 : 0)
    f.childHeader.parentSession = 'session-alex'
    await expect(f.step([message(), input])).rejects.toThrow()
  })
  it.each([undefined, '', ' ', 'x'.repeat(1001), 42])('rejects an invalid native notice summary: %j', async summary => {
    const f = await reporting(), input: any = report()
    Object.assign(input.source, { kind: 'subagent-settled', form: 'notice', summary })
    await expect(f.step([message(), input])).rejects.toThrow()
    expect(f.check).not.toHaveBeenCalled()
  })
  it.each(['wrong-parent', 'wrong-id', 'not-subagent', 'missing'])('rejects %s reverse lineage even beside an otherwise valid user', async mode => {
    const f = await reporting(mode === 'missing')
    if (mode === 'wrong-parent') f.childHeader.parentSession = 'session-alex'
    if (mode === 'wrong-id') f.childHeader.id = 'other'
    if (mode === 'not-subagent') f.childHeader.origin = 'user'
    if (mode === 'missing') f.inspect.mockRejectedValue(Error('private storage path'))
    await expect(f.step([message(), report()])).rejects.toThrow()
    expect(f.check).not.toHaveBeenCalled()
  })
  it.each(['unsigned', 'extra', 'form', 'self', 'settled'])('does not whitelist a malformed or different return source: %s', async mode => {
    const f = await reporting(), input: any = report()
    if (mode === 'unsigned') delete input.source.paimindOrigins
    if (mode === 'extra') input.source.parentSessionId = 'session-hansen'
    if (mode === 'form') input.source.form = 'notice'
    if (mode === 'self') input.source.senderSessionId = 'session-hansen'
    if (mode === 'settled') input.source.kind = 'subagent-settled'
    await expect(f.step([message(), input])).rejects.toThrow()
    expect(f.check).not.toHaveBeenCalled()
  })
  it('rejects a changed live native relation during the backend check', async () => {
    const f = await reporting()
    f.check.mockImplementation(async () => { f.childHeader.parentSession = 'session-alex' })
    await expect(f.step([report()])).rejects.toThrow()
    expect(f.check).toHaveBeenCalledOnce()
  })
  it('prefers a newly published native owner to an older cold inspection', async () => {
    const f = await reporting(true)
    f.inspect.mockImplementation(async () => {
      f.live.value = { id: 'hansen-child', header: { ...f.childHeader, parentSession: 'session-alex' } }
      return { meta: { ...f.childHeader } }
    })
    await expect(f.step([report()])).rejects.toThrow(); expect(f.check).not.toHaveBeenCalled()
  })
  it('cancels a blocked native lineage read on guard disposal without consulting identity or leaking the inspection', async () => {
    const f = await reporting(true), entered = Promise.withResolvers<AbortSignal>()
    f.inspect.mockImplementation(async (_id, signal) => { entered.resolve(signal); return new Promise(() => {}) })
    const pending = f.step([report()]), rejected = expect(pending).rejects.toThrow(), signal = await entered.promise
    await f.root.fiber.dispose(); await rejected
    expect(signal.aborted).toBe(true); expect(f.check).not.toHaveBeenCalled()
  })
  it('continues checking a report relation throughout the real active-turn lifetime', async () => {
    const f = await reporting(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    await f.step([report()])
    f.events.push({ type: 'step/start', data: { turn: 1, step: 1 } }, { type: 'user/message', data: report() })
    await vi.advanceTimersByTimeAsync(1000); expect(f.check).toHaveBeenCalledTimes(2)
    f.childHeader.parentSession = 'session-alex'
    await vi.advanceTimersByTimeAsync(1000); expect(f.cancel).toHaveBeenCalledOnce()
    expect(f.check).toHaveBeenCalledTimes(2)
  })
  it('does not lend a previously checked login to a report relation not admitted by the native step guard', async () => {
    const f = await reporting(); await f.step(); f.accept()
    expect(captureManagedHarnessOrigins(f.root, f.agent).input.sources).toEqual([source()])
    f.events.push({ type: 'user/message', data: { source: { ...report().source, paimindOrigins: [source()] } } })
    expect(() => captureManagedHarnessOrigins(f.root, f.agent)).toThrow()
    await f.step([], 2)
    expect(captureManagedHarnessOrigins(f.root, f.agent).input.sources).toEqual([source()])
  })
})

describe('active native turn permission lifetime', () => {
  const fakeTime = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const end = (f: Awaited<ReturnType<typeof fixture>>) => {
    f.events.push({ type: 'turn/end', data: { turn: 1 } })
    f.root.emit('session/event', f.agent.session, { type: 'turn/end', data: { turn: 1 } } as never)
  }
  it('retains used requirements through deselection and cancels only the revoked active turn', async () => {
    const f = await fixture(), g = await fixture(); fakeTime()
    let selected = true, revoked = false
    f.check.mockImplementation(async input => {
      if (revoked && input.requirements?.includes('fixed-skill-version')) throw Error('revoked used Skill')
      return selected ? ['fixed-skill-version'] : []
    })
    await f.step(); f.accept(); await g.step(); g.accept()
    selected = false
    await f.step([], 2)
    expect(f.check.mock.calls.at(-1)?.[0].requirements).toEqual(['fixed-skill-version'])
    expect(captureManagedHarnessOrigins(f.root, f.agent).input.requirements).toEqual(['fixed-skill-version'])
    revoked = true
    expect((await f.tool()).isError).toBe(true); expect(f.body).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1100)
    expect(f.cancel).toHaveBeenCalledOnce(); expect(g.cancel).not.toHaveBeenCalled()
  })
  it('merges concurrent requirement reads without letting an earlier reply erase a later dependency', async () => {
    const f = await fixture(); fakeTime(); f.check.mockResolvedValue(['first'])
    await f.step(); f.accept()
    const captured = captureManagedHarnessOrigins(f.root, f.agent)
    const held = Promise.withResolvers<readonly string[]>(); let count = 0
    f.check.mockImplementation(async () => ++count === 1 ? held.promise : ['second'])
    const preparing = f.prepare(); await vi.advanceTimersByTimeAsync(1000)
    held.resolve(['first']); await preparing
    expect(captureManagedHarnessOrigins(f.root, f.agent).input.requirements).toEqual(['first', 'second'])
    expect(() => captured.assertCurrent()).toThrow()
  })
  it('releases turn-only requirements at the original boundary instead of poisoning a new unrelated turn', async () => {
    const f = await fixture(); fakeTime(); f.check.mockResolvedValue(['first'])
    await f.step(); f.accept(); end(f)
    f.events.push({ type: 'turn/start', data: { turn: 2 } }); f.check.mockResolvedValue([])
    await f.root.waterfall('agent/pre-step', { agent: f.agent, turn: 2, step: 1, signal: new AbortController().signal } as never,
      () => Promise.resolve({ kind: 'enter', messages: [message()] } as never))
    expect(f.check.mock.calls.at(-1)?.[0].requirements).toBeUndefined()
  })
  it.each([Array.from({ length: 129 }, (_, i) => String(i)), [''], [42], {}])('refuses invalid dependency results before starting a turn', async result => {
    const f = await fixture(); f.check.mockResolvedValue(result as never)
    await expect(f.step()).rejects.toThrow(); expect(f.body).not.toHaveBeenCalled()
    expect(() => captureManagedHarnessOrigins(f.root, f.agent)).toThrow()
  })
  it('renews from original turn sources and cancels the native activity while retaining unstarted inbox items', async () => {
    const f = await fixture(); fakeTime(); await f.step(); f.accept()
    await vi.advanceTimersByTimeAsync(1000); expect(f.check).toHaveBeenCalledTimes(2)
    f.check.mockRejectedValue(Error('permission withdrawn'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith({ kind: 'hook', reason: expect.any(String) }, { keepInbox: true })
    expect(f.nativeAbort.signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(10000); expect(f.check).toHaveBeenCalledTimes(3)
  })
  it('expires a stalled checker without concurrent renewal or an indefinitely cached allow', async () => {
    const f = await fixture(); fakeTime(); await f.step(); f.accept()
    f.check.mockImplementation(async () => { await new Promise(() => {}) })
    await vi.advanceTimersByTimeAsync(1000); expect(f.check).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4000)
    expect(f.cancel).toHaveBeenCalledOnce(); expect(f.nativeAbort.signal.aborted).toBe(true)
    expect(f.check).toHaveBeenCalledTimes(2)
  })
  it('does not extend freshness from a late successful response instead of its original check start', async () => {
    const f = await fixture(); fakeTime(); await f.step(); f.accept()
    const finish = Promise.withResolvers<void>()
    f.check.mockImplementation(async () => finish.promise)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(3000); finish.resolve()
    await vi.advanceTimersByTimeAsync(0)
    f.check.mockImplementation(async () => { await new Promise(() => {}) })
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.cancel).toHaveBeenCalledOnce() // renewal began at 1000; expires at 6000, not 9000
  })
  it('aborts an actually executing native tool via the registry-fused signal and does not report success', async () => {
    const f = await fixture(); fakeTime(); await f.step(); f.accept()
    const entered = Promise.withResolvers<AbortSignal>()
    f.body.mockImplementation(async (_args: unknown, execution: { signal: AbortSignal }) => {
      entered.resolve(execution.signal)
      await new Promise<void>(resolve => execution.signal.addEventListener('abort', () => resolve(), { once: true }))
      return { ran: true }
    })
    const pending = f.tool(), signal = await entered.promise
    f.check.mockRejectedValue(Error('revoked during body'))
    await vi.advanceTimersByTimeAsync(1000)
    const result = await pending
    expect(signal.aborted).toBe(true); expect(result.isError).toBe(true); expect(f.cancel).toHaveBeenCalledOnce()
  })
  it('stops renewal at the original turn boundary and ignores a late failure after a different turn starts', async () => {
    const f = await fixture(); fakeTime(); await f.step(); f.accept()
    const finish = Promise.withResolvers<void>()
    f.check.mockImplementation(async () => finish.promise)
    await vi.advanceTimersByTimeAsync(1000)
    end(f); f.events.push({ type: 'turn/start', data: { turn: 2 } })
    finish.reject(Error('late denial for old turn')); await vi.advanceTimersByTimeAsync(10000)
    expect(f.cancel).not.toHaveBeenCalled(); expect(f.check).toHaveBeenCalledTimes(2)
  })
  it('rechecks all newly accepted signed sources when a native step advances during renewal', async () => {
    const f = await fixture(); fakeTime(); await f.step(); f.accept()
    const finish = Promise.withResolvers<void>()
    f.check.mockImplementationOnce(async () => finish.promise)
    await vi.advanceTimersByTimeAsync(1000)
    await f.step([message(source('a'))], 2)
    f.events.push({ type: 'step/start', data: { turn: 1, step: 2 } }, { type: 'user/message', data: message(source('a')) })
    finish.resolve(); await vi.advanceTimersByTimeAsync(1)
    expect(f.check).toHaveBeenCalledTimes(4)
    expect(f.check.mock.calls.at(-1)?.[0]).toMatchObject({ sources: [source('a'), source()].sort() })
    expect(f.cancel).not.toHaveBeenCalled()
    end(f)
  })
  it('cancels on native preset drift and root disposal, and releases every pending timer', async () => {
    const f = await fixture(); fakeTime(); await f.step(); f.accept()
    f.header.agentPreset = 'changed-mounted-preset'
    await vi.advanceTimersByTimeAsync(1000); expect(f.cancel).toHaveBeenCalledOnce()
    const g = await fixture(); await g.step(); g.accept()
    await g.root.fiber.dispose(); expect(g.cancel).toHaveBeenCalledOnce()
    const before = g.check.mock.calls.length
    await vi.advanceTimersByTimeAsync(10000); expect(g.check).toHaveBeenCalledTimes(before)
  })
  it('rejects unmonitored direct dispatch even if an event fixture claims a current turn', async () => {
    const f = await fixture(); f.accept()
    expect((await f.tool()).isError).toBe(true); expect(f.body).not.toHaveBeenCalled(); expect(f.check).not.toHaveBeenCalled()
  })
})
