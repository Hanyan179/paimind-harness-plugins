// @vitest-environment node
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPaimindNativeApprovalReference as read, readPaimindNativeSessionEventPage as events } from '../src/host.js'
import { installManagedHarnessToolGuard } from '../src/managed-runtime.js'
import { guardManagedHarnessApprovalApi, prepareHarnessApprovalResponse } from '../src/managed-approval.js'
import type { ManagedHarnessQueueCheck } from '../src/managed-queue.js'
const local = createRequire(import.meta.url)
const web = createRequire(createRequire(local.resolve('@deepseek-ai/dsh/package.json')).resolve('@deepseek-ai/dsh-web-app/package.json'))
const { Context } = web('@deepseek-ai/cordis'), { AgentLoop } = web('@deepseek-ai/dsh-agent-loop')
const { AgentRegistry } = web('@deepseek-ai/dsh-agent'), { SessionStore } = web('@deepseek-ai/dsh-session')
const { LlmRuntime } = web('@deepseek-ai/dsh-llm'), { ToolRuntime } = web('@deepseek-ai/dsh-tools')
const { SystemPrompt } = web('@deepseek-ai/dsh-system-prompt'), { JsonlSessionPersistence } = web('@deepseek-ai/dsh-session-persistence-jsonl')
const { createApiProxy } = web('@deepseek-ai/dsh-host-apiproxy'), { ApprovalService } = web('@deepseek-ai/dsh-user-approval')
const { defineTool } = web('@deepseek-ai/dsh-tools')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const stop of cleanups.splice(0).reverse()) await stop() })
const signal = () => new AbortController().signal
async function fixture(folder?: string, writeBatchMaxDelayMs = 200) {
  const root = new Context(), directory = folder ?? await mkdtemp(join(tmpdir(), 'paimind-native-approval-'))
  const authority = { allowed: true }
  const guard = installManagedHarnessToolGuard(root, () => authority.allowed ? undefined : 'Current diagnostic authority withdrawn')
  const pending: Array<{ controller: AbortController; outcome: Promise<unknown> }> = []
  cleanups.push(async () => { for (const request of pending) request.controller.abort(); await Promise.allSettled(pending.map(request => request.outcome)); await root.fiber.dispose() })
  for (const [plugin, settings] of [[SessionStore], [AgentRegistry], [SystemPrompt, {}], [LlmRuntime], [ToolRuntime, {}],
    [JsonlSessionPersistence, { root: directory, compression: 'none', writeBatchMaxDelayMs }], [ApprovalService, { policy: 'ask' }]]) await root.plugin(plugin, settings)
  await root.plugin(AgentLoop, { agents: [] }); root.provide('userQuestions', { registerProvider: () => () => {} })
  guard.assertReady()
  const api = createApiProxy(root, { defaultModelSelection: () => ({ provider: 'never', model: 'never' }) }); root.provide('apiProxy', api)
  const handle = folder ? undefined : await root.agents.create({ sessionId: 'hansen-approval', meta: { cwd: directory, agentPreset: 'standard' } })
  if (handle) handle.agent.session.append('turn/start', { turn: 1 })
  const ask = () => {
    const controller = new AbortController(), outcome = root.approval.request({ agent: handle!.agent, toolName: 'diagnostic', callId: 'call-owned', reason: 'PRIVATE_ARGUMENT', signal: controller.signal })
    pending.push({ controller, outcome })
    const id = handle!.agent.session.events.findLast((event: any) => event.type === 'approval/asked').data.id
    return { id, outcome, controller }
  }
  return { root, api, agent: handle?.agent, directory, ask, authority }
}

