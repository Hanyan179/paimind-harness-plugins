import type { PaimindInvariantContext } from '@hansen/harness-compat'

export const name = 'paimind-scheduler-adapter-harness-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@hansen/scheduler-adapter-harness', () => {})
)
