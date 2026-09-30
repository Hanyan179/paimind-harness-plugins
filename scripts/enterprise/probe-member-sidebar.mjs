import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer as reserveServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

// Real current cells + real DB + a disposable new gateway. No cell restart,
// model request, account creation or native business write. Fresh test logins
// are logged out individually; existing browser sessions are never revoked.
// This diagnostic does NOT operate a browser or claim Browser E2E acceptance.
assert.equal(process.argv.length, 4)
const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
const evidenceRoot = await realpath(join(root, '../.paimind-goal-evidence'))
const runtime = await realpath(process.argv[2]), credentialPath = await realpath(process.argv[3])
assert.ok(dirname(runtime) === evidenceRoot && runtime.startsWith(evidenceRoot + '/haas-member-browser-cells-'))
assert.ok(dirname(dirname(credentialPath)) === evidenceRoot && dirname(credentialPath).startsWith(evidenceRoot + '/haas-members-normal-names-'))
async function privateJson(path) {
  const stat = await lstat(path)
  assert.ok(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid() && (stat.mode & 0o077) === 0)
  assert.equal(await realpath(path), path)
  return JSON.parse(await readFile(path, 'utf8'))
}
const operator = await privateJson(join(runtime, 'operator-state.json'))
const config = await privateJson(join(runtime, 'gateway-config.json'))
const previous = await privateJson(join(runtime, 'after-fix-readback.json'))
const credentials = await privateJson(credentialPath)
assert.equal(operator.sourceRoot, root)
assert.equal(operator.cells.length, 2); assert.equal(config.nativePrivateCells.length, 2)
assert.deepEqual(operator.cells.map(cell => cell.member).sort(), ['alex', 'hansen'])
const database = new URL(config.applicationUrl)
assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.pathname, '/haas_e2e')
assert.ok(!['3080', '5432', '10012'].includes(database.port))
const require = createRequire(join(root, 'apps/enterprise-server/package.json'))
const postgres = require('postgres'), WebSocket = require('ws')
const inspect = () => operator.cells.map(cell => {
  const [actual] = JSON.parse(execFileSync('docker', ['inspect', cell.pin.containerId], { encoding: 'utf8' }))
  assert.equal(actual.Id, cell.pin.containerId); assert.equal(actual.Image, cell.pin.imageId)
  assert.equal(actual.State.Running, true); assert.equal(actual.Config.User, '10001:10001')
  assert.equal(actual.HostConfig.ReadonlyRootfs, true); assert.equal(actual.HostConfig.Privileged, false)
  assert.ok(actual.Mounts.some(mount => mount.Type === 'volume' && mount.Name === cell.pin.volumeName))
  const configured = config.nativePrivateCells.find(pin => pin.cellId === cell.pin.cellId)
  for (const [key, value] of Object.entries(cell.pin)) assert.equal(configured[key], value)
  return { member: cell.member, cellId: cell.pin.cellId, containerId: actual.Id, imageId: actual.Image,
    startedAt: actual.State.StartedAt, volume: cell.pin.volumeName }
})
const before = inspect()
process.umask(0o077)
const evidence = await mkdtemp(join(evidenceRoot, 'haas-member-sidebar-'))
console.log(JSON.stringify({ status: 'TESTING_REAL_MEMBER_SIDEBAR', evidence, runtime, browserE2EVerified: false }))

// Freeze only this repository's control-plane code; published dependencies
// resolve to their exact existing installed files, not an evidence-local tree.
const artifact = join(evidence, 'probe-runtime.mjs')
const built = await build({ stdin: { contents: `
export { Identity } from './apps/enterprise-server/src/identity.ts';
export { NativeGateway } from './apps/enterprise-server/src/native-gateway.ts';
export { RuntimeBindings } from './apps/enterprise-server/src/runtime-bindings.ts';
export { CellTransport } from './apps/enterprise-server/src/cell-transport.ts';
export { createEnterpriseServer } from './apps/enterprise-server/src/server.ts';
`, resolveDir: root, loader: 'ts' }, outfile: artifact, bundle: true, platform: 'node', format: 'esm', target: 'node24', metafile: true,
  plugins: [{ name: 'exact-installed-external-files', setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, async args => {
      if (args.path.startsWith('node:')) return { path: args.path, external: true }
      if (args.pluginData === 'resolve-installed-entry') return undefined
      const result = await builder.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind,
        pluginData: 'resolve-installed-entry' })
      return { path: result.path, external: true, errors: result.errors, warnings: result.warnings }
    })
  } }] })
