// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { readPaimindNativeSessionEventPage as read, readPaimindNativeSessionReference } from '../src/host.js'
import { decodeHarnessSessionEventWakeup as wakeup } from '../src/gateway-transport.js'

const signal = () => new AbortController().signal
const event = (seq: number, type = 'private/config', data: object = { secret: 'PRIVATE' }) => ({ seq, time: seq + 1, type, data })
function fixture(events: object[], seedLength = 0, cold = false) {
  const session = { header: { id: 'owned', agentPreset: 'standard', seedLength }, events }
  const inspect = vi.fn(async () => ({ meta: session.header, events: session.events }))
  return { session, inspect, context: { sessions: { get: () => cold ? undefined : session }, get: () => ({ inspect }) } }
}
const selection = (value: { seq: number; digest: string }) => ({ afterSeq: value.seq, afterDigest: value.digest })

describe('HAAS-06 bounded original log projection, not browser acceptance', () => {
  it('continues exact sequences across live and cold reads without publishing or writing a session', async () => {
    const events = Array.from({ length: 260 }, (_, n) => event(n)), warm = fixture(events), cold = fixture(events, 0, true)
    const first = await read(warm.context, 'owned', { afterSeq: -1 }, signal())
    expect(first).toMatchObject({ headSeq: 259, hasMore: true, cursorMatched: true }); expect(first.events).toHaveLength(128)
    const next = await read(cold.context, 'owned', selection(first.events.at(-1)!), signal())
    expect(next.events.map(e => e.seq)).toEqual(Array.from({ length: 128 }, (_, n) => n + 128))
    const last = await read(cold.context, 'owned', selection(next.events.at(-1)!), signal())
    expect(last.events.map(e => e.seq)).toEqual([256, 257, 258, 259]); expect(last.hasMore).toBe(false)
    expect(await read(cold.context, 'owned', selection(last.events.at(-1)!), signal())).toMatchObject({ events: [], hasMore: false, cursorMatched: true })
    expect(warm.inspect).not.toHaveBeenCalled(); expect(cold.inspect).toHaveBeenCalledTimes(3)
    expect(cold.session.events).toEqual(events); expect(cold.context.sessions.get()).toBeUndefined()
  })
  it('rejects changed prefixes, truncated histories and changed seed boundaries without resetting or skipping', async () => {
    const f = fixture([event(0), event(1), event(2)])
    const first = await read(f.context, 'owned', { afterSeq: -1 }, signal()), cursor = selection(first.events[1]!)
    f.session.events[0] = event(0, 'private/config', { changed: true })
    expect(await read(f.context, 'owned', cursor, signal())).toMatchObject({ cursorMatched: false, events: [], hasMore: false })
    f.session.events[0] = event(0); f.session.header.seedLength = 1
    expect((await read(f.context, 'owned', cursor, signal())).cursorMatched).toBe(false)
    f.session.header.seedLength = 0; f.session.events.length = 1
    expect((await read(f.context, 'owned', cursor, signal())).cursorMatched).toBe(false)
  })
  it('preserves native seed boundaries in both references and rejects invalid boundaries', async () => {
    for (const cold of [false, true]) {
      const f = fixture([event(0), event(1)], 1, cold)
      expect((await readPaimindNativeSessionReference(f.context, 'owned')).header.seedLength).toBe(1)
      for (const value of [-1, 0.5, 3, NaN]) {
        f.session.header.seedLength = value
        await expect(readPaimindNativeSessionReference(f.context, 'owned')).rejects.toThrow('种子边界')
      }
    }
  })
  it('projects public text and lifecycle only, never internal sources, hidden blocks, reasoning, tool arguments or results', async () => {
    const source = { kind: 'user', rpcId: 'PRIVATE' }
    const f = fixture([
      event(0, 'user/message', { source, content: [{ type: 'text', text: '你好 Hansen' }, { type: 'image', url: 'PRIVATE' }] }),
      event(1, 'assistant/message', { message: { source: { kind: 'model', request: 'PRIVATE' }, content: [
        { type: 'text', text: 'Hello Alex' }, { type: 'reasoning', text: 'PRIVATE' }, { type: 'text', text: 'PRIVATE', hidden: true }] } }),
      event(2, 'user/message', { source, hidden: true, content: [{ type: 'text', text: 'PRIVATE' }] }),
      event(3, 'turn/start', { turn: 1, trigger: { token: 'PRIVATE' } }), event(4, 'step/start', { turn: 1, step: 1 }),
      event(5, 'tool/call', { callId: 'call', name: 'search', arguments: { token: 'PRIVATE' } }),
      event(6, 'tool/result', { message: { callId: 'call', isError: false, content: 'PRIVATE' } }),
      event(7, 'step/end', { turn: 1, step: 1 }), event(8, 'turn/end', { turn: 1, reason: { kind: 'completed', extra: 'PRIVATE' } }),
      event(9, 'agent/inbox/spliced', { inserted: ['PRIVATE'] }), event(10),
    ])
    const page = await read(f.context, 'owned', { afterSeq: -1 }, signal())
    expect(page.events.map(e => e.kind)).toEqual(['user.message', 'assistant.message', 'session.checkpoint', 'turn.started', 'step.started', 'tool.started', 'tool.ended', 'step.ended', 'turn.ended', 'queue.changed', 'session.checkpoint'])
    expect(page.events[0]!.data).toEqual({ text: '你好 Hansen', omittedBlocks: 1 })
    expect(page.events[1]!.data).toEqual({ text: 'Hello Alex', omittedBlocks: 2 })
    expect(JSON.stringify(page)).not.toContain('PRIVATE')
  })
  it('fails closed on invalid cursors, malformed ordering, oversized history or events, and cancellation', async () => {
    const f = fixture([event(0)])
    for (const input of [{ afterSeq: -2 }, { afterSeq: 0 }, { afterSeq: -1, afterDigest: 'A'.repeat(43) }, { afterSeq: 0, afterDigest: 'B'.repeat(43) }]) {
      await expect(read(f.context, 'owned', input, signal())).rejects.toThrow('游标格式')
    }
    await expect(read(f.context, 'owned', { afterSeq: -1 }, AbortSignal.abort())).rejects.toThrow()
    f.session.events[0] = event(2)
    await expect(read(f.context, 'owned', { afterSeq: -1 }, signal())).rejects.toThrow('顺序')
    f.session.events = Array.from({ length: 10001 }, (_, n) => event(n))
    await expect(read(f.context, 'owned', { afterSeq: -1 }, signal())).rejects.toThrow('界限')
    f.session.events = [event(0, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'x'.repeat(128 * 1024) }] })]
    await expect(read(f.context, 'owned', { afterSeq: -1 }, signal())).rejects.toThrow('单个')
  })
})

describe('original native mux wakeup decoding', () => {
  const frame = (method: string, payload: object) => Buffer.from(JSON.stringify({ type: 'server-request', rpcId: 'private', method, payload: { type: method, ...payload } }))
  it('reads complete native text frames while ignoring other sessions and never forwarding payloads', () => {
    expect(wakeup('owned', frame('session/event', { sessionId: 'foreign', event: { seq: 0 } }))).toBe(false)
    expect(wakeup('owned', frame('session/subscribed', { sessionId: 'owned', note: '你好' }))).toBe(true)
    expect(wakeup('owned', frame('session/event', { sessionId: 'owned', event: { seq: 1, secret: 'PRIVATE' } }))).toBe(true)
  })
  it('rejects errors, malformed sequences, invalid encodings, truncated frames and unbounded frames', () => {
    for (const bytes of [frame('stream/error', {}), frame('session/event', { sessionId: 'owned', event: { seq: -1 } }),
      Buffer.from('{}'), Buffer.from('{'), Buffer.from([255]), Buffer.from('x'.repeat(512 * 1024 + 1))]) {
      expect(() => wakeup('owned', bytes)).toThrow()
    }
  })
})
