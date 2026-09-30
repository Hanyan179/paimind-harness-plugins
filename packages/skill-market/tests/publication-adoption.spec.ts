// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PaimindSkillInstallerService } from '../src/installer.js'
import { transferSkillPublication, transferSkillPublicationAdoption, readSkillPublicationAdoptionInput,
  SKILL_PUBLICATION_CHUNK_BYTES, SKILL_PUBLICATION_EXPORT_TTL_MS, type SkillPublicationAdoptionTransfer } from '../src/publication.js'
import { PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS } from '../src/remote.js'

const cleanups: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => { vi.useRealTimers(); for (const dispose of cleanups.splice(0).reverse()) await dispose() })
const signal = () => new AbortController().signal
async function owner(member: string) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'paimind-skill-adopt-')))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const effects: Array<() => void | Promise<void>> = [], systemNames: string[] = []
  const session = { id: member.toLowerCase(), header: { agentPreset: 'standard' } }, agentSkills = new Map<string, readonly string[]>()
  const providers = new Map<string, unknown>()
  const service = new PaimindSkillInstallerService({ reflect: { provide() {} }, webServer: { register: () => () => {} },
    sessions: { get: (id: string) => id === session.id ? session : undefined },
    get: (name: string) => providers.get(name) ?? (name === 'paimindAgentProfiles' && agentSkills.size ? { businessSkillNamesForPreset: async (preset: string) => agentSkills.get(preset) } : undefined),
    skills: { list: async () => systemNames.map(name => ({ name, description: name, source: 'bundled' })), register: () => () => {} },
    effect(install: () => void | (() => void | Promise<void>)) { const dispose = install(); if (dispose) effects.push(dispose) },
  } as never, { skillRoot: join(directory, 'skills'), stateRoot: join(directory, 'state') })
  const dispose = async () => { for (const effect of effects.splice(0).reverse()) await effect() }; cleanups.push(dispose)
  const transport: SkillPublicationAdoptionTransfer = {
    begin: (input, abort) => service.beginPublicationAdoption(input, abort), write: (input, abort) => service.writePublicationAdoption(input, abort),
    commit: (input, abort) => service.commitPublicationAdoption(input, abort), release: input => service.releasePublicationAdoption(input),
  }
  return { member, service, directory, transport, dispose, systemNames, session, agentSkills, providers }
}
async function fixture(largeContent = false) {
  const morgan = await owner('Morgan'), hansen = await owner('Hansen'), alex = await owner('Alex')
  await morgan.service.saveSkillSource({ name: 'customer-notes', description: 'Morgan enterprise method', instructions: 'Use only confirmed customer notes.' })
  const sourceRoot = join(morgan.directory, 'skills', 'customer-notes')
  await mkdir(join(sourceRoot, 'empty')); await mkdir(join(sourceRoot, 'references')); await mkdir(join(sourceRoot, '.codex-plugin'))
  await writeFile(join(sourceRoot, 'references', 'SKILL.md'), 'Reference file only, not a second registered Skill')
  await writeFile(join(sourceRoot, '.codex-plugin', 'plugin.json'), '{"inert":"reference only"}')
  if (largeContent) await writeFile(join(sourceRoot, 'empty.txt'), '')
  const binary = Buffer.alloc(largeContent ? 2 * 1024 ** 2 + 17 : SKILL_PUBLICATION_CHUNK_BYTES * 3 + 17, 121)
  await writeFile(join(sourceRoot, 'example.bin'), binary)
  const pkg = await morgan.service.getSkillPackage({ skillId: 'customer-notes' }), chunks: Buffer[] = []
  const exported = await transferSkillPublication({ skillId: pkg.skillId, expectedDigest: pkg.digest }, {
    begin: (input, abort) => morgan.service.beginPublicationExport(input, abort), read: (input, abort) => morgan.service.readPublicationExport(input, abort),
    release: input => morgan.service.releasePublicationExport(input),
  }, async bytes => { chunks.push(Buffer.from(bytes)) }, signal())
  const bytes = Buffer.concat(chunks), input = readSkillPublicationAdoptionInput({ tenantId: 'enterprise-test', publicationId: randomUUID(), sourceUserId: randomUUID(),
    name: exported.name, packageDigest: exported.packageDigest, archiveDigest: exported.archiveDigest,
    archiveBytes: exported.archiveBytes, expandedBytes: exported.expandedBytes, entryCount: exported.entryCount })
  const read = vi.fn(async (offset: number) => bytes.subarray(offset, offset + SKILL_PUBLICATION_CHUNK_BYTES))
  const adopt = (target = hansen, transport = target.transport, abort = signal()) => transferSkillPublicationAdoption(input, transport, read, abort)
  return { morgan, hansen, alex, input, bytes, binary, sourceRoot, read, adopt }
}

async function chooseIntent(f: Awaited<ReturnType<typeof fixture>>, direct = false) {
  const previous = f.hansen.providers.get('paimindEnterpriseSkillEligibility')
  f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read: async () => [f.input.publicationId] })
  try {
    const policy = await f.hansen.service.getUserSkillPolicy()
    const chosen = await f.hansen.service.setAdoptedSkillPreference({ reference: f.input, expectedRevision: policy.revision, field: 'enabled', value: true })
    if (direct) await f.hansen.service.setAdoptedSkillPreference({ reference: f.input, expectedRevision: chosen.revision, field: 'direct', value: true })
  } finally {
    if (previous) f.hansen.providers.set('paimindEnterpriseSkillEligibility', previous)
    else f.hansen.providers.delete('paimindEnterpriseSkillEligibility')
  }
}

