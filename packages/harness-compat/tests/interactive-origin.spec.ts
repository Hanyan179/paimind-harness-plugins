import { describe, expect, it } from 'vitest'
import { prepareHarnessInteractiveRequest, readHarnessSessionMutationRequest } from '../src/gateway-transport.js'

const payload = { sessionId: 'session-hansen', mode: 'queue', clientTimeZone: 'Asia/Shanghai',
  content: [{ type: 'text', text: '报价核对' }, { type: 'image', mediaType: 'image/png', data: 'AA==', name: 'quote.png' }] }
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value))
const envelope = (method = 'session.prompt', data: unknown = payload) => ({ type: 'client-request', rpcId: 'caller-id', method, payload: data })
const prepare = (value = envelope(), target = '/api/session.prompt') => prepareHarnessInteractiveRequest('POST', target, 'application/json', bytes(value))!
describe('native interactive provenance carrier', () => {
  it('changes only top-level RPC identity, preserving original content and timezone', () => {
    const original = envelope(), copy = structuredClone(original), request = prepare(original)
    expect(request.nativeSessionId).toBe('session-hansen')
    expect(request.clientRpcId).toBe('caller-id')
    expect(request.requiresPresetEligibility).toBe(true)
    expect(JSON.parse(Buffer.from(request.stamp('signed-origin')).toString())).toEqual({ ...copy, rpcId: 'signed-origin' })
    expect(original).toEqual(copy)
    expect(request.stamp('second-origin')).not.toEqual(request.stamp('signed-origin'))
  })
  it('scopes a continuable subagent prompt to its original child, preserving its parent', () => {
    const original = envelope('subagent.prompt', { parentSessionId: 'parent-hansen', childSessionId: 'child-hansen',
      mode: 'continuable', content: [{ type: 'text', text: '核对' }], clientTimeZone: 'Asia/Shanghai' })
    const request = prepare(original, '/api/subagent.prompt')
    expect(request.nativeSessionId).toBe('child-hansen')
    expect(request.requiresPresetEligibility).toBe(true)
    expect(JSON.parse(Buffer.from(request.stamp('signed')).toString())).toEqual({ ...original, rpcId: 'signed' })
  })
  it.each([{ ok: true, value: { accepted: true, projections: { rpcId: 'nested-native-id' } } },
    { ok: false, error: { code: 'session-not-found', message: 'Missing', details: { sessionId: 'session-hansen', rpcId: 'nested-native-id' } } }])(
    'restores only HTTP correlation for native result %j', result => {
      const original = { type: 'server-response', rpcId: 'signed', result }
      const restored = prepare().restoreResponse(bytes(original), 'signed')
      expect(JSON.parse(Buffer.from(restored).toString())).toEqual({ ...original, rpcId: 'caller-id' })
      expect(original.rpcId).toBe('signed')
    })
  it('leaves other endpoints and approval-response IDs untouched', () => {
    for (const path of ['/api/respond', '/api/session.history', '/api/events.mux']) {
      expect(prepareHarnessInteractiveRequest('POST', path, 'application/json', bytes({}))).toBeUndefined()
    }
  })
  it.each(['edit', 'remove', 'steer'])('stamps the actual %s queue actor without changing native item identity or action', kind => {
    const original = envelope('session.updateQueue', { sessionId: 'session-hansen', itemId: 'native-item',
      action: { kind, ...(kind === 'edit' ? { content: [{ type: 'text', text: '更新后的报价核对' }] } : {}) } })
    const request = prepare(original, '/api/session.updateQueue')
    expect(request.nativeSessionId).toBe('session-hansen')
    expect(request.requiresPresetEligibility).toBe(kind !== 'remove')
    expect(JSON.parse(Buffer.from(request.stamp('editor-origin')).toString())).toEqual({ ...original, rpcId: 'editor-origin' })
    expect(() => prepare(original, '/api/session.updateQueue?alias=1')).toThrow()
  })
  it('rejects alternate prompt carriers, malformed payloads and envelope mismatch', () => {
    for (const path of ['/api/session.prompt?x=1', '/api/../api/session.prompt', '/api/session.prompt#x']) expect(() => prepare(envelope(), path)).toThrow()
    for (const value of [envelope('session.history'), envelope('session.prompt', {}), { ...envelope(), rpcId: '' },
      { ...envelope(), rpcId: 'x'.repeat(201) }, { ...envelope(), rpcId: 'caller\n' }, { ...envelope(), rpcId: ' caller' },
      envelope('session.prompt', { ...payload, sessionId: 'x'.repeat(201) })]) expect(() => prepare(value)).toThrow()
    expect(() => prepareHarnessInteractiveRequest('GET', '/api/session.prompt', 'application/json', bytes(envelope()))).toThrow()
  })
  it('rejects uncorrelated, malformed, oversized and invalid-UTF8 replies', () => {
    const request = prepare()
    for (const value of [bytes({}), bytes({ type: 'server-response', rpcId: 'other', result: { ok: true, value: {} } }),
      Buffer.from([255]), Buffer.alloc(256 * 1024 + 1), Buffer.from('not-json')]) {
      expect(() => request.restoreResponse(value, 'signed')).toThrow()
    }
    for (const source of ['', 'x'.repeat(1537)]) expect(() => request.stamp(source)).toThrow()
  })
})

describe('native non-prompt session mutation scope', () => {
  const writes = [
    ['session.rename', { title: 'Renamed' }],
    ['session.selectModel', { provider: 'local-only', model: 'synthetic' }],
    ['goal.create', { objective: 'Check quotation' }],
    ['goal.edit', { ref: { id: 'goal-hansen', revision: 1 }, objective: 'Recheck quotation' }],
    ...['goal.resume', 'goal.complete', 'goal.clear'].map(method => [method, { ref: { id: 'goal-hansen', revision: 1 } }]),
  ] as Array<[string, object]>
  it.each(writes)('validates the original %s schema and preserves the request bytes', (method, fields) => {
    const original = bytes(envelope(method, { sessionId: 'session-hansen', ...fields })), before = Buffer.from(original)
    expect(readHarnessSessionMutationRequest('POST', '/api/' + method, 'application/json', original)).toBe('session-hansen')
    expect(original).toEqual(before)
    for (const alias of ['?alias=1', '#x']) expect(() => readHarnessSessionMutationRequest('POST', '/api/' + method + alias, 'application/json', original)).toThrow()
    expect(() => readHarnessSessionMutationRequest('POST', '/api/' + method, 'application/json', bytes(envelope(method, fields)))).toThrow()
    expect(() => readHarnessSessionMutationRequest('POST', '/api/' + method, 'application/json', bytes(envelope(method, { ...fields, sessionId: 'x'.repeat(201) })))).toThrow()
  })
  it.each(['session.history', 'session.attachment', 'session.models', 'session.cancel', 'subagent.interrupt', 'goal.pause', 'workspace.archiveSession'])(
    'does not misclassify read, stop or workspace ownership operation %s as a session-content mutation', method => {
      expect(readHarnessSessionMutationRequest('POST', '/api/' + method, 'application/json', bytes(envelope(method, { sessionId: 'session-hansen' })))).toBeUndefined()
    })
})
