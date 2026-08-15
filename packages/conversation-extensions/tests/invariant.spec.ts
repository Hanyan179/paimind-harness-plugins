import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/invariant.ts'

describe('conversation-extensions invariant companion', () => {
  it('registers and returns the Harness-owned disposer', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    await expect(apply({ invariants: { register } })).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith('@paimind/conversation-extensions', expect.any(Function))
  })
})