describe('original Skill owner immutable adoption, without runtime grant or Browser E2E', () => {
  it('does not enable an adopted enterprise Skill merely because its current assignment becomes available', async () => {
    const f = await fixture(); await f.adopt()
    f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read: async () => [f.input.publicationId] })
    expect((await f.hansen.service.listInstalled()).items[0]).toMatchObject({ publicationEligible: true })
    expect((await f.hansen.service.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([])
    expect((await f.hansen.service.getUserSkillPolicy()).directBusinessSkillNames).toEqual([])
  })
  it('writes one explicit original-owner preference, preserves unrelated legacy choices, and enables no other scope or member', async () => {
    const f = await fixture(); await f.adopt(); await f.adopt(f.alex)
    for (const target of [f.hansen, f.alex]) target.providers.set('paimindEnterpriseSkillEligibility', { read: async () => [f.input.publicationId] })
    const path = join(f.hansen.directory, 'state', 'user-skill-policy.json')
    const legacy = { schema: 'paimind.user-skill-policy-storage/v3', revision: 7, enabledOptionalSystemSkillNames: [],
      disabledBusinessSkillNames: ['unavailable-other'], directBusinessSkillNames: ['unavailable-other'] }
    await writeFile(path, JSON.stringify(legacy)); const original = await readFile(path)
    expect((await f.hansen.service.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([])
    expect(await readFile(path)).toEqual(original) // reading does not migrate persisted data
    const descriptor = PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS.find(row => row.method === 'setAdoptedSkillPreference')!
    const input = descriptor.parameters[0]!.codec.schema.parse({ reference: f.input, expectedRevision: 7, field: 'enabled', value: true })
    expect(descriptor.result.schema.parse(await f.hansen.service.setAdoptedSkillPreference(input as never)))
      .toMatchObject({ reference: f.input, revision: 8, enabled: true, direct: false, runtimeGrant: false })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ ...legacy, schema: 'paimind.user-skill-policy-storage/v4', revision: 8,
      enabledAdoptedSkillIds: [f.input.publicationId] })
    expect((await f.hansen.service.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([f.input.name])
    expect((await f.hansen.service.getUserSkillPolicy()).directBusinessSkillNames).toEqual([])
    expect((await f.alex.service.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([])
    expect((await f.hansen.service.listInstalled()).items[0]).toMatchObject({ publicationPreference: { revision: 8, enabled: true, direct: false } })
    await f.hansen.service.setAdoptedSkillPreference({ reference: f.input, expectedRevision: 8, field: 'direct', value: true })
    expect((await f.hansen.service.getUserSkillPolicy()).directBusinessSkillNames).toEqual([f.input.name])
    expect(await f.hansen.service.getSelectedPublicationReferences({ nativeSessionId: f.hansen.session.id, presetId: 'standard' })).toEqual([f.input])
  })
  it('can withdraw local intent after revocation or provider loss without deleting adopted files or retained usage dependencies', async () => {
    const f = await fixture(); await f.adopt()
    f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read: async () => [f.input.publicationId] })
    await f.hansen.service.setAdoptedSkillPreference({ reference: f.input, expectedRevision: 0, field: 'enabled', value: true })
    await f.hansen.service.setAdoptedSkillPreference({ reference: f.input, expectedRevision: 1, field: 'direct', value: true })
    f.hansen.providers.delete('paimindEnterpriseSkillEligibility')
    expect((await f.hansen.service.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([])
    expect((await f.hansen.service.listInstalled()).items[0]).toMatchObject({ publicationEligible: false, publicationPreference: { enabled: true, direct: true } })
    expect(await f.hansen.service.setAdoptedSkillPreference({ reference: f.input, expectedRevision: 2, field: 'enabled', value: false }))
      .toMatchObject({ enabled: false, direct: false, revision: 3, runtimeGrant: false })
    expect(await readFile(join(f.hansen.directory, 'skills', f.input.name, 'example.bin'))).toEqual(f.binary)
    expect(await f.hansen.service.getSelectedPublicationReferences({ nativeSessionId: f.hansen.session.id, presetId: 'standard', requiredPublicationIds: [f.input.publicationId] })).toEqual([f.input])
  })
  it('rejects forged references, system controls, stale revisions and default scope before explicit enable without changing preferences', async () => {
    const f = await fixture(); await f.adopt()
    f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read: async () => [f.input.publicationId] })
    const input = { reference: f.input, expectedRevision: 0, field: 'enabled' as const, value: true }
    for (const changed of [{ reference: { ...f.input, publicationId: randomUUID() } }, { reference: { ...f.input, tenantId: 'foreign' } },
      { expectedRevision: 1 }, { field: 'direct' }, { field: 'system' }, { role: 'admin' }, { enabledOptionalSystemSkillNames: ['genui'] }, { value: 'true' }]) {
      await expect(f.hansen.service.setAdoptedSkillPreference({ ...input, ...changed } as never)).rejects.toThrow()
    }
    await expect(readFile(join(f.hansen.directory, 'state', 'user-skill-policy.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(f.morgan.service.setAdoptedSkillPreference(input)).rejects.toThrow()
  })
  it('serializes competing preference writes against the same optimistic revision', async () => {
    const f = await fixture(); await f.adopt()
    f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read: async () => [f.input.publicationId] })
    const input = { reference: f.input, expectedRevision: 0, field: 'enabled' as const, value: true }
    const results = await Promise.allSettled([f.hansen.service.setAdoptedSkillPreference(input), f.hansen.service.setAdoptedSkillPreference(input)])
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect((await f.hansen.service.getUserSkillPolicy()).revision).toBe(1)
  })
  it('rejects revocation during final preference authorization without committing intent', async () => {
    const f = await fixture(); await f.adopt(); let calls = 0
    f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read: async () => ++calls === 1 ? [f.input.publicationId] : [] })
    await expect(f.hansen.service.setAdoptedSkillPreference({ reference: f.input, expectedRevision: 0, field: 'enabled', value: true })).rejects.toThrow('分配不可用')
    await expect(readFile(join(f.hansen.directory, 'state', 'user-skill-policy.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('bounds queued preference writes and cancels a pending authority read on owner disposal', async () => {
    const f = await fixture(); await f.adopt(); let entered = false
    f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read: () => { entered = true; return new Promise(() => {}) } })
    const input = { reference: f.input, expectedRevision: 0, field: 'enabled' as const, value: true }
    const outcomes = Promise.allSettled([f.hansen.service.setAdoptedSkillPreference(input), f.hansen.service.setAdoptedSkillPreference(input)])
    await vi.waitFor(() => expect(entered).toBe(true))
    await expect(f.hansen.service.setAdoptedSkillPreference(input)).rejects.toThrow('正在保存')
    await f.hansen.dispose(); expect((await outcomes).map(result => result.status)).toEqual(['rejected', 'rejected'])
    await expect(readFile(join(f.hansen.directory, 'state', 'user-skill-policy.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('reads every byte of an adopted attachment larger than the editor limit through the original strict readonly contract', async () => {
    const f = await fixture(true); await f.adopt()
    const authority = vi.fn(async () => [f.input.publicationId])
    f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read: authority })
    const descriptor = PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS.find(row => row.method === 'readAdoptedSkillContent')!
    const before = await readFile(join(f.hansen.directory, 'skills', f.input.name, '.paimind-install.json'))
    const read = async (selection: object) => {
      const request = descriptor.parameters[0]!.codec.schema.parse({ reference: f.input, ...selection })
      return descriptor.result.schema.parse(await f.hansen.service.readAdoptedSkillContent(request as never))
    }
    const root = await read({ kind: 'directory', path: '' })
    expect(root).toMatchObject({ reference: f.input, runtimeGrant: false, kind: 'directory', page: { path: '' } })
    if (root.kind !== 'directory') throw Error('wrong page')
    expect(root.page.entries.map(row => row.path)).toContain('empty')
    expect(await read({ kind: 'directory', path: 'empty' })).toMatchObject({ page: { entries: [] } })
    expect(await read({ kind: 'file', path: 'empty.txt', offset: 0 })).toMatchObject({ data: '', size: 0, nextOffset: null })
    const parts: Buffer[] = []
    for (let offset: number | null = 0; offset !== null;) {
      const page = await read({ kind: 'file', path: 'example.bin', offset })
      if (page.kind !== 'file') throw Error('wrong page')
      const bytes = Buffer.from(page.data, 'base64'); expect(bytes.length).toBeLessThanOrEqual(32768); parts.push(bytes); offset = page.nextOffset
    }
    expect(Buffer.concat(parts)).toEqual(f.binary); expect(authority.mock.calls.length).toBeGreaterThan(130)
    expect(await readFile(join(f.hansen.directory, 'skills', f.input.name, '.paimind-install.json'))).toEqual(before)
    expect(await readdir(join(f.hansen.directory, 'state', 'publication-exports')).catch(() => [])).toEqual([])
  }, 30_000)

  it('refuses missing or revoked assignment and wrong native versions while another adopted owner continues', async () => {
    const f = await fixture(); await f.adopt(); await f.adopt(f.alex)
    const request = { reference: f.input, kind: 'directory' as const, path: '' }
    await expect(f.hansen.service.readAdoptedSkillContent(request)).rejects.toThrow('资格服务不可用')
    f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read: async () => [] })
    f.alex.providers.set('paimindEnterpriseSkillEligibility', { read: async () => [f.input.publicationId] })
    await expect(f.hansen.service.readAdoptedSkillContent(request)).rejects.toThrow('分配不可用')
    expect(await f.alex.service.readAdoptedSkillContent(request)).toMatchObject({ kind: 'directory' })
    for (const reference of [{ ...f.input, publicationId: randomUUID() }, { ...f.input, tenantId: 'foreign-tenant' }, { ...f.input, packageDigest: 'sha256:' + 'e'.repeat(64) }]) {
      await expect(f.alex.service.readAdoptedSkillContent({ ...request, reference })).rejects.toThrow()
    }
    await expect(f.morgan.service.readAdoptedSkillContent(request)).rejects.toThrow()
  })

  it.each(['revoke-before-return', 'replace-provider', 'change-bytes'] as const)('reauthorizes adopted content before returning: %s', async fault => {
    const f = await fixture(); await f.adopt(); let calls = 0
    f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read: async () => {
      calls += 1
      if (fault === 'revoke-before-return' && calls === 2) return []
      if (fault === 'replace-provider') f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read: async () => [f.input.publicationId] })
      if (fault === 'change-bytes') await writeFile(join(f.hansen.directory, 'skills', f.input.name, 'example.bin'), 'Changed outside managed mutation queue')
      return [f.input.publicationId]
    } })
    await expect(f.hansen.service.readAdoptedSkillContent({ reference: f.input, kind: 'file', path: 'example.bin', offset: 0 })).rejects.toThrow()
  })

  it('bounds simultaneous content requests and aborts an unresponsive authority on original owner disposal', async () => {
    const f = await fixture(); await f.adopt(); let entered = false
    f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read: async () => { entered = true; return new Promise(() => {}) } })
    const request = { reference: f.input, kind: 'directory' as const, path: '' }
    const first = f.hansen.service.readAdoptedSkillContent(request), second = f.hansen.service.readAdoptedSkillContent(request)
    const results = Promise.allSettled([first, second])
    await expect(f.hansen.service.readAdoptedSkillContent(request)).rejects.toThrow('正在读取')
    await vi.waitFor(() => expect(entered).toBe(true)); await f.hansen.dispose()
    expect((await results).every(result => result.status === 'rejected')).toBe(true)
    await expect(f.hansen.service.readAdoptedSkillContent(request)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects unsafe paths, unaligned or oversized pages and foreign fields without widening native file access', async () => {
    const f = await fixture(); await f.adopt()
    f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read: async () => [f.input.publicationId] })
    for (const selection of [{ kind: 'file', path: '../SKILL.md', offset: 0 }, { kind: 'file', path: '/SKILL.md', offset: 0 },
      { kind: 'file', path: '.paimind-install.json', offset: 0 }, { kind: 'file', path: 'example.bin', offset: 1 },
      { kind: 'file', path: 'example.bin', offset: 2 ** 30 }, { kind: 'directory', path: '', cursor: '01' },
      { kind: 'directory', path: '', cursor: '1' }, { kind: 'directory', path: '', principal: 'admin' }]) {
      await expect(f.hansen.service.readAdoptedSkillContent({ reference: f.input, ...selection } as never)).rejects.toThrow()
    }
  })

  it('uses a fresh assignment projection for original preferences without writing an authorization cache', async () => {
    const f = await fixture(); await f.adopt(); await f.adopt(f.alex)
    await chooseIntent(f)
    let available = true
    const read = vi.fn(async () => available ? [f.input.publicationId] : [])
    f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read })
    const policy = await f.hansen.service.getUserSkillPolicy()
    expect(policy.enabledBusinessSkillNames).toEqual([f.input.name])
    expect(policy.directBusinessSkillNames).toEqual([])
    expect(read.mock.calls.length).toBeGreaterThan(0)
    const call = read.mock.calls[0] as unknown as [unknown, AbortSignal]
    expect(call[0]).toEqual([f.input]); expect(call[1]).toBeInstanceOf(AbortSignal)
    await f.hansen.service.replaceUserSkillPolicy({ expectedRevision: policy.revision,
      enabledOptionalSystemSkillNames: policy.enabledOptionalSystemSkillNames,
      enabledBusinessSkillNames: [f.input.name], directBusinessSkillNames: [f.input.name] })
    await f.hansen.service.replaceSessionBusinessSkillSelection({ sessionId: f.hansen.session.id, expectedRevision: 0, skillNames: [f.input.name] })
    const path = join(f.hansen.directory, 'state', 'user-skill-policy.json'), before = await readFile(path, 'utf8')
    expect(before).not.toContain('publicationEligible'); expect(before).not.toContain('runtimeGrant')
    expect(JSON.parse(before).enabledAdoptedSkillIds).toEqual([f.input.publicationId]) // explicit intent, not a cached allow result
    available = false
    expect((await f.hansen.service.listInstalled()).items[0]).toMatchObject({ publicationEligible: false })
    expect(await f.hansen.service.getUserSkillPolicy()).toMatchObject({ enabledBusinessSkillNames: [], directBusinessSkillNames: [] })
    expect(await readFile(path, 'utf8')).toBe(before)
    // Choices survive withdrawal for history and can be removed. They cannot
    // enable an unassigned package or affect another original Skill owner.
    expect((await f.hansen.service.getSessionBusinessSkillSelection({ sessionId: f.hansen.session.id })).skillNames).toEqual([f.input.name])
    await f.hansen.service.replaceSessionBusinessSkillSelection({ sessionId: f.hansen.session.id, expectedRevision: 1, skillNames: [] })
    expect((await f.alex.service.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([])
    available = true
    expect((await f.hansen.service.getUserSkillPolicy()).directBusinessSkillNames).toEqual([f.input.name])
    f.hansen.providers.delete('paimindEnterpriseSkillEligibility')
    expect((await f.hansen.service.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([])
  })

  it.each(['foreign-id', 'duplicate', 'grant-object', 'disconnect', 'provider-replaced', 'bytes-changed'] as const)(
    'fails closed on current eligibility %s without accepting a local receipt as authority', async fault => {
      const f = await fixture(); await f.adopt()
      f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read: async () => {
        if (fault === 'foreign-id') return [randomUUID()]
        if (fault === 'duplicate') return [f.input.publicationId, f.input.publicationId]
        if (fault === 'grant-object') return { allowed: true }
        if (fault === 'disconnect') throw Error('authority disconnected')
        if (fault === 'provider-replaced') f.hansen.providers.set('paimindEnterpriseSkillEligibility', { read: async () => [] })
        if (fault === 'bytes-changed') await writeFile(join(f.hansen.directory, 'skills', f.input.name, 'example.bin'), 'Changed while awaiting authority')
        return [f.input.publicationId]
      } })
      await expect(f.hansen.service.getUserSkillPolicy()).rejects.toThrow()
      expect(PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS.map(row => row.method)).not.toContain('currentPublicationEligibility')
    })

  it('attests only the exact original loaded enterprise body and keeps that read outside remote management', async () => {
    const f = await fixture(); await f.adopt()
    const value = { name: f.input.name, provider: 'paimind-session-business-skills', content: 'Use only confirmed customer notes.',
      resourceBase: { kind: 'directory', path: join(f.hansen.directory, 'skills', f.input.name) } }
    expect(await f.hansen.service.getLoadedPublicationReference(value)).toEqual(f.input)
    expect(await f.morgan.service.getLoadedPublicationReference({ ...value,
      resourceBase: { kind: 'directory', path: f.sourceRoot } })).toBeUndefined()
    expect(await f.alex.service.getLoadedPublicationReference({ name: 'native-method', provider: 'bundled', content: 'Native system skill' })).toBeUndefined()
    await expect(f.alex.service.getLoadedPublicationReference(value)).rejects.toThrow('不存在')
    for (const changed of [{ ...value, content: value.content + '\nChanged' }, { ...value, provider: 'bundled' },
      { ...value, resourceBase: { kind: 'directory', path: f.sourceRoot } }, { ...value, resourceBase: undefined }]) {
      await expect(f.hansen.service.getLoadedPublicationReference(changed)).rejects.toThrow()
    }
    await expect(f.hansen.service.getLoadedPublicationReference(value, AbortSignal.abort())).rejects.toThrow()
    expect((await f.hansen.service.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([])
    expect(PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS.map(row => row.method)).not.toContain('getLoadedPublicationReference')
    await writeFile(join(f.hansen.directory, 'skills', f.input.name, 'example.bin'), 'Immutable content changed')
    await expect(f.hansen.service.getLoadedPublicationReference(value)).rejects.toThrow()
  })

  it('snapshots the native loaded value before waiting for the original owner mutation queue', async () => {
    const f = await fixture(); await f.adopt()
    const value = { name: f.input.name, provider: 'paimind-session-business-skills', content: 'Use only confirmed customer notes.',
      resourceBase: { kind: 'directory', path: join(f.hansen.directory, 'skills', f.input.name) } }
    const pending = f.hansen.service.getLoadedPublicationReference(value)
    value.content = 'Changed caller payload'; value.resourceBase.path = f.sourceRoot
    expect(await pending).toEqual(f.input)
  })

  it('projects only explicitly selected enterprise intent through the original direct/Agent resolver', async () => {
    const f = await fixture(); await f.adopt(); await f.adopt(f.alex)
    const selected = { nativeSessionId: f.hansen.session.id, presetId: 'standard' }
    expect(await f.hansen.service.getSelectedPublicationReferences(selected)).toEqual([])
    await chooseIntent(f, true)
    expect(await f.hansen.service.getSelectedPublicationReferences(selected)).toEqual([f.input])
    expect(await f.alex.service.getSelectedPublicationReferences({ nativeSessionId: f.alex.session.id, presetId: 'standard' })).toEqual([])
    // A direct-chat choice must not leak into an unrelated Agent.
    expect(await f.hansen.service.getSelectedPublicationReferences({ ...selected, presetId: 'other-agent' })).toEqual([])
    f.hansen.agentSkills.set('selected-agent', [f.input.name])
    expect(await f.hansen.service.getSelectedPublicationReferences({ ...selected, presetId: 'selected-agent' })).toEqual([f.input])
    // Intent verification still does not open the not-yet-integrated eligibility UI.
    expect((await f.hansen.service.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([])
    expect(PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS.map(row => row.method)).not.toContain('getSelectedPublicationReferences')
  })

  it('does not include a user-disabled enterprise reference or a same-name personal source', async () => {
    const f = await fixture(); await f.adopt()
    f.hansen.agentSkills.set('selected-agent', [f.input.name])
    await writeFile(join(f.hansen.directory, 'state', 'user-skill-policy.json'), JSON.stringify({ schema: 'paimind.user-skill-policy-storage/v3',
      revision: 1, enabledOptionalSystemSkillNames: [], disabledBusinessSkillNames: [f.input.name], directBusinessSkillNames: [] }))
    expect(await f.hansen.service.getSelectedPublicationReferences({ nativeSessionId: f.hansen.session.id, presetId: 'selected-agent' })).toEqual([])
    f.morgan.agentSkills.set('selected-agent', [f.input.name])
    expect(await f.morgan.service.getSelectedPublicationReferences({ nativeSessionId: f.morgan.session.id, presetId: 'selected-agent' })).toEqual([])
  })

  it('retains exact used versions after deselection or local disabling without changing eligibility', async () => {
    const f = await fixture(); await f.adopt()
    const input = { nativeSessionId: f.hansen.session.id, presetId: 'standard', requiredPublicationIds: [f.input.publicationId] }
    expect(await f.hansen.service.getSelectedPublicationReferences(input)).toEqual([f.input])
    await writeFile(join(f.hansen.directory, 'state', 'user-skill-policy.json'), JSON.stringify({ schema: 'paimind.user-skill-policy-storage/v3',
      revision: 1, enabledOptionalSystemSkillNames: [], disabledBusinessSkillNames: [f.input.name], directBusinessSkillNames: [] }))
    expect(await f.hansen.service.getSelectedPublicationReferences(input)).toEqual([f.input])
    expect((await f.hansen.service.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([])
    await expect(f.alex.service.getSelectedPublicationReferences({ ...input, nativeSessionId: f.alex.session.id })).rejects.toThrow('缺失')
    await expect(f.hansen.service.getSelectedPublicationReferences({ ...input, requiredPublicationIds: [randomUUID()] })).rejects.toThrow('缺失')
    await writeFile(join(f.hansen.directory, 'skills', f.input.name, 'example.bin'), 'Changed after use')
    await expect(f.hansen.service.getSelectedPublicationReferences(input)).rejects.toThrow()
  })

  it.each([null, ['unknown'], Array.from({ length: 129 }, () => randomUUID())])('rejects invalid retained requirement lists', async requiredPublicationIds => {
    const f = await fixture(); await f.adopt()
    await expect(f.hansen.service.getSelectedPublicationReferences({ nativeSessionId: f.hansen.session.id, presetId: 'standard',
      requiredPublicationIds } as never)).rejects.toThrow()
    await expect(f.hansen.service.getSelectedPublicationReferences({ nativeSessionId: f.hansen.session.id, presetId: 'standard',
      requiredPublicationIds: [f.input.publicationId, f.input.publicationId] })).rejects.toThrow()
  })

  it('reads only captured job requirements without resolving later parent choices or changing policy', async () => {
    const f = await fixture(); await f.adopt()
    await chooseIntent(f)
    f.hansen.agentSkills.set('selected-agent', [f.input.name])
    const input = { nativeSessionId: f.hansen.session.id, presetId: 'selected-agent' }
    expect(await f.hansen.service.getSelectedPublicationReferences(input)).toEqual([f.input])
    const captured = { ...input, requiredPublicationIds: [], skillSelection: 'captured' as const }
    expect(await f.hansen.service.getSelectedPublicationReferences(captured)).toEqual([])
    // A later invalid parent choice is not a dependency of an already-started job.
    f.hansen.agentSkills.set('selected-agent', ['genui'])
    await expect(f.hansen.service.getSelectedPublicationReferences(input)).rejects.toThrow('冲突')
    expect(await f.hansen.service.getSelectedPublicationReferences({ ...captured, requiredPublicationIds: [f.input.publicationId] })).toEqual([f.input])
    expect((await f.hansen.service.getUserSkillPolicy()).enabledBusinessSkillNames).toEqual([])
    await expect(f.hansen.service.getSelectedPublicationReferences({ ...captured, nativeSessionId: f.alex.session.id })).rejects.toThrow()
    await writeFile(join(f.hansen.directory, 'skills', f.input.name, 'example.bin'), 'Changed captured version')
    await expect(f.hansen.service.getSelectedPublicationReferences({ ...captured, requiredPublicationIds: [f.input.publicationId] })).rejects.toThrow()
  })

  it.each([undefined, null, 'current', false])('rejects a malformed captured selector instead of silently omitting choices', async skillSelection => {
    const f = await fixture()
    const input = { nativeSessionId: f.hansen.session.id, presetId: 'standard' }
    await expect(f.hansen.service.getSelectedPublicationReferences({ ...input, requiredPublicationIds: [], skillSelection } as never)).rejects.toThrow()
    await expect(f.hansen.service.getSelectedPublicationReferences({ ...input, skillSelection: 'captured' } as never)).rejects.toThrow()
  })

  it.each(['content', 'receipt', 'session', 'cancel'] as const)('refuses %s drift before selected enterprise intent crosses private control', async mode => {
    const f = await fixture(); await f.adopt(); f.hansen.agentSkills.set('selected-agent', [f.input.name])
    await chooseIntent(f)
    const root = join(f.hansen.directory, 'skills', f.input.name)
    if (mode === 'content') await writeFile(join(root, 'example.bin'), 'Drifted bytes')
    if (mode === 'receipt') await writeFile(join(root, '.paimind-install.json'), '{broken')
    await expect(f.hansen.service.getSelectedPublicationReferences({ nativeSessionId: mode === 'session' ? f.alex.session.id : f.hansen.session.id,
      presetId: 'selected-agent' }, mode === 'cancel' ? AbortSignal.abort() : signal())).rejects.toThrow()
  })

  it('preserves full bytes, empty folders and inert references independently for Hansen and Alex', async () => {
    const f = await fixture(), first = await f.adopt(), second = await f.adopt(f.alex)
    expect(first).toMatchObject({ ...f.input, schema: 'paimind.skill-adoption/v1' }); expect(second.publicationId).toBe(first.publicationId)
    for (const target of [f.hansen, f.alex]) {
      const root = join(target.directory, 'skills', f.input.name)
      expect(await readFile(join(root, 'example.bin'))).toEqual(f.binary)
      expect(await readdir(join(root, 'empty'))).toEqual([])
      expect(await readFile(join(root, '.codex-plugin', 'plugin.json'))).toEqual(await readFile(join(f.sourceRoot, '.codex-plugin', 'plugin.json')))
      expect((await target.service.getSkillPackage({ skillId: f.input.name })).digest).toBe(f.input.packageDigest)
      expect((await target.service.listInstalled()).items[0]?.publication).toMatchObject(f.input)
      expect(await readdir(join(target.directory, 'state', 'publication-imports'))).toEqual([])
      await expect(readFile(join(target.directory, 'state', 'user-skill-policy.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    const methods = PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS.map(row => row.method)
    for (const method of ['beginPublicationAdoption', 'writePublicationAdoption', 'commitPublicationAdoption', 'releasePublicationAdoption', 'getAdoptedSkillPublication']) {
      expect(methods).not.toContain(method)
    }
  })

  it('reuses only the same verified receipt and performs no second archive transfer', async () => {
    const f = await fixture(), first = await f.adopt(); f.read.mockClear()
    expect(await f.adopt()).toEqual(first); expect(f.read).not.toHaveBeenCalled()
    await expect(f.hansen.service.getAdoptedSkillPublication(f.input)).resolves.toEqual(first)
    await expect(f.hansen.service.beginPublicationAdoption({ ...f.input, publicationId: randomUUID() })).rejects.toThrow('其他发布版本')
    expect(await readFile(join(f.hansen.directory, 'skills', f.input.name, 'example.bin'))).toEqual(f.binary)
  })

  it.each(['different', 'identical'])('does not borrow or overwrite an existing same-name personal folder with %s bytes', async bytes => {
    const f = await fixture()
    if (bytes === 'identical') {
      await cp(f.sourceRoot, join(f.hansen.directory, 'skills', f.input.name), { recursive: true, errorOnExist: true, force: false })
      expect((await f.hansen.service.getSkillPackage({ skillId: f.input.name })).digest).toBe(f.input.packageDigest)
    } else await f.hansen.service.saveSkillSource({ name: f.input.name, description: 'Hansen personal notes', instructions: 'Hansen own content' })
    const before = await f.hansen.service.getSkillSource({ skillId: f.input.name })
    await expect(f.adopt()).rejects.toThrow('同名个人')
    expect(await f.hansen.service.getSkillSource({ skillId: f.input.name })).toEqual(before)
    expect(f.read).not.toHaveBeenCalled()
  })

  it('rejects the ordinary upload overwrite path and preserves the complete enterprise receipt', async () => {
    const f = await fixture(), receipt = await f.adopt()
    const request = Readable.from([Buffer.from('---\nname: customer-notes\ndescription: Personal replacement\n---\n\nNew content')]) as IncomingMessage
    Object.assign(request, { headers: { 'x-paimind-upload': '1', 'x-paimind-file-name': 'SKILL.md' }, method: 'POST', url: '/paimind/skills/uploads' })
    let status = 0, payload = ''
    await f.hansen.service.handleUpload(request, { writeHead(value: number) { status = value; return this }, end(value?: string) { payload = value ?? '' } } as unknown as ServerResponse)
    expect(status).toBe(201)
    const upload = JSON.parse(payload) as { uploadId: string; digest: string }
    await expect(f.hansen.service.installUpload(upload)).rejects.toThrow('发布版本只读')
    expect(await f.hansen.service.getAdoptedSkillPublication(f.input)).toEqual(receipt)
  })

  it('serializes a personal create before target promotion without replacing the personal winner', async () => {
    const f = await fixture(), personal = f.hansen.service.saveSkillSource({ name: f.input.name, description: 'Hansen own version', instructions: 'Preserve my content' })
    const results = await Promise.allSettled([personal, f.adopt()])
    expect(results[0]?.status).toBe('fulfilled'); expect(results[1]?.status).toBe('rejected')
    expect((await f.hansen.service.getSkillSource({ skillId: f.input.name })).instructions).toBe('Preserve my content')
    expect((await f.hansen.service.listInstalled()).items[0]?.publication).toBeUndefined()
  })

  it('excludes adopted content from user policy and refuses local preference as authority', async () => {
    const f = await fixture(); await f.adopt()
    await f.hansen.service.saveSkillSource({ name: 'personal-notes', description: 'Hansen personal', instructions: 'Own notes only' })
    const policy = await f.hansen.service.getUserSkillPolicy()
    expect(policy.enabledBusinessSkillNames).toEqual(['personal-notes']); expect(policy.directBusinessSkillNames).toEqual([])
    await expect(f.hansen.service.replaceUserSkillPolicy({ expectedRevision: policy.revision,
      enabledOptionalSystemSkillNames: policy.enabledOptionalSystemSkillNames, enabledBusinessSkillNames: [f.input.name], directBusinessSkillNames: [f.input.name] }))
      .rejects.toThrow('运行授权尚未接入')
    expect(await f.hansen.service.getUserSkillPolicy()).toEqual(policy)
  })

  it.each(['edit-source', 'edit-package', 'uninstall'] as const)('refuses %s without changing the adopted version', async mode => {
    const f = await fixture(), receipt = await f.adopt(), source = await f.hansen.service.getSkillSource({ skillId: f.input.name })
    const operation = mode === 'edit-source'
      ? f.hansen.service.saveSkillSource({ name: f.input.name, description: source.description, instructions: 'Changed', expectedDigest: source.digest })
      : mode === 'edit-package' ? f.hansen.service.saveSkillPackage({ skillId: f.input.name, expectedDigest: f.input.packageDigest,
        changes: [{ operation: 'mkdir', path: 'not-allowed' }] }) : f.hansen.service.uninstall({ skillId: f.input.name })
    await expect(operation).rejects.toThrow('发布版本只读')
    expect(await f.hansen.service.getAdoptedSkillPublication(f.input)).toEqual(receipt)
  })

  it.each(['bad-digest', 'bad-offset', 'short-chunk', 'cancel', 'target-failure'] as const)('rejects %s and releases only its staging', async mode => {
    const f = await fixture(), controller = new AbortController()
    const transport = { ...f.hansen.transport, write: async (input: Parameters<SkillPublicationAdoptionTransfer['write']>[0], abort: AbortSignal) => {
      if (mode === 'target-failure') throw Error('Target staging unavailable')
      const result = await f.hansen.transport.write(mode === 'bad-offset' ? { ...input, offset: input.offset + 1 }
        : mode === 'short-chunk' ? { ...input, data: Buffer.from('x').toString('base64') }
          : mode === 'bad-digest' ? { ...input, data: Buffer.alloc(Buffer.from(input.data, 'base64').length).toString('base64') } : input, abort)
      if (mode === 'cancel') controller.abort()
      return result
    } }
    await expect(f.adopt(f.hansen, transport, controller.signal)).rejects.toThrow()
    await expect(readFile(join(f.hansen.directory, 'skills', f.input.name, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(join(f.hansen.directory, 'state', 'publication-imports'))).toEqual([])
    expect((await f.morgan.service.getSkillPackage({ skillId: f.input.name })).digest).toBe(f.input.packageDigest)
  })

  it('does not let another owner consume a handle, and enforces capacity, expiry and disposal', async () => {
    const f = await fixture(), first = await f.hansen.service.beginPublicationAdoption(f.input), second = await f.hansen.service.beginPublicationAdoption(f.input)
    expect(first.kind).toBe('ready'); if (first.kind !== 'ready' || second.kind !== 'ready') throw Error('Expected pending import')
    await expect(f.hansen.service.beginPublicationAdoption(f.input)).rejects.toThrow()
    await expect(f.alex.service.writePublicationAdoption({ importId: first.importId, offset: 0, data: f.bytes.subarray(0, SKILL_PUBLICATION_CHUNK_BYTES).toString('base64') })).rejects.toThrow()
    await f.alex.service.releasePublicationAdoption({ importId: first.importId })
    await f.hansen.service.releasePublicationAdoption({ importId: first.importId })
    await f.hansen.service.releasePublicationAdoption({ importId: second.importId })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = await f.hansen.service.beginPublicationAdoption(f.input)
    await vi.advanceTimersByTimeAsync(SKILL_PUBLICATION_EXPORT_TTL_MS)
    await vi.waitFor(async () => expect(await readdir(join(f.hansen.directory, 'state', 'publication-imports'))).toEqual([]))
    if (pending.kind === 'ready') await expect(f.hansen.service.commitPublicationAdoption({ importId: pending.importId })).rejects.toThrow()
    vi.useRealTimers(); await f.hansen.dispose()
    await expect(f.hansen.service.beginPublicationAdoption(f.input)).rejects.toThrow()
  })

  it.each(['content', 'receipt', 'empty-directory'] as const)('rejects %s drift on replay and preserves the changed files', async mode => {
    const f = await fixture(); await f.adopt()
    const root = join(f.hansen.directory, 'skills', f.input.name)
    if (mode === 'content') await writeFile(join(root, 'example.bin'), 'External content change')
    else if (mode === 'receipt') await writeFile(join(root, '.paimind-install.json'), '{broken')
    else await mkdir(join(root, 'unexpected-empty'))
    await expect(f.adopt()).rejects.toThrow()
    if (mode === 'content') expect(await readFile(join(root, 'example.bin'), 'utf8')).toBe('External content change')
    else if (mode === 'receipt') expect(await readFile(join(root, '.paimind-install.json'), 'utf8')).toBe('{broken')
    else expect(await readdir(join(root, 'unexpected-empty'))).toEqual([])
  })

  it('preserves an installed target after the caller loses commit confirmation', async () => {
    const f = await fixture(), transport = { ...f.hansen.transport, commit: async (...args: Parameters<SkillPublicationAdoptionTransfer['commit']>) => {
      await f.hansen.transport.commit(...args); throw Error('Lost commit confirmation')
    } }
    await expect(f.adopt(f.hansen, transport)).rejects.toThrow('Lost commit')
    const expected = await f.hansen.service.getAdoptedSkillPublication(f.input)
    expect(await f.adopt()).toEqual(expected)
    expect(await readdir(join(f.hansen.directory, 'state', 'publication-imports'))).toEqual([])
  })

  it('never deletes a replaced transfer file while releasing its handle', async () => {
    const f = await fixture(), start = await f.hansen.service.beginPublicationAdoption(f.input)
    if (start.kind !== 'ready') throw Error('Expected import handle')
    const imports = join(f.hansen.directory, 'state', 'publication-imports'), [entry] = await readdir(imports)
    const file = join(imports, entry!, 'package.zip'), displaced = join(f.hansen.directory, 'original-capture.zip')
    await rename(file, displaced); await writeFile(file, 'Keep replacement')
    await expect(f.hansen.service.releasePublicationAdoption({ importId: start.importId })).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('Keep replacement')
    await expect(f.hansen.service.beginPublicationAdoption(f.input)).rejects.toThrow()
    // Disposal honestly reports the retained unknown replacement; test fixture
    // owns both paths and removes its entire generated directory afterwards.
    await expect(f.hansen.dispose()).rejects.toThrow()
  })
})
