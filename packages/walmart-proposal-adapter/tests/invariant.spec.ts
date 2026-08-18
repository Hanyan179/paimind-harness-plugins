import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/invariant.js'

describe('Walmart adapter invariant', () => {
  it('registers the package boundary', () => {
    const register = vi.fn()
    apply({ invariants: { register } })
    expect(name).toBe('paimind-walmart-proposal-adapter-invariant')
    expect(inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@paimind/walmart-proposal-adapter', expect.any(Function))
  })
})
