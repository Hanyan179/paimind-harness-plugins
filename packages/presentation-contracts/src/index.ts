export const ANALYSIS_SOURCE_MANIFEST_SCHEMA = 'paimind.analysis-source-manifest/v1' as const
export const PRESENTATION_OUTLINE_SCHEMA = 'paimind.presentation-outline/v1' as const
export const PRESENTATION_TRACE_SCHEMA = 'paimind.presentation-trace/v3' as const
export const PRESENTATION_VALIDATION_SCHEMA = 'paimind.presentation-validation/v1' as const
export const PRESENTATION_DESIGN_SCHEMA = 'paimind.presentation-design/v1' as const
export const MAX_PRESENTATION_SLIDES = 80

export const PRESENTATION_LAYOUTS = [
  'cover', 'section', 'kpi', 'comparison', 'insight', 'recommendation', 'table',
  'horizontal-bar', 'lollipop', 'dot-plot', 'bullet', 'slope', 'line',
] as const
export type PresentationLayout = typeof PRESENTATION_LAYOUTS[number]

export const PRESENTATION_TEMPLATE_IDS = ['generic-dark', 'wmt-kids-mod'] as const
export type PresentationTemplateId = typeof PRESENTATION_TEMPLATE_IDS[number]
export const PRESENTATION_STYLE_PRESETS = [
  'startup-pitch', 'data-intelligence', 'storytelling-with-data',
  'warm-editorial', 'financial-elite', 'wmt-retail',
] as const
export type PresentationStylePreset = typeof PRESENTATION_STYLE_PRESETS[number]
export const PRESENTATION_DENSITIES = ['airy', 'balanced', 'dense'] as const
export type PresentationDensity = typeof PRESENTATION_DENSITIES[number]

export interface PresentationDesignV1 {
  readonly schema: typeof PRESENTATION_DESIGN_SCHEMA
  readonly templateId: PresentationTemplateId
  readonly stylePreset: PresentationStylePreset
  readonly aspectRatio: '16:9'
  readonly canvas: { readonly width: 1280; readonly height: 720 }
  readonly density: PresentationDensity
}

export const DEFAULT_PRESENTATION_DESIGN: Readonly<PresentationDesignV1> = Object.freeze({
  schema: PRESENTATION_DESIGN_SCHEMA,
  templateId: 'generic-dark',
  stylePreset: 'startup-pitch',
  aspectRatio: '16:9',
  canvas: Object.freeze({ width: 1280, height: 720 }),
  density: 'balanced',
})

const STABLE_ID_TOOL_FIELD = { type: 'string', description: 'Stable ID: letters, numbers, dot, underscore, colon, or hyphen.' } as const
const REQUIRED_STABLE_ID_TOOL_FIELD = { ...STABLE_ID_TOOL_FIELD, required: true } as const
const REQUIRED_STRING_TOOL_FIELD = { type: 'string', required: true } as const
const REQUIRED_STRING_ARRAY_TOOL_FIELD = { type: 'array', required: true, items: { type: 'string' } } as const
const SELECTOR_TOOL_SCHEMA = {
  oneOf: [
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'object', required: true } } },
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'chart-point', required: true }, seriesKey: REQUIRED_STABLE_ID_TOOL_FIELD, categoryKey: REQUIRED_STABLE_ID_TOOL_FIELD } },
    { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'table-cell', required: true }, rowKey: REQUIRED_STABLE_ID_TOOL_FIELD, columnKey: REQUIRED_STABLE_ID_TOOL_FIELD } },
  ],
} as const
const BINDING_TOOL_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    factId: REQUIRED_STABLE_ID_TOOL_FIELD,
    selector: { ...SELECTOR_TOOL_SCHEMA, required: true },
  },
} as const
const CHART_POINT_TOOL_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    seriesKey: REQUIRED_STABLE_ID_TOOL_FIELD, categoryKey: REQUIRED_STABLE_ID_TOOL_FIELD,
    label: REQUIRED_STRING_TOOL_FIELD, value: { type: 'number', required: true },
    displayValue: REQUIRED_STRING_TOOL_FIELD, factId: REQUIRED_STABLE_ID_TOOL_FIELD,
  },
} as const
const CHART_TOOL_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    kind: { type: 'string', required: true, enum: ['horizontal-bar', 'lollipop', 'dot-plot', 'bullet', 'slope', 'line'] },
    points: { type: 'array', required: true, items: CHART_POINT_TOOL_SCHEMA },
  },
} as const
const TABLE_CELL_TOOL_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    rowKey: REQUIRED_STABLE_ID_TOOL_FIELD, columnKey: REQUIRED_STABLE_ID_TOOL_FIELD,
    displayValue: REQUIRED_STRING_TOOL_FIELD, factId: STABLE_ID_TOOL_FIELD,
  },
} as const
const TABLE_TOOL_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    columns: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { columnKey: REQUIRED_STABLE_ID_TOOL_FIELD, label: REQUIRED_STRING_TOOL_FIELD } } },
    rows: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { rowKey: REQUIRED_STABLE_ID_TOOL_FIELD, label: REQUIRED_STRING_TOOL_FIELD, cells: { type: 'array', required: true, items: TABLE_CELL_TOOL_SCHEMA } } } },
  },
} as const
const DIMENSION_TOOL_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    key: REQUIRED_STRING_TOOL_FIELD, label: REQUIRED_STRING_TOOL_FIELD, value: REQUIRED_STRING_TOOL_FIELD,
  },
} as const
const MEASURE_TOOL_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    key: REQUIRED_STRING_TOOL_FIELD, label: REQUIRED_STRING_TOOL_FIELD,
    value: { type: 'number', required: true }, displayValue: REQUIRED_STRING_TOOL_FIELD,
  },
} as const
const TECHNICAL_TOOL_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    definition: { type: 'string' }, calculation: { type: 'string' }, aggregation: { type: 'string' },
    sourceFields: { type: 'array', items: { type: 'string' } }, filters: { type: 'array', items: { type: 'string' } },
    joinKeys: { type: 'array', items: { type: 'string' } }, codeFile: { type: 'string' }, executionDurationMs: { type: 'number' },
    lineage: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      stepId: REQUIRED_STABLE_ID_TOOL_FIELD, label: REQUIRED_STRING_TOOL_FIELD, operation: REQUIRED_STRING_TOOL_FIELD,
    } } },
  },
} as const
const VISUALIZATION_TOOL_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    kind: { type: 'string', required: true, enum: ['scalar', 'cartesian', 'matrix', 'list'] },
    mark: { type: 'string', required: true, enum: ['number', 'bar', 'line', 'scatter', 'bubble', 'heatmap', 'table', 'text'] },
    encodings: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
      channel: { type: 'string', required: true, enum: ['x', 'y', 'series', 'color', 'size', 'row', 'column', 'label', 'value'] },
      source: { type: 'string', required: true, enum: ['dimension', 'measure', 'fact'] },
      fieldKey: REQUIRED_STRING_TOOL_FIELD, label: REQUIRED_STRING_TOOL_FIELD,
    } } },
  },
} as const
const SLIDE_TRACE_TOOL_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    businessBlocks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
      blockId: REQUIRED_STABLE_ID_TOOL_FIELD, label: REQUIRED_STRING_TOOL_FIELD, description: REQUIRED_STRING_TOOL_FIELD,
    } } },
    metrics: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
      metricId: REQUIRED_STABLE_ID_TOOL_FIELD, label: REQUIRED_STRING_TOOL_FIELD,
      businessBlockId: REQUIRED_STABLE_ID_TOOL_FIELD,
      factIds: { ...REQUIRED_STRING_ARRAY_TOOL_FIELD, description: 'Facts grouped into this multidimensional metric.' },
      visualization: VISUALIZATION_TOOL_SCHEMA,
    } } },
  },
} as const
const ELEMENT_TOOL_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    objectId: REQUIRED_STABLE_ID_TOOL_FIELD,
    type: { type: 'string', required: true, enum: ['title', 'text', 'kpi', 'chart', 'table', 'list', 'decoration'] },
    title: { type: 'string' }, text: { type: 'string' }, displayValue: { type: 'string' },
    factIds: { ...REQUIRED_STRING_ARRAY_TOOL_FIELD, description: 'All Facts represented by this object.' },
    bindings: { type: 'array', required: true, items: BINDING_TOOL_SCHEMA, description: 'Object, chart-point, or table-cell selectors bound to Facts.' },
    presentationOnly: { type: 'boolean', description: 'True only for decoration or unverified presentation copy.' },
    chart: CHART_TOOL_SCHEMA, table: TABLE_TOOL_SCHEMA,
  },
} as const

