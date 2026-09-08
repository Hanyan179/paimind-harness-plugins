import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  artifactToolMeta, artifactWorkspaceRelativePath, presentArtifactToolResult, requireCurrentSessionArtifact,
  type PaimindArtifactGeneratorService, type PaimindGeneratorProvider,
} from '@hansen/artifact-runtime'
import {
  defineArtifactProducedEnvelope,
  type ArtifactProducedEnvelopeV1,
} from '@hansen/contracts'
import {
  definePaimindHarnessTool,
  type PaimindHostSessionProjectionRegistry, type PaimindHostSystemPrompt,
  type PaimindHostToolRegistry, type PaimindToolRunContext,
} from '@hansen/harness-compat/host'

export const name = 'paimind-category-analysis-adapter'
export const inject = ['paimindArtifactGenerators', 'tools', 'systemPrompt', 'sessionProjections']
export const FROZEN_DATA_PROVIDER_ID = 'paimind.category-demo.frozen-data'
export const PERFORMANCE_PROVIDER_ID = 'paimind.category-demo.performance-analysis'
export const OPPORTUNITY_PROVIDER_ID = 'paimind.category-demo.opportunity-analysis'
export const PREPARE_CATEGORY_DATA_TOOL = 'prepare_category_demo_data'
export const PERFORMANCE_ANALYSIS_TOOL = 'analyze_category_performance'
export const OPPORTUNITY_ANALYSIS_TOOL = 'analyze_category_opportunity'

