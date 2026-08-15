import type { PaimindInvariantContext } from '@paimind/harness-compat'

const PACKAGE_NAME = '@paimind/better-sidebar-adapter'

export const name = 'paimind-better-sidebar-adapter-invariant'
export const inject = ['invariants']

export function apply(ctx: PaimindInvariantContext): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, () => {}))
}
