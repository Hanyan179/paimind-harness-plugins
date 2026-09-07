// @vitest-environment node
import { createServer } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createFeishuMcpServer } from '../src/server.js'
import { probePaimindNativeMcp } from '../../harness-compat/src/native-mcp.js'
import { expect, it } from 'vitest'
it('discovers a Streamable HTTP service with explicit headers and refuses missing authorization', async () => {
  const sessions: { close(): Promise<void> }[] = []
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== 'Bearer local-fixture') { response.writeHead(403); response.end('Forbidden'); return }
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return }
    const protocol = createFeishuMcpServer({ executable: '/not-executed', profile: 'personal', cwd: '/tmp' })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    sessions.push(protocol)
    let body = ''; for await (const chunk of request) body += chunk.toString()
    await protocol.connect(transport)
    await transport.handleRequest(request, response, JSON.parse(body))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const config = { serverName: 'http_probe', transport: 'streamable-http' as const, url: `http://127.0.0.1:${port}/mcp`, toolCallTimeoutMs: 5000, headers: {} }
  try {
    await expect(probePaimindNativeMcp(config)).rejects.toThrow()
    const tools = await probePaimindNativeMcp({ ...config, headers: { Authorization: 'Bearer local-fixture' } })
    expect(tools).toHaveLength(4)
    expect(tools.map(tool => tool.name)).toContain('feishu_update_document')
  } finally {
    for (const session of sessions) await session.close()
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
}, 15000)
