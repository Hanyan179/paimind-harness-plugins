import type { PaimindInvariantContext } from '@paimind/harness-compat'

export const name = 'paimind-scheduler-adapter-harness-invariant'
export const inject = ['invariants']

export function apply(ctx: PaimindInvariantContext): () => void {
  return ctx.invariants.register('@paimind/scheduler-adapter-harness', () => {})
}

