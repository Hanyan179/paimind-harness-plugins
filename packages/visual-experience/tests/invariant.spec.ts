import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/invariant.js'

describe('visual experience invariant companion', () => {
  it('registers package ownership and returns the disposer', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    expect(apply({ invariants: { register } })).toBe(dispose)
    expect(register).toHaveBeenCalledWith('@hansen/visual-experience', expect.any(Function))
  })
})
