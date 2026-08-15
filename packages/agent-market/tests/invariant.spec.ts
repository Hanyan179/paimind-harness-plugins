import { describe, expect, it, vi } from 'vitest'
import { apply, name } from '../src/invariant.js'

describe('FP09 agent-market invariant companion', () => {
  it('registers an independently disposable package invariant', () => {
    const register = vi.fn(() => () => {})
    apply({ invariants: { register } })
    expect(name).toBe('paimind-agent-market-invariant')
    expect(register).toHaveBeenCalledWith('@paimind/agent-market', expect.any(Function))
  })
})
