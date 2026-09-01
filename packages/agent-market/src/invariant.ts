import type { PaimindInvariantContext } from '@paimind/harness-compat'

export const name = 'paimind-agent-market-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@paimind/agent-market', () => {})
)
