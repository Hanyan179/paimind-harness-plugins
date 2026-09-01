import type { PaimindInvariantContext } from '@paimind/harness-compat'

const PACKAGE_NAME = '@paimind/visual-experience'

export const name = 'paimind-visual-experience-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register(PACKAGE_NAME, () => {})
)
