// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeGateway } from '../src/native-gateway.js'
import { authorizeNativeOperation } from '../src/native-operation-policy.js'
import { EnterpriseError } from '../src/errors.js'
import type { RuntimeGrant } from '../src/runtime-bindings.js'
import { CellTransport } from '../src/cell-transport.js'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { createNativeControlBroker, createNativeControlPeer, handleNativeControl } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'

const disposers: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => { for (const close of disposers.splice(0).reverse()) await close() })
async function listen(server: Server) {
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  disposers.push(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) })
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing test port')
  return `http://127.0.0.1:${address.port}`
}
async function fixture(role: 'admin' | 'member' = 'member') {
  const sessionId = 'hansen-session', approvalId = randomUUID(), rpcId = randomUUID(), version = randomBytes(32).toString('base64url')
  let allowed = true, active = true, failAudit = false, omitCheck = false, pending = true, beforeSeal = () => {}, beforeReply = () => {}
  let preset = 'hansen-personal', malformed = '', currentVersion = version
  const calls: any[] = [], audit: string[] = [], correlations: string[] = [], refs: unknown[] = []
  const nativeOrigin = await listen(createServer(async (req, res) => {
    let text = ''; for await (const bytes of req) text += bytes
    const input = JSON.parse(text)
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/session.history') {
      res.end(JSON.stringify({ type: 'server-response', rpcId: input.rpcId, result: input.payload.sessionId === sessionId
        ? { ok: true, value: { events: [], hasMore: false } }
        : { ok: false, error: { code: 'session-not-found', message: 'Missing', details: { sessionId: input.payload.sessionId } } } }))
      return
    }
    calls.push({ input, headers: req.headers }); beforeReply()
    const receipt = input.result?.value?.approvalId ? { accepted: pending } : { accepted: false, reason: 'not-pending' }
    if (input.result?.value?.approvalId) pending = false
    if (malformed === 'mime') res.setHeader('content-type', 'text/plain')
    res.end(malformed === 'encoding' ? '{' : JSON.stringify(malformed === 'extra' ? { ...receipt, source: 'PRIVATE_SOURCE' } : receipt))
  }))
  const broker = await createNativeControlBroker(); disposers.push(() => broker.close())
  const peer = createNativeControlPeer(createConnection(broker.path), { handle: (operation, input, signal) =>
    handleNativeControl({ get: () => ({ read: async (id: string) => {
      if (id !== sessionId) throw Error('Unknown session')
      return { sessionId, agentPreset: preset, hasForkBoundary: true }
    }, approval: async (id: string, requestedId: string) => {
      refs.push({ id, requestedId }); if (id !== sessionId || requestedId !== approvalId) throw Error('Unknown approval')
      return { sessionId, approvalId, version: currentVersion, toolName: 'diagnostic', askedSeq: 1, decidedSeq: pending ? null : 2,
        outcome: pending ? null : 'rejected', answerable: pending, rpcId: pending ? rpcId : null, persisted: !pending }
    } }) }, operation, input, signal) })
  disposers.push(() => peer.close()); await vi.waitFor(() => expect(broker.ready).toBe(true))
  const key = randomBytes(32).toString('hex'), port = Number(new URL(nativeOrigin).port)
  const ingress = createNativeIngress({ token: key, nativePort: port, control: (op, value, signal) => broker.request(op, value, signal) })
  const privateOrigin = await listen(ingress.server); disposers.push(() => ingress.close())
  const transport = new CellTransport(privateOrigin, key, port); disposers.push(() => transport.destroy())
  let gateway: NativeGateway
  const origin = await listen(createServer((req, res) => {
    void gateway.http(req, res, randomUUID()).catch(error => {
      if (!res.destroyed) { res.statusCode = error instanceof EnterpriseError ? error.status : 500; res.end(error instanceof EnterpriseError ? error.code : 'failure') }
    })
  }))
  let grant: RuntimeGrant = { tenantId: 'approval-carrier-fixture', userId: randomUUID(), role, cellId: randomUUID(), revision: randomUUID(),
    origin: privateOrigin, validForMs: 10000, transport: 'private-cell' }
  gateway = new NativeGateway({ publicOrigin: origin, transports: new Map([[privateOrigin, transport]]),
    resolve: async () => { if (!active) throw new EnterpriseError(401, 'session-invalid', 'Expired'); return grant },
    sealInteractiveOrigin: async (_token, _id, scope, clientRpcId) => {
      correlations.push(clientRpcId); beforeSeal()
      return `paimind-origin-v1.${Buffer.from(JSON.stringify({ ...scope, clientRpcId })).toString('base64url')}.${'a'.repeat(43)}`
    }, agentPresetEligibility: async (_token, _id, _grant, ids) => allowed ? [...ids] : [],
    authorize: async (_token, _id, current, operation, verify) => {
      authorizeNativeOperation(current.role, operation)
      try { if (!omitCheck) await verify(); if (failAudit) throw new EnterpriseError(503, 'audit-unavailable', 'Diagnostic failure'); audit.push('allow') }
      catch (error) { audit.push('deny'); throw error }
    } })
  disposers.push(() => gateway.close())
  return { sessionId, approvalId, rpcId, version, calls, refs, audit, correlations, gateway, target: () => ({ ...grant }),
    revoke: () => { allowed = false }, expire: () => { active = false }, swap: () => { grant = { ...grant, revision: randomUUID() } },
    resolve: () => { pending = false }, changeVersion: () => { currentVersion = randomBytes(32).toString('base64url') },
    changePreset: () => { preset = 'changed-personal' }, failAudit: () => { failAudit = true }, omitCheck: () => { omitCheck = true },
    beforeSeal: (fn: () => void) => { beforeSeal = fn }, beforeReply: (fn: () => void) => { beforeReply = fn },
    malformed: (kind: string) => { malformed = kind },
    respond: async (value: any = { sessionId, approvalId, outcome: 'allowed-once' }, id = rpcId) => {
      const response = await fetch(origin + '/api/respond', { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie: 'paimind_haas_session=PRIVATE_COOKIE' },
        body: JSON.stringify({ type: 'client-response', rpcId: id, result: { ok: true, value } }), signal: AbortSignal.timeout(6000) })
      return { status: response.status, text: await response.text() }
    } }
}
describe('HAAS-08 native approval HTTP/private control gate; explicit authority/native fixtures, not browser acceptance', () => {
  it.each(['admin', 'member'] as const)('pins %s approval to current owner and signs without changing original rpcId', async role => {
    const f = await fixture(role), response = await f.respond()
    expect(response).toEqual({ status: 200, text: '{"accepted":true}' }); expect(f.calls).toHaveLength(1)
    expect(f.calls[0].input).toMatchObject({ rpcId: f.rpcId, result: { value: { sessionId: f.sessionId, approvalId: f.approvalId,
      paimindApproval: { expectedVersion: f.version, source: expect.stringMatching(/^paimind-origin-v1\./u) } } } })
    expect(f.correlations[0]).toMatch(/^haas-approval-v1\.[A-Za-z0-9_-]{43}$/u)
    expect(JSON.stringify(f.calls)).not.toContain('PRIVATE_COOKIE')
    expect((await f.respond()).status).toBe(409); expect(f.calls).toHaveLength(1)
  })
  it('refuses approval after withdrawal but permits currently authenticated rejection as cleanup', async () => {
    const f = await fixture(); f.revoke()
    expect((await f.respond()).status).toBe(403); expect(f.calls).toHaveLength(0); expect(f.audit).toContain('deny')
    expect((await f.respond({ sessionId: f.sessionId, approvalId: f.approvalId, outcome: 'rejected' })).status).toBe(200)
    expect(f.calls[0].input.result.value.outcome).toBe('rejected')
  })
  it.each(['revoke', 'expire', 'swap', 'resolve', 'changeVersion', 'changePreset'] as const)('does not forward after %s during signature IO', async action => {
    const f = await fixture(); f.beforeSeal(f[action]); expect((await f.respond()).status).toBe({ revoke: 403, expire: 401, swap: 502,
      resolve: 409, changeVersion: 409, changePreset: 409 }[action]); expect(f.calls).toHaveLength(0); expect(f.correlations).toHaveLength(1)
  })
  it.each(['failAudit', 'omitCheck'] as const)('does not forward when the audited resource boundary is %s', async action => {
    const f = await fixture(); f[action](); expect((await f.respond()).status).toBeGreaterThanOrEqual(400); expect(f.calls).toHaveLength(0)
  })
  it('denies foreign session, approval ID, stale rpcId and client-supplied provenance', async () => {
    const f = await fixture()
    for (const [value, id] of [
      [{ sessionId: 'alex-session', approvalId: f.approvalId, outcome: 'allowed-once' }, f.rpcId],
      [{ sessionId: f.sessionId, approvalId: randomUUID(), outcome: 'allowed-once' }, f.rpcId],
      [{ sessionId: f.sessionId, approvalId: f.approvalId, outcome: 'allowed-once' }, randomUUID()],
      [{ sessionId: f.sessionId, approvalId: f.approvalId, outcome: 'allowed-once', paimindApproval: {} }, f.rpcId],
    ] as const) expect((await f.respond(value, id)).status).toBeGreaterThanOrEqual(400)
    expect(f.calls).toHaveLength(0)
  })
  it.each(['mime', 'encoding', 'extra'])('refuses malformed %s native receipt without claiming success or leaking provenance', async kind => {
    const f = await fixture(); f.malformed(kind); const response = await f.respond()
    expect(response.status).toBe(502); expect(response.text).not.toContain('PRIVATE_SOURCE'); expect(f.calls).toHaveLength(1)
  })
  it('withholds a receipt after the login changes during native IO, without retry', async () => {
    const f = await fixture(); f.beforeReply(f.expire)
    expect((await f.respond()).status).toBeGreaterThanOrEqual(400); expect(f.calls).toHaveLength(1)
  })
  it('keeps non-approval native question responses unchanged', async () => {
    const f = await fixture(), value = { questionId: 'native-question', answer: 'hello' }, response = await f.respond(value, 'question-rpc')
    expect(response.status).toBe(200); expect(f.calls[0].input.result.value).toEqual(value)
    expect(f.refs).toHaveLength(0); expect(f.correlations).toHaveLength(0)
  })
})

