// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { PaimindHostWebRoute } from '@paimind/harness-compat'
import { apply, inject } from '../src/index.js'
import { MANIFEST_JSON, MANIFEST_PATH } from '../src/document-identity.js'

const servers: Server[] = []
afterEach(async () => { for (const server of servers.splice(0)) {
  server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()))
} })
describe('source-owned branding manifest HTTP route, not browser acceptance', () => {
  it('serves exact static metadata and HEAD, rejects selectors and writes, and unregisters on unload', async () => {
    let installed: PaimindHostWebRoute | undefined, dispose: (() => void) | undefined
    expect(inject).toEqual(['webServer'])
    apply({ effect: install => { dispose = install() }, webServer: { register: route => {
      expect(installed).toBeUndefined(); installed = route; return () => { installed = undefined }
    } } })
    expect(installed).toMatchObject({ kind: 'exact', path: MANIFEST_PATH })
    const server = createServer((req, res) => {
      if (installed) void installed.handler(req, res)
      else res.writeHead(404).end()
    })
    servers.push(server); await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('No test port')
    const origin = `http://127.0.0.1:${address.port}`
    const response = await fetch(origin + MANIFEST_PATH)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/manifest+json; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe(MANIFEST_JSON)
    expect(JSON.parse(MANIFEST_JSON)).toEqual({ name: 'Paramont Harness', short_name: 'Paramont', display: 'standalone', start_url: '/' })
    const head = await fetch(origin + MANIFEST_PATH, { method: 'HEAD' })
    expect(head.status).toBe(200); expect(await head.text()).toBe('')
    expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength(MANIFEST_JSON)))
    for (const method of ['POST', 'PUT', 'DELETE']) expect((await fetch(origin + MANIFEST_PATH, { method })).status).toBe(405)
    for (const path of [MANIFEST_PATH + '?userId=other', MANIFEST_PATH + '/', '/manifest.webmanifest']) {
      expect((await fetch(origin + path)).status).toBe(404)
    }
    dispose?.(); expect(installed).toBeUndefined()
    expect((await fetch(origin + MANIFEST_PATH)).status).toBe(404)
  })
})
