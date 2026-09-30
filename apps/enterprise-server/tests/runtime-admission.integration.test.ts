import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { RuntimeAdmission } from '../src/runtime-admission.js'
import { verifySessionTargetLineage } from '../src/session-target-lineage.js'
import type { PrivateRuntimeCell } from '../src/runtime-bindings.js'

const path = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!path || (statSync(path).mode & 0o077) !== 0) throw Error('Private real DB fixture required')
const config = JSON.parse(readFileSync(path, 'utf8'))
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || !url.port
    || ['3080', '5432', '10012'].includes(url.port)) throw Error('Unsafe test database')
}
const owner = postgres(config.ownerUrl, { max: 1, onnotice: () => {} })
const app = postgres(config.applicationUrl, { max: 1, onnotice: () => {} })
afterAll(async () => { await owner.end(); await app.end() })
const publicOrigin = 'http://127.0.0.1:62167'
const controller = new RuntimeAdmission(owner, publicOrigin)
const sessionTarget = (pin: PrivateRuntimeCell) => ({ cellId: pin.cellId, tenantId: pin.tenantId, userId: pin.userId,
  role: pin.role, revision: pin.revision, origin: pin.origin, transport: 'private-cell' as const })
const verifyLineage = (before: PrivateRuntimeCell, after: PrivateRuntimeCell) =>
  app.begin(tx => verifySessionTargetLineage(tx, sessionTarget(before), sessionTarget(after)))
async function suspended(pin: PrivateRuntimeCell) {
  expect(await controller.suspend(pin)).toBe(true)
  const [row] = await owner`select revision from haas.runtime_bindings where cell_id=${pin.cellId}`
  return { ...pin, revision: row.revision }
}
async function fixture(role: 'member' | 'admin' = 'member'): Promise<PrivateRuntimeCell> {
  const tenantId = `admission-${randomUUID()}`, userId = randomUUID()
  await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
  // Deliberately unusable synthetic credential: this is DB lifecycle evidence,
  // not a real browser/member/container acceptance fixture.
  await owner`insert into haas.users (tenant_id,user_id,username,display_name,role,status,credential)
    values (${tenantId},${userId},${role === 'admin' ? 'morgan' : 'hansen'},${role === 'admin' ? 'Morgan' : 'Hansen'},${role},'active','scrypt-v1$synthetic-not-loginable')`
  const [available] = await owner`select p as next_port from generate_series(1025, 65534) p
    where p not in (3080, 62167) and not exists
      (select 1 from haas.runtime_bindings where origin = 'http://127.0.0.1:' || p::text) order by p limit 1`
  if (!available) throw Error('Synthetic origin range exhausted')
  const next_port = available.next_port
  return { cellId: randomUUID(), tenantId, userId, role, revision: randomUUID(), origin: `http://127.0.0.1:${next_port}`,
    containerId: randomBytes(32).toString('hex'), imageId: `sha256:${randomBytes(32).toString('hex')}`,
    policyDigest: `sha256:${randomBytes(32).toString('hex')}`, volumeName: `paimind-haas-member-${randomUUID()}` }
}
describe('real PostgreSQL member runtime admission lifecycle, not Browser E2E', () => {
  it('admits once, audits, renews only the exact immutable tuple, then suspends without resurrection', async () => {
    const pin = await fixture()
    await controller.admit(pin)
    await expect(controller.admit(pin)).rejects.toMatchObject({ code: '23505' })
    await controller.renew(pin)
    for (const change of [{ containerId: 'f'.repeat(64) }, { imageId: 'sha256:' + 'f'.repeat(64) },
      { policyDigest: 'sha256:' + 'f'.repeat(64) }, { revision: randomUUID() }, { userId: randomUUID() },
      { volumeName: 'paimind-haas-member-other' }, { tenantId: 'foreign-tenant' }]) {
      await expect(controller.renew({ ...pin, ...change })).rejects.toThrow('withdrawn')
    }
    expect(await controller.suspend(pin)).toBe(true)
    expect(await controller.suspend(pin)).toBe(false)
    await expect(controller.renew(pin)).rejects.toThrow('withdrawn')
    const rows = await owner`select action from haas.audit_events where target_id = ${pin.cellId} order by sequence`
    expect(rows.map(row => row.action)).toEqual(['runtime.member.admit', 'runtime.member.suspend'])
  })
  it('refuses disabled members, expiration and application-role writes', async () => {
    const pin = await fixture()
    await owner`update haas.users set status = 'disabled' where user_id = ${pin.userId}`
    await expect(controller.admit(pin)).rejects.toThrow('Active member')
    await owner`update haas.users set status = 'active' where user_id = ${pin.userId}`
    await expect(new RuntimeAdmission(app, publicOrigin).admit(pin)).rejects.toMatchObject({ code: '42501' })
    await controller.admit(pin)
    await owner`update haas.runtime_bindings set lease_expires_at = clock_timestamp() where cell_id = ${pin.cellId}`
    await expect(controller.renew(pin)).rejects.toThrow('expired')
    await expect(new RuntimeAdmission(app, publicOrigin).suspend(pin)).rejects.toMatchObject({ code: '42501' })
    expect(await controller.suspend(pin)).toBe(true)
  })
  it('stops renewal when the member or tenant is disabled; never edits a replacement revision', async () => {
    const pin = await fixture(); await controller.admit(pin)
    await owner`update haas.users set status = 'disabled' where user_id = ${pin.userId}`
    await expect(controller.renew(pin)).rejects.toThrow('withdrawn')
    await owner`update haas.users set status = 'active' where user_id = ${pin.userId}`
    await owner`update haas.tenants set status = 'disabled' where tenant_id = ${pin.tenantId}`
    await expect(controller.renew(pin)).rejects.toThrow('withdrawn')
    const replacement = randomUUID()
    await owner`update haas.runtime_bindings set revision = ${replacement} where cell_id = ${pin.cellId}`
    expect(await controller.suspend(pin)).toBe(false)
    const [row] = await owner`select revision from haas.runtime_bindings where cell_id = ${pin.cellId}`
    expect(row.revision).toBe(replacement)
  })
  it('replaces only an exact suspended cell while retaining its member and data ownership', async () => {
    const pin = await fixture(); await controller.admit(pin)
    const next = { ...pin, containerId: randomBytes(32).toString('hex'), revision: randomUUID(), imageId: 'sha256:' + 'd'.repeat(64) }
    await expect(controller.replaceSuspended(pin, next)).rejects.toThrow('exact suspended')
    await controller.suspend(pin)
    const [row] = await owner`select revision from haas.runtime_bindings where cell_id = ${pin.cellId}`
    const previous = { ...pin, revision: row.revision }
    await expect(controller.replaceSuspended(previous, { ...next, userId: randomUUID() })).rejects.toThrow('Invalid')
    await controller.replaceSuspended(previous, next); await controller.renew(next)
    await expect(controller.renew(pin)).rejects.toThrow('withdrawn')
    expect(await controller.suspend(pin)).toBe(false)
    await expect(controller.replaceSuspended(previous, next)).rejects.toThrow('exact suspended')
    expect(await controller.suspend(next)).toBe(true)
  })
})

