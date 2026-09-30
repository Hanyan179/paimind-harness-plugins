import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import postgres from 'postgres'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { Identity } from '../src/identity.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { CellTransport } from '../src/cell-transport.js'
import { MemberContent } from '../src/member-content.js'
import { ModelInspection } from '../src/model-inspection.js'
import { ConnectorInspection } from '../src/connector-inspection.js'
import { createEnterpriseServer } from '../src/server.js'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
const path = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!path || statSync(path).mode & 0o077) throw Error('Private isolated PostgreSQL required')
const config = JSON.parse(readFileSync(path, 'utf8'))
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || ['3080', '55857', '5432', '10012'].includes(url.port)) throw Error('Unsafe inspection fixture')
}
const owner = postgres(config.ownerUrl, { max: 2, onnotice: () => {} }), sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
const disposers: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const dispose of disposers.splice(0).reverse()) await dispose() })
afterAll(async () => { await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })
const command = () => ({ key: randomUUID(), requestId: randomUUID() })
async function listen(server: Server) {
  for (let attempt = 0; attempt < 32; attempt++) {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('No isolated port')
    const origin = `http://127.0.0.1:${address.port}`
    if (!(await owner`select 1 from haas.runtime_bindings where origin = ${origin}`).length) return origin
    await close(server)
  }
  throw Error('No fresh private binding port')
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
async function fixture() {
  const tenantId = 'inspection-' + randomUUID(), password = 'Explicit synthetic inspection password 2026'
  await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
  const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
  await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, command())
  const admin = await identity.login({ username: 'morgan', password }, command())
  const cells = []
  const hooks: { reply?: (method: string) => Promise<void>; oversized?: boolean; model?: (method: string, value: unknown) => unknown;
    control?: (value: unknown, signal: AbortSignal) => Promise<unknown> } = {}
  const received: Array<{ userId: string; method: string; headers: object; payload: unknown }> = []
  const controls: Array<{ userId: string; operation: string; input: unknown }> = []
  for (const [username, displayName] of [['hansen', 'Hansen'], ['alex', 'Alex']]) {
    const member = (await identity.createMember(admin.token, { username, displayName, password }, command())).data
    const native = createServer(async (request, response) => {
      let input = ''; for await (const part of request) input += part
      const call = JSON.parse(input)
      received.push({ userId: member.userId, method: call.method, headers: request.headers, payload: call.payload })
      await hooks.reply?.(call.method)
      // Explicit wire fixtures. Complete original native owners are covered in
      // full-native-publications.integration.test.ts, not claimed here.
      const modelValues: Record<string, unknown> = {
        'settings.describe': { writable: true, hasDocument: true, namespaces: [
          { ns: 'agent-default-model', value: { provider: 'deepseek-official', model: username + '-model' }, schema: {}, secrets: [], applies: 'live', revision: 3 },
          { ns: 'llm-deepseek', value: {}, base: { secret: 'DO_NOT_RETURN' }, schema: {}, secrets: [], applies: 'live', revision: 0 }] },
        'llm.providers': { providers: [{ provider: 'deepseek-official', displayName: 'DeepSeek', active: true }] },
        'llm.models': { groups: [{ id: 'deepseek-official', name: 'DeepSeek', models: [{ id: username + '-model', name: username + ' model' }] }], failures: [] },
        'credentials.describe': { credentials: { DEEPSEEK_API_KEY: { configured: username === 'hansen', writable: true, value: 'DO_NOT_RETURN' } } },
      }
      const value = Object.hasOwn(modelValues, call.method) ? hooks.model ? hooks.model(call.method, modelValues[call.method]) : modelValues[call.method]
        : call.method === 'session.list' ? { items: [{ sessionId: username + '-session', updatedAt: 1, running: false, blank: false,
        projections: { asOfSeq: 1, values: { title: displayName + ' 工作记录' } } }] }
        : { events: [{ event: { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: displayName + ' synthetic private text' }] } } }], hasMore: false }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(hooks.oversized ? 'x'.repeat(2 * 1024 * 1024 + 1) : JSON.stringify({ type: 'server-response', rpcId: call.rpcId, result: { ok: true, value } }))
    })
    const nativeOrigin = await listen(native); disposers.push(() => close(native))
    const key = randomBytes(32).toString('hex'), nativePort = Number(new URL(nativeOrigin).port)
    const ingress = createNativeIngress({ token: key, nativePort, control: async (operation, input, signal) => {
      if (operation !== 'connector.inventory') throw Error('No other control methods in this readonly fixture')
      controls.push({ userId: member.userId, operation, input })
      const value = { schema: 'paimind.native-connectors/v1', scope: 'loader-tree', connection: 'not-probed', entries: [
        { entryId: username + ':crm', serverName: username + '_crm', transport: 'streamable-http', enabled: true, phase: 'active', configuration: 'recognized' },
      ] }
      return hooks.control ? hooks.control(value, signal) : value
    } })
    const origin = await listen(ingress.server); disposers.push(() => ingress.close())
    const transport = new CellTransport(origin, key, nativePort); disposers.push(() => transport.destroy())
    const pin: PrivateRuntimeCell = { cellId: randomUUID(), tenantId, userId: member.userId, role: 'member', revision: randomUUID(), origin,
      containerId: randomBytes(32).toString('hex'), imageId: 'sha256:' + 'd'.repeat(64), policyDigest: 'sha256:' + 'e'.repeat(64), volumeName: 'paimind-haas-member-fixture-' + randomUUID() }
    await owner`insert into haas.runtime_bindings (cell_id,tenant_id,user_id,origin,revision,isolation_mode,status,lease_expires_at,container_id,image_id,volume_name,policy_digest)
      values (${pin.cellId},${tenantId},${pin.userId},${origin},${pin.revision},'container-managed','ready',clock_timestamp()+interval '10 minutes',
      ${pin.containerId},${pin.imageId},${pin.volumeName},${pin.policyDigest})`
    cells.push({ member, pin, transport })
  }
  const reservation = createServer(), url = await listen(reservation)
  await close(reservation)
  const bindings = new RuntimeBindings(sql, identity, url, [], cells.map(cell => cell.pin))
  const content = new MemberContent(identity, bindings, new Map(cells.map(cell => [cell.pin.origin, cell.transport])))
  const modelInspection = new ModelInspection(identity, bindings, new Map(cells.map(cell => [cell.pin.origin, cell.transport])))
  const connectorInspection = new ConnectorInspection(identity, bindings, new Map(cells.map(cell => [cell.pin.origin, cell.transport])))
  disposers.push(() => connectorInspection.close())
  disposers.push(() => modelInspection.close())
  disposers.push(() => content.close())
  const server = createEnterpriseServer({ identity, memberContent: content, modelInspection, connectorInspection, publicOrigin: url, loopbackDevelopment: true })
  await new Promise<void>(resolve => server.listen(Number(new URL(url).port), '127.0.0.1', resolve)); disposers.push(() => close(server))
  const input = { memberId: cells[0]!.member.userId, reason: '核对客户工作记录', confirmed: true, selection: { kind: 'sessions' } }
  const post = (body = input, token = admin.token, method = 'POST', key = randomUUID()) => fetch(url + '/haas/v1/admin/member-content', {
    method, redirect: 'error', headers: { origin: url, 'content-type': 'application/json', 'idempotency-key': key,
      cookie: 'paimind_haas_session=' + token }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
  const modelInput = { memberId: cells[0]!.member.userId, reason: '核对成员模型配置', confirmed: true }
  const postModel = (body = modelInput, token = admin.token, key = randomUUID()) => fetch(url + '/haas/v1/admin/model-state', {
    method: 'POST', redirect: 'error', headers: { origin: url, 'content-type': 'application/json', 'idempotency-key': key,
      cookie: 'paimind_haas_session=' + token }, body: JSON.stringify(body) })
  const connectorInput = { memberId: cells[0]!.member.userId, reason: '核对成员连接器配置', confirmed: true }
  const postConnector = (body: object = connectorInput, token = admin.token, key = randomUUID()) => fetch(url + '/haas/v1/admin/connector-state', {
    method: 'POST', redirect: 'error', headers: { origin: url, 'content-type': 'application/json', 'idempotency-key': key,
      cookie: 'paimind_haas_session=' + token }, body: JSON.stringify(body) })
  return { tenantId, identity, admin, cells, bindings, content, input, post, received, hooks, password, modelInspection, postModel, modelInput,
    connectorInspection, connectorInput, postConnector, controls }
}
describe('audited connector inspection with real PostgreSQL and private HTTP; explicit inventory-owner fixtures', () => {
  it('bounds the whole service to eight simultaneous reads across independently authenticated logins', async () => {
    const f = await fixture(), tokens = [f.admin.token]
    for (let n = 0; n < 4; n++) tokens.push((await f.identity.login({ username: 'morgan', password: f.password }, command())).token)
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve })
    f.hooks.control = async value => { await waiting; return value }
    const pending = tokens.slice(0, 4).flatMap(token => [f.postConnector(f.connectorInput, token), f.postConnector(f.connectorInput, token)])
    try {
      await vi.waitFor(() => expect(f.controls).toHaveLength(8))
      expect((await f.postConnector(f.connectorInput, tokens[4]!)).status).toBe(503)
    } finally { release() }
    for (const response of await Promise.all(pending)) expect(response.status).toBe(200)
    expect((await f.postConnector(f.connectorInput, tokens[4]!)).status).toBe(200)
  })
  it('preserves a real empty inventory and unresolved inactive metadata without inventing health or defaults', async () => {
    const f = await fixture()
    for (const entries of [[], [{ entryId: 'native-disabled', serverName: null, transport: null, enabled: false, phase: null, configuration: 'unresolved' }]]) {
      f.hooks.control = async value => ({ ...value as object, entries })
      const response = await f.postConnector(); expect(response.status).toBe(200)
      expect((await response.json()).data.data).toEqual({ inventory: { schema: 'paimind.native-connectors/v1', scope: 'loader-tree', connection: 'not-probed', entries }, authorization: 'not-evaluated', toolCall: 'not-performed' })
    }
  })
  it('reads each exact member through the private owner, commits both audits per read and never claims a grant or tool call', async () => {
    const f = await fixture(), key = randomUUID()
    f.hooks.control = async value => {
      const audits = await owner`select 1 from haas.audit_events where tenant_id = ${f.tenantId} and action = 'runtime.connector.authorized'`
      expect(audits.length).toBeGreaterThan(0); return value
    }
    const requests = []
    for (const cell of [...f.cells, f.cells[0]!]) {
      const response = await f.postConnector({ ...f.connectorInput, memberId: cell.member.userId }, f.admin.token, key)
      expect(response.status).toBe(200)
      const { data, requestId } = await response.json(); requests.push(requestId)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(data.disclosure).toMatchObject({ memberId: cell.member.userId, memberName: cell.member.displayName,
        reason: f.connectorInput.reason, requestId, readOnly: true })
      expect(data.data).toEqual({ inventory: { schema: 'paimind.native-connectors/v1', scope: 'loader-tree', connection: 'not-probed', entries: [
        { entryId: cell.member.username + ':crm', serverName: cell.member.username + '_crm', transport: 'streamable-http', enabled: true, phase: 'active', configuration: 'recognized' },
      ] }, authorization: 'not-evaluated', toolCall: 'not-performed' })
      const audits = await owner`select action, target_id, reason from haas.audit_events where tenant_id = ${f.tenantId} and request_id = ${requestId} order by sequence`
      expect(audits.map(row => row.action)).toEqual(['runtime.connector.authorized', 'runtime.connector.read'])
      for (const audit of audits) { expect(audit.target_id).toBe(cell.member.userId); expect(JSON.parse(audit.reason)).toEqual({ reason: f.connectorInput.reason, selection: 'native-connector-inventory', readOnly: true }) }
    }
    expect(new Set(requests).size).toBe(3)
    expect(f.controls.map(row => row.userId)).toEqual([f.cells[0]!.member.userId, f.cells[1]!.member.userId, f.cells[0]!.member.userId])
    for (const call of f.controls) expect(call).toMatchObject({ operation: 'connector.inventory', input: {} })
    expect(f.received).toHaveLength(0)
  })
  it('denies members, unauthenticated callers, foreign admins, unknown/foreign/admin/disabled targets and arbitrary native selectors', async () => {
    const f = await fixture(), foreign = await fixture()
    for (const cell of f.cells) {
      const member = await f.identity.login({ username: cell.member.username, password: f.password }, command())
      expect((await f.postConnector(f.connectorInput, member.token)).status).toBe(403)
    }
    expect((await f.postConnector(f.connectorInput, '')).status).toBe(401)
    expect((await f.postConnector(f.connectorInput, foreign.admin.token)).status).toBe(401)
    for (const memberId of [randomUUID(), foreign.cells[0]!.member.userId, f.admin.data.userId]) expect((await f.postConnector({ ...f.connectorInput, memberId })).status).toBe(403)
    for (const extra of [{ entryId: 'arbitrary' }, { origin: 'http://127.0.0.1:3080' }, { operation: 'feature.apply' }, { config: {} }, { confirmed: false }, { reason: '' }]) {
      expect((await f.postConnector({ ...f.connectorInput, ...extra })).status).toBe(400)
    }
    await owner`update haas.users set status = 'disabled' where tenant_id = ${f.tenantId} and user_id = ${f.connectorInput.memberId}`
    expect((await f.postConnector()).status).toBe(403)
    expect(f.controls).toHaveLength(0); expect(foreign.controls).toHaveLength(0)
  })
  it.each(['logout', 'disabled', 'binding', 'lease'] as const)('withholds the entire result if %s changes during owner I/O', async fault => {
    const f = await fixture()
    f.hooks.control = async value => {
      if (fault === 'logout') await f.identity.logout(f.admin.token, {}, command())
      if (fault === 'disabled') await owner`update haas.users set status = 'disabled' where tenant_id = ${f.tenantId} and user_id = ${f.connectorInput.memberId}`
      if (fault === 'binding') await owner`update haas.runtime_bindings set revision = ${randomUUID()} where cell_id = ${f.cells[0]!.pin.cellId}`
      if (fault === 'lease') await owner`update haas.runtime_bindings set lease_expires_at = clock_timestamp() - interval '1 second' where cell_id = ${f.cells[0]!.pin.cellId}`
      return value
    }
    const response = await f.postConnector()
    expect(response.status).toBe(fault === 'logout' ? 401 : fault === 'disabled' ? 403 : 503)
    expect(await response.json()).not.toHaveProperty('data'); expect(f.controls).toHaveLength(1)
    const rows = await owner`select 1 from haas.audit_events where tenant_id = ${f.tenantId} and action = 'runtime.connector.read' and outcome = 'succeeded'`
    expect(rows).toHaveLength(0)
  })
  it.each(['secret', 'health', 'unavailable'] as const)('fails closed on %s, never returning raw private errors or partial inventory', async fault => {
    const f = await fixture()
    f.hooks.control = async value => {
      if (fault === 'unavailable') throw Error('PRIVATE_CREDENTIAL_AND_ENDPOINT')
      return { ...value as object, ...(fault === 'secret' ? { credentials: 'PRIVATE_CREDENTIAL_AND_ENDPOINT' } : { connection: 'healthy' }) }
    }
    const response = await f.postConnector(); expect(response.status).toBe(502)
    const result = await response.json(); expect(result).not.toHaveProperty('data'); expect(JSON.stringify(result)).not.toContain('PRIVATE_CREDENTIAL_AND_ENDPOINT')
  })
  it.each(['runtime.connector.authorized', 'runtime.connector.read'])('withholds data if the %s audit cannot commit', async action => {
    const f = await fixture()
    await owner.unsafe(`create function haas.reject_connector_audit() returns trigger language plpgsql as $$ begin
      if NEW.action = '${action}' then raise exception 'Explicit isolated audit refusal'; end if; return NEW; end $$`)
    await owner`create trigger reject_connector_audit before insert on haas.audit_events for each row execute function haas.reject_connector_audit()`
    try {
      const response = await f.postConnector(); expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty('data')
      expect(f.controls).toHaveLength(action.endsWith('authorized') ? 0 : 1)
    } finally { await owner`drop trigger reject_connector_audit on haas.audit_events`; await owner`drop function haas.reject_connector_audit()` }
  })
  it('bounds one login to two pending reads and closes pending I/O without changing sibling services', async () => {
    const f = await fixture(); let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    f.hooks.control = async value => { await waiting; return value }
    const first = f.postConnector(), second = f.postConnector()
    await vi.waitFor(() => expect(f.controls).toHaveLength(2))
    expect((await f.postConnector()).status).toBe(503)
    f.connectorInspection.close(); release()
    for (const response of await Promise.all([first, second])) { expect(response.status).toBe(502); expect(await response.json()).not.toHaveProperty('data') }
    expect((await f.postConnector()).status).toBe(503)
    expect((await f.postModel()).status).toBe(200)
  })
  it('cancels an exact caller read and releases its slot without disclosing late data', async () => {
    const f = await fixture(), controller = new AbortController(); let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    f.hooks.control = async value => { await waiting; return value }
    const pending = f.connectorInspection.read(f.admin.token, f.connectorInput, randomUUID(), controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'connector-state-unavailable' })
    await vi.waitFor(() => expect(f.controls).toHaveLength(1)); controller.abort(); release(); await rejected
    f.hooks.control = undefined
    expect((await f.postConnector()).status).toBe(200)
  })
})
describe('audited model inspection with real PostgreSQL, HTTP and private CONNECT; native payload fixtures', () => {
  it('reads Hansen and Alex independently, audits every retry and never returns secret fields or an authorization claim', async () => {
    const f = await fixture(), key = randomUUID()
    f.hooks.reply = async () => {
      const rows = await owner`select 1 from haas.audit_events where tenant_id = ${f.tenantId} and action = 'runtime.model.authorized'`
      expect(rows.length).toBeGreaterThan(0)
    }
    for (const cell of [...f.cells, f.cells[0]!]) {
      const response = await f.postModel({ ...f.modelInput, memberId: cell.member.userId }, f.admin.token, key)
      expect(response.status).toBe(200)
      const result = (await response.json()).data
      expect(result.disclosure).toMatchObject({ memberId: cell.member.userId, memberName: cell.member.displayName, readOnly: true })
      expect(result.data).toMatchObject({ selection: { model: cell.member.username + '-model' }, providerActive: true, modelListed: true,
        configuration: { writable: true, revision: 3, applies: 'live', cellRevision: cell.pin.revision, credentialWritable: true },
        credential: cell.member.username === 'hansen' ? 'configured' : 'missing', authorization: 'not-evaluated', modelCall: 'not-performed' })
      expect(JSON.stringify(result)).not.toContain('DO_NOT_RETURN'); expect(JSON.stringify(result)).not.toContain('DEEPSEEK_API_KEY')
      const audits = await owner`select action from haas.audit_events where tenant_id = ${f.tenantId} and request_id = ${result.disclosure.requestId} order by sequence`
      expect(audits.map(row => row.action)).toEqual(['runtime.model.authorized', 'runtime.model.read'])
    }
    expect(f.received).toHaveLength(15)
    for (const row of f.received) {
      expect(['settings.describe', 'llm.providers', 'llm.models', 'credentials.describe']).toContain(row.method)
      expect(row.headers).not.toHaveProperty('cookie'); expect(row.headers).not.toHaveProperty('x-paimind-cell-token')
    }
  })
  it('rejects member, foreign, admin and disabled targets and browser-supplied references before native reads', async () => {
    const f = await fixture(), member = await f.identity.login({ username: 'alex', password: f.password }, command()), foreign = await fixture()
    expect((await f.postModel(f.modelInput, member.token)).status).toBe(403)
    expect((await f.postModel(f.modelInput, '')).status).toBe(401)
    for (const memberId of [randomUUID(), foreign.cells[0]!.member.userId, f.admin.data.userId]) {
      expect((await f.postModel({ ...f.modelInput, memberId })).status).toBe(403)
    }
    for (const extra of [{ ref: 'OTHER_KEY' }, { origin: 'http://127.0.0.1:3080' }, { confirmed: false }, { reason: '' }]) {
      expect((await f.postModel({ ...f.modelInput, ...extra })).status).toBe(400)
    }
    await owner`update haas.users set status = 'disabled' where tenant_id = ${f.tenantId} and user_id = ${f.modelInput.memberId}`
    expect((await f.postModel()).status).toBe(403)
    expect(f.received).toHaveLength(0); expect(foreign.received).toHaveLength(0)
  })
  it('projects exact native credential writability without changing presence or exposing its value', async () => {
    const f = await fixture()
    f.hooks.model = (method, value) => {
      if (method === 'credentials.describe') (value as any).credentials.DEEPSEEK_API_KEY.writable = false
      return value
    }
    const response = await f.postModel(); expect(response.status).toBe(200)
    const result = (await response.json()).data.data
    expect(result).toMatchObject({ credential: 'configured', configuration: { credentialWritable: false } })
    expect(JSON.stringify(result)).not.toContain('DO_NOT_RETURN')
  })
  it.each(['settings.describe', 'llm.providers', 'llm.models', 'credentials.describe'] as const)('reauthorizes after %s instead of returning late data after logout', async method => {
    const f = await fixture()
    f.hooks.reply = async current => { if (current === method) await f.identity.logout(f.admin.token, {}, command()) }
    const response = await f.postModel()
    expect(response.status).toBe(401); expect(await response.json()).not.toHaveProperty('data')
    expect(f.received.at(-1)!.method).toBe(method)
    const rows = await owner`select 1 from haas.audit_events where tenant_id = ${f.tenantId} and action = 'runtime.model.read' and outcome = 'succeeded'`
    expect(rows).toHaveLength(0)
  })
  it.each(['binding', 'disabled'] as const)('drops all state when the target %s changes during a read', async fault => {
    const f = await fixture()
    f.hooks.reply = async method => {
      if (method !== 'llm.models') return
      if (fault === 'binding') await owner`update haas.runtime_bindings set revision = ${randomUUID()} where cell_id = ${f.cells[0]!.pin.cellId}`
      else await owner`update haas.users set status = 'disabled' where tenant_id = ${f.tenantId} and user_id = ${f.modelInput.memberId}`
    }
    const response = await f.postModel()
    expect(response.status).toBe(fault === 'binding' ? 503 : 403); expect(await response.json()).not.toHaveProperty('data')
    expect(f.received).toHaveLength(3)
  })
  it('refuses a changed default model after the multi-owner read', async () => {
    const f = await fixture(); let count = 0
    f.hooks.model = (method, value) => {
      if (method === 'settings.describe' && ++count === 2) (value as any).namespaces[0].value.model = 'changed-model'
      return value
    }
    const response = await f.postModel()
    expect(response.status).toBe(409); expect(await response.json()).not.toHaveProperty('data')
  })
  it('refuses a same-value settings revision change instead of issuing a stale configuration precondition', async () => {
    const f = await fixture(); let count = 0
    f.hooks.model = (method, value) => {
      if (method === 'settings.describe' && ++count === 2) (value as any).namespaces[0].revision += 1
      return value
    }
    const response = await f.postModel()
    expect(response.status).toBe(409); expect(await response.json()).not.toHaveProperty('data')
  })
  it('reports uninspected owner-managed authentication without calling credential resolution', async () => {
    const f = await fixture()
    f.hooks.model = (method, value) => method === 'settings.describe' ? { writable: true, hasDocument: true, namespaces: [
      { ns: 'agent-default-model', value: { provider: 'owner-record', model: 'm' }, schema: {}, secrets: [], applies: 'live', revision: 0 },
      { ns: 'llm-pi-ai', value: { providers: { 'owner-record': {} } }, schema: {}, secrets: [], applies: 'live', revision: 0 },
    ] } : value
    const response = await f.postModel(); expect(response.status).toBe(200)
    expect((await response.json()).data.data.credential).toBe('not-inspected')
    expect(f.received.some(row => row.method.startsWith('credentials.'))).toBe(false)
  })
  it.each(['runtime.model.authorized', 'runtime.model.read'])('fails closed when %s audit cannot commit', async action => {
    const f = await fixture()
    await owner.unsafe(`create function haas.reject_model_audit() returns trigger language plpgsql as $$ begin
      if NEW.action = '${action}' then raise exception 'Explicit test audit refusal'; end if; return NEW; end $$`)
    await owner`create trigger reject_model_audit before insert on haas.audit_events for each row execute function haas.reject_model_audit()`
    try {
      const response = await f.postModel(); expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty('data')
      expect(f.received).toHaveLength(action.endsWith('authorized') ? 0 : 5)
    } finally { await owner`drop trigger reject_model_audit on haas.audit_events`; await owner`drop function haas.reject_model_audit()` }
  })
  it('returns no oversized partial data, caps concurrent work and closes all pending reads', async () => {
    const f = await fixture(); f.hooks.oversized = true
    expect((await f.postModel()).status).toBe(502)
    f.hooks.oversized = false; f.received.length = 0
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve })
    f.hooks.reply = () => waiting
    const first = f.postModel(), second = f.postModel()
    await vi.waitFor(() => expect(f.received).toHaveLength(2))
    expect((await f.postModel()).status).toBe(503)
    f.modelInspection.close(); release()
    for (const response of await Promise.all([first, second])) { expect(response.status).toBe(502); expect(await response.json()).not.toHaveProperty('data') }
    expect((await f.postModel()).status).toBe(503)
  })
})

