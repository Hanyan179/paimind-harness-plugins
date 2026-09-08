import { describe, expect, it } from 'vitest'
import { PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS, TYPERT_REMOTE } from '../src/remote.ts'
import { TYPERT } from '../src/typert.ts'

describe('Workspace Blueprint strict Remote contract', () => {
  it('publishes one shared eleven-method descriptor set to Host and Client', () => {
    expect(TYPERT.package).toBe('@hansen/workspace-blueprints')
    expect(TYPERT.invocations).toBe(PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS)
    expect(TYPERT_REMOTE.descriptors).toBe(PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS)
    expect(PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS.map(item => item.method)).toEqual([
      'listBlueprints',
      'getCompositionChoices',
      'materializeBlueprint',
      'bindEntryAgentSession',
      'publishBlueprint',
      'getBlueprint',
      'readBlueprintText',
      'writeBlueprintText',
      'createBlueprintDirectory',
      'deleteBlueprintFile',
      'updateBlueprintComposition',
    ])
    expect(PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS.every(item => item.result.mode === 'strict')).toBe(true)
  })

  it('requires a real file index and canonical exact composition', () => {
    const descriptor = PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS.find(item => item.method === 'listBlueprints')!
    const value = {
      revision: 0,
      items: [{
        schema: 'paimind.workspace-blueprint/v1', blueprintId: 'research-decision-brief', version: '1.0.0',
        name: 'Research brief', description: 'Prepare a decision brief.', category: 'research', tags: ['research'],
        source: 'builtin', digest: `sha256:${'a'.repeat(64)}`, fileCount: 1, totalBytes: 12,
        createdAt: 0, updatedAt: 0, versionCount: 1,
        composition: { agent: null, businessSkills: [] },
        files: [{ path: 'README.md', kind: 'text', size: 12 }],
      }],
    }
    expect(descriptor.result.schema.parse(value)).toEqual(value)
    expect(() => descriptor.result.schema.parse({ ...value, items: [{ ...value.items[0], files: undefined }] })).toThrow()
    expect(() => descriptor.result.schema.parse({
      ...value,
      items: [{ ...value.items[0], composition: undefined, recommendations: {} }],
    })).toThrow()
  })

  it('does not accept a caller-controlled target path in the materialization request', () => {
    const descriptor = PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS.find(item => item.method === 'materializeBlueprint')!
    const schema = descriptor.parameters[0]!.codec.schema
    const request = {
      workspaceId: 'workspace-1', blueprintId: 'research-decision-brief', version: '1.0.0',
      expectedDigest: `sha256:${'a'.repeat(64)}`,
    }
    expect(schema.parse(request)).toEqual(request)
    expect(() => schema.parse({ ...request, path: '/tmp/caller-controlled' })).toThrow()
  })

  it('publishes only from canonical workspaceId and validates exact composition bindings', () => {
    const descriptor = PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS.find(item => item.method === 'publishBlueprint')!
    const schema = descriptor.parameters[0]!.codec.schema
    const request = {
      workspaceId: 'workspace-1', blueprintId: 'team-space', version: '1.0.0',
      name: 'Team space', description: 'Team workspace.', category: 'general', tags: [],
      composition: {
        agent: { agentId: 'agent-1', presetId: 'standard', configVersion: 'v1' },
        businessSkills: [{ name: 'customer-research', digest: `sha256:${'b'.repeat(64)}` }],
      },
    }
    expect(schema.parse(request)).toEqual(request)
    expect(() => schema.parse({ ...request, sourcePath: '/tmp/caller-controlled' })).toThrow()
    expect(() => schema.parse({ ...request, composition: { recommendations: [] } })).toThrow()
  })

  it('keeps choice projection read-only and accepts no caller-supplied Agent ref when binding an entry Session', () => {
    const choices = PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS.find(item => item.method === 'getCompositionChoices')!
    expect(choices.parameters).toEqual([])
    expect(choices.result.schema.parse({
      schema: 'paimind.workspace-blueprint-composition-choices/v1',
      agents: { status: 'ready', items: [{ agentId: 'agent-1', presetId: 'preset-1', configVersion: 'v1', name: 'Agent one' }] },
      businessSkills: { status: 'unavailable', items: [] },
    })).toMatchObject({ agents: { status: 'ready' }, businessSkills: { status: 'unavailable' } })

    const bind = PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS.find(item => item.method === 'bindEntryAgentSession')!
    const request = {
      workspaceId: 'workspace-1', sessionId: 'session-1', blueprintId: 'team-space', version: '1.0.0',
      expectedDigest: `sha256:${'a'.repeat(64)}`,
    }
    expect(bind.parameters[0]!.codec.schema.parse(request)).toEqual(request)
    expect(() => bind.parameters[0]!.codec.schema.parse({
      ...request, agentId: 'caller-agent', presetId: 'caller-preset', configVersion: 'caller-version',
    })).toThrow()
  })

  it('requires optimistic locking for immutable composition revisions and explicit recursive deletion', () => {
    const revise = PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS
      .find(item => item.method === 'updateBlueprintComposition')!.parameters[0]!.codec.schema
    const request = {
      blueprintId: 'team-space', version: '1.0.0', expectedDigest: `sha256:${'a'.repeat(64)}`,
      composition: { agent: null, businessSkills: [] },
    }
    expect(revise.parse(request)).toEqual(request)
    expect(() => revise.parse({ ...request, recommendations: {} })).toThrow()

    const remove = PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS
      .find(item => item.method === 'deleteBlueprintFile')!.parameters[0]!.codec.schema
    expect(remove.parse({
      blueprintId: 'team-space', version: '1.0.0', expectedDigest: `sha256:${'a'.repeat(64)}`,
      path: 'docs', recursive: true,
    })).toMatchObject({ path: 'docs', recursive: true })
  })
})
