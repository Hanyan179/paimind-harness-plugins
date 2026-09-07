import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaimindLocaleSource } from '@paimind/harness-compat'
import type { PaimindWorkspaceProjectService, WorkspaceProjectSnapshot } from '@paimind/workspace-project'
import { createClientContextFixture } from '@paimind/testkit'
import {
  BetterSidebarAdapter,
  PAIMIND_SIDEBAR_CONTRACT_VERSION,
  VERIFIED_BETTER_SIDEBAR_VERSION,
  type ExternalBetterSidebarService,
  type ExternalSidebarFileViewerDescriptor,
  type ExternalSidebarFileViewerProps,
  type ExternalSidebarTabDescriptor,
  type PaimindSidebarTabDefinition,
} from '../src/index.ts'
import {
  apply,
  inject,
  installOfficeDomCleanupGuard,
  markOfficeLifecycleTree,
  stabilizeOfficeFileViewerScopes,
  type BetterSidebarAdapterClientContext,
} from '../src/client/index.ts'

function locale(initial = 'en'): PaimindLocaleSource & { set(value: string): void } {
  let active = initial
  const listeners = new Set<() => void>()
  return {
    getLocale: () => ({ active }),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(value) { active = value; for (const listener of listeners) listener() },
  }
}

function projects(): PaimindWorkspaceProjectService {
  const snapshot: WorkspaceProjectSnapshot = Object.freeze({
    state: 'ready', currentSessionId: 'session-1', error: null,
    currentProject: null,
    projects: Object.freeze([Object.freeze({
      workspaceId: 'workspace-1', title: 'Workspace', path: '/workspace',
      sessionIds: Object.freeze(['session-1']), visibleSessionCount: 1,
      archivedSessionCount: 0, totalSessionCount: 1,
      createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
    })]),
  })
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    startSession: vi.fn(),
    openWorkspace: vi.fn(async () => {}),
  }
}

function provider() {
  const descriptors = new Map<string, ExternalSidebarTabDescriptor>()
  const dispose = vi.fn()
  const registerTab = vi.fn((descriptor: ExternalSidebarTabDescriptor) => {
    descriptors.set(descriptor.id, descriptor)
    return () => { descriptors.delete(descriptor.id); dispose() }
  })
  const openTab = vi.fn()
  return {
    service: { registerTab, openTab } satisfies ExternalBetterSidebarService,
    descriptors, registerTab, openTab, dispose,
  }
}

function definition(label: string): PaimindSidebarTabDefinition {
  return {
    id: 'paimind:tasks', titleZh: `任务-${label}`, titleEn: `Tasks-${label}`,
    single: true, render: scope => `${label}:${scope.sessionId}:${scope.workspaceId}`,
  }
}

