import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import type { PaimindBentoHostContext } from '@paimind/harness-compat'
import { BENTO_INFO_PATH, type BentoSandboxInfo } from './shared.js'

export * from './shared.js'

export const name = 'paimind-renderer-bento'
export const inject = ['webServer', 'sessions']
export const BENTO_MAX_BYTES = 25 * 1024 * 1024

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

/** Read-only info route fence; cross-site browser requests never receive the sandbox token. */
export function isTrustedInfoRequest(req: Pick<IncomingMessage, 'headers'>): boolean {
  const host = req.headers.host
  if (host === undefined) return false
  let hostname: string
  try { hostname = new URL(`http://${host}`).hostname } catch { return false }
  if (hostname !== 'localhost' && hostname !== '[::1]' && !hostname.startsWith('127.')) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === host } catch { return false }
}

const tokenMatches = (received: string | null, expected: string): boolean => {
  if (received === null) return false
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Resolve a real HTML file under the Session's authoritative real Workspace root. */
export async function resolveBentoFile(root: string, input: string): Promise<string | null> {
  if (!isAbsolute(root) || !isAbsolute(input)) return null
  const extension = extname(input).toLowerCase()
  if (extension !== '.html' && extension !== '.htm') return null
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(input)]).catch(() => [null, null] as const)
  if (realRoot === null || realFile === null) return null
  const edge = relative(realRoot, realFile)
  if (edge === '' || edge.startsWith('..') || isAbsolute(edge)) return null
  const info = await stat(realFile).catch(() => null)
  if (info === null || !info.isFile() || info.size > BENTO_MAX_BYTES) return null
  return realFile
}

/** CSP intentionally gives the isolated origin storage but no network channel back to Harness. */
export const BENTO_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolveListen() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Bento sandbox did not bind a TCP port')
  return address.port
}

export async function apply(ctx: PaimindBentoHostContext): Promise<() => Promise<void>> {
  const token = randomBytes(24).toString('base64url')
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://paimind-bento.invalid')
      if (req.method !== 'GET' || url.pathname !== '/file' || !tokenMatches(url.searchParams.get('token'), token)) {
        res.writeHead(404); res.end(); return
      }
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const path = url.searchParams.get('path') ?? ''
      const sessionRoot = ctx.sessions.get(sessionId)?.header.cwd
      if (sessionRoot === undefined) { res.writeHead(403); res.end('Session unavailable'); return }
      const safe = await resolveBentoFile(resolve(sessionRoot), path)
      if (safe === null) { res.writeHead(403); res.end('File unavailable'); return }
      const body = await readFile(safe)
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': BENTO_CSP,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'cross-origin',
      })
      res.end(body)
    } catch {
      res.writeHead(500); res.end('Sandbox failed')
    }
  })
  const port = await listen(server)
  const info: BentoSandboxInfo = Object.freeze({ origin: `http://127.0.0.1:${port}`, token })
  const unregister = ctx.webServer.register({
    kind: 'prefix',
    path: BENTO_INFO_PATH,
    handler(req, res) {
      if (req.method !== 'GET' || !isTrustedInfoRequest(req)) { json(res, 403, { error: 'forbidden' }); return }
      json(res, 200, info)
    },
  })
  return async () => {
    unregister()
    await new Promise<void>(resolveClose => { server.close(() => { resolveClose() }) })
  }
}
