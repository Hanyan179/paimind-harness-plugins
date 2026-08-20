import { describe, expect, it, vi } from 'vitest'
import {
  installHarnessAgentPresetSettingsNavigation,
  resolveHarnessAgentPresetSeatControl,
  type HarnessInspectableSlotRegistry,
} from '../src/index.js'

function slots(label: string, id = 'agent-presets'): HarnessInspectableSlotRegistry {
  return {
    entries: () => [{ options: { id, label: () => label, order: 12 } }],
    subscribe: () => () => {},
    getVersion: () => 1,
    inject: () => {},
    register: () => () => {},
  }
}

function settingsRow(label: string): HTMLButtonElement {
  document.body.innerHTML = `<div role="dialog"><nav><button type="button"><svg></svg><span>${label}</span></button></nav></div>`
  return document.querySelector('nav button')!
}

describe('Harness native Agent Presets settings navigation', () => {
  it('hides the exact native row, opens it, and restores it on disposal', () => {
    const button = settingsRow('Agent 预设')
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    const adapter = installHarnessAgentPresetSettingsNavigation(slots('Agent 预设'), document)

    expect(button.hidden).toBe(true)
    expect(button.style.getPropertyValue('display')).toBe('none')
    expect(button.style.getPropertyPriority('display')).toBe('important')
    expect(button.dataset.paimindHiddenSettingsSection).toBe('agent-presets')
    expect(adapter.open()).toBe(true)
    expect(clicked).toHaveBeenCalledTimes(1)

    adapter.dispose()
    expect(button.hidden).toBe(false)
    expect(button.style.getPropertyValue('display')).toBe('')
    expect(button.dataset.paimindHiddenSettingsSection).toBeUndefined()
  })

  it('fails open when the native id or rendered label does not match exactly', () => {
    const button = settingsRow('Agent 预设')
    const adapter = installHarnessAgentPresetSettingsNavigation(slots('Other', 'other'), document)
    expect(button.hidden).toBe(false)
    expect(adapter.open()).toBe(false)
    adapter.dispose()
  })

  it('opens the native Settings shell through its Slot marker even when another dialog trigger exists', () => {
    document.body.innerHTML = `
      <button type="button" aria-haspopup="dialog" aria-expanded="false"><span data-slot="settings.trigger">Settings</span></button>
      <button type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="Context usage"></button>
    `
    const settings = document.querySelector<HTMLElement>('[data-slot="settings.trigger"]')!.closest<HTMLButtonElement>('button')!
    const selected = vi.fn()
    settings.addEventListener('click', () => {
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      dialog.innerHTML = '<nav><button type="button"><span>Agent 预设</span></button></nav>'
      dialog.querySelector('button')!.addEventListener('click', selected)
      document.body.append(dialog)
    })
    const adapter = installHarnessAgentPresetSettingsNavigation(slots('Agent 预设'), document)

    expect(adapter.open()).toBe(true)
    expect(selected).toHaveBeenCalledTimes(1)
    expect(document.querySelector<HTMLButtonElement>('nav button')?.hidden).toBe(true)

    adapter.dispose()
  })
})

describe('Harness native Agent Preset selector control', () => {
  it('reuses the native hero selector so Session state and the visible checkmark move together', async () => {
    let current = { current: 'cordis', busy: false, error: null as string | null }
    const select = vi.fn(async (agentPreset: string) => { current = { ...current, current: agentPreset } })
    const registry: HarnessInspectableSlotRegistry = {
      entries: name => name === 'conversation.hero.agentPreset' ? [{
        options: {},
        inject: () => ({ hooks: { agentPresetSeat: { getSnapshot: () => current, subscribe: () => () => {} } }, load: async () => {}, select }),
      }] : [],
      subscribe: () => () => {}, getVersion: () => 1, inject: () => {}, register: () => () => {},
    }

    const control = resolveHarnessAgentPresetSeatControl(registry)
    expect(control?.getSnapshot().current).toBe('cordis')
    await control?.select('standard')
    expect(select).toHaveBeenCalledWith('standard')
    expect(control?.getSnapshot().current).toBe('standard')
  })

  it('fails closed when the native selector Slot shape is unavailable', () => {
    expect(resolveHarnessAgentPresetSeatControl(slots('Agent 预设'))).toBeNull()
  })
})
