import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { mkdtemp, realpath, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { createConnection, createServer as reservePort } from 'node:net'
import postgres from 'postgres'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { SKILL_PUBLICATION_CHUNK_BYTES, type SkillPublicationExport } from '@paimind/skill-market/publication'
import { PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS } from '@paimind/skill-market/remote'
import { Identity } from '../src/identity.js'
import { SkillPublications } from '../src/skill-publications.js'
import { Publications } from '../src/publications.js'
import type { SkillPublicationSource } from '../src/skill-artifacts.js'
import { createEnterpriseServer } from '../src/server.js'
import { NativeGateway } from '../src/native-gateway.js'
import { CellTransport } from '../src/cell-transport.js'
import { PaimindSkillInstallerService } from '../../../packages/skill-market/src/installer.js'
import { PaimindAgentProfileService } from '../../../packages/agent-builder/src/index.js'
import { createNativeControlBroker, createNativeControlPeer, handleNativeControl, authorizeNativeExecution, authorizeNativeSkillUse, deriveNativeOrigins, sealNativeJobOrigins, type NativeControlPeer } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { captureManagedHarnessTerminalOrigins, installManagedHarnessOriginGuard } from '../../../packages/harness-compat/src/managed-origins.js'
import { createManagedHarnessDelegationProviders } from '../../../packages/harness-compat/src/managed-delegation.js'

const { unzipSync } = createRequire(new URL('../../../packages/skill-market/package.json', import.meta.url))('fflate') as {
  unzipSync: (bytes: Uint8Array) => Record<string, Uint8Array>
}

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
const cleanup: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const context = () => ({ key: randomUUID(), requestId: randomUUID() })
const password = 'Synthetic Skill publication test password 2026'
const sha = (bytes: Buffer) => 'sha256:' + createHash('sha256').update(bytes).digest('hex')
const input = { skillId: 'customer-notes', expectedDigest: 'sha256:' + 'a'.repeat(64), reason: '提交固定技能版本供审核' }
const signal = () => new AbortController().signal
function deferred() { let done!: () => void; const promise = new Promise<void>(resolve => { done = resolve }); return { promise, done } }
async function listenUnboundIngress(server: ReturnType<typeof reservePort>) {
  // A free OS port can still belong to a retained runtime binding in a restored
  // database. Keep the selected listener open; never erase another binding or
  // relax the production origin-uniqueness constraint to make a fixture pass.
  for (let attempt = 0; attempt < 32; attempt++) {
    if (!server.listening) await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('Missing private test port')
    const origin = `http://127.0.0.1:${address.port}`
    const rows = await owner`select cell_id from haas.runtime_bindings where origin = ${origin}`
    if (!rows.length) return origin
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
  throw Error('No unbound private ingress port within the fixture budget')
}
async function fixture() {
  const tenantId = `skill-publications-${randomUUID()}`
  await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
  const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
  await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, context())
  const adminLogin = await identity.login({ username: 'morgan', password }, context()), admin = adminLogin.token
  const hansen = (await identity.createMember(admin, { username: 'hansen', displayName: 'Hansen', password }, context())).data
  const alex = (await identity.createMember(admin, { username: 'alex', displayName: 'Alex', password }, context())).data
  const hansenToken = (await identity.login({ username: 'hansen', password }, context())).token
  const alexToken = (await identity.login({ username: 'alex', password }, context())).token
  const bytes = randomBytes(SKILL_PUBLICATION_CHUNK_BYTES * 2 + 127)
  const descriptor: SkillPublicationExport = { schema: 'paimind.skill-export/v1', exportId: randomUUID(), name: input.skillId,
    packageDigest: input.expectedDigest, archiveDigest: sha(bytes), archiveBytes: bytes.length, expandedBytes: 1000, entryCount: 3 }
  // Explicit archive source double for failure injection. The final test below
  // uses the actual source owner, private HTTP/socket and gateway with real DB
  // identity; neither case is Browser E2E or a final Linux Worker image test.
  const transfer: SkillPublicationSource = async (_token, _requestId, _principal, _selection, sink, abort) => {
    for (let offset = 0; offset < bytes.length; offset += SKILL_PUBLICATION_CHUNK_BYTES) {
      await sink(bytes.subarray(offset, offset + SKILL_PUBLICATION_CHUNK_BYTES), offset, abort)
    }
    return descriptor
  }
  const source = vi.fn<SkillPublicationSource>(transfer)
  const publications = new SkillPublications(sql, identity, source)
  const submit = (command = context(), token = admin, value: unknown = input, abort = signal()) => publications.submit(token, value, command, abort)
  const rows = () => owner`select * from haas.skill_artifacts where tenant_id = ${tenantId} order by created_at`
  const stored = async () => Buffer.concat((await owner<{ data: Buffer }[]>`select data from haas.skill_artifact_chunks
    where tenant_id = ${tenantId} order by chunk_offset`).map(row => row.data))
  return { tenantId, identity, admin, adminId: adminLogin.data.userId, hansen, alex, hansenToken, alexToken,
    source, transfer, bytes, descriptor, publications, submit, rows, stored }
}

async function adoptionFixture(withNativeScope = false, withAgentOwner = false) {
  if (withAgentOwner && !withNativeScope) throw Error('Agent composition requires the original native root')
  const f = await fixture(), calls: Array<{ member: string; operation: string; input: object }> = []
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'paimind-skill-targets-')))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const cells = new Map<string, { owner: PaimindSkillInstallerService; origin: string; directory: string; cellId: string; revision: string;
    peer: NativeControlPeer; transport: CellTransport; session: { id: string; header: { agentPreset: string } };
    sessionLookup: { get(id: string): unknown }; eligibility: { current?: unknown }; nativeRoot?: any;
    nativeChecks: any[]; nativeUses: any[]; agentOwner?: PaimindAgentProfileService }>()
  const transports = new Map<string, CellTransport>()
  const hooks: { afterWrite?: () => Promise<void> } = {}
  for (const member of ['morgan', 'hansen', 'alex']) {
    const effects: Array<() => void | Promise<void>> = [], root = join(directory, member)
    const session = { id: member, header: { agentPreset: 'standard' } }
    const sessionLookup = { get: (id: string): unknown => id === session.id ? session : undefined }
    const eligibility: { current?: unknown } = {}
    const nativeChecks: any[] = [], nativeUses: any[] = []
    let nativeRoot: any
    if (withNativeScope) {
      const native = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
      const web = createRequire(native.resolve('@deepseek-ai/dsh-web-app/package.json'))
      const { Context } = web('@deepseek-ai/cordis'), { SessionStore } = web('@deepseek-ai/dsh-session')
      const { AgentRegistry } = web('@deepseek-ai/dsh-agent'), { SystemPrompt } = web('@deepseek-ai/dsh-system-prompt')
      const { ToolRuntime } = web('@deepseek-ai/dsh-tools'), { LlmRuntime } = web('@deepseek-ai/dsh-llm')
      const { SkillRegistry, renderSkillContent } = native('@deepseek-ai/dsh-skill'), ToolSkill = native('@deepseek-ai/dsh-tool-skill')
      nativeRoot = new Context()
      installManagedHarnessOriginGuard(nativeRoot, async (input, abort) => {
        nativeChecks.push(input); return authorizeNativeExecution(nativeRoot, peer, input, abort)
      }, { render: renderSkillContent, check: async (input, value, abort) => {
        const reference = await authorizeNativeSkillUse(nativeRoot, peer, input, value, abort)
        nativeUses.push(reference); return reference
      } })
      cleanup.push(async () => {
        for (const agent of nativeRoot.get('agents')?.list() ?? []) agent.cancel({ kind: 'user' })
        await nativeRoot.fiber.dispose()
      })
      // Only the unused HTTP upload registration is a stub. Cordis service
      // ownership, Agent lifecycle, Skill catalog/body and ToolSkill are real.
      nativeRoot.provide('webServer', { register: () => () => {} })
      for (const [plugin, settings] of [[SessionStore], [AgentRegistry], [SystemPrompt, {}], [ToolRuntime, {}], [LlmRuntime], [SkillRegistry], [ToolSkill, {}]]) {
        await nativeRoot.plugin(plugin, settings)
      }
      if (withAgentOwner) {
        const Loader = native('@deepseek-ai/cordis-plugin-loader').default
        const { AgentPresets } = native('@deepseek-ai/dsh-agent-presets')
        const { SettingsProvider } = native('@deepseek-ai/dsh-settings')
        // Original namespace and preset services. Settings persistence is an
        // explicit unused fixture; no default/settings writes are exercised.
        await nativeRoot.plugin(Loader)
        await nativeRoot.plugin(class extends SettingsProvider {
          async load() { return {} }
          async persist() { throw Error('This owner-composition test does not write native settings') }
        })
        await nativeRoot.plugin(AgentPresets, { default: 'standard', includeUserRoot: false, roots: [
          { path: join(dirname(native.resolve('@deepseek-ai/dsh/package.json')), 'config/agent-presets'), trust: 'system' },
          { path: join(root, 'presets'), trust: 'user' },
        ] })
      }
      await nativeRoot.plugin(PaimindSkillInstallerService, { skillRoot: join(root, 'skills'), stateRoot: join(root, 'state') })
    }
    const nativeOwner: PaimindSkillInstallerService = withNativeScope ? nativeRoot.get('paimindSkillInstaller') : new PaimindSkillInstallerService({ reflect: { provide() {} }, webServer: { register: () => () => {} },
      sessions: { get: (id: string) => sessionLookup.get(id) },
      get: (name: string) => name === 'paimindEnterpriseSkillEligibility' ? eligibility.current : undefined,
      skills: { list: async () => [], register: () => () => {} },
      effect(install: () => void | (() => void | Promise<void>)) { const dispose = install(); if (dispose) effects.push(dispose) },
    } as never, { skillRoot: join(root, 'skills'), stateRoot: join(root, 'state') })
    if (withNativeScope && !(nativeOwner instanceof PaimindSkillInstallerService)) throw Error('Original native Skill owner did not mount')
    if (withNativeScope) await nativeOwner.getUserSkillPolicy().catch(error => { throw error.cause ?? error })
    let agentOwner: PaimindAgentProfileService | undefined
    if (withAgentOwner) {
      await nativeRoot.plugin(PaimindAgentProfileService, { presetRoot: join(root, 'presets'),
        skillRoot: join(root, 'skills'), stateRoot: join(root, 'agent-state') })
      agentOwner = nativeRoot.get('paimindAgentProfiles')
      if (!(agentOwner instanceof PaimindAgentProfileService)) throw Error('Original native Agent owner did not mount')
      await agentOwner.prepareRuntime()
    }
    cleanup.push(async () => { for (const effect of effects.reverse()) await effect() })
    let ingress: ReturnType<typeof createNativeIngress>
    const broker = await createNativeControlBroker('/tmp', (input, abort) => ingress.checkOrigins(input, abort),
      (input, abort) => ingress.authorizeExecution(input, abort), (input, abort) => ingress.deriveOrigins(input, abort),
      (input, abort) => ingress.sealJobOrigins(input, abort),
      (input, abort) => ingress.readSkillEligibility(input, abort)); cleanup.push(() => broker.close())
    const peer = createNativeControlPeer(createConnection(broker.path), { handle: async (operation, input, abort) => {
      const result = await handleNativeControl(nativeRoot ?? { get: name => name === 'paimindSkillInstaller' ? nativeOwner : undefined }, operation, input, abort)
      if (member === 'hansen' && operation === 'skill.adopt.write') await hooks.afterWrite?.()
      return result
    } })
    cleanup.push(() => peer.close()); await vi.waitFor(() => expect(broker.ready).toBe(true))
    const key = randomBytes(32).toString('hex'); ingress = createNativeIngress({ token: key,
      control: (operation: string, input: object, abort: AbortSignal) => { calls.push({ member, operation, input }); return broker.request(operation, input, abort) } })
    cleanup.push(() => ingress.close())
    const origin = await listenUnboundIngress(ingress.server), transport = new CellTransport(origin, key)
    cleanup.push(() => transport.destroy()); transports.set(origin, transport)
    cells.set(member, { owner: nativeOwner, origin, directory: root, cellId: randomUUID(), revision: randomUUID(), peer, transport, session, sessionLookup, eligibility, nativeRoot, nativeChecks, nativeUses, agentOwner })
  }
  // Explicit local cell bindings. Real PG identities, gateway, private HTTP /
  // socket, original Skill services and target files; no final Linux image or UI.
  // Use the production renewal interval for real PostgreSQL/archive work.
  // The gateway's dedicated timing tests cover deliberately tiny deadlines;
  // this fixture must not give an ordinary real DB round-trip only 20 ms.
  const gateway = new NativeGateway({ publicOrigin: 'http://127.0.0.1:62345', transports,
    resolve: (token, requestId) => f.identity.withRuntimeIdentity(token, requestId, principal => {
      const cell = cells.get(principal.account.username); if (!cell) throw Error('Unknown fixture member')
      return Promise.resolve({ cellId: cell.cellId, tenantId: principal.account.tenantId, userId: principal.account.userId,
        role: principal.account.role, revision: cell.revision, origin: cell.origin, validForMs: 10000, transport: 'private-cell' as const })
    }), authorize: (token, requestId, grant, request, verify) => f.identity.authorizeRuntimeOperation(token, requestId, grant, request, verify) })
  cleanup.push(() => gateway.close())
  const service = new SkillPublications(sql, f.identity, (...args) => gateway.exportSkillPublication(...args), (...args) => gateway.adoptSkillPublication(...args))
  const morgan = cells.get('morgan')!, hansen = cells.get('hansen')!, alex = cells.get('alex')!
  await morgan.owner.saveSkillSource({ name: input.skillId, description: 'Morgan approved customer method', instructions: 'Use verified customer notes only.' })
  await mkdir(join(morgan.directory, 'skills', input.skillId, 'empty'))
  const binary = randomBytes(300000); await writeFile(join(morgan.directory, 'skills', input.skillId, 'sample.bin'), binary)
  const pkg = await morgan.owner.getSkillPackage({ skillId: input.skillId })
  const submitted = (await service.submit(f.admin, { ...input, expectedDigest: pkg.digest }, context(), signal())).data
  let revision = (await service.review(f.admin, submitted.publicationId, { expectedRevision: 1, decision: 'publish', reason: '审核准确技能归档' }, context())).data.revision
  for (const user of [f.hansen, f.alex]) revision = (await service.assign(f.admin, submitted.publicationId,
    { expectedRevision: revision, subjectKind: 'user', subjectId: user.userId, effect: 'allow', active: true, reason: '明确分配技能给成员' }, context())).data.revision
  const selected = () => ({ expectedRevision: revision, expectedDigest: submitted.digest })
  const adopt = (token = f.hansenToken, command = context()) => service.adopt(token, submitted.publicationId, selected(), command, signal())
  const denyHansen = async () => { revision = (await service.assign(f.admin, submitted.publicationId,
    { expectedRevision: revision, subjectKind: 'user', subjectId: f.hansen.userId, effect: 'deny', active: true, reason: '撤销 Hansen 技能分配' }, context())).data.revision }
  return { ...f, service, gateway, calls, hooks, morgan, hansenCell: hansen, alexCell: alex, binary, submitted, selected, adopt, denyHansen }
}

