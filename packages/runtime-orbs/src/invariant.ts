import type { PaimindInvariantContext } from '@paimind/harness-compat'

const PACKAGE_NAME = '@paimind/runtime-orbs'

/** Cordis invariant companion name. */
export const name = 'paimind-runtime-orbs-invariant'
/** Harness service required by the invariant companion. */
export const inject = ['invariants']

/** Register package ownership; runtime disposal is proven by the client registration test. */
export function apply(ctx: PaimindInvariantContext): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, () => {}))
}

