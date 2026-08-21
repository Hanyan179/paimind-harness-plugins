import { describe, expect, it } from 'vitest'
import { defineAnalysisDataResult, definePresentationFactSet, definePresentationOutline, traceFromPresentationOutline, validatePresentationTraceability } from '../src/index.js'

const hash = 'a'.repeat(64)
const outline = {
  schema: 'paimind.presentation-outline/v1', title: 'Buyer proposal',
  design: { schema: 'paimind.presentation-design/v1', templateId: 'generic-dark', stylePreset: 'data-intelligence', aspectRatio: '16:9', canvas: { width: 1280, height: 720 }, density: 'balanced' },
  sources: [{ sourceId: 'snapshot', name: 'Frozen snapshot', path: 'inputs/snapshot.json', sha256: hash, format: 'json', role: 'historical actuals', period: 'FY2025', summary: 'Redacted real history' }],
  facts: [{ factId: 'sales', sourceIds: ['snapshot'], rawValue: 120, displayValue: '$120M', valueType: 'source_value', fieldPath: '$.sales', method: 'Read from frozen snapshot', definition: 'Net sales', period: 'FY2025', filters: [], factValuesChanged: false }],
  slides: [{ slideId: 'slide-1', layout: 'kpi', title: 'Growth', narrative: 'The category grew.', elements: [{ objectId: 'sales-kpi', type: 'kpi', displayValue: '$120M', factIds: ['sales'], bindings: [{ factId: 'sales', selector: { kind: 'object' } }] }] }],
}

