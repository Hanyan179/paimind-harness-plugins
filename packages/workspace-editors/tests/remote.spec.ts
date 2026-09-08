import { describe, expect, it } from 'vitest'
import * as hostModule from '../src/typert.ts'
import { TYPERT_REMOTE } from '../src/remote.ts'

describe('Workspace Editors Host Remote registration', () => {
  it('exports both methods in the named Host manifest required by the native loader', () => {
    expect(hostModule.TYPERT).toMatchObject({
      package: '@hansen/workspace-editors',
      face: 'host',
      schemas: [],
      model: { services: [], events: [], objects: [] },
    })
    expect(hostModule.default).toBe(hostModule.TYPERT)
    expect(hostModule.TYPERT.invocations).toBe(TYPERT_REMOTE.descriptors)
    expect(hostModule.TYPERT.invocations.map(item => item.method)).toEqual(['call', 'list'])
  })
})
