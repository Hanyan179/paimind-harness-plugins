import type { PaimindInvariantContext } from '@hansen/harness-compat'

export const name = 'paimind-workspace-blueprints-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@hansen/workspace-blueprints', () => {})
)
