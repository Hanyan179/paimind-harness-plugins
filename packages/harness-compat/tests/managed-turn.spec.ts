// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { guardManagedHarnessTurnApi, decodeNativeTurnSelection, encodeNativeTurnSelection, nativeTurnContentDigest, projectNativeTurnState, readNativeTurnState, readNativeTurnReceipt } from '../src/managed-queue.js'

const local = createRequire(import.meta.url)
const web = createRequire(createRequire(local.resolve('@deepseek-ai/dsh/package.json')).resolve('@deepseek-ai/dsh-web-app/package.json'))
const { Context } = web('@deepseek-ai/cordis'), { AgentLoop } = web('@deepseek-ai/dsh-agent-loop')
const { AgentRegistry } = web('@deepseek-ai/dsh-agent'), { SessionStore } = web('@deepseek-ai/dsh-session')
const { LlmRuntime, LlmAdapter, createUserMessage } = web('@deepseek-ai/dsh-llm'), { ToolRuntime } = web('@deepseek-ai/dsh-tools')
const { SystemPrompt } = web('@deepseek-ai/dsh-system-prompt'), { JsonlSessionPersistence } = web('@deepseek-ai/dsh-session-persistence-jsonl')
const { createApiProxy } = web('@deepseek-ai/dsh-host-apiproxy')
const { TypertRegistry } = web('@deepseek-ai/dsh-typert-registry')
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const source = (sessionId: string, clientRpcId: string) => 'paimind-origin-v1.'
  + Buffer.from(JSON.stringify({ nativeSessionId: sessionId, clientRpcId })).toString('base64url') + '.' + 'A'.repeat(43)
const signal = () => new AbortController().signal

async function fixture(existingFolder?: string, writeBatchMaxDelayMs = 200) {
  const root = new Context(), folder = existingFolder ?? await mkdtemp(join(tmpdir(), 'paimind-native-turn-'))
  const sessionId = 'hansen-versioned-turn'
  cleanups.push(() => root.fiber.dispose())
  for (const [plugin, settings] of [[TypertRegistry], [SessionStore], [AgentRegistry], [SystemPrompt, {}], [LlmRuntime], [ToolRuntime, {}],
    [JsonlSessionPersistence, { root: folder, compression: 'none', writeBatchMaxDelayMs }]]) await root.plugin(plugin, settings)
  await root.plugin(AgentLoop, { agents: [] }); root.provide('userQuestions', { registerProvider: () => () => {} })
  root.llm.registerAdapter(['fixture'], new class extends LlmAdapter {
    async *generate() { throw Error('No model execution is allowed in this diagnostic') }
  }())
  root.on('agent/pre-step', () => ({ kind: 'reject' })) // No model or external credential is involved.
  const handle = existingFolder ? undefined : await root.agents.create({ sessionId, meta: { agentPreset: 'standard', cwd: folder } })
  const agent = handle?.agent, native = createApiProxy(root, { defaultModelSelection: () => ({ provider: 'fixture', model: 'never-called' }) })
  const check = vi.fn(async (..._args: unknown[]) => {})
  const sessions = guardManagedHarnessTurnApi(root, native.sessions, check)
  const selection = async (text = '核对 Hansen 的报价') => ({ commandId: randomUUID(),
    expectedVersion: (await readNativeTurnState(root, sessionId, undefined, signal())).version, contentDigest: nativeTurnContentDigest(text) })
  const request = (selected: Awaited<ReturnType<typeof selection>>, text = '核对 Hansen 的报价') => ({ rpcId: source(sessionId, encodeNativeTurnSelection(selected)),
    payload: { sessionId, mode: 'queue', content: [{ type: 'text', text }] } })
  const submit = async (selected: Awaited<ReturnType<typeof selection>>, text?: string) => sessions.prompt(request(selected, text) as never)
  const insertions = () => (agent ?? root.agents.get(sessionId)).session.events.filter((event: any) => event.type === 'agent/inbox/spliced').flatMap((event: any) => event.data.inserted)
  return { root, folder, sessionId, agent, native, check, sessions, selection, request, submit, insertions }
}

