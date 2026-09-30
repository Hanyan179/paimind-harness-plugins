// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { prepareHarnessSessionProducedRead, prepareHarnessSessionArtifactWorkspaceRead } from '../src/session-artifacts.js'

const reply = (value: unknown, rpcId = 'read') => JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } })
const event = (seq: number, type: string, data: object, view?: object, surfaceOp?: string) => ({
  event: { seq, time: 100 + seq, type, data, ...(surfaceOp ? { surfaceOp } : {}) }, ...(view ? { view } : {}),
})
const call = (seq: number, callId: string, card: object, turn = 1) => event(seq, 'tool/call', { turn, callId }, { for: 'call', view: card })
const result = (seq: number, callId: string, turn = 1, isError = false, surfaceOp = 'append') =>
  event(seq, 'tool/result', { turn, message: { source: { callId }, content: [{ isError, type: 'tool-result', content: 'PRIVATE_TOOL_CONTENT' }] } }, undefined, surfaceOp)
const read = () => prepareHarnessSessionProducedRead('hansen-session', 'paimind.artifacts', 'read')
const page = (events: any[] = []) => ({ events, hasMore: false, projections: { asOfSeq: events.at(-1)?.event.seq ?? -1, values: {
  'paimind.artifacts': { schema: 'paimind.artifacts/v1', artifacts: [], traces: [] }, secret: 'NOT_FOR_OUTPUT',
} } })

describe('original native history artifact facts, not a new registry', () => {
  it('uses one fixed readonly native tail operation and exposes only the requested projection', () => {
    const wire = read()
    expect(wire.path).toBe('/api/session.history')
    expect(JSON.parse(wire.body)).toMatchObject({ method: 'session.history', payload: { sessionId: 'hansen-session', maxMessages: 10001 } })
    expect(wire.decode(reply(page()))).toEqual({ asOfSeq: -1, produced: [], projection: { schema: 'paimind.artifacts/v1', artifacts: [], traces: [] } })
  })
  it('reads only successful root mutation locations, never prose, reads, deletes, terminal or nested tool output', () => {
    const events = [event(0, 'turn/start', { turn: 1 }),
      call(1, 'write', { card: 'diff', locations: [{ path: 'outputs/客户报告.html' }] }), result(2, 'write'),
      call(3, 'edit', { card: 'generic', kind: 'edit', locations: [{ path: 'outputs/客户报告.html' }, { path: 'result.xlsx' }] }), result(4, 'edit'),
      call(5, 'failed', { card: 'diff', locations: [{ path: 'failed.pdf' }] }), result(6, 'failed', 1, true),
      call(7, 'read', { card: 'generic', kind: 'read', locations: [{ path: 'read.pdf' }] }), result(8, 'read'),
      call(9, 'delete', { card: 'generic', kind: 'delete', locations: [{ path: 'deleted.pdf' }] }), result(10, 'delete'),
      call(11, 'terminal', { card: 'terminal', locations: [{ path: 'guessed.pdf' }] }), result(12, 'terminal'),
      event(13, 'assistant/message', { message: { content: [{ type: 'text', text: 'Created guessed.pdf' }] } }),
      result(14, 'write', 1, false, 'replace'),
    ]
    const decoded = read().decode(reply(page(events)))
    expect(decoded.produced).toEqual([{ path: 'outputs/客户报告.html', seq: 2, time: 102 },
      { path: 'outputs/客户报告.html', seq: 4, time: 104 }, { path: 'result.xlsx', seq: 4, time: 104 }])
    expect(JSON.stringify(decoded)).not.toMatch(/PRIVATE_TOOL_CONTENT|NOT_FOR_OUTPUT|guessed/)
  })
  it('keeps same call identifiers in different native turns independent', () => {
    const events = [event(0, 'turn/start', { turn: 1 }), call(1, 'same', { card: 'diff', locations: [{ path: 'one.html' }] }), result(2, 'same'),
      event(3, 'turn/start', { turn: 2 }), call(4, 'same', { card: 'diff', locations: [{ path: 'two.pdf' }] }, 2), result(5, 'same', 2)]
    expect(read().decode(reply(page(events))).produced.map(row => row.path)).toEqual(['one.html', 'two.pdf'])
  })
  it('distinguishes an absent provider from a ready empty provider', () => {
    const value = page(); delete (value.projections.values as any)['paimind.artifacts']
    expect(read().decode(reply(value)).projection).toBeUndefined()
  })
  it.each(['more', 'missing-projection', 'cut', 'order', 'duplicate-turn', 'missing-turn', 'missing-call', 'cross-turn', 'bad-locations', 'bad-path', 'bad-outcome', 'too-many', 'huge'])('rejects %s rather than reporting a complete empty list', mode => {
    const value: any = page([event(0, 'turn/start', { turn: 1 }), call(1, 'write', { card: 'diff', locations: [{ path: 'report.pdf' }] }), result(2, 'write')])
    if (mode === 'more') value.hasMore = true
    if (mode === 'missing-projection') delete value.projections
    if (mode === 'cut') value.projections.asOfSeq++
    if (mode === 'order') value.events.reverse()
    if (mode === 'duplicate-turn') value.events[1] = event(1, 'turn/start', { turn: 1 })
    if (mode === 'missing-turn') value.events.shift()
    if (mode === 'missing-call') value.events.splice(1, 1)
    if (mode === 'cross-turn') value.events[2].event.data.turn = 2
    if (mode === 'bad-locations') value.events[1].view.view.locations = {}
    if (mode === 'bad-path') value.events[1].view.view.locations[0].path = 'bad\0.pdf'
    if (mode === 'bad-outcome') value.events[2].event.data.message.content[0].isError = 'true'
    if (mode === 'too-many') value.events = Array(10001).fill(value.events[0])
    if (mode === 'huge') value.projections.values.private = 'x'.repeat(2 * 1024 * 1024)
    expect(() => read().decode(reply(value))).toThrow()
  })
  it('rejects an uncorrelated reply and invalid selection before output', () => {
    expect(() => read().decode(reply(page(), 'foreign'))).toThrow()
    for (const id of ['', 'x'.repeat(201), 'x\n']) expect(() => prepareHarnessSessionProducedRead(id, 'paimind.artifacts', 'read')).toThrow()
  })
})

describe('original workspace artifact membership', () => {
  const row = (workspaceId = 'workspace-hansen', sessionIds = ['hansen-session']) => ({ workspaceId, sessionIds, path: '/workspace/hansen', title: 'Hansen', createdAt: '2026', updatedAt: '2026' })
  const wire = () => prepareHarnessSessionArtifactWorkspaceRead('hansen-session', 'read')
  it('projects only exact original membership, not title or path inference', () => {
    expect(wire().decode(reply({ items: [row(), row('workspace-alex', ['alex-session'])], archivedSessionIds: [] })))
      .toEqual({ workspaceId: 'workspace-hansen', path: '/workspace/hansen' })
  })
  it.each(['absent', 'ambiguous', 'duplicate-id', 'duplicate-session', 'path', 'many'])('rejects %s original membership', mode => {
    const value: any = { items: [row()], archivedSessionIds: [] }
    if (mode === 'absent') value.items[0].sessionIds = ['alex-session']
    if (mode === 'ambiguous') value.items.push(row('second'))
    if (mode === 'duplicate-id') value.items.push(row())
    if (mode === 'duplicate-session') value.items[0].sessionIds.push('hansen-session')
    if (mode === 'path') value.items[0].path = 'relative'
    if (mode === 'many') value.items = Array(1001).fill(row())
    expect(() => wire().decode(reply(value))).toThrow()
  })
})
