import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PaimindArtifactView } from '@paimind/artifacts'
import type { PaimindLocaleSource } from '@paimind/harness-compat'
import type { PaimindSidebarTabScope } from '@paimind/better-sidebar-adapter'
import type { PaimindBentoPreviewService, PaimindBentoPreviewSnapshot } from '@paimind/renderer-bento'
import { PresentationTraceRegistry } from '../src/index.ts'
import { PresentationTracePanel } from '../src/client/index.tsx'

function locale(): PaimindLocaleSource { return { getLocale: () => ({ active: 'en' }), subscribe: () => () => {} } }
const scope: PaimindSidebarTabScope = { sessionId: 's1', workspaceId: 'w1', cwd: '/workspace', visible: true, locale: locale() }
const artifact: PaimindArtifactView = { sourceId: 'artifacts', id: 'deck', origin: 'paimind-product', kind: 'html', previewKind: 'bento-deck', state: 'available', title: 'Management Deck', path: '/workspace/deck.html', sessionId: 's1', workspaceId: 'w1', traceId: 'trace-1', updatedAt: 1 }
const document = {
  schemaVersion: 'paimind.presentation-trace/v2', reviewStatus: 'verified', sources: [{ id: 'sales', name: 'sales.csv', format: 'CSV', role: 'Sales facts' }],
  slides: [
    { slideId: 'slide-1', explanation: 'First conclusion', metrics: [{ metricId: 'sales', label: 'Sales', facts: [{ factId: 'sales-fact', displayValue: '$10', dimensions: [], business: { explanation: 'Registered sales conclusion', scope: { period: 'FY2026', filters: ['complete'] } }, sourceIds: ['sales'], factValuesChanged: false, technical: { calculation: 'SUM(sales)', lineage: [{ stepId: 'read', label: 'Read rows', operation: 'Read the registered source' }], codeFile: 'build.mjs', executionDurationMs: 42 } }] }] },
    { slideId: 'slide-2', explanation: 'Second conclusion', metrics: [{ metricId: 'margin', label: 'Margin', facts: [{ factId: 'margin-fact', displayValue: '41%', dimensions: [], business: { explanation: 'Registered margin conclusion', scope: { period: 'FY2026', filters: ['internet'] } }, sourceIds: ['sales'], factValuesChanged: false }] }] },
  ],
}

class BentoMock implements PaimindBentoPreviewService {
  private snapshot: PaimindBentoPreviewSnapshot = { revision: 1, requestRevision: 1, request: { sessionId: 's1', workspaceId: 'w1', cwd: '/workspace', path: '/workspace/deck.html', title: 'Deck' }, runtimeEvent: null, mode: 'trace', focusRevision: 0, focus: null, slideTargetRevision: 0, slideTarget: null, inspectorRevision: 0 }
  private readonly listeners = new Set<() => void>()
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  open = () => true
  setMode = () => true
  navigate = () => true
  focus = () => true
  registerInspector = () => () => {}
  getInspector = () => null
  slide(value: number) { this.snapshot = { ...this.snapshot, revision: this.snapshot.revision + 1, runtimeEvent: { type: 'paimind:bento-slide', mode: 'edit', slide: value } }; for (const listener of this.listeners) listener() }
}

