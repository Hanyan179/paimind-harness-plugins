// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { NativeGateway } from '../src/native-gateway.js'
import { authorizeNativeOperation } from '../src/native-operation-policy.js'
import { EnterpriseError } from '../src/errors.js'
import type { RuntimeGrant } from '../src/runtime-bindings.js'

const disposers: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const close of disposers.splice(0).reverse()) await close() })
async function listen(server: Server) {
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  disposers.push(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) })
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No test port')
  return `http://127.0.0.1:${address.port}`
}
async function fixture(role: 'admin' | 'member' = 'member') {
  const calls: string[] = [], checks: string[] = []
  let beforeReply = () => {}, active = true, auditFailure = false
  let status = 200, contentType = 'application/json', wrongId = false, extraHeaders: Record<string, string> = {}
  const value = { writable: true, hasDocument: true, namespaces: [{ ns: 'model-secret', schema: { secret: 'SCHEMA_SECRET' },
    value: { apiKey: 'PRIVATE_MODEL_SECRET' }, applies: 'live', secrets: [], revision: 1 }] }
  const upstream = await listen(createServer(async (request, response) => {
    let bytes = ''; for await (const chunk of request) bytes += chunk
    const call = JSON.parse(bytes); calls.push(call.method); beforeReply()
    response.writeHead(status, { 'content-type': contentType, ...extraHeaders })
    response.end(JSON.stringify({ type: 'server-response', rpcId: wrongId ? 'mismatch' : call.rpcId, result: { ok: true, value } }))
  }))
  let gateway: NativeGateway
  const origin = await listen(createServer((request, response) => {
    void gateway.http(request, response, randomUUID()).catch(error => {
      if (!response.destroyed) { response.statusCode = error instanceof EnterpriseError ? error.status : 500; response.end('request rejected') }
    })
  }))
  let grant: RuntimeGrant = { tenantId: randomUUID(), userId: randomUUID(), role, cellId: randomUUID(), revision: randomUUID(), origin: upstream, validForMs: 10000 }
  gateway = new NativeGateway({ publicOrigin: origin,
    resolve: async () => { if (!active) throw new EnterpriseError(401, 'session-invalid', 'expired'); return grant },
    authorize: async (_token, _id, current, request, verify) => { authorizeNativeOperation(current.role, request); await verify();
      checks.push(current.userId); if (auditFailure) throw new EnterpriseError(503, 'audit-unavailable', 'audit unavailable') },
  }); disposers.push(() => gateway.close())
  return { calls, checks, value,
    beforeReply: (callback: () => void) => { beforeReply = callback },
    expire: () => { active = false }, swap: () => { grant = { ...grant, userId: randomUUID(), revision: randomUUID() } },
    failAudit: () => { auditFailure = true },
    malformed: (kind: string) => { if (kind === 'id') wrongId = true; if (kind === 'status') status = 503;
      if (kind === 'mime') contentType = 'text/plain'; if (kind === 'encoding') extraHeaders = { 'content-encoding': 'gzip' } },
    read: async (method = 'settings.describe', payload = {}) => {
      const response = await fetch(origin + '/api/' + method, { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie: 'paimind_session=explicit-fixture' },
        body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }), signal: AbortSignal.timeout(5000) })
      return { status: response.status, body: await response.text() }
    },
  }
}
describe('member settings real HTTP carrier with explicit auth/source fixtures, not browser or database acceptance', () => {
  it('filters the original response and reauthorizes before releasing any content', async () => {
    const f = await fixture(), response = await f.read()
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body).result.value).toEqual({ writable: false, hasDocument: false, namespaces: [] })
    expect(response.body).not.toContain('SECRET'); expect(f.calls).toEqual(['settings.describe']); expect(f.checks).toHaveLength(2)
  })
  it('preserves the administrator original response', async () => {
    const f = await fixture('admin'), response = await f.read()
    expect(response.status).toBe(200); expect(JSON.parse(response.body).result.value).toEqual(f.value)
  })
  it.each(['expire', 'swap', 'failAudit'] as const)('never releases buffered settings after %s', async change => {
    const f = await fixture(); f.beforeReply(f[change]); const response = await f.read()
    expect(response.status).toBeGreaterThanOrEqual(400); expect(response.body).not.toContain('SECRET')
  })
  it.each(['id', 'status', 'mime', 'encoding'])('fails closed on malformed native %s', async kind => {
    const f = await fixture(); f.malformed(kind); const response = await f.read()
    expect(response.status).toBe(502); expect(response.body).not.toContain('SECRET')
  })
  it('does not forward a namespace selector or any member write', async () => {
    const f = await fixture()
    expect((await f.read('settings.describe', { ns: 'model-secret' })).status).toBe(403)
    expect((await f.read('settings.mutate', { ns: 'locale' })).status).toBe(403)
    expect(f.calls).toEqual([])
  })
})
