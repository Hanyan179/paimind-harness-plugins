import { describe, expect, it } from 'vitest'
import { createHarnessSessionInspection, decodeHarnessSessionInspection } from '../src/gateway-transport.js'
const reply = (value: unknown, rpcId = 'inspection') => JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } })
const sessions = { kind: 'sessions' } as const
const history = { kind: 'history', sessionId: 'hansen-session' } as const
describe('native readonly session inspection codec, not authorization', () => {
  it('has exactly two fixed readonly paths with bounded backward history selection', () => {
    expect(JSON.parse(createHarnessSessionInspection(sessions, 'inspection').body).payload).toEqual({})
    const read = createHarnessSessionInspection({ ...history, beforeSeq: 42 }, 'inspection')
    expect(read.path).toBe('/api/session.history')
    expect(JSON.parse(read.body)).toMatchObject({ method: 'session.history', payload: { sessionId: 'hansen-session', beforeSeq: 42, maxMessages: 20 } })
    for (const input of [{ kind: 'prompt' }, { ...sessions, userId: 'alex' }, { ...history, url: 'http://elsewhere' },
      { ...history, beforeSeq: 0 }, { ...history, beforeSeq: 2.5 }, { ...history, beforeSeq: Number.MAX_SAFE_INTEGER + 1 }, { ...history, sessionId: '\n' }]) {
      expect(() => createHarnessSessionInspection(input as never, 'inspection')).toThrow()
    }
  })
  it('uses the original schema and exposes selected list metadata without paths or other projections', () => {
    const value = { items: [{ sessionId: 'hansen-session', updatedAt: 123, running: false, blank: false, agentPreset: 'hansen-support', cwd: '/private/home',
      projections: { asOfSeq: 2, values: { title: '客户跟进', credentials: 'not-for-review', todos: ['private'] } } }] }
    expect(decodeHarnessSessionInspection(reply(value), 'inspection', sessions)).toEqual({ kind: 'sessions', items: [{
      sessionId: 'hansen-session', title: '客户跟进', updatedAt: 123, running: false, blank: false, presetId: 'hansen-support' }] })
    for (const broken of [{}, { items: [{}] }, { items: Array(501).fill(value.items[0]) }, { items: [value.items[0], value.items[0]] }]) {
      expect(() => decodeHarnessSessionInspection(reply(broken), 'inspection', sessions)).toThrow()
    }
    expect(() => decodeHarnessSessionInspection(reply(value, 'foreign'), 'inspection', sessions)).toThrow()
  })
  it('projects inert user/assistant text without hidden reasoning, source tickets or tool data', () => {
    const event = (seq: number, type: string, data: unknown) => ({ event: { seq, time: 123, type, data } })
    const value = { hasMore: true, events: [
      event(3, 'user/message', { source: { kind: 'user', rpcId: 'secret-source' }, content: [{ type: 'text', text: '<script>inert</script>' }, { type: 'image', data: 'private-bytes' }] }),
      event(4, 'assistant/message', { message: { content: [{ type: 'thinking', text: 'hidden-reasoning' }, { type: 'text', text: '可见回复' }] } }),
      event(5, 'tool/result', { secret: 'private-tool-output' }),
    ] }
    expect(decodeHarnessSessionInspection(reply(value), 'inspection', { ...history, beforeSeq: 6 })).toEqual({ kind: 'history', sessionId: 'hansen-session', nextBeforeSeq: 3, messages: [
      { seq: 3, time: 123, role: 'user', text: '<script>inert</script>', omittedBlocks: 1 },
      { seq: 4, time: 123, role: 'assistant', text: '可见回复', omittedBlocks: 1 },
    ] })
    for (const events of [[value.events[1], value.events[0]], [value.events[0], value.events[0]], [event(6, 'turn/end', {})]]) {
      expect(() => decodeHarnessSessionInspection(reply({ hasMore: false, events }), 'inspection', { ...history, beforeSeq: 6 })).toThrow()
    }
  })
  it('accepts a real empty page but rejects missing, malformed or non-progressing history', () => {
    expect(decodeHarnessSessionInspection(reply({ events: [], hasMore: false }), 'inspection', history)).toMatchObject({ messages: [], nextBeforeSeq: null })
    for (const value of [{ events: [] }, { hasMore: true, events: [] }, { hasMore: true, events: [{ event: { type: 'turn/start', seq: 0, time: 0, data: {} } }] },
      { hasMore: false, events: [{ event: { type: 'user/message', seq: 1, time: 0, data: {} } }] }]) {
      expect(() => decodeHarnessSessionInspection(reply(value), 'inspection', history)).toThrow()
    }
  })
})
