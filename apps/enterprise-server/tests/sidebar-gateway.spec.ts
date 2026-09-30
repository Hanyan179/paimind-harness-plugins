// @vitest-environment node
import { createServer, type Server } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { NativeGateway } from '../src/native-gateway.js'

// Real socket fault tests with a synthetic issuer/provider, not member admission.
const disposers: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })
async function listen(server: Server) {
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('No test port')
  return `http://127.0.0.1:${address.port}`
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) }
async function fixture(mode: 'wrong-correlation' | 'oversized' | 'stall' | 'omitted-resource-check') {
  let reads = 0, upstreamSockets = 0
  const upstream = createServer(async (request, response) => {
    reads++
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const call = JSON.parse(Buffer.concat(chunks).toString()) as { rpcId: string }
    response.setHeader('content-type', 'application/json')
    if (mode === 'stall') return
    response.end(mode === 'oversized' ? ' '.repeat(1024 * 1024 + 1) : JSON.stringify({ type: 'server-response',
      rpcId: mode === 'wrong-correlation' ? 'foreign-correlation' : call.rpcId, result: { ok: true, value: { events: [], hasMore: false } } }))
  })
  const ws = new WebSocketServer({ server: upstream })
  ws.on('connection', socket => { upstreamSockets++; socket.send('must not escape') })
  const origin = await listen(upstream)
  disposers.push(async () => { for (const socket of ws.clients) socket.terminate(); ws.close(); await close(upstream) })
  const server = createServer((_request, response) => { response.writeHead(404); response.end() })
  const publicOrigin = await listen(server)
  const gateway = new NativeGateway({ publicOrigin,
    resolve: async () => ({ cellId: 'test-cell', tenantId: 'test-tenant', userId: 'test-member', role: 'member',
      revision: 'stable', origin, validForMs: mode === 'stall' ? 200 : 5_000 }),
    authorize: async (_token, _id, _grant, _request, verify) => { if (mode !== 'omitted-resource-check') await verify() } })
  gateway.attach(server)
  disposers.push(async () => { gateway.close(); await close(server) })
  return { publicOrigin, reads: () => reads, upstreamSockets: () => upstreamSockets }
}
describe('session-addressed push readback failures stay closed', () => {
  it.each(['wrong-correlation', 'oversized', 'stall', 'omitted-resource-check'] as const)(
    'rejects %s before connecting any provider push stream', async mode => {
      const env = await fixture(mode)
      const client = new WebSocket(env.publicOrigin.replace('http:', 'ws:') + '/sidebar/ws/agent-opens?sessionId=session-hansen', {
        headers: { origin: env.publicOrigin, cookie: 'paimind_haas_session=synthetic-session' },
      })
      disposers.push(() => client.terminate()); client.on('error', () => {})
      const status = await new Promise<number>((done, reject) => {
        client.once('open', () => reject(Error('Unexpected authorized browser stream')))
        client.once('unexpected-response', (_request, response) => { response.resume(); client.terminate(); done(response.statusCode!) })
      })
      expect(status).toBe(502)
      expect(env.reads()).toBe(mode === 'omitted-resource-check' ? 0 : 1)
      expect(env.upstreamSockets()).toBe(0)
    })
})
