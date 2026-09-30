import { createHash } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { RuntimeGrant } from './runtime-bindings.js'
import type { NativeSessionEventPage } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { EnterpriseError } from './errors.js'

export interface EventSelection { afterSeq: number; afterDigest?: string }
const invalid = () => new EnterpriseError(409, 'event-cursor-conflict', '事件游标不属于当前范围或原历史已变化；请明确重新读取')
/** Cursor is a scoped original-log position, never authentication or a grant.
 * Every request independently admits the current identity and native owner. */
export function sessionEventCursor(grant: RuntimeGrant, sessionId: string) {
  const scope = createHash('sha256').update(JSON.stringify([grant.tenantId, grant.userId, grant.cellId, sessionId])).digest('base64url')
  const encode = (selection: EventSelection) => 'e1.' + Buffer.from(JSON.stringify({ o: scope, s: selection.afterSeq, d: selection.afterDigest })).toString('base64url')
  return { encode, decode(cursor?: string): EventSelection {
    if (cursor === undefined) return { afterSeq: -1 }
    if (typeof cursor !== 'string' || cursor.length > 256 || !/^e1\.[A-Za-z0-9_-]+$/u.test(cursor)) throw invalid()
    try {
      const value = JSON.parse(Buffer.from(cursor.slice(3), 'base64url').toString('utf8'))
      if (!value || Object.keys(value).sort().join(',') !== 'd,o,s' || value.o !== scope || !Number.isSafeInteger(value.s) || value.s < 0
        || typeof value.d !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value.d)
        || Buffer.from(value.d, 'base64url').toString('base64url') !== value.d) throw invalid()
      const selection = { afterSeq: value.s, afterDigest: value.d }
      if (encode(selection) !== cursor) throw invalid()
      return selection
    } catch { throw invalid() }
  } }
}

export async function serveSessionEvents(options: {
  response: ServerResponse; grant: RuntimeGrant; sessionId: string; cursor?: string; signal: AbortSignal
  read(selection: EventSelection): Promise<NativeSessionEventPage>
  current(): Promise<void>
  open(notify: () => void): Promise<() => void>
}) {
  const { response, signal } = options, codec = sessionEventCursor(options.grant, options.sessionId)
  let selection = codec.decode(options.cursor), generation = 0, wake: (() => void) | undefined
  const notify = () => { generation++; wake?.() }
  const stop = await options.open(notify) // Subscribe before the first snapshot; no replay/live gap.
  let count = 0, bytes = 0
  const write = async (frame: string) => {
    signal.throwIfAborted()
    if (response.destroyed || response.writableLength > 256 * 1024) throw Error('Event consumer closed or too slow')
    if (!response.write(frame)) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { response.off('drain', drained); signal.removeEventListener('abort', failed) }
        const drained = () => { cleanup(); resolve() }, failed = () => { cleanup(); reject(Error('Event consumer canceled')) }
        response.once('drain', drained); signal.addEventListener('abort', failed, { once: true }); if (signal.aborted) failed()
      })
      await options.current(); signal.throwIfAborted()
    }
  }
  try {
    while (!signal.aborted) {
      const observed = generation, page = await options.read(selection)
      if (!page.cursorMatched) throw invalid()
      await options.current(); signal.throwIfAborted()
      if (!response.headersSent) { response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' }); response.flushHeaders() }
      for (const event of page.events) {
        const next = { afterSeq: event.seq, afterDigest: event.digest }
        const id = codec.encode(next)
        const type = event.kind === 'assistant.message' ? 'turn.delta' : event.kind === 'turn.ended'
          ? event.data.reason === 'completed' ? 'turn.completed' : event.data.reason === 'error' ? 'turn.failed' : 'turn.delta' : event.kind
        const envelope = { id, sessionId: options.sessionId, type, occurredAt: new Date(event.time).toISOString(),
          ...(typeof event.data.turn === 'number' ? { turnId: 'native-turn-' + event.data.turn } : {}),
          data: { seq: event.seq, kind: event.kind, ...event.data } }
        const frame = 'id: ' + id + '\nevent: ' + type + '\ndata: ' + JSON.stringify(envelope) + '\n\n'
        if (count >= 2048 || bytes + Buffer.byteLength(frame) > 2 * 1024 * 1024) {
          await write('event: stream.reconnect\ndata: {"reason":"batch-limit"}\n\n'); response.end(); return
        }
        await write(frame); selection = next; count++; bytes += Buffer.byteLength(frame)
      }
      if (page.hasMore || generation !== observed) continue
      await write(': ready\n\n')
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { wake = undefined; signal.removeEventListener('abort', abort) }
        const changed = () => { cleanup(); resolve() }, abort = () => { cleanup(); reject(Error('Event stream closed')) }
        wake = changed; signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort(); else if (generation !== observed) changed()
      })
    }
  } finally { wake = undefined; stop() }
}
