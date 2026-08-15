import { describe, expect, it } from 'vitest'
import { CONVERSATION_CAPABILITIES } from '../src/index.ts'
import { apply as applyClient } from '../src/client/index.ts'

describe('FP03 native conversation capability contract', () => {
  it('keeps every migrated runtime surface under one explicit owner', () => {
    expect(CONVERSATION_CAPABILITIES.map(capability => capability.id)).toEqual([
      'questions',
      'plan-progress',
      'image-attachments',
      'workspace-file-references',
      'document-upload',
      'deliverables',
      'failure-recovery',
      'native-trajectory-rows',
    ])
    expect(CONVERSATION_CAPABILITIES.filter(capability => capability.disposition === 'harness-native'))
      .toHaveLength(7)
    expect(CONVERSATION_CAPABILITIES.find(capability => capability.id === 'document-upload'))
      .toMatchObject({ disposition: 'later-paimind-package', owner: 'FP04/FP06' })
    expect(CONVERSATION_CAPABILITIES.filter(capability => capability.duplicateUiForbidden))
      .toHaveLength(7)
  })

  it('is immutable diagnostic metadata rather than a mutable state store', () => {
    expect(Object.isFrozen(CONVERSATION_CAPABILITIES)).toBe(true)
  })

  it('registers no client slot or replacement renderer', () => {
    expect(() => applyClient()).not.toThrow()
  })
})

