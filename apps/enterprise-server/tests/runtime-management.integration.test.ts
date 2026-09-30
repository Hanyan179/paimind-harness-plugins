import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import postgres from 'postgres'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Identity } from '../src/identity.js'
import { RuntimeAdmission } from '../src/runtime-admission.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { DEFAULT_RUNTIME_RESOURCES, readRuntimeResources } from '../src/runtime-resources.js'
import { createEnterpriseServer } from '../src/server.js'

const path = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!path || statSync(path).mode & 0o077) throw Error('Private isolated database configuration required')
const config = JSON.parse(readFileSync(path, 'utf8'))
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || !url.port
    || ['3080', '5432', '57631'].includes(url.port)) throw Error('Unsafe quota fixture database')
}
const owner = postgres(config.ownerUrl, { max: 3, onnotice: () => {} })
const app = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
const disposers: Array<() => Promise<void>> = []
afterEach(async () => { for (const stop of disposers.splice(0).reverse()) await stop() })
afterAll(async () => { await owner.end(); await app.end() })
const context = () => ({ key: randomUUID(), requestId: randomUUID() })
async function fixture() {
  const tenantId = 'resources-' + randomUUID(), password = 'Synthetic resource management credential 2026'
  await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
  const identity = new Identity(app, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
  await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, context())
  const admin = await identity.login({ username: 'morgan', password }, context())
  const members = []
  for (const username of ['hansen', 'alex']) {
    const member = (await identity.createMember(admin.token, { username, displayName: username, password }, context())).data
    const login = await identity.login({ username, password }, context())
    const [available] = await owner`select p from generate_series(2000,65530) p where p<>3080 and not exists
      (select 1 from haas.runtime_bindings where origin='http://127.0.0.1:'||p::text) order by p limit 1`
    const pin: PrivateRuntimeCell = { cellId: randomUUID(), tenantId, userId: member.userId, role: 'member', revision: randomUUID(),
      origin: `http://127.0.0.1:${available!.p}`, containerId: randomBytes(32).toString('hex'),
      imageId: 'sha256:' + 'd'.repeat(64), policyDigest: 'sha256:' + 'e'.repeat(64), volumeName: 'paimind-haas-member-quota-' + randomUUID() }
    // Explicit synthetic runtime identity. This tests real database fences and
    // authenticated HTTP, not container readback or full Browser E2E.
    await new RuntimeAdmission(owner, 'http://127.0.0.1:62167').admit(pin, { ...DEFAULT_RUNTIME_RESOURCES })
    members.push({ member, login, pin })
  }
  const reserve = createServer()
  await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve))
  const address = reserve.address(); if (!address || typeof address === 'string') throw Error('Missing isolated listener')
  await new Promise<void>(resolve => reserve.close(() => resolve()))
  const origin = `http://127.0.0.1:${address.port}`
  const server = createEnterpriseServer({ identity, publicOrigin: origin, loopbackDevelopment: true })
  await new Promise<void>(resolve => server.listen(address.port, '127.0.0.1', resolve))
  disposers.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const post = (route: string, input: object, token = admin.token, key = randomUUID()) => fetch(`${origin}/haas/v1/admin/${route}`, {
    method: 'POST', redirect: 'error', headers: { origin,
      'content-type': 'application/json', 'idempotency-key': key, cookie: 'paimind_haas_session=' + token }, body: JSON.stringify(input) })
  const input = (index = 0) => ({ targetUserId: members[index]!.member.userId, expectedRevision: 0,
    desiredState: 'running', cpuMillis: 500, memoryMiB: 512, pidsLimit: 64, reason: '调整成员运行资源', confirmed: true })
  const read = (index = 0, token = admin.token) => post('runtime-state', { targetUserId: members[index]!.member.userId, reason: '核对实际配额状态', confirmed: true }, token)
  const admission = new RuntimeAdmission(owner, 'http://127.0.0.1:62167')
  const bindings = new RuntimeBindings(app, identity, 'http://127.0.0.1:62167', [], members.map(row => row.pin))
  return { tenantId, admin, identity, members, input, read, post, admission, bindings }
}

