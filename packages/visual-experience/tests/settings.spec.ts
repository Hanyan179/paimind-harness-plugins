import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAIMIND_EXPERIENCE_MODE,
  PAIMIND_VISUAL_EXPERIENCE_NAMESPACE,
  decodePaimindVisualExperienceSettings,
} from '../src/settings.js'
import { resolveHarnessSettingsNamespace } from '@paimind/harness-compat'

describe('visual experience settings contract', () => {
  it('uses the namespaced reversible PAIMind default', () => {
    expect(PAIMIND_VISUAL_EXPERIENCE_NAMESPACE).toBe('paimind.visual-experience')
    expect(resolveHarnessSettingsNamespace(PAIMIND_VISUAL_EXPERIENCE_NAMESPACE)).toBe('paimind-visual-experience')
    expect(DEFAULT_PAIMIND_EXPERIENCE_MODE).toBe('paimind')
    expect(decodePaimindVisualExperienceSettings({ mode: 'native' })).toEqual({ mode: 'native', motion: 'system' })
    expect(decodePaimindVisualExperienceSettings({ mode: 'unknown' })).toEqual({ mode: 'paimind', motion: 'system' })
    expect(decodePaimindVisualExperienceSettings({ mode: 'native', motion: 'on' })).toEqual({ mode: 'native', motion: 'on' })
    expect(decodePaimindVisualExperienceSettings({ motion: 'off' })).toEqual({ mode: 'paimind', motion: 'off' })
    expect(decodePaimindVisualExperienceSettings({ motion: 'unknown' })).toEqual({ mode: 'paimind', motion: 'system' })
    expect(decodePaimindVisualExperienceSettings(null)).toBeUndefined()
  })
})
