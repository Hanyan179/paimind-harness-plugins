import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { CellTransport } from '../src/cell-transport.js'
import { CellTransportDirectory, selectCellTransport } from '../src/cell-transport-directory.js'
import { Identity } from '../src/identity.js'
import { RuntimeAdmission } from '../src/runtime-admission.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { openPinnedOriginAuthority, RuntimeCellReloader, type RuntimeCellConfiguration } from '../src/runtime-cell-reload.js'

// Fresh, disposable PostgreSQL only. The ingress and reverse wire protocol are
// real; container/image IDs and feature responses are explicit contract fixtures.
// These tests do not exercise Harness objects, browser interaction or a model.
const path = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!path || statSync(path).mode & 0o077) throw Error('Private real DB fixture required')
const config = JSON.parse(readFileSync(path, 'utf8'))
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || !url.port
    || ['3080', '5432', '10012', '55857'].includes(url.port)) throw Error('Unsafe test database')
}
const owner = postgres(config.ownerUrl, { max: 2, onnotice: () => {} })
const app = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
const publicOrigin = 'http://127.0.0.1:62167' // Validation only; never requested/listened here.
const admission = new RuntimeAdmission(owner, publicOrigin)
const disposers: (() => Promise<unknown> | unknown)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const dispose of disposers.splice(0).reverse()) await dispose()
})
afterAll(async () => { await app.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })
const context = () => ({ key: randomUUID(), requestId: randomUUID() })
const hex = () => randomBytes(32).toString('hex')
const pinOf = ({ transportKey: _key, ...pin }: RuntimeCellConfiguration): PrivateRuntimeCell => pin

