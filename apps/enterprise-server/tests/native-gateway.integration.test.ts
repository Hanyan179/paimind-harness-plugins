import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import { once } from 'node:events'
import postgres from 'postgres'
import WebSocket, { WebSocketServer } from 'ws'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { Identity } from '../src/identity.js'
import { RuntimeBindings, developmentCellOrigin, type RuntimeGrant, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { NativeGateway } from '../src/native-gateway.js'
import { createEnterpriseServer } from '../src/server.js'
import { RuntimeMaintenance, type MaintenanceRequest } from '../src/runtime-maintenance.js'

const configPath = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!configPath || (statSync(configPath).mode & 0o077) !== 0) throw new Error('A private real PostgreSQL fixture is required')
const config = JSON.parse(readFileSync(configPath, 'utf8')) as { ownerUrl: string; applicationUrl: string; masterKey: string; bootstrapSecret: string }
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || ['3080', '10012', '5432'].includes(url.port)) throw new Error('Unsafe test database')
}
const owner = postgres(config.ownerUrl, { max: 2, onnotice: () => {} })
const sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
const disposers: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })
afterAll(async () => { await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })
const context = () => ({ key: randomUUID(), requestId: randomUUID() })
const cookie = (token: string) => ({ cookie: `paimind_haas_session=${token}` })
async function listen(server: Server, port = 0) {
  // The intentionally retained DB contains old binding receipts. OS ephemeral
  // ports can be reused after a provider closes; that must not make an unrelated
  // new test impersonate the old destination or violate its unique binding.
  for (let attempt = 0; attempt < 32; attempt += 1) {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No isolated port')
    const origin = `http://127.0.0.1:${address.port}`
    if (port !== 0 || !(await owner`select 1 from haas.runtime_bindings where origin = ${origin}`).length) return origin
    await close(server)
  }
  throw new Error('No unbound isolated test port available')
}
async function close(server: Server) {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
}
async function provider(label: string, html = false, sessionIds?: Set<string>) {
  const received: { path: string; headers: IncomingMessage['headers']; body: string }[] = []
  let applicationFrames = 0
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    received.push({ path: request.url!, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') })
    if (sessionIds && request.url === '/api/session.history') {
      const call = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { rpcId: string; payload: { sessionId: string } }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ type: 'server-response', rpcId: call.rpcId,
        result: sessionIds.has(call.payload.sessionId) ? { ok: true, value: { events: [], hasMore: false } }
          : { ok: false, error: { code: 'session-not-found', message: 'Not found', details: { sessionId: call.payload.sessionId } } } }))
      return
    }
    response.setHeader('set-cookie', 'untrusted_native_session=must-not-escape')
    response.setHeader('cache-control', 'public, max-age=99999')
    response.setHeader('content-security-policy', "default-src * 'unsafe-inline' 'unsafe-eval'")
    response.setHeader('content-type', html ? 'text/html; charset=utf-8' : 'text/plain')
    if (request.url === '/redirect') { response.writeHead(302, { location: 'https://example.invalid/' }); response.end(); return }
    response.end(label)
  })
  const ws = new WebSocketServer({ server })
  ws.on('connection', (socket, request) => {
    received.push({ path: request.url!, headers: request.headers, body: '' })
    socket.on('message', () => { applicationFrames += 1 })
    socket.send(label)
  })
  const origin = await listen(server)
  disposers.push(async () => { for (const socket of ws.clients) socket.terminate(); ws.close(); await close(server) })
  return { origin, received, applicationFrames: () => applicationFrames }
}
async function fixture(cellOrigins: string[], alter?: (resolve: RuntimeBindings['resolve']) => RuntimeBindings['resolve'],
  beforeAuthorize?: () => Promise<void>) {
  const tenantId = `gateway-${randomUUID()}`
  await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
  const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
  const credentials = { username: 'admin', password: 'Synthetic gateway password 2026' }
  const admin = (await identity.bootstrap({ ...credentials, displayName: '网关验收管理员', bootstrapSecret: config.bootstrapSecret }, context())).data
  const token = (await identity.login(credentials, context())).token
  const reservation = createServer()
  const publicOrigin = await listen(reservation)
  await close(reservation)
  const bindings = new RuntimeBindings(sql, identity, publicOrigin, cellOrigins)
  const resolve = bindings.resolve.bind(bindings)
  const gateway = new NativeGateway({ publicOrigin, resolve: alter ? alter(resolve) : resolve, revalidateMs: 50,
    authorize: async (token, requestId, grant, request, verifyResource) => {
      await beforeAuthorize?.()
      await identity.authorizeRuntimeOperation(token, requestId, grant, request, verifyResource)
    } })
  const server = createEnterpriseServer({ identity, publicOrigin, loopbackDevelopment: true, nativeGateway: gateway })
  await listen(server, Number(new URL(publicOrigin).port))
  disposers.push(async () => { gateway.close(); await close(server) })
  async function bind(origin: string, userId = admin.userId) {
    const cellId = randomUUID()
    await owner`insert into haas.runtime_bindings (cell_id, tenant_id, user_id, origin, revision, isolation_mode, status, lease_expires_at)
      values (${cellId}, ${tenantId}, ${userId}, ${origin}, ${randomUUID()}, 'development-process', 'ready', clock_timestamp() + interval '10 minutes')`
    return cellId
  }
  return { identity, admin, token, tenantId, publicOrigin, bind, bindings, gateway }
}
function client(origin: string, token: string, path = '/api/events.host', overrides: Record<string, string> = {}) {
  const socket = new WebSocket(origin.replace('http:', 'ws:') + path, { headers: { ...cookie(token), origin, ...overrides } })
  socket.on('error', () => {})
  disposers.push(() => { socket.terminate() })
  return socket
}
async function message(socket: WebSocket) {
  const [data] = await once(socket, 'message')
  return String(data)
}
async function rejectedUpgrade(socket: WebSocket) {
  return new Promise<number>((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => { response.resume(); socket.terminate(); resolve(response.statusCode!) })
    socket.once('open', () => reject(new Error('Unexpected accepted upgrade')))
  })
}
async function raw(origin: string, path: string, headers: string[]) {
  return new Promise<number>((resolve, reject) => {
    const url = new URL(origin)
    const request = httpRequest({ hostname: url.hostname, port: url.port, path, headers: ['Host', url.host, ...headers] }, response => {
      response.resume(); resolve(response.statusCode!)
    })
    request.on('error', reject); request.end()
  })
}

