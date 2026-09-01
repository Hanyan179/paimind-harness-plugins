import type { PaimindInvariantContext } from '@paimind/harness-compat'

export const name = 'paimind-platform-api-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@paimind/platform-api', () => {})
)
