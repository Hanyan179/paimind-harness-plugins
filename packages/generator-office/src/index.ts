import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  artifactToolMeta,
  presentArtifactToolResult,
  type PaimindArtifactGeneratorService,
  type PaimindGeneratorProvider,
} from '@paimind/artifact-runtime'
import {
  defineArtifactProducedEnvelope,
  defineArtifactTraceEnvelope,
  type ArtifactProducedEnvelopeV1,
  type ArtifactTraceEnvelopeV1,
  type PaimindArtifactEventKind,
  type PaimindArtifactPreviewChannel,
} from '@paimind/contracts'
import {
  definePaimindHarnessTool,
  type PaimindHostSystemPrompt,
  type PaimindHostToolRegistry,
} from '@paimind/harness-compat/host'

export const name = 'paimind-generator-office'
export const inject = ['paimindArtifactGenerators', 'tools', 'systemPrompt']

export const PPTX_GENERATOR_PROVIDER_ID = 'paimind.generator.presentation'
export const PDF_GENERATOR_PROVIDER_ID = 'paimind.generator.pdf'
export const XLSX_GENERATOR_PROVIDER_ID = 'paimind.generator.spreadsheet'
export const PPTX_GENERATOR_TOOL = 'generate_presentation_artifact'
export const PDF_GENERATOR_TOOL = 'generate_pdf_artifact'
export const XLSX_GENERATOR_TOOL = 'generate_spreadsheet_artifact'

type JsonRecord = Record<string, unknown>

export interface GeneratorOfficeHostContext {
  readonly paimindArtifactGenerators: PaimindArtifactGeneratorService
  readonly tools: PaimindHostToolRegistry
  readonly systemPrompt: PaimindHostSystemPrompt
  effect(install: () => void | (() => void), label?: string): void
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as JsonRecord
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function officePath(value: unknown, extension: string): string {
  const path = text(value, 'file_path')
  if (path.startsWith('/') || path.startsWith('\\') || path.split(/[\\/]+/).includes('..') || !path.toLowerCase().endsWith(extension)) {
    throw new Error(`file_path must be a Workspace-relative ${extension} path`)
  }
  return path
}

function array(value: unknown, label: string, minimum = 1): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum) throw new Error(`${label} must contain at least ${minimum} item(s)`)
  return value
}

function pptxArgs(input: Readonly<JsonRecord>): JsonRecord {
  const slides = array(input.slides, 'slides').map((value, index) => {
    const slide = record(value, `slides[${index}]`)
    const bullets = array(slide.bullets ?? [], `slides[${index}].bullets`, 0)
    for (const [bulletIndex, bullet] of bullets.entries()) text(bullet, `slides[${index}].bullets[${bulletIndex}]`)
    return { title: text(slide.title, `slides[${index}].title`), bullets }
  })
  return { kind: 'pptx', file_path: officePath(input.file_path, '.pptx'), title: text(input.title, 'title'), slides }
}

function pdfArgs(input: Readonly<JsonRecord>): JsonRecord {
  const sections = array(input.sections, 'sections').map((value, index) => {
    const section = record(value, `sections[${index}]`)
    return { heading: text(section.heading, `sections[${index}].heading`), body: text(section.body, `sections[${index}].body`) }
  })
  return { kind: 'pdf', file_path: officePath(input.file_path, '.pdf'), title: text(input.title, 'title'), sections }
}