async function executionFixture(withEligibility = false, withNativeScope = false, withAgentOwner = false) {
  const f = await adoptionFixture(withNativeScope, withAgentOwner); await f.adopt(); await f.adopt(f.alexToken)
  const rows = [{ member: f.hansen, cell: f.hansenCell, token: f.hansenToken }, { member: f.alex, cell: f.alexCell, token: f.alexToken }]
  const pins: PrivateRuntimeCell[] = []
  for (const { member, cell } of rows) {
    const pin: PrivateRuntimeCell = { cellId: cell.cellId, tenantId: f.tenantId, userId: member.userId, role: 'member', revision: cell.revision,
      origin: cell.origin, containerId: randomUUID().replaceAll('-', '').repeat(2), imageId: 'sha256:' + '1'.repeat(64),
      volumeName: 'paimind-haas-member-fixture-' + randomUUID(), policyDigest: 'sha256:' + '2'.repeat(64) }
    pins.push(pin)
    await owner`insert into haas.runtime_bindings (cell_id, tenant_id, user_id, origin, revision, isolation_mode, status, lease_expires_at,
      container_id, image_id, volume_name, policy_digest) values (${pin.cellId}, ${pin.tenantId}, ${pin.userId}, ${pin.origin}, ${pin.revision},
      'container-managed', 'ready', clock_timestamp() + interval '10 minutes', ${pin.containerId}, ${pin.imageId}, ${pin.volumeName}, ${pin.policyDigest})`
  }
  // Real identity/binding rows and private peers; native Session descriptors
  // and Linux image/container identities remain explicit local fixtures.
  const bindings = new RuntimeBindings(sql, f.identity, 'http://127.0.0.1:62345', [], pins)
  const hooks: { beforeCheck?: () => Promise<void>; afterCheck?: () => Promise<void> } = {}
  const entries = []
  const select = async (cell: typeof f.hansenCell, enabled: boolean) => writeFile(join(cell.directory, 'state', 'user-skill-policy.json'),
    JSON.stringify({ schema: 'paimind.user-skill-policy-storage/v4', revision: 1, enabledOptionalSystemSkillNames: [],
      enabledAdoptedSkillIds: [f.submitted.publicationId], disabledBusinessSkillNames: [], directBusinessSkillNames: enabled ? [f.submitted.name] : [] }))
  for (const { member, cell, token } of rows) {
    await cell.transport.openOriginAuthority((input, abort) => bindings.checkInteractiveOrigins(cell.cellId, input, abort), async (input, abort) => {
      if (cell === f.hansenCell) await hooks.beforeCheck?.()
      await bindings.authorizeInteractiveExecution(cell.cellId, input, abort)
      if (cell === f.hansenCell) await hooks.afterCheck?.()
    }, (input, abort) => bindings.deriveInteractiveOrigins(cell.cellId, input, abort),
    (input, abort) => bindings.sealJobOrigins(cell.cellId, input, abort),
    (input, abort) => bindings.readSkillEligibility(cell.cellId, input, abort))
    if (withEligibility) {
      cell.eligibility.current = Object.freeze({ read: cell.peer.readSkillEligibility })
      cell.nativeRoot?.provide('paimindEnterpriseSkillEligibility', cell.eligibility.current)
    }
    const source = await f.identity.sealInteractiveOrigin(token, randomUUID(), { tenantId: f.tenantId, userId: member.userId,
      role: 'member', cellId: cell.cellId, nativeSessionId: cell.session.id })
    const input = { nativeSessionId: cell.session.id, presetId: 'standard', sources: [source] }
    if (!withNativeScope) await select(cell, true)
    const nativeContext = cell.nativeRoot ?? { get: (name: string) => name === 'paimindSkillInstaller' ? cell.owner : undefined }
    entries.push({ cell, token, input, nativeContext, execute: (abort = signal(), requirements?: readonly string[]) =>
      authorizeNativeExecution(nativeContext, cell.peer, { ...input, ...(requirements ? { requirements } : {}) }, abort) })
  }
  return { ...f, runtimeHooks: hooks, bindings, entries, select, hansenExecution: entries[0]!, alexExecution: entries[1]! }
}

