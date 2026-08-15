import type { PaimindNotificationLevel } from '@paimind/contracts'

export const PAIMIND_USER_SETTINGS_NAMESPACE = 'paimind-user-settings'
export const PAIMIND_RESPONSE_STYLES = ['professional', 'friendly', 'concise'] as const
export const PAIMIND_RESPONSE_LENGTHS = ['concise', 'balanced', 'detailed'] as const
export const PAIMIND_RESPONSE_STRUCTURES = ['automatic', 'bullets', 'narrative'] as const
export const PAIMIND_CITATION_POLICIES = ['when-useful', 'always', 'minimal'] as const
export const PAIMIND_MOTION_POLICIES = ['system', 'reduce'] as const
export const PAIMIND_NOTIFICATION_POLICIES = ['all', 'attention', 'off'] as const

export interface PaimindUserPreferences {
  readonly responseStyle: typeof PAIMIND_RESPONSE_STYLES[number]
  readonly responseLength: typeof PAIMIND_RESPONSE_LENGTHS[number]
  readonly responseStructure: typeof PAIMIND_RESPONSE_STRUCTURES[number]
  readonly citations: typeof PAIMIND_CITATION_POLICIES[number]
  readonly personalInstructions: string
  readonly motion: typeof PAIMIND_MOTION_POLICIES[number]
  readonly notifications: typeof PAIMIND_NOTIFICATION_POLICIES[number]
}

export const DEFAULT_PAIMIND_USER_PREFERENCES: Readonly<PaimindUserPreferences> = Object.freeze({
  responseStyle: 'professional', responseLength: 'balanced', responseStructure: 'automatic',
  citations: 'when-useful', personalInstructions: '', motion: 'system', notifications: 'all',
})

function member<Value extends string>(values: readonly Value[], value: unknown): value is Value {
  return typeof value === 'string' && values.includes(value as Value)
}

/** Decode only the exact product-owned preference section accepted by FP14. */
export function decodePaimindUserPreferences(value: unknown): PaimindUserPreferences | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Partial<PaimindUserPreferences>
  if (!member(PAIMIND_RESPONSE_STYLES, candidate.responseStyle)
    || !member(PAIMIND_RESPONSE_LENGTHS, candidate.responseLength)
    || !member(PAIMIND_RESPONSE_STRUCTURES, candidate.responseStructure)
    || !member(PAIMIND_CITATION_POLICIES, candidate.citations)
    || typeof candidate.personalInstructions !== 'string'
    || candidate.personalInstructions.length > 3_000
    || !member(PAIMIND_MOTION_POLICIES, candidate.motion)
    || !member(PAIMIND_NOTIFICATION_POLICIES, candidate.notifications)) return undefined
  return Object.freeze({
    responseStyle: candidate.responseStyle, responseLength: candidate.responseLength,
    responseStructure: candidate.responseStructure, citations: candidate.citations,
    personalInstructions: candidate.personalInstructions, motion: candidate.motion,
    notifications: candidate.notifications,
  })
}

/** Render only real, model-affecting deviations from the neutral defaults. */
export function renderPaimindUserPreferencePrompt(preferences: Readonly<PaimindUserPreferences>): string {
  const lines: string[] = []
  if (preferences.responseStyle !== 'professional') lines.push(`- Response style: ${preferences.responseStyle}.`)
  if (preferences.responseLength !== 'balanced') lines.push(`- Response length: ${preferences.responseLength}.`)
  if (preferences.responseStructure !== 'automatic') lines.push(`- Response structure: ${preferences.responseStructure}.`)
  if (preferences.citations !== 'when-useful') lines.push(`- Citation preference: ${preferences.citations}.`)
  const instructions = preferences.personalInstructions.trim()
  if (instructions !== '') lines.push(`- Personal instructions: ${instructions}`)
  if (lines.length === 0) return ''
  return [
    '<paimind-user-preferences>',
    'Apply these user-owned response preferences unless a higher-priority Harness instruction conflicts:',
    ...lines,
    '</paimind-user-preferences>',
  ].join('\n')
}

export interface PaimindUserSettingsPolicy {
  current(): Readonly<PaimindUserPreferences>
  shouldPublishNotification(level: PaimindNotificationLevel): boolean
}

export type PaimindUserPreferenceField = keyof PaimindUserPreferences

export type PaimindUserSettingsView =
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'ready'
      readonly value: Readonly<PaimindUserPreferences>
      readonly revision: number
      readonly writable: boolean
    }

export interface PaimindUserSettingsMutationRequest {
  readonly field: PaimindUserPreferenceField
  readonly value: unknown
  readonly expectedRevision: number
}
