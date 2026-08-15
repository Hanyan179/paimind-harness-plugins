import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/invariant.js'

describe('Extension Center invariant companion', () => {
  it('registers package ownership', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    await expect(apply({ invariants: { register } })).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith('@paimind/extension-center', expect.any(Function))
  })
})
