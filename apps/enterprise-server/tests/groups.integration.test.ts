import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { createServer as reservePort } from 'node:net'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { Identity, type MemberGroup } from '../src/identity.js'
import { createEnterpriseServer } from '../src/server.js'

const configPath = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!configPath || (statSync(configPath).mode & 0o077) !== 0) throw new Error('Private isolated database config required; no mock or live fallback')
const config = JSON.parse(readFileSync(configPath, 'utf8')) as { ownerUrl: string; applicationUrl: string; masterKey: string; bootstrapSecret: string }
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || ['3080', '10012', '5432'].includes(url.port)) throw new Error('Refusing non-isolated database')
}
const owner = postgres(config.ownerUrl, { max: 3, onnotice: () => {} })
const sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
afterAll(async () => { await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })
const context = () => ({ key: randomUUID(), requestId: randomUUID() })
const credentials = { username: 'administrator', password: 'Synthetic group administrator 2026' }
const memberInput = { username: 'hansen', displayName: 'Hansen', password: 'Synthetic group member 2026' }
async function fixture() {
  const tenantId = `groups-test-${randomUUID()}`
  await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
  const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
  const admin = (await identity.bootstrap({ ...credentials, displayName: 'Morgan', bootstrapSecret: config.bootstrapSecret }, context())).data
  const token = (await identity.login(credentials, context())).token
  const hansen = (await identity.createMember(token, memberInput, context())).data
  const alex = (await identity.createMember(token, { ...memberInput, username: 'alex', displayName: 'Alex' }, context())).data
  return { identity, tenantId, token, admin, hansen, alex }
}
const edit = (group: MemberGroup, memberIds: string[] = group.memberIds, name = group.name) => ({ name, memberIds, expectedRevision: group.revision })
const status = (group: MemberGroup, next: 'active' | 'archived') => ({ status: next, reason: '真实隔离数据库测试', expectedRevision: group.revision })

