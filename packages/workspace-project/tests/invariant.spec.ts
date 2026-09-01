import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/invariant.js'

describe('FP04 invariant companion', () => {
  it('registers and returns the native disposer', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    expect(apply({ invariants: { register } })).toBe(dispose)
    expect(register).toHaveBeenCalledWith('@paimind/workspace-project', expect.any(Function))
    expect({ name, inject }).toEqual({
      name: 'paimind-workspace-project-invariant', inject: ['invariants'],
    })
  })
})
