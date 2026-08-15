import type { PaimindInvariantContext } from '@paimind/harness-compat'

export const name = 'paimind-skill-market-invariant'

export function apply(ctx: PaimindInvariantContext): void {
  ctx.invariants.register('@paimind/skill-market', () => {})
}
