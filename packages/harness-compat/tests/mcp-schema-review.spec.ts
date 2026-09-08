// @vitest-environment node
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { mountPaimindNativeMcp, refreshPaimindNativeMcpAssembly, type PaimindNativeMcpHandle } from '../src/native-mcp.js'
const require = createRequire(import.meta.url)
const { SystemPrompt } = await import(createRequire(require.resolve('@deepseek-ai/dsh-tools')).resolve('@deepseek-ai/dsh-system-prompt'))

// Regression: unchanged names must not hide changed native schemas.
it('refreshes same-name tool metadata after reconfiguring the native connection during assembly', async () => {
  const ctx = new Context(); let handle: PaimindNativeMcpHandle | undefined
  try {
    await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
    const agent = { id: 'schema-review', session: { id: 'schema-review', header: {} }, ctx: {} }
    const scope = createScope(ctx, agent as never); agent.ctx = scope.ctx
    const config = (label: string) => ({ serverName: `paimind_${'a'.repeat(20)}`, transport: 'stdio' as const, command: process.execPath, args: [resolve('packages/harness-compat/tests/fixtures/generic-mcp-server.mjs'), '--label', label], cwd: process.cwd(), env: {}, toolCallTimeoutMs: 5000 })
    handle = await mountPaimindNativeMcp(agent, config('BEFORE_CHANGE'))
    let changed = false
    ctx.on('system-prompt/assemble', async (assembly: unknown, context: { agent?: typeof agent }, next: () => Promise<unknown>) => {
      if (!changed) { changed = true; await handle?.dispose(); handle = await mountPaimindNativeMcp(agent, config('AFTER_CHANGE')) }
      return await refreshPaimindNativeMcpAssembly(ctx, assembly, context, next)
    }, { prepend: true })
    const prompt = ctx.get('systemPrompt') as { assemble(context: unknown): Promise<{ tools: { name: string; description: string }[] }> }
    const result = await prompt.assemble({ agent, scope: agent })
    const nativeDescription = handle.tools().find(tool => tool.name.endsWith('__echo_probe'))!.description
    const requestDescription = result.tools.find(tool => tool.name.endsWith('__echo_probe'))!.description
    expect(nativeDescription).toContain('AFTER_CHANGE')
    await scope.dispose()
    console.info('REVIEW_EVIDENCE', JSON.stringify({ nativeDescription, requestDescription }))
    expect(requestDescription).toContain('AFTER_CHANGE')
  } finally { await handle?.dispose(); await ctx.fiber.dispose() }
}, 20000)
