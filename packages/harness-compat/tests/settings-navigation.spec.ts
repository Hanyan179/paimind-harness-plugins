import { describe, expect, it, vi } from 'vitest'
import {
  installHarnessAgentPresetSettingsNavigation,
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
})
