import type { PaimindInvariantContext } from '@paimind/harness-compat'

const PACKAGE_NAME = '@paimind/conversation-extensions'

/** Cordis invariant companion name. */
export const name = 'paimind-conversation-extensions-invariant'
/** Harness service required by the invariant companion. */
export const inject = ['invariants']

/** Register FP03 package ownership with the shared invariant service. */
export function apply(ctx: PaimindInvariantContext): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, () => {}))
}