type JsonRecord = Record<string, unknown>
function runtimeDir(): string {
  try { return fileURLToPath(new URL('../runtime', import.meta.url)) }
  catch { return resolve(process.cwd(), 'packages/category-analysis-adapter/runtime') }
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}
function workspacePath(value: unknown, label: string, suffix?: string): string {
  const path = text(value, label)
  if (path.startsWith('/') || path.startsWith('\\') || path.split(/[\\/]+/).includes('..') || (suffix !== undefined && !path.toLowerCase().endsWith(suffix))) throw new Error(`${label} must be a Workspace-relative${suffix === undefined ? '' : ` ${suffix}`} path`)
  return path.replace(/\/$/, '')
}
function shellQuote(value: string): string { return `'${value.replaceAll("'", `'\\''`)}'` }
function command(parts: readonly string[]): string { return parts.map(shellQuote).join(' ') }

export interface CategoryAnalysisHostContext {
  readonly paimindArtifactGenerators: PaimindArtifactGeneratorService
  readonly tools: PaimindHostToolRegistry
  readonly systemPrompt: PaimindHostSystemPrompt
  readonly sessionProjections: PaimindHostSessionProjectionRegistry
  effect(install: () => void | (() => void), label?: string): void
}

export const frozenDataProvider: PaimindGeneratorProvider = {
  id: FROZEN_DATA_PROVIDER_ID, kind: 'json', previewKind: 'data-document',
  describe(input) { const outputDir = workspacePath(input.output_dir, 'output_dir'); return { path: `${outputDir}/source-manifest.json`, title: 'DG Synthetic Category Data · Frozen Manifest' } },
  async generate(input, context) {
    const outputDir = workspacePath(input.output_dir, 'output_dir')
    await context.runWorkspaceCommand({ command: command([process.execPath, `${runtimeDir()}/runner.mjs`, 'prepare', '--output-dir', outputDir]), description: 'Prepare hash-locked synthetic DG category data', timeoutMs: 30_000 })
    return { path: `${outputDir}/source-manifest.json`, title: 'DG Synthetic Category Data · Frozen Manifest' }
  },
}

function analysisProvider(kind: 'performance' | 'opportunity'): PaimindGeneratorProvider {
  const id = kind === 'performance' ? PERFORMANCE_PROVIDER_ID : OPPORTUNITY_PROVIDER_ID
  const suffix = kind === 'performance' ? '.performance.data-result.json' : '.opportunity.data-result.json'
  return {
    id, kind: 'json', previewKind: 'data-document',
    describe(input) { return { path: workspacePath(input.output_path, 'output_path', suffix), title: kind === 'performance' ? 'DG Category Performance Analysis' : 'DG Category Opportunity Analysis' } },
    async generate(input, context) {
      const output = workspacePath(input.output_path, 'output_path', suffix)
      const manifest = text(input.__manifest_path, 'resolved manifest Artifact path')
      await context.runWorkspaceCommand({ command: command([process.execPath, `${runtimeDir()}/runner.mjs`, kind, '--manifest', manifest, '--output', output]), description: `Run deterministic DG category ${kind} analysis`, timeoutMs: 60_000 })
      return { path: output, title: kind === 'performance' ? 'DG Category Performance Analysis' : 'DG Category Opportunity Analysis' }
    },
  }
}
export const performanceProvider = analysisProvider('performance')
export const opportunityProvider = analysisProvider('opportunity')

function artifactFromValue(value: JsonRecord): Readonly<ArtifactProducedEnvelopeV1> { return defineArtifactProducedEnvelope(value.artifact as ArtifactProducedEnvelopeV1) }
const ARTIFACT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  schema: { type: 'string', required: true }, artifactId: { type: 'string', required: true }, sessionId: { type: 'string', required: true }, workspaceId: { type: 'string', required: true }, path: { type: 'string', required: true }, title: { type: 'string', required: true }, kind: { type: 'string', required: true }, previewKind: { type: 'string', required: true }, revision: { type: 'number', required: true }, producerId: { type: 'string', required: true }, taskId: { type: 'string', required: true }, state: { type: 'string', required: true }, producedAt: { type: 'number', required: true }, error: { type: 'object', additionalProperties: false, properties: { code: { type: 'string', required: true }, message: { type: 'string', required: true } } },
} } as const
const TOOL_OUTPUT = { type: 'object', additionalProperties: false, properties: { artifact: { ...ARTIFACT_SCHEMA, required: true } } } as const
function output(label: string) { return { schema: TOOL_OUTPUT, render(_args: JsonRecord, value: JsonRecord) { const artifact = artifactFromValue(value); return [{ type: 'text' as const, text: artifact.state === 'available' ? `<artifact path="${artifact.path}" id="${artifact.artifactId}" revision="${artifact.revision}">${label}</artifact>` : `<artifact-error code="${artifact.error?.code ?? 'analysis_failed'}">${artifact.error?.message ?? 'Analysis failed'}</artifact-error>` }] }, presentationMeta(_args: JsonRecord, value: JsonRecord) { return artifactToolMeta(artifactFromValue(value)) } } }

function manifestArtifact(ctx: CategoryAnalysisHostContext, exec: PaimindToolRunContext, artifactId: string): Readonly<ArtifactProducedEnvelopeV1> {
  if (exec.agent === undefined) throw new Error('category analysis requires a live Harness Agent')
  return requireCurrentSessionArtifact(
    ctx.sessionProjections.snapshot(exec.agent.session).values['paimind.artifacts'], exec, artifactId,
    { description: 'the available current-Session frozen-data manifest', kind: 'json', producerIds: [FROZEN_DATA_PROVIDER_ID] },
  )
}

export function apply(ctx: CategoryAnalysisHostContext): void {
  ctx.effect(() => {
    const disposers = [ctx.paimindArtifactGenerators.register(frozenDataProvider), ctx.paimindArtifactGenerators.register(performanceProvider), ctx.paimindArtifactGenerators.register(opportunityProvider)]
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'paimind-category-analysis-adapter: providers')
  ctx.systemPrompt.section({ name: 'tool:category-analysis', order: 115, text: 'For the Proposal Assistant synthetic Dollar General demo, first call prepare_category_demo_data. Pass its current-Session Artifact ID to analyze_category_performance and analyze_category_opportunity. The scenario is synthetic and must never be presented as external market truth. Never calculate substitute metrics in model prose, invent source hashes, or bypass these native Tools.' })
  ctx.tools.register(definePaimindHarnessTool({ name: PREPARE_CATEGORY_DATA_TOOL, description: 'Copy the packaged synthetic DG category fixture into the current Workspace, hash every CSV and publish a frozen source-manifest Artifact.', parameters: { output_dir: { type: 'string', required: true } }, output: output('Prepared synthetic frozen data'), async execute(args, exec) { return await ctx.paimindArtifactGenerators.execute(FROZEN_DATA_PROVIDER_ID, args, exec) }, presentCall: args => ({ card: 'generic', title: 'Prepare synthetic DG category data', kind: 'edit', rawInput: args.output_dir }), presentResult(_args, result) { return presentArtifactToolResult(result) } }))
  for (const definition of [
    { name: PERFORMANCE_ANALYSIS_TOOL, provider: PERFORMANCE_PROVIDER_ID, title: 'Analyze category performance', label: 'Generated performance data_result', suffix: '.performance.data-result.json' },
    { name: OPPORTUNITY_ANALYSIS_TOOL, provider: OPPORTUNITY_PROVIDER_ID, title: 'Analyze category opportunity', label: 'Generated opportunity data_result', suffix: '.opportunity.data-result.json' },
  ] as const) ctx.tools.register(definePaimindHarnessTool({ name: definition.name, description: `Run the deterministic synthetic DG ${definition.title.toLowerCase()} Tool against one verified frozen-manifest Artifact.`, parameters: { manifest_artifact_id: { type: 'string', required: true, description: 'Artifact ID returned by prepare_category_demo_data in this conversation.' }, output_path: { type: 'string', required: true, description: `Workspace-relative output file; must end with ${definition.suffix}. Example: deliverables/category${definition.suffix}` } }, output: output(definition.label), async execute(args, exec) { const artifactId = text(args.manifest_artifact_id, 'manifest_artifact_id'); const manifest = manifestArtifact(ctx, exec, artifactId); return await ctx.paimindArtifactGenerators.execute(definition.provider, { ...args, __manifest_path: artifactWorkspaceRelativePath(manifest.path, exec, { label: 'resolved manifest Artifact path' }) }, exec) }, presentCall: args => ({ card: 'generic', title: definition.title, kind: 'edit', rawInput: args.output_path }), presentResult(_args, result) { return presentArtifactToolResult(result) } }))
}