describe('audited member inspection with real PostgreSQL, HTTP and private CONNECT; native payload fixtures', () => {
  it('commits an authorization audit before each read and returns a separate completed disclosure, with no member login', async () => {
    const f = await fixture(), key = randomUUID()
    f.hooks.reply = async () => {
      const rows = await owner`select action from haas.audit_events where tenant_id = ${f.tenantId} and action = 'content.access.authorized'`
      expect(rows.length).toBeGreaterThan(0)
    }
    for (const cell of f.cells) {
      const response = await f.post({ ...f.input, memberId: cell.member.userId }, f.admin.token, 'POST', key)
      expect(response.status).toBe(200)
      const result = (await response.json()).data
      expect(result.disclosure).toMatchObject({ memberId: cell.member.userId, memberName: cell.member.displayName, reason: f.input.reason, readOnly: true })
      expect(result.data.items.map((row: any) => row.sessionId)).toEqual([cell.member.username + '-session'])
      const audits = await owner`select action from haas.audit_events where tenant_id = ${f.tenantId} and request_id = ${result.disclosure.requestId} order by sequence`
      expect(audits.map(row => row.action)).toEqual(['content.access.authorized', 'content.access.read'])
    }
    expect(f.received).toHaveLength(2)
    for (const row of f.received) { expect(row.method).toBe('session.list'); expect(row.payload).toEqual({}); expect(row.headers).not.toHaveProperty('cookie'); expect(row.headers).not.toHaveProperty('x-paimind-cell-token') }
    const [count] = await owner`select count(*)::int as value from haas.login_sessions where tenant_id = ${f.tenantId}`
    expect(count!.value).toBe(1)
  })
  it('rejects member, anonymous, foreign targets, arbitrary input and missing reason before native access', async () => {
    const f = await fixture(), member = await f.identity.login({ username: 'alex', password: f.password }, command())
    expect((await f.post(f.input, member.token)).status).toBe(403)
    expect((await f.post(f.input, '')).status).toBe(401)
    expect((await f.post({ ...f.input, memberId: randomUUID() })).status).toBe(403)
    const foreign = await fixture()
    expect((await f.post({ ...f.input, memberId: foreign.cells[0]!.member.userId })).status).toBe(403)
    expect(foreign.received).toHaveLength(0)
    expect((await f.post({ ...f.input, memberId: f.admin.data.userId })).status).toBe(403)
    for (const body of [{ ...f.input, reason: '' }, { ...f.input, confirmed: false }, { ...f.input, origin: 'http://127.0.0.1:3080' },
      { ...f.input, selection: { kind: 'prompt' } }, { ...f.input, selection: { kind: 'sessions', method: 'session.delete' } }]) expect((await f.post(body as never)).status).toBe(400)
    expect((await f.post(f.input, f.admin.token, 'GET')).status).toBe(404)
    expect(f.received).toHaveLength(0)
    const [count] = await owner`select count(*)::int as value from haas.audit_events where tenant_id = ${f.tenantId} and action = 'content.access.authorized'`
    expect(count!.value).toBe(0)
  })
  it.each(['logout', 'binding'] as const)('drops the entire response when %s changes during the native read', async fault => {
    const f = await fixture()
    f.hooks.reply = async () => {
      if (fault === 'logout') await f.identity.logout(f.admin.token, {}, command())
      else await owner`update haas.runtime_bindings set revision = ${randomUUID()} where cell_id = ${f.cells[0]!.pin.cellId}`
    }
    const response = await f.post(), result = await response.json()
    expect(response.status).toBe(fault === 'logout' ? 401 : 503)
    expect(result).not.toHaveProperty('data'); expect(JSON.stringify(result)).not.toContain('工作记录')
    const [count] = await owner`select count(*)::int as value from haas.audit_events where tenant_id = ${f.tenantId} and action = 'content.access.read' and outcome = 'succeeded'`
    expect(count!.value).toBe(0)
  })
  it('refuses audit failure before native access and retains immutable audit data', async () => {
    const f = await fixture()
    await owner`create function haas.reject_inspection_audit() returns trigger language plpgsql as $$ begin
      if NEW.action = 'content.access.authorized' then raise exception 'Explicit test audit refusal'; end if; return NEW; end $$`
    await owner`create trigger reject_inspection_audit before insert on haas.audit_events for each row execute function haas.reject_inspection_audit()`
    try { expect((await f.post()).status).toBe(503); expect(f.received).toHaveLength(0) }
    finally { await owner`drop trigger reject_inspection_audit on haas.audit_events`; await owner`drop function haas.reject_inspection_audit()` }
    expect((await f.post()).status).toBe(200)
    await expect(sql`delete from haas.audit_events where tenant_id = ${f.tenantId}`).rejects.toBeDefined()
    expect((await f.post()).status).toBe(200)
  })
  it('returns no partial oversized content and remains usable for a subsequent bounded read', async () => {
    const f = await fixture(); f.hooks.oversized = true
    const response = await f.post(); expect(response.status).toBe(413)
    expect(await response.json()).not.toHaveProperty('data')
    f.hooks.oversized = false
    expect((await f.post()).status).toBe(200)
  })
  it('bounds concurrent reads and cancels every pending native read on service close', async () => {
    const f = await fixture(); let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    f.hooks.reply = () => waiting
    const first = f.post(), second = f.post()
    await vi.waitFor(() => expect(f.received).toHaveLength(2))
    expect((await f.post()).status).toBe(503)
    f.content.close(); release()
    for (const response of await Promise.all([first, second])) { expect(response.status).toBe(502); expect(await response.json()).not.toHaveProperty('data') }
  })
})
