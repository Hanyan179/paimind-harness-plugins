import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/invariant.js'

describe('category analysis adapter invariant', () => {
  it('registers the package boundary', () => {
    const register = vi.fn()
    apply({ invariants: { register } })
    expect(name).toBe('paimind-category-analysis-adapter-invariant')
    expect(inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@paimind/category-analysis-adapter', expect.any(Function))
  })
})
