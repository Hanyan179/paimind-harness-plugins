import type { PaimindArtifactView } from '@paimind/artifacts'
import { defineArtifactProjection, type ArtifactTraceEnvelopeV2, type PaimindArtifactProjectionV1 } from '@paimind/contracts'
import type { HarnessSessionService } from '@paimind/harness-compat'

export const TRACE_DOCUMENT_PATH = '/paimind/presentation-trace/document'

export const TRACE_SCHEMA_V1 = 'paimind.presentation-trace/v1'
export const TRACE_SCHEMA_V2 = 'paimind.presentation-trace/v2'
export const TRACE_SCHEMA_V3 = 'paimind.presentation-trace/v3'
export type PaimindTraceReviewStatus = 'generated' | 'reviewed' | 'verified'

export interface PaimindTraceSourceRecord {
  readonly id: string
  readonly name: string
  readonly format: string
  readonly role: string
  readonly version?: string
  readonly size?: string
  readonly path?: string
  readonly sha256?: string
  readonly period?: string
  readonly summary?: string
  readonly artifactId?: string
}

export interface PaimindTraceDimension { readonly key: string; readonly label: string; readonly value: string }
export interface PaimindTraceMeasure { readonly key: string; readonly label: string; readonly value: number; readonly displayValue: string }
export interface PaimindTraceLineageStep { readonly stepId: string; readonly label: string; readonly operation: string }
export interface PaimindTraceTechnical {
  readonly definition?: string
  readonly calculation?: string
  readonly aggregation?: string
  readonly sourceFields?: readonly string[]
  readonly filters?: readonly string[]
  readonly joinKeys?: readonly string[]
  readonly lineage?: readonly PaimindTraceLineageStep[]
  readonly codeFile?: string
  readonly executionDurationMs?: number
}
export interface PaimindTraceBusiness {
  readonly definition?: string
  readonly explanation: string
  readonly scope: { readonly period: string; readonly filters: readonly string[] }
}
export interface PaimindTraceFact {
  readonly factId: string
  readonly displayValue: string
  readonly dimensions: readonly PaimindTraceDimension[]
  readonly measures: readonly PaimindTraceMeasure[]
  readonly business: PaimindTraceBusiness
  readonly sourceIds: readonly string[]
  readonly visualScale?: string
  readonly factValuesChanged: false
  readonly technical?: PaimindTraceTechnical
  readonly valueType?: 'source_value' | 'derived_metric' | 'narrative'
}
export interface PaimindTraceVisualizationEncoding {
  readonly channel: 'x' | 'y' | 'series' | 'color' | 'size' | 'row' | 'column' | 'label' | 'value'
  readonly source: 'dimension' | 'measure' | 'fact'
  readonly fieldKey: string
  readonly label: string
}
export interface PaimindTraceMetric {
  readonly metricId: string
  readonly label: string
  readonly businessBlockId: string
  readonly facts: readonly PaimindTraceFact[]
  readonly visualization?: {
    readonly kind: 'scalar' | 'cartesian' | 'matrix' | 'list'
    readonly mark: 'number' | 'bar' | 'line' | 'scatter' | 'bubble' | 'heatmap' | 'table' | 'text'
    readonly encodings: readonly PaimindTraceVisualizationEncoding[]
  }
}
export interface PaimindTraceBusinessBlock { readonly blockId: string; readonly label: string; readonly description: string }
export interface PaimindTraceSelector {
  readonly kind: 'object' | 'chart-point' | 'table-cell'
  readonly seriesKey?: string
  readonly categoryKey?: string
  readonly rowKey?: string
  readonly columnKey?: string
}
export interface PaimindTraceVisualBinding {
  readonly objectId: string
  readonly factBindings: readonly { readonly factId: string; readonly selector: PaimindTraceSelector }[]
}
export interface PaimindTraceSlide {
  readonly slideId: string
  readonly explanation: string
  readonly businessBlocks: readonly PaimindTraceBusinessBlock[]
  readonly metrics: readonly PaimindTraceMetric[]
  readonly visualBindings: readonly PaimindTraceVisualBinding[]
}
export interface PaimindPresentationTraceDocument {
  readonly schemaVersion: typeof TRACE_SCHEMA_V2 | typeof TRACE_SCHEMA_V3
  readonly reviewStatus: PaimindTraceReviewStatus
  readonly sources: readonly PaimindTraceSourceRecord[]
  readonly slides: readonly PaimindTraceSlide[]
}

