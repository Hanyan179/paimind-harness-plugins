// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { prepareHarnessTurnSubmission } from '../src/gateway-transport.js'

const version = randomBytes(32).toString('base64url'), commandId = randomUUID()
const source = 'paimind-origin-v1.e30.' + randomBytes(32).toString('base64url')
describe('original prompt turn codec, not execution authority', () => {
  it('preserves text exactly in the original queue carrier and correlates an acknowledgement', () => {
    const text = '  保留\n\t whitespace  ', wire = prepareHarnessTurnSubmission('owned', text, commandId, version)
    expect(wire.correlation.length).toBeLessThanOrEqual(200)
    expect(JSON.parse(wire.body(source))).toEqual({ type: 'client-request', rpcId: source, method: 'session.prompt',
      payload: { sessionId: 'owned', mode: 'queue', content: [{ type: 'text', text }] } })
    const reply = (rpcId: string, accepted: unknown) => JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value: { accepted } } })
    expect(wire.verify(reply(source, true), source)).toBe(true)
    expect(wire.verify(reply(source, false), source)).toBe(false)
    expect(() => wire.verify(reply('foreign', true), source)).toThrow()
    expect(() => wire.body('unsigned')).toThrow()
  })
  it.each(['', 'a/b', 'a\\b', 'a\0b', 'x'.repeat(201)])('rejects invalid session IDs %j', id => {
    expect(() => prepareHarnessTurnSubmission(id, 'text', commandId, version)).toThrow()
  })
  it('enforces text, canonical versions and UUID v4 command bounds without trimming input', () => {
    for (const args of [['', commandId, version], ['x'.repeat(65537), commandId, version],
      ['text', 'forged', version], ['text', commandId, 'a'.repeat(43)]]) {
      expect(() => prepareHarnessTurnSubmission('owned', args[0]!, args[1]!, args[2]!)).toThrow()
    }
    expect(prepareHarnessTurnSubmission('owned', 'x'.repeat(65536), commandId, version).selection.commandId).toBe(commandId)
  })
})
