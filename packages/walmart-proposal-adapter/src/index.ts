import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  artifactToolMeta, artifactWorkspaceRelativePath, presentArtifactToolResult, requireCurrentSessionArtifact,
  type PaimindArtifactGeneratorService, type PaimindGeneratorProvider,
} from '@paimind/artifact-runtime'
import {
  defineArtifactProducedEnvelope,
  type ArtifactProducedEnvelopeV1,
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
export const WALMART_DEMO_DATA_PROVIDER_ID = 'paimind.walmart-demo.frozen-data'
export const PREPARE_WALMART_DEMO_DATA_TOOL = 'prepare_walmart_demo_data'
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
function uvRunnerCommand(args: readonly string[]): string {
  const workspaceEnvironment = 'UV_CACHE_DIR="$PWD/.paimind-runtime/uv-cache" UV_PROJECT_ENVIRONMENT="$PWD/.paimind-runtime/walmart-proposal-venv"'
  return `${workspaceEnvironment} ${command([
    'uv', 'run', '--project', runtimeDir(), '--locked', '--python', '3.12', 'python',
    `${runtimeDir()}/runner.py`, ...args,
  ])}`
}

export const walmartDemoDataProvider: PaimindGeneratorProvider = {
  id: WALMART_DEMO_DATA_PROVIDER_ID, kind: 'json', previewKind: 'data-document',
  describe(input) { const outputDir = relativeJsonPath(`${text(input.output_dir, 'output_dir').replace(/\/$/, '')}/source-manifest.json`, 'output_dir manifest'); return { path: outputDir, title: 'Walmart Synthetic Demo Data · Frozen Manifest' } },
  async generate(input, context) {
    const outputDir = text(input.output_dir, 'output_dir').replace(/\/$/, '')
    relativeJsonPath(`${outputDir}/source-manifest.json`, 'output_dir manifest')
    await context.runWorkspaceCommand({
      command: uvRunnerCommand(['prepare', '--output-dir', outputDir]),
      description: 'Prepare hash-locked synthetic Walmart demo data', timeoutMs: 120_000,
    })
    return { path: `${outputDir}/source-manifest.json`, title: 'Walmart Synthetic Demo Data · Frozen Manifest' }
  },
}

interface AnalysisArgs { readonly manifestPath: string; readonly outputPath: string; readonly category: string }
function analysisArgs(input: Readonly<JsonRecord>, suffix: string): AnalysisArgs {
  return {
    manifestPath: relativeJsonPath(input.__manifest_path ?? input.manifest_path, 'manifest_path'),
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
        command: uvRunnerCommand([kind, '--manifest', value.manifestPath, '--output', value.outputPath, '--category', value.category]),
        description: `Run deterministic Walmart ${kind} analysis`, timeoutMs: 15 * 60_000,
      })
      return { path: value.outputPath, title: kind === 'fineline' ? 'Walmart Fineline Investment Analysis' : 'Walmart White-space Analysis' }
    },
  }
}

export const finelineProvider = analysisProvider('fineline')
export const whiteSpaceProvider = analysisProvider('white-space')

interface OutlineArgs { readonly outputPath: string; readonly finelinePath: string; readonly whiteSpacePath: string; readonly finelineArtifactId: string; readonly whiteSpaceArtifactId: string; readonly title?: string }
function outlineArgs(input: Readonly<JsonRecord>): OutlineArgs {
  return {
    outputPath: relativeJsonPath(input.output_path, 'output_path', '.outline.json'),
    ...(input.title === undefined ? {} : { title: text(input.title, 'title') }),
    finelinePath: text(input.__fineline_path, 'resolved fineline Artifact path'), whiteSpacePath: text(input.__white_space_path, 'resolved white-space Artifact path'),
    finelineArtifactId: text(input.fineline_artifact_id, 'fineline_artifact_id'), whiteSpaceArtifactId: text(input.white_space_artifact_id, 'white_space_artifact_id'),
  }
}

export const walmartOutlineProvider: PaimindGeneratorProvider = {
  id: WALMART_OUTLINE_PROVIDER_ID, kind: 'json', previewKind: 'data-document',
  describe(input) { const value = outlineArgs(input); return { path: value.outputPath, title: value.title ?? 'Walmart Buyer Proposal · Outline' } },
  async generate(input, context) {
    const value = outlineArgs(input)
    await context.runWorkspaceCommand({
      command: uvRunnerCommand(['outline', '--fineline', value.finelinePath, '--white-space', value.whiteSpacePath, '--fineline-artifact-id', value.finelineArtifactId, '--white-space-artifact-id', value.whiteSpaceArtifactId, '--output', value.outputPath, ...(value.title === undefined ? [] : ['--title', value.title])]),
      description: 'Build deterministic Walmart buyer proposal outline', timeoutMs: 10 * 60_000,
    })
    await context.runWorkspaceCommand({ command: command([process.execPath, `${runtimeDir()}/validate-outline.mjs`, value.outputPath, '18', '30']), description: 'Validate focused 18-30 slide Walmart presentation outline', timeoutMs: 30_000 })
    return { path: value.outputPath, title: value.title ?? 'Walmart Buyer Proposal · Outline' }
  },
}

