import type { PaimindInvariantContext } from '@paimind/harness-compat'

const PACKAGE_NAME = '@paimind/proposal-experience'

export const name = 'paimind-proposal-experience-invariant'
export const inject = ['invariants']

export function apply(ctx: PaimindInvariantContext): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, () => {}))
}