describe('member groups against real isolated PostgreSQL (not Browser E2E or resource grants)', () => {
  it('persists normal-name membership with native identity unchanged, including after service reconstruction', async () => {
    const { identity, tenantId, token, admin, hansen, alex } = await fixture()
    const users = await owner`select * from haas.users where tenant_id = ${tenantId} order by user_id`
    const sessions = await owner`select * from haas.login_sessions where tenant_id = ${tenantId} order by session_id`
    expect(await identity.listGroups(token, randomUUID())).toEqual([])
    const created = (await identity.createGroup(token, { name: '客户服务团队' }, context())).data
    expect(created).toEqual({ groupId: expect.any(String), name: '客户服务团队', revision: 1, status: 'active', memberIds: [] })
    const members = [hansen.userId, alex.userId, admin.userId].sort()
    const updated = (await identity.updateGroup(token, created.groupId, edit(created, members), context())).data
    expect(updated).toEqual({ ...created, revision: 2, memberIds: members })
    const restored = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
    expect(await restored.listGroups(token, randomUUID())).toEqual([updated])
    expect(await owner`select * from haas.users where tenant_id = ${tenantId} order by user_id`).toEqual(users)
    expect(await owner`select * from haas.login_sessions where tenant_id = ${tenantId} order by session_id`).toEqual(sessions)
    const [audit] = await owner`select reason, target_id from haas.audit_events where tenant_id = ${tenantId} and action = 'identity.group.update' and outcome = 'succeeded'`
    expect(audit?.target_id).toBe(created.groupId)
    expect(JSON.parse(audit!.reason)).toEqual({ name: created.name, previousName: created.name, revision: 2, addedUserIds: members, removedUserIds: [] })
  })

  it('allows membership to be removed atomically and retains disabled account identity without reviving login', async () => {
    const { identity, token, hansen, alex } = await fixture()
    const login = await identity.login({ username: memberInput.username, password: memberInput.password }, context())
    const created = (await identity.createGroup(token, { name: '市场团队' }, context())).data
    const populated = (await identity.updateGroup(token, created.groupId, edit(created, [hansen.userId, alex.userId]), context())).data
    await identity.setMemberStatus(token, hansen.userId, { status: 'disabled', reason: '成员暂时停用' }, context())
    const updated = (await identity.updateGroup(token, created.groupId, edit(populated, [hansen.userId], '市场与客户'), context())).data
    expect(updated.memberIds).toEqual([hansen.userId])
    await expect(identity.me(login.token, randomUUID())).rejects.toMatchObject({ status: 401 })
    const empty = (await identity.updateGroup(token, created.groupId, edit(updated, []), context())).data
    expect(empty.memberIds).toEqual([])
    expect((await identity.listMembers(token, randomUUID())).find(row => row.userId === hansen.userId)?.status).toBe('disabled')
  })

  it('archives and restores the same group with all member references and optimistic revision', async () => {
    const { identity, token, hansen } = await fixture()
    const created = (await identity.createGroup(token, { name: '客户项目' }, context())).data
    const populated = (await identity.updateGroup(token, created.groupId, edit(created, [hansen.userId]), context())).data
    const command = context(); const input = status(populated, 'archived')
    const archived = await identity.setGroupStatus(token, created.groupId, input, command)
    expect(archived.data).toEqual({ ...populated, status: 'archived', revision: 3 })
    await expect(identity.updateGroup(token, created.groupId, edit(archived.data, []), context())).rejects.toMatchObject({ code: 'group-archived' })
    await expect(identity.setGroupStatus(token, created.groupId, status(populated, 'active'), context())).rejects.toMatchObject({ code: 'group-changed' })
    await expect(identity.setGroupStatus(token, created.groupId, status(archived.data, 'archived'), context())).rejects.toMatchObject({ code: 'group-status-unchanged' })
    const restored = (await identity.setGroupStatus(token, created.groupId, status(archived.data, 'active'), context())).data
    expect(restored).toEqual({ ...populated, revision: 4 })
    expect(await identity.setGroupStatus(token, created.groupId, input, command)).toEqual({ ...archived, replayed: true })
    expect(await identity.listGroups(token, randomUUID())).toEqual([restored])
  })

  it('serializes equivalent unordered member commands once and rejects a reused key with different input', async () => {
    const { identity, tenantId, token, hansen, alex } = await fixture()
    const ctx = context()
    const creations = await Promise.all([identity.createGroup(token, { name: 'Sales' }, ctx), identity.createGroup(token, { name: 'Sales' }, { ...ctx, requestId: randomUUID() })])
    expect(creations.map(row => row.replayed).sort()).toEqual([false, true])
    const group = creations[0]!.data; const update = context()
    const changes = await Promise.all([identity.updateGroup(token, group.groupId, edit(group, [hansen.userId, alex.userId]), update),
      identity.updateGroup(token, group.groupId, edit(group, [alex.userId.toUpperCase(), hansen.userId.toUpperCase()]), { ...update, requestId: randomUUID() })])
    expect(changes.map(row => row.replayed).sort()).toEqual([false, true])
    expect(changes[0]!.data.revision).toBe(2)
    await expect(identity.updateGroup(token, group.groupId, edit(group, [hansen.userId]), update)).rejects.toMatchObject({ code: 'idempotency-conflict' })
    expect(await owner`select event_id from haas.audit_events where tenant_id = ${tenantId} and action = 'identity.group.update' and outcome = 'succeeded'`).toHaveLength(1)
  })

  it('rejects the losing concurrent editor without partial membership changes', async () => {
    const { identity, token, hansen, alex } = await fixture()
    const group = (await identity.createGroup(token, { name: '并发编辑' }, context())).data
    const outcomes = await Promise.allSettled([identity.updateGroup(token, group.groupId, edit(group, [hansen.userId], '客户团队'), context()),
      identity.updateGroup(token, group.groupId, edit(group, [alex.userId], '市场团队'), context())])
    const success = outcomes.find(row => row.status === 'fulfilled')
    expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find(row => row.status === 'rejected')).toMatchObject({ reason: { code: 'group-changed' } })
    expect(await identity.listGroups(token, randomUUID())).toEqual([success!.status === 'fulfilled' ? success!.value.data : null])
  })

  it('rejects member and anonymous access to every group operation and prevents replay after logout', async () => {
    const { identity, token, hansen } = await fixture()
    const ctx = context(); const input = { name: '仅管理员维护' }
    const group = (await identity.createGroup(token, input, ctx)).data
    const member = (await identity.login({ username: memberInput.username, password: memberInput.password }, context())).token
    for (const actor of [member, undefined]) {
      for (const action of [() => identity.listGroups(actor, randomUUID()), () => identity.createGroup(actor, input, ctx),
        () => identity.updateGroup(actor, group.groupId, edit(group, [hansen.userId]), context()),
        () => identity.setGroupStatus(actor, group.groupId, status(group, 'archived'), context())]) {
        await expect(action()).rejects.toMatchObject({ status: actor ? 403 : 401 })
      }
    }
    await identity.logout(token, {}, context())
    await expect(identity.createGroup(token, input, ctx)).rejects.toMatchObject({ status: 401 })
  })

  it('refuses foreign and unknown groups or members without leaking ownership or partially replacing members', async () => {
    const own = await fixture(); const foreign = await fixture()
    const group = (await own.identity.createGroup(own.token, { name: '团队' }, context())).data
    const foreignGroup = (await foreign.identity.createGroup(foreign.token, { name: '团队' }, context())).data
    const populated = (await own.identity.updateGroup(own.token, group.groupId, edit(group, [own.hansen.userId]), context())).data
    for (const userId of [foreign.alex.userId, randomUUID()]) await expect(own.identity.updateGroup(own.token, group.groupId, edit(populated, [own.alex.userId, userId]), context())).rejects.toMatchObject({ status: 404, code: 'not-found' })
    for (const groupId of [foreignGroup.groupId, randomUUID()]) {
      await expect(own.identity.updateGroup(own.token, groupId, edit(group, [own.alex.userId]), context())).rejects.toMatchObject({ status: 404 })
      await expect(own.identity.setGroupStatus(own.token, groupId, status(group, 'archived'), context())).rejects.toMatchObject({ status: 404 })
    }
    expect(await own.identity.listGroups(own.token, randomUUID())).toEqual([populated])
    expect(await foreign.identity.listGroups(foreign.token, randomUUID())).toEqual([foreignGroup])
    await expect(sql`insert into haas.group_members (tenant_id, group_id, user_id) values (${own.tenantId}, ${group.groupId}, ${foreign.alex.userId})`).rejects.toMatchObject({ code: '23503' })
    await expect(sql`delete from haas.member_groups where tenant_id = ${own.tenantId}`).rejects.toMatchObject({ code: '42501' })
  })

  it('validates exact input, duplicate canonical IDs, revision ranges, and case-insensitive archived names', async () => {
    const { identity, token, hansen } = await fixture()
    const group = (await identity.createGroup(token, { name: 'Sales' }, context())).data
    for (const input of [{ name: '' }, { name: ' sales' }, { name: 'a\nb' }, { name: 'x'.repeat(121) }, { name: 'x', tenantId: 'forged' }]) {
      await expect(identity.createGroup(token, input, context())).rejects.toMatchObject({ status: 400 })
    }
    for (const patch of [{ memberIds: [hansen.userId, hansen.userId.toUpperCase()] }, { memberIds: ['bad'] }, { memberIds: Array(501).fill(hansen.userId) },
      { memberIds: 'invalid' }, { expectedRevision: 0 }, { expectedRevision: 1.5 }, { expectedRevision: '1' }, { expectedRevision: 2_147_483_647 }, { role: 'admin' }]) {
      await expect(identity.updateGroup(token, group.groupId, { ...edit(group), ...patch }, context())).rejects.toMatchObject({ status: 400 })
    }
    await identity.setGroupStatus(token, group.groupId, status(group, 'archived'), context())
    await expect(identity.createGroup(token, { name: 'sales' }, context())).rejects.toMatchObject({ status: 409 })
  })

  it.each(['create', 'update', 'status'] as const)('rolls back %s, membership, revision and receipt when its atomic audit fails', async action => {
    const { identity, token, tenantId, hansen } = await fixture()
    const group = (await identity.createGroup(token, { name: '保留原状态' }, context())).data
    const before = await identity.listGroups(token, randomUUID())
    const trigger = `test_group_audit_${randomUUID().replaceAll('-', '')}`
    expect(tenantId).toMatch(/^groups-test-[a-f0-9-]+$/)
    await owner.unsafe(`create function haas.${trigger}() returns trigger language plpgsql as $$ begin
      if NEW.tenant_id = '${tenantId}' and NEW.action = 'identity.group.${action}' and NEW.outcome = 'succeeded' then
      raise exception 'isolated audit failure'; end if; return NEW; end; $$;
      create trigger ${trigger} before insert on haas.audit_events for each row execute function haas.${trigger}();`)
    const ctx = context()
    const operation = () => action === 'create' ? identity.createGroup(token, { name: '失败不能新增' }, ctx)
      : action === 'update' ? identity.updateGroup(token, group.groupId, edit(group, [hansen.userId], '失败不能改名'), ctx)
      : identity.setGroupStatus(token, group.groupId, status(group, 'archived'), ctx)
    try {
      await expect(operation()).rejects.toMatchObject({ status: 503 })
      expect(await identity.listGroups(token, randomUUID())).toEqual(before)
      expect(await owner`select operation_id from haas.command_receipts where tenant_id = ${tenantId} and idempotency_key = ${ctx.key}`).toHaveLength(0)
    } finally { await owner.unsafe(`drop trigger ${trigger} on haas.audit_events; drop function haas.${trigger}();`) }
    expect((await operation()).replayed).toBe(false)
  })

  it('reauthorizes after acquiring the tenant lock, including a command that already has a receipt', async () => {
    const { identity, token, tenantId } = await fixture()
    const ctx = context(); const input = { name: '锁内重新授权' }
    await identity.createGroup(token, input, ctx)
    let locked!: () => void; const ready = new Promise<void>(resolve => { locked = resolve })
    let release!: () => void; const proceed = new Promise<void>(resolve => { release = resolve })
    const revocation = owner.begin(async db => {
      await db`select pg_advisory_xact_lock(hashtextextended(${`haas:identity:${tenantId}`}, 0))`
      locked(); await proceed
      await db`update haas.login_sessions set revoked_at = clock_timestamp() where tenant_id = ${tenantId}`
    })
    await ready
    const result = identity.createGroup(token, input, { ...ctx, requestId: randomUUID() }).then(value => ({ value }), error => ({ error }))
    try {
      await expect.poll(async () => {
        const [row] = await owner`select count(*)::int as count from pg_stat_activity where usename = 'haas_app' and wait_event = 'advisory'`
        return row!.count
      }).toBeGreaterThan(0)
    } finally { release(); await revocation }
    expect(await result).toMatchObject({ error: { status: 401 } })
  })

  it('enforces group capacity without returning partial lists', async () => {
    const { identity, token, tenantId } = await fixture()
    await owner`insert into haas.member_groups ${owner(Array.from({ length: 200 }, (_, index) => ({ tenant_id: tenantId, group_id: randomUUID(), name: `Capacity ${index}`, status: 'active', revision: 1 })))}`
    expect(await identity.listGroups(token, randomUUID())).toHaveLength(200)
    await expect(identity.createGroup(token, { name: 'Over capacity' }, context())).rejects.toMatchObject({ code: 'group-capacity' })
    await owner`insert into haas.member_groups (tenant_id, group_id, name, status, revision) values (${tenantId}, ${randomUUID()}, 'External overflow', 'active', 1)`
    await expect(identity.listGroups(token, randomUUID())).rejects.toMatchObject({ code: 'group-capacity' })
  })

  it('rejects an externally oversized member list or group instead of dropping unreturned members on edit', async () => {
    const { identity, token, tenantId } = await fixture()
    const group = (await identity.createGroup(token, { name: '有界成员集合' }, context())).data
    const [source] = await owner`select credential from haas.users where tenant_id = ${tenantId} limit 1`
    // Only this isolated test tenant is seeded beyond the public UI capacity.
    await owner`insert into haas.users ${owner(Array.from({ length: 498 }, (_, index) => ({ tenant_id: tenantId, user_id: randomUUID(),
      username: `capacity.${index}`, display_name: `Capacity ${index}`, role: 'member', status: 'active', credential: source!.credential })))}`
    await expect(identity.listMembers(token, randomUUID())).rejects.toMatchObject({ code: 'member-list-capacity' })
    const members = await owner`select user_id from haas.users where tenant_id = ${tenantId}`
    expect(members).toHaveLength(501)
    await owner`insert into haas.group_members ${owner(members.map(row => ({ tenant_id: tenantId, group_id: group.groupId, user_id: row.user_id })))}`
    await expect(identity.listGroups(token, randomUUID())).rejects.toMatchObject({ code: 'group-capacity' })
    await expect(identity.updateGroup(token, group.groupId, edit(group, []), context())).rejects.toMatchObject({ code: 'group-capacity' })
    expect(await owner`select user_id from haas.group_members where tenant_id = ${tenantId} and group_id = ${group.groupId}`).toHaveLength(501)
  })

  it('serves actual HTTP group commands with same-origin, idempotency, role and body boundaries', async () => {
    const { identity, token, hansen, tenantId } = await fixture()
    const reservation = reservePort(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('Missing isolated port')
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
    const publicOrigin = `http://127.0.0.1:${address.port}`
    const server = createEnterpriseServer({ identity, publicOrigin, loopbackDevelopment: true })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(address.port, '127.0.0.1', resolve) })
    const request = (path = '', method = 'GET', body?: object, extra: Record<string, string> = {}) => fetch(`${publicOrigin}/haas/v1/admin/groups${path}`, {
      method, headers: { cookie: `paimind_haas_session=${token}`, origin: publicOrigin, 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}),
    })
    try {
      const created = await request('', 'POST', { name: '真实接口成员组' }); expect(created.status).toBe(201)
      const group = (await created.json() as { data: MemberGroup }).data
      const updated = await request(`/${group.groupId}`, 'PATCH', edit(group, [hansen.userId])); expect(updated.status).toBe(200)
      const value = (await updated.json() as { data: MemberGroup }).data
      const archived = await request(`/${group.groupId}/status`, 'PATCH', status(value, 'archived')); expect(archived.status).toBe(200)
      const list = await request(); expect(list.headers.get('cache-control')).toBe('no-store')
      expect((await list.json() as { data: MemberGroup[] }).data).toEqual([{ ...value, revision: 3, status: 'archived' }])
      expect((await request('', 'POST', { name: 'denied' }, { origin: 'https://foreign.invalid' })).status).toBe(403)
      expect((await request('', 'POST', { name: 'denied' }, { 'idempotency-key': 'bad' })).status).toBe(400)
      expect((await request('', 'POST', { name: 'denied', role: 'admin' })).status).toBe(400)
      const member = (await identity.login({ username: memberInput.username, password: memberInput.password }, context())).token
      expect((await request('', 'GET', undefined, { cookie: `paimind_haas_session=${member}` })).status).toBe(403)
      expect((await request('?tenantId=foreign')).status).toBe(400)
      expect((await request('', 'GET', undefined, { cookie: '' })).status).toBe(401)
      const [source] = await owner`select credential from haas.users where tenant_id = ${tenantId} limit 1`
      await owner`insert into haas.users ${owner(Array.from({ length: 497 }, (_, index) => ({ tenant_id: tenantId, user_id: randomUUID(),
        username: `http.capacity.${index}`, display_name: `Capacity ${index}`, role: 'member', status: 'active', credential: source!.credential })))}`
      const allMembers = await identity.listMembers(token, randomUUID()); expect(allMembers).toHaveLength(500)
      const capacityResponse = await request('', 'POST', { name: '全量成员组' })
      const capacityGroup = (await capacityResponse.json() as { data: MemberGroup }).data
      const fullEdit = edit(capacityGroup, allMembers.map(member => member.userId))
      expect(Buffer.byteLength(JSON.stringify(fullEdit))).toBeGreaterThan(16_384)
      expect(Buffer.byteLength(JSON.stringify(fullEdit))).toBeLessThan(32_768)
      const fullResponse = await request(`/${capacityGroup.groupId}`, 'PATCH', fullEdit)
      expect(fullResponse.status).toBe(200)
      expect((await fullResponse.json() as { data: MemberGroup }).data.memberIds).toEqual(fullEdit.memberIds.sort())
      const beforeOverflow = await identity.listGroups(token, randomUUID())
      expect((await request(`/${capacityGroup.groupId}`, 'PATCH', { ...fullEdit, ignored: 'x'.repeat(32_768) })).status).toBe(413)
      expect((await request('', 'POST', { name: 'x'.repeat(16_384) })).status).toBe(413)
      expect((await request(`/${capacityGroup.groupId}/status`, 'PATCH', { ...status(capacityGroup, 'archived'), reason: 'x'.repeat(16_384) })).status).toBe(413)
      expect(await identity.listGroups(token, randomUUID())).toEqual(beforeOverflow)
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  })
})
