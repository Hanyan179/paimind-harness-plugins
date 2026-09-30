import { randomBytes, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse, type ClientRequest, type OutgoingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type Socket } from 'node:net'

// An internal byte relay, not another MCP client, tool registry or session store.
// The native client still owns negotiation, SSE replay, reconnect and dispatch.
// Default deployment boundary excludes special/private/link-local/transition
// ranges. A private enterprise endpoint needs an explicit deployment policy;
// an administrator's connector URL alone cannot authorize internal-network access.
const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10], ['127.0.0.0',8], ['169.254.0.0',16],
  ['172.16.0.0',12], ['192.0.0.0',24], ['192.0.2.0',24], ['192.88.99.0',24], ['192.168.0.0',16],
  ['198.18.0.0',15], ['198.51.100.0',24], ['203.0.113.0',24], ['224.0.0.0',4], ['240.0.0.0',4],
] as const) blocked.addSubnet(address, prefix, 'ipv4')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
for (const [address, prefix] of [['2001::',23], ['2001:db8::',32], ['2002::',16], ['3fff::',20]] as const) blocked.addSubnet(address, prefix, 'ipv6')
export function isConnectorPublicAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4 ? !blocked.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}
const denied = () => new Error('Managed connector network destination is unavailable')
const wireHeaders = ['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'] as const
const reserved = new Set([...wireHeaders, 'host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'trailer', 'te', 'expect',
  'origin', 'referer', 'forwarded', 'accept-encoding', 'proxy-authorization', 'proxy-authenticate'])
const maxBody = 1024 * 1024, maxResponse = 32 * 1024 * 1024, maxInflight = 8

/** Only exact, capability-authenticated local requests can reach one immutable
 * configured endpoint. No redirects, ambient proxy, cookies or browser origins.
 * DNS is revalidated for EVERY request and pinned through the actual socket
 * lookup; a second DNS lookup or pooled connection cannot bypass this decision.
 * Errors never contain destination URLs, configured headers or remote bodies. */
