import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/invariant.ts'

describe('runtime-orbs invariant companion', () => {
  it('registers and returns the Harness-owned disposer', () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    expect(apply({ invariants: { register } })).toBe(dispose)
    expect(register).toHaveBeenCalledWith('@hansen/runtime-orbs', expect.any(Function))
  })

  it('releases the real Harness invariant registration before a second activation', async () => {
    const rootRequire = createRequire(import.meta.url)
    const invariantsRequire = createRequire(rootRequire.resolve('@deepseek-ai/dsh-invariants/package.json'))
    const cordisUrl = pathToFileURL(invariantsRequire.resolve('@deepseek-ai/cordis')).href
    const { Context } = await import(/* @vite-ignore */ cordisUrl)
    const ctx = new Context()
    const registry = ctx.plugin(InvariantRegistry)
    await registry
    const plugin = { apply, inject }
    const first = ctx.plugin(plugin)
    await first
    await first.dispose()
    const second = ctx.plugin(plugin)
    await second
    await second.dispose()
    await registry.dispose()
  })
})
