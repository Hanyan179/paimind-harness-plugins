import type { PaimindInvariantContext } from '@paimind/harness-compat'

const PACKAGE_NAME = '@paimind/launcher'

/** Cordis invariant companion name. */
export const name = 'paimind-launcher-invariant'
/** Harness service required by the invariant companion. */
export const inject = ['invariants']

/** Register FP02 package ownership with the shared invariant service. */
export function apply(ctx: PaimindInvariantContext): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, () => {}))
}