describe('operator-owned immutable replacement lineage', () => {
  it('retains original pins, traverses multiple exact replacements, and denies app mutation or stale admission', async () => {
    const first = await fixture(); await controller.admit(first)
    const second = { ...first, revision: randomUUID(), containerId: randomBytes(32).toString('hex') }
    await controller.replaceSuspended(await suspended(first), second, undefined, undefined, first)
    await verifyLineage(first, second)
    const third = { ...second, revision: randomUUID(), containerId: randomBytes(32).toString('hex') }
    await controller.replaceSuspended(await suspended(second), third, undefined, undefined, second)
    await verifyLineage(first, third)
    await expect(verifyLineage(first, second)).rejects.toMatchObject({ code: 'session-runtime-changed' })
    await expect(verifyLineage({ ...first, origin: 'http://127.0.0.1:65000' }, third)).rejects.toMatchObject({ code: 'session-runtime-changed' })
    await expect(verifyLineage({ ...first, userId: randomUUID() }, third)).rejects.toMatchObject({ code: 'session-runtime-changed' })
    const rows = await app`select source_revision,target_revision from haas.runtime_replacement_lineage where tenant_id=${first.tenantId} order by observed_at`
    expect(rows).toEqual([{ source_revision: first.revision, target_revision: second.revision }, { source_revision: second.revision, target_revision: third.revision }])
    await expect(app`insert into haas.runtime_replacement_lineage select * from haas.runtime_replacement_lineage where tenant_id=${first.tenantId}`).rejects.toBeDefined()
    await expect(app`update haas.runtime_replacement_lineage set source_revision=${randomUUID()} where tenant_id=${first.tenantId}`).rejects.toBeDefined()
    await expect(app`delete from haas.runtime_replacement_lineage where tenant_id=${first.tenantId}`).rejects.toBeDefined()
    await expect(owner`delete from haas.runtime_replacement_lineage where tenant_id=${first.tenantId}`).rejects.toThrow('immutable')
  })
  it('does not infer a recovery edge from a plain replacement without the verified original pin', async () => {
    const pin = await fixture(); await controller.admit(pin)
    const next = { ...pin, revision: randomUUID(), containerId: randomBytes(32).toString('hex') }
    await controller.replaceSuspended(await suspended(pin), next)
    await expect(verifyLineage(pin, next)).rejects.toMatchObject({ code: 'session-runtime-changed' })
  })
  it('rejects an original pin that does not identify the exact suspended writer before changing admission', async () => {
    const pin = await fixture(); await controller.admit(pin)
    const stopped = await suspended(pin), next = { ...pin, revision: randomUUID(), containerId: randomBytes(32).toString('hex') }
    await expect(controller.replaceSuspended(stopped, next, undefined, undefined, { ...pin, containerId: randomBytes(32).toString('hex') })).rejects.toThrow('exact stopped')
    const [state] = await owner`select status,revision from haas.runtime_bindings where cell_id=${pin.cellId}`
    expect(state).toEqual({ status: 'suspended', revision: stopped.revision })
    expect(await owner`select 1 from haas.runtime_replacement_lineage where cell_id=${pin.cellId}`).toHaveLength(0)
  })
  it.each(['imageId', 'policyDigest'] as const)('preserves an explicit %s change as history but does not grant old-command recovery', async field => {
    const pin = await fixture(); await controller.admit(pin)
    const next = { ...pin, revision: randomUUID(), containerId: randomBytes(32).toString('hex'), [field]: 'sha256:' + 'f'.repeat(64) }
    await controller.replaceSuspended(await suspended(pin), next, undefined, undefined, pin)
    await expect(verifyLineage(pin, next)).rejects.toMatchObject({ code: 'session-runtime-changed' })
  })
})

