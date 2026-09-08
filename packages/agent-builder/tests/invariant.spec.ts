import { describe, expect, it, vi } from 'vitest'
import { apply, name } from '../src/invariant.js'

describe('FP10 invariant registration', () => {
  it('registers only the independent Agent Builder package', () => {
    const register = vi.fn(() => () => {})
    apply({ invariants: { register } })
    expect(name).toBe('paimind-agent-builder-invariant')
    expect(register).toHaveBeenCalledWith('@hansen/agent-builder', expect.any(Function))
  })
})
