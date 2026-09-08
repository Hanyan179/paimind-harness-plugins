import { describe, expect, it } from 'vitest'
import type {
  PaimindBusinessSkillReference,
  PaimindSkillScopeInputV1,
  PaimindSystemSkillReference,
} from '@hansen/contracts'
import { resolvePaimindSkillScope } from '../src/scope.js'

const mandatory = (name: string): PaimindSystemSkillReference => ({
  kind: 'system', canonicalId: `system:${name}`, name, description: `${name} system capability`,
  availability: 'mandatory', userControl: 'locked', sourcePluginId: `@hansen/${name}`,
})

const optional = (name: string): PaimindSystemSkillReference => ({
  kind: 'system', canonicalId: `system:${name}`, name, description: `${name} optional capability`,
  availability: 'optional', userControl: 'atomic', sourcePluginId: `@hansen/${name}`,
})

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`

const business = (name: string, revision = digest('a')): PaimindBusinessSkillReference => ({
  kind: 'business', canonicalId: `business:${name}`, name, description: `${name} business method`,
  digest: revision,
})

function input(overrides: Partial<PaimindSkillScopeInputV1> = {}): PaimindSkillScopeInputV1 {
  return {
    schema: 'paimind.skill-scope-input/v1', sessionKind: 'direct',
    mandatorySystemSkills: [mandatory('genui')],
    optionalSystemSkills: [optional('web-search'), optional('vision')],
    installedBusinessSkills: [business('delivery-risk'), business('supplier-review'), business('forecasting')],
    userPolicy: {
      schema: 'paimind.user-skill-policy/v1', revision: 1,
      enabledOptionalSystemSkillNames: ['web-search'],
      enabledBusinessSkillNames: ['delivery-risk', 'supplier-review'],
      directBusinessSkillNames: ['delivery-risk'],
    },
    agentBusinessSkillNames: [], workspaceComposition: undefined, sessionBusinessSkillNames: [],
    ...overrides,
  }
}

describe('Skill Scope Resolver', () => {
  it('composes a direct Session from eligible System, direct-default and Session references', () => {
    expect(resolvePaimindSkillScope(input({ sessionBusinessSkillNames: ['supplier-review', 'forecasting'] }))
      .map(skill => skill.name)).toEqual(['genui', 'web-search', 'delivery-risk', 'supplier-review'])
  })

  it('replaces direct defaults with Agent attachments and deduplicates Session overlap', () => {
    expect(resolvePaimindSkillScope(input({
      sessionKind: 'agent', agentBusinessSkillNames: ['supplier-review'],
      sessionBusinessSkillNames: ['supplier-review', 'forecasting'],
    })).map(skill => skill.name)).toEqual(['genui', 'web-search', 'supplier-review'])
  })

  it('adds exact Workspace bindings to both direct and Agent Sessions without replacing their own scope', () => {
    const workspaceComposition = {
      schema: 'paimind.workspace-composition/v1' as const,
      workspaceId: 'workspace-1',
      businessSkills: [{ name: 'supplier-review', digest: digest('a') }],
    }
    expect(resolvePaimindSkillScope(input({ workspaceComposition })).map(skill => skill.name))
      .toEqual(['genui', 'web-search', 'delivery-risk', 'supplier-review'])
    expect(resolvePaimindSkillScope(input({
      sessionKind: 'agent', agentBusinessSkillNames: ['delivery-risk'], workspaceComposition,
    })).map(skill => skill.name)).toEqual(['genui', 'web-search', 'delivery-risk', 'supplier-review'])
  })

  it('keeps disabled Workspace bindings outside the catalog and fails closed on enabled stale revisions', () => {
    const disabled = {
      schema: 'paimind.workspace-composition/v1' as const,
      workspaceId: 'workspace-1',
      businessSkills: [{ name: 'forecasting', digest: digest('f') }],
    }
    expect(resolvePaimindSkillScope(input({ workspaceComposition: disabled })).map(skill => skill.name))
      .toEqual(['genui', 'web-search', 'delivery-risk'])

    const stale = {
      schema: 'paimind.workspace-composition/v1' as const,
      workspaceId: 'workspace-1',
      businessSkills: [{ name: 'supplier-review', digest: digest('b') }],
    }
    expect(() => resolvePaimindSkillScope(input({ workspaceComposition: stale }))).toThrow(/digest mismatch/)
    expect(() => resolvePaimindSkillScope(input({
      installedBusinessSkills: [business('delivery-risk')],
      workspaceComposition: {
        schema: 'paimind.workspace-composition/v1', workspaceId: 'workspace-1',
        businessSkills: [{ name: 'supplier-review', digest: digest('a') }],
      },
    }))).toThrow(/not installed/)
  })

  it('does not persist results or mutate any source arrays', () => {
    const candidate = input({ sessionBusinessSkillNames: ['supplier-review'] })
    const first = resolvePaimindSkillScope(candidate)
    const second = resolvePaimindSkillScope(candidate)
    expect(first).not.toBe(second)
    expect(first).toEqual(second)
    expect(candidate.sessionBusinessSkillNames).toEqual(['supplier-review'])
    expect(Object.isFrozen(first)).toBe(true)
  })

  it('fails closed when a Business Skill collides with any visible System Skill', () => {
    expect(() => resolvePaimindSkillScope(input({
      optionalSystemSkills: [optional('delivery-risk')],
    }))).toThrow(/name collision/)
  })

  it('fails closed for inconsistent canonical definitions and invalid scope input', () => {
    expect(() => resolvePaimindSkillScope(input({
      installedBusinessSkills: [business('delivery-risk'), {
        ...business('delivery-risk', digest('b')), description: 'Conflicting package summary',
      }],
    }))).toThrow(/conflicting canonical/)
    expect(() => resolvePaimindSkillScope(input({
      sessionKind: 'direct', agentBusinessSkillNames: ['supplier-review'],
    }))).toThrow(/direct Session/)
    expect(() => resolvePaimindSkillScope(input({
      mandatorySystemSkills: [optional('web-search')], optionalSystemSkills: [],
    }))).toThrow(/must be locked/)
  })
})
