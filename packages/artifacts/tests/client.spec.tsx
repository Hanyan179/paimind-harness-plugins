import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaimindLocaleSource } from '@paimind/harness-compat'
import type { PaimindSidebarService, PaimindSidebarTabScope } from '@paimind/better-sidebar-adapter'
import type { PaimindBentoPreviewService } from '@paimind/renderer-bento'
import { createClientContextFixture } from '@paimind/testkit'
import { ArtifactRegistry, type PaimindArtifact } from '../src/index.ts'
import {
  ArtifactPanel,
  installBentoArtifactDeepLink,
  installBentoArtifactOpenPathRouter,
  openRegisteredBentoArtifact,
  registeredBentoArtifactForPath,
  apply,
} from '../src/client/index.tsx'

function locale(initial = 'en'): PaimindLocaleSource & { set(value: string): void } {
  let active = initial
  const listeners = new Set<() => void>()
  return {
    getLocale: () => ({ active }),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(value) { active = value; for (const listener of listeners) listener() },
  }
}

function row(overrides: Partial<PaimindArtifact> = {}): PaimindArtifact {
  return {
    id: 'pdf', origin: 'paimind-product', kind: 'pdf', state: 'available', title: 'Report', path: 'report.pdf',
    sessionId: 'session-1', workspaceId: 'workspace-1', updatedAt: 100,
    ...overrides,
  }
}

function service(rows: readonly PaimindArtifact[]) {
  const registry = new ArtifactRegistry()
  registry.registerSource({ id: 'test', getSnapshot: () => ({ artifacts: rows }), subscribe: () => () => {} })
  return registry
}

function sidebar(): PaimindSidebarService {
  return {
    getStatus: () => ({ state: 'active', provider: 'dsh-better-sidebar', providerVersion: '0.14.0', contractVersion: 4, error: null }),
    subscribe: () => () => {}, registerTab: () => () => {}, openTab: () => true, closeTab: () => true,
    getFileCapability: () => ({ state: 'available', viewerId: 'pdf' }),
    openFile: vi.fn(() => ({ state: 'opened', viewerId: 'pdf' })),
    dispose: () => {},
  }
}

function scope(language: PaimindLocaleSource): PaimindSidebarTabScope {
  return { sessionId: 'session-1', workspaceId: 'workspace-1', cwd: '/workspace', visible: true, locale: language }
}

const bento = (): PaimindBentoPreviewService => ({
  getSnapshot: () => ({ revision: 0, requestRevision: 0, request: null, runtimeEvent: null }),
  subscribe: () => () => {},
  open: vi.fn(() => true),
})

