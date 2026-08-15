import type { PaimindInvariantContext } from '@paimind/harness-compat'

export const name = 'paimind-agent-builder-invariant'

export function apply(ctx: PaimindInvariantContext): void {
  ctx.invariants.register('@paimind/agent-builder', () => {})
}
