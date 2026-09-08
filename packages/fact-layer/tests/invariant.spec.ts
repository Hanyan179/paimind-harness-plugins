import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/invariant.js'

describe('fact-layer invariant', () => {
  it('registers the package boundary', () => {
    const register = vi.fn()
    apply({ invariants: { register } })
    expect(name).toBe('paimind-fact-layer-invariant')
    expect(inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@hansen/fact-layer', expect.any(Function))
  })
})