describe('FP06-FP07 artifact client surface', () => {
  it('publishes routing and projection services without a fixed Artifacts sidebar tab', () => {
    const fixture = createClientContextFixture()
    const registerTab = vi.fn(() => () => {})
    const closeTab = vi.fn(() => true)
    const sessions = { list: { getSnapshot: () => ({ current: undefined, byId: {} }), subscribe: () => () => {} }, open: vi.fn() }
    const workspaces = { list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} }, openPath: vi.fn(async () => {}) }
    const projects = { getSnapshot: () => ({ projects: [], currentProject: null }), subscribe: () => () => {} }
    const context = Object.assign(fixture.context, {
      sessions, workspaces, paimindWorkspaceProject: projects, paimindBentoPreview: bento(),
      paimindSidebar: { ...sidebar(), registerTab, closeTab },
    })
    apply(context as never)
    expect(registerTab).not.toHaveBeenCalled()
    expect(closeTab).toHaveBeenCalledWith('paimind:artifacts')
    expect(fixture.services.has('paimindArtifacts')).toBe(true)
    fixture.disposeEffects()
    expect(fixture.services.has('paimindArtifacts')).toBe(false)
  })

  it('routes a registered Bento file link directly to the Bento workbench and falls through for ordinary HTML', async () => {
    const bentoArtifact = row({
      id: 'bento', kind: 'html', previewKind: 'bento-deck', path: 'decks/proposal.bento.html',
      title: 'Proposal', traceId: 'trace-1',
    })
    const registry = service([bentoArtifact])
    const preview = bento()
    const fallback = vi.fn(async () => {})
    const project = {
      workspaceId: 'workspace-1', title: 'Workspace', path: '/workspace', sessionIds: ['session-1'],
      visibleSessionCount: 1, archivedSessionCount: 0, totalSessionCount: 1,
      createdAt: '2026-08-17T00:00:00Z', updatedAt: '2026-08-17T00:00:00Z',
    }
    const workspaces = { list: { getSnapshot: vi.fn(), subscribe: vi.fn() }, startSession: vi.fn(), openPath: fallback }
    const sessions = { list: { getSnapshot: () => ({ current: 'session-1', byId: {} }), subscribe: () => () => {} }, open: vi.fn() }
    const projects = { getSnapshot: () => ({ state: 'ready', projects: [project], currentSessionId: 'session-1', currentProject: project, error: null }), subscribe: () => () => {}, startSession: vi.fn(), openWorkspace: vi.fn() }

    const match = registeredBentoArtifactForPath('/workspace/decks/proposal.bento.html', 'session-1', registry.getSnapshot().artifacts, [project])
    expect(match?.id).toBe('bento')
    expect(openRegisteredBentoArtifact(match!, [project], preview)).toBe(true)
    expect(preview.open).toHaveBeenLastCalledWith(expect.objectContaining({
      path: '/workspace/decks/proposal.bento.html', artifactId: 'bento', traceId: 'trace-1',
    }))

    vi.mocked(preview.open).mockClear()
    const dispose = installBentoArtifactOpenPathRouter({ workspaces, sessions, paimindWorkspaceProject: projects, paimindBentoPreview: preview } as never, registry)
    await workspaces.openPath('decks/proposal.bento.html')
    expect(preview.open).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
    await workspaces.openPath('decks/ordinary.html')
    expect(fallback).toHaveBeenCalledWith('decks/ordinary.html')
    dispose()
    expect(workspaces.openPath).toBe(fallback)
  })

  it('consumes an exact Artifact deep link after opening its Bento workbench', async () => {
    const registry = service([row({
      id: 'bento-deep-link', kind: 'html', previewKind: 'bento-deck', path: 'decks/direct.bento.html',
      title: 'Direct deck', traceId: 'trace-direct',
    })])
    const preview = bento()
    const project = {
      workspaceId: 'workspace-1', title: 'Workspace', path: '/workspace', sessionIds: ['session-1'],
      visibleSessionCount: 1, archivedSessionCount: 0, totalSessionCount: 1,
      createdAt: '2026-08-17T00:00:00Z', updatedAt: '2026-08-17T00:00:00Z',
    }
    const sessions = { list: { getSnapshot: () => ({ current: 'session-1', byId: {} }), subscribe: () => () => {} }, open: vi.fn() }
    const projects = { getSnapshot: () => ({ state: 'ready', projects: [project], currentSessionId: 'session-1', currentProject: project, error: null }), subscribe: () => () => {}, startSession: vi.fn(), openWorkspace: vi.fn() }
    window.history.replaceState({}, '', '/?paimindArtifactId=bento-deep-link')

    const dispose = installBentoArtifactDeepLink({ sessions, paimindWorkspaceProject: projects, paimindBentoPreview: preview } as never, registry)
    await Promise.resolve()

    expect(preview.open).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'bento-deep-link', traceId: 'trace-direct', path: '/workspace/decks/direct.bento.html',
    }))
    expect(window.location.search).toBe('')
    expect(sessions.open).not.toHaveBeenCalled()
    dispose()
  })

  it('shows product states, disables unsettled rows and delegates a safe preview', () => {
    const registry = service([
      row(),
      row({ id: 'deck', kind: 'pptx', path: 'deck.pptx', title: 'Deck' }),
      row({ id: 'updating', kind: 'pptx', path: 'updating.pptx', title: 'Updating', state: 'updating' }),
      row({ id: 'missing', path: 'missing.pdf', title: 'Missing', state: 'missing', reason: { code: 'missing', messageZh: '缺失', messageEn: 'Missing file' } }),
      row({ id: 'failed', kind: 'pptx', path: 'failed.pptx', title: 'Failed', state: 'failed', reason: { code: 'failed', messageZh: '失败', messageEn: 'Producer failed' } }),
    ])
    const provider = sidebar()
    render(<ArtifactPanel service={registry} sidebar={provider} bentoPreview={bento()} scope={scope(locale())} />)
    expect(screen.getByText('PAIMind Artifacts')).toBeInTheDocument()
    expect(screen.getByTitle('Updating')).toBeInTheDocument()
    expect(screen.getByText('Missing file')).toBeInTheDocument()
    expect(screen.getByText('Producer failed')).toBeInTheDocument()
    const report = screen.getByText('Report').closest('li')
    expect(report).not.toBeNull()
    fireEvent.click(within(report as HTMLElement).getByRole('button', { name: 'Preview' }))
    expect(provider.openFile).toHaveBeenCalledWith({
      path: '/workspace/report.pdf', title: 'Report', allowedViewerIds: ['paimind:pdf', 'pdf'], refresh: true,
    })
    const updating = screen.getByTitle('Updating').closest('li')
    expect(within(updating as HTMLElement).getByRole('button', { name: 'Preview' })).toBeDisabled()
  })

  it('localizes live, filters explicit scope and blocks traversal before the provider', () => {
    const language = locale('en')
    const registry = service([
      row({ id: 'unsafe', path: '../secret.pdf', title: 'Unsafe' }),
      row({ id: 'other', path: 'other.pdf', title: 'Other Session', sessionId: 'session-2' }),
    ])
    const provider = sidebar()
    render(<ArtifactPanel service={registry} sidebar={provider} bentoPreview={bento()} scope={scope(language)} />)
    expect(screen.queryByText('Other Session')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByRole('alert')).toHaveTextContent('directory traversal')
    expect(provider.openFile).not.toHaveBeenCalled()
    act(() => { language.set('zh-CN') })
    expect(screen.getByText('PAIMind 产物')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('目录穿越')
    fireEvent.click(screen.getByRole('button', { name: '当前工作区' }))
    expect(screen.getByText('Other Session')).toBeInTheDocument()
  })

  it('contains provider capability failures in the Artifact tab', () => {
    const provider = sidebar()
    vi.mocked(provider.openFile).mockReturnValue({ state: 'viewer-unavailable', viewerId: null })
    render(<ArtifactPanel service={service([row()])} sidebar={provider} bentoPreview={bento()} scope={scope(locale())} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByRole('alert')).toHaveTextContent('viewer is disabled or incompatible')
  })

  it('labels explicit HTML/Bento semantics and delegates HTML/XLSX to exact native viewers', () => {
    const provider = sidebar()
    const registry = service([
      row({ id: 'html', kind: 'html', previewKind: 'html-document', path: 'document.html', title: 'Document' }),
      row({ id: 'deck', kind: 'html', previewKind: 'html-deck', path: 'deck.html', title: 'Deck' }),
      row({ id: 'bento', kind: 'html', previewKind: 'bento-deck', path: 'bento.html', title: 'Bento Runtime', traceId: 'trace-1' }),
      row({ id: 'sheet', kind: 'xlsx', previewKind: 'spreadsheet', path: 'model.xlsx', title: 'Workbook' }),
    ])
    const bentoPreview = bento()
    render(<ArtifactPanel service={registry} sidebar={provider} bentoPreview={bentoPreview} scope={scope(locale())} />)
    expect(screen.getAllByText('HTML')).toHaveLength(1)
    expect(screen.getByText('HTML Deck')).toBeInTheDocument()
    expect(screen.getAllByText('Bento')).toHaveLength(1)
    expect(screen.getByText('XLSX')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTitle('Bento Runtime').closest('li') as HTMLElement).getByRole('button', { name: 'Preview' }))
    expect(bentoPreview.open).toHaveBeenLastCalledWith({
      sessionId: 'session-1', workspaceId: 'workspace-1', cwd: '/workspace',
      path: '/workspace/bento.html', title: 'Bento Runtime',
      artifactSourceId: 'test', artifactId: 'bento', traceId: 'trace-1',
    })
    fireEvent.click(within(screen.getByTitle('Workbook').closest('li') as HTMLElement).getByRole('button', { name: 'Preview' }))
    expect(provider.openFile).toHaveBeenLastCalledWith({
      path: '/workspace/model.xlsx', title: 'Workbook', allowedViewerIds: ['xlsx'], refresh: true,
    })
  })
})
