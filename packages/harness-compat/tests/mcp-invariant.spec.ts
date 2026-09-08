// @vitest-environment node
import { Context } from '@deepseek-ai/cordis'
import { InvariantRegistry } from '@deepseek-ai/dsh-invariants'
import { it } from 'vitest'
import * as invariant from '../../mcp-center/src/invariant.js'

it('releases native invariant ownership when a product group is unloaded and restored', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(InvariantRegistry)
    for (let cycle = 0; cycle < 3; cycle++) {
      const plugin = ctx.plugin(invariant)
      await plugin
      await plugin.dispose()
    }
  } finally { await ctx.fiber.dispose() }
})
