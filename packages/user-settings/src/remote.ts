import { z } from 'zod'

const preferences = z.object({
  responseStyle: z.enum(['professional', 'friendly', 'concise']),
  responseLength: z.enum(['concise', 'balanced', 'detailed']),
  responseStructure: z.enum(['automatic', 'bullets', 'narrative']),
  citations: z.enum(['when-useful', 'always', 'minimal']),
  personalInstructions: z.string().max(3_000),
  motion: z.enum(['system', 'reduce']),
  notifications: z.enum(['all', 'attention', 'off']),
}).readonly()

const view = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unavailable') }).readonly(),
  z.object({
    status: z.literal('ready'), value: preferences,
    revision: z.number().int().nonnegative(), writable: z.boolean(),
  }).readonly(),
])

const mutation = z.object({
  field: z.enum([
    'responseStyle', 'responseLength', 'responseStructure', 'citations',
    'personalInstructions', 'motion', 'notifications',
  ]),
  value: z.unknown(),
  expectedRevision: z.number().int().nonnegative(),
}).readonly()

export const PAIMIND_USER_SETTINGS_REMOTE_DESCRIPTORS = Object.freeze([
  {
    id: '@paimind/user-settings#paimindUserSettings/describe',
    service: 'paimindUserSettings', namespace: 'paimindUserSettings', method: 'describe',
    invocation: { kind: 'direct' as const }, parameters: [],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/user-settings#PaimindUserSettingsView', schema: view },
    sourceLocation: { file: 'packages/user-settings/src/index.ts', line: 86, column: 3 },
  },
  {
    id: '@paimind/user-settings#paimindUserSettings/mutate',
    service: 'paimindUserSettings', namespace: 'paimindUserSettings', method: 'mutate',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'request', wire: 'request', source: 'json' as const,
      codec: { mode: 'strict' as const, typeSymbol: '@paimind/user-settings#PaimindUserSettingsMutationRequest', schema: mutation },
    }],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/user-settings#PaimindUserSettingsView', schema: view },
    sourceLocation: { file: 'packages/user-settings/src/index.ts', line: 99, column: 3 },
  },
])

export const TYPERT_REMOTE = Object.freeze({
  package: '@paimind/user-settings', descriptors: PAIMIND_USER_SETTINGS_REMOTE_DESCRIPTORS,
})

export default TYPERT_REMOTE
