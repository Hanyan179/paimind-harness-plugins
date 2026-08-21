import type { PaimindInvariantContext } from '@paimind/harness-compat'

export const name = 'paimind-category-analysis-adapter-invariant'
export const inject = ['invariants']
export function apply(ctx: PaimindInvariantContext): void {
  ctx.invariants.register('@paimind/category-analysis-adapter', () => {})
}
