import { describe, expect, it } from 'vitest'
import { readHarnessPromptCorrelation } from '../src/prompt-correlation.js'

// Deliberately synthetic signatures: this UI helper parses display metadata;
// real signature/current-login rejection is covered by Identity integration.
const origin = (payload: unknown) => `paimind-origin-v1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${'a'.repeat(43)}`
const read = (rpcId: unknown, sessionId = 'session-alex') => readHarnessPromptCorrelation({ kind: 'user', rpcId }, sessionId)
describe('read-only native prompt correlation projection', () => {
  it('preserves standalone IDs and projects exact managed session metadata without changing input', () => {
    expect(read('original-browser-id')).toBe('original-browser-id')
    const payload = { nativeSessionId: 'session-alex', clientRpcId: '浏览器-01', nonce: 'nonce' }
    const source = { kind: 'user', rpcId: origin(payload) }, original = structuredClone(source)
    expect(readHarnessPromptCorrelation(source, 'session-alex')).toBe('浏览器-01')
    expect(source).toEqual(original)
    expect(read(source.rpcId, 'session-hansen')).toBeNull()
    expect(readHarnessPromptCorrelation({ ...source, kind: 'tool' }, 'session-alex')).toBeNull()
  })
  it('does not invent correlation for legacy, delegated, job or invalid metadata', () => {
    for (const payload of [{ nativeSessionId: 'session-alex' }, null, [],
      ...[undefined, null, 1, '', 'x'.repeat(201), ' x', 'x\n'].map(clientRpcId => ({ nativeSessionId: 'session-alex', clientRpcId })),
      { nativeSessionId: 'session-alex', clientRpcId: 'id', delegatedPresetId: 'child' },
      { nativeSessionId: 'session-alex', clientRpcId: 'id', nativeJobId: 'job' }]) expect(read(origin(payload))).toBeNull()
  })
  it('fails closed on malformed managed carriers, encoding, size and other source kinds', () => {
    for (const source of [null, {}, { kind: 'user' }, { kind: 'tool', rpcId: 'id' }]) {
      expect(readHarnessPromptCorrelation(source, 'session-alex')).toBeNull()
    }
    for (const rpcId of ['', 1, ' x', 'x\n', 'x'.repeat(201),
      origin({ nativeSessionId: 'session-alex', clientRpcId: 'id' }).replace('v1.', 'v2.'),
      `paimind-origin-v1.e30=.${'a'.repeat(43)}`, `paimind-origin-v1.__8.${'a'.repeat(43)}`,
      'paimind-origin-v1.' + 'a'.repeat(8192), 'paimind-origin-v1.invalid.signature']) expect(read(rpcId)).toBeNull()
  })
})
