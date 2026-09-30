import { describe, expect, it } from 'vitest'
import { createHarnessHostHealthReadback, verifyHarnessHostHealthReadback } from '../src/gateway-transport.js'
const value = { version: '0.0.1', cwd: '/private', home: '/private', attachedSessions: 0, canOpenPath: false }
const reply = (data: unknown = value, rpcId = 'health') => JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value: data } })
describe('original API health, never HTML or user-content inspection', () => {
  it('uses the exact empty host.describe request', () => {
    const wire = createHarnessHostHealthReadback('health')
    expect(wire.path).toBe('/api/host.describe')
    expect(JSON.parse(wire.body)).toEqual({ type: 'client-request', rpcId: 'health', method: 'host.describe', payload: {} })
    expect(verifyHarnessHostHealthReadback(reply(), 'health')).toBeUndefined()
  })
  it('rejects uncorrelated, incomplete, error, oversized and non-RPC replies without returning private fields', () => {
    for (const text of [reply({}, 'health'), reply(value, 'wrong'), '<html>private</html>', 'x'.repeat(65537),
      JSON.stringify({ type: 'server-response', rpcId: 'health', result: { ok: false, error: { code: 'internal', message: 'private', details: {} } } })]) {
      expect(() => verifyHarnessHostHealthReadback(text, 'health')).toThrow('Native host health unavailable')
    }
    expect(() => createHarnessHostHealthReadback('')).toThrow()
  })
})
