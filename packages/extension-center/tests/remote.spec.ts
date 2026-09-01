import { describe, expect, it } from 'vitest'
import {
  PAIMIND_FEATURE_PACK_REMOTE_DESCRIPTORS,
  TYPERT_REMOTE,
} from '../src/remote.ts'
import { TYPERT } from '../src/typert.ts'

describe('Product Feature Pack Remote contract', () => {
  it('publishes one strict descriptor set to the Host and Client faces', () => {
    expect(TYPERT.package).toBe('@paimind/extension-center')
    expect(TYPERT.face).toBe('host')
    expect(TYPERT.invocations).toBe(PAIMIND_FEATURE_PACK_REMOTE_DESCRIPTORS)
    expect(TYPERT_REMOTE.descriptors).toBe(PAIMIND_FEATURE_PACK_REMOTE_DESCRIPTORS)
    expect(PAIMIND_FEATURE_PACK_REMOTE_DESCRIPTORS.map(item => item.method)).toEqual([
      'describe', 'mutate',
    ])
    expect(PAIMIND_FEATURE_PACK_REMOTE_DESCRIPTORS.every(item => item.result.mode === 'strict')).toBe(true)
  })
})