/**
 * Complete model-facing Tool schema for `paimind.presentation-outline/v1`.
 * Runtime validation remains authoritative; this projection prevents an Agent
 * from having to discover TypeScript implementation details before Tool use.
 */
export const PRESENTATION_OUTLINE_TOOL_SCHEMA = {
  type: 'object', required: true, additionalProperties: false,
  description: 'One complete paimind.presentation-outline/v1 object. Preserve verified facts and bind every data element to a source-backed Fact.',
  properties: {
    schema: { type: 'string', const: PRESENTATION_OUTLINE_SCHEMA, required: true },
    title: REQUIRED_STRING_TOOL_FIELD,
    subtitle: { type: 'string' },
    design: {
      type: 'object', required: true, additionalProperties: false,
      description: 'HTML presentation specification. The renderer owns all concrete CSS and HTML for the selected registered template and style preset.',
      properties: {
        schema: { type: 'string', const: PRESENTATION_DESIGN_SCHEMA, required: true },
        templateId: { type: 'string', required: true, enum: PRESENTATION_TEMPLATE_IDS },
        stylePreset: { type: 'string', required: true, enum: PRESENTATION_STYLE_PRESETS },
        aspectRatio: { type: 'string', const: '16:9', required: true },
        canvas: { type: 'object', required: true, additionalProperties: false, properties: {
          width: { type: 'number', const: 1280, required: true },
          height: { type: 'number', const: 720, required: true },
        } },
        density: { type: 'string', required: true, enum: PRESENTATION_DENSITIES },
      },
    },
    sources: {
      type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        sourceId: REQUIRED_STABLE_ID_TOOL_FIELD, name: REQUIRED_STRING_TOOL_FIELD,
        path: { ...REQUIRED_STRING_TOOL_FIELD, description: 'Workspace-relative source path.' },
        sha256: { ...REQUIRED_STRING_TOOL_FIELD, description: 'Exact lowercase 64-character source SHA-256.' },
        format: REQUIRED_STRING_TOOL_FIELD, role: REQUIRED_STRING_TOOL_FIELD,
        period: REQUIRED_STRING_TOOL_FIELD, summary: REQUIRED_STRING_TOOL_FIELD,
        redaction: { type: 'string' }, artifactId: STABLE_ID_TOOL_FIELD,
      } },
    },
    facts: {
      type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        factId: REQUIRED_STABLE_ID_TOOL_FIELD,
        sourceIds: { ...REQUIRED_STRING_ARRAY_TOOL_FIELD, description: 'Existing sourceId values.' },
        rawValue: { oneOf: [{ type: 'string' }, { type: 'number' }], required: true },
        displayValue: REQUIRED_STRING_TOOL_FIELD,
        valueType: { type: 'string', required: true, enum: ['source_value', 'derived_metric', 'narrative'] },
        fieldPath: REQUIRED_STRING_TOOL_FIELD, formula: { type: 'string' },
        method: REQUIRED_STRING_TOOL_FIELD, definition: REQUIRED_STRING_TOOL_FIELD,
        period: REQUIRED_STRING_TOOL_FIELD, filters: REQUIRED_STRING_ARRAY_TOOL_FIELD,
        businessExplanation: { type: 'string' },
        dimensions: { type: 'array', items: DIMENSION_TOOL_SCHEMA },
        measures: { type: 'array', items: MEASURE_TOOL_SCHEMA },
        technical: TECHNICAL_TOOL_SCHEMA,
        factValuesChanged: { type: 'boolean', const: false, required: true },
      } },
    },
    slides: {
      type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        slideId: REQUIRED_STABLE_ID_TOOL_FIELD,
        layout: { type: 'string', required: true, enum: PRESENTATION_LAYOUTS },
        eyebrow: { type: 'string' }, title: REQUIRED_STRING_TOOL_FIELD,
        narrative: REQUIRED_STRING_TOOL_FIELD,
        elements: { type: 'array', required: true, items: ELEMENT_TOOL_SCHEMA },
        trace: SLIDE_TRACE_TOOL_SCHEMA,
      } },
    },
  },
} as const