export async function openConnectorHttpEgress(configuration: { url: string; headers: Readonly<Record<string, string>> }) {
  let target: URL, fixed: OutgoingHttpHeaders
  try {
    target = new URL(configuration.url)
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.hash) throw denied()
    fixed = {}
    for (const [name, value] of Object.entries(configuration.headers)) {
      const lower = name.toLowerCase()
      if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/u.test(lower) || reserved.has(lower) || lower.startsWith('proxy-') || lower.startsWith('x-forwarded-')
        || Object.hasOwn(fixed, lower) || typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) throw denied()
      fixed[lower] = value
    }
    const literal = target.hostname.replace(/^\[|\]$/gu, '')
    if (isIP(literal) && !isConnectorPublicAddress(literal)) throw denied()
  } catch { throw denied() }
  const hostname = target.hostname.replace(/^\[|\]$/gu, '')
  const token = Buffer.from('Bearer ' + randomBytes(32).toString('hex'))
  const incoming = new Set<Socket>(), outgoing = new Set<ClientRequest>(), pending = new Set<AbortController>()
  let active = true, authority = '', closing: Promise<void> | undefined
  const reject = (response: ServerResponse, status = 502) => {
    if (response.headersSent) { response.destroy(); return }
    response.writeHead(status, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
    response.end('Managed connector request unavailable')
  }
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const authorization = Buffer.from(typeof request.headers.authorization === 'string' ? request.headers.authorization : '')
    if (!active || request.url !== '/mcp' || request.headers.host !== authority || request.headers.origin !== undefined
      || authorization.length !== token.length || !timingSafeEqual(authorization, token)) return reject(response, 403)
    if (!['POST','GET','DELETE'].includes(request.method ?? '')) return reject(response, 405)
    if (pending.size >= maxInflight) return reject(response, 503)
    const controller = new AbortController(), signal = controller.signal
    pending.add(controller)
    const abort = () => controller.abort()
    request.once('aborted', abort); response.once('close', abort)
    const deadline = setTimeout(abort, 15_000)
    let upstream: ClientRequest | undefined
    const abortStreams = () => { request.destroy(); upstream?.destroy() }
    signal.addEventListener('abort', abortStreams, { once: true })
    try {
      // A bounded request body avoids partially delivering an oversized write.
      // There is never an automatic resend after an ambiguous remote outcome.
      const chunks: Buffer[] = []; let size = 0
      for await (const part of request) {
        size += part.length
        if (size > maxBody || request.method !== 'POST' && size > 0) throw denied()
        chunks.push(Buffer.from(part)); signal.throwIfAborted()
      }
      const answers = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }]
        : await Promise.race([lookup(hostname, { all: true, verbatim: true }), new Promise<never>((_, fail) => {
          signal.addEventListener('abort', () => fail(denied()), { once: true })
        })])
      signal.throwIfAborted()
      if (!active || !answers.length || answers.length > 64 || answers.some(item => !isConnectorPublicAddress(item.address)
        || isIP(item.address) !== item.family)) throw denied()
      const selected = answers[0]!
      const headers: OutgoingHttpHeaders = { ...fixed, 'accept-encoding': 'identity' }
      for (const name of wireHeaders) {
        const value = request.headers[name]
        if (value !== undefined) {
          if (typeof value !== 'string' || value.length > 8192) throw denied()
          headers[name] = value
        }
      }
      if (request.method === 'POST') headers['content-length'] = size
      await new Promise<void>((resolve, fail) => {
        upstream = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
          method: request.method, headers, agent: false, signal, maxHeaderSize: 16 * 1024,
          ...(target.protocol === 'https:' ? { rejectUnauthorized: true } : {}),
          // Keep original host/SNI and default TLS certificate verification.
          // Only the socket address is pinned. Node may request an all-result
          // lookup; both forms return the same already-approved address.
          lookup: (_name, options, callback) => {
            if (options.all) callback(null, [selected])
            else callback(null, selected.address, selected.family)
          },
        }, remote => {
          clearTimeout(deadline)
          const status = remote.statusCode ?? 502
          if (status >= 300 && status < 400 || status >= 400 && ![400,401,403,404,405,409,429].includes(status)) {
            remote.destroy(); reject(response); resolve(); return
          }
          if (status >= 400) {
            // Native status handling remains available, but an upstream error
            // body/auth challenge cannot disclose secrets or route OAuth elsewhere.
            remote.destroy(); reject(response, status); resolve(); return
          }
          if (remote.headers['content-encoding'] && remote.headers['content-encoding'] !== 'identity') {
            remote.destroy(); reject(response); resolve(); return
          }
          for (const name of ['content-type', 'mcp-session-id', 'retry-after']) {
            const value = remote.headers[name]
            if (typeof value === 'string') response.setHeader(name, value)
          }
          response.setHeader('cache-control', 'no-store'); response.statusCode = status
          let bytes = 0
          remote.on('data', chunk => { bytes += chunk.length; if (bytes > maxResponse) controller.abort() })
          remote.once('error', fail); remote.once('end', resolve)
          remote.pipe(response) // Native backpressure, not an accumulated SSE log.
        })
        outgoing.add(upstream)
        upstream.setTimeout(180_000, abort) // Explicit abort; Node timeout alone does not cancel.
        upstream.once('error', fail)
        upstream.once('close', () => outgoing.delete(upstream!))
        upstream.end(Buffer.concat(chunks))
      })
    } catch { reject(response) }
    finally {
      clearTimeout(deadline); pending.delete(controller)
      request.off('aborted', abort); response.off('close', abort)
      signal.removeEventListener('abort', abortStreams)
      upstream?.destroy()
    }
  }
  const server = createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 15_000, headersTimeout: 10_000 }, (request, response) => {
    void handle(request, response).catch(() => reject(response))
  })
  server.maxConnections = 16
  server.on('connection', socket => { incoming.add(socket); socket.on('error', () => {}); socket.once('close', () => incoming.delete(socket)) })
  server.on('clientError', (_error, socket) => socket.destroy())
  server.on('upgrade', (_request, socket) => socket.destroy())
  server.on('connect', (_request, socket) => socket.destroy())
  const close = () => closing ??= (async () => {
    active = false; token.fill(0)
    for (const controller of pending) controller.abort()
    for (const request of outgoing) request.destroy()
    for (const socket of incoming) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })()
  try {
    await new Promise<void>((resolve, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => { server.off('error', fail); resolve() }) })
    const address = server.address()
    if (!address || typeof address === 'string') throw denied()
    authority = `127.0.0.1:${address.port}`
    server.on('error', () => { void close() })
    return Object.freeze({ url: `http://${authority}/mcp`, headers: Object.freeze({ authorization: token.toString() }), close })
  } catch { await close(); throw denied() }
}
