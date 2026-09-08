import { describe, expect, it, vi } from 'vitest'
import { apply, name } from '../src/invariant.ts'

describe('Workspace Blueprint invariant companion', () => {
  it('registers an independently disposable package invariant', () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)

    expect(apply({ invariants: { register } })).toBe(dispose)
    expect(name).toBe('paimind-workspace-blueprints-invariant')
    expect(register).toHaveBeenCalledWith('@hansen/workspace-blueprints', expect.any(Function))
  })
})
