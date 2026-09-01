import { describe, expect, it, vi } from 'vitest'
import type { PaimindInvariantContext } from '@paimind/harness-compat'
import { apply, inject, name } from '../src/invariant.js'

describe('conversation Artifact renderer invariant', () => {
  it('reserves package ownership and disposes through Harness invariants', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    const result = await apply({ invariants: { register } } satisfies PaimindInvariantContext)
    expect(name).toBe('paimind-conversation-artifact-renderer-invariant')
    expect(inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@paimind/conversation-artifact-renderer', expect.any(Function))
    result()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
