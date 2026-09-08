import { describe, expect, it } from 'vitest'
import { PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS, TYPERT_REMOTE } from '../src/remote.ts'
import { TYPERT } from '../src/typert.ts'

describe('Skill Center strict Remote contract', () => {
  it('preserves business display metadata without changing the canonical skill identity', () => {
    const descriptor = PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS.find(item => item.method === 'listCatalog')!
    const item = {
      id: 'bento-ppt', name: 'bento-ppt', displayNameZh: '演示制作', description: 'Create presentations',
      version: '1.0.0', source: 'PAIMind', license: 'Internal', digest: `sha256:${'a'.repeat(64)}`,
      category: 'content', tags: ['presentation'],
    }
    expect(descriptor.result.schema.parse({ items: [item] })).toEqual({ items: [item] })
    const { displayNameZh, category, tags, ...legacy } = item
    expect(descriptor.result.schema.parse({ items: [legacy] })).toEqual({ items: [legacy] })
  })

  it('publishes one shared descriptor set to Host and Client', () => {
    expect(TYPERT.package).toBe('@hansen/skill-market')
    expect(TYPERT.invocations).toBe(PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS)
    expect(TYPERT_REMOTE.descriptors).toBe(PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS)
    expect(PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS.every(item => item.result.mode === 'strict')).toBe(true)
  })

  it('retains installed titles across the remote boundary without replacing binding names', () => {
    const descriptor = PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS.find(item => item.method === 'listInstalled')!
    const record = { skillId: 'weekly-review', name: 'weekly-review', displayName: '周工作回顾', description: 'Review',
      digest: `sha256:${'a'.repeat(64)}`, sourceFileName: 'SKILL.md', installedAt: 1, updatedAt: 1,
      managed: true, runtimeRequirements: [] }
    expect(descriptor.result.schema.parse({ items: [record] })).toEqual({ items: [record] })
  })

  it('accepts both valid System Skill lifecycle variants and rejects mismatched controls', () => {
    const descriptor = PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS.find(item => item.method === 'listSystemSkills')
    const mandatory = {
      kind: 'system', canonicalId: 'system:genui', name: 'genui', description: 'Generate native UI',
      availability: 'mandatory', userControl: 'locked', sourcePluginId: '@deepseek-ai/dsh-tool-genui',
    }
    const optional = {
      kind: 'system', canonicalId: 'system:paimind-skill-installation', name: 'paimind-skill-installation',
      description: 'Install Business Skills from GitHub', availability: 'optional', userControl: 'atomic',
      sourcePluginId: '@hansen/skill-market',
    }
    expect(descriptor?.result.schema.parse({ items: [mandatory, optional] })).toEqual({ items: [mandatory, optional] })
    expect(() => descriptor?.result.schema.parse({
      items: [{ ...optional, userControl: 'locked' }],
    })).toThrow()
  })
})
