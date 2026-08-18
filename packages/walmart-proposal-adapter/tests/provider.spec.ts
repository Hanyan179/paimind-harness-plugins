import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FINELINE_PROVIDER_ID, WHITE_SPACE_PROVIDER_ID, apply, finelineProvider, walmartOutlineProvider } from '../src/index.js'

const context = () => ({ signal: new AbortController().signal, writeText: vi.fn(), runWorkspaceCommand: vi.fn(async () => ({ stdout: 'success' })) })

describe('Walmart proposal adapter', () => {
  it('runs only the packaged locked Python 3.12 runtime and keeps outputs Workspace-relative', async () => {
    const ctx = context()
    await finelineProvider.generate({ manifest_path: 'inputs/manifest.json', output_path: 'results/test.fineline.data-result.json', category: 'KIDS CRAFTS' }, ctx)
    expect(ctx.runWorkspaceCommand).toHaveBeenCalledWith(expect.objectContaining({ command: expect.stringMatching(/uv.*--locked.*--python.*3\.12.*runner\.py.*fineline/), timeoutMs: 900_000 }))
    expect(() => finelineProvider.describe({ manifest_path: '../manifest.json', output_path: 'result.fineline.data-result.json' })).toThrow(/Workspace-relative/)
  })

  it('runs the upstream outline CLI then the shared Outline validator', async () => {
    const ctx = context()
    const output = await walmartOutlineProvider.generate({ output_path: 'proposal.outline.json', fineline_artifact_id: 'artifact:fineline', white_space_artifact_id: 'artifact:white', __fineline_path: '/workspace/fineline.json', __white_space_path: '/workspace/white.json' }, ctx)
    expect(output.path).toBe('proposal.outline.json')
    expect(ctx.runWorkspaceCommand).toHaveBeenCalledTimes(2)
    expect(ctx.runWorkspaceCommand.mock.calls[0]?.[0].command).toMatch(/runner\.py.*outline/)
    expect(ctx.runWorkspaceCommand.mock.calls[1]?.[0].command).toMatch(/validate-outline\.mjs/)
    expect(ctx.runWorkspaceCommand.mock.calls[1]?.[0].command).toMatch(/'18'.*'30'/)
  })

  it('resolves exact current-Session analysis Artifact IDs before outline generation', async () => {
    const definitions: any[] = []
    const execute = vi.fn(async () => ({ artifact: {} }))
    apply({
      paimindArtifactGenerators: { register: vi.fn(() => () => {}), list: vi.fn(() => []), execute },
      tools: { register: vi.fn(value => { definitions.push(value); return () => {} }), execute: vi.fn() },
      systemPrompt: { section: vi.fn(() => () => {}), context: vi.fn(() => () => {}) },
      sessionProjections: { register: vi.fn(), snapshot: () => ({ asOfSeq: 3, values: { 'paimind.artifacts': { schema: 'paimind.artifacts/v1', traces: [], artifacts: [
        { schema: 'paimind.artifact-produced/v1', artifactId: 'artifact:fineline', sessionId: 'session-1', workspaceId: 'workspace-1', path: '/workspace/fineline.json', title: 'Fineline', kind: 'json', previewKind: 'data-document', revision: 1, producerId: FINELINE_PROVIDER_ID, taskId: 'job-1', state: 'available', producedAt: 1 },
        { schema: 'paimind.artifact-produced/v1', artifactId: 'artifact:white', sessionId: 'session-1', workspaceId: 'workspace-1', path: '/workspace/white.json', title: 'White', kind: 'json', previewKind: 'data-document', revision: 1, producerId: WHITE_SPACE_PROVIDER_ID, taskId: 'job-2', state: 'available', producedAt: 2 },
      ] } } }) },
      effect(install) { install() },
    })
    const tool = definitions.find(definition => definition.name === 'build_walmart_buyer_proposal_outline')
    await tool.execute({ fineline_artifact_id: 'artifact:fineline', white_space_artifact_id: 'artifact:white', output_path: 'proposal.outline.json' }, { agent: { id: 'session-1', session: { id: 'session-1', header: { cwd: '/workspace' } } }, signal: new AbortController().signal })
    expect(execute).toHaveBeenCalledWith('paimind.walmart.buyer-proposal-outline', expect.objectContaining({ __fineline_path: '/workspace/fineline.json', __white_space_path: '/workspace/white.json' }), expect.anything())
  })

  it('publishes the exact upstream baseline and a hash-locked Python dependency graph', async () => {
    const root = resolve(process.cwd(), 'packages/walmart-proposal-adapter/runtime')
    await expect(readFile(resolve(root, 'UPSTREAM_COMMIT'), 'utf8')).resolves.toBe('1f9fd80ea073a4ab4b5665b2300f7930f3f0520f\n')
    const lock = await readFile(resolve(root, 'uv.lock'), 'utf8')
    expect(lock).toContain('name = "pandas"')
    expect(lock).toMatch(/sha256:[a-f0-9]{64}/)
  })
})
