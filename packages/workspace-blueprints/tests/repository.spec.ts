import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceBlueprintCatalog, type WorkspaceBlueprintCompositionValidator } from '../src/catalog.ts'

const roots: string[] = []
const bundledTemplates = resolve('packages/workspace-blueprints/templates')

async function fixture(compositionValidator?: Readonly<WorkspaceBlueprintCompositionValidator>): Promise<{
  readonly catalog: WorkspaceBlueprintCatalog
  readonly root: string
  readonly workspace: string
  readonly target: string
  readonly userTemplatesRoot: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'paimind-workspace-blueprint-repository-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const target = join(root, 'target')
  const userTemplatesRoot = join(root, 'user-templates')
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await mkdir(target)
  await writeFile(join(workspace, 'README.md'), '# Source workspace\n')
  await writeFile(join(workspace, 'docs', 'plan.md'), 'Initial plan.\n')
  let operation = 0
  const catalog = new WorkspaceBlueprintCatalog({
    list: () => [
      { id: 'workspace-1', path: workspace, sessionIds: [] },
      { id: 'workspace-2', path: target, sessionIds: [] },
    ],
  }, {
    templatesRoot: bundledTemplates,
    userTemplatesRoot,
    now: () => 100,
    createId: () => `00000000-0000-4000-8000-${String(++operation).padStart(12, '0')}`,
    ...(compositionValidator === undefined ? {} : { compositionValidator }),
  })
  return { catalog, root, workspace, target, userTemplatesRoot }
}

