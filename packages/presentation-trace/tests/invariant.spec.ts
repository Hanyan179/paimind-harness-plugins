import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/invariant.ts'

describe('FP08 invariant registration', () => {
  it('registers an independently disposable package boundary', () => {
    const register = vi.fn()
    apply({ invariants: { register } })
    expect(name).toBe('paimind-presentation-trace-invariant')
    expect(inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@hansen/presentation-trace', expect.any(Function))
  })
})
