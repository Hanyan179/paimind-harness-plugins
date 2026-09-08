import type { PaimindInvariantContext } from '@hansen/harness-compat'

const PACKAGE_NAME = '@hansen/artifact-runtime'

export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register(PACKAGE_NAME, () => {})
)
