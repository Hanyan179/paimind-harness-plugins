import type { PaimindHostWebServer } from '@paimind/harness-compat'
import { MANIFEST_JSON, MANIFEST_PATH } from './document-identity.js'

/** Host half of the Paramont identity plugin. */
export const name = 'paimind-branding'
export const inject = ['webServer']

export interface BrandingHostContext {
  readonly webServer: PaimindHostWebServer
  effect(install: () => () => void, label?: string): void
}

/** Serve only static product identity. No account data, configuration writes,
 * native route replacement or additional runtime is owned here. The existing
 * enterprise gateway retains authentication before this exact plugin route. */
export function apply(ctx: BrandingHostContext): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: MANIFEST_PATH,
    handler(request, response) {
      if (request.url !== MANIFEST_PATH) { response.writeHead(404).end(); return }
      if (!['GET', 'HEAD'].includes(request.method ?? '')) {
        response.writeHead(405, { allow: 'GET, HEAD' }).end(); return
      }
      response.writeHead(200, { 'content-type': 'application/manifest+json; charset=utf-8',
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'content-length': Buffer.byteLength(MANIFEST_JSON) })
      response.end(request.method === 'HEAD' ? undefined : MANIFEST_JSON)
    },
  }), 'paimind-branding: document manifest')
}