describe('managed container binding contract with real database, synthetic operator pins (not container acceptance)', () => {
  async function managedFixture() {
    const upstream = await provider('managed-contract-only')
    const env = await fixture([upstream.origin])
    const credentials = { username: 'hansen', password: 'Synthetic managed Hansen 2026' }
    const member = (await env.identity.createMember(env.token, { ...credentials, displayName: 'Hansen' }, context())).data
    const token = (await env.identity.login(credentials, context())).token
    const pin: PrivateRuntimeCell = { cellId: randomUUID(), tenantId: env.tenantId, userId: member.userId, role: 'member',
      revision: randomUUID(), origin: upstream.origin, containerId: randomBytes(32).toString('hex'),
      imageId: `sha256:${randomBytes(32).toString('hex')}`, volumeName: `paimind-haas-member-${randomUUID()}`,
      policyDigest: `sha256:${randomBytes(32).toString('hex')}` }
    await owner`insert into haas.runtime_bindings
      (cell_id,tenant_id,user_id,origin,revision,isolation_mode,status,lease_expires_at,container_id,image_id,volume_name,policy_digest)
      values (${pin.cellId},${pin.tenantId},${pin.userId},${pin.origin},${pin.revision},'container-managed','ready',
        clock_timestamp()+interval '5 minutes',${pin.containerId},${pin.imageId},${pin.volumeName},${pin.policyDigest})`
    const bindings = new RuntimeBindings(sql, env.identity, env.publicOrigin, [], [pin])
    return { ...env, pin, token, bindings, member }
  }
  it('requires a separate matching operator snapshot; a DB row or origin alone never admits a member', async () => {
    const env = await managedFixture()
    expect(await env.bindings.resolve(env.token, randomUUID())).toMatchObject({ userId: env.member.userId,
      cellId: env.pin.cellId, role: 'member', transport: 'private-cell' })
    await expect(new RuntimeBindings(sql, env.identity, env.publicOrigin, [env.pin.origin])
      .resolve(env.token, randomUUID())).rejects.toMatchObject({ code: 'runtime-unavailable' })
    await expect(env.bindings.resolve(undefined, randomUUID())).rejects.toMatchObject({ status: 401 })
    for (const mismatch of [{ userId: randomUUID() }, { tenantId: 'foreign-tenant' }, { role: 'admin' as const },
      { revision: randomUUID() }, { containerId: randomBytes(32).toString('hex') },
      { imageId: `sha256:${'e'.repeat(64)}` }, { volumeName: `paimind-haas-member-${randomUUID()}` },
      { policyDigest: `sha256:${'d'.repeat(64)}` }]) {
      const wrong = new RuntimeBindings(sql, env.identity, env.publicOrigin, [], [{ ...env.pin, ...mismatch }])
      await expect(wrong.resolve(env.token, randomUUID())).rejects.toMatchObject({ code: 'runtime-unavailable' })
    }
  })
  it('does not permit shared cell/container/volume identities, mutable pins or application-written attestations', async () => {
    const env = await managedFixture()
    expect(() => new RuntimeBindings(sql, env.identity, env.publicOrigin, [env.pin.origin], [env.pin])).toThrow('alias')
    expect(() => new RuntimeBindings(sql, env.identity, env.publicOrigin, [], [env.pin, { ...env.pin, cellId: randomUUID() }])).toThrow('share')
    const copy = { ...env.pin }
    const bound = new RuntimeBindings(sql, env.identity, env.publicOrigin, [], [copy])
    copy.revision = randomUUID()
    expect((await bound.resolve(env.token, randomUUID())).revision).toBe(env.pin.revision)
    await expect(sql`update haas.runtime_bindings set policy_digest = ${`sha256:${'f'.repeat(64)}`}
      where cell_id = ${env.pin.cellId}`).rejects.toMatchObject({ code: '42501' })
    await expect(owner`update haas.runtime_bindings set container_id = null
      where cell_id = ${env.pin.cellId}`).rejects.toMatchObject({ code: '23514' })
    await expect(owner`update haas.runtime_bindings set isolation_mode = 'development-process'
      where cell_id = ${env.pin.cellId}`).rejects.toMatchObject({ code: '23514' })
  })
  it('rechecks the current image, policy, revision, lease and live account on every resolution', async () => {
    const env = await managedFixture()
    for (const [column, changed, original] of [
      ['image_id', `sha256:${'b'.repeat(64)}`, env.pin.imageId],
      ['policy_digest', `sha256:${'c'.repeat(64)}`, env.pin.policyDigest],
      ['revision', randomUUID(), env.pin.revision],
    ]) {
      await owner`update haas.runtime_bindings set ${owner(column!)} = ${changed} where cell_id = ${env.pin.cellId}`
      await expect(env.bindings.resolve(env.token, randomUUID())).rejects.toMatchObject({ code: 'runtime-unavailable' })
      await owner`update haas.runtime_bindings set ${owner(column!)} = ${original} where cell_id = ${env.pin.cellId}`
    }
    await owner`update haas.runtime_bindings set lease_expires_at=clock_timestamp()-interval '1 second' where cell_id=${env.pin.cellId}`
    await expect(env.bindings.resolve(env.token, randomUUID())).rejects.toMatchObject({ code: 'runtime-unavailable' })
    await owner`update haas.runtime_bindings set lease_expires_at=clock_timestamp()+interval '5 minutes' where cell_id=${env.pin.cellId}`
    await env.identity.logout(env.token, {}, context())
    await expect(env.bindings.resolve(env.token, randomUUID())).rejects.toMatchObject({ status: 401 })
  })
})