export interface PaimindPresentationTraceRecord { readonly id: string; readonly traceId: string; readonly document: unknown }
export interface PaimindPresentationTraceSourceSnapshot { readonly traces: readonly PaimindPresentationTraceRecord[] }
export interface PaimindPresentationTraceSource {
  readonly id: string
  getSnapshot(): PaimindPresentationTraceSourceSnapshot
  subscribe(listener: () => void): () => void
}

/**
 * Browser projection of provenance carried by the canonical Artifact Session face.
 * It owns no trace persistence and clears immediately when the native face is absent.
 */
export class HarnessProjectedPresentationTraceSource implements PaimindPresentationTraceSource {
  readonly id = 'paimind:artifact-trace-projection'
  private readonly listeners = new Set<() => void>()
  private snapshot: PaimindPresentationTraceSourceSnapshot = Object.freeze({ traces: Object.freeze([]) })
  private currentId: string | undefined
  private disposeCurrent: () => void = () => {}
  private readonly disposeList: () => void
  private readonly referencedDocuments = new Map<string, unknown>()
  private readonly pendingReferences = new Set<string>()
  private disposed = false

  constructor(private readonly sessions: HarnessSessionService) {
    this.disposeList = sessions.list.subscribe(() => { this.rebind() })
    this.rebind()
  }

  getSnapshot(): PaimindPresentationTraceSourceSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposeCurrent()
    this.disposeList()
    this.referencedDocuments.clear()
    this.pendingReferences.clear()
    this.listeners.clear()
    this.snapshot = Object.freeze({ traces: Object.freeze([]) })
  }

  private rebind(): void {
    if (this.disposed) return
    const next = this.sessions.list.getSnapshot().current
    if (next === this.currentId) { this.refresh(); return }
    this.disposeCurrent()
    this.disposeCurrent = () => {}
    this.currentId = next
    if (next !== undefined) {
      const face = this.sessions.binding?.(next)?.session.projections?.faceOf('paimind.artifacts')
      if (face !== undefined) this.disposeCurrent = face.subscribe(() => { this.refresh() })
    }
    this.refresh()
  }

  private refresh(): void {
    if (this.disposed) return
    const sessionId = this.currentId
    const value = sessionId === undefined
      ? undefined
      : this.sessions.binding?.(sessionId)?.session.projections?.faceOf('paimind.artifacts').getSnapshot()
    let traces: readonly PaimindPresentationTraceRecord[] = Object.freeze([])
    if (sessionId !== undefined && value !== undefined) {
      try {
        const projection = defineArtifactProjection(value as PaimindArtifactProjectionV1)
        const records: PaimindPresentationTraceRecord[] = []
        for (const trace of projection.traces.filter(trace => trace.sessionId === sessionId)) {
          if (trace.schema === 'paimind.artifact-trace/v1') {
            records.push(Object.freeze({ id: `projection:${trace.traceId}`, traceId: trace.traceId, document: trace.document }))
            continue
          }
          const key = `${trace.traceId}:${trace.documentRef.sha256}`
          const document = this.referencedDocuments.get(key)
          if (document !== undefined) records.push(Object.freeze({ id: `projection:${trace.traceId}`, traceId: trace.traceId, document }))
          else this.loadReference(trace, key)
        }
        traces = Object.freeze(records)
      } catch {
        traces = Object.freeze([])
      }
    }
    this.snapshot = Object.freeze({ traces })
    for (const listener of [...this.listeners]) listener()
  }

  private loadReference(trace: Readonly<ArtifactTraceEnvelopeV2>, key: string): void {
    if (this.pendingReferences.has(key) || this.disposed) return
    this.pendingReferences.add(key)
    const url = new URL(TRACE_DOCUMENT_PATH, window.location.origin)
    url.searchParams.set('sessionId', trace.sessionId)
    url.searchParams.set('path', trace.documentRef.path)
    url.searchParams.set('schema', trace.documentRef.schema)
    url.searchParams.set('sha256', trace.documentRef.sha256)
    url.searchParams.set('bytes', String(trace.documentRef.bytes))
    void fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(async response => response.ok ? response.json() as Promise<unknown> : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(document => {
        if (this.disposed) return
        this.referencedDocuments.set(key, document)
        this.pendingReferences.delete(key)
        this.refresh()
      })
      .catch(() => {
        this.pendingReferences.delete(key)
        this.referencedDocuments.delete(key)
        if (!this.disposed) for (const listener of [...this.listeners]) listener()
      })
  }
}
export interface PaimindPresentationTraceView extends Omit<PaimindPresentationTraceRecord, 'document'> {
  readonly sourceId: string
  readonly document: PaimindPresentationTraceDocument
}
export interface PaimindPresentationTraceDiagnostic { readonly sourceId: string; readonly recordId?: string; readonly message: string }
export interface PaimindTraceSelection {
  readonly traceId: string
  readonly artifactSourceId: string
  readonly artifactId: string
  readonly sessionId: string
  readonly workspaceId: string
  readonly path: string
  readonly title: string
}
export interface PaimindPresentationTraceSnapshot {
  readonly revision: number
  readonly traces: readonly PaimindPresentationTraceView[]
  readonly diagnostics: readonly PaimindPresentationTraceDiagnostic[]
  readonly selection: PaimindTraceSelection | null
}
export interface PaimindPresentationTraceService {
  getSnapshot(): PaimindPresentationTraceSnapshot
  subscribe(listener: () => void): () => void
  registerSource(source: PaimindPresentationTraceSource): () => void
  selectArtifact(artifact: PaimindArtifactView): boolean
  dispose(): void
}

