import type { PaimindInvariantContext } from '@hansen/harness-compat'

export const name = 'paimind-presentation-trace-invariant'
export const inject = ['invariants']
const PACKAGE_NAME = '@hansen/presentation-trace'

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register(PACKAGE_NAME, () => {})
)
