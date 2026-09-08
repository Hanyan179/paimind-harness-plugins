import { describe, expect, it } from 'vitest'
import { TRACE_SCHEMA_V2, TRACE_SCHEMA_V3, normalizePresentationTrace } from '../src/index.ts'

const source = { id: 'sales', name: 'sales.csv', format: 'CSV', role: 'Sales facts' }
const fact = {
  factId: 'fact-1', displayValue: '$10', dimensions: [{ key: 'region', label: 'Region', value: 'East' }],
  measures: [{ key: 'sales', label: 'Sales', value: 10, displayValue: '$10' }],
  business: { explanation: 'Registered conclusion', scope: { period: 'FY2026', filters: ['status = complete'] } },
  sourceIds: ['sales'], factValuesChanged: false,
  technical: { calculation: 'SUM(sales)', lineage: [{ stepId: 'read', label: 'Read', operation: 'Read registered rows' }] },
}

function v2(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'paimind.presentation-trace/v2', reviewStatus: 'verified', sources: [source],
    slides: [{ slideId: 'slide-1', explanation: 'Slide conclusion', metrics: [{ metricId: 'metric-1', label: 'Sales', facts: [fact] }], visualBindings: [{ objectId: 'shape-1', factBindings: [{ factId: 'fact-1', selector: { kind: 'object' } }] }] }],
    ...overrides,
  }
}

describe('FP08 presentation trace contract', () => {
  it('accepts a narrative slide with no metrics while rejecting dangling data bindings', () => {
    const narrative = { slideId: 'section-1', explanation: 'Next chapter', businessBlocks: [{ blockId: 'chapter', label: 'Chapter', description: 'Introduction' }], metrics: [], visualBindings: [] }
    const result = normalizePresentationTrace(v2({ schemaVersion: TRACE_SCHEMA_V3, slides: [narrative] }))
    expect(result.slides[0]?.metrics).toEqual([])
    expect(result.slides[0]?.visualBindings).toEqual([])
    expect(() => normalizePresentationTrace(v2({ schemaVersion: TRACE_SCHEMA_V3, slides: [{ ...narrative, visualBindings: [{ objectId: 'shape', factBindings: [{ factId: 'missing', selector: { kind: 'object' } }] }] }] }))).toThrow(/unknown fact missing/)
  })

  it('normalizes a truthful v2 document and supplies only the documented block fallback', () => {
    const result = normalizePresentationTrace(v2())
    expect(result.schemaVersion).toBe(TRACE_SCHEMA_V2)
    expect(result.slides[0]?.businessBlocks).toEqual([{ blockId: 'slide-overview', label: 'Slide overview', description: 'Registered facts for this slide.' }])
    expect(result.slides[0]?.metrics[0]?.facts[0]?.technical?.lineage?.[0]?.stepId).toBe('read')
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('preserves source field paths as dimension and measure keys', () => {
    const fieldPath = 'Sales_data + Date_data › [Fiscal Year, Sales Amount]'
    const result = normalizePresentationTrace(v2({
      slides: [{
        slideId: 'slide-1', explanation: 'Slide conclusion',
        metrics: [{
          metricId: 'metric-1', label: 'Sales',
          visualization: { kind: 'cartesian', mark: 'bar', encodings: [{ channel: 'value', source: 'measure', fieldKey: fieldPath, label: 'Sales source field' }] },
          facts: [{ ...fact, dimensions: [{ key: 'Date_data › [Fiscal Year]', label: 'Fiscal year', value: 'FY2020' }], measures: [{ key: fieldPath, label: 'Sales', value: 10, displayValue: '$10' }] }],
        }],
        visualBindings: [{ objectId: 'shape-1', factBindings: [{ factId: 'fact-1', selector: { kind: 'object' } }] }],
      }],
    }))
    expect(result.slides[0]?.metrics[0]?.facts[0]?.measures[0]?.key).toBe(fieldPath)
  })

  it('normalizes legacy v1 facts to v2 single-fact metric groups without inventing technical data', () => {
    const result = normalizePresentationTrace({
      schemaVersion: 'paimind.presentation-trace/v1', reviewStatus: 'generated', sources: [source],
      slides: [{ slideId: 'legacy-slide', explanation: 'Legacy conclusion', scope: { period: 'FY2025', filters: ['complete'] }, metrics: [{ factId: 'legacy-fact', label: 'Orders', displayValue: '42', sourceIds: ['sales'], factValuesChanged: false }] }],
    })
    const projected = result.slides[0]?.metrics[0]
    expect(projected).toMatchObject({ metricId: 'legacy-fact', label: 'Orders', businessBlockId: 'slide-overview' })
    expect(projected?.facts[0]?.business.explanation).toBe('Legacy conclusion')
    expect(projected?.facts[0]?.technical).toBeUndefined()
  })

  it('rejects changed facts, unknown sources, invalid encodings and unknown visual bindings', () => {
    expect(() => normalizePresentationTrace(v2({ slides: [{ slideId: 's', metrics: [{ metricId: 'm', label: 'M', facts: [{ ...fact, factValuesChanged: true }] }] }] }))).toThrow(/factValuesChanged must be false/)
    expect(() => normalizePresentationTrace(v2({ slides: [{ slideId: 's', metrics: [{ metricId: 'm', label: 'M', facts: [{ ...fact, sourceIds: ['missing'] }] }] }] }))).toThrow(/unknown source missing/)
    expect(() => normalizePresentationTrace(v2({ slides: [{ slideId: 's', metrics: [{ metricId: 'm', label: 'M', visualization: { kind: 'cartesian', mark: 'bar', encodings: [{ channel: 'x', source: 'dimension', fieldKey: 'missing', label: 'Missing' }] }, facts: [fact] }] }] }))).toThrow(/missing dimension missing/)
    expect(() => normalizePresentationTrace(v2({ slides: [{ slideId: 's', metrics: [{ metricId: 'm', label: 'M', facts: [fact] }], visualBindings: [{ objectId: 'shape', factBindings: [{ factId: 'missing', selector: { kind: 'object' } }] }] }] }))).toThrow(/unknown fact missing/)
  })

  it('normalizes v3 sidecar documents without downgrading their schema identity', () => {
    const result = normalizePresentationTrace(v2({ schemaVersion: 'paimind.presentation-trace/v3', sources: [{ ...source, path: 'inputs/sales.csv', sha256: 'a'.repeat(64), period: 'FY2026', summary: 'Frozen actuals' }] }))
    expect(result.schemaVersion).toBe(TRACE_SCHEMA_V3)
    expect(result.sources[0]).toMatchObject({ path: 'inputs/sales.csv', period: 'FY2026' })
  })

  it('accepts an explicit empty join key list when the calculation has no join', () => {
    const result = normalizePresentationTrace(v2({
      schemaVersion: 'paimind.presentation-trace/v3',
      slides: [{
        slideId: 'slide-1', explanation: 'Slide conclusion',
        metrics: [{ metricId: 'metric-1', label: 'Sales', facts: [{ ...fact, technical: { ...fact.technical, joinKeys: [] } }] }],
        visualBindings: [{ objectId: 'shape-1', factBindings: [{ factId: 'fact-1', selector: { kind: 'object' } }] }],
      }],
    }))
    expect(result.slides[0]?.metrics[0]?.facts[0]?.technical?.joinKeys).toEqual([])
  })
})
