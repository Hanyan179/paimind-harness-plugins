import type { PaimindInvariantContext } from '@hansen/harness-compat'

export const name = 'paimind-platform-api-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@hansen/platform-api', () => {})
)