const inputs = []
for (const path of Object.keys(built.metafile.inputs).filter(path => path !== '<stdin>')) {
  const absolute = await realpath(resolve(root, path)); assert.ok(absolute.startsWith(root + '/'))
  inputs.push({ path, sha256: createHash('sha256').update(await readFile(absolute)).digest('hex') })
}
for (const path of ['packages/harness-compat/lib/gateway-transport.js', 'packages/better-sidebar-adapter/lib/index.js']) {
  inputs.push({ path, sha256: createHash('sha256').update(await readFile(join(root, path))).digest('hex') })
}
await writeFile(join(evidence, 'inputs.json'), JSON.stringify({ sourceRoot: root, runtime, before, inputs }, null, 2))
const { Identity, NativeGateway, RuntimeBindings, CellTransport, createEnterpriseServer } = await import(pathToFileURL(artifact).href)
const reservation = reserveServer()
await new Promise((done, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', done) })
const address = reservation.address(); assert.ok(address && typeof address !== 'string' && address.port !== 3080)
const publicOrigin = `http://127.0.0.1:${address.port}`
assert.notEqual(publicOrigin, config.publicOrigin)
await new Promise(done => reservation.close(done))
const sql = postgres(config.applicationUrl, { max: 4, connect_timeout: 5, onnotice: () => {},
  connection: { statement_timeout: 5_000, lock_timeout: 5_000 } })
const identity = new Identity(sql, config.tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
const cells = config.nativePrivateCells.map(({ transportKey: _secret, ...pin }) => pin)
const userIds = cells.map(cell => cell.userId)
const readLogins = () => sql`select session_id, user_id, revoked_at, expires_at from haas.login_sessions
  where tenant_id=${config.tenantId} and user_id in ${sql(userIds)} order by session_id`
const oldLogins = Array.from(await readLogins())
const bindings = new RuntimeBindings(sql, identity, publicOrigin, [], cells)
const transports = new Map(config.nativePrivateCells.map(cell => [cell.origin, new CellTransport(cell.origin, cell.transportKey)]))
const authorizedRequests = new Set()
const gateway = new NativeGateway({ publicOrigin, transports, resolve: (token, id) => bindings.resolve(token, id),
  authorize: (token, id, grant, request, verify) => {
    authorizedRequests.add(id)
    return identity.authorizeRuntimeOperation(token, id, grant, request, verify)
  } })
const server = createEnterpriseServer({ identity, publicOrigin, nativeGateway: gateway, loopbackDevelopment: true })
const sessions = [], sockets = [], operations = []
const command = () => ({ key: randomUUID(), requestId: randomUUID() })
let phase = 'listen', passed = false, receipt
const connect = (token, path) => {
  const socket = new WebSocket(publicOrigin.replace('http:', 'ws:') + path,
    { headers: { origin: publicOrigin, cookie: `paimind_haas_session=${token}` }, handshakeTimeout: 8_000 })
  sockets.push(socket); socket.on('error', () => {})
  return socket
}
const opened = socket => new Promise((done, reject) => {
  socket.once('open', done); socket.once('error', reject)
  socket.once('unexpected-response', (_request, response) => { response.resume(); socket.terminate(); reject(Error('Rejected owned session')) })
})
const closed = socket => new Promise((done, reject) => {
  if (socket.readyState === WebSocket.CLOSED) { done(); return }
  const timer = setTimeout(() => reject(Error('Connection did not close')), 6_000)
  socket.once('close', () => { clearTimeout(timer); done() })
})
const denied = socket => new Promise((done, reject) => {
  socket.once('open', () => reject(Error('Unexpected accepted session')))
  socket.once('unexpected-response', (_request, response) => { response.resume(); socket.terminate(); done(response.statusCode) })
  socket.once('error', reject)
})
try {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(address.port, '127.0.0.1', done) })
  for (const snapshot of before) {
    phase = `${snapshot.member}:login`
    const credential = credentials.members.find(value => value.username === snapshot.member)
    assert.ok(credential)
    const login = await identity.login({ username: credential.username, password: credential.password }, command())
    sessions.push({ member: snapshot.member, token: login.token, closed: false })
    const account = await identity.me(login.token, randomUUID())
    const pin = cells.find(cell => cell.cellId === snapshot.cellId)
    assert.equal(account.userId, pin.userId); assert.equal(account.role, 'member')
    const grant = await bindings.resolve(login.token, randomUUID())
    assert.equal(grant.cellId, snapshot.cellId); assert.equal(grant.transport, 'private-cell')
  }
  for (const session of sessions) {
    const own = previous.find(row => row.member === session.member)
    const foreign = previous.find(row => row.member !== session.member)
    assert.equal(own.sessions.items.length, 1); assert.equal(foreign.sessions.items.length, 1)
    for (const path of ['/sidebar/ws/agent-terminals', '/sidebar/ws/agent-opens']) {
      phase = `${session.member}:${path}:own`
      const target = path + '?sessionId=' + encodeURIComponent(own.sessions.items[0].sessionId)
      const socket = connect(session.token, target)
      await opened(socket)
      operations.push({ member: session.member, path, kind: 'own-native-session', status: 'connected' })
      const stopped = closed(socket); socket.send('diagnostic-not-an-application-channel'); await stopped
      operations.push({ member: session.member, path, kind: 'browser-application-frame', status: 'connection-closed' })
      for (const [kind, id] of [['foreign-known-id', foreign.sessions.items[0].sessionId], ['unknown-id', 'session-' + randomUUID()]]) {
        phase = `${session.member}:${path}:${kind}`
        assert.equal(await denied(connect(session.token, path + '?sessionId=' + encodeURIComponent(id))), 403)
        operations.push({ member: session.member, path, kind, status: 'denied-403' })
      }
    }
  }
  phase = 'independent-login-revocation'
  const active = sessions.map(session => connect(session.token, '/sidebar/ws/agent-opens?sessionId=' +
    encodeURIComponent(previous.find(row => row.member === session.member).sessions.items[0].sessionId)))
  await Promise.all(active.map(opened))
  const revoked = closed(active[0])
  await identity.logout(sessions[0].token, {}, command()); sessions[0].closed = true
  await revoked
  assert.equal(active[1].readyState, WebSocket.OPEN)
  await identity.me(sessions[1].token, randomUUID())
  operations.push({ kind: 'one-login-revoked', revokedMember: sessions[0].member, retainedMember: sessions[1].member, status: 'isolated' })
  const after = inspect(); assert.deepEqual(after, before)
  const audit = await sql`select request_id, actor_user_id, action, outcome, reason from haas.audit_events
    where tenant_id=${config.tenantId} and request_id in ${sql([...authorizedRequests])} order by request_id`
  assert.equal(audit.length, 8)
  assert.ok(audit.every(row => row.action === 'runtime.operation' && row.outcome === 'denied' && row.reason === 'native-session-denied'))
  for (const id of userIds) assert.equal(audit.filter(row => row.actor_user_id === id).length, 4)
  for (const input of inputs) assert.equal(createHash('sha256').update(await readFile(resolve(root, input.path))).digest('hex'), input.sha256)
  receipt = { status: 'REAL_MEMBER_SIDEBAR_TRANSPORT_PASSED', publicOrigin,
    runtime, before, after, operations, audit, backendReadbackVerified: true, browserE2EVerified: false, finalWorkerImageAccepted: false,
    businessRecordsWritten: false, existingBrowserLoginsRevoked: false }
  passed = true
} catch {
  await writeFile(join(evidence, 'failure.json'), JSON.stringify({ status: 'FAILED', phase, operations, browserE2EVerified: false }, null, 2))
  console.error(JSON.stringify({ status: 'REAL_MEMBER_SIDEBAR_FAILED', phase, evidence }))
  process.exitCode = 1
} finally {
  for (const socket of sockets) socket.terminate()
  gateway.close(); server.closeAllConnections()
  await new Promise(done => server.close(done))
  let loginReadbackVerified = false
  try {
    for (const session of sessions) if (!session.closed) { await identity.logout(session.token, {}, command()); session.closed = true }
    const all = Array.from(await readLogins())
    const oldIds = new Set(oldLogins.map(row => row.session_id))
    assert.deepEqual(all.filter(row => oldIds.has(row.session_id)), oldLogins)
    const created = all.filter(row => !oldIds.has(row.session_id))
    assert.equal(created.length, sessions.length)
    assert.ok(created.every(row => row.revoked_at !== null))
    loginReadbackVerified = true
    await writeFile(join(evidence, 'test-login-closure.json'), JSON.stringify({ existingCount: oldLogins.length,
      existingLoginsUnchanged: true, createdTestLogins: created }, null, 2))
  } catch {
    passed = false; process.exitCode = 1
    await writeFile(join(evidence, 'cleanup-failure.json'), JSON.stringify({ phase: 'test-login-closure',
      createdLogins: sessions.length, logoutsCompleted: sessions.filter(session => session.closed).length }))
    console.error(JSON.stringify({ status: 'REAL_MEMBER_SIDEBAR_CLEANUP_FAILED', evidence }))
  }
  finally { await sql.end({ timeout: 5 }) }
  await writeFile(join(evidence, 'closed.json'), JSON.stringify({ probeGatewayClosed: true,
    createdTestLoginsRevoked: sessions.every(session => session.closed), loginReadbackVerified,
    liveMembersRestarted: false, userVolumesRemoved: false }, null, 2))
}
if (passed) {
  await writeFile(join(evidence, 'result.json'), JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify({ status: 'REAL_MEMBER_SIDEBAR_TRANSPORT_PASSED', evidence, checks: operations.length,
    browserE2EVerified: false, liveMembersRestarted: false }))
}
