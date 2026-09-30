import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { Identity } from '../src/identity.js'
import { createEnterpriseServer } from '../src/server.js'
import { createServer as createPortReservation } from 'node:net'

const configPath = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!configPath || (statSync(configPath).mode & 0o077) !== 0) throw new Error('A private isolated PAIMIND_HAAS_TEST_CONFIG is required; integration tests never fall back to mocks')
const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
  ownerUrl: string; applicationUrl: string; bootstrapSecret: string; masterKey: string
}
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || ['3080', '10012', '5432'].includes(url.port)) {
    throw new Error('Refusing a non-isolated integration database')
  }
}
const owner = postgres(config.ownerUrl, { max: 2, onnotice: () => {} })
const sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
afterAll(async () => { await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })

const adminInput = { username: 'administrator', displayName: '验收管理员', password: 'Synthetic administrator password 2026' }
const memberInput = { username: 'member.a', displayName: 'Morgan', password: 'Synthetic member password 2026' }
const context = () => ({ key: randomUUID(), requestId: randomUUID() })

async function fresh() {
  const tenantId = `identity-test-${randomUUID()}`
  await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
  const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
  return { identity, tenantId }
}
async function initialized() {
  const fixture = await fresh()
  const admin = await fixture.identity.bootstrap({ ...adminInput, bootstrapSecret: config.bootstrapSecret }, context())
  const login = await fixture.identity.login({ username: adminInput.username, password: adminInput.password }, context())
  return { ...fixture, admin: admin.data, token: login.token }
}

