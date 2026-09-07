import { mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PaimindSkillInstallerService,
  parseSkillMetadata,
  parseGitHubSkillSource,
  type SkillInstallerHostContext,
  validateSkillArchivePath,
} from '../src/installer.js'

const roots: string[] = []

async function createInstaller(): Promise<{ service: PaimindSkillInstallerService; root: string; state: string }> {
  const base = await mkdtemp(join(tmpdir(), 'paimind-skill-installer-'))
  roots.push(base)
  const root = join(base, 'skills')
  const state = join(base, 'state')
  const context = {
    reflect: { provide: () => {} },
    webServer: { register: () => () => {} },
    effect(install: () => void) { install() },
  }
  return { service: new PaimindSkillInstallerService(context as never, { skillRoot: root, stateRoot: state, now: () => 42 }), root, state }
}

function systemLifecycleHarness() {
  const skills = new Map<string, { readonly name: string; readonly description: string; readonly content: string }>()
  const tools = new Map<string, {
    readonly name: string
    readonly output?: { readonly schema?: { readonly properties?: Readonly<Record<string, unknown>> } }
    execute?: (...args: any[]) => Promise<unknown>
  }>()
  const effects: Array<() => void | Promise<void>> = []
  let rejectedTool: string | undefined
  const context = {
    reflect: { provide: () => () => {} },
    webServer: { register: () => () => {} },
    skills: {
      async list() {
        return [...skills.values()].map(skill => ({
          name: skill.name, description: skill.description,
          source: 'bundled', provider: '@paimind/skill-market',
        }))
      },
      register(skill: { readonly name: string; readonly description: string; readonly content: string }) {
        if (skills.has(skill.name)) throw new Error(`duplicate Skill: ${skill.name}`)
        skills.set(skill.name, skill)
        return () => { if (skills.get(skill.name) === skill) skills.delete(skill.name) }
      },
    },
    tools: {
      register(tool: {
        readonly name: string
        readonly output?: { readonly schema?: { readonly properties?: Readonly<Record<string, unknown>> } }
        execute?: (...args: any[]) => Promise<unknown>
      }) {
        if (tool.name === rejectedTool) throw new Error(`rejected Tool: ${tool.name}`)
        if (tools.has(tool.name)) throw new Error(`duplicate Tool: ${tool.name}`)
        tools.set(tool.name, tool)
        return () => { if (tools.get(tool.name) === tool) tools.delete(tool.name) }
      },
    },
    effect(install: () => void | (() => void | Promise<void>)) {
      const dispose = install()
      if (typeof dispose === 'function') effects.push(dispose)
    },
  } satisfies SkillInstallerHostContext & { readonly reflect: unknown }
  return {
    context, skills, tools,
    rejectTool(name: string | undefined) { rejectedTool = name },
    async dispose() {
      for (const effect of effects.reverse()) await effect()
    },
  }
}

