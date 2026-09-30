// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { prepareHarnessAgentPresetRequest } from '../src/gateway-transport.js'

const request = (kind: string, payload: object = {}) => Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'call-id', method: 'agentPreset.' + kind, payload }))
const response = (value: object, rpcId = 'call-id') => Buffer.from(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } }))
const row = (id: string) => ({ id, trust: 'user', isDefault: false, name: 'Original name', description: 'Original description' })
const session = (kind: 'create' | 'fork', payload: object) => prepareHarnessAgentPresetRequest('POST', '/api/session.' + kind, 'application/json',
  Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'call-id', method: 'session.' + kind, payload })))!
const list = () => prepareHarnessAgentPresetRequest('POST', '/api/agentPreset.list', 'application/json', request('list'))!
describe('original native preset response projection', () => {
  it('preserves original fields, ordering, labels and correlation; only removes selected rows', () => {
    const bytes = response({ presets: [row('a'), row('b')], authorable: true, hasDocument: false, extension: 'unchanged' })
    const decoded = list().decodeResponse(bytes)
    expect(decoded.presetIds).toEqual(['a', 'b'])
    expect(JSON.parse(Buffer.from(decoded.project(['b'])).toString())).toEqual({ type: 'server-response', rpcId: 'call-id',
      result: { ok: true, value: { presets: [row('b')], authorable: true, hasDocument: false, extension: 'unchanged' } } })
    expect(JSON.parse(bytes.toString()).result.value.presets).toHaveLength(2)
    expect(() => decoded.project(['new-id'])).toThrow()
    expect(() => decoded.project(['b', 'b'])).toThrow()
  })
  it('keeps an original owner refusal byte-identical, not an empty success', () => {
    const bytes = Buffer.from(JSON.stringify({ type: 'server-response', rpcId: 'call-id', result: { ok: false, error: { code: 'internal', message: 'Unavailable', details: {} } } }))
    const decoded = list().decodeResponse(bytes)
    expect(decoded.presetIds).toEqual([])
    expect(Buffer.from(decoded.project([]))).toEqual(bytes)
  })
  it('also projects the native not-found suggestion list without converting a refusal to success', () => {
    const selected = prepareHarnessAgentPresetRequest('POST', '/api/agentPreset.read', 'application/json', request('read', { agentPreset: 'unknown' }))!
    const bytes = Buffer.from(JSON.stringify({ type: 'server-response', rpcId: 'call-id', result: { ok: false, error: {
      code: 'agent-preset-not-found', message: 'Available a, withdrawn-b', details: { agentPreset: 'unknown', available: ['a', 'withdrawn-b'] } } } }))
    const decoded = selected.decodeResponse(bytes), result = Buffer.from(decoded.project(['a'])).toString()
    expect(decoded.requiresSelection).toBe(false)
    expect(JSON.parse(result)).toMatchObject({ result: { ok: false, error: { code: 'agent-preset-not-found', details: { available: ['a'] } } } })
    expect(result).not.toContain('withdrawn-b')
  })
  it.each(['read', 'select'])('validates exact %s identity and refuses to project a different preset', kind => {
    const selected = prepareHarnessAgentPresetRequest('POST', '/api/agentPreset.' + kind, 'application/json', request(kind, { agentPreset: 'a', sessionId: 's' }))!
    const bytes = response(kind === 'read' ? { agentPreset: 'a', content: 'Native bytes', trust: 'user' } : { agentPreset: 'a' })
    expect(selected.presetId).toBe('a')
    expect(Buffer.from(selected.decodeResponse(bytes).project(['a']))).toEqual(bytes)
    expect(() => selected.decodeResponse(bytes).project([])).toThrow()
    expect(() => selected.decodeResponse(response({ agentPreset: 'b', content: '', trust: 'user' }))).toThrow()
  })
  it.each([
    response({ presets: [row('a')], authorable: true, hasDocument: false }, 'other-call'),
    response({ presets: [row('a'), row('a')], authorable: true, hasDocument: false }),
    response({ presets: [row('x\u0000y')], authorable: true, hasDocument: false }),
    response({ presets: [row('x'.repeat(201))], authorable: true, hasDocument: false }),
    response({ presets: [row('a')], authorable: 'yes', hasDocument: false }),
    response({ presets: Array.from({ length: 4097 }, (_, i) => row(String(i))), authorable: true, hasDocument: false }),
    Buffer.alloc(1024 * 1024 + 1), Buffer.from('{'), Buffer.from([255]),
  ])('rejects malformed, oversized or uncorrelated native data', bytes => { expect(() => list().decodeResponse(bytes)).toThrow() })
  it.each(['/api/agentPreset.list?alias=1', '/api/agentPreset.read?alias=1', '/api/agentPreset.select?alias=1'])('rejects aliased carrier %s', target => {
    expect(() => prepareHarnessAgentPresetRequest('POST', target, 'application/json', request('list'))).toThrow()
  })
  it('does not rewrite session history or unrelated RPCs', () => {
    expect(prepareHarnessAgentPresetRequest('POST', '/api/session.history', 'application/json', Buffer.from('{}'))).toBeUndefined()
    expect(prepareHarnessAgentPresetRequest('GET', '/', undefined, Buffer.alloc(0))).toBeUndefined()
  })
  it('preserves explicit native creation identity and requires the selected preset', () => {
    const selected = session('create', { sessionId: 'new-session', agentPreset: 'permitted' })
    const bytes = response({ sessionId: 'new-session', agentPreset: 'permitted' }), decoded = selected.decodeResponse(bytes)
    expect(selected).toMatchObject({ kind: 'create', presetId: 'permitted' })
    expect(decoded.presetIds).toEqual(['permitted']); expect(decoded.requiresSelection).toBe(true)
    expect(Buffer.from(decoded.project(['permitted']))).toEqual(bytes)
    expect(() => decoded.project([])).toThrow()
    for (const value of [{ sessionId: 'other-session', agentPreset: 'permitted' }, { sessionId: 'new-session', agentPreset: 'other-preset' }, { sessionId: 'new-session' }]) {
      expect(() => selected.decodeResponse(response(value))).toThrow()
    }
  })
  it('pins a resolved default without changing the caller session/workspace identity or RPC correlation', () => {
    const original = { type: 'client-request', rpcId: 'call-id', method: 'session.create', payload: { sessionId: 'new-id', workspaceId: 'workspace-hansen' } }
    const bytes = Buffer.from(JSON.stringify(original))
    const selected = prepareHarnessAgentPresetRequest('POST', '/api/session.create', 'application/json', bytes)!
    expect(selected.createSessionId).toBe('new-id')
    const pinned = selected.pinCreationPreset('native-default')
    expect(JSON.parse(Buffer.from(pinned).toString())).toEqual({ ...original, payload: { ...original.payload, agentPreset: 'native-default' } })
    expect(JSON.parse(bytes.toString())).toEqual(original)
    const parsed = prepareHarnessAgentPresetRequest('POST', '/api/session.create', 'application/json', pinned)!
    expect(parsed.presetId).toBe('native-default')
    expect(() => parsed.pinCreationPreset('different')).toThrow()
    expect(() => selected.pinCreationPreset('')).toThrow()
    expect(() => list().pinCreationPreset('standard')).toThrow()
  })
  it('preserves history-only resume metadata without treating it as a preset selection', () => {
    const selected = session('create', { sessionId: 'old-session' })
    const bytes = response({ sessionId: 'old-session', agentPreset: 'withdrawn' }), decoded = selected.decodeResponse(bytes)
    expect(selected.presetId).toBeUndefined(); expect(decoded.presetIds).toEqual([]); expect(decoded.requiresSelection).toBe(false)
    expect(Buffer.from(decoded.project([]))).toEqual(bytes)
    expect(() => selected.decodeResponse(response({ sessionId: 'replacement-session', agentPreset: 'withdrawn' }))).toThrow()
  })
  it('uses only the native fork source identity and preserves the original child response', () => {
    const selected = session('fork', { sessionId: 'source-session', atSeq: 4 })
    const bytes = response({ sessionId: 'child-session' }), decoded = selected.decodeResponse(bytes)
    expect(selected).toMatchObject({ kind: 'fork', forkSourceSessionId: 'source-session' })
    expect(selected.presetId).toBeUndefined(); expect(decoded.presetIds).toEqual([])
    expect(Buffer.from(decoded.project([]))).toEqual(bytes)
    expect(() => selected.decodeResponse(response({ sessionId: 1 }))).toThrow()
    expect(() => selected.decodeResponse(response({ sessionId: 'child-session' }, 'different-request'))).toThrow()
  })
  it.each(['create', 'fork'] as const)('rejects aliased or method-mismatched session %s carriers', kind => {
    const body = Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'call-id', method: 'session.' + kind,
      payload: { sessionId: 'source', agentPreset: 'selected' } }))
    expect(() => prepareHarnessAgentPresetRequest('POST', '/api/session.' + kind + '?alias=1', 'application/json', body)).toThrow()
    expect(() => prepareHarnessAgentPresetRequest('POST', '/api/session.' + (kind === 'create' ? 'fork' : 'create'), 'application/json', body)).toThrow()
    expect(() => prepareHarnessAgentPresetRequest('GET', '/api/session.' + kind, 'application/json', body)).toThrow()
  })
})
