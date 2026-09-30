// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { createConnection } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeControlBroker, createNativeControlPeer, handleNativeControl } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { CellTransport } from '../src/cell-transport.js'
import { NativeGateway } from '../src/native-gateway.js'
import { EnterpriseError } from '../src/errors.js'
import { authorizeNativeOperation } from '../src/native-operation-policy.js'
import type { RuntimeGrant } from '../src/runtime-bindings.js'
import { commandInvocationBinding, COMMAND_BINDING_HEADER, COMMAND_ORIGIN_HEADER } from '../../../packages/harness-compat/src/command-execution.js'
const disposers: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const close of disposers.splice(0).reverse()) await close() })
async function listen(server: Server) {
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No test port')
  return `http://127.0.0.1:${address.port}`
}
async function fixture(role: 'admin' | 'member' = 'member', execution = false) {
  let beforeReply = () => {}, preset: string | null = 'hansen-personal', allowed = true, active = true, failAudit = false, omitCheck = false
  let status = 200, mime = 'application/json', headers: Record<string, string> = {}, corrupt = false, refuse = false
  let afterEligibility = () => {}, beforeSeal = () => {}
  const calls: unknown[] = [], audits: string[] = [], refs: string[] = []
  const forwarded: Record<string, unknown>[] = [], seals: unknown[] = []
  const source = 'paimind-origin-v1.c3ludGhldGlj.' + 'h'.repeat(43)
  const nativeResult = { commandId: 'cmd-native-1', result: { kind: 'success', text: 'Session log download requested.' } }
  const descriptors = [{ name: 'scope-z', description: 'Original scoped description', input: { hint: '素材', images: true } }, { name: 'global-a', description: '' }]
  const upstream = createServer(async (request, response) => {
    let body = ''; for await (const bytes of request) body += bytes
    const requestBody = JSON.parse(body)
    calls.push(requestBody); forwarded.push({ ...request.headers }); beforeReply()
    response.writeHead(status, { 'content-type': mime, ...headers })
    response.end(JSON.stringify({ type: 'server-response', rpcId: corrupt ? 'other-request' : requestBody.rpcId, result: refuse
      ? { ok: false, error: { code: 'command-error', message: 'Original owner failure', details: {} } }
      : { ok: true, value: execution ? nativeResult : descriptors } }))
  })
  const nativeOrigin = await listen(upstream)
  disposers.push(async () => { upstream.closeAllConnections(); await new Promise<void>(done => upstream.close(() => done())) })
  const broker = await createNativeControlBroker(); disposers.push(() => broker.close())
  const peer = createNativeControlPeer(createConnection(broker.path), { handle: (operation, input, signal) =>
    handleNativeControl({ get: () => ({ read: async (sessionId: string) => {
      refs.push(sessionId); if (sessionId !== 'hansen-session') throw Error('Unknown session in this cell')
      return { sessionId, agentPreset: preset, hasForkBoundary: true }
    } }) }, operation, input, signal) })
  disposers.push(() => peer.close()); await vi.waitFor(() => expect(broker.ready).toBe(true))
  const key = randomBytes(32).toString('hex'), port = Number(new URL(nativeOrigin).port)
  const ingress = createNativeIngress({ token: key, nativePort: port, control: (operation, input, signal) => broker.request(operation, input, signal) })
  const privateOrigin = await listen(ingress.server); disposers.push(() => ingress.close())
  const transport = new CellTransport(privateOrigin, key, port); disposers.push(() => transport.destroy())
  let grant: RuntimeGrant = { cellId: randomUUID(), tenantId: 'command-gate-fixture', userId: randomUUID(), role, revision: randomUUID(),
    origin: privateOrigin, validForMs: 10000, transport: 'private-cell' }
  let gateway: NativeGateway
  const server = createServer((request, response) => { void gateway.http(request, response, randomUUID()).catch(error => {
    if (!response.destroyed) { response.statusCode = error instanceof EnterpriseError ? error.status : 500; response.end(error instanceof EnterpriseError ? error.code : 'failure') }
  }) })
  const origin = await listen(server)
  disposers.push(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) })
  gateway = new NativeGateway({ publicOrigin: origin, transports: new Map([[privateOrigin, transport]]),
    sealInteractiveOrigin: async (_token, _id, scope, rpcId) => { seals.push({ scope, rpcId }); beforeSeal(); return source },
    resolve: async () => { if (!active) throw new EnterpriseError(401, 'session-invalid', 'Expired'); return grant },
    agentPresetEligibility: async (_token, _id, _grant, ids) => { const result = allowed ? [...ids] : []; afterEligibility(); return result },
    authorize: async (_token, _id, current, operation, verify) => {
      authorizeNativeOperation(current.role, operation)
      try { if (!omitCheck) await verify(); if (failAudit) throw new EnterpriseError(503, 'audit-unavailable', 'Unavailable'); audits.push('allow') }
      catch (error) { audits.push('deny'); throw error }
    },
  }); disposers.push(() => gateway.close())
  return { calls, refs, audits, descriptors, forwarded, seals, source, nativeResult,
    revoke: () => { allowed = false }, expire: () => { active = false },
    swap: () => { grant = { ...grant, revision: randomUUID() } }, failAudit: () => { failAudit = true }, omitCheck: () => { omitCheck = true },
    changePreset: () => { preset = 'changed-personal' }, unresolved: () => { preset = null },
    beforeReply: (fn: () => void) => { beforeReply = fn }, afterEligibility: (fn: () => void) => { afterEligibility = fn },
    beforeSeal: (fn: () => void) => { beforeSeal = fn },
    malformed: (kind: string) => { if (kind === 'correlation') corrupt = true; if (kind === 'status') status = 503;
      if (kind === 'mime') mime = 'text/plain'; if (kind === 'encoding') headers = { 'content-encoding': 'gzip' };
      if (kind === 'attachment') headers = { 'content-disposition': 'attachment' }; if (kind === 'owner-error') refuse = true },
    read: async (args: object = execution ? { agentId: 'hansen-session', line: '/export', images: [] } : { agentId: 'hansen-session' },
      endpoint = execution ? 'commands/execute' : 'commands/list', extraHeaders: Record<string, string> = {}) => {
      const response = await fetch(origin + '/api/' + endpoint, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...extraHeaders },
        body: JSON.stringify({ type: 'client-request', rpcId: 'command-http', method: endpoint, payload: { args } }), signal: AbortSignal.timeout(5000) })
      return { status: response.status, text: await response.text() }
    },
  }
}
describe('HTTP/Unix private command gate; explicit owner/identity fixtures, not real Worker or browser acceptance', () => {
  it.each(['admin', 'member'] as const)('preserves original eligible %s descriptors and rechecks before releasing bytes', async role => {
    const f = await fixture(role), response = await f.read()
    expect(response.status).toBe(200); expect(JSON.parse(response.text).result).toEqual({ ok: true, value: f.descriptors })
    expect(f.calls).toHaveLength(1); expect(f.refs).toEqual(Array(4).fill('hansen-session')); expect(f.audits).toEqual(['allow', 'allow', 'allow'])
  })
  it.each(['revoke', 'unresolved', 'omitCheck'] as const)('rejects %s before the original Agent resolver', async change => {
    const f = await fixture(); f[change](); const response = await f.read()
    expect(response.status).toBeGreaterThanOrEqual(400); expect(f.calls).toEqual([])
  })
  it('rejects foreign IDs, payload selectors and member command execution before owner access', async () => {
    const f = await fixture(); expect((await f.read({ agentId: 'alex-session' })).status).toBe(403)
    expect(f.audits).toContain('deny')
    expect((await f.read({ agentId: 'hansen-session', userId: 'alex' })).status).toBe(400)
    expect((await f.read({ agentId: 'hansen-session', line: 'do something' }, 'commands/execute')).status).toBe(403)
    expect(f.calls).toEqual([])
  })
  it('rejects a native preset change while checking eligibility before Agent resolution', async () => {
    const f = await fixture(); f.afterEligibility(f.changePreset)
    expect((await f.read()).status).toBe(409); expect(f.calls).toEqual([])
  })
  it.each(['revoke', 'expire', 'swap', 'changePreset', 'failAudit'] as const)('withholds native bytes after %s during provider IO', async change => {
    const f = await fixture(); f.beforeReply(f[change]); const response = await f.read()
    expect(response.status).toBeGreaterThanOrEqual(400); expect(response.text).not.toContain('Original scoped'); expect(f.calls).toHaveLength(1)
  })
  it.each(['correlation', 'status', 'mime', 'encoding', 'attachment'])('rejects invalid original %s without manufacturing success', async kind => {
    const f = await fixture(); f.malformed(kind); const response = await f.read()
    expect(response.status).toBe(502); expect(response.text).not.toContain('scope-z')
  })
  it('preserves the original owner error envelope', async () => {
    const f = await fixture(); f.malformed('owner-error'); const response = await f.read()
    expect(response.status).toBe(200); expect(JSON.parse(response.text).result).toEqual({ ok: false,
      error: { code: 'command-error', message: 'Original owner failure', details: {} } })
  })
})