type UnknownRecord = Record<string, unknown>
const isRecord = (value: unknown): value is UnknownRecord => value !== null && typeof value === 'object' && !Array.isArray(value)
const valueText = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}
const optionalText = (value: unknown, label: string): string | undefined => value === undefined ? undefined : valueText(value, label)
const textList = (value: unknown, label: string, allowEmpty = false): readonly string[] => {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array`)
  return Object.freeze(value.map((entry, index) => valueText(entry, `${label}[${index}]`)))
}
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/
const recordId = (value: unknown, label: string): string => {
  const id = valueText(value, label)
  if (!idPattern.test(id)) throw new Error(`${label} has an invalid format`)
  return id
}
const unique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`)
}

function normalizeSources(value: unknown): readonly PaimindTraceSourceRecord[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('sources must be a non-empty array')
  const sources = value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`sources[${index}] must be an object`)
    return Object.freeze({
      id: recordId(entry.id, `sources[${index}].id`),
      name: valueText(entry.name, `sources[${index}].name`),
      format: valueText(entry.format, `sources[${index}].format`),
      role: valueText(entry.role, `sources[${index}].role`),
      ...(entry.version === undefined ? {} : { version: valueText(entry.version, `sources[${index}].version`) }),
      ...(entry.size === undefined ? {} : { size: valueText(entry.size, `sources[${index}].size`) }),
      ...(entry.path === undefined ? {} : { path: valueText(entry.path, `sources[${index}].path`) }),
      ...(entry.sha256 === undefined ? {} : { sha256: valueText(entry.sha256, `sources[${index}].sha256`) }),
      ...(entry.period === undefined ? {} : { period: valueText(entry.period, `sources[${index}].period`) }),
      ...(entry.summary === undefined ? {} : { summary: valueText(entry.summary, `sources[${index}].summary`) }),
      ...(entry.artifactId === undefined ? {} : { artifactId: recordId(entry.artifactId, `sources[${index}].artifactId`) }),
    })
  })
  unique(sources.map(source => source.id), 'sources ids')
  return Object.freeze(sources)
}

