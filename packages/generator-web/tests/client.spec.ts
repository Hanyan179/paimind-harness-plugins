import { describe, expect, it } from 'vitest'
import { createClientContextFixture } from '@hansen/testkit'
import { apply } from '../src/client/index.js'

describe('R2 generator Extension Center contribution', () => {
  it('advertises the real host capability without adding navigation', () => {
    const fixture = createClientContextFixture()
    apply(fixture.context)
    const entry = fixture.slots.find(row => row.injectedName === 'paimind.extension')
    expect(entry?.inject?.()).toMatchObject({ descriptor: {
      id: 'paimind:generator-web', category: 'content-rendering', surface: 'conversation',
    } })
  })
})
