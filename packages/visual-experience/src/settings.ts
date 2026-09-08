import type { PaimindSettingsFieldSpec } from '@hansen/harness-compat/host'

export const PAIMIND_VISUAL_EXPERIENCE_NAMESPACE = 'paimind.visual-experience'
export const PAIMIND_EXPERIENCE_MODES = ['paimind', 'native'] as const
export type PaimindExperienceMode = typeof PAIMIND_EXPERIENCE_MODES[number]

export interface PaimindVisualExperienceSettings {
  readonly mode: PaimindExperienceMode
}

export const DEFAULT_PAIMIND_EXPERIENCE_MODE: PaimindExperienceMode = 'paimind'

export const PAIMIND_VISUAL_EXPERIENCE_FIELDS: Readonly<Record<keyof PaimindVisualExperienceSettings, PaimindSettingsFieldSpec>> = Object.freeze({
  mode: Object.freeze({
    kind: 'enum',
    values: PAIMIND_EXPERIENCE_MODES,
    default: DEFAULT_PAIMIND_EXPERIENCE_MODE,
    description: 'PAIMind visual experience or the untouched native Harness presentation.',
  }),
})

export function decodePaimindVisualExperienceSettings(value: unknown): PaimindVisualExperienceSettings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const mode = (value as { readonly mode?: unknown }).mode
  return PAIMIND_EXPERIENCE_MODES.includes(mode as PaimindExperienceMode)
    ? Object.freeze({ mode: mode as PaimindExperienceMode })
    : Object.freeze({ mode: DEFAULT_PAIMIND_EXPERIENCE_MODE })
}