function normalizeTechnical(value: unknown, label: string): PaimindTraceTechnical | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  const lineage = value.lineage === undefined ? undefined : (() => {
    if (!Array.isArray(value.lineage) || value.lineage.length === 0) throw new Error(`${label}.lineage must be a non-empty array`)
    const steps = value.lineage.map((step, index) => {
      if (!isRecord(step)) throw new Error(`${label}.lineage[${index}] must be an object`)
      return Object.freeze({
        stepId: recordId(step.stepId, `${label}.lineage[${index}].stepId`),
        label: valueText(step.label, `${label}.lineage[${index}].label`),
        operation: valueText(step.operation, `${label}.lineage[${index}].operation`),
      })
    })
    unique(steps.map(step => step.stepId), `${label}.lineage step ids`)
    return Object.freeze(steps)
  })()
  if (value.executionDurationMs !== undefined
    && (typeof value.executionDurationMs !== 'number' || !Number.isFinite(value.executionDurationMs) || value.executionDurationMs < 0)) {
    throw new Error(`${label}.executionDurationMs must be a non-negative finite number`)
  }
  const definition = optionalText(value.definition, `${label}.definition`)
  const calculation = optionalText(value.calculation, `${label}.calculation`)
  const aggregation = optionalText(value.aggregation, `${label}.aggregation`)
  const codeFile = optionalText(value.codeFile, `${label}.codeFile`)
  return Object.freeze({
    ...(definition === undefined ? {} : { definition }),
    ...(calculation === undefined ? {} : { calculation }),
    ...(aggregation === undefined ? {} : { aggregation }),
    ...(value.sourceFields === undefined ? {} : { sourceFields: textList(value.sourceFields, `${label}.sourceFields`) }),
    ...(value.filters === undefined ? {} : { filters: textList(value.filters, `${label}.filters`, true) }),
    // A deterministic calculation can legitimately have no join at all. The
    // canonical presentation contract therefore permits an explicitly empty
    // joinKeys array, and the Viewer must preserve that meaning instead of
    // rejecting an otherwise valid trace Sidecar.
    ...(value.joinKeys === undefined ? {} : { joinKeys: textList(value.joinKeys, `${label}.joinKeys`, true) }),
    ...(lineage === undefined ? {} : { lineage }),
    ...(codeFile === undefined ? {} : { codeFile }),
    ...(value.executionDurationMs === undefined ? {} : { executionDurationMs: value.executionDurationMs }),
  })
}

