// @vitest-environment node
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createServer, request, type Server } from 'node:http'
import { connect } from 'node:net'
import WebSocket, { WebSocketServer } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { CellTransport } from '../src/cell-transport.js'
import { NativeGateway } from '../src/native-gateway.js'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'

// Real HTTP/TCP/WebSocket carriers with synthetic issuers/providers only.
// These tests do not admit a real member or replace native Browser E2E.
const disposers: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })
async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('Missing test listener')
  return `http://127.0.0.1:${address.port}`
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
async function fixture(label = 'member-cell') {
  const received: { url: string; headers: Record<string, unknown>; body: string }[] = []
  const native = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    received.push({ url: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString() })
    res.setHeader('content-type', 'text/plain'); res.end(label)
  })
  const ws = new WebSocketServer({ server: native })
  let frames = 0
  ws.on('connection', (socket, req) => {
    received.push({ url: req.url!, headers: req.headers, body: '' })
    socket.on('message', () => { frames += 1 }); socket.send(label)
  })
  const nativeOrigin = await listen(native)
  disposers.push(async () => { for (const socket of ws.clients) socket.terminate(); ws.close(); await close(native) })
  const token = randomBytes(32).toString('hex')
  const nativePort = Number(new URL(nativeOrigin).port)
  const ingress = createNativeIngress({ token, nativePort })
  const ingressOrigin = await listen(ingress.server)
  disposers.push(() => ingress.close())
  const transport = new CellTransport(ingressOrigin, token, nativePort)
  disposers.push(() => transport.destroy())
  return { token, native, nativeOrigin, nativePort, ingress, ingressOrigin, transport, received, frames: () => frames }
}
async function get(origin: string, agent?: CellTransport) {
  return new Promise<string>((resolve, reject) => {
    const req = request(origin, { agent: agent ?? false, headers: { connection: 'close' } }, async res => {
      try { const parts = []; for await (const part of res) parts.push(part); resolve(Buffer.concat(parts).toString()) } catch (error) { reject(error) }
    })
    req.on('error', reject); req.end()
  })
}
async function raw(origin: string, bytes: string) {
  const url = new URL(origin)
  const socket = connect(Number(url.port), url.hostname)
  const closed = once(socket, 'close')
  let output = ''; socket.on('data', bytes => { output += bytes.toString() }); socket.on('error', () => {})
  socket.end(bytes); await closed; return output
}

