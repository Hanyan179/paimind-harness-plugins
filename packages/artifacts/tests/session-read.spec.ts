import { describe, expect, it } from 'vitest'
import { projectSessionArtifactRead } from '../src/index.js'

const projection = () => ({ schema: 'paimind.artifacts/v1', traces: [], artifacts: [{
  schema: 'paimind.artifact-produced/v1', artifactId: 'artifact:one', sessionId: 'hansen-session', workspaceId: 'workspace-hansen',
  path: '/workspace/hansen/report.html', title: '客户报告', kind: 'html', previewKind: 'html-document', revision: 2,
  producerId: 'paimind.generator.html-document', taskId: 'job-one', state: 'available', producedAt: 100,
}] })
const input = () => ({ sessionId: 'hansen-session', workspaceId: 'workspace-hansen', cwd: '/workspace/hansen',
  produced: [{ path: 'original.pdf', seq: 3, time: 30 }, { path: 'ignored.txt', seq: 4, time: 40 }, { path: 'original.pdf', seq: 5, time: 50 }],
  projection: projection() })
describe('stateless source-owned artifact presentation', () => {
  it('reuses native identities and product versions without model prose, directory scanning or file-existence claims', () => {
    const value = projectSessionArtifactRead(input())
    expect(value.productProjection).toBe('ready'); expect(value.items).toHaveLength(2)
    expect(value.items[0]).toMatchObject({ id: 'harness:hansen-session:original.pdf', origin: 'harness-deliverable', path: 'original.pdf', revision: '5' })
    expect(value.items[1]).toMatchObject({ id: 'artifact:one', origin: 'paimind-product', revision: '2', taskId: 'job-one' })
    expect(value.items.every(item => item.sessionId === 'hansen-session' && item.workspaceId === 'workspace-hansen')).toBe(true)
    expect(Object.isFrozen(value.items)).toBe(true)
  })
  it('preserves source-owned failure and recovery revisions', () => {
    const value: any = input(); value.projection.artifacts[0].state = 'failed'; value.projection.artifacts[0].error = { code: 'write_denied', message: 'Denied' }
    expect(projectSessionArtifactRead(value).items[1]).toMatchObject({ state: 'failed', reason: { code: 'write_denied' } })
    expect(projectSessionArtifactRead(input()).items[1]?.state).toBe('available')
  })
  it('exposes unavailable rather than silently inventing an empty product projection', () => {
    expect(projectSessionArtifactRead({ ...input(), projection: undefined })).toMatchObject({ productProjection: 'unavailable' })
  })
  it.each(['session', 'workspace', 'outside', 'duplicate', 'malformed', 'native-outside', 'native-traversal', 'version'])('fails closed on %s without cross-owner metadata', mode => {
    const value: any = input()
    if (mode === 'session') value.projection.artifacts[0].sessionId = 'alex-session'
    if (mode === 'workspace') value.projection.artifacts[0].workspaceId = 'workspace-alex'
    if (mode === 'outside') value.projection.artifacts[0].path = '/workspace/alex/private.html'
    if (mode === 'duplicate') value.projection.artifacts.push(value.projection.artifacts[0])
    if (mode === 'malformed') value.projection.schema = 'other'
    if (mode === 'native-outside') value.produced[0].path = '/workspace/alex/report.pdf'
    if (mode === 'native-traversal') value.produced[0].path = '../alex/report.pdf'
    if (mode === 'version') value.produced[0].seq = 1.5
    expect(() => projectSessionArtifactRead(value)).toThrow()
  })
})