function normalizeFact(value: unknown, label: string, sourceIds: ReadonlySet<string>): PaimindTraceFact {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  if (value.factValuesChanged !== false) throw new Error(`${label}.factValuesChanged must be false`)
  if (!isRecord(value.business)) throw new Error(`${label}.business must be an object`)
  if (!isRecord(value.business.scope)) throw new Error(`${label}.business.scope must be an object`)
  const references = textList(value.sourceIds, `${label}.sourceIds`)
  unique(references, `${label}.sourceIds`)
  for (const sourceId of references) if (!sourceIds.has(sourceId)) throw new Error(`${label}.sourceIds references unknown source ${sourceId}`)
  const dimensions = value.dimensions === undefined ? [] : (() => {
    if (!Array.isArray(value.dimensions)) throw new Error(`${label}.dimensions must be an array`)
    const rows = value.dimensions.map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`${label}.dimensions[${index}] must be an object`)
      return Object.freeze({ key: valueText(entry.key, `${label}.dimensions[${index}].key`), label: valueText(entry.label, `${label}.dimensions[${index}].label`), value: valueText(entry.value, `${label}.dimensions[${index}].value`) })
    })
    unique(rows.map(row => row.key), `${label}.dimension keys`)
    return rows
  })()
  const measures = value.measures === undefined ? [] : (() => {
    if (!Array.isArray(value.measures)) throw new Error(`${label}.measures must be an array`)
    const rows = value.measures.map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`${label}.measures[${index}] must be an object`)
      if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) throw new Error(`${label}.measures[${index}].value must be finite`)
      return Object.freeze({ key: valueText(entry.key, `${label}.measures[${index}].key`), label: valueText(entry.label, `${label}.measures[${index}].label`), value: entry.value, displayValue: valueText(entry.displayValue, `${label}.measures[${index}].displayValue`) })
    })
    unique(rows.map(row => row.key), `${label}.measure keys`)
    return rows
  })()
  const businessDefinition = optionalText(value.business.definition, `${label}.business.definition`)
  const visualScale = optionalText(value.visualScale, `${label}.visualScale`)
  const technical = normalizeTechnical(value.technical, `${label}.technical`)
  return Object.freeze({
    factId: recordId(value.factId, `${label}.factId`),
    displayValue: valueText(value.displayValue, `${label}.displayValue`),
    dimensions: Object.freeze(dimensions), measures: Object.freeze(measures),
    business: Object.freeze({
      ...(businessDefinition === undefined ? {} : { definition: businessDefinition }),
      explanation: valueText(value.business.explanation, `${label}.business.explanation`),
      scope: Object.freeze({ period: valueText(value.business.scope.period, `${label}.business.scope.period`), filters: textList(value.business.scope.filters, `${label}.business.scope.filters`, true) }),
    }),
    sourceIds: references,
    ...(visualScale === undefined ? {} : { visualScale }),
    factValuesChanged: false,
    ...(technical === undefined ? {} : { technical }),
    ...(value.valueType === 'source_value' || value.valueType === 'derived_metric' || value.valueType === 'narrative' ? { valueType: value.valueType } : {}),
  })
}

const VIS_KINDS = new Set(['scalar', 'cartesian', 'matrix', 'list'])
const VIS_MARKS = new Set(['number', 'bar', 'line', 'scatter', 'bubble', 'heatmap', 'table', 'text'])
const VIS_CHANNELS = new Set(['x', 'y', 'series', 'color', 'size', 'row', 'column', 'label', 'value'])
const VIS_SOURCES = new Set(['dimension', 'measure', 'fact'])

function normalizeMetric(value: unknown, label: string, blockIds: ReadonlySet<string>, sourceIds: ReadonlySet<string>): PaimindTraceMetric {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  if (!Array.isArray(value.facts) || value.facts.length === 0) throw new Error(`${label}.facts must be a non-empty array`)
  const facts = value.facts.map((fact, index) => normalizeFact(fact, `${label}.facts[${index}]`, sourceIds))
  unique(facts.map(fact => fact.factId), `${label}.fact ids`)
  const businessBlockId = value.businessBlockId === undefined ? 'slide-overview' : recordId(value.businessBlockId, `${label}.businessBlockId`)
  if (!blockIds.has(businessBlockId)) throw new Error(`${label}.businessBlockId references unknown block ${businessBlockId}`)
  let visualization: PaimindTraceMetric['visualization']
  if (value.visualization !== undefined) {
    if (!isRecord(value.visualization) || !VIS_KINDS.has(String(value.visualization.kind)) || !VIS_MARKS.has(String(value.visualization.mark)) || !Array.isArray(value.visualization.encodings) || value.visualization.encodings.length === 0) throw new Error(`${label}.visualization is invalid`)
    const encodings = value.visualization.encodings.map((entry, index) => {
      if (!isRecord(entry) || !VIS_CHANNELS.has(String(entry.channel)) || !VIS_SOURCES.has(String(entry.source))) throw new Error(`${label}.visualization.encodings[${index}] is invalid`)
      return Object.freeze({ channel: entry.channel as PaimindTraceVisualizationEncoding['channel'], source: entry.source as PaimindTraceVisualizationEncoding['source'], fieldKey: valueText(entry.fieldKey, `${label}.visualization.encodings[${index}].fieldKey`), label: valueText(entry.label, `${label}.visualization.encodings[${index}].label`) })
    })
    unique(encodings.map(encoding => encoding.channel), `${label}.visualization channels`)
    for (const encoding of encodings) for (const fact of facts) {
      if (encoding.source === 'dimension' && !fact.dimensions.some(row => row.key === encoding.fieldKey)) throw new Error(`${label}.visualization references missing dimension ${encoding.fieldKey}`)
      if (encoding.source === 'measure' && !fact.measures.some(row => row.key === encoding.fieldKey)) throw new Error(`${label}.visualization references missing measure ${encoding.fieldKey}`)
      if (encoding.source === 'fact' && encoding.fieldKey !== 'displayValue') throw new Error(`${label}.visualization fact field must be displayValue`)
    }
    visualization = Object.freeze({ kind: value.visualization.kind as NonNullable<PaimindTraceMetric['visualization']>['kind'], mark: value.visualization.mark as NonNullable<PaimindTraceMetric['visualization']>['mark'], encodings: Object.freeze(encodings) })
  }
  return Object.freeze({ metricId: recordId(value.metricId, `${label}.metricId`), label: valueText(value.label, `${label}.label`), businessBlockId, facts: Object.freeze(facts), ...(visualization === undefined ? {} : { visualization }) })
}

