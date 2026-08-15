import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/invariant.ts'

describe('runtime-orbs invariant companion', () => {
  it('registers and returns the Harness-owned disposer', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    await expect(apply({ invariants: { register } })).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith('@paimind/runtime-orbs', expect.any(Function))
  })
})
