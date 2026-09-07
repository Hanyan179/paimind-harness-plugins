import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaimindWorkspaceCompositionSnapshotV1 } from '@paimind/contracts'
import {
  PaimindSkillInstallerService,
  type SkillInstallerHostAgent,
  type SkillInstallerHostContext,
  type SkillInstallerHostSession,
} from '../src/installer.js'

const roots: string[] = []

interface TestProviderRow {
  readonly name: string
  readonly provider: string
  readonly locator: string
  readonly invocation: { readonly modelInvocable: boolean; readonly userInvocable: boolean }
}

interface TestProvider {
  list(): Promise<readonly TestProviderRow[]>
  get(row: TestProviderRow): Promise<{ readonly content: string; readonly resourceBase?: { readonly path: string } } | undefined>
}

interface TestAgent extends SkillInstallerHostAgent {
  readonly provider: { current?: TestProvider; disposed: boolean; invalidations: number }
}

function testAgent(session: SkillInstallerHostSession, composedPreset?: string): TestAgent {
  const state: TestAgent['provider'] = { disposed: false, invalidations: 0 }
  const livePreset = composedPreset ?? session.header.agentPreset
  return {
    id: session.id,
    session,
    provider: state,
    ctx: {
      get(name: 'skills' | 'agentPresets') {
        if (name === 'agentPresets') {
          return { composedPreset: () => livePreset }
        }
        return {
          registerProvider(create: (control: { readonly signal: AbortSignal; invalidate(): void }) => TestProvider) {
            const controller = new AbortController()
            state.current = create({ signal: controller.signal, invalidate: () => { state.invalidations += 1 } })
            return () => {
              state.disposed = true
              state.current = undefined
              controller.abort()
            }
          },
        }
      },
    },
  }
}

async function projectedRows(agent: TestAgent): Promise<readonly TestProviderRow[]> {
  return await agent.provider.current!.list()
}

async function projectedContent(agent: TestAgent, name: string): Promise<string | undefined> {
  const row = (await projectedRows(agent)).find(candidate => candidate.name === name)
  return row === undefined ? undefined : (await agent.provider.current!.get(row))?.content
}

async function runtimeFixture(
  profileSkills: Readonly<Record<string, readonly string[] | undefined>> = {},
  agentSourceInitiallyAvailable = true,
  withoutGenui = false,
) {
  const base = await mkdtemp(join(tmpdir(), 'paimind-session-skills-'))
  roots.push(base)
  const sessions = new Map<string, SkillInstallerHostSession>()
  const agents = new Map<string, TestAgent>()
  const lifecycle = new Map<string, (...args: any[]) => any>()
  const disposers: (() => void | Promise<void>)[] = []
  const workspaceCompositions = new Map<string, Readonly<PaimindWorkspaceCompositionSnapshotV1>>()
  let agentSourceAvailable = agentSourceInitiallyAvailable
  const getWorkspaceComposition = vi.fn(async (input: { readonly sessionId?: string; readonly workspaceId?: string }) => {
    return input.sessionId === undefined ? undefined : workspaceCompositions.get(input.sessionId)
  })
  const context = {
    reflect: { provide: () => () => {} },
    webServer: { register: () => () => {} },
    skills: {
      async list() {
        return withoutGenui ? [] : [{
          name: 'genui', description: 'Generate native UI', source: 'bundled', provider: '@deepseek-ai/genui',
        }]
      },
      register: () => () => {},
    },
    sessions: { get: (id: string) => sessions.get(id) },
    ...(withoutGenui ? { loader: {
      entries: () => [], await: async () => {},
      resolve: () => { throw new Error('missing GenUI') }, update: async () => {},
    } } : {}),
    agents: { get: (id: string) => agents.get(id), list: () => [...agents.values()] },
    get(name: string) {
      if (name === 'paimindAgentProfiles') {
        return agentSourceAvailable
          ? { async businessSkillNamesForPreset(presetId: string) { return profileSkills[presetId] } }
          : undefined
      }
      if (name === 'paimindWorkspaceBlueprints') return { getWorkspaceComposition }
      return undefined
    },
    on(event: string, listener: (...args: any[]) => any) {
      lifecycle.set(event, listener)
      return () => { lifecycle.delete(event) }
    },
    effect(install: () => void | (() => void | Promise<void>)) {
      const dispose = install()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
  } satisfies SkillInstallerHostContext & { readonly reflect: unknown }
  const service = new PaimindSkillInstallerService(context, {
    skillRoot: join(base, 'skills'), stateRoot: join(base, 'state'), now: () => 42,
    bundledSkillBodies: { installation: 'Install.', authoring: 'Author.' },
  })
  const save = async (name: string, instructions = `${name} instructions`) => {
    await service.saveSkillSource({ name, description: `${name} business workflow`, instructions })
  }
  const saveRecord = async (name: string, instructions = `${name} instructions`) => {
    return await service.saveSkillSource({ name, description: `${name} business workflow`, instructions })
  }
  const addAgent = (session: SkillInstallerHostSession, composedPreset?: string) => {
    sessions.set(session.id, session)
    const agent = testAgent(session, composedPreset)
    agents.set(agent.id, agent)
    lifecycle.get('agent/created')?.({ agent })
    return agent
  }
  const preStep = async (agent: TestAgent, next: () => Promise<unknown> = async () => ({ kind: 'enter' })) => {
    return await lifecycle.get('agent/pre-step')?.({ agent }, next)
  }
  const disposeAgent = (agent: TestAgent) => {
    lifecycle.get('agent/disposed')?.({ agent })
    agents.delete(agent.id)
  }
  return {
    base, service, sessions, agents, lifecycle, disposers, workspaceCompositions, getWorkspaceComposition,
    save, saveRecord, addAgent, preStep, disposeAgent,
    setAgentSourceAvailable(value: boolean) { agentSourceAvailable = value },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async root => { await rm(root, { recursive: true, force: true }) }))
})

