// Owned synthetic peer, connected ONLY to a temporary Docker internal bridge.
// It uses the pinned real SDK, including HTTP sessions and streaming responses.
import { createRequire } from 'node:module'
import { realpath, readFile } from 'node:fs/promises'
import { createServer as httpServer } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { randomUUID } from 'node:crypto'
import { protocolServer } from './connector-native-server.mjs'
const native = createRequire(await realpath('/opt/paimind/node_modules/@deepseek-ai/dsh/package.json'))
const anchor = native.resolve('@deepseek-ai/dsh-mcp-client/package.json'), sdk = createRequire(anchor)
const { StreamableHTTPServerTransport } = sdk('@modelcontextprotocol/sdk/server/streamableHttp.js')
const sessions = new Map(), observations = { calls: [], redirected: 0, requests: 0, sessionRequests: 0, lastEventId: false, socketsClosed: 0 }
const handle = async (req, res) => {
  if (req.url === '/stats') { res.setHeader('content-type','application/json'); res.end(JSON.stringify(observations)); return }
  observations.requests++
  if (req.url === '/redirect') { res.writeHead(307,{ location:'http://127.0.0.1:3080/PRIVATE_REDIRECT' }).end('PRIVATE_REDIRECT'); return }
  if (req.url === '/failure') { res.writeHead(401,{ 'www-authenticate':'Bearer resource_metadata="http://127.0.0.1/private"' }).end('SYNTHETIC_REMOTE_SECRET'); return }
  if (req.url === '/events') {
    observations.lastEventId = req.headers['last-event-id'] === 'resume-exact-id'
    res.writeHead(200,{ 'content-type':'text/event-stream', 'mcp-session-id':'synthetic-session' })
    res.write('id: next-id\ndata: {"synthetic":true}\n\n')
    res.on('close',()=>observations.socketsClosed++); return
  }
  if (req.url === '/hold') { res.on('close',()=>observations.socketsClosed++); return }
  const label = req.url === '/mcp/hansen' ? 'hansen' : req.url === '/mcp/alex' ? 'alex' : undefined
  if (!label || req.headers.authorization !== 'Bearer synthetic-'+label || req.headers.cookie || req.headers['x-forwarded-host']) { res.writeHead(403).end('invalid test identity'); return }
  let current = sessions.get(req.headers['mcp-session-id'])
  if (!current) {
    if (req.method !== 'POST' || req.headers['mcp-session-id']) { res.writeHead(404).end(); return }
    const server = protocolServer(anchor,label,observations.calls)
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator:randomUUID,enableJsonResponse:false,
      onsessioninitialized:id=>sessions.set(id,{server,transport,label})})
    await server.connect(transport); current={server,transport,label}
  } else { if(current.label!==label){res.writeHead(403).end();return} observations.sessionRequests++ }
  try { await current.transport.handleRequest(req,res) }
  catch { if(!res.headersSent)res.writeHead(500);res.end() }
}
const servers=[httpServer((req,res)=>{void handle(req,res)}),httpsServer({key:await readFile('/diagnostic/key.pem'),cert:await readFile('/diagnostic/cert.pem')},(req,res)=>{void handle(req,res)})]
await Promise.all(servers.map((server,i)=>new Promise(resolve=>server.listen(i?8443:8080,'0.0.0.0',resolve))))
console.log('SYNTHETIC_CONNECTOR_PEER_READY')
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await Promise.all([...sessions.values()].map(v=>v.server.close()));for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}})
