import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/invariant.ts'

describe('FP05 adapter invariant companion', () => {
  it('registers package ownership and returns the disposer', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    expect(name).toBe('paimind-better-sidebar-adapter-invariant')
    expect(inject).toEqual(['invariants'])
    expect(apply({ invariants: { register } })).toBe(dispose)
    expect(register).toHaveBeenCalledWith('@paimind/better-sidebar-adapter', expect.any(Function))
  })
})
