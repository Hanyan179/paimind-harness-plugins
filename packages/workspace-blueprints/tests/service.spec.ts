import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWorkspaceBlueprintCompositionChoices, PaimindWorkspaceBlueprintService } from '../src/index.ts'

const roots: string[] = []
const agent = Object.freeze({ agentId: 'delivery-agent', presetId: 'delivery-preset', configVersion: 'cfg-7' })
const businessSkillDigest = `sha256:${'d'.repeat(64)}`

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'paimind-workspace-blueprint-service-'))
  roots.push(root)
  const templatesRoot = join(root, 'templates')
  const versionRoot = join(templatesRoot, 'delivery-space', '1.0.0')
  const workspace = join(root, 'workspace')
  await mkdir(join(versionRoot, 'files'), { recursive: true })
  await mkdir(workspace)
  await writeFile(join(versionRoot, 'files', 'PROJECT.md'), '# Delivery\n')
  await writeFile(join(versionRoot, 'manifest.json'), JSON.stringify({
    schema: 'paimind.workspace-blueprint/v1',
    blueprintId: 'delivery-space', version: '1.0.0', name: 'Delivery space',
    description: 'A bound delivery Workspace.', category: 'project-delivery', source: 'builtin',
    composition: { agent, businessSkills: [] },
  }))

  let sessionIds: readonly string[] = []
  let healthy = true
  let agentProvider: object | undefined
  const bindSession = vi.fn(async (input: {
    readonly sessionId: string
    readonly agentId: string
    readonly presetId: string
    readonly configVersion: string
    readonly purpose: 'conversation'
  }) => ({ ...input, boundAt: 42 }))
  agentProvider = {
    async listProfiles() {
      return { profiles: [{ ...agent, name: 'Delivery Agent', health: healthy ? 'healthy' as const : 'broken' as const }] }
    },
    bindSession,
  }
  const context = {
    workspaceRegistry: { list: () => [{ id: 'workspace-1', path: workspace, sessionIds }] },
    get: vi.fn((name: string) => name === 'paimindAgentProfiles' ? agentProvider : undefined),
    reflect: { provide: vi.fn(() => () => {}) },
    effect(install: () => void | (() => void | Promise<void>)) { install() },
  }
  const service = new PaimindWorkspaceBlueprintService(context as never, {
    templatesRoot,
    userTemplatesRoot: join(root, 'user-templates'),
    now: () => 42,
    createId: () => '00000000-0000-4000-8000-000000000005',
  })
  const blueprint = (await service.listBlueprints()).items[0]!
  return {
    service, blueprint, bindSession,
    setSessions(value: readonly string[]) { sessionIds = value },
    setHealthy(value: boolean) { healthy = value },
    setAgentProvider(value: object | undefined) { agentProvider = value },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Workspace Blueprint Host facade', () => {
  it('discovers late source Services through real Cordis host lookup without making them hard dependencies', async () => {
    const rootRequire = createRequire(import.meta.url)
    const compatRequire = createRequire(rootRequire.resolve('@hansen/harness-compat'))
    const cordisUrl = pathToFileURL(compatRequire.resolve('@deepseek-ai/cordis')).href
    const { Context } = await import(/* @vite-ignore */ cordisUrl)
    const ctx = new Context()
    await expect(getWorkspaceBlueprintCompositionChoices(ctx)).resolves.toMatchObject({
      agents: { status: 'unavailable', items: [] },
      businessSkills: { status: 'unavailable', items: [] },
    })

    let activateProvider!: () => void
    const activation = new Promise<void>(resolve => { activateProvider = resolve })
    const provider = ctx.plugin({
      name: 'agent-profile-source',
      async apply(scope: { provide(name: string, value: unknown): unknown }) {
        await activation
        scope.provide('paimindAgentProfiles', {
          async listProfiles() { return { profiles: [{ ...agent, name: 'Delivery Agent', health: 'healthy' as const }] } },
        })
        scope.provide('paimindSkillInstaller', {
          async listInstalled() {
            return { items: [{ skillId: 'delivery-risk', name: 'delivery-risk', description: 'Review delivery risk' }] }
          },
          async getUserSkillPolicy() { return { enabledBusinessSkillNames: ['delivery-risk'] } },
          async listSystemSkills() { return { items: [] } },
          async getSkillPackage({ skillId }: { readonly skillId: string }) {
            return { skillId, name: skillId, digest: businessSkillDigest }
          },
        })
      },
    })
    await expect(getWorkspaceBlueprintCompositionChoices(ctx)).resolves.toMatchObject({
      agents: { status: 'unavailable', items: [] },
    })
    activateProvider()
    await provider
    await expect(getWorkspaceBlueprintCompositionChoices(ctx)).resolves.toMatchObject({
      agents: { status: 'ready', items: [{ ...agent, name: 'Delivery Agent' }] },
      businessSkills: {
        status: 'ready',
        items: [{ name: 'delivery-risk', description: 'Review delivery risk', digest: businessSkillDigest }],
      },
    })
    await provider.dispose()
    await expect(getWorkspaceBlueprintCompositionChoices(ctx)).resolves.toMatchObject({
      agents: { status: 'unavailable', items: [] },
      businessSkills: { status: 'unavailable', items: [] },
    })
  })

  it('reads source-owned composition choices on demand and degrades independently', async () => {
    const { service, setAgentProvider } = await fixture()
    await expect(service.getCompositionChoices()).resolves.toMatchObject({
      agents: { status: 'ready', items: [{ ...agent, name: 'Delivery Agent' }] },
      businessSkills: { status: 'unavailable', items: [] },
    })
    setAgentProvider(undefined)
    await expect(service.getCompositionChoices()).resolves.toMatchObject({
      agents: { status: 'unavailable', items: [] },
      businessSkills: { status: 'unavailable', items: [] },
    })
  })

  it('binds only the receipt-owned Agent to a native entry Session in the materialized Workspace', async () => {
    const { service, blueprint, bindSession, setSessions } = await fixture()
    await service.materializeBlueprint({
      workspaceId: 'workspace-1', blueprintId: blueprint.blueprintId,
      version: blueprint.version, expectedDigest: blueprint.digest,
    })
    setSessions(['entry-session'])

    await expect(service.bindEntryAgentSession({
      workspaceId: 'workspace-1', sessionId: 'entry-session', blueprintId: blueprint.blueprintId,
      version: blueprint.version, expectedDigest: blueprint.digest,
    })).resolves.toEqual({
      workspaceId: 'workspace-1', sessionId: 'entry-session', blueprintId: blueprint.blueprintId,
      version: blueprint.version, digest: blueprint.digest, agent,
    })
    expect(bindSession).toHaveBeenCalledWith({ sessionId: 'entry-session', ...agent, purpose: 'conversation' })

    await expect(service.bindEntryAgentSession({
      workspaceId: 'workspace-1', sessionId: 'unregistered-session', blueprintId: blueprint.blueprintId,
      version: blueprint.version, expectedDigest: blueprint.digest,
    })).rejects.toThrow('does not belong to the materialized Workspace')
    await expect(service.bindEntryAgentSession({
      workspaceId: 'workspace-1', sessionId: 'entry-session', blueprintId: blueprint.blueprintId,
      version: blueprint.version, expectedDigest: `sha256:${'0'.repeat(64)}`,
    })).rejects.toThrow('package identity does not match its receipt')
    expect(bindSession).toHaveBeenCalledTimes(1)
  })

  it('revalidates the exact Agent revision immediately before delegating the bind mutation', async () => {
    const { service, blueprint, bindSession, setSessions, setHealthy } = await fixture()
    await service.materializeBlueprint({
      workspaceId: 'workspace-1', blueprintId: blueprint.blueprintId,
      version: blueprint.version, expectedDigest: blueprint.digest,
    })
    setSessions(['entry-session'])
    setHealthy(false)
    await expect(service.bindEntryAgentSession({
      workspaceId: 'workspace-1', sessionId: 'entry-session', blueprintId: blueprint.blueprintId,
      version: blueprint.version, expectedDigest: blueprint.digest,
    })).rejects.toThrow('not runnable')
    expect(bindSession).not.toHaveBeenCalled()
  })
})
