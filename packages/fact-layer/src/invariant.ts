import type { PaimindInvariantContext } from '@paimind/harness-compat'

export const name = 'paimind-fact-layer-invariant'
export const inject = ['invariants']
export function apply(ctx: PaimindInvariantContext): void {
  ctx.invariants.register('@paimind/fact-layer', () => {})
}