const composition = Object.freeze({
  agent: Object.freeze({ agentId: 'agent-1', presetId: 'standard', configVersion: 'v1' }),
  businessSkills: Object.freeze([
    Object.freeze({ name: 'customer-research', digest: `sha256:${'a'.repeat(64)}` }),
  ]),
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Workspace Blueprint user repository', () => {
  it('publishes a registered Workspace into the managed repository and reads its complete tree', async () => {
    const { catalog, userTemplatesRoot, workspace, target } = await fixture()
    await mkdir(join(workspace, '.paimind'), { recursive: true })
    await writeFile(join(workspace, '.paimind', 'workspace-blueprint.json'), '{"systemOwned":true}\n')

    const manifest = await catalog.publishBlueprint({
      workspaceId: 'workspace-1', blueprintId: 'team-space', version: '1.0.0',
      name: 'Team space', description: 'A versioned team workspace.', category: 'general',
      tags: ['team', 'team'], composition,
    })

    expect(manifest).toMatchObject({
      blueprintId: 'team-space', version: '1.0.0', source: 'user',
      tags: ['team'], composition,
    })
    expect(manifest.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    await expect(catalog.listBlueprints({ source: 'user' })).resolves.toMatchObject({
      revision: 100,
      items: [expect.objectContaining({ blueprintId: 'team-space', versionCount: 1 })],
    })
    await expect(catalog.getBlueprint({ blueprintId: 'team-space', version: '1.0.0' })).resolves.toMatchObject({
      entries: expect.arrayContaining([
        { path: 'docs', kind: 'directory', size: 0 },
        expect.objectContaining({ path: 'README.md', kind: 'text' }),
        expect.objectContaining({ path: 'docs/plan.md', kind: 'text' }),
      ]),
    })
    expect((await catalog.getBlueprint({ blueprintId: 'team-space', version: '1.0.0' })).entries
      .some(entry => entry.path.startsWith('.paimind'))).toBe(false)
    await expect(catalog.readBlueprintText({
      blueprintId: 'team-space', version: '1.0.0', path: 'docs/plan.md',
    })).resolves.toMatchObject({ text: 'Initial plan.\n', blueprintDigest: manifest.digest })
    const stored = JSON.parse(await readFile(join(userTemplatesRoot, 'team-space', '1.0.0', 'manifest.json'), 'utf8'))
    expect(stored.composition).toEqual(composition)
    expect(stored).not.toHaveProperty('recommendations')

    await catalog.materializeBlueprint({
      workspaceId: 'workspace-2', blueprintId: manifest.blueprintId,
      version: manifest.version, expectedDigest: manifest.digest,
    })
    await expect(catalog.getWorkspaceComposition({ workspaceId: 'workspace-2' })).resolves.toEqual({
      schema: 'paimind.workspace-composition/v1',
      workspaceId: 'workspace-2',
      businessSkills: composition.businessSkills,
    })
    expect(JSON.parse(await readFile(join(target, '.paimind', 'workspace-blueprint.json'), 'utf8')))
      .toMatchObject({ packageDigest: manifest.digest, source: 'user', composition })
  })

  it('creates immutable patch versions for incremental file changes and enforces optimistic locking', async () => {
    const { catalog } = await fixture()
    const published = await catalog.publishBlueprint({
      workspaceId: 'workspace-1', blueprintId: 'editable-space', version: '1.0.0',
      name: 'Editable space', description: 'Immutable version history.', category: 'general', composition,
    })

    const withDirectory = await catalog.createBlueprintDirectory({
      blueprintId: 'editable-space', version: '1.0.0', expectedDigest: published.digest, path: 'notes',
    })
    expect(withDirectory.version).toBe('1.0.1')
    await expect(catalog.writeBlueprintText({
      blueprintId: 'editable-space', version: '1.0.0', expectedDigest: `sha256:${'0'.repeat(64)}`,
      path: 'README.md', text: 'stale',
    })).rejects.toThrow('digest conflict')

    const withText = await catalog.writeBlueprintText({
      blueprintId: 'editable-space', version: withDirectory.version, expectedDigest: withDirectory.digest,
      path: 'notes/new.md', text: 'New note.\n',
    })
    expect(withText.version).toBe('1.0.2')
    await expect(catalog.readBlueprintText({
      blueprintId: 'editable-space', version: withText.version, path: 'notes/new.md',
    })).resolves.toMatchObject({ text: 'New note.\n' })

    await expect(catalog.deleteBlueprintFile({
      blueprintId: 'editable-space', version: withText.version, expectedDigest: withText.digest, path: 'notes',
    })).rejects.toThrow('requires recursive=true')
    const withoutNotes = await catalog.deleteBlueprintFile({
      blueprintId: 'editable-space', version: withText.version, expectedDigest: withText.digest,
      path: 'notes', recursive: true,
    })
    expect(withoutNotes.version).toBe('1.0.3')

    const withoutReadme = await catalog.deleteBlueprintFile({
      blueprintId: 'editable-space', version: withoutNotes.version, expectedDigest: withoutNotes.digest, path: 'README.md',
    })
    expect(withoutReadme.version).toBe('1.0.4')
    await expect(catalog.readBlueprintText({
      blueprintId: 'editable-space', version: withoutReadme.version, path: 'README.md',
    })).rejects.toThrow('not found')
    await expect(catalog.readBlueprintText({
      blueprintId: 'editable-space', version: '1.0.0', path: 'README.md',
    })).resolves.toMatchObject({ text: '# Source workspace\n' })
    const revised = await catalog.updateBlueprintComposition({
      blueprintId: 'editable-space', version: withoutReadme.version, expectedDigest: withoutReadme.digest,
      composition: { agent: null, businessSkills: [] },
    })
    expect(revised).toMatchObject({ version: '1.0.5' })
    expect(revised.digest).not.toBe(withoutReadme.digest)
    await expect(catalog.getBlueprint({ blueprintId: 'editable-space', version: revised.version }))
      .resolves.toMatchObject({ manifest: { composition: { agent: null, businessSkills: [] } } })
    await expect(catalog.getBlueprint({ blueprintId: 'editable-space', version: '1.0.4' }))
      .resolves.toMatchObject({ manifest: { composition } })
    await expect(catalog.listBlueprints({ source: 'user' })).resolves.toMatchObject({
      items: [expect.objectContaining({ version: '1.0.5', versionCount: 6 })],
    })
  })

  it('rejects unsafe sources and paths, built-in mutations, and caller-controlled publication paths', async () => {
    const { catalog, root, workspace } = await fixture()
    const builtIn = (await catalog.listBlueprints({ source: 'builtin' })).items[0]!
    await expect(catalog.writeBlueprintText({
      blueprintId: builtIn.blueprintId, version: builtIn.version, expectedDigest: builtIn.digest,
      path: 'README.md', text: 'forbidden',
    })).rejects.toThrow('read-only')
    await expect(catalog.publishBlueprint({
      workspaceId: 'workspace-1', blueprintId: builtIn.blueprintId, version: '2.0.0',
      name: 'Collision', description: 'Must fail.', category: 'general', composition,
    })).rejects.toThrow('read-only')
    await expect(catalog.publishBlueprint({
      workspaceId: 'unknown', sourcePath: root,
      blueprintId: 'outside-space', version: '1.0.0', name: 'Outside',
      description: 'Must not read caller path.', category: 'general', composition,
    } as never)).rejects.toThrow('Unknown Harness Workspace')

    const valid = await catalog.publishBlueprint({
      workspaceId: 'workspace-1', blueprintId: 'safe-space', version: '1.0.0',
      name: 'Safe', description: 'Safe source.', category: 'general', composition,
    })
    await expect(catalog.writeBlueprintText({
      blueprintId: 'safe-space', version: '1.0.0', expectedDigest: valid.digest,
      path: '../escape.md', text: 'no',
    })).rejects.toThrow('traversal')
    await expect(catalog.writeBlueprintText({
      blueprintId: 'safe-space', version: '1.0.0', expectedDigest: valid.digest,
      path: '.env', text: 'SECRET=no',
    })).rejects.toThrow('sensitive')

    await writeFile(join(workspace, '.env'), 'SECRET=yes')
    await expect(catalog.publishBlueprint({
      workspaceId: 'workspace-1', blueprintId: 'sensitive-space', version: '1.0.0',
      name: 'Sensitive', description: 'Must fail closed.', category: 'general', composition,
    })).rejects.toThrow('sensitive')
  })

  it('rejects nested symbolic links and FIFO device entries in a registered Workspace source', async () => {
    const { catalog, root, workspace } = await fixture()
    const outside = join(root, 'outside.md')
    const linked = join(workspace, 'docs', 'linked.md')
    await writeFile(outside, 'outside\n')
    await symlink(outside, linked)

    await expect(catalog.publishBlueprint({
      workspaceId: 'workspace-1', blueprintId: 'linked-source', version: '1.0.0',
      name: 'Linked source', description: 'Must reject nested symbolic links.', category: 'general', composition,
    })).rejects.toThrow('Symbolic links are not supported')

    await rm(linked)
    const fifo = join(workspace, 'docs', 'source.pipe')
    const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' })
    expect(created.status, created.stderr).toBe(0)

    await expect(catalog.publishBlueprint({
      workspaceId: 'workspace-1', blueprintId: 'fifo-source', version: '1.0.0',
      name: 'FIFO source', description: 'Must reject device-like source entries.', category: 'general', composition,
    })).rejects.toThrow('Unsupported Workspace Blueprint entry type')
  })

  it('detects metadata or composition tampering through the package digest', async () => {
    const { catalog, userTemplatesRoot } = await fixture()
    await catalog.publishBlueprint({
      workspaceId: 'workspace-1', blueprintId: 'tamper-space', version: '1.0.0',
      name: 'Tamper proof', description: 'Digest covers metadata.', category: 'general', composition,
    })
    const manifestPath = join(userTemplatesRoot, 'tamper-space', '1.0.0', 'manifest.json')
    const stored = JSON.parse(await readFile(manifestPath, 'utf8'))
    stored.composition.businessSkills = []
    await writeFile(manifestPath, JSON.stringify(stored))

    await expect(catalog.getBlueprint({ blueprintId: 'tamper-space', version: '1.0.0' }))
      .rejects.toThrow('digest mismatch')
  })

  it('does not overwrite an already published version', async () => {
    const { catalog, userTemplatesRoot } = await fixture()
    const input = {
      workspaceId: 'workspace-1', blueprintId: 'stable-space', version: '1.0.0',
      name: 'Stable', description: 'Published once.', category: 'general' as const, composition,
    }
    const first = await catalog.publishBlueprint(input)
    await expect(catalog.publishBlueprint(input)).rejects.toThrow('already exists')
    const versions = await readdir(join(userTemplatesRoot, 'stable-space'))
    expect(versions).toEqual(['1.0.0'])
    await expect(catalog.getBlueprint({ blueprintId: 'stable-space', version: '1.0.0' }))
      .resolves.toMatchObject({ manifest: { digest: first.digest } })
  })

  it('revalidates exact composition inside publish, immutable update, and materialize transactions', async () => {
    const validate = vi.fn(async () => undefined)
    const { catalog } = await fixture({ validate })
    const published = await catalog.publishBlueprint({
      workspaceId: 'workspace-1', blueprintId: 'validated-space', version: '1.0.0',
      name: 'Validated', description: 'Validated at every commit boundary.', category: 'general', composition,
    })
    expect(validate).toHaveBeenCalledTimes(1)
    expect(validate).toHaveBeenLastCalledWith(composition)

    const revised = await catalog.updateBlueprintComposition({
      blueprintId: published.blueprintId, version: published.version, expectedDigest: published.digest,
      composition: { agent: null, businessSkills: [] },
    })
    expect(validate).toHaveBeenCalledTimes(2)
    expect(validate).toHaveBeenLastCalledWith({ agent: null, businessSkills: [] })

    await catalog.materializeBlueprint({
      workspaceId: 'workspace-2', blueprintId: published.blueprintId,
      version: revised.version, expectedDigest: revised.digest,
    })
    expect(validate).toHaveBeenCalledTimes(3)
    expect(validate).toHaveBeenLastCalledWith({ agent: null, businessSkills: [] })
  })

  it('does not commit a package version when authoritative composition validation fails', async () => {
    const { catalog, userTemplatesRoot } = await fixture({
      validate: async () => { throw new Error('authoritative composition changed') },
    })
    await expect(catalog.publishBlueprint({
      workspaceId: 'workspace-1', blueprintId: 'rejected-space', version: '1.0.0',
      name: 'Rejected', description: 'Must not be committed.', category: 'general', composition,
    })).rejects.toThrow('authoritative composition changed')
    await expect(readdir(join(userTemplatesRoot, 'rejected-space'))).resolves.toEqual([])
  })

  it('does not commit an immutable update or materialization when revalidation fails', async () => {
    let reject = false
    const { catalog, root, target, userTemplatesRoot } = await fixture({
      validate: async () => {
        if (reject) throw new Error('authoritative composition changed')
      },
    })
    const published = await catalog.publishBlueprint({
      workspaceId: 'workspace-1', blueprintId: 'transaction-space', version: '1.0.0',
      name: 'Transaction', description: 'Must validate before every commit.', category: 'general', composition,
    })
    reject = true

    await expect(catalog.updateBlueprintComposition({
      blueprintId: published.blueprintId, version: published.version, expectedDigest: published.digest,
      composition: { agent: null, businessSkills: [] },
    })).rejects.toThrow('authoritative composition changed')
    await expect(readdir(join(userTemplatesRoot, 'transaction-space'))).resolves.toEqual(['1.0.0'])

    await expect(catalog.materializeBlueprint({
      workspaceId: 'workspace-2', blueprintId: published.blueprintId,
      version: published.version, expectedDigest: published.digest,
    })).rejects.toThrow('authoritative composition changed')
    await expect(readdir(target)).resolves.toEqual([])
    expect((await readdir(root)).some(name => name.startsWith('.paimind-blueprint-stage-'))).toBe(false)
  })
})