function normalizeV2(value: UnknownRecord, sources: readonly PaimindTraceSourceRecord[], schemaVersion: typeof TRACE_SCHEMA_V2 | typeof TRACE_SCHEMA_V3 = TRACE_SCHEMA_V2): PaimindPresentationTraceDocument {
  if (!Array.isArray(value.slides) || value.slides.length === 0) throw new Error('slides must be a non-empty array')
  const sourceIds = new Set(sources.map(source => source.id))
  const slides = value.slides.map((entry, slideIndex) => {
    const label = `slides[${slideIndex}]`
    if (!isRecord(entry)) throw new Error(`${label} must be an object`)
    const declaredBlocks = entry.businessBlocks === undefined ? [] : (() => {
      if (!Array.isArray(entry.businessBlocks) || entry.businessBlocks.length === 0) throw new Error(`${label}.businessBlocks must be a non-empty array`)
      return entry.businessBlocks.map((block, index) => {
        if (!isRecord(block)) throw new Error(`${label}.businessBlocks[${index}] must be an object`)
        return Object.freeze({ blockId: recordId(block.blockId, `${label}.businessBlocks[${index}].blockId`), label: valueText(block.label, `${label}.businessBlocks[${index}].label`), description: valueText(block.description, `${label}.businessBlocks[${index}].description`) })
      })
    })()
    const blocks = declaredBlocks.length === 0 ? [Object.freeze({ blockId: 'slide-overview', label: 'Slide overview', description: 'Registered facts for this slide.' })] : declaredBlocks
    unique(blocks.map(block => block.blockId), `${label}.block ids`)
    if (!Array.isArray(entry.metrics) || entry.metrics.length === 0) throw new Error(`${label}.metrics must be a non-empty array`)
    const metrics = entry.metrics.map((metric, index) => normalizeMetric(metric, `${label}.metrics[${index}]`, new Set(blocks.map(block => block.blockId)), sourceIds))
    unique(metrics.map(metric => metric.metricId), `${label}.metric ids`)
    const factIds = new Set(metrics.flatMap(metric => metric.facts.map(fact => fact.factId)))
    const bindings = entry.visualBindings === undefined ? [] : (() => {
      if (!Array.isArray(entry.visualBindings)) throw new Error(`${label}.visualBindings must be an array`)
      const rows = entry.visualBindings.map((binding, index) => {
        if (!isRecord(binding) || !Array.isArray(binding.factBindings) || binding.factBindings.length === 0) throw new Error(`${label}.visualBindings[${index}] is invalid`)
        const factBindings = binding.factBindings.map((factBinding, bindingIndex) => {
          if (!isRecord(factBinding) || !isRecord(factBinding.selector)) throw new Error(`${label}.visualBindings[${index}].factBindings[${bindingIndex}] is invalid`)
          const kind = factBinding.selector.kind
          if (kind !== 'object' && kind !== 'chart-point' && kind !== 'table-cell') throw new Error(`${label}.visualBindings[${index}].factBindings[${bindingIndex}].selector kind is invalid`)
          const factId = recordId(factBinding.factId, `${label}.visualBindings[${index}].factBindings[${bindingIndex}].factId`)
          if (!factIds.has(factId)) throw new Error(`${label}.visualBindings references unknown fact ${factId}`)
          const selector: PaimindTraceSelector = kind === 'chart-point'
            ? Object.freeze({ kind, seriesKey: valueText(factBinding.selector.seriesKey, `${label}.selector.seriesKey`), categoryKey: valueText(factBinding.selector.categoryKey, `${label}.selector.categoryKey`) })
            : kind === 'table-cell'
              ? Object.freeze({ kind, rowKey: valueText(factBinding.selector.rowKey, `${label}.selector.rowKey`), columnKey: valueText(factBinding.selector.columnKey, `${label}.selector.columnKey`) })
              : Object.freeze({ kind })
          return Object.freeze({ factId, selector })
        })
        return Object.freeze({ objectId: recordId(binding.objectId, `${label}.visualBindings[${index}].objectId`), factBindings: Object.freeze(factBindings) })
      })
      unique(rows.map(row => row.objectId), `${label}.visual binding object ids`)
      return rows
    })()
    return Object.freeze({ slideId: recordId(entry.slideId, `${label}.slideId`), explanation: optionalText(entry.explanation, `${label}.explanation`) ?? metrics[0]?.facts[0]?.business.explanation ?? '', businessBlocks: Object.freeze(blocks), metrics: Object.freeze(metrics), visualBindings: Object.freeze(bindings) })
  })
  unique(slides.map(slide => slide.slideId), 'slide ids')
  return Object.freeze({ schemaVersion, reviewStatus: value.reviewStatus as PaimindTraceReviewStatus, sources, slides: Object.freeze(slides) })
}

