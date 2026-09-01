import { PAIMIND_FEATURE_PACK_REMOTE_DESCRIPTORS } from './remote.js'

/** Host contribution consumed by the native Typert loader and API Gateway. */
export const TYPERT = Object.freeze({
  package: '@paimind/extension-center',
  face: 'host',
  schemas: Object.freeze([]),
  invocations: PAIMIND_FEATURE_PACK_REMOTE_DESCRIPTORS,
  model: Object.freeze({
    services: Object.freeze([]),
    events: Object.freeze([]),
    objects: Object.freeze([]),
  }),
})

export default TYPERT
