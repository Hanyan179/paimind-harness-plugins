import { describe, expect, it } from 'vitest'
import { TRACE_SCHEMA_V2, normalizePresentationTrace } from '../src/index.ts'

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
  it('normalizes a truthful v2 document and supplies only the documented block fallback', () => {
    const result = normalizePresentationTrace(v2())
    expect(result.schemaVersion).toBe(TRACE_SCHEMA_V2)
    expect(result.slides[0]?.businessBlocks).toEqual([{ blockId: 'slide-overview', label: 'Slide overview', description: 'Registered facts for this slide.' }])
    expect(result.slides[0]?.metrics[0]?.facts[0]?.technical?.lineage?.[0]?.stepId).toBe('read')
    expect(Object.isFrozen(result)).toBe(true)
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
})
