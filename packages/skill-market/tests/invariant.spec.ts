import { describe, expect, it, vi } from 'vitest'
import { apply, name } from '../src/invariant.js'

describe('FP11 skill-market invariant companion', () => {
  it('registers an independently disposable package invariant', () => {
    const register = vi.fn(() => () => {}); apply({ invariants: { register } })
    expect(name).toBe('paimind-skill-market-invariant')
    expect(register).toHaveBeenCalledWith('@paimind/skill-market', expect.any(Function))
  })
})