function normalizeV1(value: UnknownRecord, sources: readonly PaimindTraceSourceRecord[]): PaimindPresentationTraceDocument {
  if (!Array.isArray(value.slides) || value.slides.length === 0) throw new Error('slides must be a non-empty array')
  const projected: UnknownRecord = {
    schemaVersion: TRACE_SCHEMA_V2,
    reviewStatus: value.reviewStatus,
    sources,
    slides: value.slides.map((slide, slideIndex) => {
      if (!isRecord(slide) || !Array.isArray(slide.metrics) || slide.metrics.length === 0) throw new Error(`slides[${slideIndex}] is invalid`)
      const explanation = valueText(slide.explanation, `slides[${slideIndex}].explanation`)
      if (!isRecord(slide.scope)) throw new Error(`slides[${slideIndex}].scope must be an object`)
      return {
        slideId: slide.slideId,
        explanation,
        metrics: slide.metrics.map((fact, factIndex) => {
          if (!isRecord(fact)) throw new Error(`slides[${slideIndex}].metrics[${factIndex}] must be an object`)
          return {
            metricId: fact.factId,
            label: fact.label,
            facts: [{ ...fact, dimensions: [], business: { explanation, scope: slide.scope } }],
          }
        }),
        visualBindings: [],
      }
    }),
  }
  return normalizeV2(projected, sources)
}

export function normalizePresentationTrace(value: unknown): PaimindPresentationTraceDocument {
  if (!isRecord(value)) throw new Error('trace document must be an object')
  if (value.reviewStatus !== 'generated' && value.reviewStatus !== 'reviewed' && value.reviewStatus !== 'verified') throw new Error('reviewStatus is invalid')
  const sources = normalizeSources(value.sources)
  if (value.schemaVersion === TRACE_SCHEMA_V1) return normalizeV1(value, sources)
  if (value.schemaVersion === TRACE_SCHEMA_V2) return normalizeV2(value, sources)
  if (value.schemaVersion === TRACE_SCHEMA_V3) return normalizeV2(value, sources, TRACE_SCHEMA_V3)
  throw new Error('schemaVersion is not supported')
}

