import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import postgres from 'postgres'
import WebSocket from 'ws'
import { expect, it } from 'vitest'
import { Identity } from '../src/identity.js'
import { NativeGateway } from '../src/native-gateway.js'
import { RuntimeBindings, developmentCellOrigin } from '../src/runtime-bindings.js'
import { createEnterpriseServer } from '../src/server.js'

// This gate is intentionally separate from ordinary tests: no optional/mock
// fallback and no silent skip when the owned real Harness fixture is absent.
const configPath = process.env.PAIMIND_HAAS_TEST_CONFIG
const nativeFixture = process.env.PAIMIND_HAAS_NATIVE_FIXTURE
const nativeOrigin = process.env.PAIMIND_HAAS_NATIVE_ORIGIN
if (!configPath || !nativeFixture || !nativeOrigin || (statSync(configPath).mode & 0o077) !== 0) throw new Error('Explicit private database and real native fixture required')
const root = realpathSync(process.cwd())
const ready = JSON.parse(readFileSync(resolve(nativeFixture, 'ready.json'), 'utf8'))
const receipt = JSON.parse(readFileSync(resolve(nativeFixture, 'fixture.json'), 'utf8'))
if (ready.state !== 'profile-prepared' || receipt.root !== root || receipt.nativeVersion !== '0.1.1-rc.2'
  || ready.dshHome !== resolve(nativeFixture, 'dsh-home') || ready.patch !== resolve(nativeFixture, 'enterprise-native.patch.yml')) throw new Error('Not this worktree\'s native fixture')
const target = developmentCellOrigin(nativeOrigin, 'http://127.0.0.1:3080')
const pid = execFileSync('/usr/sbin/lsof', ['-t', `-iTCP:${target.port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim()
if (!/^\d+$/u.test(pid)) throw new Error('Ambiguous native listener')
const cwd = execFileSync('/usr/sbin/lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
const command = execFileSync('/bin/ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' })
if (!cwd.split('\n').includes(`n${realpathSync(nativeFixture)}`) || !command.includes(`${root}/node_modules/@deepseek-ai/dsh/lib/bin.js`)
  || !command.includes(ready.patch)) throw new Error('Native process ownership changed; do not probe another runtime')
const config = JSON.parse(readFileSync(configPath, 'utf8')) as { ownerUrl: string; applicationUrl: string; masterKey: string; bootstrapSecret: string }
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || ['3080', '5432', '10012'].includes(url.port)) throw new Error('Not an isolated database')
}

it('authenticates real native HTML, host.describe and both live downlinks, then revokes them on logout (not browser acceptance)', async () => {
  const evidence = await mkdtemp(resolve(root, '../.paimind-goal-evidence/haas-gateway-native-'))
  const owner = postgres(config.ownerUrl, { max: 1, onnotice: () => {} })
  const sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
  const tenantId = `native-probe-${randomUUID()}`
  const cellId = randomUUID()
  let server: ReturnType<typeof createEnterpriseServer> | undefined
  let gateway: NativeGateway | undefined
  const sockets: WebSocket[] = []
  try {
    await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
    const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
    const credentials = { username: 'admin', password: 'Synthetic native gateway password 2026' }
    const context = () => ({ key: randomUUID(), requestId: randomUUID() })
    const administrator = (await identity.bootstrap({ ...credentials, displayName: '原生网关验收', bootstrapSecret: config.bootstrapSecret }, context())).data
    const token = (await identity.login(credentials, context())).token
    await owner`insert into haas.runtime_bindings (cell_id, tenant_id, user_id, origin, revision, isolation_mode, status, lease_expires_at)
      values (${cellId}, ${tenantId}, ${administrator.userId}, ${nativeOrigin}, ${randomUUID()}, 'development-process', 'ready', clock_timestamp() + interval '10 minutes')`
    const reservation = createServer()
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('No test port')
    const publicOrigin = `http://127.0.0.1:${address.port}`
    await new Promise<void>(resolve => reservation.close(() => resolve()))
    const bindings = new RuntimeBindings(sql, identity, publicOrigin, [nativeOrigin!])
    gateway = new NativeGateway({ publicOrigin, resolve: (token, requestId) => bindings.resolve(token, requestId), revalidateMs: 100,
      authorize: (token, requestId, grant, request) => identity.authorizeRuntimeOperation(token, requestId, grant, request) })
    server = createEnterpriseServer({ identity, publicOrigin, loopbackDevelopment: true, nativeGateway: gateway })
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(address.port, '127.0.0.1', resolve) })
    const headers = { cookie: `paimind_haas_session=${token}` }
    expect((await fetch(publicOrigin)).status).toBe(401)
    const direct = await (await fetch(nativeOrigin!)).text()
    const htmlResponse = await fetch(publicOrigin, { headers })
    expect(htmlResponse.status).toBe(200)
    const html = await htmlResponse.text()
    expect(html).toBe(direct)
    expect(html).toContain('<title>DeepSeek Harness</title>')
    const rpcId = randomUUID()
    const hostResponse = await fetch(`${publicOrigin}/api/host.describe`, { method: 'POST',
      headers: { ...headers, origin: publicOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: 'host.describe', payload: {} }) })
    expect(hostResponse.status).toBe(200)
    const host = await hostResponse.json() as { type: string; rpcId: string; result: { ok: boolean } }
    expect(host).toMatchObject({ type: 'server-response', rpcId, result: { ok: true } })
    const me = await fetch(`${publicOrigin}/haas/v1/auth/me`, { headers })
    expect((await me.json() as { data: { userId: string } }).data.userId).toBe(administrator.userId)
    for (const path of ['/api/events.host', '/api/events.mux']) {
      const socket = new WebSocket(publicOrigin.replace('http:', 'ws:') + path, { headers: { ...headers, origin: publicOrigin } })
      sockets.push(socket)
      await once(socket, 'open') // The gateway now waits for the real upstream handshake.
    }
    const closed = sockets.map(socket => once(socket, 'close'))
    const started = Date.now()
    await identity.logout(token, {}, context())
    await Promise.all(closed)
    const revocationMs = Date.now() - started
    expect(revocationMs).toBeLessThan(1_000)
    expect((await fetch(publicOrigin, { headers })).status).toBe(401)
    await writeFile(resolve(evidence, 'native-carrier-receipt.json'), JSON.stringify({
      status: 'PASS', scope: 'real-native-authenticated-carrier-not-browser-e2e', recordedAt: new Date().toISOString(),
      sourceRoot: root, nativeFixture, nativeOrigin, nativePid: Number(pid), publicOrigin,
      nativeHtmlByteIdentical: true, nativeHtmlSha256: createHash('sha256').update(html).digest('hex'),
      hostDescribe: 'real native server-response ok', enterpriseIdentity: 'same-origin verified',
      nativeDownlinks: ['/api/events.host', '/api/events.mux'], revocationMs,
      pending: ['browser-login-and-bootstrap', 'native-csp-and-visual-acceptance', 'member-policy', 'two-final-container-workers', 'full-e2e'],
    }, null, 2), { mode: 0o600, flag: 'wx' })
    console.log(`Real native carrier evidence: ${evidence}`)
  } finally {
    for (const socket of sockets) socket.terminate()
    gateway?.close()
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())) }
    // Release only this probe's synthetic binding; preserve identity and audit
    // evidence and never stop or mutate the independently owned native profile.
    await owner`delete from haas.runtime_bindings where cell_id = ${cellId} and tenant_id = ${tenantId}`
    await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 })
  }
})
