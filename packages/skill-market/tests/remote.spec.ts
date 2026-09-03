import { describe, expect, it } from 'vitest'
import { PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS, TYPERT_REMOTE } from '../src/remote.ts'
import { TYPERT } from '../src/typert.ts'

describe('Skill Center strict Remote contract', () => {
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
