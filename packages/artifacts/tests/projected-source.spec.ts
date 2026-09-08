import { describe, expect, it } from 'vitest'
import type { HarnessSessionService } from '@hansen/harness-compat'
import type { PaimindWorkspaceProjectService } from '@hansen/workspace-project'
import { HarnessProjectedArtifactSource } from '../src/index.js'

function observable<T>(initial: T): {
  readonly face: { getSnapshot(): T; subscribe(listener: () => void): () => void }
  set(value: T): void
} {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    face: {
      getSnapshot: () => value,
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    set(next) { value = next; for (const listener of listeners) listener() },
  }
}

function projection(state: 'available' | 'failed') {
  return {
    schema: 'paimind.artifacts/v1', traces: [],
    artifacts: [{
      schema: 'paimind.artifact-produced/v1', artifactId: 'artifact:one', sessionId: 'session-1',
      workspaceId: 'workspace-1', path: '/workspace/report.html', title: 'Report', kind: 'html',
      previewKind: 'html-document', revision: 1, producerId: 'paimind.generator.html-document',
      taskId: 'job-1', state, producedAt: 100,
      ...(state === 'failed' ? { error: { code: 'write_denied', message: 'Denied' } } : {}),
    }],
  }
}

describe('R2 projected Artifact source', () => {
  it('reads the durable Session projection, refreshes failures and clears stale rows when the face disappears', () => {
    const projected = observable<unknown>(projection('available'))
    const sessionList = observable({ current: 'session-1', byId: { 'session-1': { running: false } } })
    const sessions: HarnessSessionService = {
      list: sessionList.face,
      binding: () => ({
        session: Object.assign(observable({
          openState: 'open' as const, composerPhase: 'blank' as const, running: false,
          runningCalls: [], pending: [], partial: null,
        }).face, { projections: { faceOf: () => projected.face } }),
      }),
    }
    const projectListeners = new Set<() => void>()
    const projects: PaimindWorkspaceProjectService = {
      getSnapshot: () => ({
        state: 'ready', currentSessionId: 'session-1', error: null,
        currentProject: null,
        projects: [{
          workspaceId: 'workspace-1', title: 'Workspace', path: '/workspace', sessionIds: ['session-1'],
          visibleSessionCount: 1, archivedSessionCount: 0, totalSessionCount: 1,
          createdAt: '2026-08-14T00:00:00Z', updatedAt: '2026-08-14T00:00:00Z',
        }],
      }),
      subscribe(listener) { projectListeners.add(listener); return () => { projectListeners.delete(listener) } },
      startSession() {},
      async openWorkspace() {},
    }

    const source = new HarnessProjectedArtifactSource(sessions, projects)
    expect(source.getSnapshot().artifacts).toMatchObject([{
      id: 'artifact:one', origin: 'paimind-product', state: 'available', taskId: 'job-1',
    }])

    projected.set(projection('failed'))
    expect(source.getSnapshot().artifacts).toMatchObject([{
      state: 'failed', reason: { code: 'write_denied', messageEn: 'Denied' },
    }])

    projected.set(undefined)
    expect(source.getSnapshot().artifacts).toEqual([])
    source.dispose()
  })
})
