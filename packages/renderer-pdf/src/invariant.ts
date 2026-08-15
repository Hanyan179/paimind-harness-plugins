import type { PaimindInvariantContext } from '@paimind/harness-compat'

export const name = 'paimind-renderer-pdf-invariant'
export const inject = ['invariants']

export function apply(ctx: PaimindInvariantContext): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register('@paimind/renderer-pdf', () => {}))
}
