// @vitest-environment node
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManagedHarnessQueueApiProvider, guardManagedHarnessQueueApi } from '../src/managed-queue.js'

const local = createRequire(import.meta.url)
const web = createRequire(createRequire(local.resolve('@deepseek-ai/dsh/package.json')).resolve('@deepseek-ai/dsh-web-app/package.json'))
const { Context } = web('@deepseek-ai/cordis'), { AgentLoop } = web('@deepseek-ai/dsh-agent-loop')
const { AgentRegistry } = web('@deepseek-ai/dsh-agent'), { SessionStore } = web('@deepseek-ai/dsh-session')
const { LlmRuntime } = web('@deepseek-ai/dsh-llm'), { ToolRuntime } = web('@deepseek-ai/dsh-tools')
const { SystemPrompt } = web('@deepseek-ai/dsh-system-prompt')
const { createApiProxy, toFetchHandler, ApiProxyService } = web('@deepseek-ai/dsh-host-apiproxy')
const { createUserMessage } = web('@deepseek-ai/dsh-llm')
const origin = (letter: string) => `paimind-origin-v1.c291cmNl.${letter.repeat(43)}`
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(running = false, subagent = false) {
  const root = new Context(), held = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
  cleanups.push(async () => { held.resolve(); await root.fiber.dispose() })
  for (const [plugin, settings] of [[SessionStore], [AgentRegistry], [SystemPrompt, {}], [LlmRuntime], [ToolRuntime, {}]]) await root.plugin(plugin, settings)
  await root.plugin(AgentLoop, { agents: [] }); root.provide('userQuestions', { registerProvider: () => () => {} })
  root.on('agent/pre-step', async () => { entered.resolve(); await held.promise; return { kind: 'reject' } })
  const handle = await root.agents.create({ sessionId: 'hansen-queue', meta: { agentPreset: 'standard', ...(subagent ? { origin: 'subagent' } : {}) } })
  const enqueue = (letter = 'h') => {
    const message = createUserMessage({ source: { kind: 'user', rpcId: origin(letter), clientTimeZone: 'Asia/Shanghai' }, content: [{ type: 'text', text: '原始报价核对' }] })
    handle.agent.send(message, 'next-turn', false); return message
  }
  if (running) { handle.agent.followup(createUserMessage({ source: { kind: 'user', rpcId: origin('s') }, content: [{ type: 'text', text: 'Hold native step; no model' }] })); await entered.promise }
  const item = enqueue(), check = vi.fn(async (_input: unknown, _signal: AbortSignal) => {})
  const native = createApiProxy(root, { defaultModelSelection: () => ({ provider: 'none', model: 'never-called' }) })
  const sessions = guardManagedHarnessQueueApi(root, native.sessions, check), handler = toFetchHandler({ ...native, sessions })
  const update = async (kind: string, source = origin('e'), content: unknown[] = [{ type: 'text', text: '编辑后的报价核对' }]) => {
    const reply = await handler.fetch(new Request('http://native.internal/api/session.updateQueue', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', method: 'session.updateQueue',
        rpcId: source, payload: { sessionId: handle.agent.id, itemId: item.id, action: { kind, ...(kind === 'edit' ? { content } : {}) } } }) }))
    expect(reply.status).toBe(200); return (await reply.json()).result
  }
  return { root, native, sessions, handle, item, check, update, enqueue }
}

