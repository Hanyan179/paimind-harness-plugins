import type { PaimindInvariantContext } from '@hansen/harness-compat'

const PACKAGE_NAME = '@hansen/task-monitor'

export const name = 'paimind-task-monitor-invariant'
export const inject = ['invariants']

export const apply = (ctx: PaimindInvariantContext): (() => void) => (
  ctx.invariants.register(PACKAGE_NAME, () => {})
)
