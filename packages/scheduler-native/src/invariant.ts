import type { PaimindInvariantContext } from '@paimind/harness-compat'

const PACKAGE_NAME = '@paimind/scheduler'
export const name = 'paimind-scheduler-invariant'
export const inject = ['invariants']

export function apply(ctx: PaimindInvariantContext): () => void {
  return ctx.invariants.register(PACKAGE_NAME, () => {})
}
