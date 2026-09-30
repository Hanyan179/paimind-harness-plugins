import { describe, expect, it } from 'vitest'
import { PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS, TYPERT_REMOTE } from '../src/remote.ts'
import { TYPERT } from '../src/typert.ts'

describe('Skill Center strict Remote contract', () => {
  it('preserves current enterprise eligibility through the original strict result codec', () => {
    const descriptor = PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS.find(item => item.method === 'listInstalled')!
    const record = { skillId: 'customer-notes', name: 'customer-notes', description: 'Assigned method',
      digest: 'sha256:' + 'a'.repeat(64), sourceFileName: 'Enterprise Skill publication', installedAt: 1, updatedAt: 1,
      managed: true, runtimeRequirements: [], publicationEligible: true, publication: {
        schema: 'paimind.skill-adoption/v1', adoptedAt: 1, tenantId: 'test',
        publicationId: 'eb6ed5e2-d7d8-4fb9-937f-28cd5a2f0fae', sourceUserId: 'ab301a92-c6d7-4af8-8ef7-7db59407499e',
        name: 'customer-notes', packageDigest: 'sha256:' + 'b'.repeat(64), archiveDigest: 'sha256:' + 'a'.repeat(64),
        archiveBytes: 100, expandedBytes: 80, entryCount: 1,
      } }
    for (const publicationEligible of [true, false]) {
      const result = { items: [{ ...record, publicationEligible }] }
      expect(descriptor.result.schema.parse(result)).toEqual(result)
    }
    expect(() => descriptor.result.schema.parse({ items: [{ ...record, publicationEligible: 'true' }] })).toThrow()
    const { publicationEligible: _eligible, ...legacy } = record
    expect(descriptor.result.schema.parse({ items: [legacy] })).toEqual({ items: [legacy] })
  })
  it('publishes one shared descriptor set to Host and Client', () => {
    expect(TYPERT.package).toBe('@paimind/skill-market')
    expect(TYPERT.invocations).toBe(PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS)
    expect(TYPERT_REMOTE.descriptors).toBe(PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS)
    expect(PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS.every(item => item.result.mode === 'strict')).toBe(true)
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
      sourcePluginId: '@paimind/skill-market',
    }
    expect(descriptor?.result.schema.parse({ items: [mandatory, optional] })).toEqual({ items: [mandatory, optional] })
    expect(() => descriptor?.result.schema.parse({
      items: [{ ...optional, userControl: 'locked' }],
    })).toThrow()
  })
})
