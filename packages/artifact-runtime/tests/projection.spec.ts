import { describe, expect, it } from 'vitest'
import { artifactToolMeta, artifactProjectionDefinition } from '../src/index.js'
import type { ArtifactProducedEnvelopeV1, ArtifactTraceEnvelopeV1 } from '@paimind/contracts'

function artifact(overrides: Partial<ArtifactProducedEnvelopeV1> = {}): ArtifactProducedEnvelopeV1 {
  return {
    schema: 'paimind.artifact-produced/v1', artifactId: 'artifact:one', sessionId: 'session-1',
    workspaceId: 'workspace-1', path: '/work/report.html', title: 'Report', kind: 'html',
    previewKind: 'html-document', revision: 1, producerId: 'paimind.generator.html',
    taskId: 'paimind-artifact-1', state: 'available', producedAt: 100,
    ...overrides,
  }
}

function trace(value: ArtifactProducedEnvelopeV1): ArtifactTraceEnvelopeV1 {
  return {
    schema: 'paimind.artifact-trace/v1', traceId: value.traceId ?? 'trace:one',
    artifactId: value.artifactId, sessionId: value.sessionId, workspaceId: value.workspaceId,
    producerId: value.producerId, taskId: value.taskId, artifactRevision: value.revision,
    producedAt: value.producedAt, document: { schemaVersion: 'paimind.presentation-trace/v2' },
  }
}

function event(value: ArtifactProducedEnvelopeV1, provenance?: ArtifactTraceEnvelopeV1) {
  return { type: 'tool/result', seq: value.revision, time: value.producedAt, data: { meta: artifactToolMeta(value, provenance) } }
}

describe('R2 artifact projection', () => {
  it('folds only native tool-result metadata and keeps the highest revision', () => {
    const empty = artifactProjectionDefinition.init()
    expect(artifactProjectionDefinition.apply(empty, { type: 'assistant/message', seq: 0, time: 0, data: {} })).toBe(empty)
    const first = artifactProjectionDefinition.apply(empty, event(artifact()))
    expect(artifactProjectionDefinition.view(first).artifacts[0]?.revision).toBe(1)
    expect(artifactProjectionDefinition.apply(first, event(artifact()))).toBe(first)
    const second = artifactProjectionDefinition.apply(first, event(artifact({ revision: 2, producedAt: 200 })))
    expect(artifactProjectionDefinition.view(second).artifacts).toMatchObject([{ revision: 2, taskId: 'paimind-artifact-1' }])
  })

  it('retains an explicit failure without exposing an available artifact', () => {
    const failed = artifact({ state: 'failed', error: { code: 'write_denied', message: 'Denied' } })
    const view = artifactProjectionDefinition.view(artifactProjectionDefinition.apply(
      artifactProjectionDefinition.init(), event(failed),
    ))
    expect(view.artifacts[0]).toMatchObject({ state: 'failed', error: { code: 'write_denied' } })
  })

  it('folds exact generator provenance into the same durable projection and rejects mismatched traces', () => {
    const firstArtifact = artifact({ traceId: 'trace:one' })
    const first = artifactProjectionDefinition.apply(artifactProjectionDefinition.init(), event(firstArtifact, trace(firstArtifact)))
    expect(artifactProjectionDefinition.view(first).traces).toMatchObject([{ traceId: 'trace:one', artifactRevision: 1 }])

    const secondArtifact = artifact({ traceId: 'trace:one', revision: 2, producedAt: 200 })
    const second = artifactProjectionDefinition.apply(first, event(secondArtifact, trace(secondArtifact)))
    expect(artifactProjectionDefinition.view(second).traces).toMatchObject([{ traceId: 'trace:one', artifactRevision: 2 }])

    const mismatched = { ...trace(secondArtifact), taskId: 'another-job' }
    const ignored = artifactProjectionDefinition.apply(second, event(secondArtifact, mismatched))
    expect(ignored).toBe(second)
  })
})
