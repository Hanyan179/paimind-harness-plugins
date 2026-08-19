import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  artifactToolMeta, presentArtifactToolResult,
  type PaimindArtifactGeneratorService, type PaimindGeneratorProvider,
} from '@paimind/artifact-runtime'
import {
  defineArtifactProducedEnvelope, defineArtifactProjection,
  type ArtifactProducedEnvelopeV1, type PaimindArtifactProjectionV1,
} from '@paimind/contracts'
import {
  definePaimindHarnessTool,
  type PaimindHostSessionProjectionRegistry, type PaimindHostSystemPrompt,
  type PaimindHostToolRegistry, type PaimindToolRunContext,
} from '@paimind/harness-compat/host'

export const name = 'paimind-walmart-proposal-adapter'
export const inject = ['paimindArtifactGenerators', 'tools', 'systemPrompt', 'sessionProjections']
export const FINELINE_PROVIDER_ID = 'paimind.walmart.fineline-analysis'
export const WHITE_SPACE_PROVIDER_ID = 'paimind.walmart.white-space-analysis'
export const WALMART_OUTLINE_PROVIDER_ID = 'paimind.walmart.buyer-proposal-outline'
export const FINELINE_TOOL = 'analyze_fineline_investment'
export const WHITE_SPACE_TOOL = 'analyze_white_space'
export const WALMART_OUTLINE_TOOL = 'build_walmart_buyer_proposal_outline'

type JsonRecord = Record<string, unknown>
function runtimeDir(): string {
  try { return fileURLToPath(new URL('../runtime', import.meta.url)) }
  catch { return resolve(process.cwd(), 'packages/walmart-proposal-adapter/runtime') }
}

