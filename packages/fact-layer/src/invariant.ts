import type { PaimindInvariantContext } from '@hansen/harness-compat'

export const name = 'paimind-fact-layer-invariant'
export const inject = ['invariants']
export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@hansen/fact-layer', () => {})
)
