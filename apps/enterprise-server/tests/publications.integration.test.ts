import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { createServer as reservePort } from 'node:net'
import postgres from 'postgres'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createAgentPublicationSnapshot } from '@paimind/agent-builder/publication'
import { adoptedPresetId, type AgentPublicationAdoption } from '@paimind/agent-builder/adoption'
import { Identity } from '../src/identity.js'
import { Publications, type PublicationSource, type PublicationAdoption } from '../src/publications.js'
import { SkillPublications } from '../src/skill-publications.js'
import { EnterpriseError } from '../src/errors.js'
import { createEnterpriseServer } from '../src/server.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import type { NativeExecutionInput } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'

const path = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!path || statSync(path).mode & 0o077) throw new Error('Private isolated database config required')
const config = JSON.parse(readFileSync(path, 'utf8')) as { ownerUrl: string; applicationUrl: string; masterKey: string; bootstrapSecret: string }
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || ['3080', '10012', '5432'].includes(url.port)) throw new Error('Refusing non-isolated database')
}
const owner = postgres(config.ownerUrl, { max: 3, onnotice: () => {} })
const sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
afterAll(async () => { await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })
const context = () => ({ key: randomUUID(), requestId: randomUUID() })
const password = 'Synthetic publication test password 2026'
const snapshot = (dependencies: { name: string; digest: string }[] = []) => createAgentPublicationSnapshot({
  schema: 'paimind.agent-publication/v1', agentId: 'hansen-client', presetId: 'hansen-client', configVersion: 'v1-fixture',
  profile: { name: 'Hansen 客户跟进助手', description: '客户跟进', basePresetId: 'standard', role: '客户助理', goal: '梳理跟进事项',
    behavior: '明确依据', instructions: '', preferredSkillNames: dependencies.map(row => row.name) }, dependencies,
  nativeCompositionDigest: 'sha256:' + 'b'.repeat(64),
})
const submitInput = { presetId: 'hansen-client', expectedVersion: 'v1-fixture', reason: '提交企业共享审核' }
async function reviewedSkill(f: Awaited<ReturnType<typeof fixture>>, name: string, digest: string) {
  // Explicit Skill archive source double for governance assertions only. The
  // original Skill archive/private-owner combinations live in the companion
  // integration suite; this helper is not native adoption or model evidence.
  const bytes = Buffer.from('Explicit archive source double ' + randomUUID())
  const service = new SkillPublications(sql, f.identity, async (_token, _requestId, _principal, _selection, sink, abort) => {
    await sink(bytes, 0, abort)
    return { schema: 'paimind.skill-export/v1', exportId: randomUUID(), name, packageDigest: digest,
      archiveDigest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'), archiveBytes: bytes.length, expandedBytes: 16, entryCount: 1 }
  })
  const submitted = (await service.submit(f.admin, { skillId: name, expectedDigest: digest, reason: '审核固定技能依赖' }, context(), new AbortController().signal)).data
  let current = (await service.review(f.admin, submitted.publicationId, { decision: 'publish', expectedRevision: 1, reason: '确认固定技能版本' }, context())).data
  const assign = async (userId: string, effect: 'allow' | 'deny' = 'allow') => {
    current = (await service.assign(f.admin, current.publicationId, { subjectKind: 'user', subjectId: userId, effect, active: true,
      expectedRevision: current.revision, reason: '明确依赖技能权限' }, context())).data
  }
  const read = () => f.identity.resourceRead(f.admin, randomUUID(), true, (db, principal) => SkillPublications.readPublicationVersion(db, principal, submitted.publicationId))
  return { service, submitted, assign, read, current: () => current }
}
async function fixture(dependencies: { name: string; digest: string }[] = [], adoption?: PublicationAdoption) {
  const tenantId = `publications-${randomUUID()}`
  await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
  const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
  await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, context())
  const admin = (await identity.login({ username: 'morgan', password }, context())).token
  const hansen = (await identity.createMember(admin, { username: 'hansen', displayName: 'Hansen', password }, context())).data
  const alex = (await identity.createMember(admin, { username: 'alex', displayName: 'Alex', password }, context())).data
  const hansenToken = (await identity.login({ username: 'hansen', password }, context())).token
  const alexToken = (await identity.login({ username: 'alex', password }, context())).token
  // Explicit source fixture: database/identity/transactions are real; this is
  // not evidence of real native delivery, worker materialization or Browser E2E.
  const source = vi.fn<PublicationSource>(async () => snapshot(dependencies))
  const publications = new Publications(identity, source, adoption)
  const submitted = (await publications.submit(hansenToken, submitInput, context())).data
  const review = (decision: 'publish' | 'reject' | 'withdraw', expectedRevision = submitted.revision) =>
    publications.review(admin, submitted.publicationId, { decision, expectedRevision, reason: '管理员审核测试说明' }, context())
  const assign = (expectedRevision: number, subjectKind: 'user' | 'group' | 'all', subjectId?: string, effect: 'allow' | 'deny' = 'allow', active = true) =>
    publications.assign(admin, submitted.publicationId, { expectedRevision, subjectKind, ...(subjectId ? { subjectId } : {}), effect, active, reason: '明确分配调整测试' }, context())
  return { tenantId, identity, admin, hansen, alex, hansenToken, alexToken, source, publications, submitted, review, assign }
}

function adoptionDouble() {
  // Explicit in-memory owner double, not evidence of native file effects.
  const receipts = new Map<string, AgentPublicationAdoption>()
  const key = (userId: string, publicationId: string) => userId + '/' + publicationId
  const bridge = vi.fn<PublicationAdoption>(async (_token, _requestId, principal, input, mode) => {
    const id = key(principal.account.userId, input.publicationId)
    if (mode === 'verify' && !receipts.has(id)) throw new EnterpriseError(409, 'publication-adoption-rejected', 'Missing native fixture receipt')
    if (!receipts.has(id)) receipts.set(id, { ...input, schema: 'paimind.agent-adoption/v1', presetId: adoptedPresetId(input.publicationId),
      configVersion: 'v2-native-fixture', nativeCompositionDigest: 'sha256:' + 'c'.repeat(64), adoptedAt: 100 })
    return receipts.get(id)!
  })
  return { receipts, bridge, key }
}
async function assignedFixture() {
  const native = adoptionDouble(), f = await fixture([], native.bridge), approved = (await f.review('publish')).data
  const assigned = (await f.assign(approved.revision, 'user', f.alex.userId)).data
  const input = { expectedRevision: assigned.revision, expectedDigest: assigned.digest }
  const adopt = (command = context(), token = f.alexToken, body: object = input) => f.publications.adopt(token, assigned.publicationId, body, command)
  return { ...f, native, assigned, input, adopt }
}

async function executionFixture() {
  const f = await fixture(), approved = (await f.review('publish')).data
  const assigned = (await f.assign(approved.revision, 'user', f.alex.userId)).data
  const entries = []
  for (const token of [f.admin, f.hansenToken, f.alexToken]) {
    const principal = await f.identity.withRuntimeIdentity(token, randomUUID(), async value => value)
    // Real identity/database checks, deliberately synthetic operator pins and
    // native proof. This fixture neither creates a Worker nor executes a model.
    const occupied = new Set((await owner<{ origin: string }[]>`select origin from haas.runtime_bindings`).map(row => row.origin))
    let port = 15001
    while (occupied.has(`http://127.0.0.1:${port}`)) port++
    if (port >= 16000) throw Error('Synthetic binding fixture capacity exceeded')
    const cell: PrivateRuntimeCell = { cellId: randomUUID(), tenantId: f.tenantId, userId: principal.account.userId,
      role: principal.account.role, revision: randomUUID(), origin: `http://127.0.0.1:${port}`,
      containerId: randomUUID().replaceAll('-', '').repeat(2), imageId: 'sha256:' + 'a'.repeat(64),
      volumeName: 'paimind-haas-member-fixture-' + randomUUID(), policyDigest: 'sha256:' + 'b'.repeat(64) }
    await owner`insert into haas.runtime_bindings (cell_id, tenant_id, user_id, origin, revision, isolation_mode, status,
      lease_expires_at, container_id, image_id, volume_name, policy_digest)
      values (${cell.cellId}, ${cell.tenantId}, ${cell.userId}, ${cell.origin}, ${cell.revision}, 'container-managed', 'ready',
        clock_timestamp() + interval '10 minutes', ${cell.containerId}, ${cell.imageId}, ${cell.volumeName}, ${cell.policyDigest})`
    const nativeSessionId = 'session-' + cell.userId
    const source = await f.identity.sealInteractiveOrigin(token, randomUUID(), { tenantId: cell.tenantId, userId: cell.userId,
      role: cell.role, cellId: cell.cellId, nativeSessionId })
    entries.push({ token, cell, input: { nativeSessionId, sources: [source], skills: [], presetId: adoptedPresetId(assigned.publicationId),
      publication: { tenantId: f.tenantId, publicationId: assigned.publicationId, sourceUserId: f.hansen.userId, contentDigest: assigned.digest } } satisfies NativeExecutionInput })
  }
  const bindings = new RuntimeBindings(sql, f.identity, 'http://127.0.0.1:59900', [], entries.map(row => row.cell))
  const execute = (token = f.alexToken, replace?: Partial<NativeExecutionInput>, signal = new AbortController().signal) => {
    const entry = entries.find(row => row.token === token)!
    return bindings.authorizeInteractiveExecution(entry.cell.cellId, { ...entry.input, ...replace }, signal)
  }
  return { ...f, assigned, entries, bindings, execute }
}

