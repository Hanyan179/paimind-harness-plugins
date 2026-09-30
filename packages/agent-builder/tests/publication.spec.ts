// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PaimindAgentProfileService } from '../src/index.js'
import { createAgentPublicationSnapshot, readAgentPublicationSnapshot } from '../src/publication.js'

const roots: string[] = []
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }) })
async function fixture(skills: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'paimind-publication-')); roots.push(root)
  const presetRoot = join(root, 'presets'), presetId = 'hansen-client-agent', source = join(presetRoot, presetId), skillRoot = join(root, 'skills')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: base\n")
  await writeFile(join(source, 'preset.yml'), 'name: Hansen\n')
  for (const name of skills) { await mkdir(join(skillRoot, name), { recursive: true }); await writeFile(join(skillRoot, name, 'SKILL.md'), '# Test\n') }
  const getSkillPackage = vi.fn(async ({ skillId }: { skillId: string }) => ({ skillId, name: skillId, digest: 'sha256:' + 'a'.repeat(64), managed: true }))
  const get = vi.fn((name: string) => name === 'paimindSkillInstaller' ? { getSkillPackage } : undefined)
  const context = { reflect: { provide() {} }, effect(install: () => void) { install() }, get,
    sessions: { get() {} }, agents: { get() {}, list: () => [] }, tools: { guard: () => () => {} },
    agentPresets: { composedPreset() {} }, on: () => () => {} }
  const service = new PaimindAgentProfileService(context as never, { presetRoot, stateRoot: join(root, 'state'), skillRoot, now: () => 100 })
  const profile = await service.saveProfile({ presetId, agentId: presetId, name: 'Hansen 客户跟进助手', description: '跟进客户',
    basePresetId: 'standard', role: '客户助理', goal: '梳理跟进事项', behavior: '有依据地回答', instructions: '', preferredSkillNames: skills,
    authoringSessionId: 'private-authoring-session', authoringCursor: 20 })
  const selection = { presetId, expectedVersion: profile.configVersion }
  return { service, source, selection, profile, get, getSkillPackage }
}

