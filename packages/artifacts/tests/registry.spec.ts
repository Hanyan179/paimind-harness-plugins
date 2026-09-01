import { describe, expect, it, vi } from 'vitest'
import {
  ArtifactRegistry,
  extractHarnessArtifacts,
  resolveArtifactPath,
  selectArtifactViews,
  type PaimindArtifact,
  type PaimindArtifactSource,
} from '../src/index.ts'

function artifact(overrides: Partial<PaimindArtifact> = {}): PaimindArtifact {
  return {
    id: 'artifact-1', origin: 'paimind-product', kind: 'pdf', state: 'available',
    title: 'Report', path: 'report.pdf', sessionId: 'session-1', workspaceId: 'workspace-1',
    updatedAt: 100,
    ...overrides,
  }
}

function source(id: string, read: () => readonly PaimindArtifact[]): PaimindArtifactSource & { emit(): void; disposed(): boolean } {
  const listeners = new Set<() => void>()
  let disposed = false
  return {
    id,
    getSnapshot: () => ({ artifacts: read() }),
    subscribe(listener) { listeners.add(listener); return () => { disposed = true; listeners.delete(listener) } },
    emit() { for (const listener of listeners) listener() },
    disposed: () => disposed,
  }
}

describe('FP06-FP07 artifact projection', () => {
  it('opens only a canonical registered Artifact through the owner-provided handler', () => {
    const open = vi.fn(() => ({ state: 'opened' as const }))
    const registry = new ArtifactRegistry(open)
    registry.registerSource(source('owner', () => [artifact()]))

    expect(registry.open('artifact-1', 'owner')).toEqual({ state: 'opened' })
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 'artifact-1', sourceId: 'owner' }))
    expect(registry.open('artifact-1', 'other').state).toBe('failed')
    expect(registry.open('unknown').state).toBe('failed')
  })

  it('normalizes, freezes, orders and scopes only by explicit identifiers', () => {
    const registry = new ArtifactRegistry()
    registry.registerSource(source('producer', () => [
      artifact({ id: 'failed', state: 'failed', path: 'failed.pptx', kind: 'pptx', reason: { code: 'x', messageZh: '失败', messageEn: 'Failed' }, updatedAt: 400 }),
      artifact({ id: 'available', updatedAt: 200 }),
      artifact({ id: 'updating', state: 'updating', path: 'updating.pptx', kind: 'pptx', sessionId: 'session-2', updatedAt: 300 }),
    ]))
    const snapshot = registry.getSnapshot()
    expect(snapshot.artifacts.map(entry => entry.id)).toEqual(['available', 'updating', 'failed'])
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.artifacts[0])).toBe(true)
    expect(selectArtifactViews(snapshot.artifacts, 'session', 'session-1', 'workspace-1').map(entry => entry.id))
      .toEqual(['available', 'failed'])
    expect(selectArtifactViews(snapshot.artifacts, 'workspace', 'session-x', 'workspace-1').map(entry => entry.id))
      .toEqual(['available', 'updating', 'failed'])
  })

  it('stacks source ids, restores the previous source and isolates failures', () => {
    const registry = new ArtifactRegistry()
    const first = source('scheduler', () => [artifact({ id: 'first' })])
    const second = source('scheduler', () => [artifact({ id: 'second' })])
    const offFirst = registry.registerSource(first)
    const offSecond = registry.registerSource(second)
    registry.registerSource(source('broken', () => { throw new Error('projection failed') }))
    expect(registry.getSnapshot().artifacts.map(entry => entry.id)).toEqual(['second'])
    expect(registry.getSnapshot().diagnostics).toEqual([{ sourceId: 'broken', message: 'projection failed' }])
    offSecond()
    expect(second.disposed()).toBe(true)
    expect(registry.getSnapshot().artifacts.map(entry => entry.id)).toEqual(['first'])
    offFirst()
    expect(first.disposed()).toBe(true)
  })

  it('deduplicates one native Deliverable and product envelope by Session path in favor of the explicit product projection', () => {
    const registry = new ArtifactRegistry()
    registry.registerSource(source('harness', () => [artifact({
      id: 'native', origin: 'harness-deliverable', path: '/workspace/report.pdf',
    })]))
    registry.registerSource(source('paimind', () => [artifact({
      id: 'product', origin: 'paimind-product', path: '/workspace/report.pdf', taskId: 'job-1',
    })]))
    expect(registry.getSnapshot().artifacts).toMatchObject([{
      id: 'product', origin: 'paimind-product', taskId: 'job-1',
    }])
  })

  it('rejects malformed associations, mismatched kinds and unstructured failures', () => {
    const registry = new ArtifactRegistry()
    registry.registerSource(source('bad', () => [artifact({ sessionId: '' })]))
    expect(registry.getSnapshot().diagnostics[0]?.message).toMatch(/lacks explicit Session\/Workspace/)
    registry.registerSource(source('bad-kind', () => [artifact({ kind: 'pptx' })]))
    expect(registry.getSnapshot().diagnostics.some(entry => /kind does not match/.test(entry.message))).toBe(true)
    registry.registerSource(source('bad-failure', () => [artifact({ state: 'failed' })]))
    expect(registry.getSnapshot().diagnostics.some(entry => /requires a structured reason/.test(entry.message))).toBe(true)
    registry.registerSource(source('bad-preview-kind', () => [artifact({ previewKind: 'bento-deck' })]))
    expect(registry.getSnapshot().diagnostics.some(entry => /preview kind does not match/.test(entry.message))).toBe(true)
  })

  it('resolves only supported preview paths inside the active Workspace root', () => {
    expect(resolveArtifactPath('/workspace', 'reports/q1.pdf')).toEqual({ state: 'safe', path: '/workspace/reports/q1.pdf', kind: 'pdf' })
    expect(resolveArtifactPath('/workspace', '/workspace/deck.PPTX')).toEqual({ state: 'safe', path: '/workspace/deck.PPTX', kind: 'pptx' })
    expect(resolveArtifactPath('/workspace', '../secret.pdf')).toEqual({ state: 'unsafe', code: 'traversal' })
    expect(resolveArtifactPath('/workspace', '/other/report.pdf')).toEqual({ state: 'unsafe', code: 'outside-workspace' })
    expect(resolveArtifactPath('/workspace', 'https://example.com/report.pdf')).toEqual({ state: 'unsafe', code: 'unsupported-scheme' })
    expect(resolveArtifactPath('/workspace', 'notes.txt')).toEqual({ state: 'unsafe', code: 'unsupported-kind' })
    expect(resolveArtifactPath('/workspace', 'site/index.htm')).toEqual({ state: 'safe', path: '/workspace/site/index.htm', kind: 'html' })
    expect(resolveArtifactPath('/workspace', 'models/opportunity.xlsx')).toEqual({ state: 'safe', path: '/workspace/models/opportunity.xlsx', kind: 'xlsx' })
    expect(resolveArtifactPath('C:\\Work', 'deck.pptx')).toEqual({ state: 'safe', path: 'C:/Work/deck.pptx', kind: 'pptx' })
  })

  it('extracts supported native Turn data, supplies conservative preview defaults and replaces repeated paths', () => {
    const turns = new Map([
      [1, { turn: 1, data: { get: (key: string) => key === 'deliverables' ? { produced: [
        { seq: 10, path: 'report.pdf' }, { seq: 11, path: 'notes.md' },
      ] } : undefined } }],
      [2, { turn: 2, data: { get: (key: string) => key === 'deliverables' ? { produced: [
        { seq: 20, path: 'report.pdf' }, { seq: 21, path: 'deck.pptx' },
        { seq: 22, path: 'page.html' }, { seq: 23, path: 'model.xlsx' },
      ] } : undefined } }],
    ])
    const artifacts = extractHarnessArtifacts({
      snapshot: {
        openState: 'open', composerPhase: 'blank', running: false, runningCalls: [], pending: [], partial: null,
        chat: { timeline: { turnOrder: [1, 2], turns } },
      },
      sessionId: 'session-1', workspaceId: 'workspace-1', updatedAt: 500,
    })
    expect(artifacts.map(entry => [entry.path, entry.revision])).toEqual([
      ['report.pdf', '20'], ['deck.pptx', '21'], ['page.html', '22'], ['model.xlsx', '23'],
    ])
    expect(artifacts.find(entry => entry.path === 'page.html')?.previewKind).toBe('html-document')
    expect(artifacts.find(entry => entry.path === 'model.xlsx')?.previewKind).toBe('spreadsheet')
    expect(artifacts.every(entry => entry.origin === 'harness-deliverable')).toBe(true)
  })

  it('publishes source updates and becomes inert after disposal', () => {
    let rows = [artifact({ id: 'one' })]
    const producer = source('producer', () => rows)
    const registry = new ArtifactRegistry()
    const listener = vi.fn()
    registry.subscribe(listener)
    registry.registerSource(producer)
    rows = [artifact({ id: 'two' })]
    producer.emit()
    expect(registry.getSnapshot().artifacts[0]?.id).toBe('two')
    registry.dispose()
    expect(producer.disposed()).toBe(true)
    producer.emit()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('exposes stack-safe disposable artifact actions and contains contributor failures', () => {
    const registry = new ArtifactRegistry()
    registry.registerSource(source('producer', () => [artifact({ traceId: 'trace-1' })]))
    const view = registry.getSnapshot().artifacts[0]!
    const first = vi.fn(() => ({ state: 'opened' as const }))
    const second = vi.fn(() => { throw new Error('trace failed') })
    const offFirst = registry.registerAction({ id: 'trace', labelZh: '追溯', labelEn: 'Trace', supports: row => row.traceId !== undefined, run: first })
    const offSecond = registry.registerAction({ id: 'trace', labelZh: '新追溯', labelEn: 'New Trace', supports: () => true, run: second })
    expect(registry.actionsFor(view)).toEqual([{ id: 'trace', labelZh: '新追溯', labelEn: 'New Trace' }])
    expect(registry.runAction('trace', view)).toMatchObject({ state: 'failed', messageEn: 'Artifact action failed: trace failed' })
    offSecond()
    expect(registry.actionsFor(view)[0]?.labelEn).toBe('Trace')
    expect(registry.runAction('trace', view)).toEqual({ state: 'opened' })
    expect(first).toHaveBeenCalledOnce()
    offFirst()
    expect(registry.actionsFor(view)).toEqual([])
  })
})
