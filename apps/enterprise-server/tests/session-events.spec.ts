// @vitest-environment node
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { serveSessionEvents, sessionEventCursor, type EventSelection } from '../src/session-events.js'
import type { RuntimeGrant } from '../src/runtime-bindings.js'
import type { NativeSessionEventPage } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'

const grant: RuntimeGrant = { tenantId: 'tenant', userId: 'hansen', cellId: 'cell', role: 'member', revision: 'revision', origin: 'http://127.0.0.1:59999', validForMs: 10000, transport: 'private-cell' }
const event = (seq: number) => ({ seq, time: seq + 1, digest: Buffer.alloc(32, seq % 255).toString('base64url'), kind: 'session.checkpoint', data: {} })
function fixture() {
  const response = Object.assign(new EventEmitter(), { destroyed: false, writableLength: 0, headersSent: false,
    write: vi.fn((_frame: string) => true), end: vi.fn(), flushHeaders: vi.fn(), writeHead: vi.fn((_status: number, _headers: object) => { response.headersSent = true }) })
  const controller = new AbortController(), stop = vi.fn(), current = vi.fn(async () => {})
  let notify = () => {}, head = 0
  const open = vi.fn(async (callback: () => void) => { notify = callback; return stop })
  const read = vi.fn(async (selection: EventSelection): Promise<NativeSessionEventPage> => ({ sessionId: 'owned', afterSeq: selection.afterSeq,
    headSeq: head, hasMore: false, cursorMatched: true, events: Array.from({ length: Math.max(0, head - selection.afterSeq) }, (_, n) => event(selection.afterSeq + n + 1)) }))
  return { response, controller, stop, current, open, read, append: () => { head++; notify() },
    run: (cursor?: string) => serveSessionEvents({ response: response as unknown as ServerResponse, grant, sessionId: 'owned', signal: controller.signal,
      ...(cursor ? { cursor } : {}), current, open, read }) }
}

