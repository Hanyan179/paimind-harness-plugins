import {
  artifactToolMeta,
  presentArtifactToolResult,
  type PaimindArtifactGeneratorService,
  type PaimindGeneratorProvider,
} from '@hansen/artifact-runtime'
import { defineArtifactProducedEnvelope, type ArtifactProducedEnvelopeV1 } from '@hansen/contracts'
import {
  definePaimindHarnessTool,
  type PaimindHostSystemPrompt,
  type PaimindHostToolRegistry,
} from '@hansen/harness-compat/host'

export const name = 'paimind-generator-web'
export const inject = ['paimindArtifactGenerators', 'tools', 'systemPrompt']
export const HTML_GENERATOR_PROVIDER_ID = 'paimind.generator.html-document'
export const HTML_GENERATOR_TOOL = 'generate_html_artifact'

interface HtmlGeneratorArgs extends Record<string, unknown> {
  readonly file_path: string
  readonly title: string
  readonly html: string
}

export interface GeneratorWebHostContext {
  readonly paimindArtifactGenerators: PaimindArtifactGeneratorService
  readonly tools: PaimindHostToolRegistry
  readonly systemPrompt: PaimindHostSystemPrompt
  effect(install: () => void | (() => void), label?: string): void
}

function htmlArgs(input: Readonly<Record<string, unknown>>): HtmlGeneratorArgs {
  const filePath = input.file_path
  const title = input.title
  const html = input.html
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new Error('file_path must be a non-empty string')
  if (typeof title !== 'string' || title.trim() === '') throw new Error('title must be a non-empty string')
  if (typeof html !== 'string' || html.trim() === '') throw new Error('html must be a non-empty string')
  return { file_path: filePath, title, html }
}

/** Explicit semantics: this provider can produce only a normal HTML document. */
export const htmlDocumentProvider: PaimindGeneratorProvider = {
  id: HTML_GENERATOR_PROVIDER_ID,
  kind: 'html',
  previewKind: 'html-document',
  describe(input) {
    const args = htmlArgs(input)
    return { path: args.file_path, title: args.title }
  },
  async generate(input, context) {
    const args = htmlArgs(input)
    if (context.signal.aborted) throw new Error('HTML generation cancelled')
    await context.writeText(args.file_path, args.html)
    return { path: args.file_path, title: args.title }
  },
}

function artifactFromValue(value: Record<string, unknown>): Readonly<ArtifactProducedEnvelopeV1> {
  return defineArtifactProducedEnvelope(value.artifact as ArtifactProducedEnvelopeV1)
}

const ARTIFACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schema: { type: 'string', required: true },
    artifactId: { type: 'string', required: true },
    sessionId: { type: 'string', required: true },
    workspaceId: { type: 'string', required: true },
    path: { type: 'string', required: true },
    title: { type: 'string', required: true },
    kind: { type: 'string', required: true },
    previewKind: { type: 'string', required: true },
    revision: { type: 'number', required: true },
    producerId: { type: 'string', required: true },
    taskId: { type: 'string', required: true },
    traceId: { type: 'string' },
    state: { type: 'string', required: true },
    producedAt: { type: 'number', required: true },
    error: {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: { type: 'string', required: true },
        message: { type: 'string', required: true },
      },
    },
  },
} as const

export function apply(ctx: GeneratorWebHostContext): void {
  ctx.effect(
    () => ctx.paimindArtifactGenerators.register(htmlDocumentProvider),
    'paimind-generator-web: html provider',
  )
  ctx.systemPrompt.section({
    name: 'tool:generate-html-artifact',
    order: 112,
    text: 'Use generate_html_artifact when the user asks for a standalone HTML page. Supply the complete HTML, a Workspace-relative file_path ending in .html, and a human title. The HTML must include UTF-8 and viewport metadata, use a responsive layout, wrap long unbroken content, and avoid fixed viewport-wide dimensions or horizontal overflow at 420 CSS px. The tool owns the Native Job, file publication and Artifact event; do not claim success before its structured result returns.',
  })
  ctx.tools.register(definePaimindHarnessTool({
    name: HTML_GENERATOR_TOOL,
    description: 'Generate and publish one standalone HTML document as a PAIMind artifact.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Workspace-relative .html output path.' },
      title: { type: 'string', required: true, description: 'Human-readable artifact title.' },
      html: { type: 'string', required: true, description: 'Complete standalone responsive HTML document including UTF-8 and viewport metadata.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { artifact: { ...ARTIFACT_SCHEMA, required: true } },
      },
      render(_args, value) {
        const artifact = artifactFromValue(value)
        return [{
          type: 'text',
          text: artifact.state === 'available'
            ? `<artifact path="${artifact.path}" id="${artifact.artifactId}" revision="${artifact.revision}">Generated HTML artifact</artifact>`
            : `<artifact-error code="${artifact.error?.code ?? 'generation_failed'}">${artifact.error?.message ?? 'Generation failed'}</artifact-error>`,
        }]
      },
      presentationMeta(_args, value) {
        return artifactToolMeta(artifactFromValue(value))
      },
    },
    async execute(args, exec) {
      return await ctx.paimindArtifactGenerators.execute(HTML_GENERATOR_PROVIDER_ID, args, exec)
    },
    presentCall(args) {
      const path = typeof args.file_path === 'string' ? args.file_path : undefined
      return {
        card: 'generic',
        title: typeof args.title === 'string' ? args.title : 'Generate HTML artifact',
        kind: 'edit',
        rawInput: path,
        ...(path === undefined ? {} : { locations: [{ path }] }),
      }
    },
    presentResult(_args, result) {
      return presentArtifactToolResult(result)
    },
  }))
}
