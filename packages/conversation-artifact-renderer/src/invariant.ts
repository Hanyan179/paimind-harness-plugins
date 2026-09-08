import type { PaimindInvariantContext } from '@hansen/harness-compat'

export const name = 'paimind-conversation-artifact-renderer-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@hansen/conversation-artifact-renderer', () => {})
)
