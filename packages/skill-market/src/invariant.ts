import type { PaimindInvariantContext } from '@hansen/harness-compat'

export const name = 'paimind-skill-market-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@hansen/skill-market', () => {})
)
