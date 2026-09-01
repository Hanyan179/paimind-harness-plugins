import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { defineAnalysisDataResult } from '../../presentation-contracts/src/index.js'
import {
  FROZEN_DATA_PROVIDER_ID,
  PERFORMANCE_ANALYSIS_TOOL,
  apply,
  frozenDataProvider,
  opportunityProvider,
  performanceProvider,
} from '../src/index.js'

const run = promisify(execFile)

describe('category analysis adapter', () => {
  it('binds prepare, performance, and opportunity commands to the current Harness Node runtime', async () => {
    const runWorkspaceCommand = vi.fn(async () => ({ stdout: 'success' }))
    const context = {
      signal: new AbortController().signal,
      writeText: vi.fn(),
      runWorkspaceCommand,
    }
    await frozenDataProvider.generate({ output_dir: 'results/frozen' }, context)
    await performanceProvider.generate({
      __manifest_path: 'results/frozen/source-manifest.json',
      output_path: 'results/demo.performance.data-result.json',
    }, context)
    await opportunityProvider.generate({
      __manifest_path: 'results/frozen/source-manifest.json',
      output_path: 'results/demo.opportunity.data-result.json',
    }, context)

    expect(runWorkspaceCommand).toHaveBeenCalledTimes(3)
    for (const [{ command }] of runWorkspaceCommand.mock.calls) {
      expect(command).toContain(process.execPath)
      expect(command).not.toMatch(/^'node'\s/)
    }
    expect(runWorkspaceCommand.mock.calls.map(([request]) => request.command)).toEqual([
      expect.stringMatching(/runner\.mjs'.*'prepare'/),
      expect.stringMatching(/runner\.mjs'.*'performance'/),
      expect.stringMatching(/runner\.mjs'.*'opportunity'/),
    ])
  })

  it('creates hash-locked synthetic data and deterministic source-linked Facts', async () => {
    const temp = await mkdtemp(resolve(process.cwd(), '.tmp-category-analysis-'))
    const relative = temp.slice(process.cwd().length + 1)
    const runner = resolve(process.cwd(), 'packages/category-analysis-adapter/runtime/runner.mjs')
    try {
      await run(process.execPath, [runner, 'prepare', '--output-dir', `${relative}/frozen`], { cwd: process.cwd() })
      await run(process.execPath, [runner, 'performance', '--manifest', `${relative}/frozen/source-manifest.json`, '--output', `${relative}/performance.data-result.json`], { cwd: process.cwd() })
      const result = defineAnalysisDataResult(JSON.parse(await readFile(resolve(temp, 'performance.data-result.json'), 'utf8')))
      expect(result).toMatchObject({ schema: 'paimind.data-result/v2', analysisKind: 'category-performance-analysis' })
      expect(result.sources).toHaveLength(2)
      expect(result.facts).toHaveLength(66)
      expect(result.facts.find(fact => fact.factId === 'performance.total-sales')).toMatchObject({ displayValue: '$15.2M', factValuesChanged: false, sourceIds: ['dg-department-performance'] })
      expect(result.facts.find(fact => fact.factId === 'dept-140.sales')).toMatchObject({
        definition: 'Stickers & Creative Crafts current sales',
        dimensions: [{ key: 'department', label: 'Department', value: '140' }, { key: 'category', label: 'Category', value: 'Stickers & Creative Crafts' }],
      })
      expect(result.facts.find(fact => fact.factId === 'dept-410.sales')).toMatchObject({
        definition: 'Party Favors & Balloons current sales',
        dimensions: [{ key: 'department', label: 'Department', value: '410' }, { key: 'category', label: 'Category', value: 'Party Favors & Balloons' }],
      })
      await run(process.execPath, [runner, 'opportunity', '--manifest', `${relative}/frozen/source-manifest.json`, '--output', `${relative}/opportunity.data-result.json`], { cwd: process.cwd() })
      const opportunity = defineAnalysisDataResult(JSON.parse(await readFile(resolve(temp, 'opportunity.data-result.json'), 'utf8')))
      expect(opportunity.facts.find(fact => fact.factId === 'category-140.opportunity-score')).toMatchObject({ definition: 'Stickers & Creative Crafts composite opportunity score' })
      expect(opportunity.facts.find(fact => fact.factId === 'category-410.opportunity-score')).toMatchObject({ definition: 'Party Favors & Balloons composite opportunity score' })
      await writeFile(resolve(temp, 'frozen/dg-department-performance.csv'), 'tampered')
      await expect(run(process.execPath, [runner, 'performance', '--manifest', `${relative}/frozen/source-manifest.json`, '--output', `${relative}/tampered.data-result.json`], { cwd: process.cwd() })).rejects.toThrow(/source hash mismatch/)
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })

  it('resolves the exact current-Session frozen manifest Artifact before analysis', async () => {
    const definitions: any[] = []
    const execute = vi.fn(async () => ({ artifact: {} }))
    apply({
      paimindArtifactGenerators: { register: vi.fn(() => () => {}), execute, list: vi.fn(() => []) },
      tools: { register: vi.fn(value => { definitions.push(value); return () => {} }), execute: vi.fn() },
      systemPrompt: { section: vi.fn(() => () => {}), context: vi.fn(() => () => {}) },
      sessionProjections: { register: vi.fn(), snapshot: () => ({ asOfSeq: 1, values: { 'paimind.artifacts': { schema: 'paimind.artifacts/v1', traces: [], artifacts: [
        { schema: 'paimind.artifact-produced/v1', artifactId: 'artifact:manifest', sessionId: 'session-1', workspaceId: 'workspace-1', path: '/workspace/inputs/source-manifest.json', title: 'Manifest', kind: 'json', previewKind: 'data-document', revision: 1, producerId: FROZEN_DATA_PROVIDER_ID, taskId: 'task-1', state: 'available', producedAt: 1 },
      ] } } }) },
      effect(install) { install() },
    })
    const tool = definitions.find(definition => definition.name === PERFORMANCE_ANALYSIS_TOOL)
    const exec = { agent: { id: 'session-1', session: { id: 'session-1', header: { cwd: '/workspace' } } }, signal: new AbortController().signal }
    await tool.execute({ manifest_artifact_id: 'artifact:manifest', output_path: 'results/demo.performance.data-result.json' }, exec)
    expect(execute).toHaveBeenCalledWith('paimind.category-demo.performance-analysis', expect.objectContaining({ __manifest_path: 'inputs/source-manifest.json' }), exec)
  })
})