describe('authenticated native gateway, real database and transport providers (not Browser E2E)', () => {
  it('binds both sidebar push channels to the authenticated member cell and audits unknown or foreign sessions', async () => {
    const hansen = await provider('Hansen owned push', false, new Set(['session-hansen']))
    const alex = await provider('Alex owned push', false, new Set(['session-alex']))
    const grants = new Map<string, RuntimeGrant>()
    let issuerIdentity: Identity | undefined
    // Real identities and audit DB, synthetic transport providers and issuer.
    // This is not the managed container admission or Browser E2E gate.
    const env = await fixture([hansen.origin, alex.origin], resolve => async (token, requestId) => {
      if (!token || !grants.has(token)) return resolve(token, requestId)
      await issuerIdentity!.me(token, requestId)
      return grants.get(token)!
    })
    issuerIdentity = env.identity
    const members = []
    for (const [username, displayName, upstream] of [['hansen', 'Hansen', hansen], ['alex', 'Alex', alex]] as const) {
      const credentials = { username, password: `Synthetic ${displayName} sidebar 2026` }
      const account = (await env.identity.createMember(env.token, { ...credentials, displayName }, context())).data
      const token = (await env.identity.login(credentials, context())).token
      const cellId = await env.bind(upstream.origin, account.userId)
      grants.set(token, { cellId, tenantId: env.tenantId, userId: account.userId, role: 'member', revision: randomUUID(),
        origin: upstream.origin, validForMs: 60_000 })
      members.push({ username, token, account, upstream })
    }
    for (const path of ['/sidebar/ws/agent-terminals', '/sidebar/ws/agent-opens']) {
      for (const member of members) {
        const socket = client(env.publicOrigin, member.token, `${path}?sessionId=session-${member.username}`)
        expect(await message(socket)).toBe(`${member.account.displayName} owned push`)
        const closed = once(socket, 'close'); socket.send('not a terminal command channel'); await closed
        expect(member.upstream.applicationFrames()).toBe(0)
        const foreign = member.username === 'hansen' ? 'alex' : 'hansen'
        expect(await rejectedUpgrade(client(env.publicOrigin, member.token, `${path}?sessionId=session-${foreign}`))).toBe(403)
        expect(member.upstream.received.some(row => row.path === `${path}?sessionId=session-${foreign}`)).toBe(false)
      }
    }
    for (const member of members) {
      const probes = member.upstream.received.filter(row => row.path === '/api/session.history')
      expect(probes.length).toBeGreaterThanOrEqual(6)
      for (const row of probes) {
        expect(JSON.parse(row.body)).toMatchObject({ type: 'client-request', method: 'session.history', payload: { beforeSeq: 0, maxMessages: 1 } })
        expect(row.headers.cookie).toBeUndefined(); expect(row.headers['x-role']).toBeUndefined()
        expect(row.headers['x-paimind-cell-token']).toBeUndefined()
      }
      expect(await rejectedUpgrade(client(env.publicOrigin, member.token, '/sidebar/ws/agent-opens?sessionId=unknown'))).toBe(403)
    }
    const denials = await owner<{ actor_user_id: string; count: number }[]>`select actor_user_id, count(*)::integer as count
      from haas.audit_events where tenant_id=${env.tenantId} and action='runtime.operation' and reason='native-session-denied'
      group by actor_user_id`
    expect(denials).toEqual(expect.arrayContaining(members.map(member => ({ actor_user_id: member.account.userId, count: 3 }))))
    // Revalidation uses real DB session state, with unchanged synthetic pins.
    const member = members[0]!
    const socket = client(env.publicOrigin, member.token, '/sidebar/ws/agent-opens?sessionId=session-hansen')
    await message(socket)
    const closed = once(socket, 'close')
    await env.identity.logout(member.token, {}, context())
    await closed
  })

  it('withholds the browser handshake when the native session disappears during the upstream dial', async () => {
    const sessions = new Set(['session-admin'])
    const upstream = await provider('must never reach browser', false, sessions)
    let checks = 0
    const env = await fixture([upstream.origin], undefined, async () => { if (++checks === 2) sessions.clear() })
    await env.bind(upstream.origin)
    expect(await rejectedUpgrade(client(env.publicOrigin, env.token, '/sidebar/ws/agent-opens?sessionId=session-admin'))).toBe(403)
    expect(upstream.received.filter(row => row.path === '/api/session.history')).toHaveLength(2)
    expect(upstream.received.filter(row => row.path.startsWith('/sidebar/ws/'))).toHaveLength(1)
    expect(await owner`select event_id from haas.audit_events where tenant_id=${env.tenantId} and reason='native-session-denied'`).toHaveLength(1)
  })

  it('authorizes a real member at the operation boundary, audits denial and never forwards forbidden bodies', async () => {
    const upstream = await provider('accepted-role-operation')
    let memberToken = ''
    let issued: RuntimeGrant | undefined
    // TEST ONLY: a synthetic issuer exercises operation authorization while
    // production development bindings continue to reject every member below.
    const env = await fixture([upstream.origin], resolve => (token, requestId) => token === memberToken && issued
      ? Promise.resolve(issued) : resolve(token, requestId))
    const credentials = { username: 'casey', password: 'Synthetic Casey policy test 2026' }
    const member = (await env.identity.createMember(env.token, { ...credentials, displayName: 'Casey' }, context())).data
    memberToken = (await env.identity.login(credentials, context())).token
    const cellId = await env.bind(upstream.origin, member.userId)
    await expect(env.bindings.resolve(memberToken, randomUUID())).rejects.toMatchObject({ code: 'member-native-policy-pending' })
    issued = { cellId, tenantId: env.tenantId, userId: member.userId, role: 'member', revision: randomUUID(),
      origin: upstream.origin, validForMs: 60_000 }
    const send = (endpoint: string, args: object) => fetch(`${env.publicOrigin}/api/${endpoint}`, { method: 'POST',
      headers: { ...cookie(memberToken), origin: env.publicOrigin, 'content-type': 'application/json', 'x-role': 'admin' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint,
        payload: endpoint.includes('/') ? { args } : args }) })
    const accepted = await send('paimindAgentProfiles/saveProfile', { input: { productKind: 'personal', basePresetId: 'standard' } })
    expect(accepted.status).toBe(200); await accepted.text()
    expect(upstream.received).toHaveLength(1)
    for (const [endpoint, args] of [
      ['settings.replace', { role: 'admin' }],
      ['paimindAgentProfiles/saveProfile', { input: { productKind: 'business', basePresetId: 'standard' } }],
      ['credentials.set', { ref: 'TEST_FAKE_KEY', value: 'synthetic-never-forward' }],
    ] as const) {
      const denied = await send(endpoint, args)
      expect(denied.status).toBe(403); expect(await denied.text()).not.toContain('synthetic-never-forward')
    }
    expect(upstream.received).toHaveLength(1)
    expect(upstream.received[0]!.headers['x-role']).toBeUndefined()
    const audits = await owner`select action,outcome,reason from haas.audit_events where tenant_id=${env.tenantId}
      and actor_user_id=${member.userId} and action='runtime.operation' order by sequence`
    expect(audits).toHaveLength(3)
    for (const audit of audits) expect(audit).toMatchObject({ outcome: 'denied', reason: 'native-operation-denied' })
    issued = { ...issued, role: 'admin' }
    const forged = await send('settings.replace', {})
    expect(forged.status).toBe(403); expect(await forged.text()).toContain('runtime-principal-changed')
    expect(upstream.received).toHaveLength(1)
    issued = { ...issued, role: 'member' }
    // Fault injection is limited to this synthetic tenant. Never globally
    // disable audit inserts while the user's browser fixture shares this DB.
    const trigger = `test_policy_audit_${randomUUID().replaceAll('-', '')}`
    expect(env.tenantId).toMatch(/^gateway-[a-f0-9-]+$/)
    await owner.unsafe(`create function haas.${trigger}() returns trigger language plpgsql as $$
      begin if NEW.tenant_id = '${env.tenantId}' and NEW.action = 'runtime.operation' then
        raise exception 'isolated policy audit fault'; end if; return NEW; end; $$;
      create trigger ${trigger} before insert on haas.audit_events for each row execute function haas.${trigger}();`)
    try {
      const unavailable = await send('settings.replace', {})
      expect(unavailable.status).toBe(503); expect(await unavailable.text()).toContain('audit-unavailable')
      expect(upstream.received).toHaveLength(1)
    } finally {
      await owner.unsafe(`drop trigger ${trigger} on haas.audit_events; drop function haas.${trigger}();`)
    }
  })

  it('audits and refuses administrator Feature Pack bypasses before native access while retaining native reads', async () => {
    const upstream = await provider('original-native-read')
    const env = await fixture([upstream.origin]); await env.bind(upstream.origin)
    const send = (endpoint: string, args: object = {}, target = '/api/' + endpoint) => fetch(env.publicOrigin + target, {
      method: 'POST', headers: { ...cookie(env.token), origin: env.publicOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint,
        payload: endpoint.includes('/') ? { args } : args }),
    })
    const read = await send('paimindFeaturePacks/describe'); expect(read.status).toBe(200); await read.text()
    expect(upstream.received).toHaveLength(1)
    for (const [endpoint, args] of [
      ['settings.update', { ns: 'paimind-feature-packs', patch: { overrides: '{}' } }],
      ['settings.replace', { ns: 'paimind-feature-packs', section: {} }],
      ['settings.mutate', { ns: 'paimind-feature-packs', ops: [{ op: 'unset', path: ['governance'] }] }],
      ['settings.openDocument', {}], ['settings.futureWrite', { ns: 'paimind-feature-packs' }],
      ['paimindFeaturePacks/mutate', { request: { id: 'paimind:pack:operations', enabled: false, expectedRevision: 0 } }],
    ] as const) {
      const response = await send(endpoint, args)
      expect(response.status).toBe(403); expect((await response.json()).code).toBe('feature-governance-required')
    }
    const alias = await send('paimindFeaturePacks/mutate', {}, '/api/paimindFeaturePacks/mutate?approved=true')
    expect(alias.status).toBe(400); expect((await alias.json()).code).toBe('invalid-native-operation')
    const audits = await owner`select action,outcome,reason from haas.audit_events where tenant_id=${env.tenantId}
      and actor_user_id=${env.admin.userId} and action='runtime.operation' and reason='feature-governance-required' order by sequence`
    expect(audits).toHaveLength(6)
    for (const audit of audits) expect(audit).toMatchObject({ outcome: 'denied', reason: 'feature-governance-required' })
    expect(upstream.received).toHaveLength(1)
    const trigger = `test_feature_bypass_audit_${randomUUID().replaceAll('-', '')}`
    expect(env.tenantId).toMatch(/^gateway-[a-f0-9-]+$/)
    await owner.unsafe(`create function haas.${trigger}() returns trigger language plpgsql as $$
      begin if NEW.tenant_id = '${env.tenantId}' and NEW.action = 'runtime.operation' then
        raise exception 'isolated feature bypass audit fault'; end if; return NEW; end; $$;
      create trigger ${trigger} before insert on haas.audit_events for each row execute function haas.${trigger}();`)
    try {
      const response = await send('paimindFeaturePacks/mutate')
      expect(response.status).toBe(503); expect((await response.json()).code).toBe('audit-unavailable')
      expect(upstream.received).toHaveLength(1)
    } finally {
      await owner.unsafe(`drop trigger ${trigger} on haas.audit_events; drop function haas.${trigger}();`)
    }
    const retained = await send('settings.describe'); expect(retained.status).toBe(200); await retained.text()
    expect(upstream.received).toHaveLength(2)
  })

  it('fails closed without forwarding when operation authorization exceeds its lease', async () => {
    const upstream = await provider('must-not-be-reached')
    const env = await fixture([upstream.origin], resolve => async (token, requestId) => ({ ...await resolve(token, requestId), validForMs: 80 }))
    await env.bind(upstream.origin)
    vi.spyOn(env.identity, 'authorizeRuntimeOperation').mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 150))
    })
    const before = Date.now()
    const response = await fetch(env.publicOrigin, { headers: cookie(env.token) })
    expect(response.status).toBe(502); await response.text()
    expect(Date.now() - before).toBeLessThan(1000)
    expect(upstream.received).toHaveLength(0)
  })

  it('closes an already connected stream when its issued role changes', async () => {
    const upstream = await provider('event')
    let changed = false
    const env = await fixture([upstream.origin], resolve => async (token, requestId) => ({ ...await resolve(token, requestId),
      ...(changed ? { role: 'member' as const } : {}) }))
    await env.bind(upstream.origin)
    const socket = client(env.publicOrigin, env.token); await message(socket)
    const ended = once(socket, 'close'); changed = true; await ended
    expect(socket.readyState).toBe(WebSocket.CLOSED)
  })

  it('keeps recovery renderable during identity dependency failure without revoking the real login', async () => {
    const upstream = await provider('native')
    const env = await fixture([upstream.origin]); await env.bind(upstream.origin)
    const failure = () => { throw new Error('test identity dependency outage') }
    const bootstrap = vi.spyOn(env.identity, 'bootstrapState').mockImplementation(async () => failure())
    const identity = vi.spyOn(env.identity, 'me').mockImplementation(async () => failure())
    try {
      const unavailable = await fetch(env.publicOrigin + '/haas/v1/auth/me', { headers: cookie(env.token) })
      expect(unavailable.status).toBe(503); expect(unavailable.headers.get('set-cookie')).toBeNull()
      const recovery = await fetch(env.publicOrigin + '/haas/recover', { headers: cookie(env.token) })
      expect(recovery.status).toBe(200); expect(recovery.headers.get('set-cookie')).toBeNull()
      expect(recovery.headers.get('content-security-policy')).not.toContain('unsafe-eval')
      const html = await recovery.text()
      expect(html).toContain('data-auth-recovery'); expect(html).not.toContain('<form')
      expect(bootstrap).not.toHaveBeenCalled()
    } finally { identity.mockRestore(); bootstrap.mockRestore() }
    const recovered = await fetch(env.publicOrigin + '/haas/v1/auth/me', { headers: cookie(env.token) })
    expect(recovered.status).toBe(200)
    expect((await recovered.json()).data.userId).toBe(env.admin.userId)
  })
  it('serves a minimal public authentication document and hashes only an authenticated native root, never user HTML', async () => {
    const html = '<html><head><script>window.__ModuleLoader__={}</script><script>globalThis["__DSH_BOOT__"] = {}</script></head><body><div id="root"></div></body></html>'
    const upstream = await provider(html, true)
    const env = await fixture([upstream.origin]); await env.bind(upstream.origin)
    const anonymous = await fetch(env.publicOrigin, { headers: { accept: 'text/html' }, redirect: 'manual' })
    expect(anonymous.status).toBe(303); expect(anonymous.headers.get('location')).toBe('/haas/login')
    const login = await fetch(env.publicOrigin + '/haas/login')
    expect(login.status).toBe(200); expect(await login.text()).toContain('登录企业账户')
    expect(login.headers.get('content-security-policy')).not.toContain('unsafe-eval')
    for (const path of ['/haas/auth.css', '/haas/auth.js']) expect((await fetch(env.publicOrigin + path)).status).toBe(200)
    for (const path of ['/', '/index.html']) {
      const native = await fetch(env.publicOrigin + path, { headers: cookie(env.token) })
      expect(native.status).toBe(200); expect(await native.text()).toBe(html)
      expect(native.headers.get('content-security-policy')).toContain("'sha256-")
      expect(native.headers.get('content-security-policy')).toContain("'unsafe-eval'")
      expect(native.headers.get('set-cookie')).toBeNull()
    }
    for (const path of ['/files/untrusted.html', '/unknown-app-route']) {
      const artifact = await fetch(env.publicOrigin + path, { headers: cookie(env.token) })
      expect(await artifact.text()).toBe(html)
      expect(artifact.headers.get('content-security-policy')).toContain('sandbox')
      expect(artifact.headers.get('content-security-policy')).not.toMatch(/unsafe-eval|allow-same-origin|script-src/u)
    }
  })

  it('rejects unsupported native HTML instead of returning a broadly executable document', async () => {
    const upstream = await provider('<html><script>alert("not a native bootstrap")</script></html>', true)
    const env = await fixture([upstream.origin]); await env.bind(upstream.origin)
    const response = await fetch(env.publicOrigin, { headers: cookie(env.token) })
    expect(response.status).toBe(502)
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect((await response.json()).code).toBe('native-unavailable')
  })

  it('routes real native document navigation to recovery for an expired lease, but preserves probe and API failures', async () => {
    const upstream = await provider('native')
    const env = await fixture([upstream.origin]); const id = await env.bind(upstream.origin)
    await owner`update haas.runtime_bindings set lease_expires_at = clock_timestamp() - interval '1 second' where cell_id = ${id}`
    for (const path of ['/', '/index.html', '/?sessionId=synthetic']) {
      const document = await fetch(env.publicOrigin + path, { redirect: 'manual',
        headers: { ...cookie(env.token), accept: 'text/html', 'sec-fetch-dest': 'document' } })
      expect(document.status).toBe(303); expect(document.headers.get('location')).toBe('/haas/recover')
      expect(document.headers.get('set-cookie')).toBeNull()
    }
    const recovery = await fetch(env.publicOrigin + '/haas/recover', { headers: cookie(env.token) })
    expect(recovery.status).toBe(200); expect(await recovery.text()).toContain('data-auth-recovery')
    for (const path of ['/', '/assets/app.js', '/api/host.describe']) {
      const probe = await fetch(env.publicOrigin + path, { redirect: 'manual',
        headers: { ...cookie(env.token), accept: 'text/html', 'sec-fetch-dest': 'empty' } })
      expect(probe.status).toBe(503); expect(probe.headers.get('location')).toBeNull()
      expect((await probe.json()).code).toBe('runtime-unavailable')
    }
    const identity = await fetch(env.publicOrigin + '/haas/v1/auth/me', { headers: cookie(env.token) })
    expect(identity.status).toBe(200)
    expect(upstream.received).toHaveLength(0)
    // A hostile document request never gets promoted into the application.
    const hostile = await fetch(env.publicOrigin, { redirect: 'manual', headers: { ...cookie(env.token),
      accept: 'text/html', 'sec-fetch-dest': 'document', origin: 'https://foreign.invalid' } })
    expect(hostile.status).toBe(403); expect(hostile.headers.get('location')).toBeNull()
  })

  it('does not promote a malformed native bootstrap into a successful recovery probe', async () => {
    const upstream = await provider('<html>not a native bootstrap</html>', true)
    const env = await fixture([upstream.origin]); await env.bind(upstream.origin)
    const probe = await fetch(env.publicOrigin, { redirect: 'manual', headers: { ...cookie(env.token),
      accept: 'text/html', 'sec-fetch-dest': 'empty' } })
    expect(probe.status).toBe(502); expect(probe.headers.get('location')).toBeNull()
    expect((await probe.json()).code).toBe('native-unavailable')
    const document = await fetch(env.publicOrigin, { redirect: 'manual', headers: { ...cookie(env.token),
      accept: 'text/html', 'sec-fetch-dest': 'document' } })
    expect(document.status).toBe(303); expect(document.headers.get('location')).toBe('/haas/recover')
  })

  it('routes by the live identity and binding, never query IDs; no cookies or caller forwarding headers cross the boundary', async () => {
    const a = await provider('native-A'); const b = await provider('native-B')
    const first = await fixture([a.origin, b.origin]); const second = await fixture([a.origin, b.origin])
    await first.bind(a.origin); await second.bind(b.origin)
    for (const [env, upstream, label] of [[first, a, 'native-A'], [second, b, 'native-B']] as const) {
      const response = await fetch(`${env.publicOrigin}/?userId=${second.admin.userId}&worker=${b.origin}`, {
        headers: { ...cookie(env.token), 'x-forwarded-for': 'foreign', 'x-forwarded-host': 'foreign', forwarded: 'host=foreign' },
      })
      expect(await response.text()).toBe(label)
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('content-security-policy')).not.toContain('unsafe-eval')
      expect(upstream.received[0]!.headers).not.toHaveProperty('cookie')
      for (const name of ['forwarded', 'x-forwarded-for', 'x-forwarded-host']) expect(upstream.received[0]!.headers).not.toHaveProperty(name)
    }
    expect((await fetch(first.publicOrigin, { headers: cookie(second.token) })).status).toBe(401)
    const post = await fetch(`${first.publicOrigin}/api/host.describe`, { method: 'POST', headers: { ...cookie(first.token), origin: first.publicOrigin,
      'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: 'host.describe',
      payload: { userId: second.admin.userId, cell: b.origin } }) })
    expect(await post.text()).toBe('native-A')
    expect(b.received).toHaveLength(1)
  })

  it('rejects anonymous assets, forged principals, cross-origin reads/writes, duplicate cookies and noncanonical paths before upstream access', async () => {
    const upstream = await provider('private')
    const env = await fixture([upstream.origin]); await env.bind(upstream.origin)
    for (const path of ['/', '/assets/app.js', '/api/host.describe']) expect((await fetch(env.publicOrigin + path)).status).toBe(401)
    for (const headers of [{ 'x-paimind-user-id': 'foreign' }, { origin: 'https://foreign.invalid' }, { 'sec-fetch-site': 'cross-site' }]) {
      expect((await fetch(env.publicOrigin, { headers: { ...cookie(env.token), ...headers } })).status).toBeGreaterThanOrEqual(400)
    }
    expect((await fetch(`${env.publicOrigin}/api/test`, { method: 'POST', headers: cookie(env.token), body: '{}' })).status).toBe(403)
    expect(await raw(env.publicOrigin, '/', ['Cookie', `paimind_haas_session=${env.token}; paimind_haas_session=${env.token}`])).toBe(400)
    expect(await raw(env.publicOrigin, '/', ['Cookie', `paimind_haas_session=${env.token}`, 'Cookie', 'other=1'])).toBe(400)
    expect(await raw(env.publicOrigin, '/a/../', ['Cookie', `paimind_haas_session=${env.token}`])).toBe(400)
    expect(upstream.received).toHaveLength(0)
  })

  it('keeps member native admission closed and denies runtime-role binding mutation', async () => {
    const a = await provider('admin'); const b = await provider('member')
    const env = await fixture([a.origin, b.origin]); await env.bind(a.origin)
    const data = { username: 'member', displayName: '成员', password: 'Synthetic member password 2026' }
    const member = (await env.identity.createMember(env.token, data, context())).data
    const token = (await env.identity.login({ username: data.username, password: data.password }, context())).token
    await env.bind(b.origin, member.userId)
    expect((await fetch(env.publicOrigin, { headers: cookie(token) })).status).toBe(403)
    expect(b.received).toHaveLength(0)
    await expect(sql`update haas.runtime_bindings set status = 'suspended' where tenant_id = ${env.tenantId}`).rejects.toMatchObject({ code: '42501' })
    await expect(env.bind(a.origin, member.userId)).rejects.toMatchObject({ code: '23505' })
    const audits = await env.identity.listAudit(env.token, randomUUID())
    expect(audits.some(row => row.action === 'runtime.admission' && row.outcome === 'denied')).toBe(true)
  })

  it('rejects expired leases, suspended cells and destinations outside the independent operator allowlist', async () => {
    const a = await provider('allowed'); const b = await provider('not-allowed')
    const env = await fixture([a.origin]); const id = await env.bind(b.origin)
    expect((await fetch(env.publicOrigin, { headers: cookie(env.token) })).status).toBe(503)
    await owner`update haas.runtime_bindings set origin = ${a.origin}, lease_expires_at = clock_timestamp() - interval '1 second' where cell_id = ${id}`
    expect((await fetch(env.publicOrigin, { headers: cookie(env.token) })).status).toBe(503)
    await owner`update haas.runtime_bindings set status = 'suspended', lease_expires_at = clock_timestamp() + interval '10 minutes' where cell_id = ${id}`
    expect((await fetch(env.publicOrigin, { headers: cookie(env.token) })).status).toBe(503)
    expect(a.received.length + b.received.length).toBe(0)
    for (const url of ['http://127.0.0.1:3080', env.publicOrigin, 'http://localhost:12345', 'http://192.168.103.226:12345', `${a.origin}/path`]) {
      expect(() => developmentCellOrigin(url, env.publicOrigin)).toThrow()
    }
  })

  it('forwards both exact downlinks and no client application data', async () => {
    const upstream = await provider('native event')
    const env = await fixture([upstream.origin]); await env.bind(upstream.origin)
    for (const path of ['/api/events.host', '/api/events.mux']) {
      const socket = client(env.publicOrigin, env.token, path)
      expect(await message(socket)).toBe('native event')
      const ended = once(socket, 'close')
      socket.send('forged RPC mutation')
      await ended
    }
    expect(upstream.applicationFrames()).toBe(0)
    expect(upstream.received.every(row => row.headers.cookie === undefined && row.headers.origin === upstream.origin)).toBe(true)
    expect(await rejectedUpgrade(client(env.publicOrigin, env.token, '/api/host.describe'))).toBe(403)
    expect(await rejectedUpgrade(client(env.publicOrigin, env.token, '/api/events.host', { origin: 'https://foreign.invalid' }))).toBe(403)
    expect(await rejectedUpgrade(client(env.publicOrigin, 'invalid'))).toBe(401)
  })

  it('closes an established downlink when logout revokes its session', async () => {
    const upstream = await provider('event')
    const env = await fixture([upstream.origin]); await env.bind(upstream.origin)
    const socket = client(env.publicOrigin, env.token)
    await message(socket)
    const ended = once(socket, 'close')
    const start = Date.now()
    await env.identity.logout(env.token, {}, context())
    await ended
    expect(Date.now() - start).toBeLessThan(1_000)
    expect((await fetch(env.publicOrigin, { headers: cookie(env.token) })).status).toBe(401)
  })

  it('closes on binding revision change instead of switching an existing stream to another owner or process', async () => {
    const upstream = await provider('event')
    const env = await fixture([upstream.origin]); const id = await env.bind(upstream.origin)
    const socket = client(env.publicOrigin, env.token)
    await message(socket)
    const ended = once(socket, 'close')
    await owner`update haas.runtime_bindings set revision = ${randomUUID()} where cell_id = ${id}`
    await ended
    expect(socket.readyState).toBe(WebSocket.CLOSED)
  })

  it('enforces a hard authorization deadline when a provider stalls, and closes all streams on gateway shutdown', async () => {
    let stalled = false
    const upstream = await provider('event')
    const env = await fixture([upstream.origin], resolve => (token, requestId) => stalled ? new Promise<RuntimeGrant>(() => {}) : resolve(token, requestId))
    await env.bind(upstream.origin)
    const socket = client(env.publicOrigin, env.token)
    await message(socket)
    const ended = once(socket, 'close')
    const start = Date.now(); stalled = true
    await ended
    expect(Date.now() - start).toBeLessThan(1_000)
    stalled = false
    const again = client(env.publicOrigin, env.token)
    await message(again)
    const closed = once(again, 'close')
    env.gateway.close(); await closed
    expect(again.readyState).toBe(WebSocket.CLOSED)
  })

  it('blocks upstream redirects and never forwards a control-plane API to a native provider', async () => {
    const upstream = await provider('native')
    const env = await fixture([upstream.origin]); await env.bind(upstream.origin)
    expect((await fetch(env.publicOrigin + '/redirect', { headers: cookie(env.token) })).status).toBe(502)
    const response = await fetch(env.publicOrigin + '/haas/v1/auth/me', { headers: cookie(env.token) })
    expect((await response.json() as { data: { userId: string } }).data.userId).toBe(env.admin.userId)
    expect(upstream.received).toHaveLength(1)
  })
})

