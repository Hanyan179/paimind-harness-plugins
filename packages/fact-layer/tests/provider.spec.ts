import { describe, expect, it, vi } from 'vitest'
import { BUILD_FACT_SET_TOOL, FACT_LAYER_PROVIDER_ID, apply, factLayerProvider } from '../src/index.js'

describe('presentation Fact Layer', () => {
  it('runs the immutable merger only with exact resolved analysis paths', async () => {
    const context = { signal: new AbortController().signal, writeText: vi.fn(), runWorkspaceCommand: vi.fn(async () => ({ stdout: 'success' })) }
    await factLayerProvider.generate({ analysis_artifact_ids: ['artifact:performance', 'artifact:opportunity'], __analysis_paths: ['results/performance.data-result.json', 'results/opportunity.data-result.json'], output_path: 'results/proposal.fact-set.json' }, context)
    expect(context.runWorkspaceCommand).toHaveBeenCalledWith(expect.objectContaining({ command: expect.stringMatching(/runner\.mjs.*build.*artifact:performance.*performance\.data-result\.json/), timeoutMs: 60_000 }))
    expect(context.runWorkspaceCommand.mock.calls[0]?.[0].command).toContain(process.execPath)
    expect(context.runWorkspaceCommand.mock.calls[0]?.[0].command).not.toMatch(/^'node'\s/)
  })

  it('rejects cross-Session inputs and passes exact current-Session analysis Artifact paths', async () => {
    const definitions: any[] = []
    const execute = vi.fn(async () => ({ artifact: {} }))
    const artifact = (id: string, sessionId = 'session-1') => ({ schema: 'paimind.artifact-produced/v1', artifactId: id, sessionId, workspaceId: 'workspace-1', path: `/workspace/results/${id.split(':')[1]}.data-result.json`, title: id, kind: 'json', previewKind: 'data-document', revision: 1, producerId: 'paimind.category-demo.performance-analysis', taskId: id, state: 'available', producedAt: 1 })
    apply({
      paimindArtifactGenerators: { register: vi.fn(() => () => {}), execute, list: vi.fn(() => []) },
      tools: { register: vi.fn(value => { definitions.push(value); return () => {} }), execute: vi.fn() },
      systemPrompt: { section: vi.fn(() => () => {}), context: vi.fn(() => () => {}) },
      sessionProjections: { register: vi.fn(), snapshot: () => ({ asOfSeq: 1, values: { 'paimind.artifacts': { schema: 'paimind.artifacts/v1', traces: [], artifacts: [artifact('artifact:performance'), artifact('artifact:other', 'other-session')] } } }) },
      effect(install) { install() },
    })
    const tool = definitions.find(definition => definition.name === BUILD_FACT_SET_TOOL)
    const exec = { agent: { id: 'session-1', session: { id: 'session-1', header: { cwd: '/workspace' } } }, signal: new AbortController().signal }
    await tool.execute({ analysis_artifact_ids: ['artifact:performance'], output_path: 'results/proposal.fact-set.json' }, exec)
    expect(execute).toHaveBeenCalledWith(FACT_LAYER_PROVIDER_ID, expect.objectContaining({ __analysis_paths: ['results/performance.data-result.json'] }), exec)
    await expect(tool.execute({ analysis_artifact_ids: ['artifact:other'], output_path: 'results/other.fact-set.json' }, exec)).rejects.toThrow(/current-Session/)
  })
})