describe('immutable Skill archives and governance on a fresh PostgreSQL fixture', () => {
  it('keeps restored origin bindings intact when selecting an available private ingress port', async () => {
    const f = await fixture(), server = reservePort()
    cleanup.push(() => new Promise<void>((resolve, reject) => {
      if (!server.listening) return resolve()
      server.close(error => error ? reject(error) : resolve())
    }))
    const originalOrigin = await listenUnboundIngress(server), cellId = randomUUID(), revision = randomUUID()
    const [before] = await owner`insert into haas.runtime_bindings (cell_id, tenant_id, user_id, origin, revision, isolation_mode, status, lease_expires_at)
      values (${cellId}, ${f.tenantId}, ${f.hansen.userId}, ${originalOrigin}, ${revision}, 'development-process', 'ready', clock_timestamp() + interval '10 minutes') returning *`
    const nextOrigin = await listenUnboundIngress(server)
    expect(nextOrigin).not.toBe(originalOrigin)
    expect(server.listening).toBe(true)
    expect(await owner`select cell_id from haas.runtime_bindings where origin = ${nextOrigin}`).toHaveLength(0)
    expect((await owner`select * from haas.runtime_bindings where cell_id = ${cellId}`)[0]).toEqual(before)
  })
  it('refuses a local enable commit after current PostgreSQL assignment is revoked during authorization, without changing Alex', async () => {
    const f = await executionFixture(true, true)
    const record = (await f.hansenCell.owner.listInstalled()).items[0]!
    const { schema: _schema, adoptedAt: _at, ...reference } = record.publication!
    expect(record.publicationPreference).toMatchObject({ enabled: false, direct: false })
    const path = join(f.hansenCell.directory, 'state', 'user-skill-policy.json')
    const before = await readFile(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    const original = f.bindings.readSkillEligibility.bind(f.bindings); let revoked = false
    const spy = vi.spyOn(f.bindings, 'readSkillEligibility').mockImplementation(async (...args) => {
      const result = await original(...args)
      if (!revoked && args[0] === f.hansenCell.cellId) { revoked = true; await f.denyHansen() }
      return result
    })
    try {
      await expect(f.hansenCell.owner.setAdoptedSkillPreference({ reference, expectedRevision: record.publicationPreference!.revision, field: 'enabled', value: true })).rejects.toThrow()
      expect(revoked).toBe(true)
    } finally { spy.mockRestore() }
    expect(await readFile(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })).toEqual(before)
    const alex = (await f.alexCell.owner.listInstalled()).items[0]!
    expect(await f.alexCell.owner.setAdoptedSkillPreference({ reference, expectedRevision: alex.publicationPreference!.revision, field: 'enabled', value: true }))
      .toMatchObject({ enabled: true, direct: false, runtimeGrant: false })
    expect((await f.hansenCell.owner.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([])
    expect((await f.alexCell.owner.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([f.submitted.name])
  })
  it('reads exact adopted native Skill bytes through current PostgreSQL assignment authority for independent Hansen and Alex owners', async () => {
    // Actual original Cordis owners and private eligibility HTTP/socket chain.
    // Calls below are owner calls, not browser RPC or final Worker acceptance.
    const f = await executionFixture(true, true)
    const hansenRecord = (await f.hansenCell.owner.listInstalled()).items[0]!
    const { schema: _schema, adoptedAt: _adoptedAt, ...reference } = hansenRecord.publication!
    const policies = await Promise.all([f.hansenCell, f.alexCell].map(cell => cell.owner.getUserSkillPolicy()))
    for (const cell of [f.hansenCell, f.alexCell]) {
      const page = await cell.owner.readAdoptedSkillContent({ reference, kind: 'directory', path: '' })
      expect(page).toMatchObject({ runtimeGrant: false, kind: 'directory', page: { entries: expect.arrayContaining([
        expect.objectContaining({ path: 'SKILL.md' }), expect.objectContaining({ path: 'empty', kind: 'directory' }),
      ]) } })
      expect(await cell.owner.readAdoptedSkillContent({ reference, kind: 'directory', path: 'empty' }))
        .toMatchObject({ page: { entries: [] } })
      const bytes: Buffer[] = []; let offset: number | null = 0
      while (offset !== null) {
        const result = await cell.owner.readAdoptedSkillContent({ reference, kind: 'file', path: 'sample.bin', offset })
        if (result.kind !== 'file') throw Error('Expected original file chunk')
        bytes.push(Buffer.from(result.data, 'base64')); offset = result.nextOffset
      }
      expect(Buffer.concat(bytes)).toEqual(f.binary)
      await expect(cell.owner.readAdoptedSkillContent({ reference: { ...reference, tenantId: 'foreign-tenant' }, kind: 'directory', path: '' })).rejects.toThrow()
    }
    expect(await Promise.all([f.hansenCell, f.alexCell].map(cell => cell.owner.getUserSkillPolicy()))).toEqual(policies)
    await writeFile(join(f.hansenCell.directory, 'skills', input.skillId, 'sample.bin'), 'Hansen external changed bytes')
    await expect(f.hansenCell.owner.readAdoptedSkillContent({ reference, kind: 'directory', path: '' })).rejects.toThrow()
    await expect(f.alexCell.owner.readAdoptedSkillContent({ reference, kind: 'directory', path: '' })).resolves.toMatchObject({ kind: 'directory' })
    expect(await readFile(join(f.hansenCell.directory, 'skills', input.skillId, 'sample.bin'), 'utf8')).toBe('Hansen external changed bytes')
  })
  it('rejects an adopted content read when Hansen assignment is revoked during the private authority reply, while Alex remains readable', async () => {
    const f = await executionFixture(true, true)
    const { schema: _schema, adoptedAt: _adoptedAt, ...reference } = (await f.hansenCell.owner.listInstalled()).items[0]!.publication!
    const original = f.bindings.readSkillEligibility.bind(f.bindings); let revoked = false
    const spy = vi.spyOn(f.bindings, 'readSkillEligibility').mockImplementation(async (...args) => {
      const result = await original(...args)
      if (!revoked && args[0] === f.hansenCell.cellId) { revoked = true; await f.denyHansen() }
      return result
    })
    try {
      await expect(f.hansenCell.owner.readAdoptedSkillContent({ reference, kind: 'file', path: 'sample.bin', offset: 0 })).rejects.toThrow()
      expect(revoked).toBe(true)
    } finally { spy.mockRestore() }
    await expect(f.hansenCell.owner.readAdoptedSkillContent({ reference, kind: 'directory', path: '' })).rejects.toThrow()
    await expect(f.alexCell.owner.readAdoptedSkillContent({ reference, kind: 'file', path: 'sample.bin', offset: 0 }))
      .resolves.toMatchObject({ kind: 'file', data: f.binary.subarray(0, 32768).toString('base64') })
    expect(await readFile(join(f.hansenCell.directory, 'skills', input.skillId, 'sample.bin'))).toEqual(f.binary)
  })
  it('reads complete sealed Skill content over real HTTP after source edits; retains binary and empty entries without native writes', async () => {
    const f = await adoptionFixture(), initialCalls = f.calls.length, reservation = reservePort()
    await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done))
    const address = reservation.address(); if (!address || typeof address === 'string') throw Error('Missing content fixture port')
    await new Promise<void>(done => reservation.close(() => done()))
    const origin = `http://127.0.0.1:${address.port}`, server = createEnterpriseServer({ identity: f.identity, skillPublications: f.service, publicOrigin: origin, loopbackDevelopment: true })
    cleanup.push(() => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()) }))
    await new Promise<void>(done => server.listen(address.port, '127.0.0.1', done))
    const route = `/haas/v1/catalog/skills/${f.submitted.publicationId}/content/${f.selected().expectedRevision}/${f.submitted.archiveDigest.slice(7)}`
    const get = (tail: string, token = f.hansenToken, prefix = route) => fetch(origin + prefix + tail, { headers: { origin, cookie: `paimind_haas_session=${token}` } })
    const response = await get('/entries/0')
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    const page = (await response.json()).data
    expect(page.runtimeGrant).toBe(false); expect(page.content.total).toBe(f.submitted.entryCount)
    const entries = page.content.entries as Array<{ index: number; path: string; kind: string; size: number }>
    expect(entries.find(x => x.path === 'empty')).toMatchObject({ kind: 'directory', size: 0 })
    const binary = entries.find(x => x.path === 'sample.bin')!, body = entries.find(x => x.path === 'SKILL.md')!
    const oldBody = Buffer.from((await (await get(`/files/${body.index}/0`)).json()).data.content.data, 'base64')
    const source = await f.morgan.owner.getSkillSource({ skillId: input.skillId })
    await f.morgan.owner.saveSkillSource({ name: input.skillId, description: source.description, instructions: 'Later editable source is NOT the review copy.', expectedDigest: source.digest })
    expect(Buffer.from((await (await get(`/files/${body.index}/0`, f.admin, route.replace('/catalog/skills/', '/admin/skill-publications/'))).json()).data.content.data, 'base64')).toEqual(oldBody)
    expect(oldBody.toString()).toContain('Use verified customer notes only.')
    const chunks: Buffer[] = []; let offset: number | null = 0
    while (offset !== null) {
      const result = (await (await get(`/files/${binary.index}/${offset}`)).json()).data.content
      expect(result.offset).toBe(offset); chunks.push(Buffer.from(result.data, 'base64')); offset = result.nextOffset
    }
    expect(Buffer.concat(chunks)).toEqual(f.binary)
    for (const tail of ['/entries/1', '/files/9999/0', `/files/${binary.index}/1`, '/entries/0?skipAuthorization=1']) expect((await get(tail)).status).not.toBe(200)
    expect((await get('/entries/0', f.hansenToken, route.replace('/catalog/skills/', '/admin/skill-publications/'))).status).toBe(403)
    expect(f.calls).toHaveLength(initialCalls)
    expect(await f.hansenCell.owner.listInstalled()).toMatchObject({ items: [] })
  })
  it('reauthorizes immutable Skill content across revocation, stale revision, logout, foreign ids and independent members', async () => {
    const f = await adoptionFixture(), other = await fixture()
    const read = (token = f.hansenToken, admin = false, revision = f.selected().expectedRevision, digest = f.submitted.archiveDigest, service = f.service) =>
      service.content(token, f.submitted.publicationId, revision, digest, { kind: 'entries', cursor: 0 }, randomUUID(), admin, signal())
    await expect(read(other.admin, true, f.selected().expectedRevision, f.submitted.archiveDigest, other.publications)).rejects.toMatchObject({ status: 404 })
    await expect(read(f.admin, true, 1)).rejects.toMatchObject({ status: 409 })
    await expect(read(f.admin, true, f.selected().expectedRevision, 'sha256:' + '0'.repeat(64))).rejects.toMatchObject({ status: 409 })
    const original = f.identity.resourceRead.bind(f.identity); let calls = 0
    const spy = vi.spyOn(f.identity, 'resourceRead').mockImplementation(async (...args) => {
      const result = await original(...args)
      if (++calls === 2) await f.denyHansen()
      return result
    })
    try { await expect(read()).rejects.toMatchObject({ status: 404 }) } finally { spy.mockRestore() }
    await expect(read(f.alexToken)).resolves.toMatchObject({ content: { kind: 'entries' }, runtimeGrant: false })
    await expect(read(f.admin, true)).resolves.toMatchObject({ content: { kind: 'entries' } })
    await f.identity.logout(f.alexToken, {}, context())
    await expect(read(f.alexToken)).rejects.toMatchObject({ status: 401 })
    await expect(f.service.content(f.admin, f.submitted.publicationId, f.selected().expectedRevision, f.submitted.archiveDigest,
      { kind: 'entries', cursor: 0 }, randomUUID(), true, AbortSignal.abort())).rejects.toThrow()
  })
  it('bounds concurrent sealed-content reads per account and releases reservations after completion', async () => {
    const f = await adoptionFixture(), original = f.identity.resourceRead.bind(f.identity)
    const ids = [randomUUID(), randomUUID()], counts = new Map<string, number>(), entered = deferred(), release = deferred(); let held = 0
    const spy = vi.spyOn(f.identity, 'resourceRead').mockImplementation(async (...args) => {
      const result = await original(...args), id = args[1]
      counts.set(id, (counts.get(id) ?? 0) + 1)
      if (ids.includes(id as typeof ids[number]) && counts.get(id) === 2) { if (++held === 2) entered.done(); await release.promise }
      return result
    })
    const read = (id: string) => f.service.content(f.admin, f.submitted.publicationId, f.selected().expectedRevision,
      f.submitted.archiveDigest, { kind: 'entries', cursor: 0 }, id, true, signal())
    const pending = ids.map(read)
    try {
      await entered.promise
      await expect(read(randomUUID())).rejects.toMatchObject({ status: 429, code: 'skill-content-busy' })
      release.done(); await expect(Promise.all(pending)).resolves.toHaveLength(2)
      await expect(read(randomUUID())).resolves.toMatchObject({ content: { kind: 'entries' } })
    } finally { release.done(); await Promise.allSettled(pending); spy.mockRestore() }
  })
  it.each(['skill-deny', 'agent-deny', 'skill-bytes'] as const)(
    'combines exact governance edges with original Agent/Skill/preset owners and rejects %s independently',
    async fault => {
      const f = await executionFixture(true, true, true)
      const create = async (cell: typeof f.hansenCell, id: string, name: string, skills: string[] = []) => {
        await cell.nativeRoot.agentPresets.copy('standard', id, name)
        return cell.agentOwner!.saveProfile({ agentId: id, presetId: id, name, description: name,
          basePresetId: 'standard', role: '工作助理', goal: '依据已核实资料完成工作', behavior: '区分事实和假设',
          instructions: '', preferredSkillNames: skills, productKind: 'personal' })
      }
      const source = await create(f.morgan, 'morgan-customer-method', 'Morgan 客户方法助手', [f.submitted.name])
      const agents = new Publications(f.identity, (...args) => f.gateway.readAgentPublication(...args),
        (...args) => f.gateway.adoptAgentPublication(...args))
      const submitted = (await agents.submit(f.admin, { presetId: source.presetId, expectedVersion: source.configVersion,
        reason: '提交真实原生智能体及固定技能依赖' }, context())).data
      const review = await agents.read(f.admin, submitted.publicationId, randomUUID())
      expect(review.snapshot.content.dependencies).toEqual([{ name: f.submitted.name, digest: f.submitted.digest }])
      let revision = (await agents.review(f.admin, submitted.publicationId, { expectedRevision: 1, decision: 'publish',
        reason: '确认准确原生来源及技能发布编号',
        skillPublications: [{ name: f.submitted.name, publicationId: f.submitted.publicationId }] }, context())).data.revision
      for (const member of [f.hansen, f.alex]) revision = (await agents.assign(f.admin, submitted.publicationId,
        { expectedRevision: revision, subjectKind: 'user', subjectId: member.userId, effect: 'allow', active: true,
          reason: '分别分配企业智能体' }, context())).data.revision
      const adoptionInput = { expectedRevision: revision, expectedDigest: submitted.digest }
      const entries = []
      for (const [entry, label, names] of [
        [f.hansenExecution, 'hansen', ['Hansen 客户跟进助手', 'Hansen 报价核对助手']],
        [f.alexExecution, 'alex', ['Alex 市场研究助手', 'Alex 竞品摘要助手']],
      ] as const) {
        const profiles = []
        for (const [index, name] of names.entries()) profiles.push(await create(entry.cell, label + '-personal-' + index, name))
        const command = context(), adopted = await agents.adopt(entry.token, submitted.publicationId, adoptionInput, command)
        expect(adopted.data).toMatchObject({ adopted: true, runtimeGrant: false })
        const receipt = await entry.cell.agentOwner!.getAdoptedPublication({ presetId: adopted.data.presetId })
        expect(receipt.snapshot).toEqual(review.snapshot)
        expect((await entry.cell.agentOwner!.listProfiles()).profiles.map(row => row.name).sort()).toEqual([...names].sort())
        expect((await entry.cell.nativeRoot.agentPresets.list()).filter((row: any) => row.trust === 'user')
          .map((row: any) => row.id).sort()).toEqual([...profiles.map(row => row.presetId), receipt.presetId].sort())
        const installedSkill = (await entry.cell.owner.listInstalled()).items.find(item => item.publication?.publicationId === f.submitted.publicationId)!
        const { schema: _schema, adoptedAt: _at, ...skillReference } = installedSkill.publication!
        await entry.cell.owner.setAdoptedSkillPreference({ reference: skillReference, expectedRevision: installedSkill.publicationPreference!.revision, field: 'enabled', value: true })
        const nativeSession = entry.cell.nativeRoot.sessions.create(entry.input.nativeSessionId, { meta: { agentPreset: receipt.presetId } })
        expect(nativeSession.header.agentPreset).toBe(receipt.presetId)
        const request = { ...entry.input, presetId: receipt.presetId }
        const execute = () => authorizeNativeExecution(entry.nativeContext, entry.cell.peer, request, signal())
        expect(await execute()).toEqual([f.submitted.publicationId])
        expect((await agents.adopt(entry.token, submitted.publicationId, adoptionInput, command)).replayed).toBe(true)
        const policy = await entry.cell.owner.getUserSkillPolicy()
        expect(policy.directBusinessSkillNames).toEqual([])
        const policyPath = join(entry.cell.directory, 'state', 'user-skill-policy.json')
        const readPolicy = () => readFile(policyPath).catch(error => { if (error.code === 'ENOENT') return null; throw error })
        const policyBytes = await readPolicy()
        const bytes = await Promise.all(['.paimind-publication.json', '.paimind-agent.json', 'agent.cordis.yml', 'preset.yml']
          .map(name => readFile(join(entry.cell.directory, 'presets', receipt.presetId, name))))
        entries.push({ ...entry, receipt, execute, request, bytes, profiles, readPolicy, policyBytes })
      }
      const [hansen, alex] = entries
      await expect(authorizeNativeExecution(hansen!.nativeContext, hansen!.cell.peer,
        { ...hansen!.request, sources: alex!.request.sources }, signal())).rejects.toThrow()
      expect(await alex!.execute()).toEqual([f.submitted.publicationId])
      if (fault === 'skill-deny') {
        // Same original source bytes, a different governance publication id.
        // Assigning it does not replace either member's immutable installed id.
        const otherSkill = (await f.service.submit(f.admin, { skillId: f.submitted.name,
          expectedDigest: f.submitted.digest, reason: '同一准确内容建立另一个审核版本' }, context(), signal())).data
        expect(otherSkill.publicationId).not.toBe(f.submitted.publicationId)
        expect(otherSkill.digest).toBe(f.submitted.digest)
        let skillRevision = (await f.service.review(f.admin, otherSkill.publicationId, { expectedRevision: 1,
          decision: 'publish', reason: '明确批准另一个技能发布编号' }, context())).data.revision
        const otherSource = await create(f.morgan, 'morgan-other-customer-method', 'Morgan 第二版客户方法助手', [f.submitted.name])
        const otherAgent = (await agents.submit(f.admin, { presetId: otherSource.presetId, expectedVersion: otherSource.configVersion,
          reason: '验证准确技能编号不得由同内容替代' }, context())).data
        let agentRevision = (await agents.review(f.admin, otherAgent.publicationId, { expectedRevision: 1, decision: 'publish',
          reason: '明确选择第二个技能发布编号',
          skillPublications: [{ name: otherSkill.name, publicationId: otherSkill.publicationId }] }, context())).data.revision
        for (const member of [f.hansen, f.alex]) {
          skillRevision = (await f.service.assign(f.admin, otherSkill.publicationId, { expectedRevision: skillRevision,
            subjectKind: 'user', subjectId: member.userId, effect: 'allow', active: true, reason: '明确分配第二个技能版本' }, context())).data.revision
          agentRevision = (await agents.assign(f.admin, otherAgent.publicationId, { expectedRevision: agentRevision,
            subjectKind: 'user', subjectId: member.userId, effect: 'allow', active: true, reason: '明确分配第二个智能体版本' }, context())).data.revision
        }
        for (const entry of entries) {
          const assigned = await agents.readAssigned(entry.token, otherAgent.publicationId, randomUUID())
          expect(assigned.skillPublications[0]!.publicationId).toBe(otherSkill.publicationId)
          const from = f.calls.length
          await expect(agents.adopt(entry.token, otherAgent.publicationId,
            { expectedRevision: agentRevision, expectedDigest: otherAgent.digest }, context())).rejects.toMatchObject({ status: 409 })
          expect(f.calls.slice(from).some(call => call.operation === 'publication.adopt')).toBe(false)
          expect((await entry.cell.nativeRoot.agentPresets.list()).filter((row: any) => row.trust === 'user')).toHaveLength(3)
          expect(await entry.execute()).toEqual([f.submitted.publicationId])
        }
      }
      if (fault === 'skill-deny') await f.denyHansen()
      else if (fault === 'agent-deny') await agents.assign(f.admin, submitted.publicationId, { expectedRevision: revision,
        subjectKind: 'user', subjectId: f.hansen.userId, effect: 'deny', active: true, reason: '仅撤销 Hansen 企业智能体权限' }, context())
      else await writeFile(join(f.hansenCell.directory, 'skills', f.submitted.name, 'sample.bin'), Buffer.from('Explicit local byte corruption'))
      await expect(hansen!.execute()).rejects.toThrow()
      expect(await alex!.execute()).toEqual([f.submitted.publicationId])
      for (const entry of entries) {
        const bytes = await Promise.all(['.paimind-publication.json', '.paimind-agent.json', 'agent.cordis.yml', 'preset.yml']
          .map(name => readFile(join(entry.cell.directory, 'presets', entry.receipt.presetId, name))))
        expect(bytes).toEqual(entry.bytes)
        if (entry === hansen && fault === 'skill-bytes') await expect(entry.cell.owner.getUserSkillPolicy()).rejects.toThrow('完整内容已变化')
        else expect((await entry.cell.owner.getUserSkillPolicy()).directBusinessSkillNames).toEqual([])
        expect(await entry.readPolicy()).toEqual(entry.policyBytes)
        expect((await entry.cell.agentOwner!.listProfiles()).profiles).toHaveLength(2)
      }
      // Original complete native Standard copies, Profile/Skill/Session owners,
      // full archive bytes, real PG, gateway and both private hops participate.
      // Execution here calls the native proof bridge directly: the full preset
      // mount, AgentLoop, browser and final Worker admission remain separate.
    })

  it.each([
    ['direct', 'invocation'], ['direct', 'tool'], ['session', 'invocation'], ['session', 'tool'],
  ] as const)('uses current PG eligibility through the original native owner, %s selection and %s body loading', async (selection, mode) => {
    const f = await executionFixture(true, true)
    const native = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
    const web = createRequire(native.resolve('@deepseek-ai/dsh-web-app/package.json'))
    const { AgentLoop } = web('@deepseek-ai/dsh-agent-loop'), { LlmAdapter, createUserMessage } = web('@deepseek-ai/dsh-llm')
    const start = async (entry: typeof f.hansenExecution) => {
      const root = entry.cell.nativeRoot, requests: any[] = []
      root.llm.registerAdapter(['local-only'], new class extends LlmAdapter {
        async *stream(request: unknown) {
          requests.push(request)
          if (mode === 'tool' && requests.length === 1) {
            const args = JSON.stringify({ name: f.submitted.name })
            yield { type: 'block-start', index: 0, blockType: 'tool-call' }
            yield { type: 'tool-call-delta', index: 0, id: 'selected-native-skill', name: 'skill', argumentsDelta: args }
            yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'selected-native-skill', name: 'skill', arguments: args } }
            yield { type: 'finish', reason: { kind: 'tool-calls' } }; return
          }
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: 'Explicit local adapter result, not model E2E' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Explicit local adapter result, not model E2E' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      }())
      await root.plugin(AgentLoop, { agents: [] })
      const handle = await root.agents.create({ sessionId: entry.input.nativeSessionId, meta: { agentPreset: 'standard' },
        agentOptions: { provider: 'local-only', model: 'synthetic' } })
      return { root, handle, requests, catalog: () => handle.agent.ctx.get('skills').list({ scope: handle.agent }),
        body: () => handle.agent.ctx.get('skills').get(f.submitted.name, { scope: handle.agent }), async prompt(invoke = false) {
          handle.agent.followup(createUserMessage({ source: { kind: 'user', rpcId: entry.input.sources[0] },
            content: [{ type: 'text', text: invoke ? '/' + f.submitted.name + ' Use verified notes' : 'Use the selected customer method' }] }))
          await handle.agent.whenIdle()
        } }
    }
    const hansen = await start(f.hansenExecution), alex = await start(f.alexExecution)
    // Cordis lookups return caller-bound trace proxies, not a stable object
    // identity. Each root mounted exactly one original service above.
    expect(hansen.root.get('paimindSkillInstaller') instanceof PaimindSkillInstallerService).toBe(true)
    expect(alex.root.get('paimindSkillInstaller') instanceof PaimindSkillInstallerService).toBe(true)
    const row = (items: any[]) => items.find(item => item.name === f.submitted.name)
    expect(row(await hansen.catalog())).toBeUndefined(); expect(row(await alex.catalog())).toBeUndefined()
    const selectOriginal = async (entry: typeof f.hansenExecution) => {
      const installed = (await entry.cell.owner.listInstalled()).items.find(item => item.publication?.publicationId === f.submitted.publicationId)!
      const { schema: _schema, adoptedAt: _at, ...reference } = installed.publication!
      const choice = await entry.cell.owner.setAdoptedSkillPreference({ reference, expectedRevision: installed.publicationPreference!.revision, field: 'enabled', value: true })
      if (selection === 'session') return entry.cell.owner.replaceSessionBusinessSkillSelection({
        sessionId: entry.input.nativeSessionId, expectedRevision: 0, skillNames: [f.submitted.name] })
      return entry.cell.owner.setAdoptedSkillPreference({ reference, expectedRevision: choice.revision, field: 'direct', value: true })
    }
    await selectOriginal(f.hansenExecution)
    expect(row(await hansen.catalog())).toMatchObject({ provider: 'paimind-session-business-skills' })
    expect(await hansen.body()).toMatchObject({ content: 'Use verified customer notes only.',
      resourceBase: { kind: 'directory', path: join(f.hansenCell.directory, 'skills', f.submitted.name) } })
    expect(row(await hansen.root.skills.list())).toBeUndefined()
    expect(row(await alex.catalog())).toBeUndefined(); expect(await alex.body()).toBeUndefined()
    const second = await hansen.root.agents.create({ sessionId: 'hansen-second', meta: { agentPreset: 'standard' },
      agentOptions: { provider: 'local-only', model: 'synthetic' } })
    const secondRow = row(await second.agent.ctx.get('skills').list({ scope: second.agent }))
    if (selection === 'session') expect(secondRow).toBeUndefined()
    else expect(secondRow).toMatchObject({ name: f.submitted.name })
    await hansen.prompt(mode === 'invocation')
    expect(hansen.requests).toHaveLength(mode === 'tool' ? 2 : 1)
    expect(JSON.stringify(hansen.requests.at(-1))).toContain('Use verified customer notes only.')
    expect(f.hansenCell.nativeUses).toEqual([{ name: f.submitted.name, publicationId: f.submitted.publicationId, packageDigest: f.submitted.digest }])
    const policyPath = join(f.hansenCell.directory, 'state', 'user-skill-policy.json')
    const policyBefore = await readFile(policyPath, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error })
    const bytesBefore = await readFile(join(f.hansenCell.directory, 'skills', f.submitted.name, 'sample.bin'))
    await f.denyHansen()
    await hansen.prompt()
    expect(hansen.requests).toHaveLength(mode === 'tool' ? 2 : 1)
    expect(hansen.handle.agent.session.events.findLast((event: any) => event.type === 'turn/end').data.reason.kind).not.toBe('completed')
    const fresh = await hansen.root.agents.create({ sessionId: 'hansen-after-revocation', meta: { agentPreset: 'standard' },
      agentOptions: { provider: 'local-only', model: 'synthetic' } })
    expect(row(await fresh.agent.ctx.get('skills').list({ scope: fresh.agent }))).toBeUndefined()
    expect(await fresh.agent.ctx.get('skills').get(f.submitted.name, { scope: fresh.agent })).toBeUndefined()
    expect(await readFile(policyPath, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error })).toBe(policyBefore)
    expect(await readFile(join(f.hansenCell.directory, 'skills', f.submitted.name, 'sample.bin'))).toEqual(bytesBefore)
    await selectOriginal(f.alexExecution); await alex.prompt(mode === 'invocation')
    expect(alex.requests).toHaveLength(mode === 'tool' ? 2 : 1)
    expect(f.alexCell.nativeUses).toEqual([{ name: f.submitted.name, publicationId: f.submitted.publicationId, packageDigest: f.submitted.digest }])
    // Actual original owner/lifecycle/provider/catalog/body/tool, current PG
    // grants and both private hops. No injected Skill projection, fake scope
    // event or direct policy file write. Models, image pins and the unused HTTP
    // upload registration remain fixtures; no final Worker or Browser claim.
  })

  it('projects real PG eligibility through both private hops into the original member preference owner', async () => {
    const f = await executionFixture(true), hansen = f.hansenCell.owner, alex = f.alexCell.owner
    expect((await hansen.listInstalled()).items[0]).toMatchObject({ name: f.submitted.name, publicationEligible: true })
    const descriptor = PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS.find(item => item.method === 'listInstalled')!
    expect(descriptor.result.schema.parse(await hansen.listInstalled())).toMatchObject({ items: [{ publicationEligible: true }] })
    const policy = await hansen.getUserSkillPolicy()
    expect(policy.directBusinessSkillNames).toEqual([f.submitted.name])
    await hansen.replaceSessionBusinessSkillSelection({ sessionId: f.hansenCell.session.id, expectedRevision: 0, skillNames: [f.submitted.name] })
    expect(await f.hansenExecution.execute()).toEqual([f.submitted.publicationId])
    const path = join(f.hansenCell.directory, 'state', 'user-skill-policy.json'), before = await readFile(path, 'utf8')
    await f.denyHansen()
    expect((await hansen.listInstalled()).items[0]?.publicationEligible).toBe(false)
    expect(descriptor.result.schema.parse(await hansen.listInstalled())).toMatchObject({ items: [{ publicationEligible: false }] })
    expect(await hansen.getUserSkillPolicy()).toMatchObject({ enabledBusinessSkillNames: [], directBusinessSkillNames: [] })
    await expect(hansen.replaceUserSkillPolicy({ expectedRevision: policy.revision,
      enabledOptionalSystemSkillNames: policy.enabledOptionalSystemSkillNames,
      enabledBusinessSkillNames: [f.submitted.name], directBusinessSkillNames: [f.submitted.name] })).rejects.toThrow('当前不可用')
    expect(await readFile(path, 'utf8')).toBe(before)
    await expect(f.hansenExecution.execute()).rejects.toThrow()
    expect((await alex.getUserSkillPolicy()).directBusinessSkillNames).toEqual([f.submitted.name])
    expect(await f.alexExecution.execute()).toEqual([f.submitted.publicationId])
    await hansen.replaceSessionBusinessSkillSelection({ sessionId: f.hansenCell.session.id, expectedRevision: 1, skillNames: [] })
    // Metadata remains an account projection after logout, not a borrowed
    // login: the exact old execution source still fails, despite eligibility.
    await f.identity.logout(f.alexToken, {}, context())
    expect((await alex.listInstalled()).items[0]?.publicationEligible).toBe(true)
    await expect(f.alexExecution.execute()).rejects.toThrow()
    expect((await f.identity.me(f.admin, randomUUID())).role).toBe('admin')
  })

  it.each(['account-disabled', 'tenant-disabled', 'lease-expired', 'binding-changed', 'connection-closed'] as const)(
    'refuses current eligibility when its pinned authority is %s', async fault => {
      const f = await executionFixture(true)
      expect((await f.hansenCell.owner.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([f.submitted.name])
      if (fault === 'account-disabled') await owner`update haas.users set status = 'disabled' where tenant_id = ${f.tenantId} and user_id = ${f.hansen.userId}`
      if (fault === 'tenant-disabled') await owner`update haas.tenants set status = 'disabled' where tenant_id = ${f.tenantId}`
      if (fault === 'lease-expired') await owner`update haas.runtime_bindings set lease_expires_at = clock_timestamp() - interval '1 second' where cell_id = ${f.hansenCell.cellId}`
      if (fault === 'binding-changed') await owner`update haas.runtime_bindings set policy_digest = ${'sha256:' + '9'.repeat(64)} where cell_id = ${f.hansenCell.cellId}`
      if (fault === 'connection-closed') f.hansenCell.transport.destroy()
      await expect(f.hansenCell.owner.getUserSkillPolicy()).rejects.toThrow()
    })

  it('never projects eligibility for a forged version, foreign tenant or caller-selected identity', async () => {
    const f = await executionFixture(true), row = (await f.hansenCell.owner.listInstalled()).items[0]!.publication!
    const { schema: _schema, adoptedAt: _at, ...reference } = row
    expect(await f.hansenCell.peer.readSkillEligibility([reference])).toEqual([row.publicationId])
    for (const changed of [{ ...reference, packageDigest: 'sha256:' + '9'.repeat(64) },
      { ...reference, sourceUserId: f.alex.userId }, { ...reference, tenantId: 'another-tenant' }, { ...reference, publicationId: randomUUID() }]) {
      expect(await f.hansenCell.peer.readSkillEligibility([changed])).toEqual([])
    }
    await expect(f.hansenCell.peer.readSkillEligibility([{ ...reference, userId: f.alex.userId }] as never)).rejects.toThrow()
    await expect(f.bindings.readSkillEligibility(randomUUID(), [reference], signal())).rejects.toThrow()
    await expect(f.hansenCell.peer.readSkillEligibility([reference], AbortSignal.abort())).rejects.toThrow()
    await expect(f.identity.readRuntimeAccount({ tenantId: f.tenantId, userId: f.alex.userId, role: 'member',
      sessionId: randomUUID() } as never, randomUUID(), async () => 'invalid')).rejects.toThrow()
  })

  it('signs original child settlement with its newly loaded Skill and rejects the parent after real PG withdrawal', async () => {
    const f = await executionFixture(), entry = f.hansenExecution
    const native = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
    const web = createRequire(native.resolve('@deepseek-ai/dsh-web-app/package.json'))
    const { Context } = web('@deepseek-ai/cordis'), { SessionStore } = web('@deepseek-ai/dsh-session')
    const { AgentLoop } = web('@deepseek-ai/dsh-agent-loop'), { SystemPrompt } = web('@deepseek-ai/dsh-system-prompt')
    const { ToolRuntime } = web('@deepseek-ai/dsh-tools'), { LlmRuntime, LlmAdapter, createUserMessage } = web('@deepseek-ai/dsh-llm')
    const { SkillRegistry, renderSkillContent } = native('@deepseek-ai/dsh-skill'), ToolSkill = native('@deepseek-ai/dsh-tool-skill')
    const { JsonlSessionPersistence } = web('@deepseek-ai/dsh-session-persistence-jsonl')
    const spawn = native('@deepseek-ai/dsh-subagent-spawn-in-process'), root = new Context()
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'paimind-pg-skill-settlement-')))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const oldLookup = entry.cell.sessionLookup.get
    cleanup.push(async () => {
      for (const agent of root.get('agents')?.list() ?? []) agent.cancel({ kind: 'user' })
      await root.fiber.dispose(); entry.cell.sessionLookup.get = oldLookup
    })
    const checks: any[] = [], derivations: any[] = [], uses: any[] = [], parentEntered = deferred(), parentRelease = deferred()
    let parentCalls = 0, childCalls = 0
    installManagedHarnessOriginGuard(root, async (input, abort) => {
      checks.push(input); return authorizeNativeExecution(entry.nativeContext, entry.cell.peer, input, abort)
    }, { render: renderSkillContent, check: async (input, value, abort) => {
      const reference = await authorizeNativeSkillUse(entry.nativeContext, entry.cell.peer, input, value, abort)
      uses.push(reference); return reference
    } })
    const managed = createManagedHarnessDelegationProviders(root, async (input, abort) => {
      derivations.push(input); return deriveNativeOrigins(entry.nativeContext, entry.cell.peer, input, abort)
    }, [spawn])
    for (const [plugin, settings] of [[SessionStore], [managed.Agents], [SystemPrompt, {}], [LlmRuntime], [ToolRuntime, {}],
      [managed.Subagents], [SkillRegistry], [ToolSkill, {}]]) await root.plugin(plugin, settings)
    await root.plugin(JsonlSessionPersistence, { root: directory, compression: 'none' })
    entry.cell.sessionLookup.get = id => root.sessions.get(id)
    // Preset/eligibility projection remain explicit fixtures. Original native
    // child creation, Session lookup, Skill owner bytes and private PG decisions
    // are real. Do not expose the current enterprise UI admission gate here.
    root.provide('agentPresets', { composedPreset: (ctx: any) => ctx.agent?.session.header.agentPreset, composeFrom: () => {} })
    const source = await entry.cell.owner.getSkillSource({ skillId: f.submitted.name })
    root.subagents.registerContinuableSetup(async (context: any) => {
      await context.plugin({ name: 'fixture-owned-enterprise-method', inject: ['skills'], apply(ctx: any) {
        ctx.skills.register({ name: f.submitted.name, description: source.description, content: source.instructions, source: 'custom',
          provider: 'paimind-session-business-skills', resourceBase: { kind: 'directory', path: join(entry.cell.directory, 'skills', f.submitted.name) } })
      } })
    })
    root.llm.registerAdapter(['local-only'], new class extends LlmAdapter {
      async *stream(request: any) {
        if (request.model === 'parent') {
          parentCalls++; parentEntered.done()
          await Promise.race([parentRelease.promise, new Promise<void>(resolve => {
            if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', () => resolve(), { once: true })
          })])
          if (request.signal.aborted) return
        } else if (++childCalls === 1) {
          await f.select(entry.cell, true)
          const args = JSON.stringify({ name: f.submitted.name })
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id: 'child-owned-skill', name: 'skill', argumentsDelta: args }
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'child-owned-skill', name: 'skill', arguments: args } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }; return
        } else await f.select(entry.cell, false)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'Explicit local terminal result, no external model' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Explicit local terminal result, no external model' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }())
    await root.plugin(AgentLoop, { agents: [] })
    await root.plugin(managed.selectProvider(spawn), { providerName: 'original-spawn' })
    const parent = await root.agents.create({ sessionId: entry.input.nativeSessionId, meta: { agentPreset: 'standard' },
      agentOptions: { provider: 'local-only', model: 'parent' } })
    await f.select(entry.cell, false)
    parent.agent.followup(createUserMessage({ source: { kind: 'user', rpcId: entry.input.sources[0] }, content: [{ type: 'text', text: 'Continue owned delegated work' }] }))
    await parentEntered.promise
    // Selection changes AFTER the original parent captured no Skill. The
    // delegated source is not retroactively rewritten when the child loads it.
    const { childId } = await root.subagents.startContinuable({ provider: 'original-spawn', label: 'Customer method check',
      request: { parent: parent.agent, prompt: [{ type: 'text', text: 'Read the assigned method' }],
        agentOptions: { provider: 'local-only', model: 'child' } }, signal: signal() })
    await vi.waitFor(() => expect(root.agents.get(childId)).toBeUndefined(), { timeout: 8000 })
    expect(derivations[0].requirements ?? []).toEqual([])
    const initialSource = (await root.sessionPersistence.inspect(childId)).events.find((event: any) => event.type === 'user/message'
      && event.data.source.kind === 'coordinator').data.source.paimindOrigins[0]
    expect(JSON.parse(Buffer.from(initialSource.split('.')[1], 'base64url').toString('utf8')).requiredSkillIds).toEqual([])
    expect(childCalls).toBe(2); expect(uses).toEqual([{ name: f.submitted.name, publicationId: f.submitted.publicationId, packageDigest: f.submitted.digest }])
    const terminal = derivations.find(row => row.targetSessionId === parent.agent.id)
    expect(terminal.requirements).toEqual([f.submitted.publicationId])
    const notice = parent.agent.inbox.nextStep.find((message: any) => message.source.kind === 'subagent-settled')
    expect(notice.source.senderSessionId).toBe(childId)
    expect(JSON.parse(Buffer.from(notice.source.paimindOrigins[0].split('.')[1], 'base64url').toString('utf8')).requiredSkillIds).toEqual([f.submitted.publicationId])
    expect((await root.sessionPersistence.readRaw(childId)).content).toContain('paimindSkillUse')
    await f.denyHansen()
    await expect(authorizeNativeExecution(entry.nativeContext, entry.cell.peer, { nativeSessionId: parent.agent.id, presetId: 'standard',
      sources: notice.source.paimindOrigins }, signal())).rejects.toThrow()
    parentRelease.done(); await parent.agent.whenIdle()
    expect(parentCalls).toBe(1)
    expect(parent.agent.session.events.findLast((event: any) => event.type === 'turn/end').data.reason.kind).not.toBe('completed')
    expect(await f.alexExecution.execute()).toEqual([f.submitted.publicationId])
  })

  it.each(['invocation', 'tool'] as const)('retains a Skill loaded via original %s AFTER origin signing, with actual owner bytes, PG denial and native reconstruction', async mode => {
    const f = await executionFixture(), entry = f.hansenExecution
    const native = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
    const web = createRequire(native.resolve('@deepseek-ai/dsh-web-app/package.json'))
    const { Context } = web('@deepseek-ai/cordis'), { SessionStore, Session } = web('@deepseek-ai/dsh-session')
    const { AgentRegistry } = web('@deepseek-ai/dsh-agent'), { AgentLoop } = web('@deepseek-ai/dsh-agent-loop')
    const { SystemPrompt } = web('@deepseek-ai/dsh-system-prompt'), { ToolRuntime } = web('@deepseek-ai/dsh-tools')
    const { LlmRuntime, LlmAdapter, createUserMessage } = web('@deepseek-ai/dsh-llm')
    const { SkillRegistry, renderSkillContent } = native('@deepseek-ai/dsh-skill'), ToolSkill = native('@deepseek-ai/dsh-tool-skill')
    const makeRuntime = async (selected: typeof entry, seed?: readonly unknown[]) => {
      const root = new Context(), requests: any[] = [], checks: any[] = [], uses: any[] = []
      cleanup.push(async () => { for (const agent of root.get('agents')?.list() ?? []) agent.cancel({ kind: 'user' }); await root.fiber.dispose() })
      installManagedHarnessOriginGuard(root, async (input, abort) => {
        checks.push(input); return authorizeNativeExecution(selected.nativeContext, selected.cell.peer, input, abort)
      }, { render: renderSkillContent, check: async (input, value, abort) => {
        const reference = await authorizeNativeSkillUse(selected.nativeContext, selected.cell.peer, input, value, abort)
        uses.push(reference); return reference
      } })
      for (const [plugin, settings] of [[SessionStore], [AgentRegistry], [SystemPrompt, {}], [ToolRuntime, {}], [LlmRuntime], [SkillRegistry], [ToolSkill, {}]]) await root.plugin(plugin, settings)
      root.llm.registerAdapter(['local-only'], new class extends LlmAdapter {
        async *stream(request: unknown) {
          requests.push(request)
          if (mode === 'tool' && requests.length === 1 && !seed) {
            const args = JSON.stringify({ name: f.submitted.name })
            yield { type: 'block-start', index: 0, blockType: 'tool-call' }
            yield { type: 'tool-call-delta', index: 0, id: 'owned-skill-read', name: 'skill', argumentsDelta: args }
            yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'owned-skill-read', name: 'skill', arguments: args } }
            yield { type: 'finish', reason: { kind: 'tool-calls' } }; return
          }
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: 'Explicit local response, not real model acceptance' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Explicit local response, not real model acceptance' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      }())
      await root.plugin(AgentLoop, { agents: [] })
      const handle = await root.agents.create({ sessionId: selected.input.nativeSessionId, meta: { agentPreset: 'standard' },
        ...(seed ? { seed } : {}), agentOptions: { provider: 'local-only', model: 'synthetic' } })
      // Explicit eligibility projection fixture, never opening the real UI gate.
      // The native Registry/ToolSkill and immutable owner/body verification are real.
      const source = await selected.cell.owner.getSkillSource({ skillId: f.submitted.name })
      await handle.agent.ctx.plugin({ name: 'fixture-enterprise-skill-projection', inject: ['skills'], apply(ctx: any) {
        ctx.skills.register({ name: f.submitted.name, description: source.description, content: source.instructions, source: 'custom',
          provider: 'paimind-session-business-skills', resourceBase: { kind: 'directory', path: join(selected.cell.directory, 'skills', f.submitted.name) } })
      } })
      return { root, handle, requests, checks, uses, async prompt(source: object, invoke = false) {
        handle.agent.followup(createUserMessage({ source, content: [{ type: 'text', text: invoke ? '/' + f.submitted.name + ' Use method' : 'Continue owned work' }] }))
        await handle.agent.whenIdle()
      } }
    }
    await f.select(entry.cell, false)
    const sealed = await sealNativeJobOrigins(entry.nativeContext, entry.cell.peer, { ...entry.input, nativeJobId: 'before-new-skill' }, signal())
    expect(JSON.parse(Buffer.from(sealed.sources[0]!.split('.')[1]!, 'base64url').toString('utf8')).requiredSkillIds).toEqual([])
    await f.select(entry.cell, true)
    let runtime = await makeRuntime(entry)
    // Original slash gestures belong only to direct human input. A background
    // notice cannot forge one; its later Skill use comes from the actual tool.
    await runtime.prompt(mode === 'invocation' ? { kind: 'user', rpcId: entry.input.sources[0] }
      : { kind: 'plugin', plugin: 'tool-jobs', form: 'notice', summary: 'Original job result', nativeJobId: 'before-new-skill',
        paimindOrigins: sealed.sources }, mode === 'invocation')
    expect(runtime.requests).toHaveLength(mode === 'tool' ? 2 : 1)
    expect(runtime.uses).toEqual([{ name: f.submitted.name, publicationId: f.submitted.publicationId, packageDigest: f.submitted.digest }])
    await f.select(entry.cell, false)
    const original = runtime.handle.agent.session
    const consumed = original.events.filter((event: any) => event.type === 'user/message').map((event: any) => event.data)
      .filter((message: any) => mode === 'invocation' ? message.source.kind === 'user' : message.source.plugin === 'tool-jobs')
    expect((await captureManagedHarnessTerminalOrigins(runtime.root, runtime.handle.agent, consumed, signal())).input.requirements).toEqual([f.submitted.publicationId])
    const restored = Session.fromRestore(original.id, JSON.parse(JSON.stringify(original.events)), JSON.parse(JSON.stringify(original.header)))
    await runtime.root.fiber.dispose(); runtime = await makeRuntime(entry, restored.events)
    await f.denyHansen()
    await runtime.prompt({ kind: 'user', rpcId: entry.input.sources[0] })
    expect(runtime.requests).toHaveLength(0)
    expect(runtime.checks.at(-1)).toMatchObject({ sources: entry.input.sources, requirements: [f.submitted.publicationId] })
    const alex = await makeRuntime(f.alexExecution)
    await alex.prompt({ kind: 'user', rpcId: f.alexExecution.input.sources[0] }, mode === 'invocation')
    expect(alex.requests).toHaveLength(mode === 'tool' ? 2 : 1)
    // No final image, disk restore, real model or Browser E2E claim.
  })

  it.each(['warm', 'native-restore'] as const)('rechecks a prior signed job result still in %s native model context after Skill deselection and real PG denial', async mode => {
    const f = await executionFixture(), entry = f.hansenExecution
    const native = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
    const web = createRequire(native.resolve('@deepseek-ai/dsh-web-app/package.json'))
    const { Context } = web('@deepseek-ai/cordis'), { SessionStore, Session } = web('@deepseek-ai/dsh-session')
    const { AgentRegistry } = web('@deepseek-ai/dsh-agent'), { AgentLoop } = web('@deepseek-ai/dsh-agent-loop')
    const { SystemPrompt } = web('@deepseek-ai/dsh-system-prompt'), { ToolRuntime } = web('@deepseek-ai/dsh-tools')
    const { LlmRuntime, LlmAdapter, createUserMessage } = web('@deepseek-ai/dsh-llm')
    const makeRuntime = async (selected: typeof entry, seed?: readonly unknown[]) => {
      const root = new Context(), requests: any[] = [], checks: any[] = []
      cleanup.push(async () => { for (const agent of root.get('agents')?.list() ?? []) agent.cancel({ kind: 'user' }); await root.fiber.dispose() })
      installManagedHarnessOriginGuard(root, async (input, abort) => {
        checks.push(input)
        return authorizeNativeExecution(selected.nativeContext, selected.cell.peer, input, abort)
      })
      for (const [plugin, settings] of [[SessionStore], [AgentRegistry], [SystemPrompt, {}], [ToolRuntime, {}], [LlmRuntime]]) await root.plugin(plugin, settings)
      root.llm.registerAdapter(['local-only'], new class extends LlmAdapter {
        async *stream(request: unknown) {
          requests.push(request)
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: 'Explicit local-only response fixture' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Explicit local-only response fixture' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      }())
      await root.plugin(AgentLoop, { agents: [] })
      const handle = await root.agents.create({ sessionId: selected.input.nativeSessionId, meta: { agentPreset: 'standard' },
        ...(seed ? { seed } : {}), agentOptions: { provider: 'local-only', model: 'synthetic' } })
      return { root, handle, requests, checks, async prompt(source: object) {
        handle.agent.followup(createUserMessage({ source, content: [{ type: 'text', text: 'Use the governed task result' }] }))
        await handle.agent.whenIdle()
      } }
    }
    const sealed = await sealNativeJobOrigins(entry.nativeContext, entry.cell.peer, { ...entry.input, nativeJobId: 'bash-context' }, signal())
    await f.select(entry.cell, false)
    let runtime = await makeRuntime(entry)
    await runtime.prompt({ kind: 'plugin', plugin: 'tool-jobs', form: 'notice', summary: 'Owned result ready', nativeJobId: 'bash-context', paimindOrigins: sealed.sources })
    expect(runtime.requests).toHaveLength(1)
    if (mode === 'native-restore') {
      const original = runtime.handle.agent.session
      const restored = Session.fromRestore(original.id, JSON.parse(JSON.stringify(original.events)), JSON.parse(JSON.stringify(original.header)))
      await runtime.root.fiber.dispose()
      runtime = await makeRuntime(entry, restored.events)
    }
    await f.denyHansen()
    const before = runtime.requests.length
    await runtime.prompt({ kind: 'user', rpcId: entry.input.sources[0] })
    expect(runtime.requests).toHaveLength(before)
    expect(runtime.checks.at(-1)).toMatchObject({ sources: entry.input.sources, requirements: [f.submitted.publicationId] })
    const alex = await makeRuntime(f.alexExecution)
    await alex.prompt({ kind: 'user', rpcId: f.alexExecution.input.sources[0] })
    expect(alex.requests).toHaveLength(1)
    // Native Session/Agent/loop, signed origins, complete adopted bytes and PG
    // denial are real. Pins, initial job notice delivery and model are explicit
    // fixtures; this is not original job-controller, disk/Worker or Browser E2E.
  })

  it('authorizes and seals an independent captured job without importing a later denied parent selection', async () => {
    const f = await executionFixture(), entry = f.hansenExecution
    await f.select(entry.cell, false)
    const requirements = await entry.execute()
    expect(requirements).toEqual([])
    const captured = { ...entry.input, requirements, skillSelection: 'captured' as const }
    await f.select(entry.cell, true); await f.denyHansen()
    await expect(entry.execute()).rejects.toThrow()
    expect(await authorizeNativeExecution(entry.nativeContext, entry.cell.peer, captured, signal())).toEqual([])
    const sealed = await sealNativeJobOrigins(entry.nativeContext, entry.cell.peer, { ...captured, nativeJobId: 'bash-independent' }, signal())
    for (const source of sealed.sources) expect(JSON.parse(Buffer.from(source.split('.')[1]!, 'base64url').toString()).requiredSkillIds).toEqual([])
    await expect(authorizeNativeExecution(entry.nativeContext, entry.cell.peer, { ...captured, requirements: [f.submitted.publicationId] }, signal())).rejects.toThrow()
    await expect(sealNativeJobOrigins(entry.nativeContext, entry.cell.peer, { ...captured, requirements: [f.submitted.publicationId], nativeJobId: 'bash-dependent' }, signal())).rejects.toThrow()
    await f.alexExecution.execute()
  })
  it('rechecks a captured used Skill after deselection and denial, while a new unrelated chat and Alex remain usable', async () => {
    const f = await executionFixture(), required = await f.hansenExecution.execute()
    expect(required).toEqual([f.submitted.publicationId])
    await f.select(f.hansenCell, false); await f.hansenExecution.execute(signal(), required)
    await f.denyHansen()
    await expect(f.hansenExecution.execute(signal(), required)).rejects.toThrow()
    await expect(f.hansenExecution.execute()).resolves.toEqual([])
    await f.alexExecution.execute()
  })

  it.each(['delegation', 'job'] as const)('binds retained Skill requirements to real signed %s sources across private transport and serialization', async mode => {
    const f = await executionFixture(), entry = f.hansenExecution, required = await entry.execute()
    const request = { ...entry.input, requirements: required }
    const derived = mode === 'delegation'
      ? await deriveNativeOrigins(entry.nativeContext, entry.cell.peer, { ...request, targetSessionId: 'hansen-child' }, signal())
      : await sealNativeJobOrigins(entry.nativeContext, entry.cell.peer, { ...request, nativeJobId: 'bash-1' }, signal())
    for (const source of derived.sources) expect(JSON.parse(Buffer.from(source.split('.')[1]!, 'base64url').toString()).requiredSkillIds).toEqual(required)
    const restored = JSON.parse(JSON.stringify(derived)) // Explicit message-envelope roundtrip, not native cold-Worker acceptance.
    entry.cell.session.id = restored.nativeSessionId
    await f.select(entry.cell, false)
    const input = { ...restored, presetId: 'standard' }
    expect(await authorizeNativeExecution(entry.nativeContext, entry.cell.peer, input, signal())).toEqual(required)
    const proofs = await entry.cell.owner.getSelectedPublicationReferences({ nativeSessionId: input.nativeSessionId, presetId: 'standard', requiredPublicationIds: required })
    await expect(entry.cell.peer.authorizeExecution({ ...input, publication: null, skills: [] })).rejects.toThrow()
    await expect(entry.cell.peer.deriveOrigins({ ...input, publication: null, skills: [], targetSessionId: 'hansen-grandchild' })).rejects.toThrow()
    await expect(entry.cell.peer.sealJobOrigins({ ...input, publication: null, skills: [], nativeJobId: 'bash-2' })).rejects.toThrow()
    const [prefix, encoded, signature] = input.sources[0].split('.')
    const changed = { ...JSON.parse(Buffer.from(encoded, 'base64url').toString()), requiredSkillIds: [] }
    const tampered = `${prefix}.${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`
    await expect(entry.cell.peer.authorizeExecution({ ...input, sources: [tampered], publication: null, skills: proofs })).rejects.toThrow()
    await f.denyHansen()
    await expect(authorizeNativeExecution(entry.nativeContext, entry.cell.peer, input, signal())).rejects.toThrow()
    await f.alexExecution.execute()
  })

  it('bounds and preserves 128 signed dependency ids using the real identity owner, without claiming resource execution', async () => {
    const f = await fixture(), scope = { tenantId: f.tenantId, userId: f.hansen.userId, role: 'member' as const,
      cellId: randomUUID(), nativeSessionId: 'parent' }
    const source = await f.identity.sealInteractiveOrigin(f.hansenToken, randomUUID(), scope)
    const ids = Array.from({ length: 128 }, () => randomUUID()).sort(), verify = vi.fn(async () => {})
    const derived = await f.identity.deriveInteractiveOrigins([source], randomUUID(), scope, 'child', 'standard', verify, ids)
    expect(derived[0]!.length).toBeLessThanOrEqual(8192)
    const recovered = new Identity(sql, f.tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
    await recovered.withInteractiveOrigins(derived, randomUUID(), { ...scope, nativeSessionId: 'child' }, verify, 'standard', ids)
    await expect(recovered.withInteractiveOrigins(derived, randomUUID(), { ...scope, nativeSessionId: 'child' }, verify, 'standard', ids.slice(1))).rejects.toThrow()
    await expect(f.identity.deriveInteractiveOrigins([source], randomUUID(), scope, 'child', 'standard', verify, [...ids, randomUUID()])).rejects.toThrow()
    expect(verify).toHaveBeenCalledTimes(2) // identity syntax/signature only; no fake resource allowance is claimed.
  })

  it('checks current selected Skill rights separately for Hansen and Alex without poisoning an unrelated direct chat', async () => {
    const f = await executionFixture()
    await f.hansenExecution.execute(); await f.alexExecution.execute()
    await f.denyHansen()
    await expect(f.hansenExecution.execute()).rejects.toThrow(); await f.alexExecution.execute()
    await f.select(f.hansenCell, false); await f.hansenExecution.execute()
    await f.select(f.hansenCell, true); await expect(f.hansenExecution.execute()).rejects.toThrow()
    expect(await readFile(join(f.hansenCell.directory, 'skills', f.submitted.name, 'sample.bin'))).toEqual(f.binary)
    expect((await f.hansenCell.owner.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([])
  })

  it('does not let retained adoption bytes or another member login renew an expired original login', async () => {
    const f = await executionFixture(); await f.hansenExecution.execute()
    await f.identity.logout(f.hansenToken, {}, context())
    await expect(f.hansenExecution.execute()).rejects.toThrow(); await f.alexExecution.execute()
    await expect(f.alexCell.peer.authorizeExecution({ ...f.hansenExecution.input, publication: null, skills: [] })).rejects.toThrow()
  })

  it('denies current Skill revocation while the private authorization request waits', async () => {
    const f = await executionFixture(), entered = deferred(), release = deferred()
    f.runtimeHooks.beforeCheck = async () => { entered.done(); await release.promise }
    const pending = f.hansenExecution.execute(), rejection = expect(pending).rejects.toThrow()
    await entered.promise; await f.denyHansen(); release.done(); await rejection
    await f.alexExecution.execute()
  })

  it.each(['selection', 'content'] as const)('refuses %s drift after authority responded and preserves the other member', async mode => {
    const f = await executionFixture()
    f.runtimeHooks.afterCheck = async () => {
      if (mode === 'selection') await f.select(f.hansenCell, false)
      else await writeFile(join(f.hansenCell.directory, 'skills', f.submitted.name, 'sample.bin'), 'Changed target')
    }
    await expect(f.hansenExecution.execute()).rejects.toThrow(); await f.alexExecution.execute()
  })

  it.each(['tenantId', 'sourceUserId', 'name', 'packageDigest', 'archiveDigest', 'archiveBytes', 'expandedBytes', 'entryCount'] as const)
    ('rejects forged %s in a fixed Skill proof at the current database authority', async field => {
      const f = await executionFixture(), entry = f.hansenExecution
      const [reference] = await f.hansenCell.owner.getSelectedPublicationReferences({ nativeSessionId: entry.input.nativeSessionId, presetId: entry.input.presetId })
      if (!reference) throw Error('Expected selected fixed reference')
      const value = field === 'tenantId' ? 'foreign-tenant' : field === 'sourceUserId' ? randomUUID() : field === 'name' ? 'another-skill'
        : field === 'packageDigest' || field === 'archiveDigest' ? 'sha256:' + '0'.repeat(64) : reference[field] + 1
      await expect(entry.cell.peer.authorizeExecution({ ...entry.input, publication: null, skills: [{ ...reference, [field]: value }] })).rejects.toThrow()
      await f.hansenExecution.execute(); await f.alexExecution.execute()
    })

  it('adopts the same immutable Skill independently for Hansen and Alex, retains source edits and denies revocation replay', async () => {
    const f = await adoptionFixture(), command = context(), first = await f.adopt(f.hansenToken, command), second = await f.adopt(f.alexToken)
    expect(first.data).toMatchObject({ publicationId: f.submitted.publicationId, packageDigest: f.submitted.digest, runtimeGrant: false })
    expect(second.data.publicationId).toBe(first.data.publicationId)
    const writes = () => f.calls.filter(call => call.operation === 'skill.adopt.write').length
    const count = writes(); expect(count).toBeGreaterThan(4)
    expect(await f.adopt(f.hansenToken, command)).toEqual({ ...first, replayed: true }); expect(writes()).toBe(count)
    const source = await f.morgan.owner.getSkillSource({ skillId: input.skillId })
    await f.morgan.owner.saveSkillSource({ name: input.skillId, description: source.description, instructions: 'Morgan later edited draft', expectedDigest: source.digest })
    for (const cell of [f.hansenCell, f.alexCell]) {
      expect((await cell.owner.getSkillPackage({ skillId: input.skillId })).digest).toBe(f.submitted.digest)
      expect(await readFile(join(cell.directory, 'skills', input.skillId, 'sample.bin'))).toEqual(f.binary)
      expect((await cell.owner.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([])
      expect(await readdir(join(cell.directory, 'state', 'publication-imports'))).toEqual([])
    }
    await f.denyHansen(); const before = f.calls.length
    await expect(f.service.adopt(f.hansenToken, f.submitted.publicationId,
      { expectedRevision: 4, expectedDigest: f.submitted.digest }, command, signal())).rejects.toMatchObject({ status: 404 })
    expect(f.calls).toHaveLength(before)
    await expect(f.adopt(f.alexToken)).resolves.toMatchObject({ data: { runtimeGrant: false } })
    expect(await readFile(join(f.hansenCell.directory, 'skills', input.skillId, 'sample.bin'))).toEqual(f.binary)
  })

  it('stops an in-progress Skill delivery after current assignment is revoked without affecting Alex', async () => {
    const f = await adoptionFixture()
    let first = true
    f.hooks.afterWrite = async () => { if (first) { first = false; await f.denyHansen() } }
    await expect(f.adopt()).rejects.toThrow()
    expect(f.calls.filter(call => call.member === 'hansen' && call.operation === 'skill.adopt.write')).toHaveLength(1)
    expect(f.calls.some(call => call.member === 'hansen' && call.operation === 'skill.adopt.commit')).toBe(false)
    expect(await readdir(join(f.hansenCell.directory, 'state', 'publication-imports'))).toEqual([])
    await expect(readFile(join(f.hansenCell.directory, 'skills', input.skillId, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(f.adopt(f.alexToken)).resolves.toMatchObject({ data: { runtimeGrant: false } })
    expect(await readFile(join(f.alexCell.directory, 'skills', input.skillId, 'sample.bin'))).toEqual(f.binary)
  })

  it('keeps a real target after adoption audit rollback and verifies it on retry without re-sending bytes', async () => {
    const f = await adoptionFixture(), command = context(), name = 'skill_adopt_audit_' + randomUUID().replaceAll('-', '')
    await owner.unsafe(`create function haas.${name}() returns trigger language plpgsql as $$ begin
      if NEW.tenant_id = '${f.tenantId}' and NEW.action = 'resource.skill.adopt' and NEW.outcome = 'succeeded' then raise exception 'isolated adoption audit failure'; end if;
      return NEW; end; $$; create trigger ${name} before insert on haas.audit_events for each row execute function haas.${name}();`)
    try {
      await expect(f.adopt(f.hansenToken, command)).rejects.toThrow()
      expect(await readFile(join(f.hansenCell.directory, 'skills', input.skillId, 'sample.bin'))).toEqual(f.binary)
      expect(await owner`select * from haas.command_receipts where tenant_id = ${f.tenantId} and idempotency_key = ${command.key}`).toEqual([])
    } finally { await owner.unsafe(`drop trigger ${name} on haas.audit_events; drop function haas.${name}();`) }
    const count = f.calls.filter(call => call.operation === 'skill.adopt.write').length
    await expect(f.adopt(f.hansenToken, command)).resolves.toMatchObject({ replayed: false, data: { runtimeGrant: false } })
    await expect(f.adopt(f.hansenToken, command)).resolves.toMatchObject({ replayed: true })
    expect(f.calls.filter(call => call.operation === 'skill.adopt.write')).toHaveLength(count)
  })

  it('refuses known publication IDs from another tenant and replay after target drift without repair', async () => {
    const f = await adoptionFixture(), other = await fixture(), command = context()
    await expect(other.publications.adopt(other.admin, f.submitted.publicationId, f.selected(), context(), signal())).rejects.toMatchObject({ status: 404 })
    await f.adopt(f.hansenToken, command)
    const file = join(f.hansenCell.directory, 'skills', input.skillId, 'sample.bin')
    await writeFile(file, 'External edited bytes')
    await expect(f.adopt(f.hansenToken, command)).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('External edited bytes')
    await expect(f.adopt(f.alexToken)).resolves.toMatchObject({ data: { runtimeGrant: false } })
  })

  it('aborts a real HTTP Skill adoption when its browser client disconnects, releasing staged target bytes', async () => {
    const f = await adoptionFixture(), reservation = reservePort(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const address = reservation.address(); if (!address || typeof address === 'string') throw Error('Missing HTTP test port')
    await new Promise<void>(resolve => reservation.close(() => resolve()))
    const origin = `http://127.0.0.1:${address.port}`, server = createEnterpriseServer({ identity: f.identity, skillPublications: f.service, publicOrigin: origin, loopbackDevelopment: true })
    cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))
    await new Promise<void>(resolve => server.listen(address.port, '127.0.0.1', resolve))
    const entered = deferred(), release = deferred(), abort = new AbortController()
    f.hooks.afterWrite = async () => { entered.done(); await release.promise }
    const response = fetch(origin + '/haas/v1/catalog/skills/' + f.submitted.publicationId + '/adoption', {
      method: 'POST', headers: { origin, 'content-type': 'application/json', 'idempotency-key': randomUUID(), cookie: `paimind_haas_session=${f.hansenToken}` },
      body: JSON.stringify(f.selected()), signal: abort.signal,
    }).then(value => ({ value }), error => ({ error }))
    await entered.promise; abort.abort(); release.done()
    expect(await response).toHaveProperty('error')
    await vi.waitFor(async () => expect(await readdir(join(f.hansenCell.directory, 'state', 'publication-imports'))).toEqual([]), { timeout: 6000 })
    await expect(readFile(join(f.hansenCell.directory, 'skills', input.skillId, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(f.calls.some(call => call.member === 'hansen' && call.operation === 'skill.adopt.commit')).toBe(false)
  })
  it('audits a missing native adoption bridge without committing a success receipt or touching target files', async () => {
    const f = await adoptionFixture(), command = context(), count = f.calls.length
    await expect(f.publications.adopt(f.hansenToken, f.submitted.publicationId, f.selected(), command, signal()))
      .rejects.toMatchObject({ status: 503, code: 'skill-adoption-unavailable' })
    expect(f.calls).toHaveLength(count)
    expect(await owner`select outcome, reason from haas.audit_events where tenant_id = ${f.tenantId} and action = 'resource.skill.adoption.transfer'`)
      .toEqual([{ outcome: 'denied', reason: 'skill-adoption-unavailable' }])
    expect(await owner`select * from haas.command_receipts where tenant_id = ${f.tenantId} and idempotency_key = ${command.key}`).toEqual([])
  })

  it('seals every byte before submitting and replays the same receipt without re-reading an edited or deleted source', async () => {
    const f = await fixture(), command = context(), original = await f.submit(command)
    expect(original.data).toMatchObject({ name: input.skillId, digest: input.expectedDigest, archiveDigest: sha(f.bytes), status: 'pending', runtimeGrant: false })
    expect(await f.stored()).toEqual(f.bytes); expect((await f.rows())[0]).toMatchObject({ status: 'sealed', next_offset: f.bytes.length })
    f.source.mockRejectedValue(new Error('Original editable source removed'))
    const replay = await f.submit({ ...command, requestId: randomUUID() })
    expect(replay).toEqual({ ...original, replayed: true }); expect(f.source).toHaveBeenCalledOnce()
    expect(await f.publications.available(f.admin, randomUUID())).toEqual([])
    const events = await owner`select outcome from haas.audit_events where tenant_id = ${f.tenantId} and action = 'resource.skill.submit'`
    expect(events).toEqual([{ outcome: 'succeeded' }])
  })

  it.each(['hansen', 'alex', 'anonymous'] as const)('rejects %s submission before capture, including invented identity fields', async who => {
    const f = await fixture(), token = who === 'hansen' ? f.hansenToken : who === 'alex' ? f.alexToken : undefined
    await expect(f.publications.submit(token, input, context(), signal())).rejects.toMatchObject({ status: who === 'anonymous' ? 401 : 403 })
    await expect(f.submit(context(), f.admin, { ...input, userId: f.hansen.userId })).rejects.toMatchObject({ status: 400 })
    expect(f.source).not.toHaveBeenCalled(); expect(await f.rows()).toEqual([])
  })

  it.each(['changed-input', 'expired-receipt', 'logged-out'] as const)('does not use a successful capture to bypass %s', async mode => {
    const f = await fixture(), command = context(); await f.submit(command)
    if (mode === 'expired-receipt') await owner`update haas.command_receipts set created_at = clock_timestamp() - interval '25 hours'
      where tenant_id = ${f.tenantId} and idempotency_key = ${command.key}`
    if (mode === 'logged-out') await f.identity.logout(f.admin, {}, context())
    await expect(f.submit(command, f.admin, mode === 'changed-input' ? { ...input, reason: '另一个不同审核原因' } : input))
      .rejects.toMatchObject({ status: mode === 'logged-out' ? 401 : 409 })
    expect(f.source).toHaveBeenCalledOnce(); expect(await f.stored()).toEqual(f.bytes)
  })

  it.each(['source-failure', 'cancel', 'wrong-hash', 'missing-final', 'bad-offset', 'oversized-chunk', 'wrong-source'] as const)(
    'rejects %s and clears only its incomplete bytes; exact retry succeeds', async mode => {
      const f = await fixture(), command = context(), controller = new AbortController()
      f.source.mockImplementationOnce(async (...args) => {
        const sink = args[4], abort = args[5]
        if (mode === 'bad-offset') await sink(f.bytes.subarray(0, 10), 1, abort)
        if (mode === 'oversized-chunk') await sink(f.bytes, 0, abort)
        if (['wrong-hash', 'wrong-source'].includes(mode)) {
          const descriptor = await f.transfer(...args)
          return { ...descriptor, ...(mode === 'wrong-hash' ? { archiveDigest: 'sha256:' + 'b'.repeat(64) } : { name: 'other-skill' }) }
        }
        await sink(f.bytes.subarray(0, SKILL_PUBLICATION_CHUNK_BYTES), 0, abort)
        if (mode === 'cancel') controller.abort()
        if (mode === 'source-failure') throw new Error('Source capture unavailable')
        return f.descriptor
      })
      await expect(f.submit(command, f.admin, input, controller.signal)).rejects.toThrow()
      expect(await f.stored()).toEqual(Buffer.alloc(0)); expect((await f.rows())[0]).toMatchObject({ status: 'staging', next_offset: 0 })
      expect(await f.publications.list(f.admin, randomUUID())).toEqual([])
      await expect(f.submit(command, f.admin, { ...input, reason: '冲突请求不可复用' })).rejects.toMatchObject({ code: 'idempotency-conflict' })
      const result = await f.submit(command); expect(result.replayed).toBe(false); expect(await f.stored()).toEqual(f.bytes)
    })

  it('allows member/revocation operations while source capture waits and reauthorizes before publication commit', async () => {
    const f = await fixture(), entered = deferred(), release = deferred()
    f.source.mockImplementationOnce(async (...args) => { entered.done(); await release.promise; return f.transfer(...args) })
    const result = f.submit().then(value => ({ value }), error => ({ error }))
    await entered.promise
    try {
      // This would time out if the large export held Identity's tenant lock.
      await expect(f.identity.renameMember(f.admin, f.alex.userId, { displayName: 'Alex Chen', expectedDisplayName: 'Alex' }, context()))
        .resolves.toMatchObject({ data: { displayName: 'Alex Chen' } })
      await f.identity.logout(f.admin, {}, context())
    } finally { release.done() }
    expect(await result).toMatchObject({ error: { status: 401 } })
    expect(await f.stored()).toEqual(f.bytes)
    expect((await f.rows())[0]).toMatchObject({ status: 'sealed' })
    expect(await owner`select * from haas.skill_publications where tenant_id = ${f.tenantId}`).toEqual([])
  })

  it('rejects concurrent same-request capture and fences stale generations without deleting the replacement', async () => {
    const f = await fixture(), entered = deferred(), release = deferred(), command = context()
    f.source.mockImplementationOnce(async (...args) => { entered.done(); await release.promise; return f.transfer(...args) })
    const old = f.submit(command).then(value => ({ value }), error => ({ error }))
    await entered.promise
    try {
      await expect(f.submit(command)).rejects.toMatchObject({ code: 'skill-capture-in-progress' })
      await owner`update haas.skill_artifacts set capture_deadline = clock_timestamp() - interval '1 second' where tenant_id = ${f.tenantId}`
      const replacement = await f.submit(command)
      expect(replacement.data.status).toBe('pending')
    } finally { release.done() }
    expect(await old).toMatchObject({ error: { code: 'skill-capture-changed' } })
    expect(await f.stored()).toEqual(f.bytes); expect(await f.rows()).toHaveLength(1)
    expect(await f.submit(command)).toMatchObject({ replayed: true })
  })

  it('retains a sealed candidate after failed success audit, then commits exactly once without recapturing source', async () => {
    const f = await fixture(), command = context(), name = 'skill_audit_' + randomUUID().replaceAll('-', '')
    await owner.unsafe(`create function haas.${name}() returns trigger language plpgsql as $$ begin
      if NEW.tenant_id = '${f.tenantId}' and NEW.action = 'resource.skill.submit' and NEW.outcome = 'succeeded' then raise exception 'isolated audit failure'; end if;
      return NEW; end; $$; create trigger ${name} before insert on haas.audit_events for each row execute function haas.${name}();`)
    try {
      await expect(f.submit(command)).rejects.toThrow()
      expect(await f.stored()).toEqual(f.bytes); expect((await f.rows())[0].status).toBe('sealed')
      expect(await owner`select * from haas.skill_publications where tenant_id = ${f.tenantId}`).toEqual([])
      expect(await owner`select * from haas.command_receipts where tenant_id = ${f.tenantId} and idempotency_key = ${command.key}`).toEqual([])
    } finally { await owner.unsafe(`drop trigger ${name} on haas.audit_events; drop function haas.${name}();`) }
    f.source.mockRejectedValue(new Error('Source edited after sealed capture'))
    await expect(f.submit(command)).resolves.toMatchObject({ replayed: false, data: { status: 'pending' } })
    await expect(f.submit(command)).resolves.toMatchObject({ replayed: true })
    expect(f.source).toHaveBeenCalledOnce()
  })

  it('protects sealed bytes and publication identity at the database boundary, including owner attempts', async () => {
    const f = await fixture(), result = await f.submit(), id = result.data.artifactId
    for (const db of [sql, owner]) {
      await expect(db`delete from haas.skill_artifact_chunks where tenant_id = ${f.tenantId} and artifact_id = ${id}`).rejects.toThrow()
      await expect(db`update haas.skill_artifacts set status = 'staging' where tenant_id = ${f.tenantId} and artifact_id = ${id}`).rejects.toThrow()
      await expect(db`insert into haas.skill_artifact_chunks (tenant_id, artifact_id, chunk_offset, data)
        values (${f.tenantId}, ${id}, ${SKILL_PUBLICATION_CHUNK_BYTES * 4}, ${Buffer.from('x')})`).rejects.toThrow()
      await expect(db`update haas.skill_publications set skill_name = 'replacement' where tenant_id = ${f.tenantId}`).rejects.toThrow()
    }
    await expect(owner`delete from haas.skill_artifacts where tenant_id = ${f.tenantId}`).rejects.toThrow()
    await expect(owner`delete from haas.skill_publications where tenant_id = ${f.tenantId}`).rejects.toThrow()
    await expect(owner`truncate haas.skill_artifact_chunks`).rejects.toThrow()
    expect(await f.stored()).toEqual(f.bytes)
  })

  it.each(['review', 'assignment'] as const)('rolls back %s state and receipt when its success audit fails', async operation => {
    const f = await fixture(), submitted = (await f.submit()).data, id = submitted.publicationId, command = context()
    if (operation === 'assignment') await f.publications.review(f.admin, id,
      { decision: 'publish', expectedRevision: 1, reason: '审核固定测试版本' }, context())
    const expectedRevision = operation === 'review' ? 1 : 2, name = 'skill_governance_' + randomUUID().replaceAll('-', '')
    const action = 'resource.skill.' + operation
    const run = () => operation === 'review' ? f.publications.review(f.admin, id,
      { decision: 'publish', expectedRevision, reason: '审核固定测试版本' }, command) : f.publications.assign(f.admin, id,
      { expectedRevision, subjectKind: 'user', subjectId: f.alex.userId, effect: 'allow', active: true, reason: '分配固定测试版本' }, command)
    await owner.unsafe(`create function haas.${name}() returns trigger language plpgsql as $$ begin
      if NEW.tenant_id = '${f.tenantId}' and NEW.action = '${action}' and NEW.outcome = 'succeeded' then raise exception 'isolated audit failure'; end if;
      return NEW; end; $$; create trigger ${name} before insert on haas.audit_events for each row execute function haas.${name}();`)
    try {
      await expect(run()).rejects.toThrow()
      expect(await f.publications.read(f.admin, id, randomUUID(), true)).toMatchObject({ revision: expectedRevision,
        status: operation === 'review' ? 'pending' : 'published' })
      expect((await f.publications.assignments(f.admin, id, randomUUID())).assignments).toEqual([])
      expect(await owner`select * from haas.command_receipts where tenant_id = ${f.tenantId} and idempotency_key = ${command.key}`).toEqual([])
    } finally { await owner.unsafe(`drop trigger ${name} on haas.audit_events; drop function haas.${name}();`) }
    await expect(run()).resolves.toMatchObject({ replayed: false, data: { revision: expectedRevision + 1 } })
    await expect(run()).resolves.toMatchObject({ replayed: true })
    expect(await f.stored()).toEqual(f.bytes)
  })

  it('binds final commit to the originally normalized input rather than a later-mutated caller object', async () => {
    const f = await fixture(), body = { ...input }, command = context()
    f.source.mockImplementationOnce(async (...args) => { body.reason = '调用方在捕获期间修改原对象'; return f.transfer(...args) })
    expect((await f.submit(command, f.admin, body)).data.submissionReason).toBe(input.reason)
    await expect(f.submit(command, f.admin, input)).resolves.toMatchObject({ replayed: true })
    await expect(f.submit(command, f.admin, body)).rejects.toMatchObject({ code: 'idempotency-conflict' })
  })

  it('rejects disabled assigned members while another assigned member remains available', async () => {
    const f = await fixture(), id = (await f.submit()).data.publicationId
    await f.publications.review(f.admin, id, { decision: 'publish', expectedRevision: 1, reason: '固定版本审核测试' }, context())
    await f.publications.assign(f.admin, id, { expectedRevision: 2, subjectKind: 'all', effect: 'allow', active: true, reason: '全员明确分配测试' }, context())
    await f.identity.setMemberStatus(f.admin, f.hansen.userId, { status: 'disabled', reason: '成员停用隔离测试' }, context())
    await expect(f.publications.read(f.hansenToken, id, randomUUID(), false)).rejects.toMatchObject({ status: 401 })
    expect(await f.publications.read(f.alexToken, id, randomUUID(), false)).toMatchObject({ publicationId: id, access: 'all-allow' })
  })

  it('keeps rejected reviews terminal and never makes them available through assignments', async () => {
    const f = await fixture(), id = (await f.submit()).data.publicationId
    await f.publications.review(f.admin, id, { decision: 'reject', expectedRevision: 1, reason: '拒绝不合适的提交' }, context())
    await expect(f.publications.review(f.admin, id, { decision: 'publish', expectedRevision: 2, reason: '拒绝后不能重新批准' }, context()))
      .rejects.toMatchObject({ code: 'invalid-review-transition' })
    await expect(f.publications.assign(f.admin, id, { expectedRevision: 2, subjectKind: 'all', effect: 'allow', active: true, reason: '拒绝后不能分配' }, context()))
      .rejects.toMatchObject({ code: 'publication-not-published' })
    expect(await f.publications.available(f.admin, randomUUID())).toEqual([])
  })

  it.each(['missing', 'short-middle', 'unsealed-publication', 'insert-sealed'] as const)('DB rejects %s independently of the source consumer', async mode => {
    const f = await fixture(), entered = deferred(), release = deferred()
    f.source.mockImplementationOnce(async () => { entered.done(); await release.promise; throw Error('test stops reserved source') })
    const outcome = f.submit().catch(error => error)
    await entered.promise
    try {
      const [row] = await f.rows()
      if (mode === 'insert-sealed') {
        await expect(owner`insert into haas.skill_artifacts ${owner({ ...row, artifact_id: randomUUID(), submission_key: randomUUID(), status: 'sealed',
          next_offset: 1, archive_digest: sha(Buffer.from('x')), archive_bytes: 1, expanded_bytes: 1, entry_count: 1, sealed_at: new Date() })}`).rejects.toThrow()
      } else if (mode === 'unsealed-publication') {
        await expect(owner`insert into haas.skill_publications (tenant_id, publication_id, source_user_id, artifact_id, skill_name, package_digest, submission_reason)
          values (${f.tenantId}, ${randomUUID()}, ${f.adminId}, ${row.artifact_id}, ${input.skillId}, ${input.expectedDigest}, 'No sealed archive')`).rejects.toThrow()
      } else {
        if (mode === 'short-middle') await owner`insert into haas.skill_artifact_chunks (tenant_id, artifact_id, chunk_offset, data)
          values (${f.tenantId}, ${row.artifact_id}, 0, ${Buffer.from('x')})`
        await expect(owner`update haas.skill_artifacts set status = 'sealed', next_offset = ${SKILL_PUBLICATION_CHUNK_BYTES + 1},
          archive_digest = ${sha(Buffer.from('x'))}, archive_bytes = ${SKILL_PUBLICATION_CHUNK_BYTES + 1}, expanded_bytes = 1, entry_count = 1, sealed_at = clock_timestamp()
          where tenant_id = ${f.tenantId}`).rejects.toThrow()
      }
    } finally { release.done(); await outcome }
    expect(await f.stored()).toEqual(Buffer.alloc(0))
  })

  it('reserves maximum archive capacity and explicitly refuses excess without truncating captures', async () => {
    const f = await fixture(), entered = deferred(), release = deferred()
    f.source.mockImplementationOnce(async () => { entered.done(); await release.promise; throw Error('test closes candidate') })
    const outcome = f.submit().catch(error => error)
    await entered.promise
    try {
      const [row] = await f.rows()
      for (let index = 0; index < 8; index += 1) await owner`insert into haas.skill_artifacts ${owner({ ...row, artifact_id: randomUUID(), submission_key: randomUUID(), capture_generation: randomUUID() })}`
      await expect(f.submit()).rejects.toMatchObject({ code: 'skill-archive-capacity' })
      expect(await f.rows()).toHaveLength(9); expect(f.source).toHaveBeenCalledOnce()
    } finally { release.done(); await outcome }
  })

  it('applies user/group/all assignment and explicit denial without granting native runtime access', async () => {
    const f = await fixture(), submitted = (await f.submit()).data, id = submitted.publicationId
    const review = (decision: string, expectedRevision: number) => f.publications.review(f.admin, id, { decision, expectedRevision, reason: '明确审核测试原因' }, context())
    await expect(f.publications.review(f.hansenToken, id, { decision: 'publish', expectedRevision: 1, reason: '成员不能审核' }, context())).rejects.toMatchObject({ status: 403 })
    await expect(f.publications.read(f.alexToken, id, randomUUID(), false)).rejects.toMatchObject({ status: 404 })
    let current = (await review('publish', 1)).data
    expect(await f.publications.available(f.admin, randomUUID())).toEqual([])
    const assign = async (subjectKind: 'user' | 'group' | 'all', subjectId?: string, effect = 'allow', active = true) => {
      current = (await f.publications.assign(f.admin, id, { expectedRevision: current.revision, subjectKind,
        ...(subjectId ? { subjectId } : {}), effect, active, reason: '明确成员分配测试' }, context())).data
    }
    await assign('user', f.hansen.userId)
    expect(await f.publications.available(f.hansenToken, randomUUID())).toMatchObject([{ publicationId: id, access: 'user-allow', runtimeGrant: false }])
    expect(await f.publications.available(f.alexToken, randomUUID())).toEqual([])
    const emptyGroup = (await f.identity.createGroup(f.admin, { name: 'Customer Team' }, context())).data
    const group = (await f.identity.updateGroup(f.admin, emptyGroup.groupId,
      { name: emptyGroup.name, memberIds: [f.alex.userId], expectedRevision: emptyGroup.revision }, context())).data
    await assign('group', group.groupId)
    expect(await f.publications.available(f.alexToken, randomUUID())).toMatchObject([{ access: 'group-allow' }])
    await assign('all'); await assign('user', f.alex.userId, 'deny')
    await expect(f.publications.read(f.alexToken, id, randomUUID(), false)).rejects.toMatchObject({ status: 404 })
    await assign('user', f.alex.userId, 'deny', false)
    expect(await f.publications.read(f.alexToken, id, randomUUID(), false)).toMatchObject({ access: 'group-allow' })
    await f.identity.setGroupStatus(f.admin, group.groupId, { status: 'archived', expectedRevision: group.revision, reason: '撤销组可用性测试' }, context())
    expect(await f.publications.read(f.alexToken, id, randomUUID(), false)).toMatchObject({ access: 'all-allow' })
    await assign('all', undefined, 'allow', false)
    expect(await f.publications.available(f.alexToken, randomUUID())).toEqual([])
    await review('withdraw', current.revision)
    expect(await f.publications.available(f.hansenToken, randomUUID())).toEqual([])
    expect(await f.stored()).toEqual(f.bytes)
  })

  it('keeps known publication IDs and assignment targets tenant-scoped with current role checks', async () => {
    const f = await fixture(), other = await fixture(), publication = (await f.submit()).data
    await expect(other.publications.read(other.admin, publication.publicationId, randomUUID(), true)).rejects.toMatchObject({ status: 404 })
    await expect(f.publications.list(f.alexToken, randomUUID())).rejects.toMatchObject({ status: 403 })
    await f.publications.review(f.admin, publication.publicationId, { decision: 'publish', expectedRevision: 1, reason: '合法审核原因' }, context())
    await expect(f.publications.assign(f.admin, publication.publicationId, { expectedRevision: 2, subjectKind: 'user', subjectId: other.hansen.userId,
      effect: 'allow', active: true, reason: '跨租户分配拒绝' }, context())).rejects.toMatchObject({ status: 404 })
    await expect(f.publications.review(f.admin, publication.publicationId, { decision: 'reject', expectedRevision: 1, reason: '旧版本审核拒绝' }, context()))
      .rejects.toMatchObject({ code: 'publication-changed' })
    expect((await f.publications.assignments(f.admin, publication.publicationId, randomUUID())).assignments).toEqual([])
  })

  it('exposes only explicit authenticated metadata commands over the real HTTP boundary', async () => {
    const f = await fixture(), reservation = reservePort(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const address = reservation.address(); if (!address || typeof address === 'string') throw Error('Missing test port')
    await new Promise<void>(resolve => reservation.close(() => resolve()))
    const origin = `http://127.0.0.1:${address.port}`
    const server = createEnterpriseServer({ identity: f.identity, skillPublications: f.publications, publicOrigin: origin, loopbackDevelopment: true })
    cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))
    await new Promise<void>(resolve => server.listen(address.port, '127.0.0.1', resolve))
    const headers = { origin, 'content-type': 'application/json', 'idempotency-key': randomUUID(), cookie: `paimind_haas_session=${f.admin}` }
    const response = await fetch(origin + '/haas/v1/admin/skill-publications', { method: 'POST', headers, body: JSON.stringify(input) })
    expect(response.status).toBe(201)
    const payload = await response.json() as { data: { publicationId: string } }
    const list = await fetch(origin + '/haas/v1/admin/skill-publications', { headers })
    expect(list.status).toBe(200); expect(JSON.stringify(await list.json())).not.toContain('data:application')
    const denied = await fetch(origin + '/haas/v1/admin/skill-publications/' + payload.data.publicationId,
      { headers: { ...headers, cookie: `paimind_haas_session=${f.alexToken}` } })
    expect(denied.status).toBe(403)
    expect((await fetch(origin + '/haas/v1/catalog/skills', { headers })).status).toBe(200)
    expect((await fetch(origin + '/haas/v1/admin/skill-publications?userId=' + f.alex.userId, { headers })).status).toBe(400)
  })

  it('stores the original complete Skill through real gateway/private HTTP/socket and PG identity without new runtime ownership', async () => {
    const f = await fixture(), directory = await realpath(await mkdtemp(join(tmpdir(), 'paimind-skill-pg-')))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const effects: Array<() => void | Promise<void>> = []
    const ctx = { reflect: { provide() {} }, webServer: { register: () => () => {} },
      effect(install: () => void | (() => void | Promise<void>)) { const dispose = install(); if (dispose) effects.push(dispose) } }
    const sourceOwner = new PaimindSkillInstallerService(ctx as never, { skillRoot: join(directory, 'skills'), stateRoot: join(directory, 'state') })
    cleanup.push(async () => { for (const effect of effects.reverse()) await effect() })
    await sourceOwner.saveSkillSource({ name: input.skillId, description: 'Morgan customer notes', instructions: 'Use only provided customer notes.' })
    await mkdir(join(directory, 'skills', input.skillId, 'empty'))
    const binary = randomBytes(320000); await writeFile(join(directory, 'skills', input.skillId, 'sample.bin'), binary)
    const pkg = await sourceOwner.getSkillPackage({ skillId: input.skillId })
    const broker = await createNativeControlBroker(); cleanup.push(() => broker.close())
    const peer = createNativeControlPeer(createConnection(broker.path), { handle: (operation, data, abort) =>
      handleNativeControl({ get: name => name === 'paimindSkillInstaller' ? sourceOwner : undefined }, operation, data, abort) })
    cleanup.push(() => peer.close()); await vi.waitFor(() => expect(broker.ready).toBe(true))
    const key = randomBytes(32).toString('hex'), ingress = createNativeIngress({ token: key,
      control: (operation: string, data: object, abort: AbortSignal) => broker.request(operation, data, abort) })
    cleanup.push(() => ingress.close()); await new Promise<void>(resolve => ingress.server.listen(0, '127.0.0.1', resolve))
    const address = ingress.server.address(); if (!address || typeof address === 'string') throw Error('Missing private test port')
    const origin = `http://127.0.0.1:${address.port}`, transport = new CellTransport(origin, key), cellId = randomUUID(), generation = randomUUID()
    cleanup.push(() => transport.destroy())
    // A declared local cell-pin fixture, not a final Linux Worker. Current login
    // resolution and operation authorization are the production PG Identity.
    const gateway = new NativeGateway({ publicOrigin: 'http://127.0.0.1:62345', transports: new Map([[origin, transport]]),
      resolve: (token, requestId) => f.identity.withRuntimeIdentity(token, requestId, principal => Promise.resolve({
        cellId, tenantId: principal.account.tenantId, userId: principal.account.userId, role: principal.account.role,
        revision: generation, origin, validForMs: 10000, transport: 'private-cell' as const })),
      authorize: (token, requestId, grant, request, verify) => f.identity.authorizeRuntimeOperation(token, requestId, grant, request, verify) })
    cleanup.push(() => gateway.close())
    const service = new SkillPublications(sql, f.identity, (...args) => gateway.exportSkillPublication(...args))
    const result = await service.submit(f.admin, { ...input, expectedDigest: pkg.digest }, context(), signal())
    const archive = await f.stored(), files = unzipSync(archive)
    expect(result.data).toMatchObject({ digest: pkg.digest, archiveDigest: sha(archive), runtimeGrant: false, status: 'pending' })
    expect(Buffer.from(files['sample.bin']!)).toEqual(binary); expect(files['empty/']).toBeDefined(); expect(files['SKILL.md']).toBeDefined()
    expect(await sourceOwner.getSkillPackage({ skillId: input.skillId })).toEqual(pkg)
  })
})