describe('explicit administrator admission through the same database owner', () => {
  const administrator = new RuntimeAdmission(owner, publicOrigin, 'admin')
  it('does not let the default member controller admit administrators or turn a member into one', async () => {
    const member = await fixture(), admin = await fixture('admin')
    await expect(controller.admit(admin)).rejects.toThrow('member cells only')
    await expect(administrator.admit(member)).rejects.toThrow('admin cells only')
    await expect(administrator.admit({ ...member, role: 'admin' })).rejects.toThrow('Active admin')
    await expect(controller.admit({ ...admin, role: 'member' })).rejects.toThrow('Active member')
    await expect(new RuntimeAdmission(app, publicOrigin, 'admin').admit(admin)).rejects.toMatchObject({ code: '42501' })
    const [row] = await owner`select count(*)::int as count from haas.runtime_bindings where user_id in (${member.userId},${admin.userId})`
    expect(row!.count).toBe(0)
  })
  it('renews and recovers only the same administrator, and keeps role-specific audit and exact storage identity', async () => {
    const pin = await fixture('admin'); await administrator.admit(pin); await administrator.renew(pin)
    await expect(controller.renew(pin)).rejects.toThrow('member cells only')
    await expect(administrator.renew({ ...pin, role: 'member' })).rejects.toThrow('admin cells only')
    expect(await administrator.suspend(pin)).toBe(true)
    const [row] = await owner`select revision from haas.runtime_bindings where cell_id=${pin.cellId}`
    const old = { ...pin, revision: row!.revision }, next = { ...pin, containerId: randomBytes(32).toString('hex'), revision: randomUUID() }
    await expect(administrator.replaceSuspended(old, { ...next, role: 'member' })).rejects.toThrow('admin cells only')
    await expect(administrator.replaceSuspended(old, { ...next, userId: randomUUID() })).rejects.toThrow('Invalid')
    await administrator.replaceSuspended(old, next); await administrator.renew(next)
    expect(await administrator.suspend(pin)).toBe(false)
    expect(await administrator.suspend(next)).toBe(true)
    const rows = await owner`select action from haas.audit_events where target_id=${pin.cellId} order by sequence`
    expect(rows.map(row => row.action)).toEqual(['runtime.admin.admit', 'runtime.admin.suspend', 'runtime.admin.replace', 'runtime.admin.suspend'])
  })
  it('withdraws authority after account-role drift, disablement or tenant disablement without granting member privileges', async () => {
    const pin = await fixture('admin'); await administrator.admit(pin)
    await owner`update haas.users set role='member' where user_id=${pin.userId}`
    await expect(administrator.renew(pin)).rejects.toThrow('withdrawn')
    await expect(controller.renew(pin)).rejects.toThrow('member cells only')
    await owner`update haas.users set role='admin', status='disabled' where user_id=${pin.userId}`
    await expect(administrator.renew(pin)).rejects.toThrow('withdrawn')
    await owner`update haas.users set status='active' where user_id=${pin.userId}`
    await owner`update haas.tenants set status='disabled' where tenant_id=${pin.tenantId}`
    await expect(administrator.renew(pin)).rejects.toThrow('withdrawn')
    expect(await administrator.suspend(pin)).toBe(true)
  })
})