describe('HAAS-04 resource intent and operator admission; real PostgreSQL/auth/HTTP, synthetic runtime pins', () => {
  it('records intent once, immediately fences only the selected user, and requires exact independently replaced observation', async () => {
    const f = await fixture(), hansen = f.members[0]!, alex = f.members[1]!
    expect((await (await f.read()).json()).data).toMatchObject({ enforcement: 'operator-observed', desired: { revision: 0 } })
    const key = randomUUID(), request = f.input(), response = await f.post('runtime-resource-policy', request, f.admin.token, key)
    expect(response.status).toBe(200); const first = await response.json()
    expect(first.data).toMatchObject({ outcome: 'intent-recorded', enforcement: 'unconfirmed', automaticRestart: false, policy: { revision: 1 } })
    const replay = await (await f.post('runtime-resource-policy', request, f.admin.token, key)).json()
    expect(replay.data).toEqual(first.data); expect(replay.replayed).toBe(true)
    expect((await (await f.read()).json()).data).toMatchObject({ enforcement: 'unconfirmed', runtime: { policyMatches: false, physicalStop: 'not-observed' } })
    await expect(f.bindings.resolve(hansen.login.token, randomUUID())).rejects.toMatchObject({ code: 'runtime-unavailable' })
    await expect(f.bindings.resolve(alex.login.token, randomUUID())).resolves.toMatchObject({ cellId: alex.pin.cellId })
    await expect(f.admission.renew(hansen.pin, { ...DEFAULT_RUNTIME_RESOURCES })).rejects.toMatchObject({ code: 'runtime-resource-mismatch' })
    const policy = await readRuntimeResources(owner, f.tenantId, hansen.pin.userId)
    await expect(f.admission.renew(hansen.pin, policy)).rejects.toThrow('withdrawn')
    await expect(f.admission.renew(hansen.pin)).rejects.toMatchObject({ code: 'runtime-resource-mismatch' })
    expect(await f.admission.suspend(hansen.pin)).toBe(true)
    const [row] = await owner`select revision from haas.runtime_bindings where cell_id=${hansen.pin.cellId}`
    const next = { ...hansen.pin, revision: randomUUID(), containerId: randomBytes(32).toString('hex') }
    await expect(f.admission.replaceSuspended({ ...hansen.pin, revision: row!.revision }, next, { ...policy, memoryMiB: 1024 })).rejects.toMatchObject({ code: 'runtime-resource-mismatch' })
    await f.admission.replaceSuspended({ ...hansen.pin, revision: row!.revision }, next, policy)
    await f.admission.renew(next, policy)
    expect((await (await f.read()).json()).data).toMatchObject({ enforcement: 'operator-observed', persistentStorageQuota: 'not-enforced', runtime: { observed: { memoryMiB: 512 }, policyMatches: true } })
    expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.resources.configure' and outcome='succeeded'`).toHaveLength(1)
  })
  it('rejects stale edits, same-key changed payload, unconfirmed requests and unsupported or over-capacity limits', async () => {
    const f = await fixture(), input = f.input(), key = randomUUID()
    expect((await f.post('runtime-resource-policy', input, f.admin.token, key)).status).toBe(200)
    expect((await f.post('runtime-resource-policy', input)).status).toBe(409)
    expect((await f.post('runtime-resource-policy', { ...input, memoryMiB: 600 }, f.admin.token, key)).status).toBe(409)
    for (const change of [{ confirmed: false }, { cpuMillis: 0 }, { cpuMillis: 1001 }, { memoryMiB: 128 },
      { pidsLimit: -1 }, { pidsLimit: 257 }, { memoryMiB: 512.5 }, { storageBytes: 1024 }, { desiredState: 'restart' }]) {
      expect((await f.post('runtime-resource-policy', { ...input, ...change })).status).toBe(400)
    }
    expect((await readRuntimeResources(owner, f.tenantId, input.targetUserId)).revision).toBe(1)
  })
  it('authenticates every read/write/replay and rejects cross-tenant known IDs without affecting target policy', async () => {
    const f = await fixture(), foreign = await fixture(), input = f.input(), key = randomUUID()
    expect((await f.post('runtime-resource-policy', input, f.members[0]!.login.token)).status).toBe(403)
    expect((await f.read(0, f.members[0]!.login.token)).status).toBe(403)
    expect((await f.post('runtime-resource-policy', { ...input, targetUserId: foreign.members[0]!.pin.userId })).status).toBe(404)
    expect((await f.post('runtime-resource-policy', input, f.admin.token, key)).status).toBe(200)
    await f.identity.logout(f.admin.token, {}, context())
    expect((await f.post('runtime-resource-policy', input, f.admin.token, key)).status).toBe(401)
    expect((await f.read()).status).toBe(401)
    expect((await readRuntimeResources(owner, foreign.tenantId, foreign.members[0]!.pin.userId)).revision).toBe(0)
  })
  it('serializes concurrent edits and never grants the application role operator observation or lease writes', async () => {
    const f = await fixture()
    const responses = await Promise.all([f.post('runtime-resource-policy', f.input()), f.post('runtime-resource-policy', { ...f.input(), memoryMiB: 600 })])
    expect(responses.map(r => r.status).sort()).toEqual([200, 409])
    await expect(app`update haas.runtime_bindings set resource_observation='{}' where cell_id=${f.members[0]!.pin.cellId}`).rejects.toMatchObject({ code: '42501' })
    await expect(app`delete from haas.runtime_resource_policies where tenant_id=${f.tenantId}`).rejects.toMatchObject({ code: '42501' })
    await expect(app`update haas.runtime_resource_policies set tenant_id='foreign' where tenant_id=${f.tenantId}`).rejects.toMatchObject({ code: '42501' })
    await expect(app`update haas.admitted_runtime_bindings set status='ready'`).rejects.toBeDefined()
  })
  it('suspends immediately, treats expired observations as unconfirmed, and cannot revive an old pin after running intent', async () => {
    const f = await fixture(), member = f.members[0]!, input = { ...f.input(), desiredState: 'suspended' }
    expect((await f.post('runtime-resource-policy', input)).status).toBe(200)
    await expect(f.admission.renew(member.pin, { ...(await readRuntimeResources(owner, f.tenantId, member.pin.userId)) })).rejects.toMatchObject({ code: 'runtime-resource-mismatch' })
    await expect(f.bindings.resolve(member.login.token, randomUUID())).rejects.toMatchObject({ code: 'runtime-unavailable' })
    expect((await f.post('runtime-resource-policy', { ...input, expectedRevision: 1, desiredState: 'running' })).status).toBe(200)
    await expect(f.admission.renew(member.pin, await readRuntimeResources(owner, f.tenantId, member.pin.userId))).rejects.toThrow('withdrawn')
    const alex = f.members[1]!
    await owner`update haas.runtime_bindings set lease_expires_at=clock_timestamp() where cell_id=${alex.pin.cellId}`
    expect((await (await f.read(1)).json()).data).toMatchObject({ enforcement: 'unconfirmed', runtime: { leaseValid: false } })
  })
  it('rolls back policy and receipt when audit insertion fails', async () => {
    const f = await fixture()
    const trigger = 'reject_resource_audit_' + randomBytes(6).toString('hex')
    await owner.unsafe(`create function haas.${trigger}() returns trigger language plpgsql as $$ begin
      if NEW.tenant_id='${f.tenantId}' and NEW.action='runtime.resources.configure' and NEW.outcome='succeeded'
      then raise exception 'explicit quota audit fault'; end if; return NEW; end $$;
      create trigger ${trigger} before insert on haas.audit_events for each row execute function haas.${trigger}();`)
    try { expect((await f.post('runtime-resource-policy', f.input())).status).toBe(503) }
    finally { await owner.unsafe(`drop trigger ${trigger} on haas.audit_events; drop function haas.${trigger}();`) }
    expect((await readRuntimeResources(owner, f.tenantId, f.members[0]!.pin.userId)).revision).toBe(0)
    expect(await owner`select 1 from haas.command_receipts where tenant_id=${f.tenantId} and scope like 'runtime.resources.configure:%'`).toHaveLength(0)
  })
})
