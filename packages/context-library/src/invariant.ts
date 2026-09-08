export const name = 'paimind-context-library-invariant'
export const inject = ['invariants']
export const apply = (ctx: {
  invariants: { register(name: string, validate: () => void): () => void }
}): (() => void) => ctx.invariants.register('@hansen/context-library', () => {})
