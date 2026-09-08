import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/invariant.js'

describe('Paramont branding invariant', () => {
  it('registers package ownership', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    const result = await apply({ invariants: { register } })
    expect(register).toHaveBeenCalledWith('@hansen/branding', expect.any(Function))
    result()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
