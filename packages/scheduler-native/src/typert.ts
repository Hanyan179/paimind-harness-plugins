import { PAIMIND_SCHEDULE_REMOTE_DESCRIPTORS } from './remote.js'

export const TYPERT = Object.freeze({
  package: '@paimind/scheduler',
  face: 'host',
  schemas: Object.freeze([]),
  invocations: PAIMIND_SCHEDULE_REMOTE_DESCRIPTORS,
  model: Object.freeze({ services: Object.freeze([]), events: Object.freeze([]), objects: Object.freeze([]) }),
})

export default TYPERT
