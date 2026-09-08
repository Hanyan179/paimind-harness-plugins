import type { PaimindInvariantContext } from '@hansen/harness-compat'

export const name = 'paimind-category-analysis-adapter-invariant'
export const inject = ['invariants']
export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@hansen/category-analysis-adapter', () => {})
)
