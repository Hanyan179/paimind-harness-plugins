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
  let beforeReply = () => {}, active = true, auditFailure = false, status = 200, contentType = 'application/json'
  let extraHeaders: Record<string, string> = {}, malformed = false
  const value = { value: { defaultWidthPercent: 42, tabsEnabled: { terminal: false }, browserNoSandbox: false,
    terminalShellArgs: 'PRIVATE_ARGS', pluginSettings: { thirdParty: { apiKey: 'PRIVATE_KEY' } } }, revision: 3, externalDisable: true }
  const upstream = await listen(createServer(async (request, response) => {
    let bytes = ''; for await (const chunk of request) bytes += chunk
    expect(JSON.parse(bytes)).toEqual({}); calls.push(request.url!); beforeReply()
    response.writeHead(status, { 'content-type': contentType, ...extraHeaders })
    response.end(JSON.stringify(malformed ? { private: 'PRIVATE_SHAPE' } : { ok: true,
      value: request.url === '/sidebar/api/shell.get' ? { shell: '/bin/bash', name: 'bash' } : value }))
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
    authorize: async (_token, _id, current, request, verify) => { authorizeNativeOperation(current.role, request); await verify(); checks.push(current.userId);
      if (auditFailure) throw new EnterpriseError(503, 'audit-unavailable', 'audit unavailable') },
  }); disposers.push(() => gateway.close())
  return { calls, checks, value, beforeReply: (callback: () => void) => { beforeReply = callback },
    expire: () => { active = false }, swap: () => { grant = { ...grant, userId: randomUUID(), revision: randomUUID() } },
    failAudit: () => { auditFailure = true },
    malformed: (kind: string) => { if (kind === 'shape') malformed = true; if (kind === 'status') status = 503;
      if (kind === 'mime') contentType = 'text/plain'; if (kind === 'encoding') extraHeaders = { 'content-encoding': 'gzip' } },
    read: async (path = '/sidebar/api/settings.get', body: unknown = {}) => {
      const response = await fetch(origin + path, { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie: 'paimind_session=explicit-fixture' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
      return { status: response.status, body: await response.text() }
    },
  }
}
describe('actual HTTP presentation projection, explicit identity/provider fixtures, not PG/Worker/Browser E2E', () => {
  it('preserves member display values and shell names without releasing open settings or parameters', async () => {
    const f = await fixture(), response = await f.read()
    expect(response.status).toBe(200); expect(JSON.parse(response.body)).toEqual({ ok: true, value: { value: { defaultWidthPercent: 42,
      tabsEnabled: { terminal: false }, browserNoSandbox: false }, revision: 3, externalDisable: true } })
    expect(response.body).not.toContain('PRIVATE'); expect(f.checks).toHaveLength(2)
    const shell = await f.read('/sidebar/api/shell.get'); expect(shell.status).toBe(200)
    expect(JSON.parse(shell.body)).toEqual({ ok: true, value: { shell: '/bin/bash', name: 'bash' } }); expect(f.checks).toHaveLength(4)
  })
  it('does not alter the original administrator settings response', async () => {
    const f = await fixture('admin'), response = await f.read(); expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true, value: f.value })
  })
  it.each(['expire', 'swap', 'failAudit'] as const)('does not release settings after %s during provider IO', async change => {
    const f = await fixture(); f.beforeReply(f[change]); const response = await f.read()
    expect(response.status).toBeGreaterThanOrEqual(400); expect(response.body).not.toContain('PRIVATE'); expect(response.body).not.toContain('defaultWidthPercent')
  })
  it.each(['shape', 'status', 'mime', 'encoding'])('rejects malformed %s rather than reporting fake defaults', async kind => {
    const f = await fixture(); f.malformed(kind); const response = await f.read()
    expect(response.status).toBe(502); expect(response.body).not.toContain('PRIVATE')
  })
  it('does not forward selectors, writes, terminal calls or unsafe member display modes', async () => {
    const f = await fixture()
    for (const input of [{ userId: 'alex' }, { sessionId: 'foreign' }, { cwd: '/private' }, { patch: {} }]) expect((await f.read(undefined, input)).status).toBe(400)
    for (const path of ['/sidebar/api/settings.update', '/sidebar/api/pty.open', '/sidebar/api/shell.execute']) expect((await f.read(path)).status).toBeGreaterThanOrEqual(400)
    expect(f.calls).toEqual([])
    f.value.value.browserNoSandbox = true
    expect((await f.read()).status).toBe(502)
  })
})
