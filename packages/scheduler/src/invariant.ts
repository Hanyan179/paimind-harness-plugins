import type { PaimindInvariantContext } from '@paimind/harness-compat'

const PACKAGE_NAME = '@paimind/platform-scheduler'
export const name = 'paimind-platform-scheduler-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register(PACKAGE_NAME, () => {})
)
