import { describe, expect, it } from 'vitest'
import { authoringInboxMessageId, correlateAuthoringTurn, hasAuthoringTurnCollision } from '../src/client/authoring-session.js'

const signed = (clientRpcId: string, nativeSessionId = 'authoring-alex') => `paimind-origin-v1.${Buffer.from(JSON.stringify({ nativeSessionId, clientRpcId })).toString('base64url')}.${'a'.repeat(43)}`
const message = (seq: number, rpcId: string) => ({ type: 'user/message', seq, data: { source: { kind: 'user', rpcId } } })
const events = [ { type: 'turn/start', seq: 4, data: { turn: 1 } }, message(7, signed('browser-id')),
  { type: 'user/message', seq: 8, data: { source: { kind: 'plugin' } } },
  { type: 'user/message', seq: 9, data: { source: { kind: 'skill-catalog' } } },
  { type: 'turn/end', seq: 977, data: { turn: 1, reason: { kind: 'completed' } } } ]
describe('authoring exact native correlation, not last completed message', () => {
  it('correlates managed history and inbox against the original HTTP ID and exact session', () => {
    const target = { turn: 1, userSeq: 7 }
    expect(correlateAuthoringTurn(events, 'browser-id', 'authoring-alex')).toEqual(target)
    expect(correlateAuthoringTurn(events, 'other-browser-id', 'authoring-alex')).toBeNull()
    expect(correlateAuthoringTurn(events, 'browser-id', 'authoring-hansen')).toBeNull()
    expect(hasAuthoringTurnCollision(events, target, 'browser-id', 'authoring-alex')).toBe(false)
    const inbox = { type: 'agent/inbox/spliced', data: { inserted: [{ id: 'native-item', source: { kind: 'user', rpcId: signed('browser-id') } }] } }
    expect(authoringInboxMessageId(inbox, 'browser-id', 'authoring-alex')).toBe('native-item')
    expect(authoringInboxMessageId(inbox, 'browser-id', 'authoring-hansen')).toBeNull()
  })
  it('rejects a second user message even when it reuses the same browser ID or cannot be projected', () => {
    for (const rpcId of [signed('other'), signed('browser-id'), 'paimind-origin-v1.legacy.invalid']) {
      expect(hasAuthoringTurnCollision([...events, message(10, rpcId)], { turn: 1, userSeq: 7 }, 'browser-id', 'authoring-alex')).toBe(true)
    }
  })
})
