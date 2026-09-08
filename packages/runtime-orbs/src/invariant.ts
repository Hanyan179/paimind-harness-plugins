import type { PaimindInvariantContext } from '@hansen/harness-compat'

const PACKAGE_NAME = '@hansen/runtime-orbs'

/** Cordis invariant companion name. */
export const name = 'paimind-runtime-orbs-invariant'
/** Harness service required by the invariant companion. */
export const inject = ['invariants']

/** Register package ownership and return the Harness disposer without thenable assimilation. */
export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register(PACKAGE_NAME, () => {})
)