describe('HAAS-06 public cursor and streaming state machine; explicit response/read fixtures', () => {
  it('binds canonical cursors to tenant, user, stable cell and session, not replacement revision or origin', () => {
    const codec = sessionEventCursor(grant, 'owned'), selected = { afterSeq: 17, afterDigest: 'A'.repeat(43) }, cursor = codec.encode(selected)
    expect(codec.decode()).toEqual({ afterSeq: -1 }); expect(codec.decode(cursor)).toEqual(selected)
    expect(sessionEventCursor({ ...grant, revision: 'replacement', origin: 'http://127.0.0.1:60000' }, 'owned').decode(cursor)).toEqual(selected)
    for (const key of ['tenantId', 'userId', 'cellId'] as const) expect(() => sessionEventCursor({ ...grant, [key]: 'other' }, 'owned').decode(cursor)).toThrow()
    expect(() => sessionEventCursor(grant, 'other').decode(cursor)).toThrow()
    for (const invalid of ['', cursor + '=', 'e1.' + 'x'.repeat(255), cursor.replace('e1.', 'e2.'), 'e1.e30']) expect(() => codec.decode(invalid)).toThrow()
  })
  it('subscribes before snapshot, sends ordered cursors, reads only after wakeups and cleans up cancellation', async () => {
    const f = fixture(), running = f.run(), rejected = expect(running).rejects.toThrow()
    await vi.waitFor(() => expect(f.response.write).toHaveBeenCalledWith(': ready\n\n'))
    expect(f.open.mock.invocationCallOrder[0]).toBeLessThan(f.read.mock.invocationCallOrder[0]!)
    expect(f.read).toHaveBeenCalledOnce(); f.append()
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(f.response.write.mock.calls.filter(([frame]) => frame.startsWith('id:'))).toHaveLength(2))
    const frames = f.response.write.mock.calls.map(([frame]) => frame).filter(frame => frame.startsWith('id:'))
    expect(frames[0]).toContain('"seq":0'); expect(frames[1]).toContain('"seq":1')
    expect(frames.join('')).not.toContain('"digest"')
    const schema = JSON.parse(readFileSync(new URL('../../../docs/api/haas-v1.openapi.json', import.meta.url), 'utf8')).components.schemas.EventEnvelope
    for (const frame of frames) {
      const lines = frame.split('\n'), envelope = JSON.parse(lines.find(line => line.startsWith('data: '))!.slice(6))
      expect(envelope.id).toBe(lines[0]!.slice(4)); expect(envelope.type).toBe(lines[1]!.slice(7))
      for (const key of schema.required) expect(envelope).toHaveProperty(key)
      for (const key of Object.keys(envelope)) expect(schema.properties).toHaveProperty(key)
      expect(schema.properties.type.enum).toContain(envelope.type); expect(Number.isNaN(Date.parse(envelope.occurredAt))).toBe(false)
    }
    f.controller.abort(); await rejected; expect(f.stop).toHaveBeenCalledOnce()
    const cursor = frames[0]!.split('\n')[0]!.slice(4), second = fixture(), resumed = second.run(cursor), closed = expect(resumed).rejects.toThrow()
    await vi.waitFor(() => expect(second.response.write).toHaveBeenCalledWith(': ready\n\n'))
    expect(second.response.write.mock.calls.filter(([frame]) => frame.startsWith('id:'))).toHaveLength(0)
    second.controller.abort(); await closed
  })
  it('does not miss a notification delivered during the snapshot', async () => {
    const f = fixture(), initial = f.read.getMockImplementation()!
    f.read.mockImplementationOnce(async input => { const page = await initial(input); f.append(); return page })
    const running = f.run(), rejected = expect(running).rejects.toThrow()
    await vi.waitFor(() => expect(f.response.write.mock.calls.some(([frame]) => frame.includes('"seq":1'))).toBe(true))
    expect(f.read).toHaveBeenCalledTimes(2); f.controller.abort(); await rejected
  })
  it('refuses mismatched historical prefixes before headers and closes the original subscription', async () => {
    const f = fixture()
    f.read.mockResolvedValueOnce({ sessionId: 'owned', afterSeq: -1, headSeq: 0, events: [], cursorMatched: false, hasMore: false })
    await expect(f.run()).rejects.toMatchObject({ code: 'event-cursor-conflict' })
    expect(f.response.writeHead).not.toHaveBeenCalled(); expect(f.stop).toHaveBeenCalledOnce()
  })
  it('rejects current identity loss before emitting a page', async () => {
    const f = fixture(); f.current.mockRejectedValueOnce(Error('revoked'))
    await expect(f.run()).rejects.toThrow('revoked'); expect(f.response.write).not.toHaveBeenCalled(); expect(f.stop).toHaveBeenCalledOnce()
  })
  it('revalidates after backpressure drains and never sends a later event after revocation', async () => {
    const f = fixture(); f.response.write.mockReturnValueOnce(false)
    const running = f.run(), rejected = expect(running).rejects.toThrow('revoked')
    await vi.waitFor(() => expect(f.response.listenerCount('drain')).toBe(1))
    f.current.mockRejectedValueOnce(Error('revoked')); f.response.emit('drain'); await rejected
    expect(f.response.write).toHaveBeenCalledOnce(); expect(f.stop).toHaveBeenCalledOnce(); expect(f.response.listenerCount('drain')).toBe(0)
  })
  it('cancels blocked writes and removes drain listeners instead of retaining a queued stream', async () => {
    const f = fixture(); f.response.write.mockReturnValueOnce(false)
    const running = f.run(), rejected = expect(running).rejects.toThrow()
    await vi.waitFor(() => expect(f.response.listenerCount('drain')).toBe(1)); f.controller.abort(); await rejected
    expect(f.response.listenerCount('drain')).toBe(0); expect(f.stop).toHaveBeenCalledOnce()
  })
  it('bounds output and closes with reconnect without advancing the cursor for an unsent event', async () => {
    const f = fixture()
    f.read.mockImplementation(async input => ({ sessionId: 'owned', afterSeq: input.afterSeq, headSeq: 2200, cursorMatched: true, hasMore: true,
      events: Array.from({ length: 128 }, (_, n) => event(input.afterSeq + n + 1)) }))
    await f.run()
    const frames = f.response.write.mock.calls.map(([frame]) => frame)
    expect(frames.filter(frame => frame.startsWith('id:'))).toHaveLength(2048)
    expect(frames.at(-1)).toBe('event: stream.reconnect\ndata: {"reason":"batch-limit"}\n\n')
    expect(frames.at(-2)).toContain('"seq":2047'); expect(f.response.end).toHaveBeenCalledOnce(); expect(f.stop).toHaveBeenCalledOnce()
  })
})
