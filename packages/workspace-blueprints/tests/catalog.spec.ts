import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceBlueprintCatalog } from '../src/catalog.ts'

const roots: string[] = []
const bundledTemplates = resolve('packages/workspace-blueprints/templates')

async function temporaryState(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'paimind-workspace-blueprint-catalog-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Workspace Blueprint catalog', () => {
  it('lists immutable built-ins with real file indexes and canonical composition', async () => {
    const stateRoot = await temporaryState()
    const catalog = new WorkspaceBlueprintCatalog({ list: () => [] }, {
      templatesRoot: bundledTemplates,
      userTemplatesRoot: join(stateRoot, 'user-templates'),
    })

    const page = await catalog.listBlueprints({ source: 'builtin' })

    expect(page.revision).toBe(0)
    expect(page.items.map(item => item.blueprintId).sort()).toEqual([
      'data-analysis-workbench',
      'enterprise-project-delivery',
      'research-decision-brief',
    ])
    const delivery = page.items.find(item => item.blueprintId === 'enterprise-project-delivery')
    expect(delivery).toMatchObject({
      source: 'builtin',
      category: 'project-delivery',
      version: '1.0.0',
      versionCount: 1,
      composition: { agent: null, businessSkills: [] },
    })
    expect(delivery?.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'PROJECT.md', kind: 'text' }),
      expect.objectContaining({ path: 'delivery/acceptance-checklist.md', kind: 'text' }),
    ]))
    expect(delivery?.fileCount).toBe(delivery?.files.length)
    expect(delivery?.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    const research = page.items.find(item => item.blueprintId === 'research-decision-brief')
    expect(research?.composition).toEqual({ agent: null, businessSkills: [] })
  })

  it('filters the catalog without inventing a second Workspace registry', async () => {
    const stateRoot = await temporaryState()
    const catalog = new WorkspaceBlueprintCatalog({ list: () => [] }, {
      templatesRoot: bundledTemplates,
      userTemplatesRoot: join(stateRoot, 'user-templates'),
    })

    await expect(catalog.listBlueprints({ category: 'data', query: '质量' })).resolves.toMatchObject({
      items: [expect.objectContaining({ blueprintId: 'data-analysis-workbench' })],
    })
    await expect(catalog.listBlueprints({ source: 'user' })).resolves.toMatchObject({ items: [] })
  })

  it('fails closed when a built-in version root is a symbolic link', async () => {
    const stateRoot = await temporaryState()
    const templatesRoot = join(stateRoot, 'templates')
    const external = join(stateRoot, 'external')
    await mkdir(join(templatesRoot, 'unsafe-template'), { recursive: true })
    await mkdir(join(external, 'files'), { recursive: true })
    await writeFile(join(external, 'manifest.json'), JSON.stringify({
      schema: 'paimind.workspace-blueprint/v1',
      blueprintId: 'unsafe-template',
      version: '1.0.0',
      name: 'Unsafe',
      description: 'Unsafe linked template.',
      category: 'general',
      source: 'builtin',
    }))
    await symlink(external, join(templatesRoot, 'unsafe-template', '1.0.0'))
    const catalog = new WorkspaceBlueprintCatalog({ list: () => [] }, {
      templatesRoot,
      userTemplatesRoot: join(stateRoot, 'user-templates'),
    })

    await expect(catalog.listBlueprints()).rejects.toThrow()
  })

  it('fails closed on legacy recommendations instead of projecting them into composition', async () => {
    const stateRoot = await temporaryState()
    const templatesRoot = join(stateRoot, 'templates')
    const versionRoot = join(templatesRoot, 'legacy-template', '1.0.0')
    await mkdir(join(versionRoot, 'files'), { recursive: true })
    await writeFile(join(versionRoot, 'files', 'README.md'), 'legacy')
    await writeFile(join(versionRoot, 'manifest.json'), JSON.stringify({
      schema: 'paimind.workspace-blueprint/v1',
      blueprintId: 'legacy-template',
      version: '1.0.0',
      name: 'Legacy',
      description: 'Legacy recommendation shape.',
      category: 'general',
      source: 'builtin',
      recommendations: { agentPresetIds: [], businessSkillNames: [] },
    }))
    const catalog = new WorkspaceBlueprintCatalog({ list: () => [] }, {
      templatesRoot,
      userTemplatesRoot: join(stateRoot, 'user-templates'),
    })

    await expect(catalog.listBlueprints()).rejects.toThrow('unsupported fields')
  })
})
