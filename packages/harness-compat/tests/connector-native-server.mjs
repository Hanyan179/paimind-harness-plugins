// Test-only real protocol peer. The selected MCP SDK is resolved from the
// installed native client; no production dependency, service or provider.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'

export function protocolServer(anchor, label, calls = []) {
  const require = createRequire(anchor)
  const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
  const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
  const server = new Server({ name: 'paimind-connector-test', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [{ name: 'echo', description: 'Local synthetic test peer',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false } }] }))
  server.setRequestHandler(CallToolRequestSchema, request => {
    calls.push(request.params)
    if (request.params.name !== 'echo' || typeof request.params.arguments?.message !== 'string') throw new Error('Invalid diagnostic call')
    return { content: [{ type: 'text', text: label + ':' + request.params.arguments.message }] }
  })
  return server
}

export async function httpPeer(anchor, label) {
  const require = createRequire(anchor)
  const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
  const calls = [], connections = new Set()
  const listener = createServer(async (req, res) => {
    if (req.url !== '/mcp' || req.method !== 'POST') { res.writeHead(405).end(); return }
    const server = protocolServer(anchor, label, calls)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    connections.add(server)
    res.on('close', () => { connections.delete(server); void server.close() })
    try { await server.connect(transport); await transport.handleRequest(req, res) }
    catch { if (!res.headersSent) res.writeHead(500); res.end() }
  })
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${listener.address().port}/mcp`, calls, async close() {
    await Promise.all([...connections].map(server => server.close()))
    listener.closeAllConnections()
    await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()))
  } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const require = createRequire(process.argv[2])
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
  await protocolServer(process.argv[2], process.argv[3]).connect(new StdioServerTransport())
}
