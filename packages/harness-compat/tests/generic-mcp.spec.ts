// @vitest-environment node
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { mountPaimindNativeMcp, probePaimindNativeMcp, type PaimindMcpAgent } from '../src/native-mcp.js'
// @ts-expect-error Test-only JavaScript protocol fixture.
import { startGenericHttp } from './fixtures/generic-mcp-server.mjs'

it('runs identical non-Feishu tool names on stdio and HTTP in one native Agent without collision or leakage', async () => {
  const remote = await startGenericHttp({ label: 'non-feishu-http' })
  const ctx = new Context()
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} })
  await ctx.plugin(ToolRuntime)
  const a = { id: 'generic-bound', session: { id: 'generic-bound', header: {} }, ctx: {} } as PaimindMcpAgent
  const b = { id: 'generic-unbound', session: { id: 'generic-unbound', header: {} }, ctx: {} } as PaimindMcpAgent
  const scopes = [a, b].map(agent => { const scope = createScope(ctx, agent as never); Object.assign(agent, { ctx: scope.ctx }); return scope })
  const httpConfig = { serverName: 'generic_http', transport: 'streamable-http' as const, url: `http://127.0.0.1:${remote.port}/mcp`, headers: {}, toolCallTimeoutMs: 5000 }
  try {
    await expect(probePaimindNativeMcp({ ...httpConfig, url: `http://127.0.0.1:${remote.port}/denied` })).rejects.toThrow()
    expect((await probePaimindNativeMcp(httpConfig)).map(tool => tool.name)).toEqual(['echo_probe', 'canary_write'])
    const local = await mountPaimindNativeMcp(a, { serverName: 'generic_stdio', transport: 'stdio', command: process.execPath, args: [resolve('packages/harness-compat/tests/fixtures/generic-mcp-server.mjs'), '--label', 'non-feishu-stdio'], cwd: process.cwd(), env: {}, toolCallTimeoutMs: 5000 })
    const network = await mountPaimindNativeMcp(a, httpConfig)
    expect(ctx.tools.schemas(a as never)).toHaveLength(4)
    expect(ctx.tools.schemas(b as never)).toEqual([])
    expect(ctx.tools.schemas()).toEqual([])
    for (const [handle, label] of [[local, 'non-feishu-stdio'], [network, 'non-feishu-http']] as const) {
      const name = handle.tools().find(tool => tool.name.endsWith('__echo_probe'))!.name
      const result = await ctx.tools.execute({ callId: label as never, name, arguments: { nonce: label }, agent: a as never, signal: new AbortController().signal })
      expect(result.isError).toBe(false); expect(JSON.stringify(result)).toContain(label)
      const blocked = await ctx.tools.execute({ callId: 'forged' as never, name, arguments: { nonce: 'forged' }, agent: b as never, signal: new AbortController().signal })
      expect(blocked.isError).toBe(true)
    }
    await local.dispose()
    expect(ctx.tools.schemas(a as never)).toHaveLength(2)
    await network.dispose()
    expect(ctx.tools.schemas(a as never)).toEqual([])
  } finally { for (const scope of scopes) await scope.dispose(); await ctx.fiber.dispose(); await remote.close() }
}, 20000)
