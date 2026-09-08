import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, relative, resolve } from 'node:path'
import type { PaimindHostSessionService, PaimindHostWebServer } from '@hansen/harness-compat'
import { TRACE_DOCUMENT_PATH, TRACE_SCHEMA_V3 } from './shared.js'

export * from './shared.js'

export const name = 'paimind-presentation-trace'
export const inject = ['webServer', 'sessions']
export const TRACE_MAX_BYTES = 16 * 1024 * 1024

export interface PresentationTraceHostContext {
  readonly webServer: PaimindHostWebServer
  readonly sessions: PaimindHostSessionService
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

function trustedRequest(request: Pick<IncomingMessage, 'headers'>): boolean {
  const host = request.headers.host
  if (host === undefined || request.headers['sec-fetch-site'] === 'cross-site') return false
  let hostname: string
  try { hostname = new URL(`http://${host}`).hostname } catch { return false }
  if (hostname !== 'localhost' && hostname !== '[::1]' && !hostname.startsWith('127.')) return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === host } catch { return false }
}

async function safeTraceFile(root: string, input: string, expectedBytes: number): Promise<string | null> {
  const candidate = isAbsolute(input) ? input : resolve(root, input)
  if (!candidate.toLowerCase().endsWith('.trace.json')) return null
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(candidate)]).catch(() => [null, null] as const)
  if (realRoot === null || realFile === null) return null
  const edge = relative(realRoot, realFile)
  if (edge === '' || edge.startsWith('..') || isAbsolute(edge)) return null
  const info = await stat(realFile).catch(() => null)
  if (info === null || !info.isFile() || info.size !== expectedBytes || info.size > TRACE_MAX_BYTES) return null
  return realFile
}

function respond(response: ServerResponse, status: number, body: Buffer | string): void {
  response.writeHead(status, {
    'content-type': status === 200 ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  })
  response.end(body)
}

/** Fail-closed Host loader for V2 sidecar references retained in the Session projection. */
export function apply(ctx: PresentationTraceHostContext): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: TRACE_DOCUMENT_PATH,
    async handler(request, response) {
      if (request.method !== 'GET' || !trustedRequest(request)) { respond(response, 403, 'Forbidden'); return }
      try {
        const url = new URL(request.url ?? TRACE_DOCUMENT_PATH, 'http://paimind.invalid')
        const sessionId = url.searchParams.get('sessionId') ?? ''
        const path = url.searchParams.get('path') ?? ''
        const sha256 = url.searchParams.get('sha256') ?? ''
        const schema = url.searchParams.get('schema') ?? ''
        const bytes = Number(url.searchParams.get('bytes'))
        if (!/^[a-f0-9]{64}$/.test(sha256) || schema !== TRACE_SCHEMA_V3 || !Number.isSafeInteger(bytes) || bytes < 2 || bytes > TRACE_MAX_BYTES) { respond(response, 400, 'Invalid trace reference'); return }
        const root = ctx.sessions.get(sessionId)?.header.cwd
        if (root === undefined) { respond(response, 403, 'Session unavailable'); return }
        const safe = await safeTraceFile(resolve(root), path, bytes)
        if (safe === null) { respond(response, 403, 'Trace unavailable'); return }
        const body = await readFile(safe)
        if (createHash('sha256').update(body).digest('hex') !== sha256) { respond(response, 409, 'Trace hash mismatch'); return }
        const value = JSON.parse(body.toString('utf8')) as { readonly schemaVersion?: unknown }
        if (value.schemaVersion !== schema) { respond(response, 409, 'Trace schema mismatch'); return }
        respond(response, 200, body)
      } catch { respond(response, 500, 'Trace load failed') }
    },
  }), 'paimind-presentation-trace: sidecar route')
}
