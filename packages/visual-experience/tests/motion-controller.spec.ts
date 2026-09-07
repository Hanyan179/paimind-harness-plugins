import { describe, expect, it, vi } from 'vitest'
import type { PaimindSettingsScopeSnapshot } from '@paimind/harness-compat'
import { PaimindExperienceModeController } from '../src/client/index.js'
import type { PaimindVisualExperienceSettings } from '../src/settings.js'

function fixture() {
  let snapshot: PaimindSettingsScopeSnapshot<PaimindVisualExperienceSettings> = {
    value: { mode: 'paimind', motion: 'system' }, status: 'ready', writable: true,
    base: {}, user: {}, revision: 1, mode: 'host',
  }
  const listeners = new Set<() => void>()
  const set = vi.fn(async (field: keyof PaimindVisualExperienceSettings, value: unknown) => {
    snapshot = { ...snapshot, value: { ...snapshot.value!, [field]: value }, revision: 2 }
    for (const cb of listeners) cb()
  })
  const controller = new PaimindExperienceModeController({
    getSnapshot: () => snapshot, subscribe: cb => { listeners.add(cb); return () => { listeners.delete(cb) } },
    set, unset: async () => {},
  })
  return { controller, set, listeners }
}

describe('visual preference mutations', () => {
  it('persists motion independently of visual mode and exposes rejection without losing the old value', async () => {
    const { controller, set } = fixture()
    await controller.setMotion('off')
    expect(controller.getSnapshot()).toMatchObject({ motion: 'off', mode: 'paimind', busy: false, error: false })
    set.mockRejectedValueOnce(new Error('offline'))
    await controller.setMotion('on')
    expect(controller.getSnapshot()).toMatchObject({ motion: 'off', busy: false, error: true })
    await controller.set('native')
    expect(controller.getSnapshot()).toMatchObject({ motion: 'off', mode: 'native', error: false })
    controller.dispose()
  })

  it('prevents overlapping revision writes and ignores late completion after disposal', async () => {
    const { controller, set, listeners } = fixture()
    let release!: () => void
    set.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    const pending = controller.setMotion('off')
    await controller.set('native')
    expect(set).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().busy).toBe(true)
    const snapshot = controller.getSnapshot()
    controller.dispose()
    release()
    await pending
    expect(controller.getSnapshot()).toBe(snapshot)
    expect(listeners.size).toBe(0)
  })

  it('does not report success when a conflict returns the unchanged host value', async () => {
    const { controller, set } = fixture()
    set.mockImplementationOnce(async () => {})
    await controller.setMotion('off')
    expect(controller.getSnapshot()).toMatchObject({ motion: 'system', busy: false, error: true })
    controller.dispose()
  })
})
