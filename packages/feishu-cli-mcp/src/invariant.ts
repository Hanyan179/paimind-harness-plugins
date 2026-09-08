export const name = 'paimind-feishu-cli-mcp-invariant'
export const inject = ['invariants']
// Cordis constructs regular functions; an arrow preserves its returned disposer.
export const apply = (ctx: { invariants: { register(name: string, validate: () => void): () => void } }): (() => void) => (
  ctx.invariants.register('@hansen/feishu-cli-mcp', () => {})
)
