import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TRACE_DOCUMENT_PATH, apply } from '../src/index.ts'

describe('presentation trace V2 sidecar Host route', () => {
  it('returns only a Session-contained v3 document with matching bytes and SHA-256', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paimind-trace-'))
    const body = `${JSON.stringify({ schemaVersion: 'paimind.presentation-trace/v3', reviewStatus: 'generated', sources: [], slides: [] })}\n`
    const path = join(root, 'deck.trace.json')
    await writeFile(path, body)
    const digest = createHash('sha256').update(body).digest('hex')
    let handler: any
    const unregister = vi.fn()
    let dispose = (): void => {}
    apply({ webServer: { register: vi.fn(route => { handler = route.handler; return unregister }) }, sessions: { get: id => id === 'session-1' ? { header: { cwd: root } } : undefined }, effect: install => { dispose = (install() ?? (() => {})) as () => void } })
    const chunks: unknown[] = []; let status = 0
    await handler({ method: 'GET', url: `${TRACE_DOCUMENT_PATH}?sessionId=session-1&path=deck.trace.json&schema=paimind.presentation-trace%2Fv3&sha256=${digest}&bytes=${Buffer.byteLength(body)}`, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' } }, { writeHead: (value: number) => { status = value }, end: (value: unknown) => { chunks.push(value) } })
    expect(status).toBe(200)
    expect(Buffer.concat(chunks.map(value => Buffer.isBuffer(value) ? value : Buffer.from(String(value)))).toString()).toBe(body)
    dispose(); expect(unregister).toHaveBeenCalledOnce()
  })

  it('fails closed when the declared hash is wrong', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paimind-trace-'))
    const body = '{"schemaVersion":"paimind.presentation-trace/v3"}'
    await writeFile(join(root, 'deck.trace.json'), body)
    let handler: any; apply({ webServer: { register: route => { handler = route.handler; return () => {} } }, sessions: { get: () => ({ header: { cwd: root } }) }, effect: install => { install() } })
    let status = 0
    await handler({ method: 'GET', url: `${TRACE_DOCUMENT_PATH}?sessionId=session-1&path=deck.trace.json&schema=paimind.presentation-trace%2Fv3&sha256=${'a'.repeat(64)}&bytes=${Buffer.byteLength(body)}`, headers: { host: '127.0.0.1:3080' } }, { writeHead: (value: number) => { status = value }, end: () => {} })
    expect(status).toBe(409)
  })
})
