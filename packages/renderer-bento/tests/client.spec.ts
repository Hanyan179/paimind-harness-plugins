import { describe, expect, it, vi } from 'vitest'
import type { PaimindSidebarService } from '@paimind/better-sidebar-adapter'
import { BentoPreviewStore, normalizeBentoRuntimeMessage } from '../src/client/index.tsx'

const sidebar = (): PaimindSidebarService => ({
  getStatus: () => ({ state: 'active', provider: 'dsh-better-sidebar', providerVersion: '0.12.2', contractVersion: 3, error: null }),
  subscribe: () => () => {}, registerTab: () => () => {}, openTab: vi.fn(() => true),
  getFileCapability: () => ({ state: 'available', viewerId: 'html' }),
  openFile: () => ({ state: 'opened', viewerId: 'html' }), dispose: () => {},
})

describe('FP07 Bento preview client store', () => {
  it('publishes one immutable request and opens only its independent Side Card tab', () => {
    const provider = sidebar()
    const store = new BentoPreviewStore(provider)
    const listener = vi.fn()
    store.subscribe(listener)
    expect(store.open({ sessionId: 's1', workspaceId: 'w1', cwd: '/workspace', path: '/workspace/deck.html', title: 'Deck' })).toBe(true)
    expect(provider.openTab).toHaveBeenCalledWith('paimind:bento-preview')
    expect(store.getSnapshot()).toMatchObject({ revision: 1, requestRevision: 1, request: { path: '/workspace/deck.html' }, runtimeEvent: null })
    expect(Object.isFrozen(store.getSnapshot().request)).toBe(true)
    expect(listener).toHaveBeenCalledOnce()
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
    expect(normalizeBentoRuntimeMessage({ type: 'paimind:bento-slide', mode: 'trace', slide: 3 })).toBeNull()
    expect(normalizeBentoRuntimeMessage({ type: 'paimind:bento-slide', mode: 'edit', slide: 0 })).toBeNull()
  })
})
