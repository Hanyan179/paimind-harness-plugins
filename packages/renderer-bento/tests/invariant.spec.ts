import { describe, expect, it, vi } from 'vitest'
import type { PaimindInvariantContext } from '@paimind/harness-compat'
import { apply, inject, name } from '../src/invariant.ts'

describe('FP07 Bento invariant companion', () => {
  it('reserves only package ownership and disposes through Harness invariants', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    const result = await apply({ invariants: { register } } satisfies PaimindInvariantContext)
    expect(name).toBe('paimind-renderer-bento-invariant')
    expect(inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@paimind/renderer-bento', expect.any(Function))
    result()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
