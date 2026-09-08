import { PAIMIND_SCHEDULER_REMOTE_DESCRIPTORS } from './remote.js'

export const TYPERT = Object.freeze({
  package: '@hansen/platform-scheduler',
  face: 'host',
  schemas: Object.freeze([]),
  invocations: PAIMIND_SCHEDULER_REMOTE_DESCRIPTORS,
  model: Object.freeze({ services: Object.freeze([]), events: Object.freeze([]), objects: Object.freeze([]) }),
})

export default TYPERT