describe('live native Session Business Skill projection', () => {
  it('allows ordinary and Agent turns to execute with their selected Business Skills when GenUI is absent', async () => {
    const fixture = await runtimeFixture({ 'review-agent': ['agent-review'] }, true, true)
    await fixture.save('direct-review')
    await fixture.save('agent-review')
    await fixture.service.replaceUserSkillPolicy({
      expectedRevision: 0, enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: ['direct-review', 'agent-review'], directBusinessSkillNames: ['direct-review'],
    })
    const direct = fixture.addAgent({ id: 'direct', header: { agentPreset: 'standard' } })
    const agent = fixture.addAgent({ id: 'review', header: { agentPreset: 'review-agent' } })
    for (const target of [direct, agent]) {
      const next = vi.fn(async () => 'executed')
      await expect(fixture.preStep(target, next)).resolves.toBe('executed')
      expect(next).toHaveBeenCalledOnce()
    }
    expect((await projectedRows(direct)).map(row => row.name)).toEqual(['direct-review'])
    expect((await projectedRows(agent)).map(row => row.name)).toEqual(['agent-review'])
  })

  it('keeps Skill Center live before Agent Center mounts and resolves the later source on the next step', async () => {
    const fixture = await runtimeFixture({ 'late-agent': ['late-agent-method'] }, false)
    await fixture.save('late-agent-method')
    await fixture.service.replaceUserSkillPolicy({
      expectedRevision: 0,
      enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: ['late-agent-method'],
      directBusinessSkillNames: [],
    })
    await expect(fixture.service.listInstalled()).resolves.toMatchObject({
      items: [expect.objectContaining({ name: 'late-agent-method' })],
    })
    const agent = fixture.addAgent({ id: 'late-agent-session', header: { agentPreset: 'late-agent' } })
    expect(await projectedRows(agent)).toEqual([])

    fixture.setAgentSourceAvailable(true)
    await fixture.preStep(agent)

    expect((await projectedRows(agent)).map(row => row.name)).toEqual(['late-agent-method'])
  })

  it('hydrates a selected blank Session before the first native catalog read', async () => {
    const fixture = await runtimeFixture()
    await fixture.save('first-turn-method')
    await fixture.service.replaceUserSkillPolicy({
      expectedRevision: 0,
      enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: ['first-turn-method'],
      directBusinessSkillNames: [],
    })
    const session = { id: 'blank-selected-session', header: {} } satisfies SkillInstallerHostSession
    fixture.sessions.set(session.id, session)
    await fixture.service.replaceSessionBusinessSkillSelection({
      sessionId: session.id, expectedRevision: 0, skillNames: ['first-turn-method'],
    })

    const agent = fixture.addAgent(session)

    expect((await projectedRows(agent)).map(row => row.name)).toEqual(['first-turn-method'])
    expect(await projectedContent(agent, 'first-turn-method')).toBe('first-turn-method instructions')
  })

  it('combines direct defaults with revisioned Session selection and refreshes before next()', async () => {
    const fixture = await runtimeFixture()
    await fixture.save('default-method')
    await fixture.save('temporary-method')
    await fixture.service.replaceUserSkillPolicy({
      expectedRevision: 0,
      enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: ['default-method', 'temporary-method'],
      directBusinessSkillNames: ['default-method'],
    })
    const session = { id: 'direct-session', header: {} } satisfies SkillInstallerHostSession
    const agent = fixture.addAgent(session)

    expect((await projectedRows(agent)).map(row => row.name)).toEqual(['default-method'])
    await expect(fixture.service.replaceSessionBusinessSkillSelection({
      sessionId: session.id, expectedRevision: 0, skillNames: ['temporary-method'],
    })).resolves.toEqual({
      schema: 'paimind.session-business-skill-selection/v1', revision: 1, skillNames: ['temporary-method'],
    })
    expect((await projectedRows(agent)).map(row => row.name)).toEqual(['default-method', 'temporary-method'])
    expect(await projectedContent(agent, 'temporary-method')).toBe('temporary-method instructions')
    const temporaryRow = (await projectedRows(agent)).find(row => row.name === 'temporary-method')!
    expect((await agent.provider.current!.get(temporaryRow))?.resourceBase?.path).toBe(
      join(fixture.base, 'skills', 'temporary-method'),
    )

    const editable = await fixture.service.getSkillSource({ skillId: 'temporary-method' })
    await fixture.service.saveSkillSource({
      name: 'temporary-method', description: editable.description,
      instructions: 'active projection refresh', expectedDigest: editable.digest,
    })
    expect(await projectedContent(agent, 'temporary-method')).toBe('active projection refresh')

    await expect(fixture.service.replaceSessionBusinessSkillSelection({
      sessionId: session.id, expectedRevision: 0, skillNames: [],
    })).rejects.toThrow(/已更新/)
    await writeFile(
      join(fixture.base, 'skills', 'temporary-method', 'SKILL.md'),
      '---\nname: temporary-method\ndescription: temporary-method business workflow\n---\n\nrefreshed before next\n',
    )
    let bodyObservedInsideNext: string | undefined
    await fixture.preStep(agent, async () => {
      bodyObservedInsideNext = await projectedContent(agent, 'temporary-method')
      return { kind: 'enter' }
    })
    expect(bodyObservedInsideNext).toBe('refreshed before next')

    fixture.disposeAgent(agent)
    expect(agent.provider.disposed).toBe(true)
    await expect(fixture.service.getSessionBusinessSkillSelection({ sessionId: session.id })).resolves.toMatchObject({
      revision: 1, skillNames: ['temporary-method'],
    })
    const rebuilt = fixture.addAgent(session)
    await fixture.preStep(rebuilt)
    expect((await projectedRows(rebuilt)).map(row => row.name)).toEqual(['default-method', 'temporary-method'])
    await fixture.service.uninstall({ skillId: 'temporary-method' })
    expect((await projectedRows(rebuilt)).map(row => row.name)).toEqual(['default-method'])
  })

  it('replaces direct defaults at every Agent boundary and removes disabled Agent skills without a fallback provider', async () => {
    const fixture = await runtimeFixture({
      'managed-agent': ['agent-method'],
      'empty-managed-agent': [],
      'collision-agent': ['genui'],
    })
    await fixture.save('direct-method')
    await fixture.save('agent-method')
    await fixture.save('session-method')
    await fixture.service.replaceUserSkillPolicy({
      expectedRevision: 0,
      enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: ['direct-method', 'agent-method', 'session-method'],
      directBusinessSkillNames: ['direct-method'],
    })
    const session = {
      id: 'agent-session', header: { agentPreset: 'managed-agent' },
    } satisfies SkillInstallerHostSession
    const agent = fixture.addAgent(session)
    await fixture.service.replaceSessionBusinessSkillSelection({
      sessionId: session.id, expectedRevision: 0, skillNames: ['session-method'],
    })
    expect((await projectedRows(agent)).map(row => row.name)).toEqual(['agent-method', 'session-method'])
    expect((await projectedRows(agent)).some(row => row.name === 'genui')).toBe(false)

    const emptyManaged = fixture.addAgent({
      id: 'empty-agent-session', header: { agentPreset: 'empty-managed-agent' },
    })
    await fixture.preStep(emptyManaged)
    expect(await projectedRows(emptyManaged)).toEqual([])
    const standardDirect = fixture.addAgent({
      id: 'standard-direct-session', header: { agentPreset: 'standard' },
    })
    await fixture.preStep(standardDirect)
    expect((await projectedRows(standardDirect)).map(row => row.name)).toEqual(['direct-method'])
    const unmanaged = fixture.addAgent({
      id: 'unmanaged-session', header: { agentPreset: 'unmanaged-harness-preset' },
    })
    await fixture.preStep(unmanaged)
    expect(await projectedRows(unmanaged)).toEqual([])
    await fixture.service.replaceSessionBusinessSkillSelection({
      sessionId: unmanaged.session.id, expectedRevision: 0, skillNames: ['session-method'],
    })
    expect((await projectedRows(unmanaged)).map(row => row.name)).toEqual(['session-method'])
    const collision = fixture.addAgent({
      id: 'collision-session', header: { agentPreset: 'collision-agent' },
    })
    await expect(fixture.preStep(collision)).rejects.toThrow(/与当前系统能力冲突/)

    await fixture.service.replaceUserSkillPolicy({
      expectedRevision: 1,
      enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: ['direct-method', 'session-method'],
      directBusinessSkillNames: ['direct-method'],
    })
    const rows = await projectedRows(agent)
    expect(rows.map(row => row.name)).toEqual(['session-method'])
    expect(rows.some(row => row.name === 'agent-method')).toBe(false)
    expect(await projectedContent(agent, 'agent-method')).toBeUndefined()
  })

  it('merges exact Workspace bindings into direct and Agent catalogs through the structural source service', async () => {
    const fixture = await runtimeFixture({ 'managed-agent': ['agent-method'] })
    await fixture.save('direct-method')
    await fixture.save('agent-method')
    await fixture.saveRecord('workspace-method')
    const workspace = await fixture.service.getSkillPackage({ skillId: 'workspace-method' })
    await fixture.save('session-method')
    await fixture.service.replaceUserSkillPolicy({
      expectedRevision: 0,
      enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: ['direct-method', 'agent-method', 'workspace-method', 'session-method'],
      directBusinessSkillNames: ['direct-method'],
    })
    const workspaceBinding = {
      schema: 'paimind.workspace-composition/v1' as const,
      workspaceId: 'workspace-one',
      businessSkills: [{
        name: 'workspace-method', digest: workspace.digest as `sha256:${string}`,
      }],
    }
    const directSession = {
      id: 'workspace-direct-session', header: { cwd: '/native/workspace-one' },
    } satisfies SkillInstallerHostSession
    fixture.workspaceCompositions.set(directSession.id, workspaceBinding)
    const direct = fixture.addAgent(directSession)
    expect((await projectedRows(direct)).map(row => row.name)).toEqual(['direct-method', 'workspace-method'])

    const agentSession = {
      id: 'workspace-agent-session', header: { cwd: '/native/workspace-one', agentPreset: 'managed-agent' },
    } satisfies SkillInstallerHostSession
    fixture.workspaceCompositions.set(agentSession.id, workspaceBinding)
    const agent = fixture.addAgent(agentSession)
    await fixture.service.replaceSessionBusinessSkillSelection({
      sessionId: agentSession.id, expectedRevision: 0, skillNames: ['session-method'],
    })
    expect((await projectedRows(agent)).map(row => row.name))
      .toEqual(['agent-method', 'session-method', 'workspace-method'])
    expect(fixture.getWorkspaceComposition).toHaveBeenCalledWith({
      sessionId: agentSession.id, cwd: '/native/workspace-one',
    })

    const source = await fixture.service.getSkillSource({ skillId: 'workspace-method' })
    await fixture.service.saveSkillSource({
      name: source.name, description: source.description,
      instructions: `${source.instructions}\nChanged after the Blueprint was materialized.`,
      expectedDigest: source.digest,
    })
    const next = vi.fn(async () => ({ kind: 'enter' }))
    await expect(fixture.preStep(agent, next)).rejects.toThrow(/digest mismatch/)
    expect(next).not.toHaveBeenCalled()
  })

  it('treats disabled Workspace bindings as ineligible instead of bypassing User Skill Policy', async () => {
    const fixture = await runtimeFixture()
    await fixture.saveRecord('workspace-disabled')
    const workspace = await fixture.service.getSkillPackage({ skillId: 'workspace-disabled' })
    await fixture.service.replaceUserSkillPolicy({
      expectedRevision: 0,
      enabledOptionalSystemSkillNames: [], enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    })
    const session = { id: 'workspace-disabled-session', header: {} } satisfies SkillInstallerHostSession
    fixture.workspaceCompositions.set(session.id, {
      schema: 'paimind.workspace-composition/v1', workspaceId: 'workspace-two',
      businessSkills: [{
        name: 'workspace-disabled', digest: workspace.digest as `sha256:${string}`,
      }],
    })
    const agent = fixture.addAgent(session)
    await fixture.preStep(agent)
    expect(await projectedRows(agent)).toEqual([])
  })

  it('uses the live composed Preset when the durable Session header still contains its creation Preset', async () => {
    const fixture = await runtimeFixture({ 'managed-agent': ['agent-method'] })
    await fixture.save('agent-method')
    const session = {
      id: 'late-selected-agent-session', header: { agentPreset: 'paimind' },
    } satisfies SkillInstallerHostSession
    const agent = fixture.addAgent(session, 'managed-agent')

    await fixture.preStep(agent)

    expect((await projectedRows(agent)).map(row => row.name)).toEqual(['agent-method'])
  })

  it('fails closed for unavailable Session selections without advancing revision or touching the Session log', async () => {
    const fixture = await runtimeFixture()
    await fixture.save('disabled-method')
    await fixture.service.replaceUserSkillPolicy({
      expectedRevision: 0,
      enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: [],
      directBusinessSkillNames: [],
    })
    const append = vi.fn()
    const session = { id: 'isolated-session', header: {}, append } as unknown as SkillInstallerHostSession
    fixture.sessions.set(session.id, session)
    await expect(fixture.service.replaceSessionBusinessSkillSelection({
      sessionId: session.id, expectedRevision: 0, skillNames: ['disabled-method'],
    })).rejects.toThrow(/未安装或未启用/)
    await expect(fixture.service.getSessionBusinessSkillSelection({ sessionId: session.id })).resolves.toMatchObject({
      revision: 0, skillNames: [],
    })
    expect(append).not.toHaveBeenCalled()
  })

  it('lets the user remove disabled Session selections one at a time without allowing new disabled attachments', async () => {
    const fixture = await runtimeFixture()
    await fixture.save('disabled-one')
    await fixture.save('disabled-two')
    await fixture.service.replaceUserSkillPolicy({
      expectedRevision: 0,
      enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: ['disabled-one', 'disabled-two'],
      directBusinessSkillNames: [],
    })
    const session = { id: 'disabled-cleanup-session', header: {} } satisfies SkillInstallerHostSession
    fixture.addAgent(session)
    await fixture.service.replaceSessionBusinessSkillSelection({
      sessionId: session.id, expectedRevision: 0, skillNames: ['disabled-one', 'disabled-two'],
    })
    await fixture.service.replaceUserSkillPolicy({
      expectedRevision: 1,
      enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: [],
      directBusinessSkillNames: [],
    })

    await expect(fixture.service.replaceSessionBusinessSkillSelection({
      sessionId: session.id, expectedRevision: 1, skillNames: ['disabled-two'],
    })).resolves.toMatchObject({ revision: 2, skillNames: ['disabled-two'] })
    await expect(fixture.service.replaceSessionBusinessSkillSelection({
      sessionId: session.id, expectedRevision: 2, skillNames: ['disabled-one', 'disabled-two'],
    })).rejects.toThrow(/\u672a\u5b89\u88c5\u6216\u672a\u542f\u7528/)
    await expect(fixture.service.replaceSessionBusinessSkillSelection({
      sessionId: session.id, expectedRevision: 2, skillNames: [],
    })).resolves.toMatchObject({ revision: 3, skillNames: [] })
  })

  it('does not report a durable mutation as failed when only eager projection refresh fails', async () => {
    const fixture = await runtimeFixture()
    await fixture.save('active-method')
    await fixture.service.replaceUserSkillPolicy({
      expectedRevision: 0,
      enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: ['active-method'],
      directBusinessSkillNames: ['active-method'],
    })
    const agent = fixture.addAgent({ id: 'retry-session', header: {} })
    await fixture.preStep(agent)
    await writeFile(join(fixture.base, 'skills', 'active-method', 'SKILL.md'), 'invalid Skill body')

    await expect(fixture.save('durable-new')).resolves.toBeUndefined()
    await expect(readFile(join(fixture.base, 'skills', 'durable-new', 'SKILL.md'), 'utf8')).resolves.toContain('durable-new')
    await expect(fixture.preStep(agent)).rejects.toThrow(/frontmatter/)
  })
})
