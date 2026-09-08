import type { PaimindInvariantContext } from '@hansen/harness-compat'

export const name = 'paimind-walmart-proposal-adapter-invariant'
export const inject = ['invariants']
export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@hansen/walmart-proposal-adapter', () => {})
)
