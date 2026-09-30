// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { NativeGateway } from '../src/native-gateway.js'
import { EnterpriseError } from '../src/errors.js'
import { authorizeNativeOperation } from '../src/native-operation-policy.js'
import type { RuntimeGrant } from '../src/runtime-bindings.js'
import { apply as installBranding } from '../../../packages/branding/src/index.js'
import { MANIFEST_PATH } from '../../../packages/branding/src/document-identity.js'
import type { PaimindHostWebRoute } from '@paimind/harness-compat'

const servers: Server[] = [], gateways: NativeGateway[] = []
afterEach(async () => {
  for (const gateway of gateways.splice(0)) gateway.close()
  for (const server of servers.splice(0)) {
    server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()))
  }
})
async function listen(server: Server) {
  servers.push(server); await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No test port')
  return `http://127.0.0.1:${address.port}`
}

describe('authenticated manifest HTTP carrier with explicit identity fixtures, not Browser E2E', () => {
  it('keeps original and branded manifests authenticated, preserves CSP and removes the owned route on unload', async () => {
    let route: PaimindHostWebRoute | undefined, unload: (() => void) | undefined
    installBranding({ effect: install => { unload = install() }, webServer: { register: value => {
      route = value; return () => { route = undefined }
    } } })
    const receivedCookies: (string | undefined)[] = []
    const original = '<head><link rel="manifest" href="/manifest.webmanifest" /><script>window.__ModuleLoader__={}</script><script>globalThis["__DSH_BOOT__"] = {}</script></head><div id="root"></div>'
    const upstream = await listen(createServer((req, res) => {
      receivedCookies.push(req.headers.cookie)
      if (req.url?.startsWith(MANIFEST_PATH) && route) { void route.handler(req, res); return }
      if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end(original); return }
      if (req.url === '/manifest.webmanifest') {
        res.setHeader('content-type', 'application/manifest+json')
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ name: 'DeepSeek Harness' })); return
      }
      res.writeHead(404).end()
    }))
    let gateway: NativeGateway
    const origin = await listen(createServer((req, res) => {
      void gateway.http(req, res, randomUUID()).catch(error => {
        if (!res.destroyed) res.writeHead(error instanceof EnterpriseError ? error.status : 500).end()
      })
    }))
    const grant: RuntimeGrant = { cellId: randomUUID(), tenantId: 'fixture', userId: randomUUID(),
      role: 'member', revision: randomUUID(), origin: upstream, validForMs: 10000 }
    gateway = new NativeGateway({ publicOrigin: origin,
      resolve: async token => {
        if (token !== 'existing-fixture-session') throw new EnterpriseError(401, 'unauthenticated', 'Expired')
        return grant
      },
      authorize: async (_token, _requestId, selected, request) => authorizeNativeOperation(selected.role, request),
    })
    gateways.push(gateway)
    const headers = { cookie: 'paimind_haas_session=existing-fixture-session', origin }
    for (const target of ['/', '/manifest.webmanifest', MANIFEST_PATH]) {
      expect((await fetch(origin + target)).status).toBe(401)
    }
    expect(receivedCookies).toHaveLength(0)
    const root = await fetch(origin + '/', { headers })
    const html = await root.text()
    expect(root.status).toBe(200)
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />')
    expect(root.headers.get('content-length')).toBe(String(Buffer.byteLength(html)))
    const policy = root.headers.get('content-security-policy')!
    expect(policy.split('; ')).toContain("manifest-src 'self'")
    expect(policy.split('; ').find(row => row.startsWith('manifest-src'))).not.toMatch(/data:|blob:|\*/)
    for (const method of ['GET', 'HEAD']) for (const target of ['/manifest.webmanifest', MANIFEST_PATH]) {
      const response = await fetch(origin + target, { method, headers })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/manifest+json')
      if (method === 'HEAD') expect(await response.text()).toBe('')
      else expect(await response.json()).toMatchObject({ name: target === MANIFEST_PATH ? 'Paramont Harness' : 'DeepSeek Harness' })
    }
    expect((await fetch(origin + '/manifest.webmanifest?userId=other', { headers })).status).toBe(400)
    expect((await fetch(origin + MANIFEST_PATH + '?userId=other', { headers })).status).toBe(404)
    expect(receivedCookies.every(value => value === undefined)).toBe(true)
    unload?.()
    expect((await fetch(origin + MANIFEST_PATH, { headers })).status).toBe(404)
  })
})
