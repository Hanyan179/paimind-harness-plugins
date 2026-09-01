import type { PaimindInvariantContext } from '@paimind/harness-compat'

export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@paimind/generator-web', () => {})
)
