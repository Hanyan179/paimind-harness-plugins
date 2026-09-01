import type { PaimindInvariantContext } from '@paimind/harness-compat'

export const name = 'paimind-scheduler-adapter-http-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@paimind/scheduler-adapter-http', () => {})
)
