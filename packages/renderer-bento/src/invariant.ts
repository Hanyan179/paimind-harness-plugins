import type { PaimindInvariantContext } from '@hansen/harness-compat'

export const name = 'paimind-renderer-bento-invariant'
export const inject = ['invariants']
const PACKAGE_NAME = '@hansen/renderer-bento'

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register(PACKAGE_NAME, () => {})
)
