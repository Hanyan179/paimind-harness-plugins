import { PAIMIND_MOTION_PREFERENCES, type PaimindMotionPreference } from '@hansen/ui-foundation'
import type { PaimindSettingsFieldSpec } from '@hansen/harness-compat/host'

export const PAIMIND_VISUAL_EXPERIENCE_NAMESPACE = 'paimind.visual-experience'
export const PAIMIND_EXPERIENCE_MODES = ['paimind', 'native'] as const
export type PaimindExperienceMode = typeof PAIMIND_EXPERIENCE_MODES[number]

export interface PaimindVisualExperienceSettings {
  readonly mode: PaimindExperienceMode
  /** Omitted by older callers; the decoder supplies system. */
  readonly motion?: PaimindMotionPreference
}

export const DEFAULT_PAIMIND_EXPERIENCE_MODE: PaimindExperienceMode = 'paimind'

export const PAIMIND_VISUAL_EXPERIENCE_FIELDS: Readonly<Record<keyof PaimindVisualExperienceSettings, PaimindSettingsFieldSpec>> = Object.freeze({
  motion: Object.freeze({
    kind: 'enum', values: PAIMIND_MOTION_PREFERENCES, default: 'system',
    description: 'Interface motion: follow system, explicitly on, or static.',
  }),
  mode: Object.freeze({
    kind: 'enum',
    values: PAIMIND_EXPERIENCE_MODES,
    default: DEFAULT_PAIMIND_EXPERIENCE_MODE,
    description: 'PAIMind visual experience or the untouched native Harness presentation.',
  }),
})

export function decodePaimindVisualExperienceSettings(value: unknown): PaimindVisualExperienceSettings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as { readonly mode?: unknown; readonly motion?: unknown }
  return Object.freeze({
    mode: PAIMIND_EXPERIENCE_MODES.includes(raw.mode as PaimindExperienceMode) ? raw.mode as PaimindExperienceMode : DEFAULT_PAIMIND_EXPERIENCE_MODE,
    motion: PAIMIND_MOTION_PREFERENCES.includes(raw.motion as PaimindMotionPreference) ? raw.motion as PaimindMotionPreference : 'system',
  })
}