export interface WalmartProposalHostContext {
  readonly paimindArtifactGenerators: PaimindArtifactGeneratorService
  readonly tools: PaimindHostToolRegistry
  readonly systemPrompt: PaimindHostSystemPrompt
  readonly sessionProjections: PaimindHostSessionProjectionRegistry
  effect(install: () => void | (() => void), label?: string): void
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}
function relativeJsonPath(value: unknown, label: string, suffix = '.json'): string {
  const path = text(value, label)
  if (path.startsWith('/') || path.startsWith('\\') || path.split(/[\\/]+/).includes('..') || !path.toLowerCase().endsWith(suffix)) throw new Error(`${label} must be a Workspace-relative ${suffix} path`)
  return path
}
function shellQuote(value: string): string { return `'${value.replaceAll("'", `'\\''`)}'` }
function command(parts: readonly string[]): string { return parts.map(shellQuote).join(' ') }

interface AnalysisArgs { readonly manifestPath: string; readonly outputPath: string; readonly category: string }
function analysisArgs(input: Readonly<JsonRecord>, suffix: string): AnalysisArgs {
  return {
    manifestPath: relativeJsonPath(input.manifest_path, 'manifest_path'),
    outputPath: relativeJsonPath(input.output_path, 'output_path', suffix),
    category: input.category === undefined ? 'KIDS CRAFTS' : text(input.category, 'category'),
  }
}

function analysisProvider(kind: 'fineline' | 'white-space'): PaimindGeneratorProvider {
  const providerId = kind === 'fineline' ? FINELINE_PROVIDER_ID : WHITE_SPACE_PROVIDER_ID
  const suffix = kind === 'fineline' ? '.fineline.data-result.json' : '.white-space.data-result.json'
  return {
    id: providerId, kind: 'json', previewKind: 'data-document',
    describe(input) { const value = analysisArgs(input, suffix); return { path: value.outputPath, title: kind === 'fineline' ? 'Walmart Fineline Investment Analysis' : 'Walmart White-space Analysis' } },
    async generate(input, context) {
      const value = analysisArgs(input, suffix)
      await context.runWorkspaceCommand({
        command: command(['uv', 'run', '--project', runtimeDir(), '--locked', '--python', '3.12', 'python', `${runtimeDir()}/runner.py`, kind, '--manifest', value.manifestPath, '--output', value.outputPath, '--category', value.category]),
        description: `Run deterministic Walmart ${kind} analysis`, timeoutMs: 15 * 60_000,
      })
      return { path: value.outputPath, title: kind === 'fineline' ? 'Walmart Fineline Investment Analysis' : 'Walmart White-space Analysis' }
    },
  }
}

export const finelineProvider = analysisProvider('fineline')
export const whiteSpaceProvider = analysisProvider('white-space')

interface OutlineArgs { readonly outputPath: string; readonly finelinePath: string; readonly whiteSpacePath: string; readonly finelineArtifactId: string; readonly whiteSpaceArtifactId: string }
function outlineArgs(input: Readonly<JsonRecord>): OutlineArgs {
  return {
    outputPath: relativeJsonPath(input.output_path, 'output_path', '.outline.json'),
    finelinePath: text(input.__fineline_path, 'resolved fineline Artifact path'), whiteSpacePath: text(input.__white_space_path, 'resolved white-space Artifact path'),
    finelineArtifactId: text(input.fineline_artifact_id, 'fineline_artifact_id'), whiteSpaceArtifactId: text(input.white_space_artifact_id, 'white_space_artifact_id'),
  }
}

export const walmartOutlineProvider: PaimindGeneratorProvider = {
  id: WALMART_OUTLINE_PROVIDER_ID, kind: 'json', previewKind: 'data-document',
  describe(input) { const value = outlineArgs(input); return { path: value.outputPath, title: 'Walmart Buyer Proposal · Outline' } },
  async generate(input, context) {
    const value = outlineArgs(input)
    await context.runWorkspaceCommand({
      command: command(['uv', 'run', '--project', runtimeDir(), '--locked', '--python', '3.12', 'python', `${runtimeDir()}/runner.py`, 'outline', '--fineline', value.finelinePath, '--white-space', value.whiteSpacePath, '--fineline-artifact-id', value.finelineArtifactId, '--white-space-artifact-id', value.whiteSpaceArtifactId, '--output', value.outputPath]),
      description: 'Build deterministic Walmart buyer proposal outline', timeoutMs: 10 * 60_000,
    })
    await context.runWorkspaceCommand({ command: command(['node', `${runtimeDir()}/validate-outline.mjs`, value.outputPath, '18', '30']), description: 'Validate focused 18-30 slide Walmart presentation outline', timeoutMs: 30_000 })
    return { path: value.outputPath, title: 'Walmart Buyer Proposal · Outline' }
  },
}

function artifactFromValue(value: JsonRecord): Readonly<ArtifactProducedEnvelopeV1> { return defineArtifactProducedEnvelope(value.artifact as ArtifactProducedEnvelopeV1) }
const ARTIFACT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  schema: { type: 'string', required: true }, artifactId: { type: 'string', required: true }, sessionId: { type: 'string', required: true }, workspaceId: { type: 'string', required: true }, path: { type: 'string', required: true }, title: { type: 'string', required: true }, kind: { type: 'string', required: true }, previewKind: { type: 'string', required: true }, revision: { type: 'number', required: true }, producerId: { type: 'string', required: true }, taskId: { type: 'string', required: true }, state: { type: 'string', required: true }, producedAt: { type: 'number', required: true }, error: { type: 'object', additionalProperties: false, properties: { code: { type: 'string', required: true }, message: { type: 'string', required: true } } },
} } as const
const TOOL_OUTPUT = { type: 'object', additionalProperties: false, properties: { artifact: { ...ARTIFACT_SCHEMA, required: true } } } as const
function render(value: JsonRecord, label: string): { type: 'text'; text: string }[] { const artifact = artifactFromValue(value); return [{ type: 'text', text: artifact.state === 'available' ? `<artifact path="${artifact.path}" id="${artifact.artifactId}" revision="${artifact.revision}">${label}</artifact>` : `<artifact-error code="${artifact.error?.code ?? 'analysis_failed'}">${artifact.error?.message ?? 'Analysis failed'}</artifact-error>` }] }

function artifactsFor(ctx: WalmartProposalHostContext, exec: PaimindToolRunContext): readonly Readonly<ArtifactProducedEnvelopeV1>[] {
  if (exec.agent === undefined) throw new Error('Walmart outline generation requires a live Harness Agent')
  const value = ctx.sessionProjections.snapshot(exec.agent.session).values['paimind.artifacts']
  return defineArtifactProjection(value as PaimindArtifactProjectionV1).artifacts
}
function resolveAnalysisArtifact(ctx: WalmartProposalHostContext, exec: PaimindToolRunContext, artifactId: string, producerId: string): Readonly<ArtifactProducedEnvelopeV1> {
  const artifact = artifactsFor(ctx, exec).find(candidate => candidate.artifactId === artifactId)
  if (artifact === undefined || artifact.state !== 'available' || artifact.kind !== 'json' || artifact.producerId !== producerId || artifact.sessionId !== exec.agent?.id) throw new Error(`Artifact ${artifactId} is not an available current-Session ${producerId} data_result`)
  return artifact
}

function commonOutput(label: string) {
  return { schema: TOOL_OUTPUT, render(_args: JsonRecord, value: JsonRecord) { return render(value, label) }, presentationMeta(_args: JsonRecord, value: JsonRecord) { return artifactToolMeta(artifactFromValue(value)) } }
}

export function apply(ctx: WalmartProposalHostContext): void {
  ctx.effect(() => {
    const disposers = [ctx.paimindArtifactGenerators.register(finelineProvider), ctx.paimindArtifactGenerators.register(whiteSpaceProvider), ctx.paimindArtifactGenerators.register(walmartOutlineProvider)]
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'paimind-walmart-proposal-adapter: providers')
  ctx.systemPrompt.section({ name: 'tool:walmart-proposal-analysis', order: 115, text: 'For complete Walmart buyer proposals, use analyze_fineline_investment and analyze_white_space only with a hash-locked paimind.analysis-source-manifest/v1, then call build_walmart_buyer_proposal_outline with the two returned Artifact IDs. The validated buyer-proposal outline must retain 18-30 purposeful slides, cover the complete decision story, and avoid page-count padding. Never use live database credentials, substitute model calculations, or bypass these native Tools.' })
  ctx.tools.register(definePaimindHarnessTool({ name: FINELINE_TOOL, description: 'Run the packaged Python 3.12 Fineline CLI against sourceId fineline-source in a verified frozen manifest and publish a SHA-256 data_result Artifact.', parameters: { manifest_path: { type: 'string', required: true }, output_path: { type: 'string', required: true }, category: { type: 'string' } }, output: commonOutput('Generated Fineline data_result'), async execute(args, exec) { return await ctx.paimindArtifactGenerators.execute(FINELINE_PROVIDER_ID, args, exec) }, presentCall: args => ({ card: 'generic', title: 'Analyze Fineline investment', kind: 'edit', rawInput: args.manifest_path }), presentResult(_args, result) { return presentArtifactToolResult(result) } }))
  ctx.tools.register(definePaimindHarnessTool({ name: WHITE_SPACE_TOOL, description: 'Run the packaged Python 3.12 White-space CLI against performance, assortment, tags and portfolio sources in a verified frozen manifest and publish a SHA-256 data_result Artifact.', parameters: { manifest_path: { type: 'string', required: true }, output_path: { type: 'string', required: true }, category: { type: 'string' } }, output: commonOutput('Generated White-space data_result'), async execute(args, exec) { return await ctx.paimindArtifactGenerators.execute(WHITE_SPACE_PROVIDER_ID, args, exec) }, presentCall: args => ({ card: 'generic', title: 'Analyze White space', kind: 'edit', rawInput: args.manifest_path }), presentResult(_args, result) { return presentArtifactToolResult(result) } }))
  ctx.tools.register(definePaimindHarnessTool({ name: WALMART_OUTLINE_TOOL, description: 'Build a validated focused 18-30 slide paimind.presentation-outline/v1 from exactly one current-Session Fineline and one White-space data_result Artifact ID.', parameters: { fineline_artifact_id: { type: 'string', required: true }, white_space_artifact_id: { type: 'string', required: true }, output_path: { type: 'string', required: true } }, output: commonOutput('Generated Walmart proposal outline'), async execute(args, exec) { const finelineId = text(args.fineline_artifact_id, 'fineline_artifact_id'); const whiteSpaceId = text(args.white_space_artifact_id, 'white_space_artifact_id'); const fineline = resolveAnalysisArtifact(ctx, exec, finelineId, FINELINE_PROVIDER_ID); const whiteSpace = resolveAnalysisArtifact(ctx, exec, whiteSpaceId, WHITE_SPACE_PROVIDER_ID); return await ctx.paimindArtifactGenerators.execute(WALMART_OUTLINE_PROVIDER_ID, { ...args, __fineline_path: fineline.path, __white_space_path: whiteSpace.path }, exec) }, presentCall: args => ({ card: 'generic', title: 'Build Walmart buyer proposal outline', kind: 'edit', rawInput: args.output_path }), presentResult(_args, result) { return presentArtifactToolResult(result) } }))
}
