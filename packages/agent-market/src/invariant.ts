import type { PaimindInvariantContext } from '@hansen/harness-compat'

export const name = 'paimind-agent-market-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@hansen/agent-market', () => {})
)
