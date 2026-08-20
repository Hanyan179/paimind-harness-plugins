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
    expect(decodePaimindVisualExperienceSettings({ mode: 'native' })).toEqual({ mode: 'native' })
    expect(decodePaimindVisualExperienceSettings({ mode: 'unknown' })).toEqual({ mode: 'paimind' })
    expect(decodePaimindVisualExperienceSettings(null)).toBeUndefined()
  })
})