function xlsxArgs(input: Readonly<JsonRecord>): JsonRecord {
  const columns = array(input.columns, 'columns').map((value, index) => text(value, `columns[${index}]`))
  const rows = array(input.rows, 'rows')
  for (const [rowIndex, row] of rows.entries()) {
    if (!Array.isArray(row) || row.length !== columns.length) throw new Error(`rows[${rowIndex}] must contain ${columns.length} cells`)
  }
  const formulas = array(input.formulas, 'formulas')
  for (const [index, formula] of formulas.entries()) {
    const entry = record(formula, `formulas[${index}]`)
    if (!Number.isSafeInteger(entry.row) || !Number.isSafeInteger(entry.column)) throw new Error(`formulas[${index}] row and column must be integers`)
    text(entry.formula, `formulas[${index}].formula`)
  }
  return {
    kind: 'xlsx', file_path: officePath(input.file_path, '.xlsx'), title: text(input.title, 'title'),
    sheet_name: text(input.sheet_name ?? 'Report', 'sheet_name'), columns, rows, formulas,
  }
}

const MODULE_URL = new URL(import.meta.url)
const CLI_PATH = MODULE_URL.protocol === 'file:' ? fileURLToPath(new URL('./cli.js', MODULE_URL)) : 'cli.js'

function shellQuote(input: string): string { return `'${input.replaceAll("'", `'\"'\"'`)}'` }

function presentationTraceDocument(args: JsonRecord): unknown {
  const slides = args.slides as readonly { readonly title: string; readonly bullets: readonly string[] }[]
  return {
    schemaVersion: 'paimind.presentation-trace/v2',
    reviewStatus: 'generated',
    sources: [{
      id: 'agent-presentation-spec',
      name: 'generate_presentation_artifact input',
      format: 'Harness Tool JSON',
      role: 'Structured slide specification supplied by the active Harness Agent',
    }],
    slides: slides.map((slide, index) => ({
      slideId: `slide-${index + 1}`,
      explanation: slide.bullets.join(' · ') || slide.title,
      businessBlocks: [{
        blockId: 'slide-content',
        label: 'Slide content',
        description: 'Validated title and bullet content bound to the generated slide.',
      }],
      metrics: [{
        metricId: `slide-${index + 1}-content`,
        label: slide.title,
        businessBlockId: 'slide-content',
        facts: [{
          factId: `slide-${index + 1}-spec`,
          displayValue: slide.title,
          dimensions: [],
          business: {
            explanation: slide.bullets.join(' · ') || slide.title,
            scope: { period: 'generation-time', filters: ['provider = paimind.generator.presentation'] },
          },
          sourceIds: ['agent-presentation-spec'],
          factValuesChanged: false,
          technical: {
            definition: 'Structured presentation Tool input',
            calculation: 'Validated slide title and bullets are mapped directly to editable PPTX objects.',
            aggregation: 'One input slide to one PPTX slide',
            sourceFields: ['slides[].title', 'slides[].bullets'],
            lineage: [
              { stepId: `validate-${index + 1}`, label: 'Validate structured input', operation: 'Apply the presentation Tool schema and Workspace path constraints.' },
              { stepId: `render-${index + 1}`, label: 'Render editable slide', operation: 'Map the validated title and bullets to native PPTX text objects.' },
              { stepId: `publish-${index + 1}`, label: 'Publish atomically', operation: 'Write the binary through the Harness sandboxed generator command and atomically replace the target.' },
            ],
            codeFile: 'packages/generator-office/src/cli.ts',
          },
        }],
      }],
      visualBindings: [],
    })),
  }
}

function provider(
  id: string,
  kind: PaimindArtifactEventKind,
  previewKind: PaimindArtifactPreviewChannel,
  normalize: (input: Readonly<JsonRecord>) => JsonRecord,
  description: string,
  makeTrace?: (input: JsonRecord) => unknown,
): PaimindGeneratorProvider {
  return {
    id, kind, previewKind,
    describe(input) {
      const args = normalize(input)
      return { path: args.file_path as string, title: args.title as string }
    },
    async generate(input, context) {
      const args = normalize(input)
      const specPath = `.paimind-generation/${randomUUID()}.json`
      await context.writeText(specPath, `${JSON.stringify(args)}\n`)
      const command = [
        'set -euo pipefail',
        `trap ${shellQuote(`rm -f -- ${shellQuote(specPath)}`)} EXIT`,
        `${shellQuote(process.execPath)} ${shellQuote(CLI_PATH)} ${shellQuote(specPath)}`,
      ].join('; ')
      await context.runWorkspaceCommand({ command, description, timeoutMs: 120_000 })
      return {
        path: args.file_path as string,
        title: args.title as string,
        ...(makeTrace === undefined ? {} : { traceDocument: makeTrace(args) }),
      }
    },
  }
}

export const presentationProvider = provider(PPTX_GENERATOR_PROVIDER_ID, 'pptx', 'presentation', pptxArgs, 'Generate presentation artifact', presentationTraceDocument)
export const pdfProvider = provider(PDF_GENERATOR_PROVIDER_ID, 'pdf', 'pdf', pdfArgs, 'Generate PDF artifact')
export const spreadsheetProvider = provider(XLSX_GENERATOR_PROVIDER_ID, 'xlsx', 'spreadsheet', xlsxArgs, 'Generate spreadsheet artifact')

function artifactFromValue(value: JsonRecord): Readonly<ArtifactProducedEnvelopeV1> {
  return defineArtifactProducedEnvelope(value.artifact as ArtifactProducedEnvelopeV1)
}

function traceFromValue(value: JsonRecord): Readonly<ArtifactTraceEnvelopeV1> | undefined {
  return value.trace === undefined ? undefined : defineArtifactTraceEnvelope(value.trace as ArtifactTraceEnvelopeV1)
}

const ARTIFACT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    schema: { type: 'string', required: true }, artifactId: { type: 'string', required: true },
    sessionId: { type: 'string', required: true }, workspaceId: { type: 'string', required: true },
    path: { type: 'string', required: true }, title: { type: 'string', required: true },
    kind: { type: 'string', required: true }, previewKind: { type: 'string', required: true },
    revision: { type: 'number', required: true }, producerId: { type: 'string', required: true },
    taskId: { type: 'string', required: true }, traceId: { type: 'string' },
    state: { type: 'string', required: true }, producedAt: { type: 'number', required: true },
    error: { type: 'object', additionalProperties: false, properties: { code: { type: 'string', required: true }, message: { type: 'string', required: true } } },
  },
} as const
const TRACE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    schema: { type: 'string', required: true }, traceId: { type: 'string', required: true },
    artifactId: { type: 'string', required: true }, sessionId: { type: 'string', required: true },
    workspaceId: { type: 'string', required: true }, producerId: { type: 'string', required: true },
    taskId: { type: 'string', required: true }, artifactRevision: { type: 'number', required: true },
    producedAt: { type: 'number', required: true }, document: { type: 'object', required: true, additionalProperties: true },
  },
} as const