describe('private native cell transport (not member acceptance)', () => {
  it('forwards native HTTP bytes without leaking the transport key', async () => {
    const env = await fixture()
    expect(await get(env.nativeOrigin, env.transport)).toBe('member-cell')
    expect(env.received).toHaveLength(1)
    expect(env.received[0]!.headers['x-paimind-cell-token']).toBeUndefined()
    expect(JSON.stringify(env.received)).not.toContain(env.token)
  })
  it('drains a large native response before closing its private tunnel, including a slow consumer', async () => {
    const content = 'native-plugin-bundle\n'.repeat(500_000)
    const expected = createHash('sha256').update(content).digest('hex')
    const env = await fixture(content)
    const read = () => new Promise<{ bytes: number; digest: string; complete: boolean }>((resolve, reject) => {
      const req = request(env.nativeOrigin, { agent: env.transport, headers: { connection: 'close' } }, async res => {
        try {
          const hash = createHash('sha256'); let bytes = 0
          for await (const chunk of res) {
            bytes += chunk.length; hash.update(chunk)
            // Real TCP backpressure, not a mock stream or a larger timeout.
            await new Promise(done => setTimeout(done, 2))
          }
          resolve({ bytes, digest: hash.digest('hex'), complete: res.complete })
        } catch (error) { reject(error) }
      })
      req.once('error', reject); req.setTimeout(5000, () => req.destroy(Error('Slow response timed out'))); req.end()
    })
    expect(await read()).toEqual({ bytes: Buffer.byteLength(content), digest: expected, complete: true })
  })
  it('does not destroy pending downstream writes when native closes cleanly', async () => {
    const env = await fixture('complete native bundle')
    env.ingress.server.on('connect', (_request: unknown, socket: import('node:stream').Duplex) => {
      const write = socket._write
      // Deterministically delay real socket flushes, including the final body.
      // The old close handler discarded these queued bytes. This timing seam
      // is a transport regression, not a browser or actual-network acceptance.
      socket._write = (chunk, encoding, callback) => {
        setTimeout(() => write.call(socket, chunk, encoding, callback), 25)
      }
    })
    expect(await get(env.nativeOrigin, env.transport)).toBe('complete native bundle')
  })
  it('rejects missing/wrong/duplicate keys, public HTTP and arbitrary targets without contacting native', async () => {
    const env = await fixture()
    const valid = `x-paimind-cell-token: ${env.token}\r\n`
    for (const [method, target, headers, extra] of [
      ['CONNECT', `127.0.0.1:${env.nativePort}`, '', ''],
      ['CONNECT', `127.0.0.1:${env.nativePort}`, `x-paimind-cell-token: ${'a'.repeat(64)}\r\n`, ''],
      ['CONNECT', `127.0.0.1:${env.nativePort}`, valid + valid, ''],
      ['CONNECT', '127.0.0.1:3080', valid, ''],
      ['CONNECT', 'example.invalid:443', valid, ''],
      ['GET', '/', valid, ''],
      ['CONNECT', `127.0.0.1:${env.nativePort}`, valid, 'pipelined-native-bytes'],
    ]) {
      expect(await raw(env.ingressOrigin, `${method} ${target} HTTP/1.1\r\nHost: ingress\r\n${headers}\r\n${extra}`)).toContain(' 403 ')
    }
    expect(env.received).toHaveLength(0)
  })
  it('cannot use one cell key for a different cell or fall back to native after rejection', async () => {
    const a = await fixture('hansen-cell'); const b = await fixture('alex-cell')
    const wrong = new CellTransport(b.ingressOrigin, a.token, b.nativePort)
    disposers.push(() => wrong.destroy())
    await expect(get(b.nativeOrigin, wrong)).rejects.toThrow('Private cell transport unavailable')
    expect(b.received).toHaveLength(0)
    expect(await get(a.nativeOrigin, a.transport)).toBe('hansen-cell')
    expect(await get(b.nativeOrigin, b.transport)).toBe('alex-cell')
    expect(a.received).toHaveLength(1); expect(b.received).toHaveLength(1)
  })
  it('rejects a caller-selected destination even with a valid transport', async () => {
    const env = await fixture()
    await expect(get('http://127.0.0.1:3080/', env.transport)).rejects.toThrow('Private cell transport unavailable')
    expect(env.received).toHaveLength(0)
  })
  it('rejects an operator map that would route a binding through another cell transport', async () => {
    const a = await fixture(); const b = await fixture()
    expect(() => new NativeGateway({ publicOrigin: 'http://127.0.0.1:62000',
      transports: new Map([[a.ingressOrigin, b.transport]]),
      resolve: async () => { throw Error('Must not resolve') }, authorize: async () => {},
    })).toThrow('Private cell transport destination does not match its binding key')
    expect(a.received).toHaveLength(0); expect(b.received).toHaveLength(0)
  })
  it('fails closed when native is stopped, and when its transport is destroyed', async () => {
    const env = await fixture()
    await close(env.native)
    await expect(get(env.nativeOrigin, env.transport)).rejects.toThrow('Private cell transport unavailable')
    env.transport.destroy()
    await expect(get(env.nativeOrigin, env.transport)).rejects.toThrow('Private cell transport unavailable')
  })
  it('carries WebSocket without leaking the key and joins upgraded sockets on shutdown', async () => {
    const env = await fixture()
    const client = new WebSocket(env.nativeOrigin.replace('http:', 'ws:') + '/api/events.host', { agent: env.transport, perMessageDeflate: false })
    client.on('error', () => {}); disposers.push(() => client.terminate())
    expect(String((await once(client, 'message'))[0])).toBe('member-cell')
    expect(env.received[0]!.headers['x-paimind-cell-token']).toBeUndefined()
    const closed = once(client, 'close')
    env.transport.destroy(); await closed
    await env.ingress.close()
  })
  it('retains gateway cookie stripping, native origin, event rules and revocation through the tunnel', async () => {
    const env = await fixture()
    const server = createServer((req, res) => { void gateway.http(req, res, 'test').catch(() => { res.writeHead(503); res.end() }) })
    const publicOrigin = await listen(server)
    let active = true
    const gateway = new NativeGateway({ publicOrigin, revalidateMs: 20,
      transports: new Map([[env.ingressOrigin, env.transport]]),
      resolve: async token => {
        if (!active || token !== 'synthetic-session') throw Error('Revoked')
        return { cellId: 'synthetic-cell', tenantId: 'synthetic-tenant', userId: 'synthetic-user', role: 'member',
          revision: 'synthetic-revision', origin: env.ingressOrigin, validForMs: 10_000, transport: 'private-cell' }
      }, authorize: async () => {} })
    gateway.attach(server)
    disposers.push(async () => { gateway.close(); await close(server) })
    const response = await fetch(publicOrigin, { headers: { cookie: 'paimind_haas_session=synthetic-session' } })
    expect(await response.text()).toBe('member-cell')
    expect(env.received[0]!.headers.cookie).toBeUndefined()
    expect(env.received[0]!.headers.origin).toBe(env.nativeOrigin)
    const client = new WebSocket(publicOrigin.replace('http:', 'ws:') + '/api/events.host', {
      headers: { origin: publicOrigin, cookie: 'paimind_haas_session=synthetic-session' }, perMessageDeflate: false })
    client.on('error', () => {}); disposers.push(() => client.terminate())
    expect(String((await once(client, 'message'))[0])).toBe('member-cell')
    expect(env.received[1]!.headers.cookie).toBeUndefined()
    expect(env.received[1]!.headers.origin).toBe(env.nativeOrigin)
    const closed = once(client, 'close'); active = false; await closed
    expect(env.frames()).toBe(0)
    expect((await fetch(publicOrigin, { headers: { cookie: 'paimind_haas_session=synthetic-session' } })).status).toBe(503)
    expect(env.received).toHaveLength(2)
  })
})
