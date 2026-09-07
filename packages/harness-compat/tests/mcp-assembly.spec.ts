// @vitest-environment node
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { mountPaimindNativeMcp, refreshPaimindNativeMcpAssembly, type PaimindNativeMcpHandle } from '../src/native-mcp.js'

// Use the selected ToolRuntime's own protocol peer, including its exact version.
const require = createRequire(import.meta.url)
const { SystemPrompt } = await import(createRequire(require.resolve('@deepseek-ai/dsh-tools')).resolve('@deepseek-ai/dsh-system-prompt'))

it('includes an async MCP mount in the first native prompt and removes it from an already-harvested prompt', async () => {
  const ctx = new Context()
  let handle: PaimindNativeMcpHandle | undefined, enabled = true
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const agent = { id: 'first-turn', session: { id: 'first-turn', header: {} }, ctx: {} }
    const scope = createScope(ctx, agent as never); agent.ctx = scope.ctx
    const other = { id: 'unbound', session: { id: 'unbound', header: {} }, ctx: {} }
    const otherScope = createScope(ctx, other as never); other.ctx = otherScope.ctx
    ctx.on('system-prompt/assemble', async (assembly: unknown, context: { agent?: typeof agent }, next: () => Promise<unknown>) => {
      if (context.agent === agent) {
        if (enabled && !handle) handle = await mountPaimindNativeMcp(agent, {
          serverName: 'paimind_assembly', transport: 'stdio', command: process.execPath,
          args: [resolve('packages/feishu-cli-mcp/lib/server.js'), '--cli', '/missing/lark-cli', '--profile', 'personal'],
          cwd: process.cwd(), env: { PATH: process.env.PATH! }, toolCallTimeoutMs: 5000,
        })
        if (!enabled && handle) { await handle.dispose(); handle = undefined }
      }
      return await refreshPaimindNativeMcpAssembly(ctx, assembly, context, next)
    }, { prepend: true })
    const prompt = ctx.get('systemPrompt') as { assemble(context: unknown): Promise<{ tools: { name: string }[] }> }
    expect((await prompt.assemble({ agent, scope: agent })).tools).toHaveLength(4)
    expect((await prompt.assemble({ agent: other, scope: other })).tools).toEqual([])
    enabled = false
    expect((await prompt.assemble({ agent, scope: agent })).tools).toEqual([])
    await scope.dispose(); await otherScope.dispose()
  } finally { await handle?.dispose(); await ctx.fiber.dispose() }
}, 20000)