describe('FP05 Better Sidebar adapter', () => {
  it('exposes a versioned active boundary and maps only stable render scope', () => {
    expect(VERIFIED_BETTER_SIDEBAR_VERSION).toBe('0.17.1')
    const external = provider()
    const language = locale('en')
    const adapter = new BetterSidebarAdapter(external.service, language, projects())
    expect(adapter.getStatus()).toEqual({
      state: 'active', provider: 'dsh-better-sidebar', error: null,
      providerVersion: VERIFIED_BETTER_SIDEBAR_VERSION,
      contractVersion: PAIMIND_SIDEBAR_CONTRACT_VERSION,
    })
    const off = adapter.registerTab(definition('one'))
    expect(external.registerTab).toHaveBeenCalledTimes(1)
    const descriptor = external.descriptors.get('paimind:tasks')
    expect(typeof descriptor?.title === 'function' ? descriptor.title() : descriptor?.title).toBe('Tasks-one')
    language.set('zh')
    expect(typeof descriptor?.title === 'function' ? descriptor.title() : descriptor?.title).toBe('任务-one')
    expect(descriptor?.component({ scope: { sessionId: 'session-1', cwd: '/workspace' }, visible: true }))
      .toBe('one:session-1:workspace-1')
    expect(adapter.openTab('paimind:tasks', { title: 'Quarterly proposal' })).toBe(true)
    expect(external.openTab).toHaveBeenCalledWith({ type: 'paimind:tasks', title: 'Quarterly proposal' })
    expect(adapter.openTab('paimind:tasks', { title: 'Quarterly proposal', path: '/workspace/proposal.bento.html' })).toBe(true)
    expect(external.openTab).toHaveBeenLastCalledWith({ type: 'paimind:tasks', title: 'Quarterly proposal', path: '/workspace/proposal.bento.html' })
    off()
    expect(external.dispose).toHaveBeenCalledTimes(1)
  })

  it('refreshes a reused owned workbench title without changing another tab', () => {
    const updateTab = vi.fn()
    const adapter = new BetterSidebarAdapter({
      registerTab: () => () => {}, openTab: vi.fn(), updateTab,
      getSnapshot: () => ({ state: {
        splits: { kind: 'leaf', tabs: [
          { id: 'owned-instance', type: 'paimind:tasks', title: 'Old title', path: '/workspace/old.html' },
          { id: 'other-instance', type: 'editor', title: 'Keep this title', path: '/workspace/other.md' },
        ] }, bottomSplits: { kind: 'leaf', tabs: [] }, floats: [],
      } }),
    }, locale(), projects())
    adapter.registerTab(definition('one'))
    expect(adapter.openTab('paimind:tasks', { title: 'Updated proposal', path: '/workspace/new.html' })).toBe(true)
    expect(updateTab).toHaveBeenCalledExactlyOnceWith('owned-instance', { title: 'Updated proposal', path: '/workspace/new.html' })
  })

  it('maps hidden on-demand tabs without exposing provider details', () => {
    const external = provider()
    const adapter = new BetterSidebarAdapter(external.service, locale(), projects())
    adapter.registerTab({ ...definition('hidden'), hidden: true })
    expect(external.descriptors.get('paimind:tasks')).toMatchObject({ hidden: true, single: true })
  })

  it('closes an exact retired PAIMind tab through the provider boundary', () => {
    const closeTab = vi.fn()
    const adapter = new BetterSidebarAdapter({
      registerTab: () => () => {}, openTab: vi.fn(), closeTab,
    }, locale(), projects())
    expect(adapter.closeTab('paimind:artifacts')).toBe(true)
    expect(closeTab).toHaveBeenCalledWith('paimind:artifacts')
  })

  it('keeps one provider descriptor while HMR definitions stack and restore', () => {
    const external = provider()
    const adapter = new BetterSidebarAdapter(external.service, locale(), projects())
    const offOne = adapter.registerTab(definition('one'))
    const offTwo = adapter.registerTab(definition('two'))
    expect(external.registerTab).toHaveBeenCalledTimes(1)
    const descriptor = external.descriptors.get('paimind:tasks')
    expect(descriptor?.component({ scope: { sessionId: 'session-1' }, visible: true })).toBe('two:session-1:workspace-1')
    offTwo()
    expect(descriptor?.component({ scope: { sessionId: 'session-1' }, visible: true })).toBe('one:session-1:workspace-1')
    expect(external.dispose).not.toHaveBeenCalled()
    offOne()
    expect(external.dispose).toHaveBeenCalledTimes(1)
  })

  it('honours the provider public enablement gate without opening a disabled PAIMind tab', () => {
    const openTab = vi.fn()
    const adapter = new BetterSidebarAdapter({
      registerTab: () => () => {}, openTab, isTabEnabled: () => false,
    }, locale(), projects())
    adapter.registerTab(definition('disabled'))
    expect(adapter.openTab('paimind:tasks')).toBe(false)
    expect(openTab).not.toHaveBeenCalled()
    expect(adapter.getStatus().state).toBe('active')
  })

  it('fails closed for missing, incompatible, duplicate-provider failure and open failure', () => {
    const missing = new BetterSidebarAdapter(undefined, locale(), projects())
    expect(missing.getStatus().state).toBe('missing')
    expect(missing.openTab('paimind:tasks')).toBe(false)
    const incompatible = new BetterSidebarAdapter({}, locale(), projects())
    expect(incompatible.getStatus()).toMatchObject({ state: 'incompatible', error: expect.any(String) })

    const brokenRegister = new BetterSidebarAdapter({
      registerTab: () => { throw new Error('duplicate provider row') }, openTab: vi.fn(),
    }, locale(), projects())
    const listener = vi.fn()
    brokenRegister.subscribe(listener)
    brokenRegister.registerTab(definition('broken'))
    expect(brokenRegister.getStatus()).toMatchObject({ state: 'failed', error: 'duplicate provider row' })
    expect(listener).toHaveBeenCalledOnce()

    const brokenOpen = new BetterSidebarAdapter({
      registerTab: () => () => {}, openTab: () => { throw new Error('panel failed') },
    }, locale(), projects())
    brokenOpen.registerTab(definition('open'))
    expect(brokenOpen.openTab('paimind:tasks')).toBe(false)
    expect(brokenOpen.getStatus()).toMatchObject({ state: 'failed', error: 'panel failed' })
  })

  it('publishes and disposes the client service once', () => {
    const fixture = createClientContextFixture()
    const external = provider()
    const context = Object.assign(fixture.context, {
      betterSidebar: external.service,
      paimindWorkspaceProject: projects(),
    }) as BetterSidebarAdapterClientContext
    apply(context)
    expect(inject).toEqual(['betterSidebar', 'locale', 'paimindWorkspaceProject'])
    expect(fixture.services.get('paimindSidebar')).toBeInstanceOf(BetterSidebarAdapter)
    fixture.disposeEffects()
    expect(fixture.services.has('paimindSidebar')).toBe(false)
  })

  it('keeps an Office editor bound to its mount scope across Harness Session changes', () => {
    const listeners = new Set<() => void>()
    const original = (props: ExternalSidebarFileViewerProps) => createElement(
      'output',
      { 'data-testid': 'office-scope' },
      `${props.scope.sessionId}:${props.scope.cwd}`,
    )
    const officeViewer: ExternalSidebarFileViewerDescriptor = {
      id: 'xlsx', exts: ['xlsx'], fetchStrategy: 'mediaUrl', component: original,
    }
    const providerService = {
      registerTab: () => () => {},
      openTab: vi.fn(),
      getFileViewers: () => [officeViewer],
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    } satisfies ExternalBetterSidebarService

    const dispose = stabilizeOfficeFileViewerScopes(providerService)
    expect(officeViewer.component).not.toBe(original)
    const mounted = render(createElement(officeViewer.component!, {
      scope: { sessionId: 'session-1', cwd: '/workspace/one' },
      path: '/workspace/report.xlsx', title: 'Report', viewerId: 'xlsx',
    }))
    expect(document.querySelector('[data-paimind-office-lifecycle-boundary="xlsx"]')).not.toBeNull()
    expect(screen.getByTestId('office-scope')).toHaveTextContent('session-1:/workspace/one')

    mounted.rerender(createElement(officeViewer.component!, {
      scope: { sessionId: 'session-2', cwd: '/workspace/two' },
      path: '/workspace/report.xlsx', title: 'Report', viewerId: 'xlsx',
    }))
    expect(screen.getByTestId('office-scope')).toHaveTextContent('session-1:/workspace/one')

    mounted.unmount()
    render(createElement(officeViewer.component!, {
      scope: { sessionId: 'session-2', cwd: '/workspace/two' },
      path: '/workspace/report.xlsx', title: 'Report', viewerId: 'xlsx',
    }))
    expect(screen.getByTestId('office-scope')).toHaveTextContent('session-2:/workspace/two')
    cleanup()
    dispose()
    expect(officeViewer.component).toBe(original)
    expect(listeners).toHaveLength(0)
  })

  it('makes only stale removals inside a tracked Office subtree idempotent', () => {
    vi.useFakeTimers()
    const dispose = installOfficeDomCleanupGuard()
    try {
      const officeParent = document.createElement('div')
      const officeChild = document.createElement('span')
      officeParent.appendChild(officeChild)
      markOfficeLifecycleTree(officeParent)
      expect(officeParent.removeChild(officeChild)).toBe(officeChild)
      expect(officeParent.removeChild(officeChild)).toBe(officeChild)

      const ordinaryParent = document.createElement('div')
      const ordinaryChild = document.createElement('span')
      ordinaryParent.appendChild(ordinaryChild)
      ordinaryParent.removeChild(ordinaryChild)
      expect(() => ordinaryParent.removeChild(ordinaryChild)).toThrow(/not a child/i)

      dispose()
      // The provider boundary unmounts before its parent React tree finishes
      // deleting the tab subtree, so tracked removals remain guarded briefly.
      expect(officeParent.removeChild(officeChild)).toBe(officeChild)
      vi.runAllTimers()
      expect(() => officeParent.removeChild(officeChild)).toThrow(/not a child/i)
    } finally {
      dispose()
      vi.runAllTimers()
      vi.useRealTimers()
    }
  })

  it('opens only an enabled matching file viewer and refreshes the path-derived editor in a separate task', async () => {
    vi.useFakeTimers()
    const closeTab = vi.fn()
    const openTab = vi.fn()
    try {
      const adapter = new BetterSidebarAdapter({
        registerTab: () => () => {},
        openTab,
        closeTab,
        getTab: id => id === 'editor' ? {
          id: 'editor', title: 'Editor', component: () => null,
        } : undefined,
        isTabEnabled: id => id === 'editor',
        matchFileViewer: path => path.endsWith('.pdf') ? { id: 'pdf' } : path.endsWith('.pptx') ? { id: 'pptx' } : undefined,
      }, locale(), projects())

      expect(adapter.getFileCapability('/workspace/report.pdf', ['pdf'])).toEqual({
        state: 'available', viewerId: 'pdf',
      })
      expect(adapter.getFileCapability('/workspace/report.pdf', ['pptx'])).toEqual({
        state: 'viewer-unavailable', viewerId: null,
      })
      expect(adapter.openFile({
        path: '/workspace/report.pdf', title: 'Report', allowedViewerIds: ['pdf'], refresh: true,
      })).toEqual({ state: 'opened', viewerId: 'pdf' })
      expect(closeTab).toHaveBeenCalledWith('editor:/workspace/report.pdf')
      expect(openTab).not.toHaveBeenCalled()
      await vi.runAllTimersAsync()
      expect(openTab).toHaveBeenCalledWith({
        type: 'editor', title: 'Report', path: '/workspace/report.pdf', id: 'editor:/workspace/report.pdf',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a pending refreshed file open during disposal', async () => {
    vi.useFakeTimers()
    const openTab = vi.fn()
    try {
      const adapter = new BetterSidebarAdapter({
        registerTab: () => () => {}, openTab, closeTab: vi.fn(),
        getTab: () => ({ id: 'editor', title: 'Editor', component: () => null }),
        isTabEnabled: () => true, matchFileViewer: () => ({ id: 'pdf' }),
      }, locale(), projects())
      expect(adapter.openFile({ path: '/workspace/report.pdf', refresh: true }))
        .toEqual({ state: 'opened', viewerId: 'pdf' })
      adapter.dispose()
      await vi.runAllTimersAsync()
      expect(openTab).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rehydrates a persisted editor once the late file-viewer registry is ready', async () => {
    vi.useFakeTimers()
    const openTab = vi.fn()
    const closeTab = vi.fn()
    const registryListeners = new Set<() => void>()
    const stateListeners = new Set<() => void>()
    let viewers: Array<{ id: string }> = []
    let sessionId = 'session-1'
    try {
      const adapter = new BetterSidebarAdapter({
        registerTab: () => () => {}, openTab, closeTab,
        getFileViewers: () => viewers,
        subscribe: listener => { registryListeners.add(listener); return () => { registryListeners.delete(listener) } },
        subscribeState: listener => { stateListeners.add(listener); return () => { stateListeners.delete(listener) } },
        getSnapshot: () => ({
          sessionId,
          state: {
            splits: { kind: 'leaf', tabs: [{
              id: 'editor:/workspace/deck.pptx', type: 'editor', title: 'Deck', path: '/workspace/deck.pptx',
            }] },
            bottomSplits: { kind: 'leaf', tabs: [] }, floats: [],
          },
        }),
        matchFileViewer: path => viewers.length > 0 && path.endsWith('.pptx') ? { id: 'office-pptx' } : undefined,
      }, locale(), projects())

      await vi.runAllTimersAsync()
      expect(closeTab).not.toHaveBeenCalled()
      viewers = [{ id: 'office-pptx' }]
      for (const listener of registryListeners) listener()
      await vi.runAllTimersAsync()
      expect(closeTab).toHaveBeenCalledWith('editor:/workspace/deck.pptx')
      expect(openTab).toHaveBeenCalledWith({
        type: 'editor', title: 'Deck', path: '/workspace/deck.pptx', id: 'editor:/workspace/deck.pptx',
      })

      for (const listener of stateListeners) listener()
      await vi.runAllTimersAsync()
      expect(closeTab).toHaveBeenCalledTimes(1)
      sessionId = 'session-2'
      for (const listener of stateListeners) listener()
      await vi.runAllTimersAsync()
      expect(closeTab).toHaveBeenCalledTimes(1)
      expect(openTab).toHaveBeenCalledTimes(1)
      adapter.dispose()
      expect(registryListeners).toHaveLength(0)
      expect(stateListeners).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('registers and disposes one stable PAIMind file viewer through the provider adapter', () => {
    let descriptor: any
    const dispose = vi.fn()
    const adapter = new BetterSidebarAdapter({
      registerTab: () => () => {}, openTab: vi.fn(),
      registerFileViewer: value => { descriptor = value; return dispose },
    }, locale(), projects())
    const off = adapter.registerFileViewer({
      id: 'paimind:pdf', titleZh: 'PDF 预览', titleEn: 'PDF Preview',
      extensions: ['pdf'], priority: 120, render: props => props.title,
    })
    expect(descriptor).toMatchObject({ id: 'paimind:pdf', exts: ['pdf'], priority: 120, fetchStrategy: 'mediaUrl' })
    expect(descriptor.title()).toBe('PDF Preview')
    expect(descriptor.component({ path: '/work/report.pdf', title: 'Report', mediaUrl: '/media' })).toBe('Report')
    off()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('fails closed when file capabilities are absent, disabled or throw', () => {
    const legacy = new BetterSidebarAdapter({ registerTab: () => () => {}, openTab: vi.fn() }, locale(), projects())
    expect(legacy.openFile({ path: '/workspace/a.pdf' })).toEqual({ state: 'editor-unavailable', viewerId: null })

    const disabled = new BetterSidebarAdapter({
      registerTab: () => () => {}, openTab: vi.fn(), closeTab: vi.fn(),
      getTab: () => ({ id: 'editor', title: 'Editor', component: () => null }),
      isTabEnabled: () => false,
      matchFileViewer: () => ({ id: 'pdf' }),
    }, locale(), projects())
    expect(disabled.getFileCapability('/workspace/a.pdf')).toEqual({ state: 'editor-unavailable', viewerId: null })

    const throwing = new BetterSidebarAdapter({
      registerTab: () => () => {}, closeTab: vi.fn(),
      openTab: () => { throw new Error('editor crashed') },
      getTab: () => ({ id: 'editor', title: 'Editor', component: () => null }),
      isTabEnabled: () => true,
      matchFileViewer: () => ({ id: 'pdf' }),
    }, locale(), projects())
    expect(throwing.openFile({ path: '/workspace/a.pdf' })).toEqual({
      state: 'failed', viewerId: null, error: 'editor crashed',
    })
    expect(throwing.getStatus()).toMatchObject({ state: 'failed', error: 'editor crashed' })
  })
})
