import type { PaimindInvariantContext } from '@paimind/harness-compat'

const PACKAGE_NAME = '@paimind/artifacts'

export const name = 'paimind-artifacts-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register(PACKAGE_NAME, () => {})
)
