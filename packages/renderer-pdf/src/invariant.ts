import type { PaimindInvariantContext } from '@paimind/harness-compat'

export const name = 'paimind-renderer-pdf-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@paimind/renderer-pdf', () => {})
)
