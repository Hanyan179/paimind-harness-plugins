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
  private snapshot: PaimindBentoPreviewSnapshot = { revision: 1, requestRevision: 1, request: { sessionId: 's1', workspaceId: 'w1', cwd: '/workspace', path: '/workspace/deck.html', title: 'Deck' }, runtimeEvent: null }
  private readonly listeners = new Set<() => void>()
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  open = () => true
  slide(value: number) { this.snapshot = { ...this.snapshot, revision: this.snapshot.revision + 1, runtimeEvent: { type: 'paimind:bento-slide', mode: 'edit', slide: value } }; for (const listener of this.listeners) listener() }
}

describe('FP08 presentation trace client', () => {
  it('drills from business evidence to technical trace and follows verified Bento slide facts', () => {
    const registry = new PresentationTraceRegistry()
    registry.registerSource({ id: 'producer', getSnapshot: () => ({ traces: [{ id: 'record', traceId: 'trace-1', document }] }), subscribe: () => () => {} })
    registry.selectArtifact(artifact)
    const bento = new BentoMock()
    render(<PresentationTracePanel service={registry} bento={bento} scope={scope} />)
    expect(screen.getByText('Management Deck')).toBeInTheDocument()
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.getByText('Registered sales conclusion')).toBeInTheDocument()
    expect(screen.getByText(/sales.csv · Sales facts/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View technical trace' }))
    expect(screen.getByText('Data Lineage')).toBeInTheDocument()
    expect(screen.getByText('Read the registered source')).toBeInTheDocument()
    expect(screen.getByText('build.mjs')).toBeInTheDocument()
    act(() => { bento.slide(2) })
    expect(screen.getByRole('button', { name: /Second conclusion/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Registered margin conclusion')).toBeInTheDocument()
    expect(screen.getByText('Not registered')).toBeInTheDocument()
  })
})
