// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, request, type Server } from 'node:http'
import { validateRequest } from '../src/http-boundary.js'
import { EnterpriseError } from '../src/errors.js'

const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
const navigation = {
  'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document', 'sec-fetch-user': '?1', accept: 'text/html',
}
async function fixture(upgrade = false) {
  let origin: URL
  const server = createServer((req, res) => {
    try { validateRequest(req, origin, upgrade); res.writeHead(204); res.end() }
    catch (e) { res.writeHead(e instanceof EnterpriseError ? e.status : 500); res.end() }
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('No local test port')
  origin = new URL(`http://127.0.0.1:${address.port}`)
  return { origin: origin.origin,
    call: (path = '/', headers: Record<string, string | string[]> = navigation, method = 'GET') => new Promise<number>(resolve => {
      request(new URL(path, origin), { method, headers }, res => { res.resume(); res.once('end', () => resolve(res.statusCode!)) }).end()
    }),
  }
}
describe('HTTP request boundary: user navigation is not API or frame authorization', () => {
  it.each(['/', '/index.html', '/haas/login', '/haas/recover'])('allows user-activated top-level entry to %s', async path => {
    const f = await fixture(); expect(await f.call(path)).toBe(204)
  })
  it.each(['/api/session.history', '/api/events.host', '/api/session.export?sessionId=known', '/haas/v1/auth/me',
    '/haas/v1/auth/logout', '/assets/a.js', '/haas/auth.js', '/plugins/a.js', '/artifact/report', '/health'])('does not allow cross-site data path %s', async path => {
    const f = await fixture(); expect(await f.call(path)).toBe(403)
  })
  it.each([
    { 'sec-fetch-mode': 'cors' }, { 'sec-fetch-mode': 'no-cors' }, { 'sec-fetch-mode': '' },
    { 'sec-fetch-dest': 'iframe' }, { 'sec-fetch-dest': 'empty' }, { 'sec-fetch-dest': '' },
    { 'sec-fetch-user': '?0' }, { 'sec-fetch-user': '' }, { accept: 'application/json' },
    { origin: 'https://foreign.invalid' }, { origin: 'null' },
  ])('rejects non-navigation or foreign-Origin variation %j', async variation => {
    const f = await fixture(); expect(await f.call('/', { ...navigation, ...variation })).toBe(403)
  })
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])('does not exempt %s even with navigation headers', async method => {
    const f = await fixture(); expect(await f.call('/', navigation, method)).toBe(403)
  })
  it('rejects cross-site Upgrade and duplicate navigation metadata', async () => {
    const f = await fixture(true); expect(await f.call('/', { ...navigation, origin: f.origin })).toBe(403)
    const normal = await fixture()
    expect(await normal.call('/', { ...navigation, 'sec-fetch-mode': ['navigate', 'cors'] })).toBe(400)
  })
  it('retains host and caller-identity rejection', async () => {
    const f = await fixture()
    expect(await f.call('/', { ...navigation, host: 'foreign.invalid' })).toBe(421)
    expect(await f.call('/', { ...navigation, 'x-paimind-user-id': 'foreign' })).toBe(400)
  })
  it('retains same-origin writes and rejects missing/foreign write Origin', async () => {
    const f = await fixture()
    expect(await f.call('/haas/v1/auth/login', { origin: f.origin }, 'POST')).toBe(204)
    expect(await f.call('/haas/v1/auth/login', {}, 'POST')).toBe(403)
    expect(await f.call('/haas/v1/auth/login', { origin: 'https://foreign.invalid' }, 'POST')).toBe(403)
  })
})
