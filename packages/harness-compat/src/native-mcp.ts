import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Context } from '@deepseek-ai/cordis'
import * as nativeMcp from '@deepseek-ai/dsh-mcp-client'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { PaimindHostAgent } from './host.js'
import { isDeepStrictEqual } from 'node:util'

export type PaimindNativeMcpConfig = {
  readonly serverName: string
  readonly toolCallTimeoutMs: number
} & ({ readonly transport: 'stdio'; readonly command: string; readonly args: readonly string[]; readonly cwd: string; readonly env: Readonly<Record<string, string>> }
  | { readonly transport: 'streamable-http'; readonly url: string; readonly headers: Readonly<Record<string, string>> })

export interface PaimindMcpToolSummary { readonly name: string; readonly description: string }
export interface PaimindMcpAgent extends PaimindHostAgent { readonly ctx: object }
export interface PaimindNativeMcpHandle {
  tools(): readonly PaimindMcpToolSummary[]
  dispose(): Promise<void>
}

export interface PaimindMcpAssemblyContext { readonly agent?: PaimindMcpAgent; readonly scope?: object }
export interface PaimindMcpAssemblyHost { get(name: string): unknown }
const reassembling = new WeakSet<object>()

/** rc.2 harvests tools before its assembly waterfall. After an asynchronous
 * mount, ask the native assembler to harvest again; never append tools by hand. */
export async function refreshPaimindNativeMcpAssembly(host: PaimindMcpAssemblyHost, assembly: unknown,
  context: PaimindMcpAssemblyContext, next: () => Promise<unknown>): Promise<unknown> {
  if (!context.agent || reassembling.has(context)) return await next()
  const tools = host.get('tools') as { wireSchemas(scope: object): { schemas: readonly { name: string }[] } }
  const actual = (assembly as { tools: readonly { name: string }[] }).tools
  const managed = (rows: readonly { name: string }[]): readonly { name: string }[] => rows.filter(row => row.name.startsWith('mcp__paimind_')).sort((a, b) => a.name.localeCompare(b.name))
  // Names may stay unchanged while descriptions, input schemas or annotations change.
  if (isDeepStrictEqual(managed(actual), managed(tools.wireSchemas(context.scope ?? context.agent).schemas))) return await next()
  const prompt = host.get('systemPrompt') as { assemble(context: PaimindMcpAssemblyContext): Promise<unknown> }
  reassembling.add(context)
  try { return await prompt.assemble(context) } finally { reassembling.delete(context) }
}

/** Mount and dispose the selected native MCP plugin in the actual Agent context. */
export async function mountPaimindNativeMcp(agent: PaimindMcpAgent, config: PaimindNativeMcpConfig): Promise<PaimindNativeMcpHandle> {
  const context = agent.ctx as Context
  const mutable = config.transport === 'stdio' ? { ...config, args: [...config.args] } : config
  const fiber = context.plugin(nativeMcp, { ...mutable, failOnStartupError: true, reconnect: { enabled: true } })
  try { await fiber } catch (error) { await fiber.dispose(); throw error }
  let active = true
  return {
    tools: () => active ? fiber.ctx.tools.schemas(agent as never)
      .filter(tool => tool.name.startsWith(`mcp__${config.serverName}__`))
      .map(tool => ({ name: tool.name, description: tool.description ?? '' })) : [],
    dispose: async () => { active = false; await fiber.dispose() },
  }
}

/** Protocol health probe only: no registrations, model loop or tool invocation. */
export async function probePaimindNativeMcp(config: PaimindNativeMcpConfig): Promise<readonly PaimindMcpToolSummary[]> {
  const client = new Client({ name: 'paimind-connection-probe', version: '1.0.0' })
  const transport = config.transport === 'stdio'
    ? new StdioClientTransport({ command: config.command, args: [...config.args], cwd: config.cwd, env: { ...config.env }, stderr: 'pipe' })
    : new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: { ...config.headers } } })
  // Drain diagnostics without echoing potential credentials into the host log.
  if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => {})
  const timer = setTimeout(() => { void client.close().catch(() => {}) }, Math.min(config.toolCallTimeoutMs, 20_000))
  try {
    await client.connect(transport as Transport, { timeout: 15_000 })
    const tools: PaimindMcpToolSummary[] = []
    let cursor: string | undefined
    for (let page = 0; page < 20; page++) {
      const result = await client.listTools(cursor === undefined ? {} : { cursor }, { timeout: 15_000 })
      tools.push(...result.tools.map(tool => ({ name: tool.name, description: (tool.description ?? '').slice(0, 2000) })))
      if (tools.length > 2000) throw new Error('MCP tool catalog is too large')
      cursor = result.nextCursor
      if (cursor === undefined) return tools
    }
    throw new Error('MCP tool catalog pagination exceeded limit')
  } finally { clearTimeout(timer); await client.close(); await transport.close() }
}