interface ToolSpec {
  readonly name: string
  readonly providerId: string
  readonly description: string
  readonly prompt: string
  readonly parameters: Readonly<JsonRecord>
  readonly fallbackTitle: string
  readonly noun: string
}

function registerTool(ctx: GeneratorOfficeHostContext, spec: ToolSpec): () => void {
  ctx.systemPrompt.section({ name: `tool:${spec.name}`, order: 113, text: spec.prompt })
  return ctx.tools.register(definePaimindHarnessTool({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { artifact: { ...ARTIFACT_SCHEMA, required: true }, trace: TRACE_SCHEMA } },
      render(_args, value) {
        const artifact = artifactFromValue(value)
        return [{ type: 'text', text: artifact.state === 'available'
          ? `<artifact path="${artifact.path}" id="${artifact.artifactId}" revision="${artifact.revision}">Generated ${spec.noun} artifact</artifact>`
          : `<artifact-error code="${artifact.error?.code ?? 'generation_failed'}">${artifact.error?.message ?? 'Generation failed'}</artifact-error>` }]
      },
      presentationMeta(_args, value) { return artifactToolMeta(artifactFromValue(value), traceFromValue(value)) },
    },
    async execute(args, exec) {
      return await ctx.paimindArtifactGenerators.execute(spec.providerId, args, exec)
    },
    presentCall(args) {
      const path = typeof args.file_path === 'string' ? args.file_path : undefined
      return { card: 'generic', title: typeof args.title === 'string' ? args.title : spec.fallbackTitle, kind: 'edit', rawInput: path, ...(path === undefined ? {} : { locations: [{ path }] }) }
    },
    presentResult(_args, result) { return presentArtifactToolResult(result) },
  }))
}

