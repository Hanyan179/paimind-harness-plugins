// @vitest-environment node
import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createEnterpriseServer } from '../src/server.js'
import type { Identity } from '../src/identity.js'
import type { NativeGateway } from '../src/native-gateway.js'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
describe('bounded native-resource diagnostics (not Browser E2E)', () => {
  it('reports completion once, excludes secrets and ignores non-asset/private paths', async () => {
    const events: object[] = []
    const nativeGateway = { attach() {}, async http(_req: unknown, res: import('node:http').ServerResponse) { res.end('bundle') } } as unknown as NativeGateway
    const server = createEnterpriseServer({ identity: {} as Identity, publicOrigin: 'http://127.0.0.1:62167',
      loopbackDevelopment: true, nativeGateway, onNativeResourceResponse: event => { events.push(event) } })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
    const address = server.address(); if (!address || typeof address === 'string') throw Error('No test port')
    const get = (path: string, spoof = false) => new Promise<void>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: address.port, path,
        headers: { host: '127.0.0.1:62167', cookie: 'private-cookie', ...(spoof ? { 'x-paimind-role': 'untrusted' } : {}) } }, async res => {
        try { for await (const _chunk of res) { /* drain */ } resolve() } catch (error) { reject(error) }
      })
      req.once('error', reject); req.end()
    })
    await get('/plugins/@paimind/renderer-pdf/client.js?secret=private-query')
    await get('/files/private-document')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ resource: '/plugins/@paimind/renderer-pdf/client.js', status: 200, complete: true })
    await get('/plugins/@paimind/renderer-pdf/client.js', true)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ status: 400, complete: true })
    expect(JSON.stringify(events)).not.toMatch(/private-|untrusted|cookie|secret/)
  })
})