function artifactFromValue(value: JsonRecord): Readonly<ArtifactProducedEnvelopeV1> { return defineArtifactProducedEnvelope(value.artifact as ArtifactProducedEnvelopeV1) }
const ARTIFACT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  schema: { type: 'string', required: true }, artifactId: { type: 'string', required: true }, sessionId: { type: 'string', required: true }, workspaceId: { type: 'string', required: true }, path: { type: 'string', required: true }, title: { type: 'string', required: true }, kind: { type: 'string', required: true }, previewKind: { type: 'string', required: true }, revision: { type: 'number', required: true }, producerId: { type: 'string', required: true }, taskId: { type: 'string', required: true }, state: { type: 'string', required: true }, producedAt: { type: 'number', required: true }, error: { type: 'object', additionalProperties: false, properties: { code: { type: 'string', required: true }, message: { type: 'string', required: true } } },
} } as const
const TOOL_OUTPUT = { type: 'object', additionalProperties: false, properties: { artifact: { ...ARTIFACT_SCHEMA, required: true } } } as const
function render(value: JsonRecord, label: string): { type: 'text'; text: string }[] { const artifact = artifactFromValue(value); return [{ type: 'text', text: artifact.state === 'available' ? `<artifact path="${artifact.path}" id="${artifact.artifactId}" revision="${artifact.revision}">${label}</artifact>` : `<artifact-error code="${artifact.error?.code ?? 'analysis_failed'}">${artifact.error?.message ?? 'Analysis failed'}</artifact-error>` }] }

function resolveAnalysisArtifact(ctx: WalmartProposalHostContext, exec: PaimindToolRunContext, artifactId: string, producerId: string): Readonly<ArtifactProducedEnvelopeV1> {
  if (exec.agent === undefined) throw new Error('Walmart outline generation requires a live Harness Agent')
  return requireCurrentSessionArtifact(
    ctx.sessionProjections.snapshot(exec.agent.session).values['paimind.artifacts'], exec, artifactId,
    { description: `an available current-Session ${producerId} data_result`, kind: 'json', producerIds: [producerId] },
  )
}

function resolveDemoManifest(ctx: WalmartProposalHostContext, exec: PaimindToolRunContext, args: Readonly<JsonRecord>): Readonly<JsonRecord> {
  const artifactId = typeof args.manifest_artifact_id === 'string' ? args.manifest_artifact_id.trim() : ''
  const manifestPath = typeof args.manifest_path === 'string' ? args.manifest_path.trim() : ''
  if ((artifactId === '') === (manifestPath === '')) throw new Error('provide exactly one of manifest_artifact_id or manifest_path')
  if (manifestPath !== '') return args
  if (exec.agent === undefined) throw new Error('Walmart demo analysis requires a live Harness Agent')
  const manifest = requireCurrentSessionArtifact(
    ctx.sessionProjections.snapshot(exec.agent.session).values['paimind.artifacts'], exec, artifactId,
    { description: 'the available current-Session Walmart synthetic frozen-data manifest', kind: 'json', producerIds: [WALMART_DEMO_DATA_PROVIDER_ID] },
  )
  return { ...args, __manifest_path: artifactWorkspaceRelativePath(manifest.path, exec, { label: 'resolved Walmart demo manifest Artifact path' }) }
}

function commonOutput(label: string) {
  return { schema: TOOL_OUTPUT, render(_args: JsonRecord, value: JsonRecord) { return render(value, label) }, presentationMeta(_args: JsonRecord, value: JsonRecord) { return artifactToolMeta(artifactFromValue(value)) } }
}

