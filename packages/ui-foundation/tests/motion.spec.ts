import { afterEach, describe, expect, it, vi } from 'vitest'
import { installPaimindMotionPreference, readPaimindMotion, resolvePaimindMotion, subscribePaimindMotion } from '../src/motion.js'

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-paimind-motion')
  document.documentElement.removeAttribute('data-paimind-motion-preference')
})

describe('shared motion contract', () => {
  it.each([
    ['system', false, true], ['system', true, false],
    ['on', false, true], ['on', true, true],
    ['off', false, false], ['off', true, false],
  ] as const)('resolves %s with system reduced=%s to enabled=%s', (preference, systemReduced, enabled) => {
    expect(resolvePaimindMotion(preference, systemReduced)).toBe(enabled)
  })

  it('projects cross-bundle changes, follows live system changes, and cleans up on source unload', async () => {
    const listeners = new Set<() => void>()
    const media = { matches: false, addEventListener: (_: string, cb: () => void) => listeners.add(cb), removeEventListener: (_: string, cb: () => void) => listeners.delete(cb) }
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    const source = installPaimindMotionPreference()
    const changed = vi.fn()
    const stop = subscribePaimindMotion(changed)
    expect(readPaimindMotion()).toBe(true)
    source.set('off')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(changed).toHaveBeenCalled()
    expect(readPaimindMotion()).toBe(false)
    source.set('system')
    media.matches = true
    for (const cb of listeners) cb()
    expect(document.documentElement).toHaveAttribute('data-paimind-motion', 'off')
    source.set('on')
    expect(readPaimindMotion()).toBe(true)
    source.dispose()
    expect(document.documentElement).not.toHaveAttribute('data-paimind-motion-preference')
    expect(document.documentElement).not.toHaveAttribute('data-paimind-motion')
    expect(readPaimindMotion()).toBe(false)
    stop()
    expect(listeners.size).toBe(0)
    vi.unstubAllGlobals()
  })
})
