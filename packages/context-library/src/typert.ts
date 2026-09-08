import { TYPERT_REMOTE } from './remote.js'

export const TYPERT = Object.freeze({
  package: '@hansen/context-library',
  face: 'host',
  schemas: Object.freeze([]),
  invocations: TYPERT_REMOTE.descriptors,
  model: Object.freeze({
    services: Object.freeze([]),
    events: Object.freeze([]),
    objects: Object.freeze([]),
  }),
})

export default TYPERT
