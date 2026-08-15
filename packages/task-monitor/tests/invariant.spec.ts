import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/invariant.ts'

describe('FP05 task-monitor invariant companion', () => {
  it('registers package ownership and returns the disposer', async () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    expect(name).toBe('paimind-task-monitor-invariant')
    expect(inject).toEqual(['invariants'])
    await expect(apply({ invariants: { register } })).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith('@paimind/task-monitor', expect.any(Function))
  })
})