async function listen(server: Server): Promise<string> {
  for (let attempt = 0; attempt < 32; attempt++) {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('No isolated port')
    const origin = `http://127.0.0.1:${address.port}`
    if (origin !== publicOrigin && !(await owner`select 1 from haas.runtime_bindings where origin=${origin}`).length) return origin
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  throw Error('No unbound isolated port')
}
async function ingress(marker: string, token = hex()) {
  const native = createNativeIngress({ token, control: async () => ({ contractFixture: marker }) })
  disposers.push(() => native.close())
  const origin = await listen(native.server)
  let upgrades = 0
  native.server.on('upgrade', () => { upgrades++ })
  return { native, token, origin, upgrades: () => upgrades }
}
async function fixture(openAuthority = true) {
  const tenantId = `reload-${randomUUID()}`
  await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
  const identity = new Identity(app, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
  const password = 'Synthetic isolated reload password 2026'
  await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, context())
  const adminToken = (await identity.login({ username: 'morgan', password }, context())).token
  const members = []
  for (const [username, displayName] of [['alex', 'Alex'], ['hansen', 'Hansen']]) {
    const account = (await identity.createMember(adminToken, { username, displayName, password }, context())).data
    const token = (await identity.login({ username, password }, context())).token
    const endpoint = await ingress(username)
    const cell: RuntimeCellConfiguration = { cellId: randomUUID(), tenantId, userId: account.userId, role: 'member',
      revision: randomUUID(), origin: endpoint.origin, containerId: hex(), imageId: 'sha256:' + hex(),
      volumeName: 'paimind-haas-member-' + randomUUID(), policyDigest: 'sha256:' + hex(), transportKey: endpoint.token }
    await admission.admit(pinOf(cell))
    members.push({ cell, endpoint, token })
  }
  const [alex, hansen] = members
  const bindings = new RuntimeBindings(app, identity, publicOrigin, [], members.map(m => pinOf(m.cell)))
  const directory = new CellTransportDirectory(new Map(members.map(m => [m.cell.origin, new CellTransport(m.cell.origin, m.cell.transportKey)])), members.map(m => pinOf(m.cell)))
  const lifetime = new AbortController()
  disposers.push(() => { lifetime.abort(); for (const transport of directory.values()) transport.destroy() })
  if (openAuthority) for (const member of members) await openPinnedOriginAuthority(bindings, pinOf(member.cell), directory.get(member.cell.origin)!)
  const reloader = new RuntimeCellReloader(bindings, directory, members.map(m => m.cell), publicOrigin, lifetime.signal)
  return { alex: alex!, hansen: hansen!, members, bindings, directory, lifetime, reloader }
}
async function replacement(previous: RuntimeCellConfiguration, accept = true, token = previous.transportKey) {
  const endpoint = await ingress('alex-recovered', token)
  const cell = { ...previous, origin: endpoint.origin, revision: randomUUID(), containerId: hex() }
  if (accept) await admitReplacement(previous, cell)
  return { cell, endpoint }
}
async function admitReplacement(previous: RuntimeCellConfiguration, next: RuntimeCellConfiguration) {
  expect(await admission.suspend(pinOf(previous))).toBe(true)
  const [row] = await owner`select revision from haas.runtime_bindings where cell_id=${previous.cellId}`
  await admission.replaceSuspended({ ...pinOf(previous), revision: row!.revision }, pinOf(next))
}
const marker = (transport: CellTransport) => transport.requestControl('feature.describe', {})
async function healthy(f: Awaited<ReturnType<typeof fixture>>, original: CellTransport) {
  expect(f.directory.get(f.hansen.cell.origin)).toBe(original)
  expect(await marker(original)).toEqual({ contractFixture: 'hansen' })
  expect(await f.bindings.resolve(f.hansen.token, randomUUID())).toMatchObject({ revision: f.hansen.cell.revision, userId: f.hansen.cell.userId })
  expect(await f.hansen.endpoint.native.readSkillEligibility([])).toEqual([])
  expect(f.hansen.endpoint.upgrades()).toBe(1)
}

async function runningGateway(f: Awaited<ReturnType<typeof fixture>>) {
  const reservation = createServer(), origin = await listen(reservation)
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  const directory = await mkdtemp(join(dirname(path!), 'reload-cli-'))
  const configuration = { applicationUrl: config.applicationUrl, tenantId: f.alex.cell.tenantId,
    masterKey: config.masterKey, bootstrapSecret: config.bootstrapSecret, publicOrigin: origin,
    loopbackDevelopment: true, nativePrivateCells: f.members.map(m => m.cell) }
  const filename = join(directory, 'gateway.json')
  const write = (value: unknown) => writeFile(filename, JSON.stringify(value), { mode: 0o600 })
  await write(configuration)
  const child = spawn(process.execPath, [fileURLToPath(new URL('../lib/cli.js', import.meta.url)), filename], { stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', () => resolve()) })
  let stdout = '', stderr = '', stopped = false
  child.stdout.on('data', bytes => { stdout += bytes }); child.stderr.on('data', bytes => { stderr += bytes })
  const stop = async () => {
    if (stopped) return
    stopped = true
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000)
    try { await exited } finally { clearTimeout(deadline) }
    await writeFile(join(directory, 'stdout.log'), stdout, { mode: 0o600 })
    await writeFile(join(directory, 'stderr.log'), stderr, { mode: 0o600 })
    expect(child.exitCode).toBe(0); expect(child.signalCode).toBe(null)
  }
  disposers.push(stop)
  const messages = () => stdout.split('\n').filter(Boolean).map(line => JSON.parse(line))
  await vi.waitFor(() => {
    expect(child.exitCode).toBe(null)
    expect(messages().some(row => row.status === 'listening' && row.pid === child.pid)).toBe(true)
  }, { timeout: 8000 })
  const me = async (token: string) => {
    const result = await fetch(origin + '/haas/v1/auth/me', { headers: { cookie: `paimind_haas_session=${token}` }, signal: AbortSignal.timeout(5000) })
    const body = await result.json(); expect(result.status).toBe(200); return body
  }
  return { child, configuration, write, messages, errors: () => stderr.split('\n').filter(Boolean), me, stop }
}

describe('real PostgreSQL and private reverse-channel member replacement, not Browser E2E', () => {
  it('pins an issued grant even when the replacement actually listens at the retired private port', async () => {
    const f = await fixture(), oldGrant = await f.bindings.resolve(f.alex.token, randomUUID()), h = f.directory.get(f.hansen.cell.origin)!
    await f.alex.endpoint.native.close()
    const received:string[]=[]
    const native = createNativeIngress({ token: f.alex.cell.transportKey, control: async (operation:string) => {
      received.push(operation)
      return operation==='connector.restore'?{restored:[],pending:[]}:{ contractFixture: 'same-address-recovery' }
    } })
    disposers.push(() => native.close())
    // Deliberate reuse of this fixture's just-closed, exact original port.
    // Unlike a new fixture listener, it must retain this member's old DB URL.
    await new Promise<void>((resolve, reject) => {
      native.server.once('error', reject)
      native.server.listen(Number(new URL(f.alex.cell.origin).port), '127.0.0.1', () => { native.server.off('error', reject); resolve() })
    })
    const next = { ...f.alex.cell, revision: randomUUID(), containerId: hex() }
    await admitReplacement(f.alex.cell, next)
    expect(await f.reloader.apply([next, f.hansen.cell])).toMatchObject({ status: 'replaced' })
    expect(() => selectCellTransport(f.directory, oldGrant)).toThrow('固定修订')
    expect(received).toEqual(['connector.restore']) // new pinned lifecycle recovery only; no old-grant operation
    const current = await f.bindings.resolve(f.alex.token, randomUUID())
    expect(await marker(selectCellTransport(f.directory, current)!)).toEqual({ contractFixture: 'same-address-recovery' })
    expect(received).toEqual(['connector.restore','feature.describe']); expect(await native.readSkillEligibility([])).toEqual([])
    await healthy(f, h)
  })
  it('replaces one member repeatedly, rejects retired connections and preserves the healthy member', async () => {
    const f = await fixture(), original = f.directory.get(f.alex.cell.origin)!, h = f.directory.get(f.hansen.cell.origin)!
    expect(await marker(original)).toEqual({ contractFixture: 'alex' })
    expect(await f.alex.endpoint.native.readSkillEligibility([])).toEqual([])
    const [healthyRow] = await owner`select * from haas.runtime_bindings where cell_id=${f.hansen.cell.cellId}`
    const next = await replacement(f.alex.cell)
    await expect(f.bindings.resolve(f.alex.token, randomUUID())).rejects.toMatchObject({ code: 'runtime-unavailable' })
    await expect(f.alex.endpoint.native.readSkillEligibility([])).rejects.toThrow()
    await healthy(f, h)
    expect(await f.reloader.apply([next.cell, f.hansen.cell])).toEqual({ status: 'replaced', cellId: next.cell.cellId, revision: next.cell.revision })
    expect(f.directory.has(f.alex.cell.origin)).toBe(false)
    expect(await marker(f.directory.get(next.cell.origin)!)).toEqual({ contractFixture: 'alex-recovered' })
    expect(await next.endpoint.native.readSkillEligibility([])).toEqual([])
    await expect(marker(original)).rejects.toThrow()
    expect(await f.bindings.resolve(f.alex.token, randomUUID())).toMatchObject({ revision: next.cell.revision, origin: next.cell.origin, userId: f.alex.cell.userId })
    expect(await f.reloader.apply([f.hansen.cell, next.cell])).toEqual({ status: 'unchanged' })
    expect(next.endpoint.upgrades()).toBe(1)
    const again = await replacement(next.cell)
    expect(await f.reloader.apply([again.cell, f.hansen.cell])).toMatchObject({ status: 'replaced', revision: again.cell.revision })
    expect(await again.endpoint.native.readSkillEligibility([])).toEqual([])
    await expect(next.endpoint.native.readSkillEligibility([])).rejects.toThrow()
    await healthy(f, h)
    const [after] = await owner`select * from haas.runtime_bindings where cell_id=${f.hansen.cell.cellId}`
    expect(after).toEqual(healthyRow)
  })

  it.each(['unadmitted', 'expired', 'disabled-member', 'disabled-tenant', 'wrong-revision'] as const)('never dials a %s replacement', async condition => {
    const f = await fixture(), old = f.directory.get(f.alex.cell.origin)!, h = f.directory.get(f.hansen.cell.origin)!
    const next = await replacement(f.alex.cell, condition !== 'unadmitted')
    if (condition === 'expired') await owner`update haas.runtime_bindings set lease_expires_at=clock_timestamp() where cell_id=${next.cell.cellId}`
    if (condition === 'disabled-member') await owner`update haas.users set status='disabled' where user_id=${next.cell.userId}`
    if (condition === 'disabled-tenant') await owner`update haas.tenants set status='disabled' where tenant_id=${next.cell.tenantId}`
    if (condition === 'wrong-revision') next.cell.revision = randomUUID()
    await expect(f.reloader.apply([next.cell, f.hansen.cell])).rejects.toMatchObject({ code: 'runtime-replacement-unavailable' })
    expect(next.endpoint.upgrades()).toBe(0)
    expect(f.directory.get(f.alex.cell.origin)).toBe(old)
    f.bindings.assertPrivateCell(pinOf(f.alex.cell))
    // Disabling a tenant intentionally withdraws both accounts; it is not a
    // member-only failure and must not be reported as healthy authorization.
    if (condition === 'disabled-tenant') {
      await expect(f.bindings.resolve(f.hansen.token, randomUUID())).rejects.toMatchObject({ status: 401 })
      expect(f.directory.get(f.hansen.cell.origin)).toBe(h)
    } else await healthy(f, h)
  })

  it('leaves the old mapping intact after a failed authenticated handshake', async () => {
    const f = await fixture(), old = f.directory.get(f.alex.cell.origin)!, h = f.directory.get(f.hansen.cell.origin)!
    const next = await replacement(f.alex.cell, true, hex()) // Endpoint rejects the original control key.
    await expect(f.reloader.apply([next.cell, f.hansen.cell])).rejects.toThrow('unavailable')
    expect(next.endpoint.upgrades()).toBe(1)
    expect(f.directory.get(f.alex.cell.origin)).toBe(old)
    expect(f.directory.has(next.cell.origin)).toBe(false)
    await expect(f.bindings.resolve(f.alex.token, randomUUID())).rejects.toMatchObject({ code: 'runtime-unavailable' })
    await healthy(f, h)
  })

  it('rechecks actual admission after the handshake and discards a withdrawn candidate', async () => {
    const f = await fixture(), old = f.directory.get(f.alex.cell.origin)!, h = f.directory.get(f.hansen.cell.origin)!
    const next = await replacement(f.alex.cell), publish = f.bindings.replacePrivateCell.bind(f.bindings)
    // Only the timing is instrumented; withdrawal and both authorization reads
    // use the real owner/application PostgreSQL roles and real private socket.
    vi.spyOn(f.bindings, 'replacePrivateCell').mockImplementationOnce(async (...args) => {
      expect(next.endpoint.upgrades()).toBe(1)
      expect(await admission.suspend(pinOf(next.cell))).toBe(true)
      return publish(...args)
    })
    await expect(f.reloader.apply([next.cell, f.hansen.cell])).rejects.toMatchObject({ code: 'runtime-replacement-unavailable' })
    expect(f.directory.get(f.alex.cell.origin)).toBe(old)
    expect(f.directory.has(next.cell.origin)).toBe(false)
    await expect(next.endpoint.native.readSkillEligibility([])).rejects.toThrow()
    await healthy(f, h)
  })

  it('aborts a stalled handshake, rejects concurrent reload, and never publishes after shutdown', async () => {
    const f = await fixture(), old = f.directory.get(f.alex.cell.origin)!, h = f.directory.get(f.hansen.cell.origin)!
    const server = createServer(), entered = Promise.withResolvers<void>(), sockets = new Set<Socket>()
    server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)) })
    server.on('upgrade', () => entered.resolve()) // Deliberately never acknowledges the private handshake.
    disposers.push(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())) })
    const next = { ...f.alex.cell, revision: randomUUID(), containerId: hex(), origin: await listen(server) }
    await admitReplacement(f.alex.cell, next)
    const pending = f.reloader.apply([next, f.hansen.cell]), rejected = expect(pending).rejects.toThrow()
    await entered.promise
    await expect(f.reloader.apply([next, f.hansen.cell])).rejects.toThrow('already in progress')
    const stoppedAt = performance.now(); f.lifetime.abort(); await rejected
    expect(performance.now() - stoppedAt).toBeLessThan(1500)
    expect(f.directory.get(f.alex.cell.origin)).toBe(old)
    await expect(f.reloader.apply([next, f.hansen.cell])).rejects.toThrow()
    await healthy(f, h)
  })

  it('uses the built gateway SIGHUP path without restarting the process or healthy private connection', async () => {
    const f = await fixture(false), gateway = await runningGateway(f), pid = gateway.child.pid
    await gateway.me(f.alex.token); await gateway.me(f.hansen.token)
    expect(await f.alex.endpoint.native.readSkillEligibility([])).toEqual([])
    const next = await replacement(f.alex.cell)
    await gateway.write({ ...gateway.configuration, nativePrivateCells: [next.cell, f.hansen.cell] })
    gateway.child.kill('SIGHUP')
    await vi.waitFor(() => expect(gateway.messages()).toContainEqual(expect.objectContaining({ event: 'runtime-cell-reload', status: 'replaced', revision: next.cell.revision })))
    expect(await next.endpoint.native.readSkillEligibility([])).toEqual([])
    await expect(f.alex.endpoint.native.readSkillEligibility([])).rejects.toThrow()
    expect(await f.hansen.endpoint.native.readSkillEligibility([])).toEqual([])
    expect(f.hansen.endpoint.upgrades()).toBe(1)
    // Same private inventory is an acknowledged no-op, not a second dial.
    gateway.child.kill('SIGHUP')
    await vi.waitFor(() => expect(gateway.messages()).toContainEqual(expect.objectContaining({ event: 'runtime-cell-reload', status: 'unchanged' })))
    expect(next.endpoint.upgrades()).toBe(1)
    await gateway.write({ ...gateway.configuration, tenantId: 'forbidden-change', nativePrivateCells: [next.cell, f.hansen.cell] })
    gateway.child.kill('SIGHUP')
    await vi.waitFor(() => expect(gateway.errors()).toHaveLength(1))
    await gateway.me(f.alex.token); await gateway.me(f.hansen.token)
    expect(await next.endpoint.native.readSkillEligibility([])).toEqual([])
    expect(await f.hansen.endpoint.native.readSkillEligibility([])).toEqual([])
    expect(gateway.child.pid).toBe(pid); expect(gateway.child.exitCode).toBe(null)
    expect(gateway.messages().filter(row => row.status === 'listening')).toHaveLength(1)
    await gateway.stop()
  })

  it('joins an in-progress reload when the built gateway receives SIGTERM', async () => {
    const f = await fixture(false), gateway = await runningGateway(f)
    const server = createServer(), entered = Promise.withResolvers<void>(), sockets = new Set<Socket>()
    server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)) })
    server.on('upgrade', () => entered.resolve())
    disposers.push(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())) })
    const next = { ...f.alex.cell, revision: randomUUID(), containerId: hex(), origin: await listen(server) }
    await admitReplacement(f.alex.cell, next)
    await gateway.write({ ...gateway.configuration, nativePrivateCells: [next, f.hansen.cell] })
    gateway.child.kill('SIGHUP'); await entered.promise
    const stoppingAt = performance.now(); await gateway.stop()
    expect(performance.now() - stoppingAt).toBeLessThan(3000)
    expect(gateway.messages().some(row => row.event === 'runtime-cell-reload' && row.status === 'replaced')).toBe(false)
  })
})
