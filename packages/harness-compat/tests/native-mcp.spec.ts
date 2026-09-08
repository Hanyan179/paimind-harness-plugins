// @vitest-environment node
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { afterEach, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { mountPaimindNativeMcp, probePaimindNativeMcp, type PaimindMcpAgent, type PaimindNativeMcpConfig } from '../src/native-mcp.js'
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const config = (name: string): PaimindNativeMcpConfig => ({
  serverName: name, transport: 'stdio', command: process.execPath,
  args: [resolve('packages/feishu-cli-mcp/lib/server.js'), '--cli', '/does-not-exist/lark-cli', '--profile', 'personal'],
  cwd: process.cwd(), env: { PATH: process.env.PATH! }, toolCallTimeoutMs: 5000,
})
it('uses the selected native MCP client and registry for discovery, scoped dispatch and hot disposal', async () => {
  const ctx = new Context()
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} })
  await ctx.plugin(ToolRuntime)
  cleanups.push(async () => { await ctx.fiber.dispose() })
  const a = { id: 'a', session: { id: 'a', header: {} } } as PaimindMcpAgent
  const b = { id: 'b', session: { id: 'b', header: {} } } as PaimindMcpAgent
  const c = { id: 'c', session: { id: 'c', header: {} } } as PaimindMcpAgent
  for (const agent of [a, b, c]) { const scope = createScope(ctx, agent as never); Object.assign(agent, { ctx: scope.ctx }); cleanups.push(scope.dispose) }
  const probe = await probePaimindNativeMcp(config('paimind_probe'))
  expect(probe.map(tool => tool.name)).toContain('feishu_read_document')
  expect(ctx.tools.schemas()).toEqual([])
  const first = await mountPaimindNativeMcp(a, config('paimind_a'))
  cleanups.push(first.dispose)
  const second = await mountPaimindNativeMcp(b, config('paimind_b'))
  cleanups.push(second.dispose)
  expect(first.tools()).toHaveLength(4); expect(second.tools()).toHaveLength(4)
  expect(ctx.tools.schemas()).toEqual([])
  expect(ctx.tools.schemas(c as never)).toEqual([])
  expect(ctx.tools.schemas(a as never).map(tool => tool.name)).toEqual(first.tools().map(tool => tool.name))
  const name = first.tools().find(tool => tool.name.endsWith('feishu_identity'))!.name
  const failed = await ctx.tools.execute({ callId: 'check' as never, name, arguments: {}, agent: a as never, signal: new AbortController().signal })
  expect(failed.isError).toBe(true)
  expect(JSON.stringify(failed)).toContain('CLI executable unavailable')
  await first.dispose()
  expect(ctx.tools.schemas(a as never)).toEqual([])
  expect(ctx.tools.schemas(b as never)).toHaveLength(4)
}, 20000)