describe('Agent owner immutable publication snapshot', () => {
  it('freezes the exact saved version without publishing authoring identity or writing source files', async () => {
    const f = await fixture()
    const before = await Promise.all(['agent.cordis.yml', '.paimind-agent.json'].map(name => readFile(join(f.source, name))))
    const snapshot = await f.service.getPublicationSnapshot(f.selection)
    expect(snapshot.content).toMatchObject({ presetId: f.profile.presetId, configVersion: f.profile.configVersion,
      profile: { name: f.profile.name, basePresetId: 'standard' }, dependencies: [] })
    expect(JSON.stringify(snapshot)).not.toContain('private-authoring-session')
    expect(readAgentPublicationSnapshot(snapshot)).toEqual(snapshot)
    expect(await f.service.getPublicationSnapshot(f.selection)).toEqual(snapshot)
    expect(await Promise.all(['agent.cordis.yml', '.paimind-agent.json'].map(name => readFile(join(f.source, name))))).toEqual(before)
  })
  it('obtains exact managed Skill digests from the owner service, not the profile or upload manifest', async () => {
    const f = await fixture(['client-notes'])
    expect((await f.service.getPublicationSnapshot(f.selection)).content.dependencies).toEqual([{ name: 'client-notes', digest: 'sha256:' + 'a'.repeat(64) }])
    expect(f.getSkillPackage).toHaveBeenCalledWith({ skillId: 'client-notes' })
  })
  it('detaches and deeply freezes both created and restored snapshots without freezing the caller draft', async () => {
    const f = await fixture(['client-notes'])
    const original = await f.service.getPublicationSnapshot(f.selection)
    const draft = JSON.parse(JSON.stringify(original.content))
    const created = createAgentPublicationSnapshot(draft)
    draft.profile.name = 'Changed draft'
    draft.profile.preferredSkillNames.push('new-skill')
    draft.dependencies[0].digest = 'sha256:' + 'b'.repeat(64)
    expect(created).toEqual(original)
    const serialized = JSON.parse(JSON.stringify(created))
    const restored = readAgentPublicationSnapshot(serialized)
    serialized.content.profile.name = 'Changed serialized input'
    for (const value of [created, restored]) {
      for (const nested of [value, value.content, value.content.profile, value.content.profile.preferredSkillNames,
        value.content.dependencies, value.content.dependencies[0]]) expect(Object.isFrozen(nested)).toBe(true)
      expect(() => { value.content.configVersion = 'mutated-version' }).toThrow(TypeError)
      expect(() => { value.content.profile.name = 'mutated-name' }).toThrow(TypeError)
      expect(() => { value.content.dependencies[0]!.digest = 'sha256:' + 'c'.repeat(64) }).toThrow(TypeError)
      expect(() => value.content.profile.preferredSkillNames.push('new-skill')).toThrow(TypeError)
      expect(value).toEqual(original)
    }
    const next = createAgentPublicationSnapshot({ ...created.content, configVersion: 'v2-new-publication' })
    expect(next.digest).not.toBe(created.digest)
    expect(created).toEqual(original)
  })
  it.each(['missing', 'foreign', 'unmanaged', 'invalid-digest'])('fails closed on %s Skill authority', async kind => {
    const f = await fixture(['client-notes'])
    if (kind === 'missing') f.get.mockReturnValue(undefined)
    else f.getSkillPackage.mockResolvedValue({ skillId: kind === 'foreign' ? 'other-skill' : 'client-notes', name: 'client-notes',
      managed: kind !== 'unmanaged', digest: kind === 'invalid-digest' ? 'fake-digest' : 'sha256:' + 'a'.repeat(64) })
    await expect(f.service.getPublicationSnapshot(f.selection)).rejects.toThrow()
  })
  it('rejects stale versions, forged version contents and out-of-date native persona without repairing them', async () => {
    const f = await fixture()
    await expect(f.service.getPublicationSnapshot({ ...f.selection, expectedVersion: 'stale' })).rejects.toThrow()
    const composition = await readFile(join(f.source, 'agent.cordis.yml'), 'utf8')
    await writeFile(join(f.source, 'agent.cordis.yml'), composition.replace('客户助理', '其他角色'))
    await expect(f.service.getPublicationSnapshot(f.selection)).rejects.toThrow('组合')
    await writeFile(join(f.source, 'agent.cordis.yml'), composition)
    const profile = JSON.parse(await readFile(join(f.source, '.paimind-agent.json'), 'utf8'))
    await writeFile(join(f.source, '.paimind-agent.json'), JSON.stringify({ ...profile, role: '版本未更新的修改' }))
    await expect(f.service.getPublicationSnapshot(f.selection)).rejects.toThrow('版本')
  })
  it('rejects linked source files instead of copying arbitrary content', async () => {
    const f = await fixture(), file = join(f.source, 'agent.cordis.yml')
    const target = join(f.source, 'unrelated.txt')
    await writeFile(target, 'private unrelated text'); await rm(file); await symlink(target, file)
    await expect(f.service.getPublicationSnapshot(f.selection)).rejects.toThrow('来源文件')
  })
  it('rejects altered publication content and unknown injected authority fields', async () => {
    const f = await fixture(), snapshot = await f.service.getPublicationSnapshot(f.selection)
    expect(() => readAgentPublicationSnapshot({ ...snapshot, content: { ...snapshot.content, profile: { ...snapshot.content.profile, name: 'Changed' } } })).toThrow()
    expect(() => readAgentPublicationSnapshot({ ...snapshot, userId: 'foreign' })).toThrow()
    expect(() => readAgentPublicationSnapshot({ ...snapshot, content: { ...snapshot.content, role: 'admin' } })).toThrow()
  })
})