describe('versioned carrier through real native prompt/inbox/persistence; synthetic authority only', () => {
  it('resumes one exact cold native owner for concurrent new submissions without recreating history', async () => {
    const first = await fixture()
    expect((await first.submit(await first.selection())).result.ok).toBe(true); await first.agent.whenIdle()
    await first.root.sessions.flush(first.agent.session); await first.root.fiber.dispose()
    const f = await fixture(first.folder), selected = await f.selection()
    const before = await f.root.sessionPersistence.inspect(f.sessionId)
    expect(f.root.agents.get(f.sessionId)).toBeUndefined()
    const resume = vi.spyOn(f.root.agents, 'resume'), create = vi.spyOn(f.root.agents, 'create')
    const replies = await Promise.all(Array.from({ length: 5 }, () => f.submit(selected)))
    expect(replies.every(reply => reply.result.ok)).toBe(true)
    expect(resume).toHaveBeenCalledTimes(1); expect(create).not.toHaveBeenCalled()
    const current = f.root.agents.get(f.sessionId)
    expect(current.id).toBe(f.sessionId)
    expect(current.session.events.slice(0, before.events.length)).toEqual(before.events)
    expect(f.insertions()).toHaveLength(2)
    expect(f.check.mock.calls.some(([request]: any[]) => request.action === 'resume')).toBe(true)
    expect((await readNativeTurnReceipt(f.root, f.sessionId, selected, signal())).persisted).toBe(true)
  })
  it('does not hydrate a cold owner when the current login or version is rejected', async () => {
    const first = await fixture()
    expect((await first.submit(await first.selection())).result.ok).toBe(true); await first.agent.whenIdle()
    await first.root.sessions.flush(first.agent.session); await first.root.fiber.dispose()
    const f = await fixture(first.folder), selected = await f.selection(), resume = vi.spyOn(f.root.agents, 'resume')
    expect((await f.submit({ ...selected, expectedVersion: 'A'.repeat(43) })).result.ok).toBe(false)
    f.check.mockRejectedValue(Error('Explicit revoked current login'))
    expect((await f.submit(selected)).result.ok).toBe(false)
    expect(resume).not.toHaveBeenCalled(); expect(f.root.agents.get(f.sessionId)).toBeUndefined()
  })
  it('reauthorizes the hydrated scope and never inserts when composition authority was revoked', async () => {
    const first = await fixture()
    expect((await first.submit(await first.selection())).result.ok).toBe(true); await first.agent.whenIdle()
    await first.root.sessions.flush(first.agent.session); await first.root.fiber.dispose()
    const f = await fixture(first.folder), selected = await f.selection()
    f.check.mockImplementation(async (...args: any[]) => {
      if (args[0].action === 'submit') throw Error('Explicit composition revoked during hydration')
    })
    expect((await f.submit(selected)).result.ok).toBe(false)
    expect(f.root.agents.get(f.sessionId)?.id).toBe(f.sessionId)
    expect(f.insertions()).toHaveLength(1)
  })
  it.each(['another-message', 'another-seed'])('does not rebase a cold submission over %s during hydration', async mutation => {
    const first = await fixture()
    expect((await first.submit(await first.selection())).result.ok).toBe(true); await first.agent.whenIdle()
    await first.root.sessions.flush(first.agent.session); await first.root.fiber.dispose()
    const f = await fixture(first.folder), selected = await f.selection()
    f.check.mockImplementation(async (...args: any[]) => {
      if (args[0].action !== 'submit') return
      const agent = f.root.agents.get(f.sessionId)
      if (mutation === 'another-seed') agent.session.append('session/end-seed', {})
      else agent.send(createUserMessage({ source: { kind: 'user', rpcId: 'concurrent-native-user' },
        content: [{ type: 'text', text: 'Concurrent native message must remain untouched' }] }), 'next-turn', false)
    })
    expect((await f.submit(selected)).result.ok).toBe(false)
    expect((await readNativeTurnState(f.root, f.sessionId, selected, signal())).accepted).toBeNull()
    expect(f.insertions()).toHaveLength(mutation === 'another-message' ? 2 : 1)
  })
  it('does not confuse the actual live inspect view with stored bytes while the original writer is batching', async () => {
    const f = await fixture(undefined, 60000)
    expect((await f.submit(await f.selection())).result.ok).toBe(true)
    await f.agent.whenIdle()
    const selected = await f.selection()
    await f.root.sessions.flush(f.agent.session)
    const before = await f.root.sessionPersistence.readRaw(f.sessionId)
    const message = createUserMessage({ source: { kind: 'user', rpcId: f.request(selected).rpcId },
      content: [{ type: 'text', text: '核对 Hansen 的报价' }] })
    f.agent.send(message, 'next-turn', false)
    const inspected = await f.root.sessionPersistence.inspect(f.sessionId)
    expect(projectNativeTurnState({ id: f.sessionId, header: inspected.meta, events: inspected.events }, selected).accepted?.messageId).toBe(message.id)
    const stored = await f.root.sessionPersistence.readFrom(f.sessionId, 0, signal())
    expect(projectNativeTurnState({ id: f.sessionId, header: stored.meta, events: stored.events }, selected).accepted).toBeNull()
    const flush = vi.spyOn(f.root.sessions, 'flush')
    try {
      expect(await readNativeTurnReceipt(f.root, f.sessionId, selected, signal())).toMatchObject({ persisted: false, accepted: { messageId: message.id } })
      expect(flush).not.toHaveBeenCalled()
      expect((await f.root.sessionPersistence.readRaw(f.sessionId)).content).toBe(before.content)
    } finally { flush.mockRestore() }
    await f.root.sessions.flush(f.agent.session)
    expect((await readNativeTurnReceipt(f.root, f.sessionId, selected, signal())).persisted).toBe(true)
  })
  it('never treats a live insertion as durable without the original stored proof and does not flush to manufacture it', async () => {
    const f = await fixture(), selected = await f.selection()
    await f.root.sessions.flush(f.agent.session)
    const storedBefore = await f.root.sessionPersistence.inspect(f.agent.id)
    f.agent.send(createUserMessage({ source: { kind: 'user', rpcId: f.request(selected).rpcId },
      content: [{ type: 'text', text: '核对 Hansen 的报价' }] }), 'next-turn', false)
    const storedRead = vi.spyOn(f.root.sessionPersistence, 'readFrom').mockResolvedValue(storedBefore)
    const flush = vi.spyOn(f.root.sessions, 'flush')
    const pending = await readNativeTurnReceipt(f.root, f.agent.id, selected, signal())
    expect(pending.accepted).not.toBeNull(); expect(pending.persisted).toBe(false)
    expect(flush).not.toHaveBeenCalled()
    storedRead.mockRejectedValueOnce(Error('Explicit unreadable persistence'))
    await expect(readNativeTurnReceipt(f.root, f.agent.id, selected, signal())).rejects.toThrow()
    storedRead.mockRestore(); flush.mockRestore()
    await f.root.sessions.flush(f.agent.session)
    const confirmed = await readNativeTurnReceipt(f.root, f.agent.id, selected, signal())
    expect(confirmed).toMatchObject({ persisted: true, accepted: pending.accepted })
    expect(f.insertions()).toHaveLength(1)
  })
  it('continues an unchanged pending original message once without adding another insertion', async () => {
    const f = await fixture(), selected = await f.selection()
    f.agent.send(createUserMessage({ source: { kind: 'user', rpcId: f.request(selected).rpcId },
      content: [{ type: 'text', text: '核对 Hansen 的报价' }] }), 'next-turn', false)
    await f.root.sessions.flush(f.agent.session)
    expect((await readNativeTurnReceipt(f.root, f.sessionId, selected, signal()))).toMatchObject({ pending: true, persisted: true })
    const replies = await Promise.all(Array.from({ length: 5 }, () => f.submit(selected)))
    expect(replies.some(reply => reply.result.ok)).toBe(true)
    await f.agent.whenIdle()
    expect(f.insertions()).toHaveLength(1)
    expect(f.agent.session.events.filter((event: any) => event.type === 'turn/start')).toHaveLength(1)
    expect((await readNativeTurnState(f.root, f.sessionId, selected, signal())).pending).toBe(false)
    const before = JSON.stringify(f.agent.session.events)
    expect((await f.submit(selected)).result.ok).toBe(true)
    expect(JSON.stringify(f.agent.session.events)).toBe(before)
  })
  it('does not wake queued work when its original login is rejected even if the retry login is valid', async () => {
    const f = await fixture(), selected = await f.selection(), originalSource = f.request(selected).rpcId
    f.agent.send(createUserMessage({ source: { kind: 'user', rpcId: originalSource },
      content: [{ type: 'text', text: '核对 Hansen 的报价' }] }), 'next-turn', false)
    await f.root.sessions.flush(f.agent.session)
    const retrySource = originalSource.replace(/A{43}$/u, 'B'.repeat(43))
    f.check.mockImplementation(async (...args: any[]) => {
      if (args[0].sources.includes(originalSource)) throw Error('Explicit old login revoked')
    })
    expect((await f.sessions.prompt({ ...f.request(selected), rpcId: retrySource } as never)).result.ok).toBe(false)
    expect(f.agent.session.events.filter((event: any) => event.type === 'turn/start')).toHaveLength(0)
    expect((await readNativeTurnState(f.root, f.sessionId, selected, signal())).pending).toBe(true)
    expect(f.insertions()).toHaveLength(1)
  })
  it('five simultaneous exact requests publish one original native message and replay the same evidence', async () => {
    const f = await fixture(), selected = await f.selection(), original = f.agent.followup
    const replies = await Promise.all(Array.from({ length: 5 }, () => f.submit(selected)))
    expect(replies.every(reply => reply.result.ok)).toBe(true)
    expect(f.insertions()).toHaveLength(1)
    expect((await readNativeTurnState(f.root, f.agent.id, selected, signal())).accepted?.messageId).toBe(f.insertions()[0].id)
    expect(f.check).toHaveBeenCalledTimes(5)
    expect(f.agent.followup).toBe(original); expect(Object.hasOwn(f.agent, 'followup')).toBe(false)
  })
  it('different commands racing with the same expected native version cannot both insert', async () => {
    const f = await fixture(), first = await f.selection(), second = { ...first, commandId: randomUUID() }
    const replies = await Promise.all([f.submit(first), f.submit(second)])
    expect(replies.filter(reply => reply.result.ok)).toHaveLength(1); expect(f.insertions()).toHaveLength(1)
  })
  it('rejects the same command with changed content and preserves original history', async () => {
    const f = await fixture(), selected = await f.selection()
    expect((await f.submit(selected)).result.ok).toBe(true); await f.agent.whenIdle()
    const before = JSON.stringify(f.agent.session.events)
    const changed = { ...selected, contentDigest: nativeTurnContentDigest('不同正文') }
    expect((await f.submit(changed, '不同正文')).result.ok).toBe(false)
    expect(JSON.stringify(f.agent.session.events)).toBe(before)
  })
  it('reauthorizes historical replay and never requeues consumed or canceled work', async () => {
    const f = await fixture(), selected = await f.selection()
    expect((await f.submit(selected)).result.ok).toBe(true); await f.agent.whenIdle()
    const before = JSON.stringify(f.agent.session.events)
    expect((await f.submit(selected)).result.ok).toBe(true)
    f.check.mockRejectedValue(Error('private authority rejected'))
    const reply = await f.submit(selected)
    expect(reply.result.ok).toBe(false); expect(JSON.stringify(reply)).not.toContain('private authority rejected')
    expect(JSON.stringify(f.agent.session.events)).toBe(before); expect(f.insertions()).toHaveLength(1)
  })
  it('checks again at the actual write after native asynchronous preparation', async () => {
    const f = await fixture(), selected = await f.selection(), held = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
    const delayed = guardManagedHarnessTurnApi(f.root, { ...f.native.sessions, async prompt(request: any) {
      entered.resolve(); await held.promise; return f.native.sessions.prompt(request)
    } }, f.check)
    const pending = delayed.prompt(f.request(selected) as never); await entered.promise
    expect((await f.native.sessions.prompt({ rpcId: 'ordinary-native-request', payload: { sessionId: f.agent.id,
      mode: 'queue', content: [{ type: 'text', text: '普通用户同时提交' }] } })).result.ok).toBe(true)
    held.resolve(); expect((await pending).result.ok).toBe(false)
    expect(f.insertions()).toHaveLength(1); expect(f.insertions()[0].source.rpcId).toBe('ordinary-native-request')
    expect(Object.hasOwn(f.agent, 'followup')).toBe(false)
  })
  it.each(['remove', 'edit'])('does not undo a later native queue %s when the original submission is replayed', async kind => {
    const f = await fixture(), selected = await f.selection()
    const message = createUserMessage({ source: { kind: 'user', rpcId: f.request(selected).rpcId },
      content: [{ type: 'text', text: '核对 Hansen 的报价' }] })
    f.agent.send(message, 'next-turn', false)
    if (kind === 'remove') f.agent.inbox.remove(message.id)
    else f.agent.inbox.replace(message.id, { ...message, source: { kind: 'user', rpcId: 'later-native-editor' },
      content: [{ type: 'text', text: '原生队列中保留的最新编辑' }] })
    await f.root.sessions.flush(f.agent.session)
    const before = JSON.stringify(f.agent.session.events), queued = [...f.agent.inbox.nextTurn]
    expect((await f.submit(selected)).result.ok).toBe(true)
    expect(JSON.stringify(f.agent.session.events)).toBe(before); expect(f.agent.inbox.nextTurn).toEqual(queued)
  })
  it('denies an unsigned reserved correlation and unknown native session without publication', async () => {
    const f = await fixture(), selected = await f.selection(), request = f.request(selected)
    expect((await f.sessions.prompt({ ...request, rpcId: encodeNativeTurnSelection(selected) } as never)).result.ok).toBe(false)
    expect((await f.sessions.prompt({ ...request, rpcId: source('alex-private', encodeNativeTurnSelection(selected)),
      payload: { ...request.payload, sessionId: 'alex-private' } } as never)).result.ok).toBe(false)
    expect(f.insertions()).toHaveLength(0); expect(f.root.agents.get('alex-private')).toBeUndefined()
  })
  it('retains the rejecting fence after disposal until a delayed native call settles', async () => {
    const f = await fixture(), selected = await f.selection(), held = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
    const child = f.root.extend(), delayed = guardManagedHarnessTurnApi(child, { ...f.native.sessions, async prompt(request: any) {
      entered.resolve(); await held.promise; return f.native.sessions.prompt(request)
    } }, f.check)
    const pending = delayed.prompt(f.request(selected) as never); await entered.promise
    // Same owning context; explicit shutdown interrupts before the delayed
    // original prompt can reach its synchronous inbox boundary.
    await f.root.fiber.dispose(); held.resolve()
    expect((await pending).result.ok).toBe(false); expect(f.insertions()).toHaveLength(0)
    expect(Object.hasOwn(f.agent, 'followup')).toBe(false)
  })
  it('does not acknowledge an in-memory insertion when its native checkpoint fails', async () => {
    const f = await fixture(), selected = await f.selection(), flush = vi.spyOn(f.root.sessions, 'flush').mockRejectedValue(Error('private disk failure'))
    expect((await f.submit(selected)).result.ok).toBe(false)
    expect(f.insertions()).toHaveLength(1)
    flush.mockRestore()
    expect((await f.submit(selected)).result.ok).toBe(true); expect(f.insertions()).toHaveLength(1)
  })
  it('reads the same durable submission after native owner restart without activating or rewriting it', async () => {
    const f = await fixture(), selected = await f.selection()
    expect((await f.submit(selected)).result.ok).toBe(true); await f.agent.whenIdle(); await f.root.sessions.flush(f.agent.session)
    const before = await f.root.get('sessionPersistence').readRaw(f.agent.id)
    const expected = await readNativeTurnState(f.root, f.agent.id, selected, signal())
    await f.root.fiber.dispose()
    const second = new Context(); cleanups.push(() => second.fiber.dispose())
    await second.plugin(SessionStore); await second.plugin(JsonlSessionPersistence, { root: f.folder, compression: 'none' })
    const actual = await readNativeTurnState(second, f.agent.id, selected, signal())
    expect(actual).toEqual(expected); expect(second.sessions.get(f.agent.id)).toBeUndefined()
    const unexpectedWrite = vi.fn(async () => { throw Error('Cold acknowledged replay must not invoke a native prompt') })
    const cold = guardManagedHarnessTurnApi(second, { prompt: unexpectedWrite } as never, f.check)
    expect((await cold.prompt(f.request(selected) as never)).result.ok).toBe(true)
    expect(unexpectedWrite).not.toHaveBeenCalled(); expect(second.sessions.get(f.agent.id)).toBeUndefined()
    expect((await second.get('sessionPersistence').readRaw(f.agent.id)).content).toBe(before.content)
  })
  it('leaves ordinary unreserved prompt behavior and messages unchanged', async () => {
    const f = await fixture(), request = { rpcId: 'ordinary-request', payload: { sessionId: f.agent.id,
      mode: 'queue', content: [{ type: 'text', text: '普通会话' }] } }
    expect((await f.sessions.prompt(request as never)).result.ok).toBe(true)
    expect(f.insertions()[0].source.rpcId).toBe('ordinary-request'); expect(f.check).not.toHaveBeenCalled()
  })
  it('does not recover an inherited seed message as a new pending original turn', async () => {
    const f = await fixture(), selected = await f.selection(), marker = encodeNativeTurnSelection(selected)
    const message = createUserMessage({ source: { kind: 'user', rpcId: source(f.agent.id, marker) }, content: [{ type: 'text', text: '核对 Hansen 的报价' }] })
    const reference = { id: f.agent.id, header: { id: f.agent.id, agentPreset: 'standard', seedLength: 0 }, events: [
      { seq: 0, type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 0, inserted: [message] } },
    ] }
    expect(projectNativeTurnState(reference, selected).pending).toBe(true)
    reference.header.seedLength = 1
    expect(projectNativeTurnState(reference, selected)).toMatchObject({ pending: false, accepted: { messageId: message.id } })
  })
  it('rejects malformed, noncanonical and conflicting projection evidence', async () => {
    const f = await fixture(), selected = await f.selection(), marker = encodeNativeTurnSelection(selected)
    expect(decodeNativeTurnSelection(marker)).toEqual(selected)
    expect(() => decodeNativeTurnSelection('haas-turn-v1.invalid')).toThrow()
    expect((await f.submit({ ...selected, expectedVersion: 'A'.repeat(43) })).result.ok).toBe(false)
    const message = createUserMessage({ source: { kind: 'user', rpcId: source(f.agent.id, marker) }, content: [{ type: 'text', text: '核对 Hansen 的报价' }] })
    const reference = { id: f.agent.id, header: { id: f.agent.id, agentPreset: 'standard' }, events: [
      { seq: 0, type: 'agent/inbox/spliced', data: { inserted: [message] } },
      { seq: 1, type: 'agent/inbox/spliced', data: { inserted: [{ ...message, id: 'another-native-message' }] } },
    ] }
    expect(() => projectNativeTurnState(reference, selected)).toThrow('conflicts')
    expect(() => projectNativeTurnState({ ...reference, events: [{ ...reference.events[0], seq: 1 }] })).toThrow('contiguous')
    expect(projectNativeTurnState({ ...reference, id: 'child', header: { ...reference.header, id: 'child' } }, selected).accepted).toBeNull()
  })
})