describe('HAAS-08 original approval and tool scheduler with explicit local body and authority fixtures, no external model/browser claim', () => {
  it.each(['write-failure', 'no-writer', 'abort', 'withdraw', 'timeout'] as const)('keeps the body sealed for %s at the original decision checkpoint', async fault => {
    const f = await fixture(undefined, 60000), abort = new AbortController(), body = vi.fn(async () => 1)
    f.root.tools.register(defineTool({ name: 'diagnostic', description: 'Explicit local body only', parameters: {},
      output: { schema: { type: 'number' }, render: () => [{ type: 'text', text: 'counted' }] }, execute: body }))
    f.root.on('tools/pre-execute', async () => ({ kind: 'ask', reason: 'Checkpoint failure diagnostic' }))
    const executed = f.root.tools.execute({ name: 'diagnostic', callId: 'durable-fault', arguments: {}, agent: f.agent, signal: abort.signal })
    cleanups.push(async () => { abort.abort(); await executed })
    await vi.waitFor(() => expect(f.agent.session.events.some((event: any) => event.type === 'approval/asked')).toBe(true))
    const id = f.agent.session.events.find((event: any) => event.type === 'approval/asked').data.id
    await f.root.sessions.flush(f.agent.session)
    const pending = await read(f.root, f.agent.id, id, signal()), held = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
    const original = f.root.sessions.flush.bind(f.root.sessions)
    const flush = vi.spyOn(f.root.sessions, 'flush').mockImplementation(async session => {
      entered.resolve(); await held.promise
      if (fault === 'write-failure') throw Error('Explicit native storage failure')
      if (fault === 'no-writer') return false
      return original(session)
    })
    try {
      await f.api.respond({ type: 'client-response', rpcId: pending.rpcId, result: { ok: true,
        value: { sessionId: f.agent.id, approvalId: id, outcome: 'allowed-once' } } })
      await entered.promise; expect(body).not.toHaveBeenCalled()
      if (fault === 'abort') abort.abort()
      if (fault === 'withdraw') f.authority.allowed = false
      if (fault !== 'timeout') held.resolve()
      expect((await executed).isError).toBe(true)
      expect(body).not.toHaveBeenCalled()
    } finally { held.resolve(); flush.mockRestore() }
  })
  it('does not dispatch an approved native tool body before its exact original decision is stored', async () => {
    const f = await fixture(undefined, 60000), abort = new AbortController()
    let approvalId: string
    const body = vi.fn(async () => {
      const stored = await f.root.sessionPersistence.readFrom(f.agent.id, 0, signal())
      return stored.events.some((event: any) => event.type === 'approval/decided' && event.data.id === approvalId && event.data.outcome === 'allowed-once')
    })
    f.root.tools.register(defineTool({ name: 'diagnostic', description: 'Inspect original stored approval at the body boundary', parameters: {},
      output: { schema: { type: 'boolean' }, render: () => [{ type: 'text', text: 'Local evidence only' }] }, execute: body }))
    f.root.on('tools/pre-execute', async () => ({ kind: 'ask', reason: 'Exact diagnostic approval' }))
    const executed = f.root.tools.execute({ name: 'diagnostic', callId: 'durable-call', arguments: {}, agent: f.agent, signal: abort.signal })
    cleanups.push(async () => { abort.abort(); await executed })
    await vi.waitFor(() => expect(f.agent.session.events.some((event: any) => event.type === 'approval/asked')).toBe(true))
    approvalId = f.agent.session.events.find((event: any) => event.type === 'approval/asked').data.id
    await f.root.sessions.flush(f.agent.session)
    const pending = await read(f.root, f.agent.id, approvalId!, signal())
    await f.api.respond({ type: 'client-response', rpcId: pending.rpcId, result: { ok: true,
      value: { sessionId: f.agent.id, approvalId: approvalId!, outcome: 'allowed-once' } } })
    const result = await executed
    expect(result.isError).toBe(false); expect(body).toHaveBeenCalledTimes(1)
    expect(result.value).toBe(true)
  })
  it.each(['allowed-once', 'rejected'] as const)('proves %s from actual stored events, not live inspect or an implicit flush', async outcome => {
    const f = await fixture(undefined, 60000), request = f.ask(), pending = await read(f.root, f.agent.id, request.id, signal())
    expect(pending.persisted).toBe(false)
    await f.root.sessions.flush(f.agent.session)
    const before = (await f.root.sessionPersistence.readRaw(f.agent.id)).content
    await f.api.respond({ type: 'client-response', rpcId: pending.rpcId, result: { ok: true,
      value: { sessionId: f.agent.id, approvalId: request.id, outcome } } })
    await request.outcome
    expect((await f.root.sessionPersistence.inspect(f.agent.id)).events.some((e: any) => e.type === 'approval/decided')).toBe(true)
    const flush = vi.spyOn(f.root.sessions, 'flush')
    try {
      expect(await read(f.root, f.agent.id, request.id, signal())).toMatchObject({ outcome, persisted: false, answerable: false })
      expect((await f.root.sessionPersistence.readRaw(f.agent.id)).content).toBe(before)
      expect(flush).not.toHaveBeenCalled()
    } finally { flush.mockRestore() }
    await f.root.sessions.flush(f.agent.session)
    expect(await read(f.root, f.agent.id, request.id, signal())).toMatchObject({ outcome, persisted: true, answerable: false })
    const stored = vi.spyOn(f.root.sessionPersistence, 'readFrom').mockRejectedValueOnce(Error('Explicit unreadable stored prefix'))
    await expect(read(f.root, f.agent.id, request.id, signal())).rejects.toThrow('unreadable')
    stored.mockRestore()
  })
  it.each(['approve', 'reject', 'withdraw'] as const)('uses the real native tool scheduler for %s with zero early bodies and no double execution', async decision => {
    const f = await fixture(), body = vi.fn(async () => 1), abort = new AbortController()
    f.root.tools.register(defineTool({ name: 'diagnostic', description: 'Local counted body; no external side effect', parameters: {},
      output: { schema: { type: 'number' }, render: () => [{ type: 'text', text: 'counted' }] }, execute: body }))
    f.root.on('tools/pre-execute', async (_exec: unknown, _next: unknown) => ({ kind: 'ask', reason: 'Explicit diagnostic approval' }))
    const executed = f.root.tools.execute({ name: 'diagnostic', callId: 'owned-call', arguments: {}, agent: f.agent, signal: abort.signal })
    cleanups.push(async () => { abort.abort(); await executed })
    await vi.waitFor(() => expect(f.agent.session.events.some((event: any) => event.type === 'approval/asked')).toBe(true))
    const id = f.agent.session.events.find((event: any) => event.type === 'approval/asked').data.id
    const state = await read(f.root, f.agent.id, id, signal()); expect(state.answerable).toBe(true); expect(body).not.toHaveBeenCalled()
    if (decision === 'withdraw') f.authority.allowed = false
    const response = { type: 'client-response', rpcId: state.rpcId, result: { ok: true,
      value: { sessionId: f.agent.id, approvalId: id, outcome: decision === 'reject' ? 'rejected' : 'allowed-once' } } }
    const replies = await Promise.all([f.api.respond(response), f.api.respond(response)])
    expect(replies.filter(reply => reply.accepted)).toHaveLength(1)
    const result = await executed
    expect(body).toHaveBeenCalledTimes(decision === 'approve' ? 1 : 0)
    expect(result.isError).toBe(decision !== 'approve')
    expect(f.agent.session.events.filter((event: any) => event.type === 'approval/decided')).toHaveLength(1)
  })
  it.each(['allowed-once', 'rejected'] as const)('observes the original pending owner and one %s decision without owning another queue', async outcome => {
    const f = await fixture(), request = f.ask(), before = JSON.stringify(f.agent.session.events)
    const state = await read(f.root, f.agent.id, request.id, signal())
    expect(state).toMatchObject({ sessionId: f.agent.id, approvalId: request.id, toolName: 'diagnostic', outcome: null, answerable: true, rpcId: expect.any(String) })
    expect(JSON.stringify(f.agent.session.events)).toBe(before)
    const firstPage = await events(f.root, f.agent.id, { afterSeq: -1 }, signal()), required = firstPage.events.find(e => e.kind === 'approval.required')!
    expect(required.data).toEqual({ approvalId: request.id, version: state.version, toolName: 'diagnostic' })
    expect(JSON.stringify(firstPage)).not.toContain('PRIVATE_ARGUMENT'); expect(JSON.stringify(firstPage)).not.toContain(state.rpcId!)
    const reply = { type: 'client-response', rpcId: state.rpcId, result: { ok: true, value: { sessionId: f.agent.id, approvalId: request.id, outcome } } }
    expect(await f.api.respond(reply)).toEqual({ accepted: true }); expect(await request.outcome).toBe(outcome)
    expect(await f.api.respond(reply)).toMatchObject({ accepted: false, reason: 'not-pending' })
    const final = await read(f.root, f.agent.id, request.id, signal())
    expect(final).toMatchObject({ answerable: false, rpcId: null, outcome }); expect(final.version).not.toBe(state.version)
    const decided = (await events(f.root, f.agent.id, { afterSeq: required.seq, afterDigest: required.digest }, signal())).events.find(e => e.kind === 'approval.decided')!
    expect(decided.data).toEqual({ approvalId: request.id, version: final.version, toolName: 'diagnostic', outcome })
    expect(f.agent.session.events.filter((event: any) => event.type === 'approval/decided')).toHaveLength(1)
  })
  it('reads retained decided history without activating a cold Agent or exposing a response correlation', async () => {
    const f = await fixture(), request = f.ask(), state = await read(f.root, f.agent.id, request.id, signal())
    await f.api.respond({ type: 'client-response', rpcId: state.rpcId, result: { ok: true, value: { sessionId: f.agent.id, approvalId: request.id, outcome: 'rejected' } } })
    await request.outcome; f.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await f.root.sessions.flush(f.agent.session)
    const expected = await read(f.root, f.agent.id, request.id, signal()), original = await f.root.sessionPersistence.readRaw(f.agent.id)
    await f.root.fiber.dispose()
    const cold = await fixture(f.directory), resume = vi.spyOn(cold.root.agents, 'resume'), create = vi.spyOn(cold.root.agents, 'create')
    expect(await read(cold.root, 'hansen-approval', request.id, signal())).toEqual(expected)
    expect(resume).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled()
    expect(cold.root.sessions.list()).toHaveLength(0)
    expect((await cold.root.sessionPersistence.readRaw('hansen-approval')).content).toBe(original.content)
  })
  it('observes cancellation from the original request signal and never returns the stale native response id', async () => {
    const f = await fixture(), request = f.ask(); const state = await read(f.root, f.agent.id, request.id, signal())
    request.controller.abort(); expect(await request.outcome).toBe('cancelled')
    const after = await read(f.root, f.agent.id, request.id, signal())
    expect(after).toMatchObject({ answerable: false, rpcId: null, outcome: 'cancelled' })
    expect(await f.api.respond({ type: 'client-response', rpcId: state.rpcId, result: { ok: true, value: { sessionId: f.agent.id, approvalId: request.id, outcome: 'allowed-once' } } })).toMatchObject({ accepted: false })
  })
  it('does not invent a live grant from cold, seeded, unobserved or missing historical requests', async () => {
    const id = randomUUID(), entry = { seq: 0, type: 'approval/asked', time: 1, data: { id, toolName: 'diagnostic' } }
    const session = { header: { id: 'owned', seedLength: 0 }, events: [entry] }
    const mux = vi.fn(async function*(_request, abort: AbortSignal) { await new Promise<void>(resolve => { abort.addEventListener('abort', () => resolve(), { once: true }) }) })
    const context = { sessions: { get: () => session as unknown }, get: (name: string) => name === 'apiProxy' ? { events: { mux } } : { inspect: async () => ({ meta: session.header, events: session.events }) } }
    expect(await read(context, 'owned', id, signal())).toMatchObject({ answerable: false, outcome: null, rpcId: null })
    expect(mux).toHaveBeenCalledOnce()
    session.header.seedLength = 1
    expect((await read(context, 'owned', id, signal())).answerable).toBe(false); expect(mux).toHaveBeenCalledOnce()
    context.sessions.get = () => undefined
    expect((await read(context, 'owned', id, signal())).answerable).toBe(false); expect(mux).toHaveBeenCalledOnce()
    await expect(read(context, 'owned', randomUUID(), signal())).rejects.toThrow('不存在')
    await expect(read(context, 'owned', id, AbortSignal.abort())).rejects.toThrow()
  })
  it('rechecks the original log after observation and discards an id resolved during the snapshot', async () => {
    const id = randomUUID(), session = { header: { id: 'owned' }, events: [{ seq: 0, type: 'approval/asked', time: 1, data: { id, toolName: 'diagnostic' } }] as any[] }
    const context = { sessions: { get: () => session }, get: () => ({ readStoredRevision: async () => undefined, readFrom: async () => { throw Error('No stored fixture') }, events: { async *mux() {
      session.events.push({ seq: 1, type: 'approval/decided', time: 2, data: { id, outcome: 'cancelled' } })
      yield { rpcId: 'old', payload: { type: 'approval/requested', sessionId: 'owned', approvalId: id, toolName: 'diagnostic' } }
    } } }) }
    expect(await read(context, 'owned', id, signal())).toMatchObject({ answerable: false, outcome: 'cancelled', rpcId: null })
  })
})

