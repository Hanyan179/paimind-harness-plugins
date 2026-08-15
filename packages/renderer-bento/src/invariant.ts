import type { PaimindInvariantContext } from '@paimind/harness-compat'

export const name = 'paimind-renderer-bento-invariant'
export const inject = ['invariants']
const PACKAGE_NAME = '@paimind/renderer-bento'

export function apply(ctx: PaimindInvariantContext): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, () => {}))
}
