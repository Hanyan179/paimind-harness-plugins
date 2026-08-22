import { fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createClientContextFixture } from '@paimind/testkit'
import type { PaimindSidebarService } from '@paimind/better-sidebar-adapter'
import type { PaimindSidebarTabScope } from '@paimind/better-sidebar-adapter'
import { apply, BentoPreviewPanel, BentoPreviewStore, normalizeBentoRuntimeMessage } from '../src/client/index.tsx'

const sidebar = (): PaimindSidebarService => ({
  getStatus: () => ({ state: 'active', provider: 'dsh-better-sidebar', providerVersion: '0.14.0', contractVersion: 4, error: null }),
  subscribe: () => () => {}, registerTab: () => () => {}, openTab: vi.fn(() => true), closeTab: vi.fn(() => true),
  getFileCapability: () => ({ state: 'available', viewerId: 'html' }),
  openFile: () => ({ state: 'opened', viewerId: 'html' }), dispose: () => {},
})

describe('FP07 Bento preview client store', () => {
  it('registers the workbench as a hidden on-demand tab', () => {
    const fixture = createClientContextFixture()
    const registerTab = vi.fn(() => () => {})
    apply(Object.assign(fixture.context, { paimindSidebar: { ...sidebar(), registerTab } }) as never)
    expect(registerTab).toHaveBeenCalledWith(expect.objectContaining({
      id: 'paimind:bento-preview', hidden: true, single: true,
    }))
    expect(document.getElementById('@paimind/renderer-bento')?.textContent).toContain("@container paimind-bento (max-width:900px){[data-paimind-bento-workbench][data-mode='trace']{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(280px,58%) minmax(0,42%)")
    expect(fixture.services.has('paimindBentoPreview')).toBe(true)
    fixture.disposeEffects()
    expect(fixture.services.has('paimindBentoPreview')).toBe(false)
  })

  it('uses icon-only mode buttons with accessible hover labels and a discoverable edit state', () => {
    const store = new BentoPreviewStore(sidebar())
    store.open({ sessionId: 's1', workspaceId: 'w1', cwd: '/workspace', path: '/workspace/deck.html', title: 'Deck' })
    store.registerInspector({ id: 'trace', render: () => null })
    const scope: PaimindSidebarTabScope = { sessionId: 's1', workspaceId: 'w1', cwd: '/workspace', visible: true, locale: { getLocale: () => ({ active: 'en' }), subscribe: () => () => {} } }
    render(createElement(BentoPreviewPanel, { store, scope }))
    const edit = screen.getByRole('button', { name: 'Edit' })
    const panel = screen.getByRole('region', { name: 'Isolated Bento preview' })
    const header = panel.querySelector('[data-paimind-bento-header]')
    const toolbar = panel.querySelector('[data-paimind-bento-toolbar]')
    expect(header?.nextElementSibling).toBe(toolbar)
    expect(header).not.toContainElement(edit)
    expect(toolbar).toContainElement(edit)
    expect(edit).toHaveTextContent('')
    expect(screen.getByRole('tooltip', { name: 'Edit' })).toBeInTheDocument()
    fireEvent.click(edit)
    expect(edit).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('facts and derived metrics are locked')
  })

  it('publishes one immutable request and opens only its independent Side Card tab', () => {
    const provider = sidebar()
    const store = new BentoPreviewStore(provider)
    const listener = vi.fn()
    store.subscribe(listener)
    expect(store.open({ sessionId: 's1', workspaceId: 'w1', cwd: '/workspace', path: '/workspace/deck.html', title: 'Deck' })).toBe(true)
    expect(provider.openTab).toHaveBeenCalledWith('paimind:bento-preview', { title: 'Deck' })
    expect(store.getSnapshot()).toMatchObject({ revision: 1, requestRevision: 1, request: { path: '/workspace/deck.html' }, runtimeEvent: null })
    expect(Object.isFrozen(store.getSnapshot().request)).toBe(true)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('publishes renderer-neutral slide navigation without inventing an object focus', () => {
    const store = new BentoPreviewStore(sidebar())
    store.open({ sessionId: 's1', workspaceId: 'w1', cwd: '/workspace', path: '/workspace/deck.html', title: 'Deck' })
    expect(store.navigate({ slideId: 'slide-2', slide: 2 })).toBe(true)
    expect(store.getSnapshot()).toMatchObject({ slideTargetRevision: 1, slideTarget: { slideId: 'slide-2', slide: 2 }, focus: null })
    expect(Object.isFrozen(store.getSnapshot().slideTarget)).toBe(true)
    expect(store.navigate({ slideId: '', slide: 0 })).toBe(false)
  })

  it('rejects incomplete requests without touching the provider', () => {
    const provider = sidebar()
    const store = new BentoPreviewStore(provider)
    expect(store.open({ sessionId: '', workspaceId: 'w1', cwd: '/workspace', path: '/workspace/deck.html', title: 'Deck' })).toBe(false)
    expect(provider.openTab).not.toHaveBeenCalled()
  })

  it('publishes only normalized allowlisted runtime facts without reloading the request', () => {
    const store = new BentoPreviewStore(sidebar())
    store.open({ sessionId: 's1', workspaceId: 'w1', cwd: '/workspace', path: '/workspace/deck.html', title: 'Deck' })
    const event = normalizeBentoRuntimeMessage({ type: 'paimind:bento-slide', mode: 'edit', slide: 3, privatePayload: 'ignored' })
    expect(event).toEqual({ type: 'paimind:bento-slide', mode: 'edit', slide: 3 })
    store.publishRuntimeEvent(event!)
    expect(store.getSnapshot()).toMatchObject({ revision: 2, requestRevision: 1, runtimeEvent: { slide: 3 } })
    expect(normalizeBentoRuntimeMessage({ type: 'other', mode: 'edit', slide: 3 })).toBeNull()
    expect(normalizeBentoRuntimeMessage({ type: 'paimind:bento-slide', mode: 'trace', slide: 3 })).toEqual({ type: 'paimind:bento-slide', mode: 'trace', slide: 3 })
    expect(normalizeBentoRuntimeMessage({ type: 'paimind:bento-slide', mode: 'edit', slide: 0 })).toBeNull()
  })

  it('normalizes object selectors and coordinates workbench mode plus reverse focus', () => {
    const store = new BentoPreviewStore(sidebar())
    store.open({ sessionId: 's1', workspaceId: 'w1', cwd: '/workspace', path: '/workspace/deck.html', title: 'Deck', artifactSourceId: 'source', artifactId: 'deck', traceId: 'trace-1' })
    const activate = vi.fn(() => true)
    const off = store.registerInspector({ id: 'trace', activate, render: () => null })
    expect(store.setMode('trace')).toBe(true)
    expect(activate).toHaveBeenCalledWith(expect.objectContaining({ artifactId: 'deck', traceId: 'trace-1' }))
    expect(store.focus({ slideId: 'slide-1', objectId: 'chart-1', selector: { kind: 'chart-point', seriesKey: 'sales', categoryKey: 'east' } })).toBe(true)
    expect(store.getSnapshot()).toMatchObject({ mode: 'trace', focusRevision: 1, focus: { objectId: 'chart-1' } })
    expect(normalizeBentoRuntimeMessage({ type: 'paimind:bento-select', mode: 'trace', slide: 1, slideId: 'slide-1', objectId: 'chart-1', factId: 'sales-east', selector: { kind: 'chart-point', seriesKey: 'sales', categoryKey: 'east' }, privatePayload: 'ignored' })).toEqual({ type: 'paimind:bento-select', mode: 'trace', slide: 1, slideId: 'slide-1', objectId: 'chart-1', factId: 'sales-east', selector: { kind: 'chart-point', seriesKey: 'sales', categoryKey: 'east' } })
    expect(normalizeBentoRuntimeMessage({ type: 'paimind:bento-select', mode: 'trace', slide: 1, slideId: 'slide-1', objectId: 'chart-1', factId: 'sales-east', selector: { kind: 'unknown' } })).toBeNull()
    off(); expect(store.getSnapshot().mode).toBe('preview')
  })

  it('fails trace mode closed when the inspector cannot select the exact Sidecar', () => {
    const store = new BentoPreviewStore(sidebar())
    store.open({ sessionId: 's1', workspaceId: 'w1', cwd: '/workspace', path: '/workspace/deck.html', title: 'Deck', artifactSourceId: 'source', artifactId: 'deck', traceId: 'missing' })
    store.registerInspector({ id: 'trace', activate: () => false, render: () => null })
    expect(store.setMode('trace')).toBe(false)
    expect(store.getSnapshot().mode).toBe('preview')
  })
})
