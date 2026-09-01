import type { PaimindInvariantContext } from '@paimind/harness-compat'

const PACKAGE_NAME = '@paimind/workspace-project'

/** Cordis invariant companion name. */
export const name = 'paimind-workspace-project-invariant'
/** Harness service required by the invariant companion. */
export const inject = ['invariants']

/** Register FP04 package ownership with the shared invariant service. */
export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register(PACKAGE_NAME, () => {})
)
