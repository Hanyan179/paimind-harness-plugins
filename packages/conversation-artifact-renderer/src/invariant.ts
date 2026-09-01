import type { PaimindInvariantContext } from '@paimind/harness-compat'

export const name = 'paimind-conversation-artifact-renderer-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register('@paimind/conversation-artifact-renderer', () => {})
)
