import { describe, expect, it } from 'vitest'
import * as hostModule from '../src/typert.ts'
import { TYPERT_REMOTE } from '../src/remote.ts'

describe('Context Library Host Remote registration', () => {
  it('exports the named Host manifest required by the native loader', () => {
    expect(hostModule.TYPERT).toMatchObject({
      package: '@hansen/context-library',
      face: 'host',
      schemas: [],
      model: { services: [], events: [], objects: [] },
    })
    expect(hostModule.default).toBe(hostModule.TYPERT)
    expect(hostModule.TYPERT.invocations).toBe(TYPERT_REMOTE.descriptors)
    expect(hostModule.TYPERT.invocations.map(item => item.method)).toEqual(['request'])
  })
})