describe('exact current execution policy with real PostgreSQL and explicit synthetic native pins', () => {
  it('allows assigned Alex but not author Hansen or administrator Morgan; a login check alone grants nothing', async () => {
    const f = await executionFixture()
    await expect(f.execute()).resolves.toBeUndefined()
    for (const token of [f.hansenToken, f.admin]) {
      const entry = f.entries.find(row => row.token === token)!
      await expect(f.bindings.checkInteractiveOrigins(entry.cell.cellId,
        { nativeSessionId: entry.input.nativeSessionId, sources: entry.input.sources }, new AbortController().signal)).resolves.toBeUndefined()
      await expect(f.execute(token)).rejects.toMatchObject({ status: 404 })
    }
    await expect(f.execute(f.hansenToken, { presetId: 'hansen-personal', publication: null, skills: [] })).resolves.toBeUndefined()
    expect(f.source).toHaveBeenCalledOnce() // current immutable publication, not source draft re-generation
  })
  it.each(['withdraw', 'unassign', 'deny', 'logout', 'disable', 'binding'])('rejects the same prior proof after %s', async mode => {
    const f = await executionFixture(); await f.execute()
    const alex = f.entries.find(row => row.token === f.alexToken)!, signal = new AbortController().signal
    const child = await f.bindings.deriveInteractiveOrigins(alex.cell.cellId, { ...alex.input, targetSessionId: 'alex-child' }, signal)
    const childExecution = { ...alex.input, ...child }
    const grandchild = await f.bindings.deriveInteractiveOrigins(alex.cell.cellId, { ...childExecution, targetSessionId: 'alex-grandchild' }, signal)
    await f.bindings.authorizeInteractiveExecution(alex.cell.cellId, { ...alex.input, ...grandchild }, signal)
    if (mode === 'withdraw') await f.review('withdraw', f.assigned.revision)
    if (mode === 'unassign') await f.assign(f.assigned.revision, 'user', f.alex.userId, 'allow', false)
    if (mode === 'deny') await f.assign(f.assigned.revision, 'user', f.alex.userId, 'deny')
    if (mode === 'logout') await f.identity.logout(f.alexToken, {}, context())
    if (mode === 'disable') await f.identity.setMemberStatus(f.admin, f.alex.userId, { status: 'disabled', reason: '撤销执行测试' }, context())
    if (mode === 'binding') await owner`update haas.runtime_bindings set status = 'suspended' where tenant_id = ${f.tenantId} and user_id = ${f.alex.userId}`
    await expect(f.execute()).rejects.toMatchObject({ status: ['logout', 'disable'].includes(mode) ? 401 : mode === 'binding' ? 503 : 404 })
    for (const origin of [child, grandchild]) {
      await expect(f.bindings.authorizeInteractiveExecution(alex.cell.cellId, { ...alex.input, ...origin }, signal)).rejects.toThrow()
      await expect(f.bindings.deriveInteractiveOrigins(alex.cell.cellId, { ...alex.input, ...origin, targetSessionId: 'another-child' }, signal)).rejects.toThrow()
      // Even a withdrawn resource may have its unstarted queue entry removed,
      // but no inherited source can become a personal-preset execution grant.
      if (['withdraw', 'unassign', 'deny'].includes(mode)) {
        await expect(f.bindings.checkInteractiveOrigins(alex.cell.cellId, origin, signal)).resolves.toBeUndefined()
        await expect(f.bindings.authorizeInteractiveExecution(alex.cell.cellId,
          { ...origin, presetId: 'standard', publication: null, skills: [] }, signal)).rejects.toMatchObject({ status: 403 })
      }
    }
    await expect(f.execute(f.hansenToken, { presetId: 'hansen-personal', publication: null, skills: [] })).resolves.toBeUndefined()
  })
  it('derives only the exact originating logins, constrains composition, and preserves revocation after identity recreation', async () => {
    const f = await executionFixture(), alex = f.entries.find(row => row.token === f.alexToken)!, signal = new AbortController().signal
    const second = await f.identity.login({ username: 'alex', password }, context())
    const scope = { tenantId: f.tenantId, userId: f.alex.userId, role: 'member' as const,
      cellId: alex.cell.cellId, nativeSessionId: alex.input.nativeSessionId }
    const repeated = await f.identity.sealInteractiveOrigin(f.alexToken, randomUUID(), scope)
    const otherLogin = await f.identity.sealInteractiveOrigin(second.token, randomUUID(), scope)
    const before = await owner`select session_id from haas.login_sessions where tenant_id = ${f.tenantId} order by session_id`
    const request = { ...alex.input, sources: [...alex.input.sources, repeated, otherLogin], targetSessionId: 'alex-child' }
    const child = await f.bindings.deriveInteractiveOrigins(alex.cell.cellId, request, signal)
    expect(child.sources).toHaveLength(2) // Deduplicate the same exact login, never distinct logins.
    for (const source of child.sources) {
      expect(source.length).toBeLessThanOrEqual(1536)
      const payload = JSON.parse(Buffer.from(source.split('.')[1]!, 'base64url').toString())
      expect(payload).toMatchObject({ ...scope, nativeSessionId: child.nativeSessionId, delegatedPresetId: alex.input.presetId })
      for (const secret of [f.alexToken, second.token, config.masterKey, password]) expect(source).not.toContain(secret)
      await expect(f.identity.me(source, randomUUID())).rejects.toMatchObject({ status: 401 })
    }
    expect(await owner`select session_id from haas.login_sessions where tenant_id = ${f.tenantId} order by session_id`).toEqual(before)
    const recreated = new Identity(sql, f.tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
    const bindings = new RuntimeBindings(sql, recreated, 'http://127.0.0.1:59900', [], f.entries.map(row => row.cell))
    await bindings.authorizeInteractiveExecution(alex.cell.cellId, { ...alex.input, ...child }, signal)
    await expect(bindings.authorizeInteractiveExecution(alex.cell.cellId, { ...alex.input, sources: child.sources }, signal)).rejects.toMatchObject({ status: 403 })
    await expect(bindings.authorizeInteractiveExecution(alex.cell.cellId, { ...child, presetId: 'standard', publication: null, skills: [] }, signal)).rejects.toMatchObject({ status: 403 })
    await expect(bindings.deriveInteractiveOrigins(alex.cell.cellId,
      { ...child, presetId: 'standard', publication: null, skills: [], targetSessionId: 'escape' }, signal)).rejects.toMatchObject({ status: 403 })
    await f.identity.logout(f.alexToken, {}, context())
    await expect(bindings.authorizeInteractiveExecution(alex.cell.cellId, { ...alex.input, ...child }, signal)).rejects.toMatchObject({ status: 401 })
    await expect(bindings.deriveInteractiveOrigins(alex.cell.cellId, request, signal)).rejects.toMatchObject({ status: 401 })
    const remaining = await bindings.deriveInteractiveOrigins(alex.cell.cellId, { ...request, sources: [otherLogin] }, signal)
    await bindings.authorizeInteractiveExecution(alex.cell.cellId, { ...alex.input, ...remaining }, signal)
  })
  it('does not mint delegated provenance for foreign scope, unassigned work, altered proof, or an aborted caller', async () => {
    const f = await executionFixture(), alex = f.entries.find(row => row.token === f.alexToken)!, hansen = f.entries.find(row => row.token === f.hansenToken)!
    const request = { ...alex.input, targetSessionId: 'alex-child' }, signal = new AbortController().signal
    for (const input of [{ ...request, nativeSessionId: 'foreign' }, { ...request, sources: hansen.input.sources },
      { ...request, publication: { ...request.publication, contentDigest: 'sha256:' + '0'.repeat(64) } },
      { ...hansen.input, targetSessionId: 'hansen-child' }]) {
      await expect(f.bindings.deriveInteractiveOrigins(alex.cell.cellId, input, signal)).rejects.toThrow()
    }
    await expect(f.bindings.deriveInteractiveOrigins(hansen.cell.cellId, { ...hansen.input, targetSessionId: 'hansen-child' }, signal)).rejects.toMatchObject({ status: 404 })
    await expect(f.bindings.deriveInteractiveOrigins(hansen.cell.cellId, request, signal)).rejects.toMatchObject({ status: 403 })
    await expect(f.bindings.deriveInteractiveOrigins(randomUUID(), request, signal)).rejects.toMatchObject({ status: 403 })
    await expect(f.bindings.deriveInteractiveOrigins(alex.cell.cellId, request, AbortSignal.abort())).rejects.toThrow()
  })
  it('rejects foreign cell/session/tenant proof and altered source or content, even when login is valid', async () => {
    const f = await executionFixture(), alex = f.entries.find(row => row.token === f.alexToken)!, hansen = f.entries.find(row => row.token === f.hansenToken)!
    for (const publication of [{ ...alex.input.publication, tenantId: 'other-tenant' },
      { ...alex.input.publication, sourceUserId: f.alex.userId }, { ...alex.input.publication, contentDigest: 'sha256:' + '0'.repeat(64) }]) {
      await expect(f.execute(f.alexToken, { publication })).rejects.toMatchObject({ status: 404 })
    }
    await expect(f.execute(f.alexToken, { nativeSessionId: hansen.input.nativeSessionId })).rejects.toMatchObject({ status: 403 })
    await expect(f.execute(f.alexToken, { sources: hansen.input.sources })).rejects.toMatchObject({ status: 403 })
    await expect(f.bindings.authorizeInteractiveExecution(hansen.cell.cellId, alex.input, new AbortController().signal)).rejects.toMatchObject({ status: 403 })
    const foreign = await executionFixture(), foreignInput = foreign.entries[2]!.input
    await expect(f.execute(f.alexToken, { publication: { ...foreignInput.publication!, tenantId: f.tenantId }, presetId: foreignInput.presetId })).rejects.toMatchObject({ status: 404 })
    await expect(f.execute(f.alexToken, {}, AbortSignal.abort())).rejects.toThrow()
  })
  it('uses current group membership and explicit deny priority, without coupling a grant to a stale assignment revision', async () => {
    const f = await executionFixture()
    let publication = (await f.assign(f.assigned.revision, 'user', f.alex.userId, 'allow', false)).data
    const group = (await f.identity.createGroup(f.admin, { name: '客户团队' }, context())).data
    let membership = (await f.identity.updateGroup(f.admin, group.groupId, { name: group.name, memberIds: [f.alex.userId], expectedRevision: 1 }, context())).data
    publication = (await f.assign(publication.revision, 'group', group.groupId)).data
    await f.execute()
    membership = (await f.identity.setGroupStatus(f.admin, group.groupId, { status: 'archived', reason: '执行授权归档测试', expectedRevision: membership.revision }, context())).data
    await expect(f.execute()).rejects.toMatchObject({ status: 404 })
    membership = (await f.identity.setGroupStatus(f.admin, group.groupId, { status: 'active', reason: '执行授权恢复测试', expectedRevision: membership.revision }, context())).data
    await f.execute()
    await f.identity.updateGroup(f.admin, group.groupId, { name: group.name, memberIds: [], expectedRevision: membership.revision }, context())
    await expect(f.execute()).rejects.toMatchObject({ status: 404 })
    publication = (await f.assign(publication.revision, 'all')).data; await f.execute()
    await f.assign(publication.revision, 'user', f.alex.userId, 'deny')
    await expect(f.execute()).rejects.toMatchObject({ status: 404 })
  })
  it('checks every exact login in the current step, never replacing a logged-out one with another valid login', async () => {
    const f = await executionFixture(), entry = f.entries.find(row => row.token === f.alexToken)!
    const another = await f.identity.login({ username: 'alex', password }, context())
    const source = await f.identity.sealInteractiveOrigin(another.token, randomUUID(), { tenantId: f.tenantId, userId: f.alex.userId,
      role: 'member', cellId: entry.cell.cellId, nativeSessionId: entry.input.nativeSessionId })
    const sources = [...entry.input.sources, source]
    await f.execute(f.alexToken, { sources })
    await f.identity.logout(f.alexToken, {}, context())
    await expect(f.execute(f.alexToken, { sources })).rejects.toMatchObject({ status: 401 })
    await expect(f.execute(f.alexToken, { sources: [source] })).resolves.toBeUndefined()
  })
})

describe('adoption governance with real PostgreSQL and an explicit native-owner double', () => {
  it('requires current explicit assignment even for the administrator and author, with exact revision and immutable digest', async () => {
    const f = await assignedFixture()
    for (const token of [f.admin, f.hansenToken]) await expect(f.adopt(context(), token)).rejects.toMatchObject({ status: 404 })
    for (const body of [{ ...f.input, userId: f.hansen.userId }, { ...f.input, snapshot: snapshot() },
      { ...f.input, origin: 'http://127.0.0.1:3080' }]) await expect(f.adopt(context(), f.alexToken, body)).rejects.toMatchObject({ status: 400 })
    for (const body of [{ ...f.input, expectedRevision: f.input.expectedRevision - 1 }, { ...f.input, expectedDigest: 'sha256:' + '0'.repeat(64) }]) {
      await expect(f.adopt(context(), f.alexToken, body)).rejects.toMatchObject({ status: 409 })
    }
    const foreign = await fixture()
    await expect(f.publications.adopt(f.alexToken, foreign.submitted.publicationId, f.input, context())).rejects.toMatchObject({ status: 404 })
    expect(f.native.bridge).not.toHaveBeenCalled()
    const result = await f.adopt()
    expect(result.data).toMatchObject({ publicationId: f.assigned.publicationId, presetId: adoptedPresetId(f.assigned.publicationId),
      adopted: true, runtimeGrant: false, digest: f.assigned.digest })
    expect(f.native.bridge.mock.calls[0]?.[2].account.userId).toBe(f.alex.userId)
    expect(f.native.bridge.mock.calls[0]?.[3].sourceUserId).toBe(f.hansen.userId)
  })
  it('commits one audit and receipt for concurrent identical commands, then verifies native state on replay and reconstruction', async () => {
    const f = await assignedFixture(), command = context()
    const results = await Promise.all([f.adopt(command), f.adopt(command)])
    expect(results.map(row => row.replayed).sort()).toEqual([false, true])
    expect(results[0]?.data).toEqual(results[1]?.data)
    expect(f.native.bridge.mock.calls.map(call => call[4])).toEqual(['adopt', 'verify'])
    const rebuilt = new Publications(new Identity(sql, f.tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret), f.source, f.native.bridge)
    expect(await rebuilt.adopt(f.alexToken, f.assigned.publicationId, f.input, command)).toMatchObject({ data: results[0]!.data, replayed: true })
    expect(f.native.bridge.mock.calls.at(-1)?.[4]).toBe('verify')
    expect(await owner`select * from haas.command_receipts where tenant_id = ${f.tenantId} and idempotency_key = ${command.key}`).toHaveLength(1)
    expect(await owner`select * from haas.audit_events where tenant_id = ${f.tenantId} and action = 'resource.adopt' and outcome = 'succeeded'`).toHaveLength(1)
    const count = f.native.bridge.mock.calls.length
    await expect(f.adopt(command, f.alexToken, { ...f.input, expectedRevision: f.input.expectedRevision + 1 })).rejects.toMatchObject({ code: 'idempotency-conflict' })
    expect(f.native.bridge).toHaveBeenCalledTimes(count)
  })
  it.each(['assignment', 'logout', 'disabled', 'withdrawn'] as const)('does not replay an old adoption after %s revocation or invoke the native owner', async kind => {
    const f = await assignedFixture(), command = context()
    await f.adopt(command)
    if (kind === 'assignment') await f.assign(f.assigned.revision, 'user', f.alex.userId, 'allow', false)
    if (kind === 'logout') await f.identity.logout(f.alexToken, {}, context())
    if (kind === 'disabled') await f.identity.setMemberStatus(f.admin, f.alex.userId, { status: 'disabled', reason: '停止成员采用权限' }, context())
    if (kind === 'withdrawn') await f.review('withdraw', f.assigned.revision)
    await expect(f.adopt(command)).rejects.toMatchObject({ status: kind === 'logout' || kind === 'disabled' ? 401 : 404 })
    expect(f.native.bridge).toHaveBeenCalledOnce()
    expect(f.native.receipts.size).toBe(1)
    expect(await owner`select * from haas.command_receipts where tenant_id = ${f.tenantId} and idempotency_key = ${command.key}`).toHaveLength(1)
  })
  it.each(['missing', 'changed'] as const)('refuses a %s native receipt on replay without invoking adoption or silently repairing it', async kind => {
    const f = await assignedFixture(), command = context(); await f.adopt(command)
    const key = f.native.key(f.alex.userId, f.assigned.publicationId), original = f.native.receipts.get(key)!
    if (kind === 'missing') f.native.receipts.delete(key)
    else f.native.receipts.set(key, { ...original, configVersion: 'changed-native' })
    await expect(f.adopt(command)).rejects.toMatchObject({ status: 409 })
    expect(f.native.bridge.mock.calls.map(call => call[4])).toEqual(['adopt', 'verify'])
    expect(f.native.receipts.get(key)).toEqual(kind === 'missing' ? undefined : { ...original, configVersion: 'changed-native' })
  })
  it('retains an unknown native completion and confirms it on exact retry without creating another native target', async () => {
    const f = await assignedFixture(), command = context(), perform = f.native.bridge.getMockImplementation()!
    f.native.bridge.mockImplementationOnce(async (...args) => {
      await perform(...args)
      throw new EnterpriseError(503, 'publication-adoption-unconfirmed', 'Native completion not confirmed', true)
    })
    await expect(f.adopt(command)).rejects.toMatchObject({ code: 'publication-adoption-unconfirmed' })
    expect(f.native.receipts.size).toBe(1)
    const original = [...f.native.receipts.values()][0]
    expect(await owner`select * from haas.command_receipts where tenant_id = ${f.tenantId} and idempotency_key = ${command.key}`).toHaveLength(0)
    expect((await f.adopt(command)).replayed).toBe(false)
    expect([...f.native.receipts.values()]).toEqual([original])
    expect(f.native.bridge.mock.calls.map(call => call[4])).toEqual(['adopt', 'adopt'])
  })
  it('rolls back only the database receipt when audit commit fails, retaining and reconfirming native adoption on retry', async () => {
    const f = await assignedFixture(), command = context(), trigger = 'test_adoption_' + randomUUID().replaceAll('-', '')
    await owner.unsafe(`create function haas.${trigger}() returns trigger language plpgsql as $$ begin
      if NEW.tenant_id = '${f.tenantId}' and NEW.action = 'resource.adopt' and NEW.outcome = 'succeeded' then raise exception 'isolated adoption audit failure'; end if;
      return NEW; end; $$; create trigger ${trigger} before insert on haas.audit_events for each row execute function haas.${trigger}();`)
    try {
      await expect(f.adopt(command)).rejects.toMatchObject({ status: 503 })
      expect(f.native.receipts.size).toBe(1)
      expect(await owner`select * from haas.command_receipts where tenant_id = ${f.tenantId} and idempotency_key = ${command.key}`).toHaveLength(0)
    } finally { await owner.unsafe(`drop trigger ${trigger} on haas.audit_events; drop function haas.${trigger}();`) }
    const original = [...f.native.receipts.values()][0]
    const result = await f.adopt(command); expect(result.replayed).toBe(false)
    expect([...f.native.receipts.values()]).toEqual([original])
    expect(await owner`select * from haas.audit_events where tenant_id = ${f.tenantId} and action = 'resource.adopt' and outcome = 'succeeded'`).toHaveLength(1)
  })
})

describe('native preset eligibility with real PostgreSQL, not Browser E2E', () => {
  async function reader(f: Awaited<ReturnType<typeof fixture>>, token = f.alexToken) {
    const principal = await f.identity.withRuntimeIdentity(token, randomUUID(), async value => value)
    // Explicit synthetic carrier selection; this suite proves live governance,
    // while the separate gateway suite verifies actual re-admission around IO.
    const bindings = new RuntimeBindings(sql, f.identity, 'http://127.0.0.1:59900', ['http://127.0.0.1:59901'])
    const grant = { tenantId: f.tenantId, userId: principal.account.userId, role: principal.account.role,
      cellId: randomUUID(), revision: randomUUID(), origin: 'http://127.0.0.1:59901', validForMs: 10000 }
    return { read: (ids: readonly string[]) => bindings.readAgentPresetEligibility(token, randomUUID(), grant, ids), grant }
  }
  it('keeps personal/native ids, excludes unknown reserved ids and requires assignment even for authors/admins', async () => {
    const f = await fixture(), id = adoptedPresetId(f.submitted.publicationId)
    const ids = ['standard', 'hansen-client', id, adoptedPresetId(randomUUID()), 'paimind-enterprise-malformed']
    for (const token of [f.admin, f.hansenToken, f.alexToken]) expect(await (await reader(f, token)).read(ids)).toEqual(ids.slice(0, 2))
    const published = (await f.review('publish')).data
    const assigned = (await f.assign(published.revision, 'user', f.alex.userId)).data
    const alex = await reader(f)
    expect(await alex.read(ids)).toEqual(ids.slice(0, 3))
    for (const token of [f.admin, f.hansenToken]) expect(await (await reader(f, token)).read(ids)).toEqual(ids.slice(0, 2))
    await f.review('withdraw', assigned.revision)
    expect(await alex.read(ids)).toEqual(ids.slice(0, 2))
    expect(await f.publications.read(f.hansenToken, f.submitted.publicationId, randomUUID())).toMatchObject({ status: 'withdrawn', access: 'review-copy' })
  })
  it('re-reads group membership, deny precedence and all-member assignment without cached eligibility', async () => {
    const f = await fixture(), id = adoptedPresetId(f.submitted.publicationId), alex = await reader(f)
    const group = (await f.identity.createGroup(f.admin, { name: 'Customer team' }, context())).data
    const membership = (await f.identity.updateGroup(f.admin, group.groupId, { name: group.name, memberIds: [f.alex.userId], expectedRevision: 1 }, context())).data
    const published = (await f.review('publish')).data
    let assigned = (await f.assign(published.revision, 'group', group.groupId)).data
    expect(await alex.read([id])).toEqual([id])
    await f.identity.updateGroup(f.admin, group.groupId, { name: group.name, memberIds: [], expectedRevision: membership.revision }, context())
    expect(await alex.read([id])).toEqual([])
    assigned = (await f.assign(assigned.revision, 'all')).data
    expect(await alex.read([id])).toEqual([id])
    assigned = (await f.assign(assigned.revision, 'user', f.alex.userId, 'deny')).data
    expect(await alex.read([id])).toEqual([])
    assigned = (await f.assign(assigned.revision, 'user', f.alex.userId, 'deny', false)).data
    expect(await alex.read([id])).toEqual([id])
    await f.assign(assigned.revision, 'all', undefined, 'allow', false)
    expect(await alex.read([id])).toEqual([])
  })
  it('does not use a foreign tenant publication or a changed/logged-out principal', async () => {
    const f = await fixture(), other = await fixture(), alex = await reader(f)
    const published = (await other.review('publish')).data
    await other.assign(published.revision, 'all')
    expect(await alex.read([adoptedPresetId(published.publicationId)])).toEqual([])
    alex.grant.userId = f.hansen.userId
    await expect(alex.read(['standard'])).rejects.toMatchObject({ status: 403 })
    alex.grant.userId = f.alex.userId
    await f.identity.logout(f.alexToken, {}, context())
    await expect(alex.read(['standard'])).rejects.toMatchObject({ status: 401 })
  })
})

describe('publication governance with real PostgreSQL and explicit source fixture', () => {
  it('keeps the enterprise review reason out of the native source selection', async () => {
    const f = await fixture()
    expect(f.source).toHaveBeenCalledTimes(1)
    expect(f.source.mock.calls[0]?.[3]).toEqual({ presetId: submitInput.presetId, expectedVersion: submitInput.expectedVersion })
    expect(f.submitted.submissionReason).toBe(submitInput.reason)
  })

  it('keeps immutable submission, audit and retry receipt after the source changes and the service is reconstructed', async () => {
    const f = await fixture(), command = context()
    const input = { ...submitInput, expectedVersion: 'v2-fixture' }
    const first = snapshot()
    const second = createAgentPublicationSnapshot({ ...first.content, configVersion: input.expectedVersion })
    expect(Object.isFrozen(first.content)).toBe(true)
    expect(first.content.configVersion).toBe('v1-fixture')
    expect(second.digest).not.toBe(first.digest)
    f.source.mockResolvedValue(second)
    const created = await f.publications.submit(f.hansenToken, input, command)
    f.source.mockRejectedValue(new Error('Draft was removed'))
    const rebuilt = new Publications(new Identity(sql, f.tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret), f.source)
    expect(await rebuilt.submit(f.hansenToken, input, command)).toEqual({ ...created, replayed: true })
    expect(f.source).toHaveBeenCalledTimes(2)
    expect((await rebuilt.list(f.hansenToken, randomUUID(), false)).map(row => row.configVersion)).toEqual(['v1-fixture', 'v2-fixture'])
    expect(await rebuilt.list(f.alexToken, randomUUID(), false)).toEqual([])
    expect(await owner`select event_id from haas.audit_events where tenant_id = ${f.tenantId} and action = 'resource.submit' and outcome = 'succeeded'`).toHaveLength(2)
  })

  it('requires explicit assignment after approval and withdraws access without deleting the immutable history', async () => {
    const f = await fixture(), id = f.submitted.publicationId
    await expect(f.publications.read(f.alexToken, id, randomUUID())).rejects.toMatchObject({ status: 404 })
    const approved = (await f.review('publish')).data
    await expect(f.publications.read(f.alexToken, id, randomUUID())).rejects.toMatchObject({ status: 404 })
    const assigned = (await f.assign(approved.revision, 'user', f.alex.userId)).data
    expect(await f.publications.read(f.alexToken, id, randomUUID())).toMatchObject({ access: 'user-allow', digest: f.submitted.digest })
    await f.review('withdraw', assigned.revision)
    await expect(f.publications.read(f.alexToken, id, randomUUID())).rejects.toMatchObject({ status: 404 })
    expect(await f.publications.read(f.hansenToken, id, randomUUID())).toMatchObject({ status: 'withdrawn', access: 'review-copy' })
    expect(await owner`select publication_id from haas.agent_publications where tenant_id = ${f.tenantId}`).toHaveLength(1)
  })

  it('returns exact assigned content only after explicit permission, including for the author and administrator', async () => {
    const f = await fixture(), id = f.submitted.publicationId
    const actors = [f.admin, f.hansenToken, f.alexToken]
    for (const actor of actors) await expect(f.publications.readAssigned(actor, id, randomUUID())).rejects.toMatchObject({ status: 404 })
    const approved = (await f.review('publish')).data
    for (const actor of actors) await expect(f.publications.readAssigned(actor, id, randomUUID())).rejects.toMatchObject({ status: 404 })
    let publication = (await f.assign(approved.revision, 'all')).data
    for (const actor of actors) expect(await f.publications.readAssigned(actor, id, randomUUID())).toMatchObject({
      publicationId: id, digest: f.submitted.digest, revision: publication.revision, status: 'published', access: 'all-allow', snapshot: snapshot(),
    })
    publication = (await f.assign(publication.revision, 'user', f.hansen.userId, 'deny')).data
    await expect(f.publications.readAssigned(f.hansenToken, id, randomUUID())).rejects.toMatchObject({ status: 404 })
    expect(await f.publications.read(f.hansenToken, id, randomUUID())).toMatchObject({ access: 'review-copy' })
    expect(await f.publications.readAssigned(f.alexToken, id, randomUUID())).toMatchObject({ access: 'all-allow' })
    await f.review('withdraw', publication.revision)
    for (const actor of actors) await expect(f.publications.readAssigned(actor, id, randomUUID())).rejects.toMatchObject({ status: 404 })
    for (const actor of [f.admin, f.hansenToken]) expect(await f.publications.read(actor, id, randomUUID())).toMatchObject({ status: 'withdrawn', access: 'review-copy' })
  })

  it('revalidates the current login and never accepts an old assigned-detail response as authority', async () => {
    const f = await fixture(), approved = (await f.review('publish')).data
    await f.assign(approved.revision, 'user', f.alex.userId)
    const before = await f.publications.readAssigned(f.alexToken, f.submitted.publicationId, randomUUID())
    expect(before.access).toBe('user-allow')
    await f.identity.logout(f.alexToken, {}, context())
    const rebuilt = new Publications(new Identity(sql, f.tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret), f.source)
    for (const token of [f.alexToken, undefined]) await expect(rebuilt.readAssigned(token, before.publicationId, randomUUID())).rejects.toMatchObject({ status: 401 })
    expect(before.snapshot).toEqual(snapshot())
    expect(await owner`select publication_id from haas.agent_publications where tenant_id = ${f.tenantId}`).toHaveLength(1)
  })

  it('separates own submissions and review copies from explicitly assigned catalog content', async () => {
    const f = await fixture(), id = f.submitted.publicationId
    for (const actor of [f.admin, f.hansenToken, f.alexToken]) expect(await f.publications.available(actor, randomUUID())).toEqual([])
    const approved = (await f.review('publish')).data
    expect(await f.publications.available(f.hansenToken, randomUUID())).toEqual([])
    expect(await f.publications.available(f.admin, randomUUID())).toEqual([])
    let assigned = (await f.assign(approved.revision, 'user', f.alex.userId)).data
    expect(await f.publications.available(f.alexToken, randomUUID())).toEqual([expect.objectContaining({ publicationId: id, access: 'user-allow' })])
    expect(await f.publications.list(f.alexToken, randomUUID(), false)).toEqual([])
    expect(await f.publications.available(f.hansenToken, randomUUID())).toEqual([])
    expect(await f.publications.assignments(f.admin, id, randomUUID())).toMatchObject({ publication: { revision: assigned.revision },
      assignments: [{ subjectKind: 'user', subjectId: f.alex.userId, effect: 'allow', active: true }] })
    await expect(f.publications.assignments(f.hansenToken, id, randomUUID())).rejects.toMatchObject({ status: 403 })
    assigned = (await f.assign(assigned.revision, 'user', f.alex.userId, 'deny')).data
    expect(await f.publications.available(f.alexToken, randomUUID())).toEqual([])
    assigned = (await f.assign(assigned.revision, 'user', f.alex.userId, 'allow')).data
    await f.review('withdraw', assigned.revision)
    expect(await f.publications.available(f.alexToken, randomUUID())).toEqual([])
    expect((await f.publications.assignments(f.admin, id, randomUUID())).assignments).toHaveLength(1)
  })

  it('rechecks group membership and archived status for each read and applies explicit user denial over group and all', async () => {
    const f = await fixture(), id = f.submitted.publicationId
    const group = (await f.identity.createGroup(f.admin, { name: '客户团队' }, context())).data
    let membership = (await f.identity.updateGroup(f.admin, group.groupId, { name: group.name, memberIds: [f.alex.userId], expectedRevision: 1 }, context())).data
    let publication = (await f.review('publish')).data
    publication = (await f.assign(publication.revision, 'group', group.groupId)).data
    expect(await f.publications.read(f.alexToken, id, randomUUID())).toMatchObject({ access: 'group-allow' })
    expect(await f.publications.readAssigned(f.alexToken, id, randomUUID())).toMatchObject({ access: 'group-allow' })
    expect(await f.publications.available(f.alexToken, randomUUID())).toEqual([expect.objectContaining({ access: 'group-allow' })])
    membership = (await f.identity.setGroupStatus(f.admin, group.groupId, { status: 'archived', reason: '临时归档测试', expectedRevision: membership.revision }, context())).data
    await expect(f.publications.read(f.alexToken, id, randomUUID())).rejects.toMatchObject({ status: 404 })
    await expect(f.publications.readAssigned(f.alexToken, id, randomUUID())).rejects.toMatchObject({ status: 404 })
    expect(await f.publications.available(f.alexToken, randomUUID())).toEqual([])
    membership = (await f.identity.setGroupStatus(f.admin, group.groupId, { status: 'active', reason: '恢复成员组测试', expectedRevision: membership.revision }, context())).data
    publication = (await f.assign(publication.revision, 'all')).data
    publication = (await f.assign(publication.revision, 'user', f.alex.userId, 'deny')).data
    await expect(f.publications.read(f.alexToken, id, randomUUID())).rejects.toMatchObject({ status: 404 })
    publication = (await f.assign(publication.revision, 'user', f.alex.userId, 'allow')).data
    expect(await f.publications.read(f.alexToken, id, randomUUID())).toMatchObject({ access: 'user-allow' })
    publication = (await f.assign(publication.revision, 'user', f.alex.userId, 'allow', false)).data
    expect(await f.publications.read(f.alexToken, id, randomUUID())).toMatchObject({ access: 'group-allow' })
    await f.identity.updateGroup(f.admin, group.groupId, { name: group.name, memberIds: [], expectedRevision: membership.revision }, context())
    expect(await f.publications.read(f.alexToken, id, randomUUID())).toMatchObject({ access: 'all-allow' })
    await f.assign(publication.revision, 'all', undefined, 'allow', false)
    await expect(f.publications.read(f.alexToken, id, randomUUID())).rejects.toMatchObject({ status: 404 })
    await expect(f.publications.readAssigned(f.alexToken, id, randomUUID())).rejects.toMatchObject({ status: 404 })
  })

  it('denies member management, unknown authority fields, forged snapshots and lost sessions without success writes', async () => {
    const f = await fixture(), id = f.submitted.publicationId
    for (const token of [f.hansenToken, f.alexToken, undefined]) {
      await expect(f.publications.review(token, id, { decision: 'publish', expectedRevision: 1, reason: '非法管理测试' }, context())).rejects.toMatchObject({ status: token ? 403 : 401 })
      await expect(f.publications.assign(token, id, {}, context())).rejects.toMatchObject({ status: token ? 403 : 401 })
      await expect(f.publications.list(token, randomUUID(), true)).rejects.toMatchObject({ status: token ? 403 : 401 })
    }
    const calls = f.source.mock.calls.length
    await expect(f.publications.submit(f.hansenToken, { ...submitInput, sourceUserId: f.alex.userId }, context())).rejects.toMatchObject({ status: 400 })
    expect(f.source).toHaveBeenCalledTimes(calls)
    const command = context()
    const approved = await f.publications.review(f.admin, id, { decision: 'publish', expectedRevision: 1, reason: '管理员批准测试' }, command)
    await f.identity.logout(f.admin, {}, context())
    await expect(f.publications.review(f.admin, id, { decision: 'publish', expectedRevision: 1, reason: '管理员批准测试' }, command)).rejects.toMatchObject({ status: 401 })
    expect(approved.replayed).toBe(false)
    expect(await owner`select event_id from haas.audit_events where tenant_id = ${f.tenantId} and action = 'resource.review' and outcome = 'succeeded'`).toHaveLength(1)
  })

  it('rejects cross-tenant known publication and assignment identities atomically', async () => {
    const f = await fixture(), foreign = await fixture(), approved = (await f.review('publish')).data
    await expect(f.publications.read(f.alexToken, foreign.submitted.publicationId, randomUUID())).rejects.toMatchObject({ status: 404 })
    await expect(f.publications.readAssigned(f.admin, foreign.submitted.publicationId, randomUUID())).rejects.toMatchObject({ status: 404 })
    await expect(f.publications.review(f.admin, foreign.submitted.publicationId, { decision: 'publish', expectedRevision: 1, reason: '跨企业测试拒绝' }, context())).rejects.toMatchObject({ status: 404 })
    await expect(f.assign(approved.revision, 'user', foreign.alex.userId)).rejects.toMatchObject({ status: 404 })
    const group = (await foreign.identity.createGroup(foreign.admin, { name: '另一企业' }, context())).data
    await expect(f.assign(approved.revision, 'group', group.groupId)).rejects.toMatchObject({ status: 404 })
    expect(await owner`select * from haas.resource_assignments where tenant_id = ${f.tenantId}`).toEqual([])
    await expect(f.publications.assignments(f.admin, foreign.submitted.publicationId, randomUUID())).rejects.toMatchObject({ status: 404 })
    const foreignPublished = (await foreign.review('publish')).data
    await foreign.assign(foreignPublished.revision, 'all')
    expect(await f.publications.available(f.alexToken, randomUUID())).toEqual([])
    expect(await foreign.publications.available(foreign.alexToken, randomUUID())).toHaveLength(1)
  })

  it('serializes conflicting reviewers and assignment editors with exactly one winning revision', async () => {
    const f = await fixture()
    const reviews = await Promise.allSettled([f.review('publish'), f.review('reject')])
    expect(reviews.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(reviews.find(row => row.status === 'rejected')).toMatchObject({ reason: { status: 409 } })
    const another = await fixture(), approved = (await another.review('publish')).data
    const edits = await Promise.allSettled([another.assign(approved.revision, 'all'), another.assign(approved.revision, 'user', another.alex.userId)])
    expect(edits.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(edits.find(row => row.status === 'rejected')).toMatchObject({ reason: { code: 'publication-changed' } })
  })

  it('preserves content through database permissions and the immutable-content trigger', async () => {
    const f = await fixture()
    await expect(sql`update haas.agent_publications set snapshot = '{}'::jsonb where tenant_id = ${f.tenantId}`).rejects.toMatchObject({ code: '42501' })
    await expect(owner`update haas.agent_publications set snapshot = '{}'::jsonb where tenant_id = ${f.tenantId}`).rejects.toThrow('immutable')
    await expect(sql`delete from haas.agent_publications where tenant_id = ${f.tenantId}`).rejects.toMatchObject({ code: '42501' })
    expect((await f.publications.read(f.hansenToken, f.submitted.publicationId, randomUUID())).snapshot).toEqual(snapshot())
  })

  it.each(['resource.submit', 'resource.review', 'resource.assignment'] as const)('rolls back %s and its receipt if the success audit cannot commit', async action => {
    const f = await fixture()
    let publication = f.submitted
    if (action === 'resource.assignment') publication = (await f.review('publish')).data
    const before = await owner`select * from haas.agent_publications where tenant_id = ${f.tenantId}`
    const trigger = 'test_publication_' + randomUUID().replaceAll('-', '')
    await owner.unsafe(`create function haas.${trigger}() returns trigger language plpgsql as $$ begin
      if NEW.tenant_id = '${f.tenantId}' and NEW.action = '${action}' and NEW.outcome = 'succeeded' then raise exception 'isolated audit failure'; end if;
      return NEW; end; $$; create trigger ${trigger} before insert on haas.audit_events for each row execute function haas.${trigger}();`)
    const command = context()
    try {
      let run
      if (action === 'resource.submit') {
        f.source.mockResolvedValue(createAgentPublicationSnapshot({ ...snapshot().content, configVersion: 'v2-fixture' }))
        run = f.publications.submit(f.hansenToken, { ...submitInput, expectedVersion: 'v2-fixture' }, command)
      } else if (action === 'resource.review') run = f.publications.review(f.admin, publication.publicationId, { decision: 'publish', expectedRevision: publication.revision, reason: '审计事务测试' }, command)
      else run = f.publications.assign(f.admin, publication.publicationId, { subjectKind: 'all', effect: 'allow', active: true, expectedRevision: publication.revision, reason: '审计事务测试' }, command)
      await expect(run).rejects.toMatchObject({ status: 503 })
      expect(await owner`select * from haas.agent_publications where tenant_id = ${f.tenantId}`).toEqual(before)
      expect(await owner`select * from haas.resource_assignments where tenant_id = ${f.tenantId}`).toEqual([])
      expect(await owner`select * from haas.command_receipts where tenant_id = ${f.tenantId} and idempotency_key = ${command.key}`).toEqual([])
    } finally { await owner.unsafe(`drop trigger ${trigger} on haas.audit_events; drop function haas.${trigger}();`) }
  })

  it('keeps dependency-bearing Agents pending and rejects unsupported deny subjects', async () => {
    const f = await fixture([{ name: 'client-notes', digest: 'sha256:' + 'a'.repeat(64) }])
    await expect(f.review('publish')).rejects.toMatchObject({ code: 'skill-publication-required' })
    for (const subjectKind of ['group', 'all'] as const) await expect(f.assign(1, subjectKind, subjectKind === 'group' ? randomUUID() : undefined, 'deny')).rejects.toMatchObject({ status: 400 })
    expect(await f.publications.read(f.hansenToken, f.submitted.publicationId, randomUUID())).toMatchObject({ status: 'pending', revision: 1 })
  })

  it('freezes explicit Skill publication ids and separately requires current Agent and Skill assignments', async () => {
    const dependency = { name: 'client-notes', digest: 'sha256:' + 'a'.repeat(64) }
    const native = adoptionDouble(), f = await fixture([dependency], native.bridge)
    const chosen = await reviewedSkill(f, dependency.name, dependency.digest), alternate = await reviewedSkill(f, dependency.name, dependency.digest)
    const reviewInput = { decision: 'publish', expectedRevision: 1, reason: '明确固定技能发布依赖',
      skillPublications: [{ name: dependency.name, publicationId: chosen.submitted.publicationId }] }
    const command = context(), approved = await f.publications.review(f.admin, f.submitted.publicationId, reviewInput, command)
    expect(await f.publications.review(f.admin, f.submitted.publicationId, reviewInput, { ...command, requestId: randomUUID() })).toMatchObject({ replayed: true, data: approved.data })
    await expect(f.publications.review(f.admin, f.submitted.publicationId,
      { ...reviewInput, skillPublications: [{ name: dependency.name, publicationId: alternate.submitted.publicationId }] }, command)).rejects.toMatchObject({ status: 409 })
    const assigned = (await f.assign(approved.data.revision, 'all')).data
    await expect(f.publications.readAssigned(f.alexToken, assigned.publicationId, randomUUID())).rejects.toMatchObject({ status: 404 })
    await expect(f.publications.adopt(f.alexToken, assigned.publicationId,
      { expectedRevision: assigned.revision, expectedDigest: assigned.digest }, context())).rejects.toMatchObject({ status: 404 })
    expect(native.bridge).not.toHaveBeenCalled()
    await chosen.assign(f.alex.userId); await chosen.assign(f.hansen.userId); await alternate.assign(f.alex.userId)
    const reference = (await chosen.read()).reference, otherReference = (await alternate.read()).reference
    expect(await f.publications.readAssigned(f.alexToken, assigned.publicationId, randomUUID())).toMatchObject({ skillPublications: [{ ...reference, status: 'published' }] })
    await f.publications.adopt(f.alexToken, assigned.publicationId, { expectedRevision: assigned.revision, expectedDigest: assigned.digest }, context())
    expect(native.bridge.mock.calls[0]?.[5]).toEqual([reference])
    const proof = { nativeSessionId: 'owned-session', presetId: adoptedPresetId(assigned.publicationId),
      sources: ['paimind-origin-v1.e30.' + 'a'.repeat(43)], skills: [reference], publication: { tenantId: f.tenantId,
        publicationId: assigned.publicationId, sourceUserId: f.hansen.userId, contentDigest: assigned.digest } }
    const execute = (token: string, skills = proof.skills) => f.identity.resourceRead(token, randomUUID(), false,
      (db, principal) => Publications.authorizeExecution(db, principal, { ...proof, skills }))
    const eligible = (token: string) => f.identity.resourceRead(token, randomUUID(), false,
      (db, principal) => Publications.readPresetEligibility(db, principal, [proof.presetId]))
    expect(await eligible(f.alexToken)).toEqual([proof.presetId])
    await execute(f.alexToken)
    await expect(execute(f.alexToken, [])).rejects.toMatchObject({ status: 404 })
    await expect(execute(f.alexToken, [otherReference])).rejects.toMatchObject({ status: 404 })
    await chosen.assign(f.hansen.userId, 'deny')
    expect(await eligible(f.hansenToken)).toEqual([])
    await expect(execute(f.hansenToken)).rejects.toMatchObject({ status: 404 }); await execute(f.alexToken)
    await chosen.service.review(f.admin, chosen.submitted.publicationId, { decision: 'withdraw', expectedRevision: chosen.current().revision,
      reason: '下架依赖技能但保留历史关系' }, context())
    await expect(execute(f.alexToken)).rejects.toMatchObject({ status: 404 })
    expect(await eligible(f.alexToken)).toEqual([])
    expect(await f.publications.read(f.admin, assigned.publicationId, randomUUID())).toMatchObject({ status: 'published',
      skillPublications: [{ publicationId: reference.publicationId, status: 'withdrawn' }] })
    expect(await owner`select skill_publication_id from haas.agent_skill_dependencies where tenant_id = ${f.tenantId}`).toEqual([{ skill_publication_id: reference.publicationId }])
    // This assertion exercises the publication decision inside real identity
    // transactions, not the outer signature/native-source/Worker/model gates.
  })

  it.each(['wrong-name', 'wrong-digest', 'withdrawn', 'foreign-tenant', 'duplicate', 'extra'] as const)(
    'rejects %s Skill dependency review without partial edges or a success receipt', async fault => {
      const dependency = { name: 'client-notes', digest: 'sha256:' + 'a'.repeat(64) }, f = await fixture([dependency])
      const source = fault === 'foreign-tenant' ? await fixture() : f
      const skill = await reviewedSkill(source, fault === 'wrong-name' ? 'other-notes' : dependency.name,
        fault === 'wrong-digest' ? 'sha256:' + 'b'.repeat(64) : dependency.digest)
      if (fault === 'withdrawn') await skill.service.review(source.admin, skill.submitted.publicationId,
        { decision: 'withdraw', expectedRevision: skill.current().revision, reason: '测试已下架技能' }, context())
      const mapping = { name: dependency.name, publicationId: skill.submitted.publicationId }
      const command = context(), mappings = fault === 'duplicate' ? [mapping, mapping]
        : fault === 'extra' ? [mapping, { name: 'another-skill', publicationId: randomUUID() }] : [mapping]
      await expect(f.publications.review(f.admin, f.submitted.publicationId, { decision: 'publish', expectedRevision: 1,
        reason: '不允许错误依赖进入审核结果', skillPublications: mappings }, command)).rejects.toMatchObject({ status: fault === 'duplicate' ? 400 : fault === 'foreign-tenant' ? 404 : 409 })
      expect(await owner`select * from haas.agent_skill_dependencies where tenant_id = ${f.tenantId}`).toEqual([])
      expect(await owner`select status from haas.agent_publications where tenant_id = ${f.tenantId}`).toEqual([{ status: 'pending' }])
      expect(await owner`select * from haas.command_receipts where tenant_id = ${f.tenantId} and idempotency_key = ${command.key}`).toEqual([])
    })

  it('rolls dependency edges back with a failed approval audit and enforces their immutable DB lifetime', async () => {
    const dependency = { name: 'client-notes', digest: 'sha256:' + 'a'.repeat(64) }, f = await fixture([dependency])
    const skill = await reviewedSkill(f, dependency.name, dependency.digest)
    await expect(owner`update haas.agent_publications set status = 'published' where tenant_id = ${f.tenantId}`).rejects.toThrow('complete immutable skill dependencies')
    const trigger = 'edge_audit_' + randomUUID().replaceAll('-', ''), command = context()
    await owner.unsafe(`create function haas.${trigger}() returns trigger language plpgsql as $$ begin
      if NEW.tenant_id = '${f.tenantId}' and NEW.action = 'resource.review' and NEW.outcome = 'succeeded' then raise exception 'isolated edge audit failure'; end if;
      return NEW; end; $$; create trigger ${trigger} before insert on haas.audit_events for each row execute function haas.${trigger}();`)
    const input = { decision: 'publish', expectedRevision: 1, reason: '固定依赖与审核审计同一事务',
      skillPublications: [{ name: dependency.name, publicationId: skill.submitted.publicationId }] }
    try {
      await expect(f.publications.review(f.admin, f.submitted.publicationId, input, command)).rejects.toMatchObject({ status: 503 })
      expect(await owner`select * from haas.agent_skill_dependencies where tenant_id = ${f.tenantId}`).toEqual([])
      expect(await owner`select * from haas.command_receipts where tenant_id = ${f.tenantId} and idempotency_key = ${command.key}`).toEqual([])
    } finally { await owner.unsafe(`drop trigger ${trigger} on haas.audit_events; drop function haas.${trigger}();`) }
    await f.publications.review(f.admin, f.submitted.publicationId, input, context())
    await expect(owner`update haas.agent_skill_dependencies set skill_publication_id = ${randomUUID()} where tenant_id = ${f.tenantId}`).rejects.toThrow('immutable')
    await expect(owner`delete from haas.agent_skill_dependencies where tenant_id = ${f.tenantId}`).rejects.toThrow('immutable')
    await expect(sql`delete from haas.agent_skill_dependencies where tenant_id = ${f.tenantId}`).rejects.toMatchObject({ code: '42501' })
  })

  it('removes disabled members from every authorized read without deleting their own submission', async () => {
    const f = await fixture(), approved = (await f.review('publish')).data
    await f.assign(approved.revision, 'all')
    expect(await f.publications.available(f.hansenToken, randomUUID())).toHaveLength(1)
    await f.identity.setMemberStatus(f.admin, f.hansen.userId, { status: 'disabled', reason: '停用权限回读测试' }, context())
    for (const read of [() => f.publications.available(f.hansenToken, randomUUID()),
      () => f.publications.read(f.hansenToken, f.submitted.publicationId, randomUUID()),
      () => f.publications.readAssigned(f.hansenToken, f.submitted.publicationId, randomUUID()),
      () => f.publications.list(f.hansenToken, randomUUID(), false)]) await expect(read()).rejects.toMatchObject({ status: 401 })
    expect(await f.publications.list(f.admin, randomUUID(), true)).toHaveLength(1)
  })

  it('serves real HTTP review, assignment and separate catalogs with authority and request boundaries', async () => {
    const f = await fixture(), id = f.submitted.publicationId
    const reservation = reservePort(); await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done))
    const address = reservation.address(); if (!address || typeof address === 'string') throw Error('Missing fixture port')
    await new Promise<void>(done => reservation.close(() => done()))
    const publicOrigin = `http://127.0.0.1:${address.port}`
    const server = createEnterpriseServer({ identity: f.identity, publicOrigin, loopbackDevelopment: true })
    await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(address.port, '127.0.0.1', done) })
    const request = (path: string, token: string, input?: object, extra: Record<string, string> = {}) => fetch(publicOrigin + '/haas/v1' + path, {
      method: input ? 'POST' : 'GET', headers: { cookie: `paimind_haas_session=${token}`, origin: publicOrigin,
        'content-type': 'application/json', 'idempotency-key': randomUUID(), ...extra }, ...(input ? { body: JSON.stringify(input) } : {}),
    })
    try {
      const reviewPath = `/admin/publications/${id}/review`, assignmentPath = `/admin/publications/${id}/assignments`
      const review = { decision: 'publish', expectedRevision: 1, reason: '接口审核测试说明' }
      const detailPath = `/catalog/agents/${id}`
      expect((await request(detailPath, f.admin)).status).toBe(404)
      expect((await request(detailPath, f.hansenToken)).status).toBe(404)
      expect((await request(reviewPath, f.alexToken, review)).status).toBe(403)
      expect((await request(reviewPath, f.admin, review, { origin: 'https://foreign.invalid' })).status).toBe(403)
      expect((await request(reviewPath, f.admin, review, { 'idempotency-key': 'invalid' })).status).toBe(400)
      const approved = await request(reviewPath, f.admin, review); expect(approved.status).toBe(200)
      const approvedBody = await approved.json() as { data: { revision: number }; operationId: string; replayed: boolean }
      expect((await request(detailPath, f.admin)).status).toBe(404)
      expect((await request(detailPath, f.alexToken)).status).toBe(404)
      expect(approvedBody).toMatchObject({ operationId: expect.any(String), replayed: false })
      const assignment = { subjectKind: 'user', subjectId: f.alex.userId, effect: 'allow', active: true,
        expectedRevision: approvedBody.data.revision, reason: '接口分配测试说明' }
      expect((await request(assignmentPath, f.admin, assignment)).status).toBe(200)
      const assignedDetail = await request(detailPath, f.alexToken)
      expect(assignedDetail.status).toBe(200); expect(assignedDetail.headers.get('cache-control')).toBe('no-store')
      expect(await assignedDetail.json()).toMatchObject({ data: { publicationId: id, status: 'published', snapshot: snapshot(), access: 'user-allow' } })
      expect((await request(detailPath, f.admin)).status).toBe(404)
      expect((await request(detailPath + '?userId=forged', f.alexToken)).status).toBe(400)
      expect((await request(detailPath, f.alexToken, undefined, { 'x-paimind-user-id': f.hansen.userId })).status).toBe(400)
      const catalog = await request('/catalog/agents', f.alexToken)
      expect(catalog.status).toBe(200); expect(catalog.headers.get('cache-control')).toBe('no-store')
      expect(await catalog.json()).toMatchObject({ data: [{ publicationId: id, access: 'user-allow' }] })
      expect(await (await request('/publications', f.alexToken)).json()).toMatchObject({ data: [] })
      expect(await (await request('/publications', f.hansenToken)).json()).toMatchObject({ data: [{ publicationId: id }] })
      expect(await (await request(`/publications/${id}`, f.alexToken)).json()).toMatchObject({ data: { snapshot: snapshot(), access: 'user-allow' } })
      expect(await (await request(assignmentPath, f.admin)).json()).toMatchObject({ data: { assignments: [{ subjectId: f.alex.userId }] } })
      expect((await request(assignmentPath, f.alexToken)).status).toBe(403)
      expect((await request('/admin/publications', f.alexToken)).status).toBe(403)
      expect((await request('/catalog/agents?userId=forged', f.alexToken)).status).toBe(400)
      expect((await request('/catalog/agents', f.alexToken, undefined, { 'x-paimind-user-id': f.hansen.userId })).status).toBe(400)
      // This HTTP server intentionally has no native source. It must not use
      // the class-level fixture or browser-supplied snapshot as a fallback.
      const unavailable = await request('/publications', f.hansenToken, submitInput)
      expect(unavailable.status).toBe(503); expect(await unavailable.json()).toMatchObject({ code: 'publication-source-unavailable' })
      expect(await f.publications.list(f.admin, randomUUID(), true)).toHaveLength(1)
      await f.identity.logout(f.alexToken, {}, context())
      expect((await request('/catalog/agents', f.alexToken)).status).toBe(401)
      expect((await request(detailPath, f.alexToken)).status).toBe(401)
    } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) }
  })
})
