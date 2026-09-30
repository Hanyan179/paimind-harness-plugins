// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeGateway } from '../src/native-gateway.js'
import type { RuntimeGrant } from '../src/runtime-bindings.js'

const disposers: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  vi.restoreAllMocks()
})
async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Isolated port required')
  disposers.push(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  return `http://127.0.0.1:${address.port}`
}

/** Real local HTTP sockets, synthetic identity and producer. Only the 60-second
 * total request timer is scaled; admission, lease and provider-stall timers run
 * normally. This is transport regression evidence, not real Browser E2E. */
async function fixture(options: { contentType?: string; status?: number; encoding?: string; disposition?: string;
  sendHeaders?: boolean; validForMs?: number; revalidateMs?: number } = {}) {
  const originalTimeout = globalThis.setTimeout
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler, ms, ...args) =>
    originalTimeout(handler, ms === 60_000 ? 200 : ms, ...args)) as typeof setTimeout)
  let producerResponse: ServerResponse | undefined
  const upstream = createServer((_request, response) => {
    producerResponse = response
    if (options.sendHeaders === false) return
    response.statusCode = options.status ?? 200
    response.setHeader('content-type', options.contentType ?? 'text/event-stream; charset=utf-8')
    if (options.encoding) response.setHeader('content-encoding', options.encoding)
    if (options.disposition) response.setHeader('content-disposition', options.disposition)
    response.write('data: initial\n\n')
  })
  const origin = await listen(upstream)
  let gateway!: NativeGateway
  const frontend = createServer((request, response) => {
    void gateway.http(request, response, randomUUID()).catch(() => {
      if (response.headersSent) response.destroy()
      else { response.statusCode = 502; response.end() }
    })
  })
  const publicOrigin = await listen(frontend)
  const grant: RuntimeGrant = { cellId: 'synthetic-cell', tenantId: 'synthetic-tenant', userId: 'synthetic-admin',
    role: 'admin', revision: 'original', origin, validForMs: options.validForMs ?? 10_000 }
  const resolve = vi.fn(async () => ({ ...grant }))
  const authorize = vi.fn(async () => {})
  const failures: { requestId: string; phase: string; code?: string }[] = []
  gateway = new NativeGateway({ publicOrigin, resolve, authorize, revalidateMs: options.revalidateMs ?? 30,
    onTransportFailure: event => failures.push(event) })
  disposers.push(() => gateway.close())
  async function connect(target = '/plugins/events') {
    let response: IncomingMessage | undefined, closed = false
    const chunks: string[] = []
    const received = new Promise<IncomingMessage>((accept, reject) => {
      const outbound = httpRequest(publicOrigin + target, { headers: { origin: publicOrigin } }, incoming => {
        response = incoming
        incoming.on('data', bytes => chunks.push(bytes.toString('utf8')))
        incoming.on('error', () => {})
        incoming.once('close', () => { closed = true })
        accept(incoming)
      })
      outbound.on('error', reject)
      disposers.push(() => { response?.destroy(); outbound.destroy() })
      outbound.end()
    })
    await received
    return { chunks, closed: () => closed, close: () => response?.destroy(), status: response?.statusCode }
  }
  return { connect, resolve, authorize, grant, failures, gateway, emit: () => producerResponse!.write('data: later\n\n') }
}

describe('native plugin SSE lifetime with continuous authority', () => {
  it('keeps a canonical successful event stream past the ordinary deadline, then closes on revocation', async () => {
    const test = await fixture()
    const stream = await test.connect()
    await delay(350)
    expect(stream.closed()).toBe(false)
    test.emit()
    await vi.waitFor(() => expect(stream.chunks.join('')).toContain('data: later'))
    expect(test.resolve.mock.calls.length).toBeGreaterThan(5)
    expect(test.authorize).toHaveBeenCalledOnce()
    expect(test.failures).toEqual([])
    test.resolve.mockRejectedValue(new Error('Synthetic login revoked'))
    await vi.waitFor(() => expect(stream.closed()).toBe(true))
    expect(test.failures.map(event => event.phase)).toEqual(['lease'])
  })
  it.each([
    { target: '/plugins/events?alias=1' },
    { target: '/plugins/events/' },
    { target: '/plugins/example.js' },
    { contentType: 'application/json' },
    { status: 403 },
    { encoding: 'gzip' },
    { disposition: 'attachment' },
  ])('retains the finite deadline for noncanonical or non-event responses: %j', async options => {
    const test = await fixture(options)
    const stream = await test.connect('target' in options ? options.target : undefined)
    await vi.waitFor(() => expect(stream.closed()).toBe(true))
    expect(test.failures.map(event => event.phase)).toEqual(['deadline'])
  })
  it('retains the upstream header deadline before an event stream is established', async () => {
    const test = await fixture({ sendHeaders: false })
    const stream = await test.connect()
    expect(stream.status).toBe(502)
    expect(test.failures.map(event => event.phase)).toEqual(['deadline'])
  })
  it('closes on an independent lease expiry before the next revalidation', async () => {
    const test = await fixture({ validForMs: 100, revalidateMs: 2_000 })
    const stream = await test.connect()
    await vi.waitFor(() => expect(stream.closed()).toBe(true))
    expect(test.failures.map(event => event.phase)).toEqual(['lease'])
  })
  it('closes when the identity provider stalls rather than trusting its last success indefinitely', async () => {
    const test = await fixture()
    const stream = await test.connect()
    test.resolve.mockImplementation(() => new Promise<RuntimeGrant>(() => {}))
    await vi.waitFor(() => expect(stream.closed()).toBe(true))
    expect(test.failures.map(event => event.phase)).toEqual(['lease'])
  })
  it('closes on a binding replacement even if the same member remains signed in', async () => {
    const test = await fixture()
    const stream = await test.connect()
    test.grant.revision = 'replacement'
    await vi.waitFor(() => expect(stream.closed()).toBe(true))
    expect(test.failures.map(event => event.phase)).toEqual(['lease'])
  })
  it('cleans up the watcher when the browser closes its connection', async () => {
    const test = await fixture()
    const stream = await test.connect()
    stream.close()
    await vi.waitFor(() => expect(test.failures.map(event => event.phase)).toEqual(['client-closed']))
    const calls = test.resolve.mock.calls.length
    await delay(120)
    expect(test.resolve.mock.calls.length).toBe(calls)
  })
  it('closes established event streams when the gateway shuts down', async () => {
    const test = await fixture()
    const stream = await test.connect()
    test.gateway.close()
    await vi.waitFor(() => expect(stream.closed()).toBe(true))
    expect(test.failures.map(event => event.phase)).toEqual(['lease'])
  })
})
