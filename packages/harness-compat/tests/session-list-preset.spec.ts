// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectPaimindNativeSessionList } from '../src/host.js'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const request = { rpcId: 'list-request', payload: {} } as never
const row = (sessionId: string, agentPreset = 'standard') => ({ sessionId, agentPreset,
  updatedAt: 100, blank: false, running: false, cwd: '/workspace', projections: { asOfSeq: 9, values: { title: sessionId } } })
const snapshot = (id: string, preset = 'mine') => ({ meta: { id, agentPreset: 'standard' }, events: [
  { type: 'agent-preset/selected', data: { agentPreset: preset } }, { type: 'turn/end', data: {} },
] })
function fixture(ids = ['one']) {
  let dispose = () => {}
  const inspect = vi.fn(async (id: string, _signal: AbortSignal) => snapshot(id))
  const context = { sessions: { get: vi.fn((_id: string): unknown => undefined) },
    get: () => ({ inspect }), effect: (effect: () => (() => void)) => { dispose = effect() } }
  const response = { rpcId: 'list-request', result: { ok: true, value: { items: ids.map(id => row(id)) } } }
  const list = vi.fn(async (_input: unknown) => response), search = vi.fn(), history = vi.fn(), create = vi.fn()
  const native = { list, search, history, create }, api = projectPaimindNativeSessionList(context as never, native as never)
  return { inspect, context, response, list, native, api, dispose: () => dispose() }
}

