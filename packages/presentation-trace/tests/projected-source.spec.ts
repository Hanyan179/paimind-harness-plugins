import { describe, expect, it } from 'vitest'
import type { ArtifactProducedEnvelopeV1, ArtifactTraceEnvelopeV1, PaimindArtifactProjectionV1 } from '@hansen/contracts'
import type { HarnessSessionService } from '@hansen/harness-compat'
import { HarnessProjectedPresentationTraceSource } from '../src/index.ts'

function observable<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    face: { getSnapshot: () => value, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
    set(next: T) { value = next; for (const listener of listeners) listener() },
  }
}

function projection(revision = 1): PaimindArtifactProjectionV1 {
  const artifact: ArtifactProducedEnvelopeV1 = {
    schema: 'paimind.artifact-produced/v1', artifactId: 'artifact:deck', sessionId: 'session-1',
    workspaceId: 'workspace-1', path: '/workspace/deck.pptx', title: 'Deck', kind: 'pptx',
    previewKind: 'presentation', revision, producerId: 'paimind.generator.presentation',
    taskId: `job-${revision}`, traceId: 'trace:deck', state: 'available', producedAt: revision,
  }
  const trace: ArtifactTraceEnvelopeV1 = {
    schema: 'paimind.artifact-trace/v1', traceId: 'trace:deck', artifactId: artifact.artifactId,
    sessionId: artifact.sessionId, workspaceId: artifact.workspaceId, producerId: artifact.producerId,
    taskId: artifact.taskId, artifactRevision: revision, producedAt: revision,
    document: { schemaVersion: 'paimind.presentation-trace/v2', reviewStatus: 'generated', sources: [], slides: [] },
  }
  return { schema: 'paimind.artifacts/v1', artifacts: [artifact], traces: [trace] }
}

describe('R3 projected presentation trace source', () => {
  it('reads only the current native Session Artifact projection and follows revisions', () => {
    const current = observable<unknown>(projection())
    const list = observable({ current: 'session-1', sessions: [] })
    const sessions = {
      list: list.face,
      binding: () => ({ session: { getSnapshot: () => ({}), subscribe: () => () => {}, projections: { faceOf: () => current.face } } }),
    } as unknown as HarnessSessionService
    const source = new HarnessProjectedPresentationTraceSource(sessions)
    expect(source.getSnapshot().traces).toMatchObject([{ traceId: 'trace:deck' }])
    current.set(projection(2))
    expect(source.getSnapshot().traces).toMatchObject([{ traceId: 'trace:deck' }])
    list.set({ current: undefined, sessions: [] })
    expect(source.getSnapshot().traces).toEqual([])
    source.dispose()
  })
})