const EMPTY: PaimindPresentationTraceSnapshot = Object.freeze({ revision: 0, traces: Object.freeze([]), diagnostics: Object.freeze([]), selection: null })
interface SourceEntry { readonly source: PaimindPresentationTraceSource; readonly off: () => void }

export class PresentationTraceRegistry implements PaimindPresentationTraceService {
  private snapshot: PaimindPresentationTraceSnapshot = EMPTY
  private readonly sources = new Map<string, SourceEntry[]>()
  private readonly listeners = new Set<() => void>()
  private disposed = false
  getSnapshot(): PaimindPresentationTraceSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  registerSource(source: PaimindPresentationTraceSource): () => void {
    if (this.disposed) return () => {}
    if (!idPattern.test(source.id)) throw new Error(`invalid trace source id "${source.id}"`)
    const entry: SourceEntry = { source, off: source.subscribe(() => { this.publish() }) }
    const stack = this.sources.get(source.id) ?? []
    stack.push(entry); this.sources.set(source.id, stack); this.publish()
    let disposed = false
    return () => { if (disposed) return; disposed = true; entry.off(); const current = this.sources.get(source.id); if (current === undefined) return; const index = current.lastIndexOf(entry); if (index >= 0) current.splice(index, 1); if (current.length === 0) this.sources.delete(source.id); this.publish() }
  }
  selectArtifact(artifact: PaimindArtifactView): boolean {
    if (this.disposed || artifact.traceId === undefined || !this.snapshot.traces.some(trace => trace.traceId === artifact.traceId)) return false
    this.snapshot = Object.freeze({ ...this.snapshot, revision: this.snapshot.revision + 1, selection: Object.freeze({ traceId: artifact.traceId, artifactSourceId: artifact.sourceId, artifactId: artifact.id, sessionId: artifact.sessionId, workspaceId: artifact.workspaceId, path: artifact.path, title: artifact.title }) })
    this.emit(); return true
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; for (const stack of this.sources.values()) for (const entry of stack) entry.off(); this.sources.clear(); this.listeners.clear(); this.snapshot = EMPTY }
  private emit(): void { for (const listener of [...this.listeners]) listener() }
  private publish(): void {
    if (this.disposed) return
    const traces: PaimindPresentationTraceView[] = []
    const diagnostics: PaimindPresentationTraceDiagnostic[] = []
    const traceIds = new Set<string>()
    for (const [sourceId, stack] of this.sources) {
      const source = stack.at(-1)?.source
      if (source === undefined) continue
      try {
        const records = source.getSnapshot().traces
        if (!Array.isArray(records)) throw new Error('source snapshot does not contain a trace array')
        for (const record of records) {
          try {
            const id = recordId(record.id, 'trace record id')
            const traceId = recordId(record.traceId, 'trace id')
            if (traceIds.has(traceId)) throw new Error(`duplicate trace id ${traceId}`)
            traceIds.add(traceId)
            traces.push(Object.freeze({ id, traceId, sourceId, document: normalizePresentationTrace(record.document) }))
          } catch (error) { diagnostics.push(Object.freeze({ sourceId, recordId: typeof record?.id === 'string' ? record.id : undefined, message: error instanceof Error ? error.message : String(error) })) }
        }
      } catch (error) { diagnostics.push(Object.freeze({ sourceId, message: error instanceof Error ? error.message : String(error) })) }
    }
    const selection = this.snapshot.selection !== null && traces.some(trace => trace.traceId === this.snapshot.selection?.traceId) ? this.snapshot.selection : null
    this.snapshot = Object.freeze({ revision: this.snapshot.revision + 1, traces: Object.freeze(traces), diagnostics: Object.freeze(diagnostics), selection })
    this.emit()
  }
}

export function selectedPresentationTrace(snapshot: PaimindPresentationTraceSnapshot): PaimindPresentationTraceView | null {
  return snapshot.selection === null ? null : snapshot.traces.find(trace => trace.traceId === snapshot.selection?.traceId) ?? null
}
