import { access, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceBlueprintCatalog, workspaceBlueprintLimits } from '../src/catalog.ts'

const roots: string[] = []
const bundledTemplates = resolve('packages/workspace-blueprints/templates')

async function fixture(sessionIds: readonly string[] = []): Promise<{
  readonly catalog: WorkspaceBlueprintCatalog
  readonly root: string
  readonly workspace: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'paimind-workspace-blueprint-materializer-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const catalog = new WorkspaceBlueprintCatalog({
    list: () => [{ id: 'workspace-1', path: workspace, sessionIds }],
  }, {
    templatesRoot: bundledTemplates,
    userTemplatesRoot: join(root, 'user-templates'),
    now: () => 42,
    createId: () => '00000000-0000-4000-8000-000000000001',
  })
  return { catalog, root, workspace }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Workspace Blueprint materializer', () => {
  it('materializes through a registered empty workspaceId and writes provenance without running files', async () => {
    const { catalog, workspace } = await fixture()
    const page = await catalog.listBlueprints({ query: '企业项目交付' })
    const blueprint = page.items[0]!

    const result = await catalog.materializeBlueprint({
      workspaceId: 'workspace-1',
      blueprintId: blueprint.blueprintId,
      version: blueprint.version,
      expectedDigest: blueprint.digest,
    })

    expect(result).toMatchObject({
      workspaceId: 'workspace-1',
      path: workspace,
      blueprintId: 'enterprise-project-delivery',
      version: '1.0.0',
      warnings: [],
    })
    await expect(readFile(join(workspace, 'PROJECT.md'), 'utf8')).resolves.toContain('# 企业项目交付工作区')
    await expect(readFile(join(workspace, '.paimind', 'workspace-blueprint.json'), 'utf8'))
      .resolves.toContain('paimind.workspace-blueprint-instance/v1')
    const receipt = JSON.parse(await readFile(join(workspace, '.paimind', 'workspace-blueprint.json'), 'utf8'))
    expect(receipt).toMatchObject({
      packageDigest: blueprint.digest,
      source: 'builtin',
      composition: blueprint.composition,
    })
    expect((await readdir(workspace)).sort()).toEqual([
      '.paimind', 'PROJECT.md', 'delivery', 'docs', 'execution', 'inputs', 'outputs', 'planning',
    ])
  })

  it('projects persisted Business Skill composition by Workspace or exact native Session membership', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paimind-workspace-blueprint-composition-'))
    roots.push(root)
    const first = join(root, 'first')
    const second = join(root, 'second')
    await mkdir(first)
    await mkdir(second)
    let firstSessions: readonly string[] = []
    let secondSessions: readonly string[] = []
    const catalog = new WorkspaceBlueprintCatalog({
      list: () => [
        { id: 'workspace-1', path: first, sessionIds: firstSessions },
        { id: 'workspace-2', path: second, sessionIds: secondSessions },
      ],
    }, {
      templatesRoot: bundledTemplates,
      userTemplatesRoot: join(root, 'user-templates'),
      createId: () => '00000000-0000-4000-8000-000000000004',
    })
    const blueprint = (await catalog.listBlueprints()).items[0]!
    await catalog.materializeBlueprint({
      workspaceId: 'workspace-1', blueprintId: blueprint.blueprintId,
      version: blueprint.version, expectedDigest: blueprint.digest,
    })

    await expect(catalog.getWorkspaceComposition({ workspaceId: 'workspace-1' })).resolves.toEqual({
      schema: 'paimind.workspace-composition/v1', workspaceId: 'workspace-1', businessSkills: [],
    })
    firstSessions = ['session-1']
    await expect(catalog.getWorkspaceComposition({ sessionId: 'session-1', cwd: second })).resolves.toEqual({
      schema: 'paimind.workspace-composition/v1', workspaceId: 'workspace-1', businessSkills: [],
    })
    await expect(catalog.getWorkspaceComposition({ sessionId: 'unknown', cwd: first })).resolves.toBeUndefined()

    const receiptPath = join(first, '.paimind', 'workspace-blueprint.json')
    const receipt = await readFile(receiptPath)
    const parsedReceipt = JSON.parse(receipt.toString('utf8'))
    await writeFile(join(first, '.paimind', 'workspace-blueprint.json'), '{"recommendations":{}}')
    await expect(catalog.getWorkspaceComposition({ workspaceId: 'workspace-1' }))
      .rejects.toThrow('receipt is invalid')
    await writeFile(receiptPath, JSON.stringify({ ...parsedReceipt, version: '9.9.9' }))
    await expect(catalog.getWorkspaceComposition({ workspaceId: 'workspace-1' }))
      .rejects.toThrow('Workspace Blueprint not found')
    await writeFile(receiptPath, JSON.stringify({ ...parsedReceipt, source: 'user' }))
    await expect(catalog.getWorkspaceComposition({ workspaceId: 'workspace-1' }))
      .rejects.toThrow('does not match its immutable package')
    await writeFile(receiptPath, JSON.stringify({
      ...parsedReceipt,
      packageDigest: `sha256:${'0'.repeat(64)}`,
    }))
    await expect(catalog.getWorkspaceComposition({ workspaceId: 'workspace-1' }))
      .rejects.toThrow('does not match its immutable package')
    await writeFile(receiptPath, JSON.stringify({
      ...parsedReceipt,
      composition: {
        agent: null,
        businessSkills: [{ name: 'forged-skill', digest: `sha256:${'0'.repeat(64)}` }],
      },
    }))
    await expect(catalog.getWorkspaceComposition({ workspaceId: 'workspace-1' }))
      .rejects.toThrow('does not match its immutable package')
    await writeFile(receiptPath, ' '.repeat(workspaceBlueprintLimits.maxCompositionReceiptBytes + 1))
    await expect(catalog.getWorkspaceComposition({ workspaceId: 'workspace-1' }))
      .rejects.toThrow('receipt is too large')
    await writeFile(receiptPath, receipt)
    await mkdir(join(second, '.paimind'))
    await writeFile(
      join(second, '.paimind', 'workspace-blueprint.json'),
      receipt,
    )
    secondSessions = ['session-1']
    await expect(catalog.getWorkspaceComposition({ sessionId: 'session-1' }))
      .rejects.toThrow('multiple Workspaces')
  })

  it('copies executable-looking files as inert bytes and never runs a template script', async () => {
    const { catalog, root, workspace } = await fixture()
    const template = join(root, 'script-templates', 'inert-script', '1.0.0')
    await mkdir(join(template, 'files', 'scripts'), { recursive: true })
    await writeFile(join(template, 'manifest.json'), JSON.stringify({
      schema: 'paimind.workspace-blueprint/v1',
      blueprintId: 'inert-script',
      version: '1.0.0',
      name: 'Inert script',
      description: 'Proves template files are never executed.',
      category: 'engineering',
      source: 'builtin',
      composition: { agent: null, businessSkills: [] },
    }))
    await writeFile(join(template, 'files', 'scripts', 'run.sh'), `#!/bin/sh\ntouch "${join(root, 'executed')}"\n`)
    const isolated = new WorkspaceBlueprintCatalog({
      list: () => [{ id: 'workspace-1', path: workspace, sessionIds: [] }],
    }, {
      templatesRoot: join(root, 'script-templates'),
      userTemplatesRoot: join(root, 'user-templates'),
      now: () => 42,
      createId: () => '00000000-0000-4000-8000-000000000002',
    })
    const blueprint = (await isolated.listBlueprints()).items[0]!

    await isolated.materializeBlueprint({
      workspaceId: 'workspace-1', blueprintId: blueprint.blueprintId,
      version: blueprint.version, expectedDigest: blueprint.digest,
    })

    await expect(readFile(join(workspace, 'scripts', 'run.sh'), 'utf8')).resolves.toContain('touch')
    await expect(access(join(root, 'executed'))).rejects.toThrow()
    expect(catalog).toBeDefined()
  })

  it('rejects an unknown workspaceId even when the caller supplies an arbitrary path-shaped extra field', async () => {
    const { catalog, root } = await fixture()
    const blueprint = (await catalog.listBlueprints()).items[0]!
    const outside = join(root, 'outside')
    await mkdir(outside)

    await expect(catalog.materializeBlueprint({
      workspaceId: 'unknown-workspace', blueprintId: blueprint.blueprintId,
      version: blueprint.version, expectedDigest: blueprint.digest,
      path: outside,
    } as never)).rejects.toThrow('Unknown Harness Workspace')
    expect(await readdir(outside)).toEqual([])
  })

  it('rejects targets that have Sessions, contents, a symlink root, or a stale digest', async () => {
    const withSession = await fixture(['session-1'])
    const sessionBlueprint = (await withSession.catalog.listBlueprints()).items[0]!
    await expect(withSession.catalog.materializeBlueprint({
      workspaceId: 'workspace-1', blueprintId: sessionBlueprint.blueprintId,
      version: sessionBlueprint.version, expectedDigest: sessionBlueprint.digest,
    })).rejects.toThrow('already has Sessions')

    const nonEmpty = await fixture()
    await writeFile(join(nonEmpty.workspace, 'existing.txt'), 'keep me')
    const nonEmptyBlueprint = (await nonEmpty.catalog.listBlueprints()).items[0]!
    await expect(nonEmpty.catalog.materializeBlueprint({
      workspaceId: 'workspace-1', blueprintId: nonEmptyBlueprint.blueprintId,
      version: nonEmptyBlueprint.version, expectedDigest: nonEmptyBlueprint.digest,
    })).rejects.toThrow('must be empty')
    await expect(readFile(join(nonEmpty.workspace, 'existing.txt'), 'utf8')).resolves.toBe('keep me')

    const stale = await fixture()
    const staleBlueprint = (await stale.catalog.listBlueprints()).items[0]!
    await expect(stale.catalog.materializeBlueprint({
      workspaceId: 'workspace-1', blueprintId: staleBlueprint.blueprintId,
      version: staleBlueprint.version, expectedDigest: `sha256:${'0'.repeat(64)}`,
    })).rejects.toThrow('digest conflict')
    expect(await readdir(stale.workspace)).toEqual([])

    const linked = await fixture()
    const actual = join(linked.root, 'actual-workspace')
    await mkdir(actual)
    await rm(linked.workspace, { recursive: true })
    await symlink(actual, linked.workspace)
    const linkedBlueprint = (await linked.catalog.listBlueprints()).items[0]!
    await expect(linked.catalog.materializeBlueprint({
      workspaceId: 'workspace-1', blueprintId: linkedBlueprint.blueprintId,
      version: linkedBlueprint.version, expectedDigest: linkedBlueprint.digest,
    })).rejects.toThrow('not a safe directory')
  })

  it('serializes duplicate requests so exactly one complete copy wins', async () => {
    const { catalog, workspace } = await fixture()
    const blueprint = (await catalog.listBlueprints({ query: '企业项目交付' })).items[0]!
    const input = {
      workspaceId: 'workspace-1',
      blueprintId: blueprint.blueprintId,
      version: blueprint.version,
      expectedDigest: blueprint.digest,
    }

    const results = await Promise.allSettled([
      catalog.materializeBlueprint(input),
      catalog.materializeBlueprint(input),
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    await expect(readFile(join(workspace, 'PROJECT.md'), 'utf8')).resolves.toContain('# 企业项目交付工作区')
    await expect(readFile(join(workspace, '.paimind', 'workspace-blueprint.json'), 'utf8'))
      .resolves.toContain(blueprint.digest)
  })

  it('cleans its owned staging directory when the authoritative Workspace target changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paimind-workspace-blueprint-target-change-'))
    roots.push(root)
    const first = join(root, 'first')
    const second = join(root, 'second')
    await mkdir(first)
    await mkdir(second)
    let reads = 0
    const catalog = new WorkspaceBlueprintCatalog({
      list: () => [{ id: 'workspace-1', path: reads++ === 0 ? first : second, sessionIds: [] }],
    }, {
      templatesRoot: bundledTemplates,
      userTemplatesRoot: join(root, 'user-templates'),
      createId: () => '00000000-0000-4000-8000-000000000003',
    })
    const blueprint = (await catalog.listBlueprints()).items[0]!

    await expect(catalog.materializeBlueprint({
      workspaceId: 'workspace-1', blueprintId: blueprint.blueprintId,
      version: blueprint.version, expectedDigest: blueprint.digest,
    })).rejects.toThrow('target changed before materialization')

    expect(await readdir(first)).toEqual([])
    expect(await readdir(second)).toEqual([])
    expect((await readdir(root)).some(name => name.startsWith('.paimind-blueprint-stage-'))).toBe(false)
  })

  it('does not remove a pre-existing sibling when its random staging name collides', async () => {
    const { catalog, root } = await fixture()
    const stage = join(root, '.paimind-blueprint-stage-00000000-0000-4000-8000-000000000001')
    await mkdir(stage)
    await writeFile(join(stage, 'keep.txt'), 'keep me')
    const blueprint = (await catalog.listBlueprints()).items[0]!

    await expect(catalog.materializeBlueprint({
      workspaceId: 'workspace-1', blueprintId: blueprint.blueprintId,
      version: blueprint.version, expectedDigest: blueprint.digest,
    })).rejects.toThrow()
    await expect(readFile(join(stage, 'keep.txt'), 'utf8')).resolves.toBe('keep me')
  })
})
