import type { PaimindInvariantContext } from '@paimind/harness-compat'

export const name = 'paimind-platform-api-invariant'
export const inject = ['invariants']

export function apply(ctx: PaimindInvariantContext): () => void {
  return ctx.invariants.register('@paimind/platform-api', () => {})
}