describe('private export gateway provenance and current eligibility; stub handler, not Browser E2E', () => {
  it.each(['admin', 'member'] as const)('seals the current %s invocation and preserves the browser correlation and original result', async role => {
    const f = await fixture(role, true), response = await f.read()
    expect(response.status, response.text).toBe(200)
    expect(JSON.parse(response.text)).toEqual({ type: 'server-response', rpcId: 'command-http', result: { ok: true, value: f.nativeResult } })
    expect(f.seals).toHaveLength(1)
    expect(f.seals[0]).toMatchObject({ rpcId: 'command-http', scope: { nativeSessionId: 'hansen-session' } })
    expect(f.calls).toEqual([{ type: 'client-request', rpcId: f.source, method: 'commands/execute',
      payload: { args: { agentId: 'hansen-session', line: '/export', images: [] } } }])
    expect(f.forwarded[0]).toMatchObject({ [COMMAND_ORIGIN_HEADER]: f.source,
      [COMMAND_BINDING_HEADER]: commandInvocationBinding(f.source, 'hansen-session', '/export') })
    expect(f.forwarded[0]).not.toHaveProperty('authorization')
    expect(f.refs).toEqual(Array(4).fill('hansen-session')); expect(f.audits.length).toBeGreaterThanOrEqual(3)
  })
  it.each([COMMAND_ORIGIN_HEADER, COMMAND_BINDING_HEADER, 'authorization'])('rejects caller identity header %s before forwarding', async name => {
    const f = await fixture('member', true), response = await f.read(undefined, undefined, { [name]: 'caller-forged' })
    expect(response.status).toBe(400); expect(response.text).toBe('identity-header-not-allowed')
    expect(f.seals).toEqual([]); expect(f.calls).toEqual([])
  })
  it.each(['revoke', 'unresolved', 'omitCheck', 'failAudit', 'expire'] as const)('denies %s before export owner access', async change => {
    const f = await fixture('member', true); f[change]()
    expect((await f.read()).status).toBeGreaterThanOrEqual(400); expect(f.calls).toEqual([])
  })
  it('does not grant foreign sessions, images, authority selectors or other commands', async () => {
    const f = await fixture('member', true)
    for (const patch of [{ agentId: 'alex-session' }, { images: ['untrusted-image'] }, { userId: 'alex' },
      { line: '/compact' }, { line: '/export-all' }, { line: '/plan' }, { line: '/goal' }]) {
      expect((await f.read({ agentId: 'hansen-session', line: '/export', images: [], ...patch })).status).toBeGreaterThanOrEqual(400)
    }
    expect(f.calls).toEqual([])
  })
  it.each(['expire', 'swap'] as const)('rechecks identity after %s while sealing the source', async change => {
    const f = await fixture('member', true); f.beforeSeal(f[change])
    expect((await f.read()).status).toBeGreaterThanOrEqual(400); expect(f.calls).toEqual([])
  })
  it('rejects preset drift during pre-execution eligibility', async () => {
    const f = await fixture('member', true); f.afterEligibility(f.changePreset)
    expect((await f.read()).status).toBe(409); expect(f.calls).toEqual([])
  })
  it.each(['revoke', 'expire', 'swap', 'changePreset', 'failAudit'] as const)('withholds a successful receipt after %s during native IO', async change => {
    const f = await fixture('member', true); f.beforeReply(f[change]); const response = await f.read()
    expect(response.status).toBeGreaterThanOrEqual(400); expect(response.text).not.toContain('Session log download requested')
    expect(f.calls).toHaveLength(1)
  })
  it.each(['correlation', 'status', 'mime', 'encoding'])('rejects invalid export %s without manufacturing native success', async kind => {
    const f = await fixture('member', true); f.malformed(kind); const response = await f.read()
    expect(response.status).toBe(502); expect(response.text).not.toContain('Session log download requested')
  })
  it('preserves original RPC errors and the browser correlation', async () => {
    const f = await fixture('member', true); f.malformed('owner-error'); const response = await f.read()
    expect(response.status).toBe(200); expect(JSON.parse(response.text)).toEqual({ type: 'server-response', rpcId: 'command-http',
      result: { ok: false, error: { code: 'command-error', message: 'Original owner failure', details: {} } } })
  })
})
