import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/invariant.ts'

describe('FP02 invariant companion', () => {
  it('registers and returns the ownership disposer', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    expect(name).toBe('paimind-launcher-invariant')
    expect(inject).toEqual(['invariants'])
    await expect(apply({ invariants: { register } })).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith('@paimind/launcher', expect.any(Function))
  })
})

