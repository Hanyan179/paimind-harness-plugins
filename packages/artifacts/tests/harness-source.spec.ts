import { describe, expect, it, vi } from 'vitest'
import type {
  HarnessConversationSnapshot,
  HarnessSessionListSnapshot,
  HarnessSessionService,
} from '@paimind/harness-compat'
import type { PaimindWorkspaceProjectService, WorkspaceProjectSnapshot } from '@paimind/workspace-project'
import { HarnessDeliverableArtifactSource } from '../src/index.ts'

function observable<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next: T) { value = next; for (const listener of listeners) listener() },
  }
}

function conversation(path: string, seq: number): HarnessConversationSnapshot {
  return {
    openState: 'open', composerPhase: 'blank', running: false, runningCalls: [], pending: [], partial: null,
    chat: { timeline: { turnOrder: [1], turns: new Map([[1, {
      turn: 1, data: { get: key => key === 'deliverables' ? { produced: [{ seq, path }] } : undefined },
    }]]) } },
  }
}

describe('FP06-FP07 native Harness artifact source', () => {
  it('subscribes only staged Session bindings and caches explicitly visited Session artifacts', () => {
    const list = observable<HarnessSessionListSnapshot>({
      current: 'session-1', ids: ['session-1', 'session-2'], byId: {
        'session-1': { id: 'session-1', cwd: '/workspace', running: false, updatedAt: 100 },
        'session-2': { id: 'session-2', cwd: '/workspace', running: false, updatedAt: 200 },
      },
    })
    const one = observable(conversation('one.pdf', 10))
    const two = observable(conversation('two.pptx', 20))
    const sessions: HarnessSessionService = {
      list,
      binding: id => id === 'session-1' ? { session: one } : id === 'session-2' ? { session: two } : undefined,
    }
    const projectSnapshot: WorkspaceProjectSnapshot = Object.freeze({
      state: 'ready', currentSessionId: 'session-1', error: null, currentProject: null,
      projects: Object.freeze([Object.freeze({
        workspaceId: 'workspace-1', title: 'Workspace', path: '/workspace', sessionIds: Object.freeze(['session-1', 'session-2']),
        visibleSessionCount: 2, archivedSessionCount: 0, totalSessionCount: 2,
        createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
      })]),
    })
    const projects: PaimindWorkspaceProjectService = {
      getSnapshot: () => projectSnapshot, subscribe: () => () => {},
      startSession: vi.fn(), openWorkspace: vi.fn(async () => {}),
    }
    const source = new HarnessDeliverableArtifactSource(sessions, projects)
    expect(source.getSnapshot().artifacts.map(entry => entry.path)).toEqual(['one.pdf'])
    one.set(conversation('one-new.pdf', 11))
    expect(source.getSnapshot().artifacts.map(entry => entry.path)).toEqual(['one-new.pdf'])
    list.set({ ...list.getSnapshot(), current: 'session-2' })
    expect(source.getSnapshot().artifacts.map(entry => entry.path)).toEqual(['one-new.pdf', 'two.pptx'])
    one.set(conversation('should-not-refresh.pdf', 12))
    expect(source.getSnapshot().artifacts.map(entry => entry.path)).toEqual(['one-new.pdf', 'two.pptx'])
    source.dispose()
  })
})