// Synthetic proof and explicit current-authority callback; this suite proves
// the native owner boundary, not enterprise cryptography, DB or browser E2E.
async function guarded(f: Awaited<ReturnType<typeof fixture>>, outcome: 'allowed-once' | 'rejected' = 'allowed-once') {
  const request = f.ask(), state = await read(f.root, f.agent.id, request.id, signal())
  const original = { type: 'client-response', rpcId: state.rpcId!, result: { ok: true,
    value: { sessionId: f.agent.id, approvalId: request.id, outcome } } }
  const wire = prepareHarnessApprovalResponse('POST', '/api/respond', 'application/json', Buffer.from(JSON.stringify(original)))!
  const source = `paimind-origin-v1.${Buffer.from(JSON.stringify({ nativeSessionId: f.agent.id,
    clientRpcId: wire.correlation(state.version) })).toString('base64url')}.${'a'.repeat(43)}`
  const stamped = JSON.parse(Buffer.from(wire.stamp(source, state.version)).toString())
  const check = vi.fn<ManagedHarnessQueueCheck>(async input => {
    if (input.sources.length !== 1 || input.sources[0] !== source || !f.authority.allowed) throw Error('Diagnostic authority denied')
  })
  const respond = guardManagedHarnessApprovalApi(f.root, f.api.respond.bind(f.api), check)
  return { request, state, original, wire, source, stamped, check, respond }
}
describe('managed original pending-consumer provenance and current-authority fences', () => {
  it.each(['allowed-once', 'rejected'] as const)('consumes the same original %s request once across concurrent stamped responses', async outcome => {
    const f = await fixture(), g = await guarded(f, outcome)
    expect(g.stamped.rpcId).toBe(g.original.rpcId)
    const responses = await Promise.all(Array.from({ length: 5 }, () => g.respond(g.stamped)))
    expect(responses.filter(result => result.accepted)).toHaveLength(1)
    expect(await g.request.outcome).toBe(outcome)
    expect(g.check).toHaveBeenCalledWith({ nativeSessionId: f.agent.id, presetId: 'standard', sources: [g.source],
      action: outcome === 'allowed-once' ? 'approval-approve' : 'approval-reject' }, expect.any(AbortSignal))
    expect(f.agent.session.events.filter((event: any) => event.type === 'approval/decided')).toHaveLength(1)
    expect(JSON.stringify(f.agent.session.events)).not.toContain('paimindApproval')
  })
  it.each(['unsigned', 'outcome', 'version', 'rpc', 'session', 'id', 'source', 'extra'])(
    'refuses %s changes without consuming the pending request', async change => {
      const f = await fixture(), g = await guarded(f), altered = structuredClone(g.stamped), value = altered.result.value
      if (change === 'unsigned') delete value.paimindApproval
      if (change === 'outcome') value.outcome = 'rejected'
      if (change === 'version') value.paimindApproval.expectedVersion = 'A'.repeat(43)
      if (change === 'rpc') altered.rpcId = randomUUID()
      if (change === 'session') value.sessionId = 'alex-approval'
      if (change === 'id') value.approvalId = randomUUID()
      if (change === 'source') value.paimindApproval.source = value.paimindApproval.source.replace(/a{43}$/u, 'b'.repeat(43))
      if (change === 'extra') value.admin = true
      expect((await g.respond(altered)).accepted).toBe(false)
      expect(await read(f.root, f.agent.id, g.request.id, signal())).toEqual(g.state)
      expect(f.agent.session.events.some((event: any) => event.type === 'approval/decided')).toBe(false)
    })
  it('checks current authority after native observation as well as before', async () => {
    const f = await fixture(), g = await guarded(f)
    g.check.mockResolvedValueOnce().mockRejectedValueOnce(Error('Current login withdrawn after observation'))
    expect((await g.respond(g.stamped)).accepted).toBe(false); expect(g.check).toHaveBeenCalledTimes(2)
    expect(await read(f.root, f.agent.id, g.request.id, signal())).toEqual(g.state)
  })
  it.each(['resolve', 'preset'] as const)('refuses %s changes during authority IO without overriding the original owner', async change => {
    const f = await fixture(), g = await guarded(f)
    g.check.mockImplementationOnce(async () => {
      if (change === 'resolve') { await f.api.respond({ ...g.original, result: { ok: true, value: { ...g.original.result.value, outcome: 'rejected' } } }); await g.request.outcome }
      else f.agent.ctx.provide('agentPresets', { composedPreset: () => 'changed' })
    })
    // Test scope change through the original provider rather than pretending a
    // random log event controls the composed Agent scope.
    expect((await g.respond(g.stamped)).accepted).toBe(false)
    if (change === 'resolve') expect(await g.request.outcome).toBe('rejected')
  })
  it('times out a stalled authority without a late original mutation', async () => {
    const f = await fixture(), g = await guarded(f); let release!: () => void
    g.check.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    expect((await g.respond(g.stamped)).accepted).toBe(false)
    release(); await Promise.resolve()
    expect(await read(f.root, f.agent.id, g.request.id, signal())).toEqual(g.state)
  }, 6000)
  it('preserves non-approval original responses and refuses malformed public approval metadata', async () => {
    const f = await fixture(), g = await guarded(f), original = vi.fn().mockResolvedValue({ accepted: false, reason: 'not-pending' })
    const respond = guardManagedHarnessApprovalApi(f.root, original, g.check)
    const question = { type: 'client-response' as const, rpcId: 'question' as never, result: { ok: true as const, value: { questionId: 'q', answer: 'hello' } } }
    await respond(question); expect(original).toHaveBeenCalledExactlyOnceWith(question)
    expect(prepareHarnessApprovalResponse('POST', '/api/respond', 'application/json', Buffer.from(JSON.stringify(question)))).toBeUndefined()
    for (const target of ['/api/respond?alias=1', '/api/../api/respond']) expect(() => prepareHarnessApprovalResponse('POST', target, 'application/json', Buffer.from(JSON.stringify(g.original)))).toThrow()
    expect(() => prepareHarnessApprovalResponse('POST', '/api/respond', 'application/json', Buffer.from(JSON.stringify(g.stamped)))).toThrow()
  })
})