describe('identity against real isolated PostgreSQL', () => {
  it('signs bounded browser correlation without changing exact login authority or legacy history', async () => {
    const { identity, token, tenantId } = await initialized()
    const member = await identity.createMember(token, { ...memberInput, username: 'alex', displayName: 'Alex' }, context())
    const credentials = { username: 'alex', password: memberInput.password }
    const first = await identity.login(credentials, context()), second = await identity.login(credentials, context())
    const scope = { tenantId, userId: member.data.userId, role: 'member' as const, cellId: randomUUID(), nativeSessionId: 'session-alex' }
    const id = 'browser-correlation-id'
    const signed = await identity.sealInteractiveOrigin(first.token, randomUUID(), scope, id)
    const legacy = await identity.sealInteractiveOrigin(first.token, randomUUID(), scope)
    const other = await identity.sealInteractiveOrigin(second.token, randomUUID(), scope, id)
    const read = (source: string) => identity.withInteractiveOrigin(source, randomUUID(), scope, async p => p.sessionId)
    const payload = JSON.parse(Buffer.from(signed.split('.')[1]!, 'base64url').toString())
    expect(payload.clientRpcId).toBe(id)
    expect(Object.keys(payload).sort()).toEqual(['tenantId', 'userId', 'role', 'cellId', 'nativeSessionId', 'loginSessionId', 'requestId', 'nonce', 'clientRpcId'].sort())
    expect(await read(signed)).toBe(await read(legacy))
    expect(await read(signed)).not.toBe(await read(other))
    for (const clientRpcId of ['', 'x'.repeat(201), 'x\n', ' x']) {
      await expect(identity.sealInteractiveOrigin(first.token, randomUUID(), scope, clientRpcId)).rejects.toMatchObject({ status: 400 })
    }
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const changed = encode({ ...payload, clientRpcId: 'another-browser-id' })
    await expect(read(`paimind-origin-v1.${changed}.${signed.split('.')[2]}`)).rejects.toMatchObject({ status: 403 })
    for (const fields of [{ clientRpcId: null }, { clientRpcId: '' }, { clientRpcId: 'x'.repeat(201) },
      { clientRpcId: 'x\n' }, { delegatedPresetId: 'child-preset' }, { nativeJobId: 'job' }]) {
      const encoded = encode({ ...payload, ...fields })
      const signature = createHmac('sha256', Buffer.from(config.masterKey, 'base64url'))
        .update(JSON.stringify(['interactive-origin-v1', tenantId, encoded])).digest('base64url')
      await expect(read(`paimind-origin-v1.${encoded}.${signature}`)).rejects.toMatchObject({ status: 403 })
    }
    const children = await identity.deriveInteractiveOrigins([signed], randomUUID(), scope, 'child-session', 'child-preset', async () => {})
    expect(JSON.parse(Buffer.from(children[0]!.split('.')[1]!, 'base64url').toString())).not.toHaveProperty('clientRpcId')
    await expect(identity.withInteractiveOrigin(signed, randomUUID(), { ...scope, nativeSessionId: 'session-hansen' }, async () => true)).rejects.toMatchObject({ status: 403 })
    await expect(identity.me(signed, randomUUID())).rejects.toMatchObject({ status: 401 })
    await identity.logout(first.token, {}, context())
    await expect(read(signed)).rejects.toMatchObject({ status: 401 })
    await expect(read(legacy)).rejects.toMatchObject({ status: 401 })
    expect(await read(other)).toBeTypeOf('string')
  })

  it('binds signed native sources to the exact Hansen login, never another login, member, cell or session', async () => {
    const { identity, token, tenantId } = await initialized()
    const credentials = { username: 'hansen', password: 'Synthetic Hansen origin password 2026' }
    const member = await identity.createMember(token, { ...credentials, displayName: 'Hansen' }, context())
    const alex = await identity.createMember(token, { username: 'alex', displayName: 'Alex', password: 'Synthetic Alex origin password 2026' }, context())
    const first = await identity.login(credentials, context()), second = await identity.login(credentials, context())
    const scope = { tenantId, userId: member.data.userId, role: 'member' as const, cellId: randomUUID(), nativeSessionId: 'session-hansen' }
    const requestId = randomUUID()
    const firstSource = await identity.sealInteractiveOrigin(first.token, requestId, scope)
    const repeated = await identity.sealInteractiveOrigin(first.token, requestId, scope)
    const secondSource = await identity.sealInteractiveOrigin(second.token, requestId, scope)
    expect(new Set([firstSource, repeated, secondSource]).size).toBe(3)
    for (const secret of [first.token, second.token, config.masterKey, credentials.password]) expect(firstSource).not.toContain(secret)
    const origin = JSON.parse(Buffer.from(firstSource.split('.')[1]!, 'base64url').toString())
    expect(Object.keys(origin).sort()).toEqual(['tenantId', 'userId', 'role', 'cellId', 'nativeSessionId', 'loginSessionId', 'requestId', 'nonce'].sort())
    expect(origin).toMatchObject({ ...scope, requestId })
    const read = (source: string, selected = scope) => identity.withInteractiveOrigin(source, randomUUID(), selected, async principal => principal)
    const firstPrincipal = await read(firstSource), secondPrincipal = await read(secondSource)
    expect(origin.loginSessionId).toBe(firstPrincipal.sessionId)
    expect(firstPrincipal.account.userId).toBe(member.data.userId)
    expect(firstPrincipal.sessionId).not.toBe(secondPrincipal.sessionId)
    for (const selected of [{ ...scope, userId: alex.data.userId }, { ...scope, cellId: randomUUID() },
      { ...scope, tenantId: 'foreign' }, { ...scope, nativeSessionId: 'session-alex' }, { ...scope, role: 'admin' }]) {
      await expect(identity.withInteractiveOrigin(firstSource, randomUUID(), selected as typeof scope, async () => true)).rejects.toMatchObject({ status: 403 })
    }
    for (const source of [firstSource + '.', firstSource.replace('paimind-origin-v1', 'paimind-origin-v2'),
      firstSource.slice(0, -43) + (firstSource.at(-43) === 'A' ? 'B' : 'A') + firstSource.slice(-42),
      'caller-selected-id', firstSource.split('.')[1]!]) await expect(read(source)).rejects.toMatchObject({ status: 403 })
    // Even a signer regression must not make a structurally unknown ticket
    // usable. Only this synthetic fixture holds its own signing key.
    for (const value of [{ ...origin, bearer: first.token }, { ...origin, nonce: 'invalid' }, { ...origin, loginSessionId: null }]) {
      const encoded = Buffer.from(JSON.stringify(value)).toString('base64url')
      const signature = createHmac('sha256', Buffer.from(config.masterKey, 'base64url'))
        .update(JSON.stringify(['interactive-origin-v1', tenantId, encoded])).digest('base64url')
      await expect(read(`paimind-origin-v1.${encoded}.${signature}`)).rejects.toMatchObject({ status: 403 })
    }
    await expect(identity.me(firstSource, randomUUID())).rejects.toMatchObject({ status: 401 })
    await expect(identity.sealInteractiveOrigin(token, randomUUID(), scope)).rejects.toMatchObject({ status: 403 })
    const recreated = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
    expect(await recreated.withInteractiveOrigin(firstSource, randomUUID(), scope, async p => p.sessionId)).toBe(firstPrincipal.sessionId)
    const wrongKey = new Identity(sql, tenantId, randomBytes(32), config.bootstrapSecret)
    await expect(wrongKey.withInteractiveOrigin(firstSource, randomUUID(), scope, async () => true)).rejects.toMatchObject({ status: 403 })
    await identity.logout(first.token, {}, context())
    await expect(read(firstSource)).rejects.toMatchObject({ status: 401 })
    await expect(read(repeated)).rejects.toMatchObject({ status: 401 })
    expect((await read(secondSource)).sessionId).toBe(secondPrincipal.sessionId)
    await owner`update haas.login_sessions set expires_at = clock_timestamp() - interval '1 second'
      where tenant_id = ${tenantId} and session_id = ${secondPrincipal.sessionId}`
    await expect(read(secondSource)).rejects.toMatchObject({ status: 401 })
    const [{ count }] = await owner`select count(*)::int as count from haas.login_sessions where tenant_id = ${tenantId}`
    expect(count).toBe(3) // administrator plus the two real logins; no source registry/login synthesis
  })

  it('rechecks origin account role, disablement, tenant suspension and browser-login replacement', async () => {
    const { identity, token, tenantId } = await initialized()
    const credentials = { username: 'hansen', password: 'Synthetic Hansen origin password 2026' }
    const member = await identity.createMember(token, { ...credentials, displayName: 'Hansen' }, context())
    const first = await identity.login(credentials, context())
    const scope = { tenantId, userId: member.data.userId, role: 'member' as const, cellId: randomUUID(), nativeSessionId: 'session-hansen' }
    const source = await identity.sealInteractiveOrigin(first.token, randomUUID(), scope)
    const read = (value = source) => identity.withInteractiveOrigin(value, randomUUID(), scope, async p => p.account.userId)
    await owner`update haas.users set role = 'admin' where tenant_id = ${tenantId} and user_id = ${member.data.userId}`
    await expect(read()).rejects.toMatchObject({ status: 403 })
    await owner`update haas.users set role = 'member' where tenant_id = ${tenantId} and user_id = ${member.data.userId}`
    await owner`update haas.tenants set status = 'disabled' where tenant_id = ${tenantId}`
    await expect(read()).rejects.toMatchObject({ status: 401 })
    await owner`update haas.tenants set status = 'active' where tenant_id = ${tenantId}`
    const replacement = await identity.login(credentials, context(), first.token)
    await expect(read()).rejects.toMatchObject({ status: 401 })
    const next = await identity.sealInteractiveOrigin(replacement.token, randomUUID(), scope)
    expect(await read(next)).toBe(member.data.userId)
    await identity.setMemberStatus(token, member.data.userId, { status: 'disabled', reason: '来源撤销验收' }, context())
    await expect(read(next)).rejects.toMatchObject({ status: 401 })
    await identity.setMemberStatus(token, member.data.userId, { status: 'active', reason: '来源恢复验收' }, context())
    await expect(read(next)).rejects.toMatchObject({ status: 401 })
  })

  it('serves only the control-plane API and keeps removed standalone UI routes absent', async () => {
    const { identity, token, tenantId } = await initialized()
    const reservation = createPortReservation()
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('Missing isolated test port')
    const publicOrigin = `http://127.0.0.1:${address.port}`
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
    const server = createEnterpriseServer({ identity, publicOrigin, loopbackDevelopment: true })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(address.port, '127.0.0.1', resolve) })
    try {
      for (const path of ['/', '/workspace', '/admin', '/admin/members', '/admin/audit', '/app.js', '/app.css']) {
        const response = await fetch(`${publicOrigin}${path}`)
        expect(response.status).toBe(404)
        expect(response.headers.get('content-type')).toContain('application/problem+json')
        expect(await response.text()).not.toContain('<html')
      }
      const anonymous = await fetch(`${publicOrigin}/haas/v1/admin/members`)
      expect(anonymous.status).toBe(401)
      const response = await fetch(`${publicOrigin}/haas/v1/admin/members`, { headers: { cookie: `paimind_haas_session=${token}` } })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect((await response.json() as { data: object[] }).data).toHaveLength(1)
      const forged = await fetch(`${publicOrigin}/haas/v1/auth/me`, { headers: {
        cookie: `paimind_haas_session=${token}`, 'x-paimind-principal-context': 'forged',
      } })
      expect(forged.status).toBe(400)
      const crossOrigin = await fetch(`${publicOrigin}/haas/v1/admin/members`, { method: 'POST', headers: {
        cookie: `paimind_haas_session=${token}`, origin: 'https://untrusted.invalid',
        'content-type': 'application/json', 'idempotency-key': randomUUID(),
      }, body: JSON.stringify(memberInput) })
      expect(crossOrigin.status).toBe(403)
      expect(await owner`select user_id from haas.users where tenant_id = ${tenantId}`).toHaveLength(1)
      const member = (await identity.createMember(token, memberInput, context())).data
      const renamed = await fetch(`${publicOrigin}/haas/v1/admin/members/${member.userId}/name`, { method: 'PATCH', headers: {
        cookie: `paimind_haas_session=${token}`, origin: publicOrigin, 'content-type': 'application/json', 'idempotency-key': randomUUID(),
      }, body: JSON.stringify({ displayName: 'Taylor', expectedDisplayName: member.displayName }) })
      expect(renamed.status).toBe(200)
      expect((await renamed.json() as { data: object }).data).toEqual({ ...member, displayName: 'Taylor' })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
  it('bootstraps once, replays the same logical bootstrap, and rejects a second administrator', async () => {
    const { identity, tenantId } = await fresh()
    expect(await identity.bootstrapState()).toEqual({ configured: false })
    const ctx = context()
    const input = { ...adminInput, bootstrapSecret: config.bootstrapSecret }
    const first = await identity.bootstrap(input, ctx)
    const replay = await identity.bootstrap(input, { ...ctx, requestId: randomUUID() })
    expect(first.data).toMatchObject({ role: 'admin', tenantId, username: adminInput.username })
    expect(replay).toEqual({ ...first, replayed: true })
    expect(await identity.bootstrapState()).toEqual({ configured: true })
    await expect(identity.bootstrap({ ...input, username: 'another.admin' }, context())).rejects.toMatchObject({ code: 'bootstrap-closed' })
    const [{ count }] = await owner`select count(*)::int as count from haas.users where tenant_id = ${tenantId}`
    expect(count).toBe(1)
  })

  it('rejects forged identity fields and incorrect bootstrap proof before writing accounts', async () => {
    const { identity, tenantId } = await fresh()
    await expect(identity.bootstrap({ ...adminInput, bootstrapSecret: randomBytes(32).toString('base64url') }, context())).rejects.toMatchObject({ status: 403 })
    await expect(identity.bootstrap({ ...adminInput, bootstrapSecret: config.bootstrapSecret, role: 'admin' }, context())).rejects.toMatchObject({ status: 400 })
    await expect(identity.bootstrap({ ...adminInput, bootstrapSecret: config.bootstrapSecret, tenantId: 'other' }, context())).rejects.toMatchObject({ status: 400 })
    expect(await owner`select user_id from haas.users where tenant_id = ${tenantId}`).toHaveLength(0)
  })

  it('replays login without storing a bearer token and never revives the logged-out session', async () => {
    const { identity, tenantId } = await initialized()
    const ctx = context()
    const credentials = { username: adminInput.username, password: adminInput.password }
    const first = await identity.login(credentials, ctx)
    const replay = await identity.login(credentials, { ...ctx, requestId: randomUUID() })
    expect(replay.token).toBe(first.token)
    expect(replay.replayed).toBe(true)
    const receipts = await owner`select * from haas.command_receipts where tenant_id = ${tenantId}`
    const sessions = await owner`select * from haas.login_sessions where tenant_id = ${tenantId}`
    const audits = await owner`select * from haas.audit_events where tenant_id = ${tenantId}`
    const stored = JSON.stringify({ receipts, sessions, audits })
    for (const secret of [first.token, adminInput.password, config.bootstrapSecret]) expect(stored).not.toContain(secret)
    const out = context()
    await identity.logout(first.token, {}, out)
    expect((await identity.logout(first.token, {}, out)).replayed).toBe(true)
    await expect(identity.me(first.token, randomUUID())).rejects.toMatchObject({ status: 401 })
    await expect(identity.login(credentials, ctx)).rejects.toMatchObject({ status: 401 })
  })

  it('creates a non-administrator member and rejects every administration operation from that member', async () => {
    const { identity, token } = await initialized()
    const member = await identity.createMember(token, memberInput, context())
    expect(member.data.role).toBe('member')
    const login = await identity.login({ username: memberInput.username, password: memberInput.password }, context())
    expect((await identity.me(login.token, randomUUID())).userId).toBe(member.data.userId)
    for (const operation of [
      () => identity.listMembers(login.token, randomUUID()),
      () => identity.createMember(login.token, { ...memberInput, role: 'admin' }, context()),
      () => identity.setMemberStatus(login.token, member.data.userId, { status: 'disabled', reason: '越权探测' }, context()),
      () => identity.renameMember(login.token, member.data.userId, { displayName: 'Taylor', expectedDisplayName: member.data.displayName }, context()),
      () => identity.listAudit(login.token, randomUUID()),
    ]) await expect(operation()).rejects.toMatchObject({ status: 403 })
    await expect(identity.createMember(token, { ...memberInput, role: 'admin' }, context())).rejects.toMatchObject({ status: 400 })
  })

  it('account switching revokes only the replaced browser session, not another device or the replayed new login', async () => {
    const { identity, token } = await initialized()
    const anotherDevice = await identity.login({ username: adminInput.username, password: adminInput.password }, context())
    await identity.createMember(token, memberInput, context())
    await expect(identity.login({ username: memberInput.username, password: 'Wrong synthetic password 2026' }, context(), token)).rejects.toMatchObject({ status: 401 })
    expect((await identity.me(token, randomUUID())).role).toBe('admin')
    const ctx = context()
    const credentials = { username: memberInput.username, password: memberInput.password }
    const switched = await identity.login(credentials, ctx, token)
    await expect(identity.me(token, randomUUID())).rejects.toMatchObject({ status: 401 })
    expect((await identity.me(anotherDevice.token, randomUUID())).role).toBe('admin')
    expect((await identity.login(credentials, { ...ctx, requestId: randomUUID() }, switched.token)).token).toBe(switched.token)
    expect((await identity.me(switched.token, randomUUID())).role).toBe('member')
    const audit = await identity.listAudit(anotherDevice.token, randomUUID())
    expect(audit.filter(row => row.action === 'identity.session.replaced')).toHaveLength(1)
  })

  it('disabling a member revokes all sessions; enabling does not revive any old session', async () => {
    const { identity, token } = await initialized()
    const member = await identity.createMember(token, memberInput, context())
    const credentials = { username: memberInput.username, password: memberInput.password }
    const first = await identity.login(credentials, context())
    const second = await identity.login(credentials, context())
    await identity.setMemberStatus(token, member.data.userId, { status: 'disabled', reason: '测试成员停用' }, context())
    for (const session of [first, second]) await expect(identity.me(session.token, randomUUID())).rejects.toMatchObject({ status: 401 })
    await expect(identity.login(credentials, context())).rejects.toMatchObject({ code: 'invalid-credentials' })
    await identity.setMemberStatus(token, member.data.userId, { status: 'active', reason: '测试成员重新启用' }, context())
    await expect(identity.me(first.token, randomUUID())).rejects.toMatchObject({ status: 401 })
    expect((await identity.login(credentials, context())).data.userId).toBe(member.data.userId)
  })

  it('does not expose or mutate a known foreign-tenant identity even for an administrator', async () => {
    const first = await initialized()
    const second = await initialized()
    const foreign = await second.identity.createMember(second.token, memberInput, context())
    await expect(first.identity.me(second.token, randomUUID())).rejects.toMatchObject({ status: 401 })
    await expect(first.identity.setMemberStatus(first.token, foreign.data.userId, { status: 'disabled', reason: '跨租户探测' }, context())).rejects.toMatchObject({ status: 404 })
    await expect(first.identity.renameMember(first.token, foreign.data.userId, { displayName: 'Taylor', expectedDisplayName: foreign.data.displayName }, context())).rejects.toMatchObject({ status: 404 })
    expect((await first.identity.listMembers(first.token, randomUUID())).every(row => row.tenantId === first.tenantId)).toBe(true)
    expect((await second.identity.listMembers(second.token, randomUUID())).find(row => row.userId === foreign.data.userId)?.status).toBe('active')
  })

  it('serializes concurrent equal commands with one mutation and one success audit', async () => {
    const { identity, token, tenantId } = await initialized()
    const ctx = context()
    const results = await Promise.all([
      identity.createMember(token, memberInput, ctx),
      identity.createMember(token, memberInput, { ...ctx, requestId: randomUUID() }),
    ])
    expect(results[0].data).toEqual(results[1].data)
    expect(results.map(result => result.replayed).sort()).toEqual([false, true])
    expect(await owner`select user_id from haas.users where tenant_id = ${tenantId} and role = 'member'`).toHaveLength(1)
    expect(await owner`select event_id from haas.audit_events where tenant_id = ${tenantId}
      and action = 'identity.member.create' and outcome = 'succeeded'`).toHaveLength(1)
    await expect(identity.createMember(token, { ...memberInput, username: 'different' }, ctx)).rejects.toMatchObject({ code: 'idempotency-conflict' })
  })

  it('renames only a member display name, preserving identity and logins with replay and stale-edit protection', async () => {
    const { identity, token, tenantId, admin } = await initialized()
    const member = (await identity.createMember(token, memberInput, context())).data
    const login = await identity.login({ username: memberInput.username, password: memberInput.password }, context())
    const [before] = await owner`select * from haas.users where tenant_id = ${tenantId} and user_id = ${member.userId}`
    const input = { displayName: 'Taylor', expectedDisplayName: member.displayName }
    const ctx = context()
    const results = await Promise.all([identity.renameMember(token, member.userId, input, ctx),
      identity.renameMember(token, member.userId, input, { ...ctx, requestId: randomUUID() })])
    expect(results.map(row => row.replayed).sort()).toEqual([false, true])
    expect(results[0].data).toEqual({ ...member, displayName: 'Taylor' })
    expect(await identity.me(login.token, randomUUID())).toEqual({ ...member, displayName: 'Taylor' })
    const [after] = await owner`select * from haas.users where tenant_id = ${tenantId} and user_id = ${member.userId}`
    expect(after).toEqual({ ...before, display_name: 'Taylor' })
    await expect(identity.renameMember(token, member.userId, { ...input, displayName: 'Hansen' }, context())).rejects.toMatchObject({ status: 409, code: 'member-name-changed' })
    for (const invalid of [{ ...input, displayName: '' }, { ...input, displayName: ' Taylor' }, { ...input, role: 'admin' }]) {
      await expect(identity.renameMember(token, member.userId, invalid, context())).rejects.toMatchObject({ status: 400 })
    }
    await expect(identity.renameMember(token, admin.userId, { displayName: 'Taylor', expectedDisplayName: admin.displayName }, context())).rejects.toMatchObject({ status: 404 })
    const audits = await owner`select target_id, reason from haas.audit_events where tenant_id = ${tenantId}
      and action = 'identity.member.rename' and outcome = 'succeeded'`
    expect(audits).toEqual([{ target_id: member.userId, reason: '姓名从「Morgan」改为「Taylor」' }])
  })

  it('rolls back a rename and its receipt when its own tenant success audit fails', async () => {
    const { identity, token, tenantId } = await initialized()
    const member = (await identity.createMember(token, memberInput, context())).data
    const trigger = `test_rename_audit_${randomUUID().replaceAll('-', '')}`
    expect(tenantId).toMatch(/^identity-test-[a-f0-9-]+$/)
    await owner.unsafe(`create function haas.${trigger}() returns trigger language plpgsql as $$
      begin if NEW.tenant_id = '${tenantId}' and NEW.action = 'identity.member.rename' and NEW.outcome = 'succeeded' then
        raise exception 'injected rename audit failure'; end if; return NEW; end; $$;
      create trigger ${trigger} before insert on haas.audit_events for each row execute function haas.${trigger}();`)
    const ctx = context(); const input = { displayName: 'Taylor', expectedDisplayName: member.displayName }
    try {
      await expect(identity.renameMember(token, member.userId, input, ctx)).rejects.toMatchObject({ status: 503 })
      expect((await identity.listMembers(token, randomUUID())).find(row => row.userId === member.userId)).toEqual(member)
      expect(await owner`select operation_id from haas.command_receipts where tenant_id = ${tenantId} and idempotency_key = ${ctx.key}`).toHaveLength(0)
    } finally {
      await owner.unsafe(`drop trigger ${trigger} on haas.audit_events; drop function haas.${trigger}();`)
    }
    expect((await identity.renameMember(token, member.userId, input, ctx)).replayed).toBe(false)
  })

  it('rolls back the user and receipt if the atomic success audit cannot be appended', async () => {
    const { identity, token, tenantId } = await initialized()
    const trigger = `test_success_audit_${randomUUID().replaceAll('-', '')}`
    expect(tenantId).toMatch(/^identity-test-[a-f0-9-]+$/)
    await owner.unsafe(`create function haas.${trigger}() returns trigger language plpgsql as $$
      begin if NEW.tenant_id = '${tenantId}' and NEW.action = 'identity.member.create' and NEW.outcome = 'succeeded' then
        raise exception 'injected audit failure'; end if; return NEW; end; $$;
      create trigger ${trigger} before insert on haas.audit_events for each row execute function haas.${trigger}();`)
    const ctx = context()
    try {
      await expect(identity.createMember(token, memberInput, ctx)).rejects.toMatchObject({ status: 503 })
      expect(await owner`select user_id from haas.users where tenant_id = ${tenantId} and role = 'member'`).toHaveLength(0)
      expect(await owner`select operation_id from haas.command_receipts where tenant_id = ${tenantId} and idempotency_key = ${ctx.key}`).toHaveLength(0)
      expect(await owner`select event_id from haas.audit_events where tenant_id = ${tenantId} and outcome = 'failed'`).toHaveLength(1)
    } finally {
      await owner.unsafe(`drop trigger ${trigger} on haas.audit_events; drop function haas.${trigger}();`)
    }
    expect((await identity.createMember(token, memberInput, ctx)).replayed).toBe(false)
  })

  it('enforces audit immutability and prevents the application database role from changing schema or tenant facts', async () => {
    const { identity, token, tenantId } = await initialized()
    expect((await identity.listAudit(token, randomUUID())).length).toBeGreaterThan(0)
    await expect(sql`update haas.audit_events set reason = 'tampered' where tenant_id = ${tenantId}`).rejects.toMatchObject({ code: '42501' })
    await expect(sql`delete from haas.audit_events where tenant_id = ${tenantId}`).rejects.toMatchObject({ code: '42501' })
    await expect(sql`update haas.tenants set status = 'disabled' where tenant_id = ${tenantId}`).rejects.toMatchObject({ code: '42501' })
    await expect(owner`delete from haas.audit_events where tenant_id = ${tenantId}`).rejects.toMatchObject({ code: 'P0001' })
  })

  it('rechecks current authority before replaying a previously successful admin command', async () => {
    const { identity, token } = await initialized()
    const ctx = context()
    await identity.createMember(token, memberInput, ctx)
    await identity.logout(token, {}, context())
    await expect(identity.createMember(token, memberInput, ctx)).rejects.toMatchObject({ status: 401 })
  })

  it('expires sessions according to authoritative database time', async () => {
    const { identity, token, tenantId } = await initialized()
    await owner`update haas.login_sessions set expires_at = clock_timestamp() - interval '1 second' where tenant_id = ${tenantId}`
    await expect(identity.me(token, randomUUID())).rejects.toMatchObject({ status: 401 })
  })
})
