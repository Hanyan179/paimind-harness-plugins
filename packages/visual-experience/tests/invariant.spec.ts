import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/invariant.js'

describe('visual experience invariant companion', () => {
  it('registers package ownership and returns the disposer', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    await expect(apply({ invariants: { register } })).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith('@paimind/visual-experience', expect.any(Function))
  })
})
