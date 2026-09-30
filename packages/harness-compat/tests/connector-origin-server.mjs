// Real SDK peer for the native provider's asynchronous list-change lifecycle.
// Synthetic diagnostic only; never shipped or mounted in member environments.
import { createRequire } from 'node:module'
import { protocolServer } from './connector-native-server.mjs'
const require = createRequire(process.argv[2])
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
const server = protocolServer(process.argv[2], 'real-owner')
server.setRequestHandler(CallToolRequestSchema, request => {
  if (request.params.name !== 'echo' || typeof request.params.arguments?.message !== 'string') throw new Error('Invalid diagnostic call')
  if (request.params.arguments.message === 'refresh-definitions') {
    setTimeout(() => { void server.sendToolListChanged() }, 20)
  }
  return { content: [{ type: 'text', text: 'real-owner:' + request.params.arguments.message }] }
})
await server.connect(new StdioServerTransport())