describe('original queue owner with explicit synthetic signed identities', () => {
  it('keeps message identity/order and native history, replacing only edited content and its actual actor', async () => {
    const f = await fixture(), second = f.enqueue('a'), inbox = f.handle.agent.inbox
    const before = f.handle.agent.session.events.length, replace = inbox.replace
    expect((await f.update('edit')).ok).toBe(true)
    expect(inbox.nextTurn.map((item: { id: string }) => item.id)).toEqual([f.item.id, second.id])
    expect(inbox.nextTurn[0]).toMatchObject({ id: f.item.id, source: { kind: 'user', rpcId: origin('e'), clientTimeZone: 'Asia/Shanghai' },
      content: [{ type: 'text', text: '编辑后的报价核对' }] })
    expect(f.handle.agent.session.events.length - before).toBe(1)
    expect(inbox.replace).toBe(replace); expect(Object.hasOwn(inbox, 'replace')).toBe(false)
    expect(f.check.mock.calls[0]?.[0]).toEqual({ nativeSessionId: f.handle.agent.id, presetId: 'standard', action: 'edit', sources: [origin('e')] })
  })
  it('preserves original steer semantics but associates the moved message with the current actor', async () => {
    const f = await fixture(true), steer = f.handle.agent.steer
    expect((await f.update('steer')).ok).toBe(true)
    expect(f.handle.agent.inbox.nextTurn).toHaveLength(0)
    expect(f.handle.agent.inbox.nextStep).toMatchObject([{ id: f.item.id, source: { rpcId: origin('e') } }])
    expect(f.handle.agent.steer).toBe(steer); expect(Object.hasOwn(f.handle.agent, 'steer')).toBe(false)
  })
  it('separately identifies removal so the deployment need not grant execution of withdrawn content', async () => {
    const f = await fixture()
    expect((await f.update('remove')).ok).toBe(true); expect(f.handle.agent.inbox.nextTurn).toHaveLength(0)
    expect(f.check.mock.calls[0]?.[0]).toMatchObject({ action: 'remove', sources: [origin('e')] })
  })
  it.each(['edit', 'remove', 'steer'])('denies %s by an unverified actor without changing the original inbox', async kind => {
    const f = await fixture(true); f.check.mockRejectedValue(Error('secret identity details'))
    const before = f.handle.agent.session.events.length, result = await f.update(kind)
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('secret identity details')
    expect(f.handle.agent.session.events).toHaveLength(before); expect(f.handle.agent.inbox.nextTurn).toEqual([f.item])
  })
  it('rejects unsigned callers and preserves original non-text and idle-steering errors', async () => {
    const f = await fixture()
    expect((await f.update('edit', 'caller-chosen-id')).ok).toBe(false); expect(f.check).not.toHaveBeenCalled()
    expect((await f.update('edit', origin('e'), [{ type: 'image', mediaType: 'image/png', data: 'AA==' }])).error.code).toBe('attachment-error')
    expect((await f.update('steer')).error.code).toBe('steer-unavailable')
    expect(f.handle.agent.inbox.nextTurn).toEqual([f.item]); expect(Object.hasOwn(f.handle.agent.inbox, 'replace')).toBe(false)
  })
  it('leaves subagent-owned queues to the native subagent route', async () => {
    const f = await fixture(false, true), before = f.handle.agent.session.events.length
    expect((await f.update('edit')).error.code).toBe('agent-busy')
    expect(f.handle.agent.session.events).toHaveLength(before); expect(f.handle.agent.inbox.nextTurn).toEqual([f.item])
  })
  it('preserves the native missing-item error without recreating a removed item', async () => {
    const f = await fixture(); f.handle.agent.inbox.remove(f.item.id)
    expect((await f.update('edit')).error.code).toBe('queue-item-not-found')
    expect(f.check).not.toHaveBeenCalled(); expect(f.handle.agent.inbox.nextTurn).toHaveLength(0)
  })
  it('refuses a competing mutation owner without overwriting or calling it', async () => {
    const f = await fixture(), inbox = f.handle.agent.inbox, other = vi.fn()
    Object.defineProperty(inbox, 'replace', { value: other, configurable: true })
    expect((await f.update('edit')).ok).toBe(false)
    expect(inbox.replace).toBe(other); expect(other).not.toHaveBeenCalled(); expect(inbox.nextTurn).toEqual([f.item])
  })
  it('does not overwrite a later edit or its actor after a slow permission check', async () => {
    const f = await fixture(), entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>()
    f.check.mockImplementationOnce(async () => { entered.resolve(); await finish.promise })
    const slow = f.update('edit', origin('f')); await entered.promise
    expect((await f.update('edit', origin('e'))).ok).toBe(true)
    finish.resolve(); expect((await slow).ok).toBe(false)
    expect(f.handle.agent.inbox.nextTurn[0].source.rpcId).toBe(origin('e'))
  })
  it('does not resurrect a message removed while authorization was in flight', async () => {
    const f = await fixture(), entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>()
    f.check.mockImplementationOnce(async () => { entered.resolve(); await finish.promise })
    const pending = f.update('edit'); await entered.promise; f.handle.agent.inbox.remove(f.item.id); finish.resolve()
    expect((await pending).ok).toBe(false); expect(f.handle.agent.inbox.nextTurn).toHaveLength(0)
  })
  it('aborts on owner disposal and denies retained old API references', async () => {
    const f = await fixture(), entered = Promise.withResolvers<AbortSignal>()
    f.check.mockImplementationOnce(async (_input: unknown, signal: AbortSignal) => { entered.resolve(signal); await new Promise(() => {}) })
    const pending = f.update('edit'), signal = await entered.promise
    await f.root.fiber.dispose(); expect((await pending).ok).toBe(false); expect(signal.aborted).toBe(true)
    expect((await f.update('edit')).ok).toBe(false)
  })
  it('times out a stalled checker without mutating a still-pending message', async () => {
    const f = await fixture()
    f.check.mockImplementation(async () => { await new Promise(() => {}) })
    const before = f.handle.agent.session.events.length
    expect((await f.update('edit')).ok).toBe(false)
    expect(f.handle.agent.session.events).toHaveLength(before); expect(f.handle.agent.inbox.nextTurn).toEqual([f.item])
  })
  it('retains the native provider config/injection and checks the actual provider generation', async () => {
    const f = await fixture(), managed = createManagedHarnessQueueApiProvider(f.check)
    expect(managed.Provider.Config).toBe(ApiProxyService.Config); expect(managed.Provider.inject).toBe(ApiProxyService.inject)
    const provider = new managed.Provider(f.root, {})
    expect(managed.owns(provider)).toBe(true); expect(managed.owns(f.native)).toBe(false)
    await f.root.fiber.dispose(); expect(managed.owns(provider)).toBe(false)
  })
})
