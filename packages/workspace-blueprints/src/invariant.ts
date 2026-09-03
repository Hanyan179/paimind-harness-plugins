import type { PaimindInvariantContext } from '@paimind/harness-compat'

export const name = 'paimind-workspace-blueprints-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@paimind/workspace-blueprints', () => {})
)
