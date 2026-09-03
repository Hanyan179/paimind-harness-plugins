import { describe, expect, it, vi } from 'vitest'
import { getWorkspaceBlueprintCompositionChoices, validateWorkspaceBlueprintComposition } from '../src/index.ts'
import type { WorkspaceBlueprintComposition } from '../src/contract.ts'

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`

const composition: Readonly<WorkspaceBlueprintComposition> = Object.freeze({
  agent: Object.freeze({ agentId: 'agent-1', presetId: 'agent-preset', configVersion: 'v3' }),
  businessSkills: Object.freeze([Object.freeze({ name: 'delivery-risk', digest: digest('a') })]),
})

function sources(overrides: Readonly<{
  agentHealth?: 'healthy' | 'broken'
  agentPresetId?: string
  agentConfigVersion?: string
  enabled?: readonly string[]
  systemNames?: readonly string[]
  missingSkillPackage?: boolean
  packageDigest?: string
}> = {}) {
  const agent = {
    async listProfiles() {
      return { profiles: [{
        agentId: 'agent-1',
        presetId: overrides.agentPresetId ?? 'agent-preset',
        configVersion: overrides.agentConfigVersion ?? 'v3',
        name: 'Delivery Agent',
        health: overrides.agentHealth ?? 'healthy',
      }] }
    },
  }
  const skill = {
    async listInstalled() { return { items: [{ skillId: 'delivery-risk', name: 'delivery-risk', description: 'Review delivery risk' }] } },
    async getUserSkillPolicy() { return { enabledBusinessSkillNames: overrides.enabled ?? ['delivery-risk'] } },
    async listSystemSkills() { return { items: (overrides.systemNames ?? []).map(name => ({ name })) } },
    async getSkillPackage({ skillId }: { readonly skillId: string }) {
      if (overrides.missingSkillPackage === true) throw new Error(`Business Skill package not found: ${skillId}`)
      return { skillId, name: skillId, digest: overrides.packageDigest ?? digest('a') }
    },
  }
  const get = vi.fn((name: string) => name === 'paimindAgentProfiles'
    ? agent
    : name === 'paimindSkillInstaller' ? skill : undefined)
  return { get }
}

describe('Workspace Blueprint authoritative composition validation', () => {
  it('keeps a folder-only package independent from Agent and Skill centers', async () => {
    const get = vi.fn(() => { throw new Error('must not resolve a product center') })
    await expect(validateWorkspaceBlueprintComposition({ get }, {
      agent: null, businessSkills: [],
    })).resolves.toBeUndefined()
    expect(get).not.toHaveBeenCalled()
  })

  it('accepts an exact healthy Agent and enabled live Business Skill folder revision', async () => {
    const source = sources()
    await expect(validateWorkspaceBlueprintComposition(source, composition)).resolves.toBeUndefined()
    expect(source.get.mock.calls.map(([name]) => name)).toEqual([
      'paimindAgentProfiles', 'paimindSkillInstaller',
    ])
  })

  it('fails closed for an unavailable or unhealthy exact Agent revision', async () => {
    await expect(validateWorkspaceBlueprintComposition({ get: () => undefined }, {
      agent: composition.agent, businessSkills: [],
    })).rejects.toThrow('Agent Center is unavailable')
    await expect(validateWorkspaceBlueprintComposition(sources({ agentHealth: 'broken' }), {
      agent: composition.agent, businessSkills: [],
    })).rejects.toThrow('not runnable')
  })

  it('fails closed when the exact Agent preset or config version has drifted', async () => {
    await expect(validateWorkspaceBlueprintComposition(sources({ agentPresetId: 'changed-preset' }), {
      agent: composition.agent, businessSkills: [],
    })).rejects.toThrow('Agent revision is missing or changed')
    await expect(validateWorkspaceBlueprintComposition(sources({ agentConfigVersion: 'v4' }), {
      agent: composition.agent, businessSkills: [],
    })).rejects.toThrow('Agent revision is missing or changed')
  })

  it('fails closed for disabled, conflicting, or changed Business Skill bindings', async () => {
    await expect(validateWorkspaceBlueprintComposition(sources({ enabled: [] }), {
      agent: null, businessSkills: composition.businessSkills,
    })).rejects.toThrow('not enabled')
    await expect(validateWorkspaceBlueprintComposition(sources({ systemNames: ['delivery-risk'] }), {
      agent: null, businessSkills: composition.businessSkills,
    })).rejects.toThrow('collides with a System Skill')
    await expect(validateWorkspaceBlueprintComposition(sources({ packageDigest: digest('b') }), {
      agent: null, businessSkills: composition.businessSkills,
    })).rejects.toThrow('digest mismatch')
  })

  it('fails closed when an enabled Business Skill package is missing', async () => {
    await expect(validateWorkspaceBlueprintComposition(sources({ missingSkillPackage: true }), {
      agent: null, businessSkills: composition.businessSkills,
    })).rejects.toThrow('Business Skill package not found')
  })

  it('projects current healthy Agents and enabled exact Business Skill folder revisions on demand', async () => {
    await expect(getWorkspaceBlueprintCompositionChoices(sources())).resolves.toEqual({
      schema: 'paimind.workspace-blueprint-composition-choices/v1',
      agents: { status: 'ready', items: [{ agentId: 'agent-1', presetId: 'agent-preset', configVersion: 'v3', name: 'Delivery Agent' }] },
      businessSkills: { status: 'ready', items: [{ name: 'delivery-risk', description: 'Review delivery risk', digest: digest('a') }] },
    })
    await expect(getWorkspaceBlueprintCompositionChoices(sources({ agentHealth: 'broken', enabled: [] }))).resolves.toEqual({
      schema: 'paimind.workspace-blueprint-composition-choices/v1',
      agents: { status: 'ready', items: [] },
      businessSkills: { status: 'ready', items: [] },
    })
  })

  it('keeps folder-only authoring operable when either optional provider is absent or broken', async () => {
    await expect(getWorkspaceBlueprintCompositionChoices({ get: () => undefined })).resolves.toEqual({
      schema: 'paimind.workspace-blueprint-composition-choices/v1',
      agents: { status: 'unavailable', items: [] },
      businessSkills: { status: 'unavailable', items: [] },
    })
    const source = sources()
    const agent = source.get('paimindAgentProfiles')
    const brokenSkill = { ...source.get('paimindSkillInstaller') as object, listInstalled: async () => { throw new Error('offline') } }
    await expect(getWorkspaceBlueprintCompositionChoices({
      get: name => name === 'paimindAgentProfiles' ? agent : name === 'paimindSkillInstaller' ? brokenSkill : undefined,
    })).resolves.toMatchObject({ agents: { status: 'ready' }, businessSkills: { status: 'error', items: [] } })
  })
})