describe('versioned command carrier uses the same original approval owner', () => {
  it.each(['allowed-once', 'rejected'] as const)('reads and submits exact %s through original owner without private metadata in the result', async outcome => {
    const f = await fixture(), target = f.target()
    const before = await f.gateway.sessionApprovalState('fixture', randomUUID(), f.sessionId, f.approvalId, new AbortController().signal, outcome === 'allowed-once', target)
    expect(before.presetId).toBe('hansen-personal'); expect(before.state.answerable).toBe(true)
    const accepted = await f.gateway.submitSessionApproval('fixture', randomUUID(), target, { sessionId: f.sessionId, approvalId: f.approvalId,
      expectedVersion: f.version, rpcId: f.rpcId, outcome }, new AbortController().signal)
    expect(accepted).toBe(true); expect(f.calls).toHaveLength(1)
    expect(f.calls[0].input.result.value.outcome).toBe(outcome)
  })
  it('never substitutes a current request for a stale version or a different original rpcId', async () => {
    const f = await fixture()
    for (const changed of [{ expectedVersion: randomBytes(32).toString('base64url') }, { rpcId: randomUUID() }]) {
      await expect(f.gateway.submitSessionApproval('fixture', randomUUID(), f.target(), { sessionId: f.sessionId, approvalId: f.approvalId,
        expectedVersion: f.version, rpcId: f.rpcId, outcome: 'allowed-once', ...changed }, new AbortController().signal)).rejects.toMatchObject({ status: 409 })
    }
    expect(f.calls).toHaveLength(0)
  })
  it.each(['revoke', 'expire', 'swap', 'changeVersion', 'changePreset'] as const)('fails closed after %s during signing in the versioned carrier', async action => {
    const f = await fixture(), target = f.target(); f.beforeSeal(f[action])
    await expect(f.gateway.submitSessionApproval('fixture', randomUUID(), target, { sessionId: f.sessionId, approvalId: f.approvalId,
      expectedVersion: f.version, rpcId: f.rpcId, outcome: 'allowed-once' }, new AbortController().signal)).rejects.toBeDefined()
    expect(f.calls).toHaveLength(0); expect(f.correlations).toHaveLength(1)
  })
  it('does not send a decided request or resume a missing pending owner', async () => {
    const f = await fixture(); f.resolve()
    expect(await f.gateway.submitSessionApproval('fixture', randomUUID(), f.target(), { sessionId: f.sessionId, approvalId: f.approvalId,
      expectedVersion: f.version, rpcId: f.rpcId, outcome: 'rejected' }, new AbortController().signal)).toBe(false)
    expect(f.calls).toHaveLength(0); expect(f.correlations).toHaveLength(0)
  })
  it('reports an observation-only race when the pending owner finishes during signing', async () => {
    const f = await fixture(); f.beforeSeal(f.resolve)
    expect(await f.gateway.submitSessionApproval('fixture', randomUUID(), f.target(), { sessionId: f.sessionId, approvalId: f.approvalId,
      expectedVersion: f.version, rpcId: f.rpcId, outcome: 'rejected' }, new AbortController().signal)).toBe(false)
    expect(f.calls).toHaveLength(0); expect(f.correlations).toHaveLength(1)
  })
})
