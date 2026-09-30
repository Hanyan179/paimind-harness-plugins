import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import postgres from 'postgres'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Identity } from '../src/identity.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { RuntimeAdmission } from '../src/runtime-admission.js'
import { CellTransport } from '../src/cell-transport.js'
import { ModelManagement } from '../src/model-management.js'
import { createEnterpriseServer } from '../src/server.js'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'

const configPath = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!configPath || statSync(configPath).mode & 0o077) throw Error('Private isolated PostgreSQL required')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || ['3080', '55857', '51484', '5432'].includes(url.port)) throw Error('Unsafe model fixture')
}
const owner = postgres(config.ownerUrl, { max: 2, onnotice: () => {} }), sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
const disposers: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })
afterAll(async () => { await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })
const context = () => ({ key: randomUUID(), requestId: randomUUID() })
async function close(server: Server) { if (!server.listening) return; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
async function listen(server: Server) {
  for (let n = 0; n < 32; n++) {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('No isolated port')
    const origin = `http://127.0.0.1:${address.port}`
    if (!(await owner`select 1 from haas.runtime_bindings where origin=${origin}`).length) return origin
    await close(server)
  }
  throw Error('No fresh isolated port')
}
interface NativeState { selection: { provider: string; model: string }; revision: number; credential: string | undefined; writable: boolean }
async function fixture() {
  const tenantId = 'model-' + randomUUID(), password = 'Explicit synthetic model password 2026'
  await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
  const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
  await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, context())
  const admin = await identity.login({ username: 'morgan', password }, context())
  const hooks: { before?: (method: string, state: NativeState) => Promise<void>; after?: (method: string, state: NativeState) => Promise<void>;
    writeResponse?: 'lost' | 'rejected' | 'wrong-rpc' | 'oversized' } = {}
  const received: Array<{ userId: string; method: string; headers: object }> = []
  const errors: unknown[] = []
  const mount = async (userId: string, state: NativeState) => {
    // Explicit stateful protocol fixtures, not final Harness workers or models.
    const native = createServer(async (request, response) => {
      try {
        let input = ''; for await (const chunk of request) input += chunk
        const call = JSON.parse(input), method = call.method as string
        received.push({ userId, method, headers: request.headers })
        await hooks.before?.(method, state)
        let result: any
        if (method === 'settings.describe') result = { ok: true, value: { writable: state.writable, hasDocument: true, namespaces: [
          { ns: 'agent-default-model', schema: {}, secrets: [], value: { ...state.selection }, revision: state.revision, applies: 'live' },
          { ns: 'llm-deepseek', schema: {}, secrets: [], value: {}, revision: 0, applies: 'live' }] } }
        else if (method === 'llm.providers') result = { ok: true, value: { providers: [{ provider: 'deepseek-official', displayName: 'DeepSeek', active: true }] } }
        else if (method === 'llm.models') result = { ok: true, value: { groups: [{ id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reasoner', name: 'Reasoner' }] }], failures: [] } }
        else if (method === 'credentials.describe') result = { ok: true, value: { credentials: { DEEPSEEK_API_KEY: { configured: Boolean(state.credential), writable: state.writable, value: 'NEVER_EXPOSE_SOURCE' } } } }
        else if (method === 'settings.update') {
          if (call.payload.expectedRevision !== state.revision) result = { ok: false, error: { code: 'settings-conflict', message: 'Explicit CAS conflict', details: { ns: 'agent-default-model', expected: call.payload.expectedRevision, actual: state.revision } } }
          else { state.selection = { ...state.selection, ...call.payload.patch }; state.revision++
            result = { ok: true, value: { ns: 'agent-default-model', schema: {}, secrets: [], value: state.selection, revision: state.revision, applies: 'live' } } }
        } else if (method === 'credentials.set' || method === 'credentials.unset') {
          expect(call.payload.ref).toBe('DEEPSEEK_API_KEY')
          state.credential = method === 'credentials.set' ? call.payload.value : undefined
          result = { ok: true, value: {} }
        } else throw Error('Unexpected native fixture method')
        await hooks.after?.(method, state)
        const write = ['settings.update', 'credentials.set', 'credentials.unset'].includes(method)
        if (write && hooks.writeResponse === 'lost') { response.destroy(); return }
        if (write && hooks.writeResponse === 'rejected') result = { ok: false, error: { code: method === 'settings.update' ? 'settings-rejected' : 'credential-rejected', message: 'NEVER_EXPOSE_SOURCE', details: {} } }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(write && hooks.writeResponse === 'oversized' ? 'x'.repeat(2 * 1024 * 1024 + 1)
          : JSON.stringify({ type: 'server-response', rpcId: write && hooks.writeResponse === 'wrong-rpc' ? randomUUID() : call.rpcId, result }))
      } catch (error) { errors.push(error); response.destroy() }
    })
    const nativeOrigin = await listen(native); disposers.push(() => close(native))
    const nativePort = Number(new URL(nativeOrigin).port), key = randomBytes(32).toString('hex')
    const ingress = createNativeIngress({ token: key, nativePort, control: async () => { throw Error('No generic control operation') } })
    const origin = await listen(ingress.server); disposers.push(() => ingress.close())
    const transport = new CellTransport(origin, key, nativePort); disposers.push(() => transport.destroy())
    return { origin, transport, native }
  }
  const cells = []
  for (const username of ['hansen', 'alex']) {
    const member = (await identity.createMember(admin.token, { username, displayName: username === 'hansen' ? 'Hansen' : 'Alex', password }, context())).data
    const state: NativeState = { selection: { provider: 'deepseek-official', model: 'chat' }, revision: 3, credential: undefined, writable: true }
    const attached = await mount(member.userId, state)
    const pin: PrivateRuntimeCell = { cellId: randomUUID(), tenantId, userId: member.userId, role: 'member', revision: randomUUID(), origin: attached.origin,
      containerId: randomBytes(32).toString('hex'), imageId: 'sha256:' + 'd'.repeat(64), policyDigest: 'sha256:' + 'e'.repeat(64), volumeName: 'paimind-haas-member-model-' + randomUUID() }
    await owner`insert into haas.runtime_bindings (cell_id,tenant_id,user_id,origin,revision,isolation_mode,status,lease_expires_at,container_id,image_id,volume_name,policy_digest)
      values (${pin.cellId},${tenantId},${pin.userId},${pin.origin},${pin.revision},'container-managed','ready',clock_timestamp()+interval '10 minutes',${pin.containerId},${pin.imageId},${pin.volumeName},${pin.policyDigest})`
    cells.push({ member, pin, state, ...attached })
  }
  const reservation = createServer(), url = await listen(reservation); await close(reservation)
  const makeManager = () => new ModelManagement(identity, new RuntimeBindings(sql, identity, url, [], cells.map(cell => cell.pin)), new Map(cells.map(cell => [cell.pin.origin, cell.transport])))
  const options = { identity, modelManagement: makeManager(), publicOrigin: url, loopbackDevelopment: true }
  disposers.push(() => options.modelManagement.close())
  const server = createEnterpriseServer(options)
  await new Promise<void>(resolve => server.listen(Number(new URL(url).port), '127.0.0.1', resolve)); disposers.push(() => close(server))
  const post = (input: object, token = admin.token, key = randomUUID(), suffix = '') => fetch(url + '/haas/v1/admin/model-commands' + suffix, {
    method: 'POST', redirect: 'error', headers: { origin: url, 'content-type': 'application/json', 'idempotency-key': key, cookie: 'paimind_haas_session=' + token }, body: JSON.stringify(input) })
  const get = (id: string, token = admin.token) => fetch(url + '/haas/v1/admin/model-commands/' + id, { headers: { cookie: 'paimind_haas_session=' + token }, redirect: 'error' })
  const state = (targetUserId = cells[0]!.member.userId, token = admin.token) => fetch(url + '/haas/v1/admin/model-command-state', {
    method: 'POST', redirect: 'error', headers: { origin: url, 'content-type': 'application/json', 'idempotency-key': randomUUID(), cookie: 'paimind_haas_session=' + token }, body: JSON.stringify({ targetUserId }) })
  const input = (index = 0, change: object = { kind: 'selection', selection: { provider: 'deepseek-official', model: 'reasoner' } }) => ({
    targetUserId: cells[index]!.member.userId, expectedCellRevision: cells[index]!.pin.revision, expectedSettingsRevision: cells[index]!.state.revision,
    change, reason: '为成员配置授权模型', confirmed: true })
  const restartGateway = () => { options.modelManagement.close(); options.modelManagement = makeManager() }
  const replace = async (patch: Partial<PrivateRuntimeCell> = {}) => {
    const cell = cells[0]!, old = cell.pin, admission = new RuntimeAdmission(owner, url)
    expect(await admission.suspend(old)).toBe(true); await close(cell.native)
    const [suspended] = await owner`select revision from haas.runtime_bindings where cell_id=${old.cellId}`
    const attached = await mount(cell.member.userId, cell.state)
    const next = { ...old, origin: attached.origin, containerId: randomBytes(32).toString('hex'), revision: randomUUID(), ...patch }
    await admission.replaceSuspended({ ...old, revision: suspended!.revision }, next)
    Object.assign(cell, attached, { pin: next }); cell.state.revision = 0
    restartGateway(); return { old, next }
  }
  const writes = () => received.filter(row => ['settings.update', 'credentials.set', 'credentials.unset'].includes(row.method))
  disposers.push(() => expect(errors).toEqual([]))
  return { tenantId, identity, admin, cells, hooks, received, post, get, state, input, writes, restartGateway, replace, password }
}

describe('durable model commands: real PostgreSQL/auth/HTTP/private CONNECT, explicit native wire fixtures, not Browser E2E', () => {
  it('applies once, records pre-write authorization/reservation, confirms fresh native state and replays after gateway restart', async () => {
    const f = await fixture(), input = f.input(), key = randomUUID()
    f.hooks.before = async method => {
      if (method !== 'settings.update') return
      expect(await owner`select 1 from haas.model_commands where tenant_id=${f.tenantId} and outcome='unconfirmed'`).toHaveLength(1)
      expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.model.requested' and outcome='succeeded'`).toHaveLength(1)
    }
    const response = await f.post(input, f.admin.token, key); expect(response.status).toBe(200)
    const receipt = (await response.json()).data
    expect(receipt).toMatchObject({ outcome: 'applied', confirmation: { observation: { revision: 4, selection: { model: 'reasoner' } } }, runtimeGrant: false })
    expect(f.cells[1]!.state.selection.model).toBe('chat'); expect(f.writes()).toHaveLength(1)
    const events = await owner`select action from haas.audit_events where tenant_id=${f.tenantId} and request_id=${(await (await f.get(receipt.commandId)).json()).requestId}`
    expect(events.map(row => row.action)).toEqual(['runtime.model.receipt'])
    expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.model.command.authorized' and outcome='succeeded'`).toHaveLength(1)
    expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.model.authorized'`).toHaveLength(0)
    const before = f.received.length; f.restartGateway()
    expect((await (await f.post(input, f.admin.token, key)).json()).data).toEqual(receipt)
    expect((await (await f.get(receipt.commandId)).json()).data).toEqual(receipt)
    expect(f.received).toHaveLength(before)
    for (const row of f.received) { expect(row.headers).not.toHaveProperty('cookie'); expect(row.headers).not.toHaveProperty('x-paimind-cell-token') }
    await expect(sql`delete from haas.model_commands where tenant_id=${f.tenantId}`).rejects.toBeDefined()
    await expect(owner`update haas.model_commands set outcome='conflict' where tenant_id=${f.tenantId}`).rejects.toBeDefined()
    await expect(owner`delete from haas.model_commands where tenant_id=${f.tenantId}`).rejects.toBeDefined()
  })
  it('keeps set/unset credentials write-only, checks keyed input conflicts and never stores raw carrier/secret', async () => {
    const f = await fixture(), secret = 'EXPLICIT_SYNTHETIC_CREDENTIAL_' + randomUUID(), key = randomUUID()
    const input = f.input(0, { kind: 'credential', action: 'set', value: secret })
    const response = await f.post(input, f.admin.token, key); expect(response.status).toBe(200)
    const result = await response.json(); expect(result.data).toMatchObject({ outcome: 'applied', intent: { change: { kind: 'credential', action: 'set' } } })
    expect(f.cells[0]!.state.credential).toBe(secret); expect(f.cells[1]!.state.credential).toBeUndefined()
    const [row] = await owner`select * from haas.model_commands where tenant_id=${f.tenantId}`
    const audit = await owner`select * from haas.audit_events where tenant_id=${f.tenantId}`
    expect(JSON.stringify([row, audit, result])).not.toContain(secret); expect(JSON.stringify([row, result])).not.toContain('DEEPSEEK_API_KEY')
    expect(row!.request_digest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect((await f.post(f.input(0, { kind: 'credential', action: 'set', value: secret + '-different' }), f.admin.token, key)).status).toBe(409)
    expect((await f.post(input, f.admin.token, key)).status).toBe(200); expect(f.writes()).toHaveLength(1)
    const unset = await f.post(f.input(0, { kind: 'credential', action: 'unset' })); expect(unset.status).toBe(200)
    expect((await unset.json()).data.outcome).toBe('applied'); expect(f.cells[0]!.state.credential).toBeUndefined()
  })
  it.each(['lost', 'rejected', 'wrong-rpc', 'oversized'] as const)('preserves %s response uncertainty, blocks a different key and does not replay after restart', async fault => {
    const f = await fixture(), input = f.input(0, { kind: 'credential', action: 'set', value: 'SYNTHETIC_UNCERTAIN_KEY' }), key = randomUUID()
    f.hooks.writeResponse = fault
    const response = await f.post(input, f.admin.token, key); expect(response.status).toBe(202)
    const command = (await response.json()).data; expect(command.outcome).toBe('unconfirmed'); expect(f.cells[0]!.state.credential).toBe('SYNTHETIC_UNCERTAIN_KEY')
    f.hooks.writeResponse = undefined; f.restartGateway()
    const before = f.received.length
    expect((await f.post(input, f.admin.token, key)).status).toBe(202)
    expect((await f.post(input)).status).toBe(409); expect(f.received).toHaveLength(before); expect(f.writes()).toHaveLength(1)
    const resolve = { expectedCellRevision: f.cells[0]!.pin.revision, reason: '同一单元不能推断未知结果', confirmed: true }
    expect((await f.post(resolve, f.admin.token, randomUUID(), '/' + command.commandId + '/resolve')).status).toBe(409)
    expect((await f.post(f.input(1))).status).toBe(200); expect(f.cells[1]!.state.selection.model).toBe('reasoner')
  })
  it('returns precise CAS conflict as no write, without falsely confirming a rejected post-persistence response', async () => {
    const f = await fixture()
    f.hooks.before = async (method, state) => { if (method === 'settings.update') state.revision++ }
    const response = await f.post(f.input()); expect(response.status).toBe(200)
    expect((await response.json()).data.outcome).toBe('conflict'); expect(f.cells[0]!.state.selection.model).toBe('chat')
    f.hooks.before = undefined; f.hooks.writeResponse = 'rejected'
    const pending = await f.post(f.input()); expect(pending.status).toBe(202)
    expect((await pending.json()).data.outcome).toBe('unconfirmed'); expect(f.cells[0]!.state.selection.model).toBe('reasoner')
  })
  it('rejects member/foreign/disabled/admin targets and untrusted credential references before native I/O', async () => {
    const f = await fixture(), other = await fixture(), member = await f.identity.login({ username: 'alex', password: f.password }, context())
    expect((await f.post(f.input(), member.token)).status).toBe(403)
    expect((await f.post(f.input(), '')).status).toBe(401)
    expect((await f.post(f.input(), other.admin.token)).status).toBe(401)
    for (const targetUserId of [randomUUID(), other.cells[0]!.member.userId, f.admin.data.userId]) expect((await f.post({ ...f.input(), targetUserId })).status).toBe(404)
    for (const extra of [{ origin: 'http://127.0.0.1:3080' }, { confirmed: false }, { reason: '' }, { change: { kind: 'credential', action: 'set', value: 'test', ref: 'OTHER_KEY' } }]) {
      expect((await f.post({ ...f.input(), ...extra })).status).toBe(400)
    }
    await owner`update haas.users set status='disabled' where tenant_id=${f.tenantId} and user_id=${f.cells[0]!.member.userId}`
    expect((await f.post(f.input())).status).toBe(404); expect(f.received).toHaveLength(0)
  })
  it.each(['cell', 'settings', 'catalog', 'writable'] as const)('rejects obsolete or unusable %s preconditions without reserving a write', async fault => {
    const f = await fixture(), input = f.input()
    if (fault === 'cell') input.expectedCellRevision = randomUUID()
    if (fault === 'settings') input.expectedSettingsRevision--
    if (fault === 'catalog') input.change = { kind: 'selection', selection: { provider: 'deepseek-official', model: 'missing' } }
    if (fault === 'writable') f.cells[0]!.state.writable = false
    expect((await f.post(input)).status).toBe(409); expect(f.writes()).toHaveLength(0)
    expect(await owner`select 1 from haas.model_commands where tenant_id=${f.tenantId}`).toHaveLength(0)
  })
  it.each(['before', 'after'] as const)('fails closed when administrator logout occurs %s the native write', async when => {
    const f = await fixture()
    const hook = async (method: string) => { if (method === (when === 'before' ? 'llm.models' : 'settings.update')) await f.identity.logout(f.admin.token, {}, context()) }
    f.hooks.after = hook
    expect((await f.post(f.input())).status).toBe(401)
    const rows = await owner`select outcome from haas.model_commands where tenant_id=${f.tenantId}`
    expect(rows.map(row => row.outcome)).toEqual(when === 'before' ? [] : ['unconfirmed'])
    expect(f.writes()).toHaveLength(when === 'before' ? 0 : 1)
    expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.model.confirmed' and outcome='succeeded'`).toHaveLength(0)
  })
  it.each(['requested', 'confirmed'] as const)('leaves no falsely successful effect when %s audit fails', async phase => {
    const f = await fixture()
    await owner.unsafe(`create function haas.reject_model_command_audit() returns trigger language plpgsql as $$ begin if NEW.tenant_id='${f.tenantId}' and NEW.action='runtime.model.${phase}' and NEW.outcome='succeeded' then raise exception 'explicit audit fault'; end if; return NEW; end $$`)
    await owner`create trigger reject_model_command_audit before insert on haas.audit_events for each row execute function haas.reject_model_command_audit()`
    try {
      expect((await f.post(f.input())).status).toBe(503)
      const rows = await owner`select outcome from haas.model_commands where tenant_id=${f.tenantId}`
      expect(rows.map(row => row.outcome)).toEqual(phase === 'requested' ? [] : ['unconfirmed'])
      expect(f.writes()).toHaveLength(phase === 'requested' ? 0 : 1)
    } finally { await owner`drop trigger reject_model_command_audit on haas.audit_events`; await owner`drop function haas.reject_model_command_audit()` }
  })
  it('serializes reservations across concurrent requests without blocking native I/O behind a database lock', async () => {
    const f = await fixture(), input = f.input(), key = randomUUID()
    let entered!: () => void, release!: () => void
    const ready = new Promise<void>(resolve => { entered = resolve }), hold = new Promise<void>(resolve => { release = resolve })
    f.hooks.before = async method => { if (method === 'settings.update') { entered(); await hold } }
    const first = f.post(input, f.admin.token, key)
    await ready
    try {
      const duplicate = await f.post(input, f.admin.token, key); expect(duplicate.status).toBe(202)
      expect((await f.post(input)).status).toBe(409)
      expect(f.writes()).toHaveLength(1)
    } finally { release() }
    expect((await first).status).toBe(200)
  })
  it('explicitly closes uncertainty only on the admitted replacement, preserving unknown historical effect and old input', async () => {
    const f = await fixture(), input = f.input(), key = randomUUID(); f.hooks.writeResponse = 'lost'
    const initial = await f.post(input, f.admin.token, key); expect(initial.status).toBe(202)
    const command = (await initial.json()).data; const { old, next } = await f.replace(); f.hooks.writeResponse = undefined
    const resolution = { expectedCellRevision: next.revision, reason: '部署已终止旧单元，确认原操作效果未知', confirmed: true }
    expect((await f.post({ ...resolution, expectedCellRevision: old.revision }, f.admin.token, randomUUID(), '/' + command.commandId + '/resolve')).status).toBe(409)
    const response = await f.post(resolution, f.admin.token, randomUUID(), '/' + command.commandId + '/resolve'); expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ outcome: 'superseded', confirmation: { effect: 'unknown', cellRevision: next.revision, observation: { revision: 0 } } })
    const [stored] = await owner`select * from haas.model_commands where tenant_id=${f.tenantId} and command_id=${command.commandId}`
    expect(stored!.intent).toEqual(input); expect(stored!.target_pin).toEqual(old); expect(f.writes()).toHaveLength(1)
    expect((await (await f.post(input, f.admin.token, key)).json()).data.outcome).toBe('superseded'); expect(f.writes()).toHaveLength(1)
    expect((await f.post(f.input())).status).toBe(200); expect(f.writes()).toHaveLength(2)
  })
  it.each(['imageId', 'policyDigest', 'volumeName'] as const)('refuses replacement with a changed %s without resending the old effect', async field => {
    const f = await fixture(); f.hooks.writeResponse = 'lost'
    const command = (await (await f.post(f.input())).json()).data
    if (field === 'volumeName') {
      // The trusted admission layer already refuses storage substitution. Do
      // not weaken it just to exercise the later management-layer guard.
      await expect(f.replace({ volumeName: 'paimind-haas-member-model-' + randomUUID() })).rejects.toThrow('Invalid member runtime replacement')
      expect(f.writes()).toHaveLength(1); return
    }
    const { next } = await f.replace({ [field]: 'sha256:' + 'f'.repeat(64) })
    const response = await f.post({ expectedCellRevision: next.revision, reason: '不匹配替代单元必须拒绝', confirmed: true }, f.admin.token, randomUUID(), '/' + command.commandId + '/resolve')
    expect(response.status).toBe(409); expect(f.writes()).toHaveLength(1)
  })
  it('denies cross-tenant receipt access and never treats a historical receipt as a fresh native grant', async () => {
    const f = await fixture(), other = await fixture()
    const receipt = (await (await f.post(f.input())).json()).data
    expect((await other.get(receipt.commandId)).status).toBe(404)
    const member = await f.identity.login({ username: 'hansen', password: f.password }, context())
    expect((await f.get(receipt.commandId, member.token)).status).toBe(403)
    await owner`update haas.users set status='disabled' where tenant_id=${f.tenantId} and user_id=${f.cells[0]!.member.userId}`
    expect((await (await f.get(receipt.commandId)).json()).data).toEqual(receipt)
    expect(f.writes()).toHaveLength(1)
  })
  it('discovers an unknown command ID without a retained secret, including after the member is offline/disabled', async () => {
    const f = await fixture(), other = await fixture()
    expect((await (await f.state()).json()).data.command).toBeNull()
    f.hooks.writeResponse = 'lost'
    expect((await f.post(f.input(0, { kind: 'credential', action: 'set', value: 'SYNTHETIC_LOST_BROWSER_SECRET' }))).status).toBe(202)
    f.restartGateway(); const before = f.received.length
    await owner`update haas.users set status='disabled' where tenant_id=${f.tenantId} and user_id=${f.cells[0]!.member.userId}`
    const result = await f.state(); expect(result.status).toBe(200)
    const pending = (await result.json()).data.command
    expect(pending).toMatchObject({ outcome: 'unconfirmed', commandId: expect.any(String), runtimeGrant: false })
    expect(JSON.stringify(pending)).not.toContain('SYNTHETIC_LOST_BROWSER_SECRET'); expect(f.received).toHaveLength(before)
    expect((await other.state(f.cells[0]!.member.userId)).status).toBe(404)
    const member = await f.identity.login({ username: 'alex', password: f.password }, context())
    expect((await f.state(undefined, member.token)).status).toBe(403)
  })
  it('keeps a persisted credential write unconfirmed if the native route changes before readback', async () => {
    const f = await fixture()
    f.hooks.after = async (method, state) => { if (method === 'credentials.set') state.revision++ }
    expect((await f.post(f.input(0, { kind: 'credential', action: 'set', value: 'SYNTHETIC_CHANGED_ROUTE' }))).status).toBe(202)
    expect(f.writes()).toHaveLength(1)
  })
  it('cancels in-flight work on service close and retains a non-resendable durable reservation', async () => {
    const f = await fixture(), input = f.input(), key = randomUUID()
    let entered!: () => void, release!: () => void
    const ready = new Promise<void>(resolve => { entered = resolve }), hold = new Promise<void>(resolve => { release = resolve })
    f.hooks.after = async method => { if (method === 'settings.update') { entered(); await hold } }
    const running = f.post(input, f.admin.token, key)
    await ready; f.restartGateway(); release()
    expect((await running).status).toBe(503)
    expect((await f.post(input, f.admin.token, key)).status).toBe(202); expect(f.writes()).toHaveLength(1)
    expect((await (await f.state()).json()).data.command.outcome).toBe('unconfirmed')
  })
})
