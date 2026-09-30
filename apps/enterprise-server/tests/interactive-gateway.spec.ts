// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { NativeGateway } from '../src/native-gateway.js'
import { EnterpriseError } from '../src/errors.js'
import type { RuntimeGrant } from '../src/runtime-bindings.js'

const servers: Server[] = [], gateways: NativeGateway[] = []
afterEach(async () => {
  for (const gateway of gateways.splice(0)) gateway.close()
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) }
})
async function listen(server: Server) {
  servers.push(server); await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No port')
  return `http://127.0.0.1:${address.port}`
}
async function fixture(mode = 'valid') {
  const calls: { headers: unknown; body: any }[] = []
  let grant: RuntimeGrant, source = 'server-signed-fixture-origin'
  const upstream = await listen(createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk
    const body = JSON.parse(text); calls.push({ headers: req.headers, body })
    if (mode === 'response-swap') grant = { ...grant, revision: randomUUID() }
    res.setHeader('content-type', mode === 'html' ? 'text/html' : 'application/json')
    if (mode === 'encoding') res.setHeader('content-encoding', 'gzip')
    if (mode === 'disposition') res.setHeader('content-disposition', 'attachment')
    res.end(mode === 'oversize' ? 'x'.repeat(262145) : mode === 'malformed' ? '{' : JSON.stringify({
      type: 'server-response', rpcId: mode === 'uncorrelated' ? 'wrong' : body.rpcId, result: { ok: true, value: { accepted: true } },
    }))
  }))
  let gateway: NativeGateway
  const correlations: string[] = []
  const origin = await listen(createServer((req, res) => {
    void gateway.http(req, res, randomUUID()).catch(error => { if (!res.destroyed) { res.statusCode = error instanceof EnterpriseError ? error.status : 500; res.end() } })
  }))
  grant = { cellId: randomUUID(), userId: randomUUID(), tenantId: 'fixture', role: 'admin', revision: randomUUID(), origin: upstream, validForMs: mode === 'stalled' ? 30 : 10000 }
  const options = { publicOrigin: origin, resolve: async () => grant, authorize: async () => {},
    ...(mode === 'missing' ? {} : { sealInteractiveOrigin: async (_token: unknown, _requestId: unknown, _scope: unknown, clientRpcId: string) => {
      correlations.push(clientRpcId)
      if (mode === 'seal-swap') grant = { ...grant, revision: randomUUID() }
      if (mode === 'reject') throw new EnterpriseError(401, 'unauthenticated', 'Expired')
      if (mode === 'stalled') await new Promise(() => {})
      return source
    } }) }
  gateway = new NativeGateway(options); gateways.push(gateway)
  const request = (path = '/api/session.prompt') => fetch(origin + path, { method: 'POST', headers: {
    'content-type': 'application/json', origin, cookie: 'paimind_haas_session=private-fixture-cookie',
  }, body: JSON.stringify({ type: 'client-request', method: 'session.prompt', rpcId: 'caller-id',
    payload: { sessionId: 'session-hansen', mode: 'queue', content: [{ type: 'text', text: 'Hello' }] } }) })
  return { calls, request, source, correlations }
}
describe('interactive gateway carrier with explicit HTTP fixtures, not browser acceptance', () => {
  it('seals native request source and restores caller correlation without leaking cookie', async () => {
    const f = await fixture(), response = await f.request()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ rpcId: 'caller-id', result: { ok: true } })
    expect(f.calls[0].body.rpcId).toBe(f.source)
    expect(f.correlations).toEqual(['caller-id'])
    expect(JSON.stringify(f.calls)).not.toContain('private-fixture-cookie')
  })
  it.each(['missing', 'reject', 'seal-swap', 'stalled'])('never dispatches with %s source authority', async mode => {
    const f = await fixture(mode)
    expect((await f.request()).status).toBe(mode === 'missing' ? 503 : mode === 'reject' ? 401 : 502)
    expect(f.calls).toHaveLength(0)
  })
  it.each(['uncorrelated', 'html', 'encoding', 'disposition', 'oversize', 'malformed', 'response-swap'])('rejects %s response instead of exposing stamped correlation', async mode => {
    const f = await fixture(mode)
    expect((await f.request()).status).toBe(502)
    expect(f.calls).toHaveLength(1)
  })
  it('rejects query aliases even for administrator requests', async () => {
    const f = await fixture()
    expect((await f.request('/api/session.prompt?alias=1')).status).toBe(400)
    expect(f.calls).toHaveLength(0)
  })
})
