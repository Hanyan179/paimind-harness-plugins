import { describe, expect, it } from 'vitest'
import { artifactsFromProjection, projectPaimindArtifactJobs } from '../src/index.js'

describe('R2 native Job projection', () => {
  it('uses exact Job kind, orders live first and joins only explicit taskId', () => {
    const artifacts = artifactsFromProjection({ schema: 'paimind.artifacts/v1', traces: [], artifacts: [{
      schema: 'paimind.artifact-produced/v1', artifactId: 'artifact:one', sessionId: 'session-1',
      workspaceId: 'workspace-1', path: '/work/report.html', title: 'Report', kind: 'html',
      previewKind: 'html-document', revision: 1, producerId: 'paimind.generator.html-document',
      taskId: 'paimind-artifact-1', state: 'available', producedAt: 100,
    }] })
    const rows = projectPaimindArtifactJobs([
      { id: 'paimind-artifact-1', kind: 'paimind-artifact', label: 'done', status: 'completed', startedAt: 10, finishedAt: 20 },
      { id: 'bash-1', kind: 'bash', label: 'paimind-artifact mentioned in prose', status: 'running', startedAt: 1 },
      { id: 'paimind-artifact-2', kind: 'paimind-artifact', label: 'live', status: 'running', startedAt: 30 },
    ], artifacts)
    expect(rows.map(row => row.id)).toEqual(['paimind-artifact-2', 'paimind-artifact-1'])
    expect(rows[1]?.artifact?.artifactId).toBe('artifact:one')
    expect(rows[0]?.artifact).toBeUndefined()
  })

  it('fails closed on an absent or malformed projection', () => {
    expect(artifactsFromProjection(undefined)).toEqual([])
    expect(artifactsFromProjection({ schema: 'wrong', artifacts: [] })).toEqual([])
  })
})
