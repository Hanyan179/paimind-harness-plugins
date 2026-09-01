import { z } from 'zod'

const capability = z.object({
  id: z.string().regex(/^paimind:capability:[a-z0-9][a-z0-9-]*$/),
  loaderEntryId: z.string().regex(/^paimind-capability-[a-z0-9][a-z0-9-]*$/),
  packageNames: z.array(z.string()).readonly(),
  nameZh: z.string().min(1), nameEn: z.string().min(1),
  descriptionZh: z.string().min(1), descriptionEn: z.string().min(1),
  defaultEnabled: z.boolean(), installed: z.boolean(), enabled: z.boolean(),
  desiredEnabled: z.boolean().optional(), failure: z.string().min(1).optional(),
}).readonly()

const pack = z.object({
  id: z.string().regex(/^paimind:pack:[a-z0-9][a-z0-9-]*$/),
  loaderEntryId: z.string().regex(/^paimind-pack-[a-z0-9][a-z0-9-]*$/),
  nameZh: z.string().min(1), nameEn: z.string().min(1),
  descriptionZh: z.string().min(1), descriptionEn: z.string().min(1),
  order: z.number().finite(), defaultEnabled: z.boolean(),
  requiredPackIds: z.array(z.string()).readonly(),
  packageNames: z.array(z.string()).readonly(),
  installed: z.boolean(), enabled: z.boolean(),
  desiredEnabled: z.boolean().optional(), failure: z.string().min(1).optional(),
  capabilities: z.array(capability).readonly(),
}).readonly()

const view = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unavailable') }).readonly(),
  z.object({
    status: z.literal('ready'), packs: z.array(pack).readonly(),
    revision: z.number().int().nonnegative(), writable: z.boolean(),
  }).readonly(),
])

const mutation = z.object({
  id: z.string().regex(/^paimind:(?:pack|capability):[a-z0-9][a-z0-9-]*$/),
  enabled: z.boolean(),
  expectedRevision: z.number().int().nonnegative(),
}).readonly()

export const PAIMIND_FEATURE_PACK_REMOTE_DESCRIPTORS = Object.freeze([
  {
    id: '@paimind/extension-center#paimindFeaturePacks/describe',
    service: 'paimindFeaturePacks', namespace: 'paimindFeaturePacks', method: 'describe',
    invocation: { kind: 'direct' as const }, parameters: [],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/extension-center#PaimindFeaturePackView', schema: view },
    sourceLocation: { file: 'packages/extension-center/src/index.ts', line: 100, column: 3 },
  },
  {
    id: '@paimind/extension-center#paimindFeaturePacks/mutate',
    service: 'paimindFeaturePacks', namespace: 'paimindFeaturePacks', method: 'mutate',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'request', wire: 'request', source: 'json' as const,
      codec: { mode: 'strict' as const, typeSymbol: '@paimind/extension-center#PaimindFeatureToggleMutationRequest', schema: mutation },
    }],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/extension-center#PaimindFeaturePackView', schema: view },
    sourceLocation: { file: 'packages/extension-center/src/index.ts', line: 120, column: 3 },
  },
])

export const TYPERT_REMOTE = Object.freeze({
  package: '@paimind/extension-center', descriptors: PAIMIND_FEATURE_PACK_REMOTE_DESCRIPTORS,
})

export default TYPERT_REMOTE
