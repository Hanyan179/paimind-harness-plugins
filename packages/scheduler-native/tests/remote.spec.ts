import { describe, expect, it } from 'vitest'
import TYPERT_REMOTE, { PAIMIND_SCHEDULE_REMOTE_DESCRIPTORS } from '../src/remote.ts'
import TYPERT from '../src/typert.ts'

describe('Harness-native Schedule remote contract', () => {
  it('exposes one strict read projection and no shadow mutations', () => {
    expect(TYPERT_REMOTE.package).toBe('@paimind/scheduler')
    expect(TYPERT.package).toBe('@paimind/scheduler')
    expect(PAIMIND_SCHEDULE_REMOTE_DESCRIPTORS.map(item => item.method)).toEqual(['list'])
    expect(PAIMIND_SCHEDULE_REMOTE_DESCRIPTORS[0]?.result.mode).toBe('strict')
  })
})