export interface AnalysisSourceManifestEntry {
  readonly sourceId: string
  readonly path: string
  readonly sha256: string
  readonly bytes?: number
  readonly period: string
  readonly format: string
  readonly purpose: string
  readonly redaction: string
}
export interface AnalysisSourceManifestV1 {
  readonly schema: typeof ANALYSIS_SOURCE_MANIFEST_SCHEMA
  readonly sources: readonly AnalysisSourceManifestEntry[]
}

export interface PresentationSource {
  readonly sourceId: string
  readonly name: string
  readonly path: string
  readonly sha256: string
  readonly format: string
  readonly role: string
  readonly period: string
  readonly summary: string
  readonly redaction?: string
  readonly artifactId?: string
}

export interface PresentationFact {
  readonly factId: string
  readonly sourceIds: readonly string[]
  readonly rawValue: string | number
  readonly displayValue: string
  readonly valueType: 'source_value' | 'derived_metric' | 'narrative'
  readonly fieldPath: string
  readonly formula?: string
  readonly method: string
  readonly definition: string
  readonly period: string
  readonly filters: readonly string[]
  readonly businessExplanation?: string
  readonly dimensions: readonly PresentationDimension[]
  readonly measures: readonly PresentationMeasure[]
  readonly technical?: PresentationTechnical
  readonly factValuesChanged: false
}

export interface PresentationDimension {
  readonly key: string
  readonly label: string
  readonly value: string
}
export interface PresentationMeasure {
  readonly key: string
  readonly label: string
  readonly value: number
  readonly displayValue: string
}
export interface PresentationLineageStep {
  readonly stepId: string
  readonly label: string
  readonly operation: string
}
export interface PresentationTechnical {
  readonly definition?: string
  readonly calculation?: string
  readonly aggregation?: string
  readonly sourceFields?: readonly string[]
  readonly filters?: readonly string[]
  readonly joinKeys?: readonly string[]
  readonly lineage?: readonly PresentationLineageStep[]
  readonly codeFile?: string
  readonly executionDurationMs?: number
}
export interface PresentationVisualization {
  readonly kind: 'scalar' | 'cartesian' | 'matrix' | 'list'
  readonly mark: 'number' | 'bar' | 'line' | 'scatter' | 'bubble' | 'heatmap' | 'table' | 'text'
  readonly encodings: readonly ({
    readonly channel: 'x' | 'y' | 'series' | 'color' | 'size' | 'row' | 'column' | 'label' | 'value'
    readonly source: 'dimension' | 'measure' | 'fact'
    readonly fieldKey: string
    readonly label: string
  })[]
}
export interface PresentationSlideTrace {
  readonly businessBlocks: readonly ({ readonly blockId: string; readonly label: string; readonly description: string })[]
  readonly metrics: readonly ({ readonly metricId: string; readonly label: string; readonly businessBlockId: string; readonly factIds: readonly string[]; readonly visualization?: PresentationVisualization })[]
}

export type PresentationSelector =
  | { readonly kind: 'object' }
  | { readonly kind: 'chart-point'; readonly seriesKey: string; readonly categoryKey: string }
  | { readonly kind: 'table-cell'; readonly rowKey: string; readonly columnKey: string }

export interface PresentationBinding {
  readonly factId: string
  readonly selector: PresentationSelector
}

export interface PresentationChartPoint {
  readonly seriesKey: string
  readonly categoryKey: string
  readonly label: string
  readonly value: number
  readonly displayValue: string
  readonly factId: string
}
export interface PresentationChartSpec {
  readonly kind: 'horizontal-bar' | 'lollipop' | 'dot-plot' | 'bullet' | 'slope' | 'line'
  readonly points: readonly PresentationChartPoint[]
}
export interface PresentationTableCell {
  readonly rowKey: string
  readonly columnKey: string
  readonly displayValue: string
  readonly factId?: string
}
export interface PresentationTableSpec {
  readonly columns: readonly { readonly columnKey: string; readonly label: string }[]
  readonly rows: readonly { readonly rowKey: string; readonly label: string; readonly cells: readonly PresentationTableCell[] }[]
}
export interface PresentationElement {
  readonly objectId: string
  readonly type: 'title' | 'text' | 'kpi' | 'chart' | 'table' | 'list' | 'decoration'
  readonly title?: string
  readonly text?: string
  readonly displayValue?: string
  readonly factIds: readonly string[]
  readonly bindings: readonly PresentationBinding[]
  readonly presentationOnly?: boolean
  readonly chart?: PresentationChartSpec
  readonly table?: PresentationTableSpec
}
export interface PresentationSlide {
  readonly slideId: string
  readonly layout: PresentationLayout
  readonly eyebrow?: string
  readonly title: string
  readonly narrative: string
  readonly elements: readonly PresentationElement[]
  readonly trace?: PresentationSlideTrace
}
export interface PresentationOutlineV1 {
  readonly schema: typeof PRESENTATION_OUTLINE_SCHEMA
  readonly title: string
  readonly subtitle?: string
  readonly design: PresentationDesignV1
  readonly sources: readonly PresentationSource[]
  readonly facts: readonly PresentationFact[]
  readonly slides: readonly PresentationSlide[]
}

export interface PresentationTraceV3 {
  readonly schemaVersion: typeof PRESENTATION_TRACE_SCHEMA
  readonly reviewStatus: 'generated' | 'reviewed' | 'verified'
  readonly sources: readonly ({
    readonly id: string
    readonly name: string
    readonly path: string
    readonly sha256: string
    readonly format: string
    readonly role: string
    readonly period: string
    readonly summary: string
    readonly artifactId?: string
  })[]
  readonly slides: readonly ({
    readonly slideId: string
    readonly explanation: string
    readonly businessBlocks: readonly ({ readonly blockId: string; readonly label: string; readonly description: string })[]
    readonly metrics: readonly ({
      readonly metricId: string
      readonly label: string
      readonly businessBlockId: string
      readonly facts: readonly ({
        readonly factId: string
        readonly displayValue: string
        readonly dimensions: readonly PresentationDimension[]
        readonly measures: readonly PresentationMeasure[]
        readonly business: { readonly definition: string; readonly explanation: string; readonly scope: { readonly period: string; readonly filters: readonly string[] } }
        readonly sourceIds: readonly string[]
        readonly factValuesChanged: false
        readonly valueType: PresentationFact['valueType']
        readonly technical: PresentationTechnical
      })[]
      readonly visualization?: PresentationVisualization
    })[]
    readonly visualBindings: readonly ({ readonly objectId: string; readonly factBindings: readonly PresentationBinding[] })[]
  })[]
}

