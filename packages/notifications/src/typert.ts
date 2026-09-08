import { PAIMIND_NOTIFICATION_REMOTE_DESCRIPTORS } from './remote.js'

/** Hand-authored from the same schema constants as the Client contribution. */
export const TYPERT = Object.freeze({
  package: '@hansen/notifications',
  face: 'host',
  schemas: Object.freeze([]),
  invocations: PAIMIND_NOTIFICATION_REMOTE_DESCRIPTORS,
  model: Object.freeze({ services: Object.freeze([]), events: Object.freeze([]), objects: Object.freeze([]) }),
})

export default TYPERT
