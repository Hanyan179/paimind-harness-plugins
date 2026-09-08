import { describe, expect, it, vi } from 'vitest'
import type { PaimindInvariantContext } from '@hansen/harness-compat'
import { apply, inject, name } from '../src/invariant.ts'

describe('FP06-FP07 invariant companion', () => {
  it('reserves only package ownership and disposes through Harness invariants', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    const result = await apply({ invariants: { register } } satisfies PaimindInvariantContext)
    expect(name).toBe('paimind-artifacts-invariant')
    expect(inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@hansen/artifacts', expect.any(Function))
    result()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
