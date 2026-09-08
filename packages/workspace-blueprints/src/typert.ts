import { PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS } from './remote.js'

export const TYPERT = Object.freeze({
  package: '@hansen/workspace-blueprints',
  face: 'host',
  schemas: Object.freeze([]),
  invocations: PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS,
  model: Object.freeze({ services: Object.freeze([]), events: Object.freeze([]), objects: Object.freeze([]) }),
})

export default TYPERT
