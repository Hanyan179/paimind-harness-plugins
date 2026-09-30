// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeGateway } from '../src/native-gateway.js'
import { createEnterpriseServer } from '../src/server.js'
import { authorizeNativeOperation } from '../src/native-operation-policy.js'
import { EnterpriseError } from '../src/errors.js'
import type { Identity } from '../src/identity.js'
import type { RuntimeGrant } from '../src/runtime-bindings.js'

// Real HTTP boundaries, explicit authority/native wire fixtures. These do not
// stand in for the separate PostgreSQL, actual owner or browser acceptance.
const cleanup: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing test port')
  return `http://127.0.0.1:${address.port}`
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
async function fixture(role: 'admin' | 'member' = 'member') {
  const state = { loggedIn: true, hold: false, heldClosed: false, fault: '', omitVerify: false, auditCount: 0, onRead: (_method: string) => {} }
  const calls: Array<{ method: string; payload: any; headers: object }> = []
  let workspaces = 0
  const native = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    const call = JSON.parse(raw); calls.push({ method: call.method, payload: call.payload, headers: request.headers })
    const ownership = call.method === 'session.history' && call.payload.beforeSeq === 0
    const history = call.method === 'session.history' && !ownership
    if (history && state.hold) await new Promise<void>(resolve => response.once('close', () => { state.heldClosed = true; resolve() }))
    if (response.destroyed) return
    state.onRead(history ? 'artifacts' : call.method)
    if (history && state.fault === 'redirect') { response.writeHead(302, { location: 'http://127.0.0.1:3080' }); response.end(); return }
    response.writeHead(200, { 'content-type': 'application/json' })
    if (history && state.fault === 'oversized') { response.end('x'.repeat(2 * 1024 * 1024 + 1)); return }
    if (history && state.fault === 'truncated') { response.write('{'); response.destroy(); return }
    const workspace = { workspaceId: 'workspace-hansen', sessionIds: ['hansen-session'], path: '/workspace/hansen', title: 'Hansen', createdAt: '2026', updatedAt: '2026' }
    if (call.method === 'workspace.list' && ++workspaces > 1 && state.fault === 'move') workspace.path = '/workspace/changed'
    const artifact = { schema: 'paimind.artifact-produced/v1', artifactId: 'artifact:one', sessionId: 'hansen-session',
      workspaceId: workspace.workspaceId, path: '/workspace/hansen/report.html', title: 'Hansen report', kind: 'html',
      previewKind: 'html-document', revision: 1, producerId: 'generator.html', taskId: 'job-one', state: 'available', producedAt: 100 }
    if (state.fault === 'foreign') artifact.sessionId = 'alex-session'
    const value = call.method === 'workspace.list' ? { items: [workspace], archivedSessionIds: [] }
      : { events: [], hasMore: false, ...(!ownership ? { projections: { asOfSeq: -1, values: state.fault === 'absent' ? {} : {
        'paimind.artifacts': { schema: 'paimind.artifacts/v1', artifacts: [artifact], traces: [] }, private: 'PRIVATE_OTHER_PROJECTION',
      } } } : {}) }
    const result = call.method === 'session.history' && call.payload.sessionId !== 'hansen-session'
      ? { ok: false, error: { code: 'session-not-found', message: 'PRIVATE_NATIVE_ERROR', details: { sessionId: call.payload.sessionId } } }
      : { ok: true, value }
    response.end(JSON.stringify({ type: 'server-response', rpcId: history && state.fault === 'correlation' ? 'wrong' : call.rpcId, result }))
  })
  const nativeOrigin = await listen(native); cleanup.push(() => close(native))
  const reservation = createServer(), publicOrigin = await listen(reservation); await close(reservation)
  let grant: RuntimeGrant = { tenantId: 'explicit-artifact-fixture', userId: randomUUID(), role, cellId: randomUUID(),
    revision: randomUUID(), origin: nativeOrigin, validForMs: 10000 }
  const gateway = new NativeGateway({ publicOrigin, revalidateMs: 20,
    resolve: async () => { if (!state.loggedIn) throw new EnterpriseError(401, 'auth-required', '登录失效'); return grant },
    authorize: async (_token, _id, selected, operation, verify) => {
      authorizeNativeOperation(selected.role, operation)
      if (!state.omitVerify) await verify()
      state.auditCount++
      if (state.fault === 'audit' || state.fault === 'final-audit' && state.auditCount === 4) throw new EnterpriseError(503, 'audit-unavailable', '审计不可用')
    } })
  const server = createEnterpriseServer({ identity: {} as Identity, nativeGateway: gateway, publicOrigin, loopbackDevelopment: true })
  await new Promise<void>(resolve => server.listen(Number(new URL(publicOrigin).port), '127.0.0.1', resolve))
  cleanup.push(async () => { gateway.close(); await close(server) })
  const get = (sessionId = 'hansen-session', suffix = '', signal?: AbortSignal) => fetch(publicOrigin + '/haas/v1/sessions/' + sessionId + '/artifacts' + suffix,
    { headers: { origin: publicOrigin, cookie: 'paimind_haas_session=PRIVATE_COOKIE' }, signal })
  return { state, calls, get, gateway, replace: () => { grant = { ...grant, revision: randomUUID() } } }
}
describe('versioned artifact gateway and response boundary', () => {
  it.each(['admin', 'member'] as const)('serves %s only from the selected cell and original workspace', async role => {
    const f = await fixture(role), response = await f.get()
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    const value = await response.json()
    expect(value.data).toMatchObject({ kind: 'artifacts', sessionId: 'hansen-session', workspaceId: 'workspace-hansen', asOfSeq: -1,
      fileExistence: 'not-checked', productProjection: 'ready', items: [{ id: 'artifact:one', title: 'Hansen report' }] })
    expect(JSON.stringify(value)).not.toMatch(/PRIVATE_OTHER_PROJECTION|PRIVATE_COOKIE/)
    expect(f.state.auditCount).toBe(4)
    expect(f.calls.filter(call => call.method === 'workspace.list')).toHaveLength(2)
    expect(f.calls.every(call => !('cookie' in call.headers))).toBe(true)
  })
  it('retains explicit missing source status instead of a fabricated ready empty list', async () => {
    const f = await fixture(); f.state.fault = 'absent'
    expect((await (await f.get()).json()).data).toMatchObject({ items: [], productProjection: 'unavailable' })
  })
  it.each(['alex-session', 'missing-session'])('rejects known foreign or absent %s without leaking native details', async id => {
    const f = await fixture(), response = await f.get(id)
    expect(response.status).toBe(403); expect(await response.text()).not.toContain('PRIVATE_NATIVE_ERROR')
    expect(f.calls).toHaveLength(1)
  })
  it.each(['?userId=alex', '?path=/workspace/alex', '?beforeSeq=1', '?sessionId=other'])('rejects caller authority/selection query %s before any native read', async query => {
    const f = await fixture(); expect((await f.get('hansen-session', query)).status).toBe(400); expect(f.calls).toHaveLength(0)
  })
  it.each(['foreign', 'move', 'audit', 'final-audit', 'redirect', 'oversized', 'truncated', 'correlation'])('releases no artifact after %s', async fault => {
    const f = await fixture(); f.state.fault = fault
    const response = await f.get(); expect(response.status).toBeGreaterThanOrEqual(400); expect(await response.text()).not.toContain('Hansen report')
  })
  it('requires the audited resource callback and canonical session identity', async () => {
    const f = await fixture(); f.state.omitVerify = true
    expect((await f.get()).status).toBe(502); expect(f.calls).toHaveLength(0)
    expect((await f.get('hansen%2Fprivate')).status).toBe(400)
  })
  it.each(['logout', 'replace'])('revalidates %s after native data, before a polling tick', async fault => {
    const f = await fixture(); f.state.onRead = method => { if (method === 'artifacts') { if (fault === 'logout') f.state.loggedIn = false; else f.replace() } }
    const response = await f.get(); expect(response.status).toBeGreaterThanOrEqual(400); expect(await response.text()).not.toContain('Hansen report')
  })
  it.each(['disconnect', 'logout', 'close'])('cancels the held original owner on %s', async fault => {
    const f = await fixture(); f.state.hold = true
    const controller = new AbortController(), pending = f.get('hansen-session', '', controller.signal).then(response => response.status, () => 499)
    await vi.waitFor(() => expect(f.calls.some(call => call.payload.maxMessages === 10001)).toBe(true))
    if (fault === 'disconnect') controller.abort(); else if (fault === 'logout') f.state.loggedIn = false; else f.gateway.close()
    expect(await pending).toBeGreaterThanOrEqual(400)
    await vi.waitFor(() => expect(f.state.heldClosed).toBe(true))
  })
})
