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

export const name = 'paimind-fact-layer'
export const inject = ['paimindArtifactGenerators', 'tools', 'systemPrompt', 'sessionProjections']
export const FACT_LAYER_PROVIDER_ID = 'paimind.fact-layer'
export const BUILD_FACT_SET_TOOL = 'build_presentation_fact_set'
type JsonRecord = Record<string, unknown>

function runtimeDir(): string {
  try { return fileURLToPath(new URL('../runtime', import.meta.url)) }
  catch { return resolve(process.cwd(), 'packages/fact-layer/runtime') }
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}
function outputPath(value: unknown): string {
  const path = text(value, 'output_path')
  if (path.startsWith('/') || path.startsWith('\\') || path.split(/[\\/]+/).includes('..') || !path.toLowerCase().endsWith('.fact-set.json')) throw new Error('output_path must be a Workspace-relative .fact-set.json path')
  return path
}
function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array`)
  const rows = value.map((entry, index) => text(entry, `${label}[${index}]`))
  if (new Set(rows).size !== rows.length) throw new Error(`${label} contains duplicates`)
  return rows
}
function shellQuote(value: string): string { return `'${value.replaceAll("'", `'\\''`)}'` }

interface FactLayerArgs { readonly outputPath: string; readonly artifactIds: readonly string[]; readonly paths: readonly string[] }
function args(input: Readonly<JsonRecord>): FactLayerArgs {
  return { outputPath: outputPath(input.output_path), artifactIds: stringArray(input.analysis_artifact_ids, 'analysis_artifact_ids'), paths: stringArray(input.__analysis_paths, 'resolved analysis Artifact paths') }
}

export const factLayerProvider: PaimindGeneratorProvider = {
  id: FACT_LAYER_PROVIDER_ID, kind: 'json', previewKind: 'data-document',
  describe(input) { const value = args(input); return { path: value.outputPath, title: 'Proposal Fact Layer' } },
  async generate(input, context) {
    const value = args(input)
    const command = [process.execPath, `${runtimeDir()}/runner.mjs`, 'build', '--artifact-ids', JSON.stringify(value.artifactIds), '--paths', JSON.stringify(value.paths), '--output', value.outputPath].map(shellQuote).join(' ')
    await context.runWorkspaceCommand({ command, description: 'Build immutable presentation Fact Set', timeoutMs: 60_000 })
    return { path: value.outputPath, title: 'Proposal Fact Layer' }
  },
}

export interface FactLayerHostContext {
  readonly paimindArtifactGenerators: PaimindArtifactGeneratorService
  readonly tools: PaimindHostToolRegistry
  readonly systemPrompt: PaimindHostSystemPrompt
  readonly sessionProjections: PaimindHostSessionProjectionRegistry
  effect(install: () => void | (() => void), label?: string): void
}
function artifactFromValue(value: JsonRecord): Readonly<ArtifactProducedEnvelopeV1> { return defineArtifactProducedEnvelope(value.artifact as ArtifactProducedEnvelopeV1) }
const ARTIFACT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  schema: { type: 'string', required: true }, artifactId: { type: 'string', required: true }, sessionId: { type: 'string', required: true }, workspaceId: { type: 'string', required: true }, path: { type: 'string', required: true }, title: { type: 'string', required: true }, kind: { type: 'string', required: true }, previewKind: { type: 'string', required: true }, revision: { type: 'number', required: true }, producerId: { type: 'string', required: true }, taskId: { type: 'string', required: true }, state: { type: 'string', required: true }, producedAt: { type: 'number', required: true }, error: { type: 'object', additionalProperties: false, properties: { code: { type: 'string', required: true }, message: { type: 'string', required: true } } },
} } as const
const TOOL_OUTPUT = { type: 'object', additionalProperties: false, properties: { artifact: { ...ARTIFACT_SCHEMA, required: true } } } as const
function resolveInputs(ctx: FactLayerHostContext, exec: PaimindToolRunContext, ids: readonly string[]): readonly string[] {
  if (exec.agent === undefined) throw new Error('Fact Layer requires a live Harness Agent')
  const projection = ctx.sessionProjections.snapshot(exec.agent.session).values['paimind.artifacts']
  return ids.map(id => {
    const artifact = requireCurrentSessionArtifact(projection, exec, id, {
      description: 'an available current-Session analysis data_result', kind: 'json', excludedProducerIds: [FACT_LAYER_PROVIDER_ID],
    })
    return artifactWorkspaceRelativePath(artifact.path, exec, { label: `resolved analysis Artifact ${id}` })
  })
}

export function apply(ctx: FactLayerHostContext): void {
  ctx.effect(() => ctx.paimindArtifactGenerators.register(factLayerProvider), 'paimind-fact-layer: provider')
  ctx.systemPrompt.section({ name: 'tool:fact-layer', order: 116, text: 'After all required analysis Tools return available data_result Artifacts, call build_presentation_fact_set with their exact current-Session Artifact IDs. The Fact Set is the immutable truth boundary for downstream decks. Never hand-copy, recompute or rewrite verified values in model prose.' })
  ctx.tools.register(definePaimindHarnessTool({
    name: BUILD_FACT_SET_TOOL,
    description: 'Validate and merge current-Session paimind.data-result/v2 Artifacts into one immutable paimind.fact-set/v1 Artifact.',
    parameters: { analysis_artifact_ids: { type: 'array', required: true, items: { type: 'string' } }, output_path: { type: 'string', required: true } },
    output: { schema: TOOL_OUTPUT, render(_args: JsonRecord, value: JsonRecord) { const artifact = artifactFromValue(value); return [{ type: 'text', text: artifact.state === 'available' ? `<artifact path="${artifact.path}" id="${artifact.artifactId}" revision="${artifact.revision}">Generated immutable Fact Set</artifact>` : `<artifact-error code="${artifact.error?.code ?? 'fact_layer_failed'}">${artifact.error?.message ?? 'Fact Layer failed'}</artifact-error>` }] }, presentationMeta(_args: JsonRecord, value: JsonRecord) { return artifactToolMeta(artifactFromValue(value)) } },
    async execute(toolArgs, exec) { const ids = stringArray(toolArgs.analysis_artifact_ids, 'analysis_artifact_ids'); return await ctx.paimindArtifactGenerators.execute(FACT_LAYER_PROVIDER_ID, { ...toolArgs, __analysis_paths: resolveInputs(ctx, exec, ids) }, exec) },
    presentCall: args => ({ card: 'generic', title: 'Build presentation Fact Set', kind: 'edit', rawInput: args.output_path }),
    presentResult(_args, result) { return presentArtifactToolResult(result) },
  }))
}
