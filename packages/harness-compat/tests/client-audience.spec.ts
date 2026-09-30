import { describe, expect, it, vi } from 'vitest'
import { PAIMIND_CLIENT_AUDIENCE_GLOBAL as key, readPaimindClientAudience } from '../src/client-audience.js'

describe('non-authoritative image audience presentation', () => {
  it('retains default presentation only when the deployment marker is absent', () => {
    expect(readPaimindClientAudience({})).toBe('default')
    expect(readPaimindClientAudience({ [key]: { schemaVersion: 1, audience: 'member' } })).toBe('member')
  })
  it.each([undefined, null, true, [], {}, { schemaVersion: 2, audience: 'member' },
    { schemaVersion: 1, audience: 'admin' }, { schemaVersion: 1, audience: 'member', userId: 'Hansen' }])(
    'treats unknown or identity-bearing metadata as invalid without granting management presentation: %j', value => {
      expect(readPaimindClientAudience({ [key]: value })).toBe('invalid')
    })
  it('does not evaluate getters, inherited markers or throwing proxies', () => {
    const getter = vi.fn(() => ({ schemaVersion: 1, audience: 'member' }))
    expect(readPaimindClientAudience(Object.defineProperty({}, key, { get: getter }))).toBe('invalid')
    expect(readPaimindClientAudience({ [key]: { schemaVersion: 1, get audience() { return getter() } } })).toBe('invalid')
    expect(readPaimindClientAudience(Object.create({ [key]: { schemaVersion: 1, audience: 'member' } }))).toBe('invalid')
    expect(readPaimindClientAudience(new Proxy({}, { has: () => { throw Error('invalid target') } }))).toBe('invalid')
    expect(getter).not.toHaveBeenCalled()
  })
})