async function upload(service: PaimindSkillInstallerService, fileName: string, body: string | Uint8Array): Promise<{ uploadId: string; digest: string }> {
  const request = Readable.from([Buffer.from(body)]) as IncomingMessage
  Object.assign(request, {
    headers: { 'x-paimind-upload': '1', 'x-paimind-file-name': encodeURIComponent(fileName) },
    method: 'POST',
    url: '/paimind/skills/uploads',
  })
  let status = 0
  let payload = ''
  const response = {
    writeHead(value: number) { status = value; return this },
    end(value?: string) { payload = value ?? '' },
  } as unknown as ServerResponse
  await service.handleUpload(request, response)
  expect(status).toBe(201)
  return JSON.parse(payload) as { uploadId: string; digest: string }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('streaming Skill installer', () => {
  it('registers authoring and installation as source-owned System Skills and prepares an unsaved conversation draft', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-skill-system-'))
    roots.push(base)
    const registeredSkills: Array<{ name: string; description: string; content: string }> = []
    const registeredTools: Array<{
      name: string
      output?: { schema?: { properties?: Readonly<Record<string, unknown>> } }
      execute(args: Record<string, unknown>, exec: unknown): Promise<unknown>
    }> = []
    const liveSystemSkills = [{
      name: 'future-system-skill', description: 'A future source-owned System Skill',
      source: 'bundled', provider: '@paimind/future-system',
    }]
    const context = {
      reflect: { provide: () => {} }, webServer: { register: () => () => {} },
      skills: {
        async list() {
          return [
            ...liveSystemSkills,
            ...registeredSkills.map(skill => ({ ...skill, source: 'bundled', provider: '@paimind/skill-market' })),
          ]
        },
        register(skill: { name: string; description: string; content: string }) { registeredSkills.push(skill); return () => {} },
      },
      tools: { register(tool: {
        name: string
        output?: { schema?: { properties?: Readonly<Record<string, unknown>> } }
        execute(args: Record<string, unknown>, exec: unknown): Promise<unknown>
      }) { registeredTools.push(tool); return () => {} } },
      effect(install: () => void) { install() },
    }
    const service = new PaimindSkillInstallerService(context as never, {
      skillRoot: join(base, 'skills'), stateRoot: join(base, 'state'), now: () => 42,
      bundledSkillBodies: {
        installation: 'Use paimind_skill_inspect_github and paimind_skill_install.',
        authoring: 'Use paimind_skill_prepare_create and wait for user Save.',
      },
    })
    expect(registeredSkills.map(skill => skill.name).sort()).toEqual(['paimind-skill-authoring', 'paimind-skill-installation'])
    expect(registeredSkills.find(skill => skill.name === 'paimind-skill-authoring')?.content).toContain('paimind_skill_prepare_create')
    const tool = registeredTools.find(value => value.name === 'paimind_skill_prepare_create')
    expect(tool).toBeDefined()
    const exec = { agent: { id: 'agent-ordinary', session: { id: 'session-ordinary', header: {} } } }
    const result = await tool!.execute({
      name: 'delivery-risk-review', description: 'Review delivery risk when order data is supplied.',
      instructions: 'Inspect orders and rank delivery risks with evidence.',
    }, exec) as Record<string, unknown>
    const declaredOutputProperties = tool!.output?.schema?.properties ?? {}
    expect(Object.keys(result).filter(key => !(key in declaredOutputProperties))).toEqual([])
    expect(Object.keys(declaredOutputProperties)).toContain('updatedAt')
    await expect(service.getAuthoringDraft({ sessionId: 'session-ordinary' })).resolves.toMatchObject({
      name: 'delivery-risk-review', updatedAt: 42,
    })
    await expect(tool!.execute({
      name: 'future-system-skill', description: 'Conflicts with the live System catalog.',
      instructions: 'This draft must not be prepared.',
    }, exec)).rejects.toThrow('与当前系统能力冲突')
    await expect(service.listInstalled()).resolves.toEqual({ items: [] })
  })

  it('atomically toggles source-owned installation and authoring Skills and preserves the choice on restart', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-skill-optional-system-'))
    roots.push(base)
    const skillRoot = join(base, 'skills')
    const stateRoot = join(base, 'state')
    const first = systemLifecycleHarness()
    const service = new PaimindSkillInstallerService(first.context, {
      skillRoot, stateRoot, now: () => 42,
      bundledSkillBodies: { installation: 'Install from GitHub.', authoring: 'Prepare an unsaved draft.' },
    })

    await expect(service.getUserSkillPolicy()).resolves.toMatchObject({
      revision: 0, enabledOptionalSystemSkillNames: ['paimind-skill-authoring', 'paimind-skill-installation'],
    })
    expect([...first.skills]).toEqual(expect.arrayContaining([
      ['paimind-skill-installation', expect.objectContaining({ content: 'Install from GitHub.' })],
      ['paimind-skill-authoring', expect.objectContaining({ content: 'Prepare an unsaved draft.' })],
    ]))
    expect([...first.tools.keys()].sort()).toEqual([
      'paimind_skill_inspect_github', 'paimind_skill_install', 'paimind_skill_prepare_create',
    ])
    await expect(service.listSystemSkills()).resolves.toEqual({ items: [
      expect.objectContaining({
        name: 'paimind-skill-authoring', availability: 'optional', userControl: 'atomic',
      }),
      expect.objectContaining({
        name: 'paimind-skill-installation', availability: 'optional', userControl: 'atomic',
        sourcePluginId: '@paimind/skill-market',
      }),
    ] })

    await expect(service.replaceUserSkillPolicy({
      expectedRevision: 0, enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    })).resolves.toMatchObject({ revision: 1, enabledOptionalSystemSkillNames: [] })
    expect(first.skills.has('paimind-skill-installation')).toBe(false)
    expect(first.tools.has('paimind_skill_inspect_github')).toBe(false)
    expect(first.tools.has('paimind_skill_install')).toBe(false)
    expect(first.skills.has('paimind-skill-authoring')).toBe(false)
    expect(first.tools.has('paimind_skill_prepare_create')).toBe(false)
    await expect(service.listSystemSkills()).resolves.toEqual({ items: [
      expect.objectContaining({ name: 'paimind-skill-authoring', availability: 'optional' }),
      expect.objectContaining({ name: 'paimind-skill-installation', availability: 'optional' }),
    ] })
    await first.dispose()

    const restarted = systemLifecycleHarness()
    const restartedService = new PaimindSkillInstallerService(restarted.context, {
      skillRoot, stateRoot, now: () => 43,
      bundledSkillBodies: { installation: 'Install from GitHub.', authoring: 'Prepare an unsaved draft.' },
    })
    expect(restarted.skills.has('paimind-skill-installation')).toBe(false)
    expect(restarted.tools.has('paimind_skill_install')).toBe(false)
    await expect(restartedService.getUserSkillPolicy()).resolves.toMatchObject({
      revision: 1, enabledOptionalSystemSkillNames: [],
    })
    await expect(restartedService.replaceUserSkillPolicy({
      expectedRevision: 1, enabledOptionalSystemSkillNames: ['paimind-skill-installation'],
      enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    })).resolves.toMatchObject({ revision: 2, enabledOptionalSystemSkillNames: ['paimind-skill-installation'] })
    expect(restarted.skills.has('paimind-skill-installation')).toBe(true)
    expect(restarted.tools.has('paimind_skill_inspect_github')).toBe(true)
    expect(restarted.tools.has('paimind_skill_install')).toBe(true)
    await restarted.dispose()
  })

  it('keeps persisted Skill Center policy readable without Agent Center and reconciles it when the source appears', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-skill-late-agent-source-'))
    roots.push(base)
    const stateRoot = join(base, 'state')
    await mkdir(stateRoot, { recursive: true })
    await writeFile(join(stateRoot, 'user-skill-policy.json'), `${JSON.stringify({
      schema: 'paimind.user-skill-policy-storage/v3', revision: 7,
      enabledOptionalSystemSkillNames: [
        'paimind-agent-authoring', 'paimind-skill-authoring', 'paimind-skill-installation',
      ],
      disabledBusinessSkillNames: [], directBusinessSkillNames: [],
    })}\n`)
    const harness = systemLifecycleHarness()
    let agentSource: {
      businessSkillNamesForPreset(presetId: string): Promise<readonly string[] | undefined>
      describeAgentAuthoringCapability(): Readonly<{
        name: 'paimind-agent-authoring'; description: string; sourcePluginId: string
      }>
      setAgentAuthoringEnabled(enabled: boolean): void
    } | undefined
    Object.assign(harness.context, {
      get: (name: string) => name === 'paimindAgentProfiles' ? agentSource : undefined,
    })
    const service = new PaimindSkillInstallerService(harness.context, {
      skillRoot: join(base, 'skills'), stateRoot, now: () => 42,
      bundledSkillBodies: { installation: 'Install.', authoring: 'Author.' },
    })

    await expect(service.getUserSkillPolicy()).resolves.toMatchObject({
      revision: 7,
      enabledOptionalSystemSkillNames: expect.arrayContaining([
        'paimind-agent-authoring', 'paimind-skill-authoring', 'paimind-skill-installation',
      ]),
    })
    await expect(service.listInstalled()).resolves.toEqual({ items: [] })

    const setAgentAuthoringEnabled = vi.fn()
    agentSource = {
      async businessSkillNamesForPreset() { return [] },
      describeAgentAuthoringCapability() {
        return {
          name: 'paimind-agent-authoring', description: 'Create a reviewable Agent draft.',
          sourcePluginId: '@paimind/agent-builder',
        }
      },
      setAgentAuthoringEnabled,
    }
    await service.reconcileAgentSourcePolicy()

    expect(setAgentAuthoringEnabled).toHaveBeenCalledWith(true)
    await expect(service.listSystemSkills()).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ name: 'paimind-agent-authoring' })]),
    })
    await harness.dispose()
  })

  it.each([false, true])('keeps independent capabilities usable without GenUI (persisted preference: %s)', async (persisted) => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-without-genui-'))
    roots.push(base)
    const stateRoot = join(base, 'state')
    if (persisted) {
      await mkdir(stateRoot, { recursive: true })
      await writeFile(join(stateRoot, 'user-skill-policy.json'), JSON.stringify({
        schema: 'paimind.user-skill-policy-storage/v3', revision: 7,
        enabledOptionalSystemSkillNames: ['genui', 'paimind-skill-authoring', 'paimind-skill-installation'],
        disabledBusinessSkillNames: [], directBusinessSkillNames: [],
      }))
    }
    const harness = systemLifecycleHarness()
    const update = vi.fn()
    Object.assign(harness.context, {
      loader: { entries: () => [], await: async () => {}, resolve: () => { throw new Error('missing') }, update },
    })
    const service = new PaimindSkillInstallerService(harness.context, {
      skillRoot: join(base, 'skills'), stateRoot,
      bundledSkillBodies: { installation: 'Install.', authoring: 'Author.' },
    })
    const policy = await service.getUserSkillPolicy()
    expect(policy.enabledOptionalSystemSkillNames.includes('genui')).toBe(persisted)
    expect((await service.listSystemSkills()).items.map(skill => skill.name)).toEqual([
      'paimind-skill-authoring', 'paimind-skill-installation',
    ])
    expect(harness.tools.has('paimind_skill_install')).toBe(true)
    expect(harness.tools.has('paimind_skill_prepare_create')).toBe(true)
    await service.saveSkillSource({ name: 'independent-review', description: 'Review a brief.', instructions: 'Review the supplied brief.' })
    await expect(service.replaceUserSkillPolicy({
      expectedRevision: policy.revision,
      enabledOptionalSystemSkillNames: policy.enabledOptionalSystemSkillNames.filter(name => name !== 'paimind-skill-authoring'),
      enabledBusinessSkillNames: ['independent-review'], directBusinessSkillNames: ['independent-review'],
    })).resolves.toMatchObject({ directBusinessSkillNames: ['independent-review'] })
    expect(harness.tools.has('paimind_skill_prepare_create')).toBe(false)
    if (!persisted) {
      await expect(service.replaceUserSkillPolicy({
        expectedRevision: policy.revision + 1, enabledOptionalSystemSkillNames: ['genui'],
        enabledBusinessSkillNames: ['independent-review'], directBusinessSkillNames: [],
      })).rejects.toThrow('不是可原子启停')
    }
    const latest = await service.getUserSkillPolicy()
    await service.replaceUserSkillPolicy({
      ...latest, expectedRevision: latest.revision,
      enabledOptionalSystemSkillNames: persisted ? ['genui'] : [],
    })
    expect((await service.getUserSkillPolicy()).enabledOptionalSystemSkillNames).toEqual(persisted ? ['genui'] : [])
    expect(update).not.toHaveBeenCalled()
    await harness.dispose()
  })

  it('controls all four built-in capabilities through their real source lifecycles without a host restart', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-all-system-lifecycles-'))
    roots.push(base)
    const harness = systemLifecycleHarness()
    const genuiEntry = {
      id: 'genui',
      options: { id: 'genui', name: '@changfenhuang/dsh-genui', disabled: null as boolean | null },
      async update(options: { readonly disabled?: boolean | null }) {
        genuiEntry.options.disabled = options.disabled ?? null
        if (genuiEntry.options.disabled === true) harness.skills.delete('genui')
        else harness.skills.set('genui', { name: 'genui', description: 'Generate structured UI', content: 'Render UI.' })
      },
    }
    harness.skills.set('genui', { name: 'genui', description: 'Generate structured UI', content: 'Render UI.' })
    let agentAuthoringEnabled = true
    const agentSource = {
      async businessSkillNamesForPreset() { return [] },
      describeAgentAuthoringCapability() {
        return { name: 'paimind-agent-authoring' as const, description: 'Create a reviewable Agent draft.', sourcePluginId: '@paimind/agent-builder' }
      },
      setAgentAuthoringEnabled(enabled: boolean) {
        agentAuthoringEnabled = enabled
        if (enabled) harness.skills.set('paimind-agent-authoring', {
          name: 'paimind-agent-authoring', description: 'Create a reviewable Agent draft.', content: 'Create Agent.',
        })
        else harness.skills.delete('paimind-agent-authoring')
      },
    }
    Object.assign(harness.context, {
      loader: {
        entries: () => [genuiEntry],
        await: async () => {},
        resolve: (id: string) => { if (id !== 'genui') throw new Error('missing'); return genuiEntry },
        update: async () => {},
      },
      get: (name: string) => name === 'paimindAgentProfiles' ? agentSource : undefined,
    })
    const service = new PaimindSkillInstallerService(harness.context, {
      skillRoot: join(base, 'skills'), stateRoot: join(base, 'state'), now: () => 42,
      bundledSkillBodies: { installation: 'Install.', authoring: 'Author.' },
    })
    const all = ['genui', 'paimind-agent-authoring', 'paimind-skill-authoring', 'paimind-skill-installation']
    await expect(service.getUserSkillPolicy()).resolves.toMatchObject({ enabledOptionalSystemSkillNames: all })
    await expect(service.listSystemSkills()).resolves.toEqual({ items: all.map(name => expect.objectContaining({
      name, availability: 'optional', userControl: 'atomic',
    })) })

    await service.replaceUserSkillPolicy({
      expectedRevision: 0, enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    })
    expect(agentAuthoringEnabled).toBe(false)
    expect(genuiEntry.options.disabled).toBe(true)
    expect([...harness.skills.keys()]).toEqual([])
    expect([...harness.tools.keys()]).toEqual([])
    await expect(service.listSystemSkills()).resolves.toEqual({ items: all.map(name => expect.objectContaining({
      name, availability: 'optional', userControl: 'atomic',
    })) })

    await service.replaceUserSkillPolicy({
      expectedRevision: 1, enabledOptionalSystemSkillNames: all,
      enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    })
    expect(agentAuthoringEnabled).toBe(true)
    expect(genuiEntry.options.disabled).not.toBe(true)
    expect([...harness.skills.keys()].sort()).toEqual(all)
    await harness.dispose()
  })

  it('rolls policy and all partial registrations back when an Optional System Tool cannot register', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-skill-optional-rollback-'))
    roots.push(base)
    const skillRoot = join(base, 'skills')
    const stateRoot = join(base, 'state')
    const seed = systemLifecycleHarness()
    const seedService = new PaimindSkillInstallerService(seed.context, {
      skillRoot, stateRoot, now: () => 42,
      bundledSkillBodies: { installation: 'Install.', authoring: 'Author.' },
    })
    await seedService.replaceUserSkillPolicy({
      expectedRevision: 0, enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    })
    await seed.dispose()

    const failed = systemLifecycleHarness()
    const service = new PaimindSkillInstallerService(failed.context, {
      skillRoot, stateRoot, now: () => 43,
      bundledSkillBodies: { installation: 'Install.', authoring: 'Author.' },
    })
    failed.rejectTool('paimind_skill_install')
    await expect(service.replaceUserSkillPolicy({
      expectedRevision: 1, enabledOptionalSystemSkillNames: ['paimind-skill-installation'],
      enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    })).rejects.toThrow('rejected Tool')
    await expect(service.getUserSkillPolicy()).resolves.toMatchObject({
      revision: 1, enabledOptionalSystemSkillNames: [],
    })
    expect(failed.skills.has('paimind-skill-installation')).toBe(false)
    expect(failed.tools.has('paimind_skill_inspect_github')).toBe(false)
    expect(failed.tools.has('paimind_skill_install')).toBe(false)
    expect(failed.skills.has('paimind-skill-authoring')).toBe(false)
    expect(failed.tools.has('paimind_skill_prepare_create')).toBe(false)
    await failed.dispose()
  })

  it('migrates the former always-on v1 installation capability to enabled without exposing unknown Optional names', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-skill-policy-v1-'))
    roots.push(base)
    const stateRoot = join(base, 'state')
    await mkdir(stateRoot, { recursive: true })
    await writeFile(join(stateRoot, 'user-skill-policy.json'), `${JSON.stringify({
      schema: 'paimind.user-skill-policy-storage/v1', revision: 4,
      enabledOptionalSystemSkillNames: ['web-search'], disabledBusinessSkillNames: [], directBusinessSkillNames: [],
    })}\n`)
    const harness = systemLifecycleHarness()
    const service = new PaimindSkillInstallerService(harness.context, {
      skillRoot: join(base, 'skills'), stateRoot, now: () => 42,
      bundledSkillBodies: { installation: 'Install.', authoring: 'Author.' },
    })
    expect(harness.skills.has('paimind-skill-installation')).toBe(true)
    await expect(service.getUserSkillPolicy()).resolves.toMatchObject({
      revision: 4, enabledOptionalSystemSkillNames: ['paimind-skill-authoring', 'paimind-skill-installation'],
    })
    await expect(service.replaceUserSkillPolicy({
      expectedRevision: 4, enabledOptionalSystemSkillNames: ['unknown-system-skill'],
      enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    })).rejects.toThrow('不是可原子启停')
    await harness.dispose()
  })

  it('projects the real global System catalog as Mandatory and rejects dynamic name collisions', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-skill-system-catalog-'))
    roots.push(base)
    const context = {
      reflect: { provide: () => {} }, webServer: { register: () => () => {} },
      skills: {
        async list() {
          return [{
            name: 'future-system-skill', description: 'A future source-owned System Skill',
            whenToUse: 'Use for future work', source: 'bundled', provider: '@paimind/future-system',
          }]
        },
        register: () => () => {},
      },
      effect(install: () => void) { install() },
    }
    const service = new PaimindSkillInstallerService(context as never, {
      skillRoot: join(base, 'skills'), stateRoot: join(base, 'state'), now: () => 42,
      bundledSkillBodies: { installation: 'Install.', authoring: 'Author.' },
    })
    await expect(service.listSystemSkills()).resolves.toEqual({ items: [{
      kind: 'system', canonicalId: 'system:future-system-skill', name: 'future-system-skill',
      description: 'A future source-owned System Skill', whenToUse: 'Use for future work',
      availability: 'mandatory', userControl: 'locked', sourcePluginId: '@paimind/future-system',
    }] })
    await expect(service.saveSkillSource({
      name: 'future-system-skill', description: 'Conflicting business package', instructions: 'Do not save.',
    })).rejects.toThrow('与当前系统能力冲突')
    await expect(service.replaceUserSkillPolicy({
      expectedRevision: 0, enabledOptionalSystemSkillNames: ['future-system-skill'],
      enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    })).rejects.toThrow('不是可原子启停')
  })

  it('parses only public GitHub repository and tree URLs', () => {
    expect(parseGitHubSkillSource({ repositoryUrl: 'https://github.com/acme/skills' })).toMatchObject({
      owner: 'acme', repository: 'skills', ref: 'HEAD', archiveUrl: 'https://codeload.github.com/acme/skills/zip/HEAD',
    })
    expect(parseGitHubSkillSource({ repositoryUrl: 'https://github.com/acme/skills/tree/main/research/demo' })).toMatchObject({
      ref: 'main', subdirectory: 'research/demo',
    })
    expect(() => parseGitHubSkillSource({ repositoryUrl: 'https://example.com/acme/skills' })).toThrow('仅支持公开')
    expect(() => parseGitHubSkillSource({ repositoryUrl: 'https://github.com/acme/skills', subdirectory: '../secret' })).toThrow('子目录无效')
  })

  it('downloads a GitHub repository envelope and stages only the selected Skill directory', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-skill-github-'))
    roots.push(base)
    const root = join(base, 'skills')
    const archive = zipSync({
      'skills-main/README.md': strToU8('# Repository'),
      'skills-main/catalog/demo/SKILL.md': strToU8('---\nname: github-demo\ndescription: Installed from a public GitHub repository\n---\n\nFollow the demo workflow.\n'),
      'skills-main/catalog/demo/references/example.md': strToU8('Example reference.\n'),
    })
    const context = {
      reflect: { provide: () => {} }, webServer: { register: () => () => {} },
      effect(install: () => void) { install() },
    }
    const service = new PaimindSkillInstallerService(context as never, {
      skillRoot: root, stateRoot: join(base, 'state'), now: () => 42,
      fetch: vi.fn(async () => new Response(archive, { status: 200, headers: { 'content-type': 'application/zip' } })) as typeof fetch,
    })
    const preview = await service.inspectGitHub({
      repositoryUrl: 'https://github.com/acme/skills', ref: 'main', subdirectory: 'catalog/demo',
    })
    expect(preview).toMatchObject({ name: 'github-demo', repository: 'acme/skills', ref: 'main', subdirectory: 'catalog/demo', fileCount: 2 })
    await service.installUpload({ uploadId: preview.uploadId, digest: preview.digest })
    await expect(readFile(join(root, 'github-demo', 'SKILL.md'), 'utf8')).resolves.toContain('Follow the demo workflow')
    await expect(stat(join(root, 'github-demo', 'README.md'))).rejects.toThrow()
  })

  it('declares every field returned by the GitHub inspection Tool', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-skill-github-tool-schema-'))
    roots.push(base)
    const archive = zipSync({
      'skills-main/catalog/demo/SKILL.md': strToU8('---\nname: github-demo\ndescription: Installed from a public GitHub repository\nwhen_to_use: Use for GitHub inspection regression.\n---\n\nFollow the demo workflow.\n'),
      'skills-main/catalog/demo/references/example.md': strToU8('Example reference.\n'),
    })
    const harness = systemLifecycleHarness()
    new PaimindSkillInstallerService(harness.context, {
      skillRoot: join(base, 'skills'), stateRoot: join(base, 'state'), now: () => 42,
      bundledSkillBodies: { installation: 'Inspect and install.', authoring: 'Author.' },
      fetch: vi.fn(async () => new Response(archive, { status: 200, headers: { 'content-type': 'application/zip' } })) as typeof fetch,
    })
    const tool = harness.tools.get('paimind_skill_inspect_github')
    expect(tool?.execute).toBeDefined()
    const value = await tool!.execute!({
      repository_url: 'https://github.com/acme/skills', ref: 'main', subdirectory: 'catalog/demo',
    }, {}) as Readonly<Record<string, unknown>>
    const properties = tool?.output?.schema?.properties ?? {}
    expect(Object.keys(value).filter(key => !(key in properties))).toEqual([])
    expect(Object.keys(properties)).toEqual(expect.arrayContaining([
      'fileName', 'kind', 'fileCount', 'compressedBytes', 'expandedBytes', 'whenToUse',
    ]))
    await harness.dispose()
  })

  it('moves only PAIMind-managed legacy Skills out of Harness global discovery', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-skill-migration-'))
    roots.push(base)
    const legacyRoot = join(base, 'skills')
    const businessRoot = join(base, '.paimind-skill-market', 'skills')
    const stateRoot = join(base, 'state')
    const context = {
      reflect: { provide: () => {} }, webServer: { register: () => () => {} },
      effect(install: () => void) { install() },
    }
    const managedRoot = join(legacyRoot, 'managed-business')
    const systemRoot = join(legacyRoot, 'system-capability')
    await mkdir(managedRoot, { recursive: true })
    await mkdir(systemRoot, { recursive: true })
    await writeFile(join(managedRoot, 'SKILL.md'), '---\nname: managed-business\ndescription: Managed business method\n---\n')
    await writeFile(join(managedRoot, '.paimind-install.json'), `${JSON.stringify({
      schemaVersion: 1, skillId: 'managed-business', name: 'managed-business', description: 'Managed business method',
      digest: 'sha256:test', sourceFileName: 'SKILL.md', installedAt: 1, updatedAt: 2, managed: true,
      runtimeRequirements: [],
    })}\n`)
    await writeFile(join(systemRoot, 'SKILL.md'), '---\nname: system-capability\ndescription: Harness system capability\n---\n')
    const service = new PaimindSkillInstallerService(context as never, {
      skillRoot: businessRoot, legacySkillRoot: legacyRoot, stateRoot, now: () => 42,
    })

    await expect(service.listInstalled()).resolves.toMatchObject({ items: [expect.objectContaining({ name: 'managed-business' })] })
    await expect(stat(join(businessRoot, 'managed-business'))).resolves.toBeDefined()
    await expect(stat(join(legacyRoot, 'managed-business'))).rejects.toThrow()
    await expect(stat(systemRoot)).resolves.toBeDefined()
  })

  it('moves former catalog-owned Creator and Installer copies into recoverable backup', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-skill-system-retirement-'))
    roots.push(base)
    const businessRoot = join(base, 'business-skills')
    const stateRoot = join(base, 'state')
    const context = {
      reflect: { provide: () => {} }, webServer: { register: () => () => {} },
      effect(install: () => void) { install() },
    }
    for (const [name, sourceFileName] of [
      ['skill-creator', 'skill-creator-1.0.0.zip'],
      ['skill-installer', 'skill-installer-1.0.0.zip'],
    ]) {
      const root = join(businessRoot, name)
      await mkdir(root, { recursive: true })
      await writeFile(join(root, 'SKILL.md'), `---\nname: ${name}\ndescription: Former catalog-owned system capability\n---\n`)
      await writeFile(join(root, '.paimind-install.json'), `${JSON.stringify({
        schemaVersion: 1, skillId: name, name, description: 'Former catalog-owned system capability',
        digest: 'sha256:test', sourceFileName, installedAt: 1, updatedAt: 2, managed: true,
        runtimeRequirements: [],
      })}\n`)
    }
    const userCopy = join(businessRoot, 'skill-creator-user-copy')
    await mkdir(userCopy, { recursive: true })
    await writeFile(join(userCopy, 'SKILL.md'), '---\nname: skill-creator-user-copy\ndescription: User-authored business Skill\n---\n')

    const service = new PaimindSkillInstallerService(context as never, {
      skillRoot: businessRoot, stateRoot, now: () => 42,
    })
    await expect(service.listInstalled()).resolves.toMatchObject({
      items: [expect.objectContaining({ name: 'skill-creator-user-copy', managed: false })],
    })
    await expect(stat(join(businessRoot, 'skill-creator'))).rejects.toThrow()
    await expect(stat(join(businessRoot, 'skill-installer'))).rejects.toThrow()
    const backups = await readdir(join(stateRoot, 'backups'))
    expect(backups.some(name => name.startsWith('retired-system-skill-creator-42-'))).toBe(true)
    expect(backups.some(name => name.startsWith('retired-system-skill-installer-42-'))).toBe(true)
    await expect(stat(userCopy)).resolves.toBeDefined()
  })

  it('parses folded community YAML frontmatter with nested metadata', () => {
    expect(parseSkillMetadata(`---
name: ppt-master
description: >
  AI-driven presentation generation and editing.
  Supports reusable templates.
metadata:
  version: "4.7.0"
  license: MIT
---
`)).toEqual({
      name: 'ppt-master',
      description: 'AI-driven presentation generation and editing. Supports reusable templates.',
    })
  })

  it('projects a business title through save and reload without changing skill identity', async () => {
    const { service } = await createInstaller()
    const source = '---\nname: weekly-review\ndescription: Review supplied facts\n---\n\n# 周工作回顾\n\nUse only supplied facts.\n'
    const saved = await service.saveSkillPackage({ changes: [{ operation: 'write', path: 'SKILL.md', content: source }] })
    expect(saved.record).toMatchObject({ skillId: 'weekly-review', name: 'weekly-review', displayName: '周工作回顾' })
    expect((await service.listInstalled()).items[0]).toMatchObject({ name: 'weekly-review', displayName: '周工作回顾' })
    const current = await service.getSkillPackage({ skillId: 'weekly-review' })
    const currentFile = await service.readSkillPackageFile({ skillId: 'weekly-review', path: 'SKILL.md' })
    await service.saveSkillPackage({ skillId: 'weekly-review', expectedDigest: current.digest,
      changes: [{ operation: 'write', path: 'SKILL.md', expectedDigest: currentFile.digest, content: source.replace('周工作回顾', '每周进展') }] })
    expect((await service.listInstalled()).items[0]).toMatchObject({ skillId: 'weekly-review', displayName: '每周进展' })
    expect(parseSkillMetadata(source.replace('# 周工作回顾', '```md\n# Code example\n```'))).not.toHaveProperty('displayName')
    expect(parseSkillMetadata(source.replace('description:', 'display-name: 团队周报\ndescription:'))).toMatchObject({ displayName: '团队周报', name: 'weekly-review' })
  })

  it('accepts community packages with ecosystem metadata outside the Skill root', async () => {
    const { service, root } = await createInstaller()
    const archive = zipSync({
      'skills/.claude-plugin/plugin.json': strToU8('{"name":"ppt-master"}'),
      'skills/ppt-master/SKILL.md': strToU8(`---
name: ppt-master
description: >
  AI-driven presentation generation and editing.
  Supports reusable templates.
metadata:
  version: "4.7.0"
---
`),
      'skills/ppt-master/requirements.txt': strToU8('python-pptx>=1.0.0\n'),
      'skills/ppt-master/scripts/render.py': strToU8('print("ok")\n'),
    })
    const uploaded = await upload(service, 'ppt-master-skill-v4.7.0.zip', archive)
    const preview = await service.inspectUpload({ uploadId: uploaded.uploadId })
    expect(preview).toMatchObject({
      name: 'ppt-master',
      description: 'AI-driven presentation generation and editing. Supports reusable templates.',
      fileCount: 3,
      runtimeRequirements: ['python'],
    })
    expect(preview.warnings).toContain('包含脚本文件；安装过程不会执行脚本')
    const installed = await service.installUpload(uploaded)
    expect(installed.record.runtimeRequirements).toEqual(['python'])
    await expect(readFile(join(root, 'ppt-master', 'SKILL.md'), 'utf8')).resolves.toContain('name: ppt-master')
    await expect(stat(join(root, '.claude-plugin'))).rejects.toThrow()
  })

  it('stages official and PAIMind internal recommendations through the same inspection and atomic install path', async () => {
    const { service, root } = await createInstaller()
    const catalog = await service.listCatalog()
    expect(catalog.items.map(item => item.id)).toEqual(['openai-docs', 'bento-ppt', 'fineline-investment-analysis', 'white-space-analysis', 'build-walmart-buyer-proposal-outline', 'category-performance-analysis', 'category-opportunity-analysis', 'proposal-assistant-orchestration'])
    expect(catalog.items.map(item => ({ id: item.id, category: item.category, tags: item.tags }))).toEqual([
      { id: 'openai-docs', category: 'research', tags: ['official-docs', 'research'] },
      { id: 'bento-ppt', category: 'content', tags: ['artifact', 'presentation'] },
      { id: 'fineline-investment-analysis', category: 'product', tags: ['data-analysis', 'pdm'] },
      { id: 'white-space-analysis', category: 'product', tags: ['data-analysis', 'pdm'] },
      { id: 'build-walmart-buyer-proposal-outline', category: 'product', tags: ['pdm', 'proposal'] },
      { id: 'category-performance-analysis', category: 'data', tags: ['category-analysis', 'performance'] },
      { id: 'category-opportunity-analysis', category: 'data', tags: ['category-analysis', 'opportunity'] },
      { id: 'proposal-assistant-orchestration', category: 'product', tags: ['orchestration', 'proposal'] },
    ])
    const preview = await service.inspectCatalog({ catalogId: 'openai-docs', version: catalog.items.find(item => item.id === 'openai-docs')!.version })
    expect(preview).toMatchObject({ name: 'openai-docs', kind: 'zip', fileCount: 3, operation: 'install' })
    const installed = await service.installUpload({ uploadId: preview.uploadId, digest: preview.digest })
    expect(installed.operation).toBe('installed')
    await expect(readFile(join(root, 'openai-docs', 'LICENSE.txt'), 'utf8')).resolves.toContain('Apache License')
    await expect(readFile(join(root, 'openai-docs', 'NOTICE.txt'), 'utf8')).resolves.toContain('Adapted for DeepSeek Harness')
    const bento = await service.inspectCatalog({ catalogId: 'bento-ppt', version: catalog.items.find(item => item.id === 'bento-ppt')!.version })
    expect(bento).toMatchObject({ name: 'bento-ppt', displayName: '演示制作', kind: 'zip', fileCount: 3, operation: 'install' })
    await service.installUpload({ uploadId: bento.uploadId, digest: bento.digest })
    const bentoSkill = await readFile(join(root, 'bento-ppt', 'SKILL.md'), 'utf8')
    expect(bentoSkill).toContain('create_fact_bound_presentation_outline')
    expect(bentoSkill).toContain('generate_traceable_bento_from_outline')
    expect(bentoSkill).toContain('Bento Artifact as the single primary final deliverable')
    expect(bentoSkill).toContain('only when the current user explicitly requested an editable PPTX export')
    await expect(readFile(join(root, 'bento-ppt', 'LICENSE.txt'), 'utf8')).resolves.toContain('Internal Use Only')
    const proposal = await service.inspectCatalog({ catalogId: 'proposal-assistant-orchestration', version: catalog.items.find(item => item.id === 'proposal-assistant-orchestration')!.version })
    await service.installUpload({ uploadId: proposal.uploadId, digest: proposal.digest })
    const proposalSkill = await readFile(join(root, 'proposal-assistant-orchestration', 'SKILL.md'), 'utf8')
    expect(proposalSkill).toContain('paimind.proposal.departments/v1')
    expect(proposalSkill).toContain('102 · Beauty Care')
    expect(proposalSkill).toContain('140 · Stationery')
    expect(proposalSkill).toContain('410 · Holiday Events')
    expect(proposalSkill).toContain('never emit it as a second question')
    expect(proposalSkill).toContain('Call `generate_traceable_bento_from_outline`')
    expect(proposalSkill).toContain('only when the current user explicitly requested an editable PPTX export')
    expect(proposalSkill).not.toContain('Time horizon')
  })

  it('rejects traversal, absolute and backslash archive paths', () => {
    expect(validateSkillArchivePath('skill/SKILL.md')).toBe('skill/SKILL.md')
    expect(() => validateSkillArchivePath('../SKILL.md')).toThrow(/路径穿越/)
    expect(() => validateSkillArchivePath('/tmp/SKILL.md')).toThrow(/不安全路径/)
    expect(() => validateSkillArchivePath('skill\\SKILL.md')).toThrow(/不安全路径/)
  })

  it('removes staged uploads when package inspection fails', async () => {
    const { service, state } = await createInstaller()
    const invalid = await upload(service, 'invalid-skill.md', '# Missing YAML frontmatter\n')

    await expect(service.inspectUpload({ uploadId: invalid.uploadId })).rejects.toThrow('SKILL.md 缺少 YAML frontmatter')
    await expect(readdir(join(state, 'uploads'))).resolves.toEqual([])
  })

  it('streams install, atomically updates, and recoverably uninstalls a managed Skill', async () => {
    const { service, root, state } = await createInstaller()
    const first = await upload(service, 'SKILL.md', '---\nname: acceptance-skill\ndescription: First version\n---\n\nFirst body.\n')
    const firstPreview = await service.inspectUpload({ uploadId: first.uploadId })
    expect(firstPreview.operation).toBe('install')
    const installed = await service.installUpload(first)
    expect(installed.operation).toBe('installed')
    expect(await readFile(join(root, 'acceptance-skill', 'SKILL.md'), 'utf8')).toContain('First body.')

    const second = await upload(service, 'SKILL.md', '---\nname: acceptance-skill\ndescription: Second version\n---\n\nSecond body.\n')
    expect((await service.inspectUpload({ uploadId: second.uploadId })).operation).toBe('update')
    const updated = await service.installUpload(second)
    expect(updated.operation).toBe('updated')
    expect(updated.record.installedAt).toBe(installed.record.installedAt)
    expect(await readFile(join(root, 'acceptance-skill', 'SKILL.md'), 'utf8')).toContain('Second body.')

    const removed = await service.uninstall({ skillId: 'acceptance-skill', version: updated.record.digest })
    expect(removed.recoverable).toBe(true)
    await expect(stat(join(root, 'acceptance-skill'))).rejects.toThrow()
    expect((await readdir(join(state, 'backups'))).some(name => name.startsWith('acceptance-skill-42-'))).toBe(true)
  })

  it('creates and edits a managed SKILL.md while preserving additional package files', async () => {
    const { service, root } = await createInstaller()
    const created = await service.saveSkillSource({
      name: 'delivery-risk-review',
      description: 'Review delivery risk when purchase orders or supplier dates are provided.',
      instructions: '1. Read the supplied orders.\n2. Rank delivery risks.\n3. Return evidence and next actions.',
    })
    expect(created.operation).toBe('installed')
    const first = await service.getSkillSource({ skillId: 'delivery-risk-review' })
    expect(first).toMatchObject({ managed: true, name: 'delivery-risk-review' })
    expect(first.instructions).toContain('Rank delivery risks')

    await writeFile(join(root, 'delivery-risk-review', 'references.md'), 'Keep this file.\n')
    const updated = await service.saveSkillSource({
      name: first.name, description: 'Review and explain delivery risk with clear evidence.',
      instructions: `${first.instructions}\n4. Explain assumptions.`, expectedDigest: first.digest,
    })
    expect(updated.operation).toBe('updated')
    await expect(readFile(join(root, 'delivery-risk-review', 'references.md'), 'utf8')).resolves.toBe('Keep this file.\n')
    await expect(service.saveSkillSource({
      name: first.name, description: first.description, instructions: first.instructions, expectedDigest: first.digest,
    })).rejects.toThrow('已更新')
    await expect(service.saveSkillSource({
      name: 'paimind-skill-authoring', description: 'Collision', instructions: 'Do not save.',
    })).rejects.toThrow('与系统能力冲突')
  })

  it('loads a Skill folder lazily and atomically saves file-level changes without flattening the package', async () => {
    const { service, root } = await createInstaller()
    const archive = zipSync({
      'folder-skill/SKILL.md': strToU8('---\nname: folder-skill\ndescription: Folder based Skill\n---\n\nUse the references.\n'),
      'folder-skill/references/example.md': strToU8('# Example\n\nOriginal.\n'),
      'folder-skill/assets/logo.bin': new Uint8Array([0, 255, 1, 2]),
    })
    const staged = await upload(service, 'folder-skill.zip', archive)
    await service.inspectUpload({ uploadId: staged.uploadId })
    await service.installUpload(staged)

    const summary = await service.getSkillPackage({ skillId: 'folder-skill' })
    expect(summary.managed).toBe(true)
    expect(summary.root.entries.map(entry => [entry.name, entry.kind])).toEqual([
      ['assets', 'directory'], ['references', 'directory'], ['SKILL.md', 'text'],
    ])
    const references = await service.listSkillPackageDirectory({ skillId: 'folder-skill', path: 'references' })
    expect(references.entries).toEqual([
      expect.objectContaining({ path: 'references/example.md', kind: 'text' }),
    ])
    const skillFile = await service.readSkillPackageFile({ skillId: 'folder-skill', path: 'SKILL.md' })
    const exampleFile = await service.readSkillPackageFile({ skillId: 'folder-skill', path: 'references/example.md' })
    const binaryFile = await service.readSkillPackageFile({ skillId: 'folder-skill', path: 'assets/logo.bin' })
    expect(exampleFile.content).toContain('Original')
    expect(binaryFile.kind).toBe('binary')
    expect('content' in binaryFile).toBe(false)

    const revised = '---\nname: folder-skill\ndescription: Revised folder based Skill\n---\n\nUse the references and script.\n'
    const saved = await service.saveSkillPackage({
      skillId: 'folder-skill', expectedDigest: summary.digest,
      changes: [
        { operation: 'write', path: 'SKILL.md', content: revised, expectedDigest: skillFile.digest },
        { operation: 'mkdir', path: 'scripts' },
        { operation: 'write', path: 'scripts/check.py', content: 'print("ok")\n' },
        { operation: 'delete', path: 'assets/logo.bin', expectedDigest: binaryFile.digest },
      ],
    })
    expect(saved.operation).toBe('updated')
    await expect(readFile(join(root, 'folder-skill', 'references/example.md'), 'utf8')).resolves.toContain('Original')
    await expect(readFile(join(root, 'folder-skill', 'scripts/check.py'), 'utf8')).resolves.toBe('print("ok")\n')
    await expect(stat(join(root, 'folder-skill', 'assets/logo.bin'))).rejects.toThrow()
    await expect(service.saveSkillPackage({
      skillId: 'folder-skill', expectedDigest: summary.digest,
      changes: [{ operation: 'write', path: 'SKILL.md', content: revised }],
    })).rejects.toThrow('已更新')

    const outside = join(root, '..', 'outside-package')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'secret.md'), 'outside\n')
    await symlink(outside, join(root, 'folder-skill', 'linked'))
    await expect(service.listSkillPackageDirectory({ skillId: 'folder-skill', path: 'linked' })).rejects.toThrow('符号链接')
    await expect(service.readSkillPackageFile({ skillId: 'folder-skill', path: 'linked/secret.md' })).rejects.toThrow('符号链接')
    await expect(service.getSkillPackage({ skillId: 'folder-skill' })).rejects.toThrow('符号链接')
  })

  it('persists explicit nested empty directories and includes them in the optimistic package revision', async () => {
    const { service, root } = await createInstaller()
    await service.saveSkillPackage({
      changes: [
        { operation: 'write', path: 'SKILL.md', content: '---\nname: directory-skill\ndescription: Explicit directory package\n---\n\nKeep empty folders without placeholders.\n' },
        { operation: 'mkdir', path: 'references' },
        { operation: 'mkdir', path: 'references/examples' },
        { operation: 'mkdir', path: 'references/examples/empty' },
      ],
    })

    const first = await service.getSkillPackage({ skillId: 'directory-skill' })
    expect(first.root.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'references', kind: 'directory' }),
    ]))
    await expect(service.listSkillPackageDirectory({ skillId: 'directory-skill', path: 'references/examples/empty' })).resolves.toEqual({
      path: 'references/examples/empty', entries: [],
    })
    await expect(readdir(join(root, 'directory-skill', 'references', 'examples', 'empty'))).resolves.toEqual([])

    await service.saveSkillPackage({
      skillId: 'directory-skill', expectedDigest: first.digest,
      changes: [{ operation: 'mkdir', path: 'assets' }],
    })
    const second = await service.getSkillPackage({ skillId: 'directory-skill' })
    expect(second.digest).not.toBe(first.digest)
    await expect(service.saveSkillPackage({
      skillId: 'directory-skill', expectedDigest: first.digest,
      changes: [{ operation: 'mkdir', path: 'stale' }],
    })).rejects.toThrow('已更新')
    await expect(service.saveSkillPackage({
      skillId: 'directory-skill', expectedDigest: second.digest,
      changes: [{ operation: 'write', path: 'missing/file.md', content: 'implicit parent\n' }],
    })).rejects.toThrow('父目录不存在')
    await expect(service.saveSkillPackage({
      skillId: 'directory-skill', expectedDigest: second.digest,
      changes: [{ operation: 'mkdir', path: '../outside' }],
    })).rejects.toThrow('路径穿越')
    await expect(service.saveSkillPackage({
      skillId: 'directory-skill', expectedDigest: second.digest,
      changes: [{ operation: 'mkdir', path: '' }],
    })).rejects.toThrow('目录路径无效')
  })

  it('pages a large Skill directory instead of returning the full package snapshot', async () => {
    const { service } = await createInstaller()
    const changes = [
      { operation: 'write' as const, path: 'SKILL.md', content: '---\nname: paged-skill\ndescription: Paginated package\n---\n\nRead files on demand.\n' },
      { operation: 'mkdir' as const, path: 'references' },
      ...Array.from({ length: 520 }, (_, index) => ({
        operation: 'write' as const,
        path: `references/item-${String(index).padStart(4, '0')}.md`,
        content: `# Item ${index}\n`,
      })),
    ]
    await service.saveSkillPackage({ changes })
    const rootPage = await service.getSkillPackage({ skillId: 'paged-skill' })
    expect(rootPage.root.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'references', kind: 'directory' }),
      expect.objectContaining({ path: 'SKILL.md', kind: 'text' }),
    ]))
    const first = await service.listSkillPackageDirectory({ skillId: 'paged-skill', path: 'references', limit: 200 })
    expect(first.entries).toHaveLength(200)
    expect(first.nextCursor).toBe('200')
    const second = await service.listSkillPackageDirectory({ skillId: 'paged-skill', path: 'references', cursor: first.nextCursor, limit: 200 })
    expect(second.entries).toHaveLength(200)
    expect(second.nextCursor).toBe('400')
    const third = await service.listSkillPackageDirectory({ skillId: 'paged-skill', path: 'references', cursor: second.nextCursor, limit: 200 })
    expect(third.entries).toHaveLength(120)
    expect(third.nextCursor).toBeUndefined()
    await expect(service.saveSkillPackage({
      skillId: 'paged-skill', expectedDigest: rootPage.digest,
      // This path lives on a page the client may not have loaded. A new-file
      // operation must fail instead of silently overwriting the hidden file.
      changes: [{ operation: 'write', path: 'references/item-0519.md', content: '# overwritten\n' }],
    })).rejects.toThrow('文件已存在')
  })

  it('persists optimistic User Skill Policy while new installs remain eligible but not direct defaults', async () => {
    const { service, root, state } = await createInstaller()
    await service.saveSkillSource({
      name: 'delivery-risk', description: 'Review delivery risks.', instructions: 'Review delivery risks.',
    })
    await service.saveSkillSource({
      name: 'supplier-review', description: 'Review suppliers.', instructions: 'Review suppliers.',
    })
    await expect(service.getUserSkillPolicy()).resolves.toEqual({
      schema: 'paimind.user-skill-policy/v1', revision: 0,
      enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: ['delivery-risk', 'supplier-review'], directBusinessSkillNames: [],
    })
    await expect(service.replaceUserSkillPolicy({
      expectedRevision: 0, enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: ['delivery-risk'], directBusinessSkillNames: ['delivery-risk'],
    })).resolves.toMatchObject({ revision: 1, enabledBusinessSkillNames: ['delivery-risk'] })
    await service.saveSkillSource({
      name: 'new-business-skill', description: 'Newly installed method.', instructions: 'Use the new method.',
    })
    await expect(service.getUserSkillPolicy()).resolves.toMatchObject({
      revision: 1, enabledBusinessSkillNames: ['delivery-risk', 'new-business-skill'],
      directBusinessSkillNames: ['delivery-risk'],
    })
    await expect(service.replaceUserSkillPolicy({
      expectedRevision: 0, enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    })).rejects.toThrow('已更新')

    const context = {
      reflect: { provide: () => {} }, webServer: { register: () => () => {} },
      effect(install: () => void) { install() },
    }
    const restarted = new PaimindSkillInstallerService(context as never, {
      skillRoot: root, stateRoot: state, now: () => 43,
    })
    await expect(restarted.getUserSkillPolicy()).resolves.toMatchObject({
      revision: 1, enabledBusinessSkillNames: ['delivery-risk', 'new-business-skill'],
      directBusinessSkillNames: ['delivery-risk'],
    })
  })
})
