import { z } from 'zod'

const personalization = z.object({
  enabled: z.boolean(),
  personality: z.enum(['none', 'friendly', 'pragmatic']),
  aboutMe: z.string().max(2_000),
  customInstructions: z.string().max(3_000),
}).readonly()

const view = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unavailable') }).readonly(),
  z.object({
    status: z.literal('ready'), value: personalization,
    revision: z.number().int().nonnegative(), writable: z.boolean(),
  }).readonly(),
])

const mutation = z.object({
  field: z.enum(['enabled', 'personality', 'aboutMe', 'customInstructions']),
  value: z.unknown(),
  expectedRevision: z.number().int().nonnegative(),
}).readonly()

export const PAIMIND_USER_SETTINGS_REMOTE_DESCRIPTORS = Object.freeze([
  {
    id: '@paimind/user-settings#paimindUserSettings/describe',
    service: 'paimindUserSettings', namespace: 'paimindUserSettings', method: 'describe',
    invocation: { kind: 'direct' as const }, parameters: [],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/user-settings#PaimindPersonalizationView', schema: view },
    sourceLocation: { file: 'packages/user-settings/src/index.ts', line: 65, column: 3 },
  },
  {
    id: '@paimind/user-settings#paimindUserSettings/mutate',
    service: 'paimindUserSettings', namespace: 'paimindUserSettings', method: 'mutate',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'request', wire: 'request', source: 'json' as const,
      codec: { mode: 'strict' as const, typeSymbol: '@paimind/user-settings#PaimindPersonalizationMutationRequest', schema: mutation },
    }],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/user-settings#PaimindPersonalizationView', schema: view },
    sourceLocation: { file: 'packages/user-settings/src/index.ts', line: 79, column: 3 },
  },
])

export const TYPERT_REMOTE = Object.freeze({
  package: '@paimind/user-settings', descriptors: PAIMIND_USER_SETTINGS_REMOTE_DESCRIPTORS,
})

export default TYPERT_REMOTE
