import { describe, expect, it } from 'vitest'
import type { PaimindArtifactView } from '@hansen/artifacts'
import { PresentationTraceRegistry, type PaimindPresentationTraceSource } from '../src/index.ts'

const document = {
  schemaVersion: 'paimind.presentation-trace/v2', reviewStatus: 'reviewed',
  sources: [{ id: 'source', name: 'source.csv', format: 'CSV', role: 'Facts' }],
  slides: [{ slideId: 'slide', metrics: [{ metricId: 'metric', label: 'Metric', facts: [{ factId: 'fact', displayValue: '1', dimensions: [], business: { explanation: 'Conclusion', scope: { period: 'Now', filters: ['all'] } }, sourceIds: ['source'], factValuesChanged: false }] }] }],
}

function source(id: string, traces: readonly { id: string; traceId: string; document: unknown }[]): PaimindPresentationTraceSource {
  return { id, getSnapshot: () => ({ traces }), subscribe: () => () => {} }
}

const artifact = (traceId?: string): PaimindArtifactView => ({
  sourceId: 'artifacts', id: 'deck', origin: 'paimind-product', kind: 'html', previewKind: 'bento-deck', state: 'available', title: 'Deck', path: 'deck.html', sessionId: 's1', workspaceId: 'w1', updatedAt: 1,
  ...(traceId === undefined ? {} : { traceId }),
})

describe('FP08 presentation trace registry', () => {
  it('selects only an exact explicit Artifact trace id and clears it when the source disappears', () => {
    const registry = new PresentationTraceRegistry()
    const off = registry.registerSource(source('producer', [{ id: 'record', traceId: 'trace-1', document }]))
    expect(registry.selectArtifact(artifact())).toBe(false)
    expect(registry.selectArtifact(artifact('trace-missing'))).toBe(false)
    expect(registry.selectArtifact(artifact('trace-1'))).toBe(true)
    expect(registry.getSnapshot().selection).toMatchObject({ traceId: 'trace-1', artifactId: 'deck', sessionId: 's1' })
    off()
    expect(registry.getSnapshot().selection).toBeNull()
  })

  it('isolates invalid records and duplicate trace ids as diagnostics', () => {
    const registry = new PresentationTraceRegistry()
    registry.registerSource(source('first', [{ id: 'valid', traceId: 'trace-1', document }]))
    registry.registerSource(source('second', [
      { id: 'duplicate', traceId: 'trace-1', document },
      { id: 'invalid', traceId: 'trace-2', document: { ...document, reviewStatus: 'invented' } },
    ]))
    expect(registry.getSnapshot().traces).toHaveLength(1)
    expect(registry.getSnapshot().diagnostics.map(row => row.message).join(' ')).toMatch(/duplicate trace id trace-1/)
    expect(registry.getSnapshot().diagnostics.map(row => row.message).join(' ')).toMatch(/reviewStatus is invalid/)
  })
})
