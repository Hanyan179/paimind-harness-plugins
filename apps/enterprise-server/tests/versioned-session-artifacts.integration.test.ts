import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterAll, expect, it } from 'vitest'
import { Identity } from '../src/identity.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { NativeGateway } from '../src/native-gateway.js'
import { createEnterpriseServer } from '../src/server.js'
import { CellTransport } from '../src/cell-transport.js'
import { CellTransportDirectory } from '../src/cell-transport-directory.js'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { isolatedDatabase } from './fixtures/isolated-database.js'

// Real database/auth/audit/private transport; native wire and container pins
// are explicit fixtures. The actual original-owner test is separate evidence,
// not combined with this to claim a final dual-worker or browser acceptance.
const config = isolatedDatabase()
const owner = postgres(config.ownerUrl, { max: 2, onnotice: () => {} }), sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
afterAll(async () => { await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })
const command = () => ({ key: randomUUID(), requestId: randomUUID() })
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
async function listen(server: Server) {
  for (let attempt = 0; attempt < 32; attempt++) {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('No test port')
    const origin = `http://127.0.0.1:${address.port}`
    if (!(await owner`select 1 from haas.runtime_bindings where origin=${origin}`).length) return origin
    await close(server)
  }
  throw Error('No unused test origin; retained identities not overwritten')
}
it('enforces owner-only artifact reads, cross-tenant denial and revoke through real two-member authentication and audit', async () => {
  const directory = await mkdtemp(join(config.evidence, 'artifacts-auth-')), cleanup: Array<() => unknown | Promise<unknown>> = []
  const reads: object[] = [], calls: object[] = [], tenantId = 'artifacts-' + randomUUID(), password = 'Synthetic artifacts acceptance password 2026'
  try {
    await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
    const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
    await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, command())
    const admin = (await identity.login({ username: 'morgan', password }, command())).token
    cleanup.push(() => identity.logout(admin, {}, command()))
    const cells = []
    for (const username of ['hansen', 'alex']) {
      const account = (await identity.createMember(admin, { username, displayName: username === 'hansen' ? 'Hansen' : 'Alex', password }, command())).data
      const token = (await identity.login({ username, password }, command())).token, logoutContext = command()
      const logout = () => identity.logout(token, {}, logoutContext); cleanup.push(logout)
      const native = createServer(async (request, response) => {
        let raw = ''; for await (const chunk of request) raw += chunk
        const call = JSON.parse(raw), sessionId = call.payload.sessionId
        calls.push({ username, method: call.method, sessionId, beforeSeq: call.payload.beforeSeq })
        const owned = sessionId === username + '-session' || sessionId === 'same-native-id'
        const artifact = { schema: 'paimind.artifact-produced/v1', artifactId: 'same-artifact-id', sessionId, workspaceId: username + '-workspace',
          path: '/workspace/' + username + '/report.html', title: username + ' private report', kind: 'html', previewKind: 'html-document', revision: 1,
          producerId: 'fixture.generator', taskId: username + '-job', state: 'available', producedAt: 100 }
        const value = call.method === 'workspace.list' ? { items: [{ workspaceId: username + '-workspace', path: '/workspace/' + username,
          title: username, sessionIds: [username + '-session', 'same-native-id'], createdAt: '2026', updatedAt: '2026' }], archivedSessionIds: [] }
          : { events: [], hasMore: false, ...(call.payload.beforeSeq === undefined ? { projections: { asOfSeq: -1,
            values: { 'paimind.artifacts': { schema: 'paimind.artifacts/v1', artifacts: [artifact], traces: [] } } } } : {}) }
        const result = call.method === 'session.history' && !owned
          ? { ok: false, error: { code: 'session-not-found', message: 'PRIVATE_NATIVE_ERROR', details: { sessionId } } } : { ok: true, value }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ type: 'server-response', rpcId: call.rpcId, result }))
      })
      const nativeOrigin = await listen(native), nativePort = Number(new URL(nativeOrigin).port); cleanup.push(() => close(native))
      const key = randomBytes(32).toString('hex'), ingress = createNativeIngress({ token: key, nativePort })
      cleanup.push(() => ingress.close())
      const origin = await listen(ingress.server), transport = new CellTransport(origin, key, nativePort); cleanup.push(() => transport.destroy())
      const pin: PrivateRuntimeCell = { cellId: randomUUID(), tenantId, userId: account.userId, role: 'member', origin, revision: randomUUID(),
        containerId: randomBytes(32).toString('hex'), imageId: 'sha256:' + 'd'.repeat(64), volumeName: 'paimind-haas-member-artifact-fixture-' + randomUUID(), policyDigest: 'sha256:' + 'e'.repeat(64) }
      await owner`insert into haas.runtime_bindings (cell_id,tenant_id,user_id,origin,revision,isolation_mode,status,lease_expires_at,container_id,image_id,volume_name,policy_digest)
        values (${pin.cellId},${tenantId},${pin.userId},${origin},${pin.revision},'container-managed','ready',clock_timestamp()+interval '10 minutes',${pin.containerId},${pin.imageId},${pin.volumeName},${pin.policyDigest})`
      cells.push({ username, token, pin, transport, logout })
    }
    const reservation = createServer(), publicOrigin = await listen(reservation); await close(reservation)
    const bindings = new RuntimeBindings(sql, identity, publicOrigin, [], cells.map(cell => cell.pin))
    for (const cell of cells) await cell.transport.openOriginAuthority((input, signal) => bindings.checkInteractiveOrigins(cell.pin.cellId, input, signal),
      (input, signal) => bindings.authorizeInteractiveExecution(cell.pin.cellId, input, signal),
      (input, signal) => bindings.deriveInteractiveOrigins(cell.pin.cellId, input, signal),
      (input, signal) => bindings.sealJobOrigins(cell.pin.cellId, input, signal),
      (input, signal) => bindings.readSkillEligibility(cell.pin.cellId, input, signal))
    const gateway = new NativeGateway({ publicOrigin, transports: new CellTransportDirectory(new Map(cells.map(cell => [cell.pin.origin, cell.transport])), cells.map(cell => cell.pin)),
      resolve: (...args) => bindings.resolve(...args), authorize: (...args) => identity.authorizeRuntimeOperation(...args) })
    cleanup.push(() => gateway.close())
    const server = createEnterpriseServer({ identity, publicOrigin, nativeGateway: gateway, loopbackDevelopment: true })
    await new Promise<void>(resolve => server.listen(Number(new URL(publicOrigin).port), '127.0.0.1', resolve)); cleanup.push(() => close(server))
    const get = async (sessionId: string, token?: string, suffix = '') => {
      const response = await fetch(publicOrigin + '/haas/v1/sessions/' + sessionId + '/artifacts' + suffix,
        { headers: token ? { cookie: 'paimind_haas_session=' + token } : {}, signal: AbortSignal.timeout(15000) })
      const body = await response.json()
      expect(body.requestId).toBe(response.headers.get('x-request-id')); expect(response.headers.get('cache-control')).toBe('no-store')
      reads.push({ sessionId, suffix, status: response.status, body }); return { status: response.status, body }
    }
    for (const cell of cells) {
      const other = cells.find(value => value !== cell)!
      for (const sessionId of [cell.username + '-session', 'same-native-id']) {
        const result = await get(sessionId, cell.token); expect(result.status).toBe(200)
        expect(result.body.data).toMatchObject({ sessionId, workspaceId: cell.username + '-workspace', productProjection: 'ready', items: [{ id: 'same-artifact-id', title: cell.username + ' private report' }] })
        expect(JSON.stringify(result.body)).not.toContain(other.username)
      }
      for (const sessionId of [other.username + '-session', 'missing-session']) {
        const result = await get(sessionId, cell.token); expect(result.status).toBe(403)
        expect(JSON.stringify(result.body)).not.toContain('PRIVATE_NATIVE_ERROR')
        const audit = await owner`select actor_user_id, outcome from haas.audit_events where tenant_id=${tenantId} and request_id=${result.body.requestId}`
        expect(audit.some(event => event.actor_user_id === cell.pin.userId && event.outcome === 'denied')).toBe(true)
      }
      expect((await get('same-native-id', cell.token, '?userId=' + other.pin.userId)).status).toBe(400)
    }
    const before = calls.length
    expect((await get('hansen-session')).status).toBe(401)
    expect((await get('hansen-session', admin)).status).toBeGreaterThanOrEqual(400)
    const foreignTenant = 'artifacts-foreign-' + randomUUID()
    await owner`insert into haas.tenants (tenant_id) values (${foreignTenant})`
    const foreign = new Identity(sql, foreignTenant, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
    await foreign.bootstrap({ username: 'taylor', displayName: 'Taylor', password, bootstrapSecret: config.bootstrapSecret }, command())
    const foreignToken = (await foreign.login({ username: 'taylor', password }, command())).token
    cleanup.push(() => foreign.logout(foreignToken, {}, command()))
    expect((await get('hansen-session', foreignToken)).status).toBe(401)
    expect(calls).toHaveLength(before)
    await cells[0]!.logout()
    expect((await get('hansen-session', cells[0]!.token)).status).toBe(401)
    expect((await get('alex-session', cells[1]!.token)).status).toBe(200)
    await writeFile(join(directory, 'receipt.json'), JSON.stringify({ status: 'ARTIFACTS_REAL_IDENTITY_PASSED', tenantId, reads, calls,
      realPostgres: true, realPrivateHttp: true, nativeContent: 'explicit-fixture', containerPins: 'explicit-fixture', browserE2E: false }, null, 2), { flag: 'wx', mode: 0o600 })
    console.log('Versioned artifacts identity evidence:', directory)
  } catch (error) {
    await writeFile(join(directory, 'failed.json'), JSON.stringify({ error: String(error), reads, calls }, null, 2), { flag: 'wx', mode: 0o600 }); throw error
  } finally {
    const errors: string[] = []
    for (const dispose of cleanup.reverse()) try { await dispose() } catch (error) { errors.push(String(error)) }
    await writeFile(join(directory, 'cleanup.json'), JSON.stringify({ complete: errors.length === 0, errors }), { flag: 'wx', mode: 0o600 })
    expect(errors).toEqual([])
  }
}, 60000)