const SLIDES_SCHEMA = {
  type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
    title: { type: 'string', required: true }, bullets: { type: 'array', required: true, items: { type: 'string' } },
  } },
} as const
const SECTIONS_SCHEMA = {
  type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
    heading: { type: 'string', required: true }, body: { type: 'string', required: true },
  } },
} as const

export function apply(ctx: GeneratorOfficeHostContext): void {
  ctx.effect(() => ctx.paimindArtifactGenerators.register(presentationProvider), 'paimind-generator-office: presentation provider')
  ctx.effect(() => ctx.paimindArtifactGenerators.register(pdfProvider), 'paimind-generator-office: PDF provider')
  ctx.effect(() => ctx.paimindArtifactGenerators.register(spreadsheetProvider), 'paimind-generator-office: spreadsheet provider')
  ctx.effect(() => registerTool(ctx, {
    name: PPTX_GENERATOR_TOOL, providerId: PPTX_GENERATOR_PROVIDER_ID, noun: 'PPTX', fallbackTitle: 'Generate presentation',
    description: 'Generate and publish one editable PPTX presentation as a PAIMind artifact.',
    prompt: 'Use generate_presentation_artifact for an editable PPTX. Supply a Workspace-relative .pptx path, title and complete ordered slides. The tool owns the native Job, sandboxed binary publication and Artifact result; do not use bash or write the file yourself.',
    parameters: { file_path: { type: 'string', required: true }, title: { type: 'string', required: true }, slides: SLIDES_SCHEMA },
  }), 'paimind-generator-office: presentation tool')
  ctx.effect(() => registerTool(ctx, {
    name: PDF_GENERATOR_TOOL, providerId: PDF_GENERATOR_PROVIDER_ID, noun: 'PDF', fallbackTitle: 'Generate PDF',
    description: 'Generate and publish one paginated PDF report as a PAIMind artifact.',
    prompt: 'Use generate_pdf_artifact for a PDF report. Supply a Workspace-relative .pdf path, title and complete ordered sections. The tool owns the native Job, sandboxed binary publication and Artifact result; do not use bash or write the file yourself.',
    parameters: { file_path: { type: 'string', required: true }, title: { type: 'string', required: true }, sections: SECTIONS_SCHEMA },
  }), 'paimind-generator-office: PDF tool')
  ctx.effect(() => registerTool(ctx, {
    name: XLSX_GENERATOR_TOOL, providerId: XLSX_GENERATOR_PROVIDER_ID, noun: 'XLSX', fallbackTitle: 'Generate spreadsheet',
    description: 'Generate and publish one formula-bearing XLSX workbook as a PAIMind artifact.',
    prompt: 'Use generate_spreadsheet_artifact for an XLSX. Supply a Workspace-relative .xlsx path, title, sheet_name, columns, scalar rows and at least one explicit formula cell using 1-based row and column numbers. The provider writes real Excel formulas; do not encode formulas as static values.',
    parameters: {
      file_path: { type: 'string', required: true }, title: { type: 'string', required: true }, sheet_name: { type: 'string', required: true },
      columns: { type: 'array', required: true, items: { type: 'string' } },
      rows: { type: 'array', required: true, items: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] } } },
      formulas: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        row: { type: 'integer', required: true }, column: { type: 'integer', required: true }, formula: { type: 'string', required: true },
      } } },
    },
  }), 'paimind-generator-office: spreadsheet tool')
}