export interface PresentationValidationV1 {
  readonly schema: typeof PRESENTATION_VALIDATION_SCHEMA
  readonly valid: boolean
  readonly requiredBindings: number
  readonly resolvedBindings: number
  readonly resolutionRate: number
  readonly factValuesChanged: false
  readonly sourceHashesVerified: boolean
  readonly checkedLayouts: readonly PresentationLayout[]
  readonly errors: readonly string[]
}

type JsonRecord = Record<string, unknown>
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/
const SHA256 = /^[a-f0-9]{64}$/
const LAYOUT_SET = new Set<string>(PRESENTATION_LAYOUTS)
const TEMPLATE_SET = new Set<string>(PRESENTATION_TEMPLATE_IDS)
const STYLE_PRESET_SET = new Set<string>(PRESENTATION_STYLE_PRESETS)
const DENSITY_SET = new Set<string>(PRESENTATION_DENSITIES)

const record = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as JsonRecord
}
const array = (value: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}
const text = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}
const id = (value: unknown, label: string): string => {
  const result = text(value, label)
  if (!ID.test(result)) throw new Error(`${label} must be a stable id`)
  return result
}
const stringList = (value: unknown, label: string): readonly string[] => Object.freeze(array(value, label).map((entry, index) => text(entry, `${label}[${index}]`)))
const unique = <T extends string>(values: readonly T[], label: string): void => {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate ids`)
}
const relativePath = (value: unknown, label: string): string => {
  const path = text(value, label)
  if (path.startsWith('/') || path.startsWith('\\') || path.split(/[\\/]+/).includes('..')) throw new Error(`${label} must be Workspace-relative`)
  return path
}
const hash = (value: unknown, label: string): string => {
  const result = text(value, label).toLowerCase()
  if (!SHA256.test(result)) throw new Error(`${label} must be a SHA-256 hex digest`)
  return result
}
const optionalStringList = (value: unknown, label: string): readonly string[] | undefined => value === undefined ? undefined : stringList(value, label)
const optionalText = (value: unknown, label: string): string | undefined => value === undefined ? undefined : text(value, label)

export function definePresentationDesign(value: unknown): Readonly<PresentationDesignV1> {
  if (value === undefined) return DEFAULT_PRESENTATION_DESIGN
  const input = record(value, 'outline.design')
  if (input.schema !== PRESENTATION_DESIGN_SCHEMA) throw new Error('outline.design.schema is unsupported')
  if (!TEMPLATE_SET.has(String(input.templateId))) throw new Error('outline.design.templateId is unsupported')
  if (!STYLE_PRESET_SET.has(String(input.stylePreset))) throw new Error('outline.design.stylePreset is unsupported')
  if (input.aspectRatio !== '16:9') throw new Error('outline.design.aspectRatio must be 16:9')
  const canvas = record(input.canvas, 'outline.design.canvas')
  if (canvas.width !== 1280 || canvas.height !== 720) throw new Error('outline.design.canvas must be 1280x720')
  if (!DENSITY_SET.has(String(input.density))) throw new Error('outline.design.density is unsupported')
  if (input.stylePreset === 'wmt-retail' && input.templateId !== 'wmt-kids-mod') throw new Error('outline.design wmt-retail requires templateId wmt-kids-mod')
  return Object.freeze({
    schema: PRESENTATION_DESIGN_SCHEMA,
    templateId: input.templateId as PresentationTemplateId,
    stylePreset: input.stylePreset as PresentationStylePreset,
    aspectRatio: '16:9',
    canvas: Object.freeze({ width: 1280, height: 720 }),
    density: input.density as PresentationDensity,
  })
}

function dimensions(value: unknown, label: string): readonly PresentationDimension[] {
  if (value === undefined) return Object.freeze([])
  const rows = array(value, label).map((entry, index) => {
    const row = record(entry, `${label}[${index}]`)
    return Object.freeze({ key: text(row.key, `${label}[${index}].key`), label: text(row.label, `${label}[${index}].label`), value: text(row.value, `${label}[${index}].value`) })
  })
  unique(rows.map(row => row.key), `${label} keys`)
  return Object.freeze(rows)
}

function measures(value: unknown, label: string): readonly PresentationMeasure[] {
  if (value === undefined) return Object.freeze([])
  const rows = array(value, label).map((entry, index) => {
    const row = record(entry, `${label}[${index}]`)
    if (typeof row.value !== 'number' || !Number.isFinite(row.value)) throw new Error(`${label}[${index}].value must be finite`)
    return Object.freeze({ key: text(row.key, `${label}[${index}].key`), label: text(row.label, `${label}[${index}].label`), value: row.value, displayValue: text(row.displayValue, `${label}[${index}].displayValue`) })
  })
  unique(rows.map(row => row.key), `${label} keys`)
  return Object.freeze(rows)
}

function technical(value: unknown, label: string): Readonly<PresentationTechnical> | undefined {
  if (value === undefined) return undefined
  const input = record(value, label)
  const lineage = input.lineage === undefined ? undefined : array(input.lineage, `${label}.lineage`).map((entry, index) => {
    const step = record(entry, `${label}.lineage[${index}]`)
    return Object.freeze({ stepId: id(step.stepId, `${label}.lineage[${index}].stepId`), label: text(step.label, `${label}.lineage[${index}].label`), operation: text(step.operation, `${label}.lineage[${index}].operation`) })
  })
  if (lineage !== undefined) unique(lineage.map(step => step.stepId), `${label}.lineage`)
  const executionDurationMs = input.executionDurationMs
  if (executionDurationMs !== undefined && (typeof executionDurationMs !== 'number' || !Number.isFinite(executionDurationMs) || executionDurationMs < 0)) throw new Error(`${label}.executionDurationMs must be non-negative and finite`)
  const definition = optionalText(input.definition, `${label}.definition`)
  const calculation = optionalText(input.calculation, `${label}.calculation`)
  const aggregation = optionalText(input.aggregation, `${label}.aggregation`)
  const sourceFields = optionalStringList(input.sourceFields, `${label}.sourceFields`)
  const filters = optionalStringList(input.filters, `${label}.filters`)
  const joinKeys = optionalStringList(input.joinKeys, `${label}.joinKeys`)
  const codeFile = optionalText(input.codeFile, `${label}.codeFile`)
  const result = {
    ...(definition === undefined ? {} : { definition }),
    ...(calculation === undefined ? {} : { calculation }),
    ...(aggregation === undefined ? {} : { aggregation }),
    ...(sourceFields === undefined ? {} : { sourceFields }),
    ...(filters === undefined ? {} : { filters }),
    ...(joinKeys === undefined ? {} : { joinKeys }),
    ...(lineage === undefined ? {} : { lineage: Object.freeze(lineage) }),
    ...(codeFile === undefined ? {} : { codeFile }),
    ...(executionDurationMs === undefined ? {} : { executionDurationMs: executionDurationMs as number }),
  }
  if (Object.keys(result).length === 0) throw new Error(`${label} must contain at least one registered field`)
  return Object.freeze(result)
}

function visualization(value: unknown, label: string, linkedFacts: readonly PresentationFact[]): Readonly<PresentationVisualization> | undefined {
  if (value === undefined) return undefined
  const input = record(value, label)
  if (!['scalar', 'cartesian', 'matrix', 'list'].includes(String(input.kind))) throw new Error(`${label}.kind is unsupported`)
  if (!['number', 'bar', 'line', 'scatter', 'bubble', 'heatmap', 'table', 'text'].includes(String(input.mark))) throw new Error(`${label}.mark is unsupported`)
  const encodings = array(input.encodings, `${label}.encodings`).map((entry, index) => {
    const encoding = record(entry, `${label}.encodings[${index}]`)
    if (!['x', 'y', 'series', 'color', 'size', 'row', 'column', 'label', 'value'].includes(String(encoding.channel))) throw new Error(`${label}.encodings[${index}].channel is unsupported`)
    if (!['dimension', 'measure', 'fact'].includes(String(encoding.source))) throw new Error(`${label}.encodings[${index}].source is unsupported`)
    const fieldKey = text(encoding.fieldKey, `${label}.encodings[${index}].fieldKey`)
    if (encoding.source === 'dimension' && linkedFacts.some(fact => !fact.dimensions.some(row => row.key === fieldKey))) throw new Error(`${label} references missing dimension ${fieldKey}`)
    if (encoding.source === 'measure' && linkedFacts.some(fact => !fact.measures.some(row => row.key === fieldKey))) throw new Error(`${label} references missing measure ${fieldKey}`)
    return Object.freeze({ channel: encoding.channel as PresentationVisualization['encodings'][number]['channel'], source: encoding.source as PresentationVisualization['encodings'][number]['source'], fieldKey, label: text(encoding.label, `${label}.encodings[${index}].label`) })
  })
  unique(encodings.map(encoding => encoding.channel), `${label}.encoding channels`)
  return Object.freeze({ kind: input.kind as PresentationVisualization['kind'], mark: input.mark as PresentationVisualization['mark'], encodings: Object.freeze(encodings) })
}

export function defineAnalysisSourceManifest(candidate: unknown): Readonly<AnalysisSourceManifestV1> {
  const root = record(candidate, 'manifest')
  if (root.schema !== ANALYSIS_SOURCE_MANIFEST_SCHEMA) throw new Error('unsupported analysis source manifest schema')
  const sources = array(root.sources, 'manifest.sources').map((value, index) => {
    const source = record(value, `manifest.sources[${index}]`)
    const bytes = source.bytes === undefined ? undefined : source.bytes
    if (bytes !== undefined && (!Number.isSafeInteger(bytes) || (bytes as number) < 0)) throw new Error(`manifest.sources[${index}].bytes must be non-negative`)
    return Object.freeze({
      sourceId: id(source.sourceId, `manifest.sources[${index}].sourceId`),
      path: relativePath(source.path, `manifest.sources[${index}].path`),
      sha256: hash(source.sha256, `manifest.sources[${index}].sha256`),
      ...(bytes === undefined ? {} : { bytes: bytes as number }),
      period: text(source.period, `manifest.sources[${index}].period`),
      format: text(source.format, `manifest.sources[${index}].format`),
      purpose: text(source.purpose, `manifest.sources[${index}].purpose`),
      redaction: text(source.redaction, `manifest.sources[${index}].redaction`),
    })
  })
  if (sources.length === 0) throw new Error('manifest.sources must not be empty')
  unique(sources.map(source => source.sourceId), 'manifest.sources')
  return Object.freeze({ schema: ANALYSIS_SOURCE_MANIFEST_SCHEMA, sources: Object.freeze(sources) })
}

function selector(value: unknown, label: string): PresentationSelector {
  const input = record(value, label)
  if (input.kind === 'object') return Object.freeze({ kind: 'object' })
  if (input.kind === 'chart-point') return Object.freeze({ kind: 'chart-point', seriesKey: id(input.seriesKey, `${label}.seriesKey`), categoryKey: id(input.categoryKey, `${label}.categoryKey`) })
  if (input.kind === 'table-cell') return Object.freeze({ kind: 'table-cell', rowKey: id(input.rowKey, `${label}.rowKey`), columnKey: id(input.columnKey, `${label}.columnKey`) })
  throw new Error(`${label}.kind is unsupported`)
}

export function definePresentationOutline(candidate: unknown): Readonly<PresentationOutlineV1> {
  const root = record(candidate, 'outline')
  if (root.schema !== PRESENTATION_OUTLINE_SCHEMA) throw new Error('unsupported presentation outline schema')
  const design = definePresentationDesign(root.design)
  const sources = array(root.sources, 'outline.sources').map((value, index) => {
    const source = record(value, `outline.sources[${index}]`)
    return Object.freeze({
      sourceId: id(source.sourceId, `outline.sources[${index}].sourceId`), name: text(source.name, `outline.sources[${index}].name`),
      path: relativePath(source.path, `outline.sources[${index}].path`), sha256: hash(source.sha256, `outline.sources[${index}].sha256`),
      format: text(source.format, `outline.sources[${index}].format`), role: text(source.role, `outline.sources[${index}].role`),
      period: text(source.period, `outline.sources[${index}].period`), summary: text(source.summary, `outline.sources[${index}].summary`),
      ...(source.redaction === undefined ? {} : { redaction: text(source.redaction, `outline.sources[${index}].redaction`) }),
      ...(source.artifactId === undefined ? {} : { artifactId: id(source.artifactId, `outline.sources[${index}].artifactId`) }),
    })
  })
  const sourceIds = sources.map(source => source.sourceId); unique(sourceIds, 'outline.sources')
  if (sources.length === 0) throw new Error('outline.sources must not be empty')
  const sourceSet = new Set(sourceIds)
  const facts = array(root.facts, 'outline.facts').map((value, index) => {
    const fact = record(value, `outline.facts[${index}]`)
    if (!['source_value', 'derived_metric', 'narrative'].includes(String(fact.valueType))) throw new Error(`outline.facts[${index}].valueType is unsupported`)
    if (fact.factValuesChanged !== false) throw new Error(`outline.facts[${index}].factValuesChanged must be false`)
    if (typeof fact.rawValue !== 'string' && typeof fact.rawValue !== 'number') throw new Error(`outline.facts[${index}].rawValue must be a string or number`)
    const linkedSources = stringList(fact.sourceIds, `outline.facts[${index}].sourceIds`)
    if (linkedSources.length === 0 || linkedSources.some(sourceId => !sourceSet.has(sourceId))) throw new Error(`outline.facts[${index}] references an unknown source`)
    const factDimensions = dimensions(fact.dimensions, `outline.facts[${index}].dimensions`)
    const factMeasures = measures(fact.measures, `outline.facts[${index}].measures`)
    const factTechnical = technical(fact.technical, `outline.facts[${index}].technical`)
    return Object.freeze({
      factId: id(fact.factId, `outline.facts[${index}].factId`), sourceIds: linkedSources,
      rawValue: fact.rawValue, displayValue: text(fact.displayValue, `outline.facts[${index}].displayValue`),
      valueType: fact.valueType as PresentationFact['valueType'], fieldPath: text(fact.fieldPath, `outline.facts[${index}].fieldPath`),
      ...(fact.formula === undefined ? {} : { formula: text(fact.formula, `outline.facts[${index}].formula`) }),
      method: text(fact.method, `outline.facts[${index}].method`), definition: text(fact.definition, `outline.facts[${index}].definition`),
      period: text(fact.period, `outline.facts[${index}].period`), filters: stringList(fact.filters, `outline.facts[${index}].filters`), factValuesChanged: false as const,
      ...(fact.businessExplanation === undefined ? {} : { businessExplanation: text(fact.businessExplanation, `outline.facts[${index}].businessExplanation`) }),
      dimensions: factDimensions, measures: factMeasures, ...(factTechnical === undefined ? {} : { technical: factTechnical }),
    })
  })
  const factIds = facts.map(fact => fact.factId); unique(factIds, 'outline.facts')
  if (facts.length === 0) throw new Error('outline.facts must not be empty')
  const factSet = new Set(factIds)
  const slides = array(root.slides, 'outline.slides').map((value, slideIndex) => {
    const slide = record(value, `outline.slides[${slideIndex}]`)
    if (!LAYOUT_SET.has(String(slide.layout))) throw new Error(`outline.slides[${slideIndex}].layout is unsupported`)
    const elements = array(slide.elements, `outline.slides[${slideIndex}].elements`).map((value, elementIndex) => {
      const item = record(value, `outline.slides[${slideIndex}].elements[${elementIndex}]`)
      if (!['title', 'text', 'kpi', 'chart', 'table', 'list', 'decoration'].includes(String(item.type))) throw new Error(`outline element type is unsupported`)
      const linkedFacts = stringList(item.factIds, `outline element factIds`)
      if (linkedFacts.some(factId => !factSet.has(factId))) throw new Error(`outline element references an unknown fact`)
      const bindings = array(item.bindings, 'outline element bindings').map((value, bindingIndex) => {
        const binding = record(value, `outline element bindings[${bindingIndex}]`)
        const factId = id(binding.factId, `outline element bindings[${bindingIndex}].factId`)
        if (!factSet.has(factId) || !linkedFacts.includes(factId)) throw new Error('outline binding references an unlinked fact')
        return Object.freeze({ factId, selector: selector(binding.selector, `outline element bindings[${bindingIndex}].selector`) })
      })
      if (item.presentationOnly === true) {
        if (linkedFacts.length > 0 || bindings.length > 0) throw new Error('presentation_only elements cannot bind facts')
      } else if (item.type !== 'decoration' && (linkedFacts.length === 0 || bindings.length === 0)) {
        throw new Error('every data or narrative element requires a Fact binding')
      }
      let chart: PresentationChartSpec | undefined
      if (item.chart !== undefined) {
        const chartPath = `outline.slides[${slideIndex}].elements[${elementIndex}].chart`
        const spec = record(item.chart, chartPath)
        if (!['horizontal-bar', 'lollipop', 'dot-plot', 'bullet', 'slope', 'line'].includes(String(spec.kind))) throw new Error('outline chart kind is unsupported')
        const points = array(spec.points, 'outline chart points').map((value, index) => {
          const point = record(value, `outline chart points[${index}]`); const factId = id(point.factId, `outline chart points[${index}].factId`)
          if (!factSet.has(factId)) throw new Error('outline chart point references an unknown fact')
          const number = point.value
          if (typeof number !== 'number' || !Number.isFinite(number)) throw new Error('outline chart point value must be finite')
          return Object.freeze({ seriesKey: id(point.seriesKey, 'chart point seriesKey'), categoryKey: id(point.categoryKey, 'chart point categoryKey'), label: text(point.label, 'chart point label'), value: number, displayValue: text(point.displayValue, 'chart point displayValue'), factId })
        })
        if (points.length === 0) throw new Error('outline chart requires points')
        for (const [pointIndex, point] of points.entries()) if (!bindings.some(binding => binding.factId === point.factId && binding.selector.kind === 'chart-point' && binding.selector.seriesKey === point.seriesKey && binding.selector.categoryKey === point.categoryKey)) throw new Error(`${chartPath}.points[${pointIndex}] lacks a matching chart-point Selector`)
        chart = Object.freeze({ kind: spec.kind as PresentationChartSpec['kind'], points: Object.freeze(points) })
      }
      let table: PresentationTableSpec | undefined
      if (item.table !== undefined) {
        const tablePath = `outline.slides[${slideIndex}].elements[${elementIndex}].table`
        const spec = record(item.table, tablePath)
        const columns = array(spec.columns, 'outline table columns').map(value => { const column = record(value, 'outline table column'); return Object.freeze({ columnKey: id(column.columnKey, 'table columnKey'), label: text(column.label, 'table column label') }) })
        unique(columns.map(column => column.columnKey), 'outline table columns')
        const rows = array(spec.rows, 'outline table rows').map(value => {
          const row = record(value, 'outline table row'); const rowKey = id(row.rowKey, 'table rowKey')
          const cells = array(row.cells, 'outline table cells').map(value => { const cell = record(value, 'outline table cell'); const columnKey = id(cell.columnKey, 'table cell columnKey'); const factId = cell.factId === undefined ? undefined : id(cell.factId, 'table cell factId'); if (factId !== undefined && !factSet.has(factId)) throw new Error('outline table cell references an unknown fact'); return Object.freeze({ rowKey, columnKey, displayValue: text(cell.displayValue, 'table cell displayValue'), ...(factId === undefined ? {} : { factId }) }) })
          return Object.freeze({ rowKey, label: text(row.label, 'table row label'), cells: Object.freeze(cells) })
        })
        unique(rows.map(row => row.rowKey), 'outline table rows')
        for (const [rowIndex, row] of rows.entries()) for (const [cellIndex, cell] of row.cells.entries()) if (cell.factId !== undefined && !bindings.some(binding => binding.factId === cell.factId && binding.selector.kind === 'table-cell' && binding.selector.rowKey === row.rowKey && binding.selector.columnKey === cell.columnKey)) throw new Error(`${tablePath}.rows[${rowIndex}].cells[${cellIndex}] lacks a matching table-cell Selector`)
        table = Object.freeze({ columns: Object.freeze(columns), rows: Object.freeze(rows) })
      }
      if (item.type === 'chart' && chart === undefined) throw new Error('chart element requires chart data')
      if (item.type === 'table' && table === undefined) throw new Error('table element requires table data')
      return Object.freeze({
        objectId: id(item.objectId, 'outline element objectId'), type: item.type as PresentationElement['type'],
        ...(item.title === undefined ? {} : { title: text(item.title, 'outline element title') }),
        ...(item.text === undefined ? {} : { text: text(item.text, 'outline element text') }),
        ...(item.displayValue === undefined ? {} : { displayValue: text(item.displayValue, 'outline element displayValue') }),
        factIds: linkedFacts, bindings: Object.freeze(bindings), ...(item.presentationOnly === true ? { presentationOnly: true as const } : {}),
        ...(chart === undefined ? {} : { chart }), ...(table === undefined ? {} : { table }),
      })
    })
    unique(elements.map(element => element.objectId), `outline.slides[${slideIndex}].elements`)
    if (elements.length === 0) throw new Error('outline slide requires elements')
    let trace: PresentationSlideTrace | undefined
    if (slide.trace !== undefined) {
      const input = record(slide.trace, `outline.slides[${slideIndex}].trace`)
      const businessBlocks = array(input.businessBlocks, `outline.slides[${slideIndex}].trace.businessBlocks`).map((entry, index) => {
        const block = record(entry, `outline.slides[${slideIndex}].trace.businessBlocks[${index}]`)
        return Object.freeze({ blockId: id(block.blockId, `outline.slides[${slideIndex}].trace.businessBlocks[${index}].blockId`), label: text(block.label, `outline.slides[${slideIndex}].trace.businessBlocks[${index}].label`), description: text(block.description, `outline.slides[${slideIndex}].trace.businessBlocks[${index}].description`) })
      })
      if (businessBlocks.length === 0) throw new Error(`outline.slides[${slideIndex}].trace.businessBlocks must not be empty`)
      unique(businessBlocks.map(block => block.blockId), `outline.slides[${slideIndex}].trace.businessBlocks`)
      const blockIds = new Set(businessBlocks.map(block => block.blockId))
      const slideFactIds = new Set(elements.flatMap(element => element.factIds))
      const metrics = array(input.metrics, `outline.slides[${slideIndex}].trace.metrics`).map((entry, index) => {
        const metric = record(entry, `outline.slides[${slideIndex}].trace.metrics[${index}]`)
        const businessBlockId = id(metric.businessBlockId, `outline.slides[${slideIndex}].trace.metrics[${index}].businessBlockId`)
        if (!blockIds.has(businessBlockId)) throw new Error(`outline.slides[${slideIndex}].trace.metrics[${index}] references an unknown business block`)
        const metricFactIds = stringList(metric.factIds, `outline.slides[${slideIndex}].trace.metrics[${index}].factIds`)
        if (metricFactIds.length === 0 || metricFactIds.some(factId => !factSet.has(factId) || !slideFactIds.has(factId))) throw new Error(`outline.slides[${slideIndex}].trace.metrics[${index}] references a Fact not bound on this slide`)
        unique(metricFactIds, `outline.slides[${slideIndex}].trace.metrics[${index}].factIds`)
        const metricFacts = metricFactIds.map(factId => facts.find(fact => fact.factId === factId) as PresentationFact)
        const metricVisualization = visualization(metric.visualization, `outline.slides[${slideIndex}].trace.metrics[${index}].visualization`, metricFacts)
        return Object.freeze({ metricId: id(metric.metricId, `outline.slides[${slideIndex}].trace.metrics[${index}].metricId`), label: text(metric.label, `outline.slides[${slideIndex}].trace.metrics[${index}].label`), businessBlockId, factIds: metricFactIds, ...(metricVisualization === undefined ? {} : { visualization: metricVisualization }) })
      })
      if (metrics.length === 0) throw new Error(`outline.slides[${slideIndex}].trace.metrics must not be empty`)
      unique(metrics.map(metric => metric.metricId), `outline.slides[${slideIndex}].trace.metrics`)
      const groupedFacts = new Set(metrics.flatMap(metric => metric.factIds))
      if ([...slideFactIds].some(factId => !groupedFacts.has(factId))) throw new Error(`outline.slides[${slideIndex}].trace must group every Fact bound on the slide`)
      trace = Object.freeze({ businessBlocks: Object.freeze(businessBlocks), metrics: Object.freeze(metrics) })
    }
    return Object.freeze({ slideId: id(slide.slideId, `outline.slides[${slideIndex}].slideId`), layout: slide.layout as PresentationLayout, ...(slide.eyebrow === undefined ? {} : { eyebrow: text(slide.eyebrow, 'outline slide eyebrow') }), title: text(slide.title, 'outline slide title'), narrative: text(slide.narrative, 'outline slide narrative'), elements: Object.freeze(elements), ...(trace === undefined ? {} : { trace }) })
  })
  unique(slides.map(slide => slide.slideId), 'outline.slides')
  if (slides.length === 0 || slides.length > MAX_PRESENTATION_SLIDES) throw new Error(`outline.slides must contain 1-${MAX_PRESENTATION_SLIDES} slides`)
  return Object.freeze({ schema: PRESENTATION_OUTLINE_SCHEMA, title: text(root.title, 'outline.title'), ...(root.subtitle === undefined ? {} : { subtitle: text(root.subtitle, 'outline.subtitle') }), design, sources: Object.freeze(sources), facts: Object.freeze(facts), slides: Object.freeze(slides) })
}

export function traceFromPresentationOutline(input: unknown): Readonly<PresentationTraceV3> {
  const outline = definePresentationOutline(input)
  const facts = new Map(outline.facts.map(fact => [fact.factId, fact]))
  const traceFact = (factId: string) => {
    const fact = facts.get(factId) as PresentationFact
    const fallbackMeasures = typeof fact.rawValue === 'number' ? [Object.freeze({ key: fact.fieldPath, label: fact.definition, value: fact.rawValue, displayValue: fact.displayValue })] : []
    const registeredTechnical = fact.technical ?? {}
    return Object.freeze({
      factId: fact.factId, displayValue: fact.displayValue,
      dimensions: fact.dimensions,
      measures: fact.measures.length > 0 ? fact.measures : Object.freeze(fallbackMeasures),
      business: Object.freeze({ definition: fact.definition, explanation: fact.businessExplanation ?? fact.method, scope: Object.freeze({ period: fact.period, filters: fact.filters }) }),
      sourceIds: fact.sourceIds, factValuesChanged: false as const, valueType: fact.valueType,
      technical: Object.freeze({
        ...registeredTechnical,
        ...(registeredTechnical.calculation === undefined && fact.formula !== undefined ? { calculation: fact.formula } : {}),
        ...(registeredTechnical.definition === undefined ? { definition: fact.method } : {}),
        ...(registeredTechnical.sourceFields === undefined ? { sourceFields: Object.freeze([fact.fieldPath]) } : {}),
        ...(registeredTechnical.filters === undefined ? { filters: fact.filters } : {}),
      }),
    })
  }
  return Object.freeze({
    schemaVersion: PRESENTATION_TRACE_SCHEMA,
    reviewStatus: 'generated',
    sources: Object.freeze(outline.sources.map(source => Object.freeze({ id: source.sourceId, name: source.name, path: source.path, sha256: source.sha256, format: source.format, role: source.role, period: source.period, summary: source.summary, ...(source.artifactId === undefined ? {} : { artifactId: source.artifactId }) }))),
    slides: Object.freeze(outline.slides.map(slide => {
      const blockId = `${slide.slideId}:content`
      const slideFactIds = [...new Set(slide.elements.flatMap(element => element.factIds))]
      const businessBlocks = slide.trace?.businessBlocks ?? Object.freeze([{ blockId, label: slide.title, description: slide.narrative }])
      const metrics = slide.trace?.metrics.map(metric => Object.freeze({
        metricId: metric.metricId,
        label: metric.label,
        businessBlockId: metric.businessBlockId,
        facts: Object.freeze(metric.factIds.map(traceFact)),
        ...(metric.visualization === undefined ? {} : { visualization: metric.visualization }),
      })) ?? slideFactIds.map(factId => {
        const fact = facts.get(factId) as PresentationFact
        return Object.freeze({ metricId: `${slide.slideId}:${factId}`, label: fact.definition, businessBlockId: blockId, facts: Object.freeze([traceFact(factId)]) })
      })
      return Object.freeze({
        slideId: slide.slideId,
        explanation: slide.narrative,
        businessBlocks: Object.freeze(businessBlocks),
        metrics: Object.freeze(metrics),
        visualBindings: Object.freeze(slide.elements.filter(element => element.presentationOnly !== true).map(element => Object.freeze({ objectId: element.objectId, factBindings: element.bindings }))),
      })
    })),
  })
}

export function validatePresentationTraceability(input: unknown, sourceHashesVerified = true): Readonly<PresentationValidationV1> {
  const outline = definePresentationOutline(input)
  const requiredBindings = outline.slides.reduce((count, slide) => count + slide.elements.filter(element => element.presentationOnly !== true).reduce((subtotal, element) => subtotal + element.bindings.length, 0), 0)
  const trace = traceFromPresentationOutline(outline)
  const resolvedBindings = trace.slides.reduce((count, slide) => count + slide.visualBindings.reduce((subtotal, binding) => subtotal + binding.factBindings.length, 0), 0)
  const errors = sourceHashesVerified ? [] : ['one or more source hashes do not match the declared snapshot']
  return Object.freeze({ schema: PRESENTATION_VALIDATION_SCHEMA, valid: requiredBindings > 0 && requiredBindings === resolvedBindings && sourceHashesVerified, requiredBindings, resolvedBindings, resolutionRate: requiredBindings === 0 ? 0 : resolvedBindings / requiredBindings, factValuesChanged: false, sourceHashesVerified, checkedLayouts: Object.freeze([...new Set(outline.slides.map(slide => slide.layout))]), errors: Object.freeze(errors) })
}

/** Stable, human-diffable encoding used by Outline, Trace and Validation sidecars. */
export function canonicalJson(value: unknown): string {
  const sort = (input: unknown): unknown => Array.isArray(input) ? input.map(sort) : typeof input === 'object' && input !== null ? Object.fromEntries(Object.entries(input as JsonRecord).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sort(entry)])) : input
  return `${JSON.stringify(sort(value), null, 2)}\n`
}
