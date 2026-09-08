export const name = 'paimind-workspace-editors-invariant'
export const inject = ['invariants']
export const apply = (ctx: {
  invariants: { register(name: string, validate: () => void): () => void }
}): (() => void) =>
  ctx.invariants.register('@hansen/workspace-editors', () => {})
