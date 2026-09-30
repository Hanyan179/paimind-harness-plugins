// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { cp, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaimindAgentProfileService } from '../src/index.js'
import { createAgentPublicationSnapshot } from '../src/publication.js'
import { adoptedPresetId, readAdoptionInput } from '../src/adoption.js'
import { PAIMIND_AGENT_PROFILE_REMOTE_DESCRIPTORS } from '../src/remote.js'
import { authorizeNativeExecution } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { PaimindSkillInstallerService } from '../../skill-market/src/installer.js'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'paimind-native-adoption-')); roots.push(root)
  const presetRoot = join(root, 'presets'), stateRoot = join(root, 'state'), standard = join(root, 'standard'), skillRoot = join(root, 'skills')
  await mkdir(standard)
  await writeFile(join(standard, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: base\n")
  await writeFile(join(standard, 'preset.yml'), 'name: Standard\n')
  // Owner boundary double. Real selected-version Harness composition remains
  // an independent gate; these filesystem tests do not claim native E2E.
  const copy = vi.fn(async (from: string, id: string, _name: string) => {
    expect(from).toBe('standard'); await mkdir(presetRoot, { recursive: true })
    await mkdir(join(presetRoot, id)); await cp(standard, join(presetRoot, id), { recursive: true })
  })
  const remove = vi.fn()
  const get = vi.fn((_name: string): unknown => undefined)
  const context = { reflect: { provide() {} }, effect(install: () => void) { install() }, get,
    sessions: { get() {} }, agents: { get() {}, list: () => [] }, tools: { guard: () => () => {} },
    agentPresets: { composedPreset() {}, copy, remove }, on: () => () => {} }
  const service = () => new PaimindAgentProfileService(context as never, { presetRoot, stateRoot, skillRoot, now: () => 100 })
  const instance = service(); await instance.prepareRuntime()
  const input = { tenantId: 'adoption-test', sourceUserId: randomUUID(), publicationId: randomUUID(),
    snapshot: createAgentPublicationSnapshot({ schema: 'paimind.agent-publication/v1', agentId: 'hansen-followup',
      presetId: 'hansen-followup', configVersion: 'v2-source', nativeCompositionDigest: 'sha256:' + 'a'.repeat(64),
      profile: { name: 'Hansen 客户跟进助手', description: '梳理客户跟进', basePresetId: 'standard',
        role: '客户助理', goal: '找出待确认事项', behavior: '区分事实和假设', instructions: '', preferredSkillNames: [] }, dependencies: [] }) }
  const target = join(presetRoot, adoptedPresetId(input.publicationId))
  const files = ['.paimind-publication.json', '.paimind-agent.json', 'agent.cordis.yml', 'preset.yml']
  const bytes = () => Promise.all(files.map(name => readFile(join(target, name), 'utf8')))
  return { instance, service, input, target, bytes, copy, remove, standard, presetRoot, stateRoot, skillRoot, get, context }
}

async function installDependency(f: Awaited<ReturnType<typeof fixture>>, instructions = 'Use only the current member customer notes') {
  const context = { reflect: { provide() {} }, webServer: { register: () => () => {} }, effect(install: () => void) { install() } }
  const installer = new PaimindSkillInstallerService(context as never, { skillRoot: f.skillRoot, stateRoot: join(f.stateRoot, 'skills'), now: () => 100 })
  await installer.saveSkillSource({ name: 'client-notes', description: 'Current member customer notes', instructions })
  const source = join(f.skillRoot, 'client-notes')
  await mkdir(join(source, 'assets')); await writeFile(join(source, 'assets', 'sample.bin'), Buffer.from([0, 1, 2, 255]))
  const current = await installer.getSkillPackage({ skillId: 'client-notes' })
  f.get.mockImplementation(name => name === 'paimindSkillInstaller' ? installer : undefined)
  const input = { ...f.input, snapshot: createAgentPublicationSnapshot({ ...f.input.snapshot.content,
    profile: { ...f.input.snapshot.content.profile, preferredSkillNames: ['client-notes'] }, dependencies: [{ name: 'client-notes', digest: current.digest }] }) }
  return { installer, input, source, current }
}

describe('native-owner publication materialization, not runtime authorization or Browser E2E', () => {
  it('materializes exact existing managed dependencies through their real owner without installing or enabling anything', async () => {
    const f = await fixture(), skill = await installDependency(f)
    const before = await readFile(join(skill.source, '.paimind-install.json'))
    const receipt = await f.instance.adoptPublication(skill.input)
    expect(receipt.snapshot).toEqual(skill.input.snapshot)
    expect((await f.instance.businessSkillNamesForPreset(receipt.presetId))).toEqual(['client-notes'])
    expect(await f.instance.getAdoptedPublication({ presetId: receipt.presetId })).toEqual(receipt)
    const fresh = f.service(); await fresh.prepareRuntime()
    expect(await fresh.adoptPublication(skill.input)).toEqual(receipt); expect(f.copy).toHaveBeenCalledOnce()
    expect(await readFile(join(skill.source, '.paimind-install.json'))).toEqual(before)
    expect(await skill.installer.getSkillPackage({ skillId: 'client-notes' })).toEqual(skill.current)
    await expect(readFile(join(f.stateRoot, 'skills', 'user-skill-policy.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('does not substitute Alex same-name Skill for Hansen exact dependency; each owner keeps its own bytes', async () => {
    const hansen = await fixture(), alex = await fixture(), first = await installDependency(hansen)
    const second = await installDependency(alex, 'Different Alex research instructions')
    expect(first.current.digest).not.toBe(second.current.digest)
    const hansenReceipt = await hansen.instance.adoptPublication(first.input)
    await expect(alex.instance.adoptPublication(first.input)).rejects.toThrow('版本')
    expect(alex.copy).not.toHaveBeenCalled()
    const alexReceipt = await alex.instance.adoptPublication(second.input), before = await alex.bytes()
    await writeFile(join(first.source, 'assets', 'sample.bin'), Buffer.from([0, 9]))
    await expect(hansen.instance.getAdoptedPublication({ presetId: hansenReceipt.presetId })).rejects.toThrow('版本')
    expect(await alex.instance.getAdoptedPublication({ presetId: alexReceipt.presetId })).toEqual(alexReceipt)
    expect(await alex.bytes()).toEqual(before)
  })
  it.each(['instructions', 'asset', 'directory', 'removed', 'unmanaged', 'owner-missing', 'system-collision'])('denies dependency %s drift on read, retry and the execution bridge without rewriting adopted files', async kind => {
    const f = await fixture(), skill = await installDependency(f), receipt = await f.instance.adoptPublication(skill.input), before = await f.bytes()
    if (kind === 'instructions') await writeFile(join(skill.source, 'SKILL.md'), '---\nname: client-notes\ndescription: Changed\n---\nChanged body\n')
    else if (kind === 'asset') await writeFile(join(skill.source, 'assets', 'sample.bin'), Buffer.from([0, 9]))
    else if (kind === 'directory') await mkdir(join(skill.source, 'extra-empty'))
    else if (kind === 'removed') await skill.installer.uninstall({ skillId: 'client-notes' })
    else if (kind === 'unmanaged') await rm(join(skill.source, '.paimind-install.json'))
    else if (kind === 'owner-missing') f.get.mockReturnValue(undefined)
    else Object.assign(f.context, { skills: { list: async () => [{ name: 'client-notes' }] } })
    await expect(f.instance.getAdoptedPublication({ presetId: receipt.presetId })).rejects.toThrow()
    await expect(f.instance.adoptPublication(skill.input)).rejects.toThrow()
    await expect(f.instance.businessSkillNamesForPreset(receipt.presetId)).rejects.toThrow()
    const peer = { ready: true, authorizeExecution: vi.fn(async () => {}) }
    await expect(authorizeNativeExecution({ get: (name: string) => name === 'paimindAgentProfiles' ? f.instance : undefined }, peer, { nativeSessionId: 'hansen-owned', presetId: receipt.presetId,
      sources: ['paimind-origin-v1.e30.' + 'a'.repeat(43)] }, new AbortController().signal)).rejects.toThrow()
    expect(peer.authorizeExecution).not.toHaveBeenCalled()
    expect(await f.bytes()).toEqual(before); expect(f.copy).toHaveBeenCalledOnce(); expect(f.remove).not.toHaveBeenCalled()
  })
  it('rechecks dependencies before promoting the staged preset when the native copy awaited another owner', async () => {
    const f = await fixture(), skill = await installDependency(f), original = f.copy.getMockImplementation()!
    f.copy.mockImplementationOnce(async (...args) => {
      await original(...args); await writeFile(join(skill.source, 'assets', 'sample.bin'), Buffer.from([0, 9]))
    })
    await expect(f.instance.adoptPublication(skill.input)).rejects.toThrow('版本')
    await expect(readFile(join(f.target, '.paimind-publication.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(f.target, 'agent.cordis.yml'))).toEqual(await readFile(join(f.standard, 'agent.cordis.yml')))
    await expect(f.instance.adoptPublication(skill.input)).rejects.toThrow()
    expect(f.copy).toHaveBeenCalledOnce(); expect(f.remove).not.toHaveBeenCalled()
  })
  it('projects exact current adoption proof through the execution bridge and rejects local byte drift before authority', async () => {
    const f = await fixture(), receipt = await f.instance.adoptPublication(f.input)
    const input = { nativeSessionId: 'hansen-session', presetId: receipt.presetId,
      sources: ['paimind-origin-v1.e30.' + 'a'.repeat(43)] }
    const peer = { ready: true, authorizeExecution: vi.fn(async () => {}) }, context = { get: (name: string) => name === 'paimindAgentProfiles' ? f.instance : undefined }
    await authorizeNativeExecution(context, peer, input, new AbortController().signal)
    expect(peer.authorizeExecution.mock.calls[0]?.[0]).toEqual({ ...input, skills: [], publication: { tenantId: f.input.tenantId,
      publicationId: f.input.publicationId, sourceUserId: f.input.sourceUserId, contentDigest: f.input.snapshot.digest } })
    expect(JSON.stringify(peer.authorizeExecution.mock.calls)).not.toContain(f.input.snapshot.content.profile.goal)
    await writeFile(join(f.target, 'agent.cordis.yml'), 'tampered composition')
    await expect(authorizeNativeExecution(context, peer, input, new AbortController().signal)).rejects.toThrow()
    expect(peer.authorizeExecution).toHaveBeenCalledOnce()
    await expect(authorizeNativeExecution(context, peer, input, AbortSignal.abort())).rejects.toThrow()
    expect(peer.authorizeExecution).toHaveBeenCalledOnce()
  })
  it('accepts the control-plane tenant identity vocabulary without aliases or whitespace', async () => {
    const f = await fixture()
    for (const tenantId of ['hansen.team:eu-1', 'hansen_team', 'a'.repeat(160)]) {
      expect(readAdoptionInput({ ...f.input, tenantId }).tenantId).toBe(tenantId)
    }
    for (const tenantId of ['.hidden', '-invalid', 'two words', 'trailing ', 'a'.repeat(161)]) {
      expect(() => readAdoptionInput({ ...f.input, tenantId })).toThrow()
    }
  })
  it('copies only Standard, preserves exact immutable source and is idempotent across concurrent calls and restart', async () => {
    const f = await fixture()
    const [first, retry] = await Promise.all([f.instance.adoptPublication(f.input), f.instance.adoptPublication(f.input)])
    expect(first).toEqual(retry); expect(f.copy).toHaveBeenCalledOnce()
    expect(first.snapshot).toEqual(f.input.snapshot)
    expect(first.presetId).not.toBe(f.input.snapshot.content.presetId)
    expect(first.configVersion).not.toBe(f.input.snapshot.content.configVersion)
    const before = await f.bytes(), restarted = f.service(); await restarted.prepareRuntime()
    expect(await restarted.getAdoptedPublication({ presetId: first.presetId })).toEqual(first)
    expect(await restarted.adoptPublication(f.input)).toEqual(first)
    expect(await restarted.listProfiles()).toEqual({ profiles: [] })
    expect(await restarted.listSessionBindings()).toEqual({ bindings: [] })
    expect(await f.bytes()).toEqual(before); expect(f.copy).toHaveBeenCalledOnce()
    expect(Object.isFrozen(first.snapshot.content.profile)).toBe(true)
    expect(Object.isFrozen(first.snapshot.content.dependencies)).toBe(true)
  })
  it('does not remotely expose trusted adoption methods or treat their receipt as a grant', () => {
    expect(PAIMIND_AGENT_PROFILE_REMOTE_DESCRIPTORS.map(row => row.method)).not.toContain('adoptPublication')
    expect(PAIMIND_AGENT_PROFILE_REMOTE_DESCRIPTORS.map(row => row.method)).not.toContain('getAdoptedPublication')
  })
  it('blocks personal edit, removal, default and re-publication paths without altering files', async () => {
    const f = await fixture(), receipt = await f.instance.adoptPublication(f.input), before = await f.bytes()
    const profile = JSON.parse(before[1]!)
    await expect(f.instance.saveProfile({ ...profile, productKind: 'personal', role: 'changed' })).rejects.toThrow('企业采用')
    await expect(f.instance.removeProfile({ presetId: receipt.presetId })).rejects.toThrow('企业采用')
    await expect(f.instance.setDefault({ presetId: receipt.presetId })).rejects.toThrow('企业采用')
    await expect(f.instance.getPublicationSnapshot({ presetId: receipt.presetId, expectedVersion: receipt.configVersion })).rejects.toThrow('企业采用')
    expect(f.remove).not.toHaveBeenCalled(); expect(await f.bytes()).toEqual(before)
  })
  it.each(['tenant', 'author', 'content'])('refuses a conflicting %s under an already adopted publication id', async kind => {
    const f = await fixture(); await f.instance.adoptPublication(f.input); const before = await f.bytes()
    const conflicting = { ...f.input, ...(kind === 'tenant' ? { tenantId: 'other-tenant' }
      : kind === 'author' ? { sourceUserId: randomUUID() } : { snapshot: createAgentPublicationSnapshot({ ...f.input.snapshot.content,
        profile: { ...f.input.snapshot.content.profile, goal: '替换旧版本' } }) }) }
    await expect(f.instance.adoptPublication(conflicting)).rejects.toThrow('不能覆盖')
    expect(await f.bytes()).toEqual(before); expect(f.copy).toHaveBeenCalledOnce()
  })
  it('uses a new native identity for a new publication without rewriting the prior version', async () => {
    const f = await fixture(), old = await f.instance.adoptPublication(f.input), before = await f.bytes()
    const next = await f.instance.adoptPublication({ ...f.input, publicationId: randomUUID() })
    expect(next.presetId).not.toBe(old.presetId); expect(await f.bytes()).toEqual(before)
  })
  it.each(['profile', 'composition', 'metadata', 'receipt', 'legacy'])('rejects %s drift on read and retry without repairing bytes', async kind => {
    const f = await fixture(), receipt = await f.instance.adoptPublication(f.input)
    const file = kind === 'profile' ? '.paimind-agent.json' : kind === 'composition' ? 'agent.cordis.yml'
      : kind === 'metadata' ? 'preset.yml' : kind === 'receipt' ? '.paimind-publication.json' : '.paimind-skills'
    if (kind === 'legacy') await mkdir(join(f.target, file))
    else await writeFile(join(f.target, file), kind === 'profile'
      ? JSON.stringify({ ...JSON.parse(await readFile(join(f.target, file), 'utf8')), role: 'changed' }) : 'invalid')
    const before = await f.bytes()
    await expect(f.instance.getAdoptedPublication({ presetId: receipt.presetId })).rejects.toThrow()
    await expect(f.instance.adoptPublication(f.input)).rejects.toThrow()
    expect(await f.bytes()).toEqual(before)
  })
  it.each(['symlink', 'hardlink'])('rejects a %s receipt and never follows it into an adoption', async kind => {
    const f = await fixture(), receipt = await f.instance.adoptPublication(f.input), path = join(f.target, '.paimind-publication.json')
    const other = join(f.target, 'other.json'); await writeFile(other, await readFile(path)); await rm(path)
    await (kind === 'symlink' ? symlink(other, path) : link(other, path))
    await expect(f.instance.getAdoptedPublication({ presetId: receipt.presetId })).rejects.toThrow('文件无效')
  })
  it('rejects unproven dependencies and normalization changes before the native owner writes anything', async () => {
    const f = await fixture()
    const changed = (profile: object, dependencies: object[] = []) => ({ ...f.input, snapshot: createAgentPublicationSnapshot({
      ...f.input.snapshot.content, profile: { ...f.input.snapshot.content.profile, ...profile }, dependencies }) })
    await expect(f.instance.adoptPublication(changed({ preferredSkillNames: ['client-notes'] }, [{ name: 'client-notes', digest: 'sha256:' + 'b'.repeat(64) }]))).rejects.toThrow('技能')
    await expect(f.instance.adoptPublication(changed({ name: ' leading space' }))).rejects.toThrow('无损')
    await expect(f.instance.adoptPublication({ ...f.input, role: 'admin' } as never)).rejects.toThrow()
    expect(f.copy).not.toHaveBeenCalled()
  })
  it('retains an interrupted native copy sealed; retry never overwrites an unproven occupied target', async () => {
    const f = await fixture(); await writeFile(join(f.standard, 'agent.cordis.yml'), '- id: no-persona\n')
    await expect(f.instance.adoptPublication(f.input)).rejects.toThrow('persona')
    const before = await readFile(join(f.target, 'agent.cordis.yml'))
    await expect(f.instance.adoptPublication(f.input)).rejects.toThrow()
    expect(await readFile(join(f.target, 'agent.cordis.yml'))).toEqual(before)
    expect(f.copy).toHaveBeenCalledOnce(); expect(f.remove).not.toHaveBeenCalled()
  })
})