export function apply(ctx: WalmartProposalHostContext): void {
  ctx.effect(() => {
    const disposers = [ctx.paimindArtifactGenerators.register(walmartDemoDataProvider), ctx.paimindArtifactGenerators.register(finelineProvider), ctx.paimindArtifactGenerators.register(whiteSpaceProvider), ctx.paimindArtifactGenerators.register(walmartOutlineProvider)]
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'paimind-walmart-proposal-adapter: providers')
  ctx.systemPrompt.section({ name: 'tool:walmart-proposal-analysis', order: 115, text: 'For a synthetic Walmart demonstration, first call prepare_walmart_demo_data and pass its exact current-Session Artifact ID to both analysis Tools. For business-data work, use only an approved hash-locked paimind.analysis-source-manifest/v1 path. Then call build_walmart_buyer_proposal_outline with the two returned Artifact IDs. Always label synthetic data as demonstration data and never present it as Walmart market truth. Never use live database credentials, substitute model calculations, or bypass these native Tools.' })
  ctx.tools.register(definePaimindHarnessTool({ name: PREPARE_WALMART_DEMO_DATA_TOOL, description: 'Create deterministic synthetic Walmart Kids Crafts source files in the current Workspace, hash every file and publish a frozen source-manifest Artifact for demo use only.', parameters: { output_dir: { type: 'string', required: true } }, output: commonOutput('Prepared synthetic Walmart frozen data'), async execute(args, exec) { return await ctx.paimindArtifactGenerators.execute(WALMART_DEMO_DATA_PROVIDER_ID, args, exec) }, presentCall: args => ({ card: 'generic', title: 'Prepare synthetic Walmart demo data', kind: 'edit', rawInput: args.output_dir }), presentResult(_args, result) { return presentArtifactToolResult(result) } }))
  const analysisParameters = { manifest_artifact_id: { type: 'string' }, manifest_path: { type: 'string' }, output_path: { type: 'string', required: true }, category: { type: 'string' } } as const
  ctx.tools.register(definePaimindHarnessTool({ name: FINELINE_TOOL, description: 'Run the packaged Python 3.12 Fineline CLI using either the exact current-Session synthetic manifest Artifact ID or an approved Workspace manifest path, then publish a SHA-256 data_result Artifact.', parameters: { ...analysisParameters, output_path: { type: 'string', required: true, description: 'Workspace-relative path ending in .fineline.data-result.json, for example deliverables/retail.fineline.data-result.json.' } }, output: commonOutput('Generated Fineline data_result'), async execute(args, exec) { return await ctx.paimindArtifactGenerators.execute(FINELINE_PROVIDER_ID, resolveDemoManifest(ctx, exec, args), exec) }, presentCall: args => ({ card: 'generic', title: 'Analyze Fineline investment', kind: 'edit', rawInput: args.manifest_artifact_id ?? args.manifest_path }), presentResult(_args, result) { return presentArtifactToolResult(result) } }))
  ctx.tools.register(definePaimindHarnessTool({ name: WHITE_SPACE_TOOL, description: 'Run the packaged Python 3.12 White-space CLI using either the exact current-Session synthetic manifest Artifact ID or an approved Workspace manifest path, then publish a SHA-256 data_result Artifact.', parameters: { ...analysisParameters, output_path: { type: 'string', required: true, description: 'Workspace-relative path ending in .white-space.data-result.json, for example deliverables/retail.white-space.data-result.json.' } }, output: commonOutput('Generated White-space data_result'), async execute(args, exec) { return await ctx.paimindArtifactGenerators.execute(WHITE_SPACE_PROVIDER_ID, resolveDemoManifest(ctx, exec, args), exec) }, presentCall: args => ({ card: 'generic', title: 'Analyze White space', kind: 'edit', rawInput: args.manifest_artifact_id ?? args.manifest_path }), presentResult(_args, result) { return presentArtifactToolResult(result) } }))
  ctx.tools.register(definePaimindHarnessTool({ name: WALMART_OUTLINE_TOOL, description: 'Build a validated focused 18-30 slide paimind.presentation-outline/v1 from exactly one current-Session Fineline and one White-space data_result Artifact ID.', parameters: { fineline_artifact_id: { type: 'string', required: true }, white_space_artifact_id: { type: 'string', required: true }, output_path: { type: 'string', required: true }, title: { type: 'string', description: 'Optional user-facing presentation title. Source-proven demo labels are always retained.' } }, output: commonOutput('Generated Walmart proposal outline'), async execute(args, exec) { const finelineId = text(args.fineline_artifact_id, 'fineline_artifact_id'); const whiteSpaceId = text(args.white_space_artifact_id, 'white_space_artifact_id'); const fineline = resolveAnalysisArtifact(ctx, exec, finelineId, FINELINE_PROVIDER_ID); const whiteSpace = resolveAnalysisArtifact(ctx, exec, whiteSpaceId, WHITE_SPACE_PROVIDER_ID); return await ctx.paimindArtifactGenerators.execute(WALMART_OUTLINE_PROVIDER_ID, { ...args, __fineline_path: fineline.path, __white_space_path: whiteSpace.path }, exec) }, presentCall: args => ({ card: 'generic', title: 'Build Walmart buyer proposal outline', kind: 'edit', rawInput: args.output_path }), presentResult(_args, result) { return presentArtifactToolResult(result) } }))
}
