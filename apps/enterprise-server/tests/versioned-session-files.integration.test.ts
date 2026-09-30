import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterAll, expect, it, vi } from 'vitest'
import { Identity } from '../src/identity.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { NativeGateway } from '../src/native-gateway.js'
import { createEnterpriseServer } from '../src/server.js'
import { CellTransport } from '../src/cell-transport.js'
import { CellTransportDirectory } from '../src/cell-transport-directory.js'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { createNativeControlBroker, createNativeControlPeer, handleNativeControl } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { isolatedDatabase } from './fixtures/isolated-database.js'

// Real PostgreSQL/identity/audit/HTTP/private control. Directory/content values and
// container pins are explicit fixtures; this is not native file or Browser E2E.
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
  throw Error('No unused test origin; historical bindings preserved')
}
it('enforces the original versioned files route with real two-member identity, cross-tenant denial and audit', async () => {
  const directory = await mkdtemp(join(config.evidence, 'directory-auth-')), cleanup: Array<() => unknown | Promise<unknown>> = []
  const reads: object[] = [], calls: object[] = [], tenantId = 'files-' + randomUUID()
  const password = 'Synthetic directory route password 2026'
  try {
    await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
    const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
    await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, command())
    const admin = (await identity.login({ username: 'morgan', password }, command())).token
    cleanup.push(() => identity.logout(admin, {}, command()))
    const cells = []
    for (const username of ['hansen', 'alex']) {
      const account = (await identity.createMember(admin, { username, displayName: username === 'hansen' ? 'Hansen' : 'Alex', password }, command())).data
      const token = (await identity.login({ username, password }, command())).token, logoutCommand = command()
      const logout = () => identity.logout(token, {}, logoutCommand); cleanup.push(logout)
      const key = randomBytes(32).toString('hex')
      const broker = await createNativeControlBroker(); cleanup.push(() => broker.close())
      const peer = createNativeControlPeer(createConnection(broker.path), { handle: (operation, input, signal) => handleNativeControl({ get: () => ({
        directory: async (sessionId: string, path: string | undefined) => {
          calls.push({ username, sessionId, path })
          if (![username + '-session', 'same-native-id'].includes(sessionId) || path !== undefined && path !== '/workspace/' + username) throw Error('Private native source')
          return { path: '/workspace/' + username, entries: [{ name: username + '.txt', path: '/workspace/' + username + '/' + username + '.txt',
            type: 'file', symlink: false, unavailable: false }], truncated: false }
        }, file: async (sessionId: string, path: string, offset: number, version: string | undefined) => {
          calls.push({ username, sessionId, path, offset, version })
          if (![username + '-session', 'same-native-id'].includes(sessionId) || ![username + '.txt', '/workspace/' + username + '/' + username + '.txt'].includes(path)) throw Error('Private native source')
          const content = Buffer.from((username + ' PRIVATE_CONTENT\n').repeat(7000)), expected = 'a'.repeat(64)
          if (version !== undefined && version !== expected) throw Error('Private native source')
          return { path: '/workspace/' + username + '/' + username + '.txt', offset, size: content.length, version: expected,
            data: content.subarray(offset, offset + 65536).toString('base64'), nextOffset: offset + 65536 < content.length ? offset + 65536 : null }
        } }) }, operation, input, signal) })
      cleanup.push(() => peer.close()); await vi.waitFor(() => expect(broker.ready).toBe(true))
      const ingress = createNativeIngress({ token: key, control: (operation, input, signal) => broker.request(operation, input, signal) })
      cleanup.push(() => ingress.close())
      const origin = await listen(ingress.server), transport = new CellTransport(origin, key)
      cleanup.push(() => transport.destroy())
      const pin: PrivateRuntimeCell = { cellId: randomUUID(), tenantId, userId: account.userId, role: 'member', origin, revision: randomUUID(),
        containerId: randomBytes(32).toString('hex'), imageId: 'sha256:' + 'd'.repeat(64),
        volumeName: 'paimind-haas-member-fixture-' + randomUUID(), policyDigest: 'sha256:' + 'e'.repeat(64) }
      await owner`insert into haas.runtime_bindings (cell_id,tenant_id,user_id,origin,revision,isolation_mode,status,lease_expires_at,container_id,image_id,volume_name,policy_digest)
        values (${pin.cellId},${tenantId},${pin.userId},${origin},${pin.revision},'container-managed','ready',clock_timestamp()+interval '10 minutes',
        ${pin.containerId},${pin.imageId},${pin.volumeName},${pin.policyDigest})`
      cells.push({ username, token, pin, transport, logout })
    }
    const reservation = createServer(), publicOrigin = await listen(reservation); await close(reservation)
    const bindings = new RuntimeBindings(sql, identity, publicOrigin, [], cells.map(cell => cell.pin))
    for (const cell of cells) await cell.transport.openOriginAuthority((input, signal) => bindings.checkInteractiveOrigins(cell.pin.cellId, input, signal),
      (input, signal) => bindings.authorizeInteractiveExecution(cell.pin.cellId, input, signal),
      (input, signal) => bindings.deriveInteractiveOrigins(cell.pin.cellId, input, signal),
      (input, signal) => bindings.sealJobOrigins(cell.pin.cellId, input, signal),
      (input, signal) => bindings.readSkillEligibility(cell.pin.cellId, input, signal))
    const gateway = new NativeGateway({ publicOrigin,
      transports: new CellTransportDirectory(new Map(cells.map(cell => [cell.pin.origin, cell.transport])), cells.map(cell => cell.pin)),
      resolve: (...args) => bindings.resolve(...args), authorize: (...args) => identity.authorizeRuntimeOperation(...args) })
    cleanup.push(() => gateway.close())
    const server = createEnterpriseServer({ identity, publicOrigin, nativeGateway: gateway, loopbackDevelopment: true })
    await new Promise<void>(resolve => server.listen(Number(new URL(publicOrigin).port), '127.0.0.1', resolve)); cleanup.push(() => close(server))
    const get = async (sessionId: string, token?: string, suffix = '') => {
      const response = await fetch(publicOrigin + '/haas/v1/sessions/' + sessionId + '/files' + suffix,
        { headers: token ? { cookie: 'paimind_haas_session=' + token } : {}, signal: AbortSignal.timeout(15000) })
      const body = await response.json()
      expect(body.requestId).toBe(response.headers.get('x-request-id')); expect(response.headers.get('cache-control')).toBe('no-store')
      reads.push({ sessionId, suffix, status: response.status, body })
      return { status: response.status, body }
    }
    const preview = async (sessionId: string, path: string, token?: string) => {
      const response = await fetch(publicOrigin + '/sidebar/api/fs.read', { method: 'POST', headers: { origin: publicOrigin, 'content-type': 'application/json',
        ...(token ? { cookie: 'paimind_haas_session=' + token } : {}) }, body: JSON.stringify({ sessionId, path, cwd: '/untrusted', repoRoot: '/untrusted' }), signal: AbortSignal.timeout(15000) })
      const body = await response.json(), requestId = response.headers.get('x-request-id')
      expect(response.headers.get('cache-control')).toBe('no-store')
      // Evidence records only the synthetic body length; credentials never enter it.
      reads.push({ route: 'fs.read', sessionId, path, status: response.status, requestId, kind: body.value?.kind, bytes: body.value?.content?.length })
      return { status: response.status, body, requestId }
    }
    const download = async (sessionId: string, path: string, token?: string) => {
      const response = await fetch(publicOrigin + '/sidebar/file?' + new URLSearchParams({ sessionId, path, cwd: '/untrusted', download: '1' }),
        { headers: token ? { cookie: 'paimind_haas_session=' + token } : {}, signal: AbortSignal.timeout(15000) })
      const body = Buffer.from(await response.arrayBuffer()), requestId = response.headers.get('x-request-id')
      expect(response.headers.get('cache-control')).toBe('no-store')
      if (response.status === 200) { expect(Number(response.headers.get('content-length'))).toBe(body.length); expect(response.headers.get('content-disposition')).toMatch(/^attachment;/) }
      reads.push({ route: 'file-download', sessionId, path, status: response.status, requestId, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') })
      return { status: response.status, body, requestId }
    }
    for (const cell of cells) {
      for (const sessionId of [cell.username + '-session', 'same-native-id']) {
        const result = await get(sessionId, cell.token)
        expect(result.status).toBe(200)
        expect(result.body.data.entries.map((row: any) => row.name)).toEqual([cell.username + '.txt'])
      }
      const foreign = cells.find(other => other !== cell)!
      for (const sessionId of [foreign.username + '-session', 'missing-session']) {
        const result = await get(sessionId, cell.token); expect(result.status).toBe(403)
        expect(JSON.stringify(result.body)).not.toContain('Private native source')
        const [event] = await owner`select actor_user_id, outcome from haas.audit_events where tenant_id=${tenantId} and request_id=${result.body.requestId}`
        expect(event).toMatchObject({ actor_user_id: cell.pin.userId, outcome: 'denied' })
      }
      expect((await get(cell.username + '-session', cell.token, '?path=/workspace/' + foreign.username)).status).toBe(403)
      expect((await get(cell.username + '-session', cell.token, '?userId=' + foreign.pin.userId)).status).toBe(400)
      for (const sessionId of [cell.username + '-session', 'same-native-id']) {
        const result = await preview(sessionId, cell.username + '.txt', cell.token)
        expect(result.status).toBe(200)
        expect(result.body).toEqual({ ok: true, value: { kind: 'text', content: (cell.username + ' PRIVATE_CONTENT\n').repeat(7000), truncated: false } })
        expect(result.body.value.content).not.toContain(foreign.username)
      }
      for (const [sessionId, path] of [[foreign.username + '-session', foreign.username + '.txt'], ['same-native-id', '/workspace/' + foreign.username + '/' + foreign.username + '.txt']]) {
        const result = await preview(sessionId!, path!, cell.token); expect(result.status).toBe(403)
        expect(JSON.stringify(result.body)).not.toMatch(/PRIVATE_CONTENT|Private native source/)
        const audit = await owner`select actor_user_id, outcome from haas.audit_events where tenant_id=${tenantId} and request_id=${result.requestId!}`
        expect(audit.some(event => event.actor_user_id === cell.pin.userId && event.outcome === 'denied')).toBe(true)
      }
      for (const sessionId of [cell.username + '-session', 'same-native-id']) {
        const result = await download(sessionId, cell.username + '.txt', cell.token)
        expect(result.status).toBe(200); expect(result.body.equals(Buffer.from((cell.username + ' PRIVATE_CONTENT\n').repeat(7000)))).toBe(true)
      }
      for (const [sessionId, path] of [[foreign.username + '-session', foreign.username + '.txt'], ['same-native-id', '/workspace/' + foreign.username + '/' + foreign.username + '.txt']]) {
        const result = await download(sessionId!, path!, cell.token); expect(result.status).toBe(403); expect(result.body.toString()).not.toContain('PRIVATE_CONTENT')
        const audit = await owner`select actor_user_id, outcome from haas.audit_events where tenant_id=${tenantId} and request_id=${result.requestId!}`
        expect(audit.some(event => event.actor_user_id === cell.pin.userId && event.outcome === 'denied')).toBe(true)
      }
    }
    const before = calls.length
    expect((await get('hansen-session')).status).toBe(401)
    expect((await get('hansen-session', admin)).status).toBeGreaterThanOrEqual(400)
    const otherTenant = 'files-foreign-' + randomUUID()
    await owner`insert into haas.tenants (tenant_id) values (${otherTenant})`
    const other = new Identity(sql, otherTenant, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
    await other.bootstrap({ username: 'taylor', displayName: 'Taylor', password, bootstrapSecret: config.bootstrapSecret }, command())
    const otherToken = (await other.login({ username: 'taylor', password }, command())).token
    cleanup.push(() => other.logout(otherToken, {}, command()))
    expect((await get('hansen-session', otherToken)).status).toBe(401)
    expect((await preview('hansen-session', 'hansen.txt')).status).toBe(401)
    expect((await preview('hansen-session', 'hansen.txt', otherToken)).status).toBe(401)
    expect((await download('hansen-session', 'hansen.txt')).status).toBe(401)
    expect((await download('hansen-session', 'hansen.txt', otherToken)).status).toBe(401)
    expect(calls).toHaveLength(before)
    await cells[0]!.logout()
    expect((await get('hansen-session', cells[0]!.token)).status).toBe(401)
    expect((await get('alex-session', cells[1]!.token)).status).toBe(200)
    expect((await preview('hansen-session', 'hansen.txt', cells[0]!.token)).status).toBe(401)
    expect((await preview('alex-session', 'alex.txt', cells[1]!.token)).status).toBe(200)
    expect((await download('hansen-session', 'hansen.txt', cells[0]!.token)).status).toBe(401)
    expect((await download('alex-session', 'alex.txt', cells[1]!.token)).status).toBe(200)
    await writeFile(join(directory, 'receipt.json'), JSON.stringify({ status: 'FILES_ROUTE_REAL_IDENTITY_PASSED', tenantId, reads, calls,
      realPostgres: true, realPrivateHttp: true, nativeDirectoryValues: 'explicit-fixture', nativeFileContent: 'explicit-fixture', containerPins: 'explicit-fixture', browserE2E: false }, null, 2), { flag: 'wx', mode: 0o600 })
    console.log('Versioned files authentication evidence:', directory)
  } catch (error) {
    await writeFile(join(directory, 'failed.json'), JSON.stringify({ error: String(error), reads, calls }, null, 2), { flag: 'wx', mode: 0o600 }); throw error
  } finally {
    const errors: string[] = []
    for (const dispose of cleanup.reverse()) try { await dispose() } catch (error) { errors.push(String(error)) }
    await writeFile(join(directory, 'cleanup.json'), JSON.stringify({ complete: errors.length === 0, errors }), { flag: 'wx', mode: 0o600 })
    expect(errors).toEqual([])
  }
}, 60000)