describe('operator runtime maintenance with real database and gateway transport', () => {
  const maintenance = new RuntimeMaintenance(owner)
  async function request(env: Awaited<ReturnType<typeof fixture>>, cellId: string): Promise<MaintenanceRequest> {
    const [binding] = await owner`select * from haas.runtime_bindings where cell_id = ${cellId}`
    return { operationId: randomUUID(), requestId: randomUUID(), tenantId: env.tenantId,
      userId: env.admin.userId, cellId, expectedRevision: binding!.revision as string,
      expectedOrigin: binding!.origin as string, reason: 'storage-recovery' }
  }
  const nativeGet = (env: Awaited<ReturnType<typeof fixture>>) => fetch(env.publicOrigin, { headers: cookie(env.token) })

  it('commits suspension and audit before maintenance, rejects ingress, and never auto-resumes after failure', async () => {
    const a = await provider('first-runtime'), b = await provider('other-runtime')
    const first = await fixture([a.origin]), second = await fixture([b.origin])
    const cell = await first.bind(a.origin); await second.bind(b.origin)
    expect((await nativeGet(first)).status).toBe(200)
    const input = await request(first, cell)
    await expect(maintenance.whileSuspended(input, async fence => {
      await maintenance.requireSuspended(fence)
      const audits = await owner`select * from haas.audit_events where tenant_id = ${first.tenantId}
        and action = 'runtime.maintenance.suspend' and target_id = ${cell}`
      expect(audits).toHaveLength(1)
      expect((await nativeGet(first)).status).toBe(503)
      expect(await (await nativeGet(second)).text()).toBe('other-runtime')
      expect((await first.identity.me(first.token, randomUUID())).userId).toBe(first.admin.userId)
      throw new Error('synthetic offline failure')
    })).rejects.toThrow('synthetic offline failure')
    const [binding] = await owner`select status, revision, lease_expires_at <= clock_timestamp() as expired
      from haas.runtime_bindings where cell_id = ${cell}`
    expect(binding).toMatchObject({ status: 'suspended', expired: true })
    expect(binding!.revision).not.toBe(input.expectedRevision)
    expect(a.received).toHaveLength(1)
    expect((await nativeGet(first)).status).toBe(503)
  })

  it('serializes identical retries and refuses changed input, wrong subjects and stale replay after a new binding', async () => {
    const a = await provider('runtime'), env = await fixture([a.origin]), cell = await env.bind(a.origin)
    const input = await request(env, cell)
    const results = await Promise.all([maintenance.suspend(input), maintenance.suspend({ ...input, requestId: randomUUID() })])
    expect(results.filter(row => !row.replayed)).toHaveLength(1)
    expect(results[0]!.revision).toBe(results[1]!.revision)
    expect(await owner`select * from haas.runtime_maintenance where cell_id = ${cell}`).toHaveLength(1)
    expect(await owner`select * from haas.audit_events where tenant_id = ${env.tenantId}
      and action = 'runtime.maintenance.suspend'`).toHaveLength(1)
    for (const changed of [{ reason: 'image-change' as const }, { userId: randomUUID() }, { tenantId: 'foreign-tenant' },
      { operationId: randomUUID(), expectedRevision: results[0]!.revision }]) {
      await expect(maintenance.suspend({ ...input, ...changed })).rejects.toMatchObject({ code: 'runtime-maintenance-conflict' })
    }
    await maintenance.requireSuspended(results[0]!)
    // Explicit synthetic operator mutation, not a claim of fresh Worker admission.
    await owner`update haas.runtime_bindings set status = 'ready', revision = ${randomUUID()},
      lease_expires_at = clock_timestamp() + interval '5 minutes' where cell_id = ${cell}`
    await expect(maintenance.requireSuspended(results[0]!)).rejects.toMatchObject({ status: 409 })
    await expect(maintenance.suspend(input)).rejects.toMatchObject({ status: 409 })
  })

  it('does not let the application role suspend a binding or forge an operator maintenance receipt', async () => {
    const a = await provider('runtime'), env = await fixture([a.origin]), cell = await env.bind(a.origin)
    const input = await request(env, cell)
    await expect(new RuntimeMaintenance(sql).suspend(input)).rejects.toMatchObject({ code: '42501' })
    await expect(sql`insert into haas.runtime_maintenance
      (operation_id, cell_id, tenant_id, user_id, previous_revision, fenced_revision, origin, request_digest, reason, request_id)
      values (${input.operationId}, ${cell}, ${env.tenantId}, ${env.admin.userId}, ${input.expectedRevision},
        ${randomUUID()}, ${a.origin}, ${'0'.repeat(64)}, 'maintenance', ${randomUUID()})`).rejects.toMatchObject({ code: '42501' })
    expect((await nativeGet(env)).status).toBe(200)
    expect(await owner`select * from haas.runtime_maintenance where cell_id = ${cell}`).toHaveLength(0)
  })

  it('rolls back suspension and receipt if the same-transaction audit write fails', async () => {
    const a = await provider('runtime'), env = await fixture([a.origin]), cell = await env.bind(a.origin)
    const input = await request(env, cell), name = `maintenance_failure_${randomUUID().replaceAll('-', '')}`
    // Generated identifier and generated tenant only; no global outage injection.
    await owner.unsafe(`create function haas.${name}() returns trigger language plpgsql as $$begin
      if NEW.tenant_id = '${env.tenantId}' and NEW.action = 'runtime.maintenance.suspend' then raise exception 'synthetic scoped audit failure'; end if;
      return NEW; end;$$; create trigger ${name} before insert on haas.audit_events for each row execute function haas.${name}()`)
    try {
      await expect(maintenance.suspend(input)).rejects.toThrow('synthetic scoped audit failure')
      expect(await owner`select status, revision from haas.runtime_bindings where cell_id = ${cell}`)
        .toEqual([{ status: 'ready', revision: input.expectedRevision }])
      expect(await owner`select * from haas.runtime_maintenance where cell_id = ${cell}`).toHaveLength(0)
      expect((await nativeGet(env)).status).toBe(200)
    } finally { await owner.unsafe(`drop trigger ${name} on haas.audit_events; drop function haas.${name}()`) }
  })

  it('rejects an HTTP request paused in operation authorization when its binding is suspended before forwarding', async () => {
    let entered!: () => void, release!: () => void
    const awaitingAuthorization = new Promise<void>(resolve => { entered = resolve })
    const continueAuthorization = new Promise<void>(resolve => { release = resolve })
    const a = await provider('must-not-be-forwarded')
    const env = await fixture([a.origin], undefined, async () => { entered(); await continueAuthorization })
    const cell = await env.bind(a.origin), input = await request(env, cell)
    const pending = nativeGet(env)
    await awaitingAuthorization
    await maintenance.suspend(input); release()
    expect((await pending).status).toBe(503)
    expect(a.received).toHaveLength(0)
  })

  it('closes an established native event channel after durable suspension while leaving identity usable', async () => {
    const a = await provider('native-event'), env = await fixture([a.origin]), cell = await env.bind(a.origin)
    const socket = client(env.publicOrigin, env.token, '/api/events.host')
    expect(await message(socket)).toBe('native-event')
    const closed = once(socket, 'close')
    await maintenance.suspend(await request(env, cell))
    await closed
    expect(socket.readyState).toBe(WebSocket.CLOSED)
    expect((await nativeGet(env)).status).toBe(503)
    expect((await env.identity.me(env.token, randomUUID())).role).toBe('admin')
  })
})
