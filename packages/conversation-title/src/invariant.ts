import type { PaimindInvariantContext } from '@hansen/harness-compat'

const PACKAGE_NAME = '@hansen/conversation-title'

export const name = 'paimind-conversation-title-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register(PACKAGE_NAME, () => {})
)