describe('FP08 presentation trace client', () => {
  it('skips category selection for a single category while following Bento slide facts', () => {
    const registry = new PresentationTraceRegistry()
    registry.registerSource({ id: 'producer', getSnapshot: () => ({ traces: [{ id: 'record', traceId: 'trace-1', document }] }), subscribe: () => () => {} })
    registry.selectArtifact(artifact)
    const bento = new BentoMock()
    render(<PresentationTracePanel service={registry} bento={bento} scope={scope} />)
    expect(screen.queryByText('Management Deck')).not.toBeInTheDocument()
    expect(screen.queryByText('Evidence map for this deck')).not.toBeInTheDocument()
    expect(screen.queryByText('Evidence Categories')).not.toBeInTheDocument()
    expect(screen.getByText('Metrics & Facts')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to categories' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Business/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Technical/ })).toBeDisabled()
    expect(screen.queryByText('Registered sales conclusion')).not.toBeInTheDocument()
    expect(screen.queryByText('Second conclusion')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /\$10/ }))
    expect(screen.queryByText('What supports this result?')).not.toBeInTheDocument()
    expect(screen.getByText('Registered sales conclusion')).toBeInTheDocument()
    expect(screen.getByText(/sales.csv · Sales facts/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View technical trace' }))
    expect(screen.queryByText('How was this fact produced?')).not.toBeInTheDocument()
    expect(screen.getByText('Data Lineage')).toBeInTheDocument()
    expect(screen.getByText('Read the registered source')).toBeInTheDocument()
    expect(screen.getByText('build.mjs')).toBeInTheDocument()
    act(() => { bento.slide(2) })
    expect(screen.queryByText('Evidence Categories')).not.toBeInTheDocument()
    expect(screen.getByText('Metrics & Facts')).toBeInTheDocument()
    expect(screen.queryByText('First conclusion')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /41%/ }))
    expect(screen.getByText('Registered margin conclusion')).toBeInTheDocument()
    expect(screen.getByText('Not registered')).toBeInTheDocument()
  })

  it('shows a balanced priority subset before expanding a dense fact directory', () => {
    const denseDocument = structuredClone(document)
    denseDocument.slides[0]!.metrics[0]!.label = 'Metric'
    denseDocument.slides[0]!.metrics[0]!.facts = Array.from({ length: 6 }, (_, index) => ({
      factId: `fact-${index + 1}`,
      displayValue: `$${index + 1}`,
      dimensions: [
        { key: 'department', label: 'Department', value: index < 3 ? '102' : '410' },
        { key: 'category', label: 'Category', value: index < 3 ? 'Beauty Care' : 'Holiday Events' },
      ],
      business: { explanation: `Conclusion ${index + 1}`, scope: { period: 'FY2026', filters: [] } },
      sourceIds: ['sales'],
      factValuesChanged: false,
    }))
    const registry = new PresentationTraceRegistry()
    registry.registerSource({ id: 'producer', getSnapshot: () => ({ traces: [{ id: 'record', traceId: 'trace-1', document: denseDocument }] }), subscribe: () => () => {} })
    registry.selectArtifact(artifact)
    render(<PresentationTracePanel service={registry} bento={new BentoMock()} scope={scope} />)

    expect(screen.queryByText('Evidence Categories')).not.toBeInTheDocument()
    expect(screen.getByText('Metric')).toBeInTheDocument()
    expect(screen.getAllByText('102 · Beauty Care')).toHaveLength(3)
    expect(screen.getAllByText('410 · Holiday Events')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /\$3/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /\$5/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /\$6/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View all 6 facts' }))
    expect(screen.getByRole('button', { name: /\$5/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\$6/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show priority facts' }))
    expect(screen.queryByRole('button', { name: /\$5/ })).not.toBeInTheDocument()
  })

  it('shows a category directory only when the current slide has multiple categories', () => {
    const multiCategoryDocument = structuredClone(document)
    multiCategoryDocument.slides = [{
      slideId: 'slide-1',
      explanation: 'Portfolio conclusion',
      businessBlocks: [
        { blockId: 'performance', label: 'Category performance', description: 'Sales and margin evidence.' },
        { blockId: 'opportunity', label: 'Growth opportunity', description: 'Whitespace and distribution evidence.' },
      ],
      metrics: [
        { metricId: 'sales', businessBlockId: 'performance', label: 'Sales', facts: [{ factId: 'sales-fact', displayValue: '$10', dimensions: [], business: { explanation: 'Registered sales conclusion', scope: { period: 'FY2026', filters: [] } }, sourceIds: ['sales'], factValuesChanged: false }] },
        { metricId: 'distribution', businessBlockId: 'opportunity', label: 'Distribution', facts: [{ factId: 'distribution-fact', displayValue: '74%', dimensions: [], business: { explanation: 'Registered distribution conclusion', scope: { period: 'FY2026', filters: [] } }, sourceIds: ['sales'], factValuesChanged: false }] },
      ],
    }]
    const registry = new PresentationTraceRegistry()
    registry.registerSource({ id: 'producer', getSnapshot: () => ({ traces: [{ id: 'record', traceId: 'trace-1', document: multiCategoryDocument }] }), subscribe: () => () => {} })
    registry.selectArtifact(artifact)
    render(<PresentationTracePanel service={registry} bento={new BentoMock()} scope={scope} />)

    expect(screen.getByText('Evidence Categories')).toBeInTheDocument()
    expect(screen.queryByText('Metrics & Facts')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /\$10/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Category performance/ }))
    expect(screen.getByText('Metrics & Facts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to categories' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\$10/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /74%/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to categories' }))
    expect(screen.getByText('Evidence Categories')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Growth opportunity/ }))
    expect(screen.getByRole('button', { name: /74%/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /\$10/ })).not.toBeInTheDocument()
  })
})
