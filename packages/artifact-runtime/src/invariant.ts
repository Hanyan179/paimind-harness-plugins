import type { PaimindInvariantContext } from '@paimind/harness-compat'

const PACKAGE_NAME = '@paimind/artifact-runtime'

export const inject = ['invariants']

export function apply(ctx: PaimindInvariantContext): () => void {
  return ctx.invariants.register(PACKAGE_NAME, () => {})
}