describe('current native preset in managed cold session lists', () => {
  it('changes only current preset display while preserving native identity, order, metadata and methods', async () => {
    const f = fixture(['one', 'two']), before = structuredClone(f.response)
    const response = await f.api.list(request)
    expect(response).toEqual({ ...before, result: { ok: true, value: { items: [row('one', 'mine'), row('two', 'mine')] } } })
    expect(f.response).toEqual(before); expect(f.list).toHaveBeenCalledExactlyOnceWith(request)
    for (const name of ['search', 'history', 'create'] as const) expect(f.api[name]).toBe(f.native[name])
    expect(f.inspect).toHaveBeenCalledTimes(2)
  })
  it('preserves an uncomposed session without inventing a default', async () => {
    const f = fixture(); f.inspect.mockResolvedValue({ meta: { id: 'one' }, events: [] } as never)
    const response = await f.api.list(request)
    expect(response.result.ok && response.result.value.items[0]).not.toHaveProperty('agentPreset')
  })
  it('uses the original live owner if a session is published during cold inspection', async () => {
    const f = fixture(); f.inspect.mockImplementation(async id => {
      f.context.sessions.get.mockReturnValue({ header: { id, agentPreset: 'latest-live' }, events: [] })
      return snapshot(id, 'stale-cold')
    })
    const response = await f.api.list(request)
    expect(response.result.ok && response.result.value.items[0]?.agentPreset).toBe('latest-live')
  })
  it('preserves the original list error without inspecting any history', async () => {
    const f = fixture(), error = { rpcId: 'list-request', result: { ok: false, error: { code: 'invalid-request', message: 'original error', details: {} } } }
    f.list.mockResolvedValue(error as never)
    expect(await f.api.list(request)).toBe(error); expect(f.inspect).not.toHaveBeenCalled()
  })
  it.each(['missing', 'identity', 'preset'])('refuses %s without returning a false creation preset or sensitive error', async kind => {
    const f = fixture()
    if (kind === 'missing') f.inspect.mockRejectedValue(Error('PRIVATE_PATH_OR_ERROR'))
    else f.inspect.mockResolvedValue(snapshot(kind === 'identity' ? 'another-member' : 'one', kind === 'preset' ? '../foreign' : 'mine'))
    const response = await f.api.list(request)
    expect(response.result.ok).toBe(false); expect(JSON.stringify(response)).not.toContain('PRIVATE_PATH_OR_ERROR')
    expect(response.rpcId).toBe('list-request')
  })
  it('bounds concurrent history reads to four and cancels in-flight work on unload', async () => {
    const f = fixture(Array.from({ length: 12 }, (_, i) => `session-${i}`)), signals: AbortSignal[] = []
    f.inspect.mockImplementation((_id, signal) => { signals.push(signal); return new Promise(() => {}) })
    const pending = f.api.list(request)
    await vi.waitFor(() => expect(f.inspect).toHaveBeenCalledTimes(4))
    f.dispose(); expect((await pending).result.ok).toBe(false)
    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect((await f.api.list(request)).result.ok).toBe(false); expect(f.list).toHaveBeenCalledOnce()
  })
  it('bounds simultaneous list requests and refuses timeout rather than guessing a preset', async () => {
    const f = fixture(); f.inspect.mockImplementation(() => new Promise(() => {}))
    const pending = Array.from({ length: 4 }, () => f.api.list(request))
    expect((await f.api.list(request)).result.ok).toBe(false)
    expect((await Promise.all(pending)).every(response => !response.result.ok)).toBe(true)
  }, 10_000)

  it('corrects a real cold native JSONL list through the original API without resume or history changes', async () => {
    const local = createRequire(new URL('../../../package.json', import.meta.url))
    const web = createRequire(createRequire(local.resolve('@deepseek-ai/dsh/package.json')).resolve('@deepseek-ai/dsh-web-app/package.json'))
    const { Context } = web('@deepseek-ai/cordis'), { SessionStore } = web('@deepseek-ai/dsh-session')
    const { AgentRegistry } = web('@deepseek-ai/dsh-agent'), { JsonlSessionPersistence } = web('@deepseek-ai/dsh-session-persistence-jsonl')
    const { createApiProxy, toFetchHandler } = web('@deepseek-ai/dsh-host-apiproxy')
    const base = await mkdtemp(join(tmpdir(), 'paimind-list-native-')), roots: any[] = []
    cleanups.push(async () => { for (const root of roots.reverse()) await root.fiber.dispose(); await rm(base, { recursive: true, force: true }) })
    const boot = async () => {
      const root = new Context(); roots.push(root)
      await root.plugin(SessionStore); await root.plugin(AgentRegistry)
      await root.plugin(JsonlSessionPersistence, { root: base, compression: 'none' })
      root.provide('userQuestions', { registerProvider: () => () => {} })
      return root
    }
    const warm = await boot(), session = warm.sessions.create('native-switched', { meta: { cwd: base, agentPreset: 'standard' } })
    session.append('agent-preset/selected', { agentPreset: 'hansen-saved-agent' })
    await warm.sessions.flush(session)
    const raw = await warm.get('sessionPersistence').readRaw(session.id)
    await warm.fiber.dispose()
    const cold = await boot(), native = createApiProxy(cold, { defaultModelSelection: () => ({ provider: 'none', model: 'never-called' }) })
    const original = await native.sessions.list(request)
    expect(original.result.value.items[0].agentPreset).toBe('standard')
    const api = projectPaimindNativeSessionList(cold, native.sessions)
    const handler = toFetchHandler({ ...native, sessions: api })
    const response = await handler.fetch(new Request('http://native.test/api/session.list', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', method: 'session.list', rpcId: 'browser-list', payload: {} }) }))
    expect(response.status).toBe(200)
    const actual = await response.json()
    expect(actual.rpcId).toBe('browser-list'); expect(actual.result.ok).toBe(true)
    expect(actual.result.value.items).toEqual(original.result.value.items.map((item: object) => ({ ...item, agentPreset: 'hansen-saved-agent' })))
    expect(cold.sessions.list()).toHaveLength(0); expect(cold.agents.list()).toHaveLength(0)
    expect((await cold.get('sessionPersistence').readRaw(session.id))?.content).toBe(raw?.content)
  }, 20_000)
})
