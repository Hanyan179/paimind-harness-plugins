import type { PaimindInvariantContext } from '@hansen/harness-compat'

export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@hansen/generator-web', () => {})
)