describe('presentation contracts', () => {
  it('validates a complete object to Fact to Source chain', () => {
    expect(definePresentationOutline(outline)).toMatchObject({ design: { templateId: 'generic-dark', stylePreset: 'data-intelligence', aspectRatio: '16:9', canvas: { width: 1280, height: 720 } }, slides: [{ elements: [{ objectId: 'sales-kpi' }] }] })
    expect(traceFromPresentationOutline(outline).schemaVersion).toBe('paimind.presentation-trace/v3')
    expect(validatePresentationTraceability(outline)).toMatchObject({ valid: true, requiredBindings: 1, resolvedBindings: 1, resolutionRate: 1, factValuesChanged: false })
  })

  it('defaults legacy outlines but rejects unsupported HTML presentation specifications', () => {
    const { design: _design, ...legacy } = outline
    expect(definePresentationOutline(legacy).design).toMatchObject({ templateId: 'generic-dark', stylePreset: 'startup-pitch', aspectRatio: '16:9' })
    expect(() => definePresentationOutline({ ...outline, design: { ...outline.design, aspectRatio: '4:3' } })).toThrow(/aspectRatio must be 16:9/)
    expect(() => definePresentationOutline({ ...outline, design: { ...outline.design, templateId: 'generic-dark', stylePreset: 'wmt-retail' } })).toThrow(/wmt-retail requires/)
    expect(definePresentationOutline({ ...outline, design: { ...outline.design, templateId: 'strategy-grid', stylePreset: 'strategy-consulting' } }).design).toMatchObject({ templateId: 'strategy-grid', stylePreset: 'strategy-consulting' })
    expect(() => definePresentationOutline({ ...outline, design: { ...outline.design, templateId: 'generic-dark', stylePreset: 'playful-storybook' } })).toThrow(/playful-storybook requires/)
  })

  it('validates analysis and immutable Fact Set contracts plus the Outline truth-boundary reference', () => {
    const dataResult = defineAnalysisDataResult({ schema: 'paimind.data-result/v2', analysisKind: 'category-performance', sourceManifest: 'inputs/manifest.json', sourceManifestSha256: hash, sources: outline.sources, facts: outline.facts, payloadSha256: hash, payload: { synthetic: true } })
    expect(dataResult.analysisKind).toBe('category-performance')
    const factSet = definePresentationFactSet({ schema: 'paimind.fact-set/v1', analysisArtifactIds: ['artifact:analysis'], sources: dataResult.sources, facts: dataResult.facts, factsSha256: hash })
    expect(factSet.facts).toHaveLength(1)
    const bound = definePresentationOutline({ ...outline, factSetArtifactId: 'artifact:fact-set', factSetFactsSha256: hash })
    expect(traceFromPresentationOutline(bound)).toMatchObject({ factSetArtifactId: 'artifact:fact-set', factSetFactsSha256: hash })
    expect(() => definePresentationOutline({ ...outline, factSetArtifactId: 'artifact:fact-set' })).toThrow(/provided together/)
  })

  it('rejects duplicate ids, orphan facts, missing sources and illegal selectors', () => {
    expect(() => definePresentationOutline({ ...outline, sources: [...outline.sources, outline.sources[0]] })).toThrow(/duplicate/)
    expect(() => definePresentationOutline({ ...outline, facts: [{ ...outline.facts[0], sourceIds: ['missing'] }] })).toThrow(/unknown source/)
    expect(() => definePresentationOutline({ ...outline, slides: [{ ...outline.slides[0], elements: [{ ...outline.slides[0].elements[0], bindings: [{ factId: 'sales', selector: { kind: 'chart-point', seriesKey: '', categoryKey: 'x' } }] }] }] })).toThrow(/seriesKey/)
  })

  it('reports exact slide and element paths for missing visual selectors', () => {
    const chartElement = { ...outline.slides[0].elements[0], type: 'chart', chart: { kind: 'horizontal-bar', points: [{ seriesKey: 'sales', categoryKey: 'all', label: 'Sales', value: 120, displayValue: '$120M', factId: 'sales' }] } }
    expect(() => definePresentationOutline({ ...outline, slides: [{ ...outline.slides[0], elements: [chartElement] }] })).toThrow(/outline\.slides\[0\]\.elements\[0\]\.chart\.points\[0\].*chart-point Selector/)

    const tableElement = { ...outline.slides[0].elements[0], type: 'table', table: { columns: [{ columnKey: 'value', label: 'Value' }], rows: [{ rowKey: 'sales', label: 'Sales', cells: [{ columnKey: 'value', displayValue: '$120M', factId: 'sales' }] }] } }
    expect(() => definePresentationOutline({ ...outline, slides: [{ ...outline.slides[0], elements: [tableElement] }] })).toThrow(/outline\.slides\[0\]\.elements\[0\]\.table\.rows\[0\]\.cells\[0\].*table-cell Selector/)
  })

  it('preserves prototype-grade business blocks, multidimensional metrics and technical lineage', () => {
    const candidate = {
      ...outline,
      facts: [{
        ...outline.facts[0], businessExplanation: 'Sales establishes the size of the decision.',
        dimensions: [{ key: 'fineline', label: 'Fineline', value: 'Kids Paint' }],
        measures: [{ key: 'sales', label: 'Sales', value: 120, displayValue: '$120M' }],
        technical: { calculation: 'SUM(net_sales)', aggregation: 'sum', sourceFields: ['net_sales'], joinKeys: ['sku_id'], lineage: [{ stepId: 'read-sales', label: 'Read sales', operation: 'Read the frozen snapshot field.' }], codeFile: 'runtime/analyze.py', executionDurationMs: 42 },
      }],
      slides: [{
        ...outline.slides[0],
        trace: {
          businessBlocks: [{ blockId: 'category-performance', label: 'Category performance', description: 'Scale and momentum.' }],
          metrics: [{ metricId: 'sales-by-fineline', label: 'Sales by fineline', businessBlockId: 'category-performance', factIds: ['sales'], visualization: { kind: 'cartesian', mark: 'bar', encodings: [{ channel: 'x', source: 'dimension', fieldKey: 'fineline', label: 'Fineline' }, { channel: 'y', source: 'measure', fieldKey: 'sales', label: 'Sales' }] } }],
        },
      }],
    }
    const trace = traceFromPresentationOutline(candidate)
    expect(trace.slides[0]).toMatchObject({ businessBlocks: [{ blockId: 'category-performance' }], metrics: [{ metricId: 'sales-by-fineline', visualization: { kind: 'cartesian', mark: 'bar' }, facts: [{ dimensions: [{ key: 'fineline' }], measures: [{ key: 'sales' }], technical: { aggregation: 'sum', codeFile: 'runtime/analyze.py', lineage: [{ stepId: 'read-sales' }] } }] }] })
  })

  it('supports 40-plus-page proposals without allowing unbounded decks', () => {
    const slides = Array.from({ length: 41 }, (_, index) => ({ ...outline.slides[0], slideId: `slide-${index + 1}`, elements: [{ ...outline.slides[0].elements[0], objectId: `sales-kpi-${index + 1}` }] }))
    expect(definePresentationOutline({ ...outline, slides }).slides).toHaveLength(41)
    expect(() => definePresentationOutline({ ...outline, slides: [...slides, ...slides.map((slide, index) => ({ ...slide, slideId: `slide-copy-${index + 1}`, elements: [{ ...slide.elements[0], objectId: `sales-kpi-copy-${index + 1}` }] }))] })).toThrow(/1-80 slides/)
  })
})
