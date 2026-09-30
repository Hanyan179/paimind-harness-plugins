import { describe, expect, it } from 'vitest'
import { prepareHarnessSessionCreation, prepareHarnessSessionWorkspaceRead } from '../src/session-creation.js'

const selection = { sessionId: 'session-owned', workspaceId: 'workspace-owned', presetId: 'hansen-notes' }
const reply = (value: object, rpcId = 'call') => JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } })
describe('version-scoped creation and original workspace codecs', () => {
  it('fixes exact native identities, excludes caller extras, and correlates the returned identity', () => {
    const wire = prepareHarnessSessionCreation({ ...selection, userId: 'not-forwarded' } as typeof selection, 'call')
    expect(JSON.parse(wire.body)).toEqual({ type: 'client-request', rpcId: 'call', method: 'session.create',
      payload: { sessionId: 'session-owned', workspaceId: 'workspace-owned', agentPreset: 'hansen-notes' } })
    expect(wire.verify(reply({ sessionId: selection.sessionId, agentPreset: selection.presetId }))).toBe(true)
    expect(() => wire.verify(reply({ sessionId: 'foreign', agentPreset: selection.presetId }))).toThrow()
    expect(() => wire.verify(reply({ sessionId: selection.sessionId, agentPreset: selection.presetId }, 'foreign'))).toThrow()
  })
  it('never calls an original negative/partial response a proof of no side effect', () => {
    const wire = prepareHarnessSessionCreation(selection, 'call')
    expect(wire.verify(JSON.stringify({ type: 'server-response', rpcId: 'call', result: { ok: false,
      error: { code: 'workspace-attach-failed', message: 'private native path',
        details: { sessionId: selection.sessionId, workspaceId: selection.workspaceId } } } }))).toBe(false)
  })
  it.each(['', 'x'.repeat(201), 'invalid\0id'])('rejects invalid creation identities (%j)', sessionId => {
    expect(() => prepareHarnessSessionCreation({ ...selection, sessionId }, 'call')).toThrow()
  })
  it('projects only exact native workspace membership, never paths or arbitrary workspace data', () => {
    const wire = prepareHarnessSessionWorkspaceRead(selection.workspaceId, selection.sessionId, 'call')
    const workspace = { workspaceId: selection.workspaceId, path: '/private/workspace', title: 'Private notes',
      sessionIds: [selection.sessionId], createdAt: '2026-09-24', updatedAt: '2026-09-24' }
    expect(wire.decode(reply({ items: [workspace], archivedSessionIds: [] }))).toEqual({ exists: true, attached: true })
    expect(wire.decode(reply({ items: [{ ...workspace, sessionIds: [] }], archivedSessionIds: [] }))).toEqual({ exists: true, attached: false })
    expect(wire.decode(reply({ items: [], archivedSessionIds: [] }))).toEqual({ exists: false, attached: false })
    expect(() => wire.decode(reply({ items: [workspace, workspace], archivedSessionIds: [] }))).toThrow()
    expect(() => wire.decode(reply({ items: [{ ...workspace, sessionIds: [selection.sessionId, selection.sessionId] }], archivedSessionIds: [] }))).toThrow()
    expect(() => wire.decode(reply({ items: [workspace], archivedSessionIds: [] }, 'foreign'))).toThrow()
  })
})
