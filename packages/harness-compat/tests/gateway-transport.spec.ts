import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createHarnessSessionReadback, decodeHarnessSessionReadback, harnessDocumentContentPolicy, harnessDocumentWithAuthenticatedManifest, isHarnessDocumentRequest, isHarnessDownlink } from '../src/gateway-transport.js'

describe('native browser downlink contract', () => {
  it('recognizes only the two exact downlinks, never RPC calls or aliased paths', () => {
    for (const target of ['/api/events.host', '/api/events.mux']) expect(isHarnessDownlink('GET', target)).toBe(true)
    for (const target of ['/api/host.describe', '/api/events.host?user=other', '/api/events.host/', '/api/%65vents.host']) {
      expect(isHarnessDownlink('GET', target)).toBe(false)
    }
    expect(isHarnessDownlink('POST', '/api/events.host')).toBe(false)
  })
})

describe('native document security policy contract', () => {
  const queue = 'window.__ModuleLoader__={}'
  const graph = 'globalThis["__DSH_BOOT__"] = {}'
  const document = `<head><script>${queue}</script><script>${graph}</script><script src="/assets/index.js"></script></head><div id="root"></div>`
  it('adds manifest credentials before delivery without changing bootstrap hashes or relaxing manifest CSP', () => {
    const link = '<link rel="manifest" href="/manifest.webmanifest" />'
    const original = document.replace('<head>', '<head>' + link)
    const prepared = harnessDocumentWithAuthenticatedManifest(original)
    expect(prepared).toBe(original.replace(link, '<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />'))
    expect(harnessDocumentWithAuthenticatedManifest(prepared)).toBe(prepared)
    expect(harnessDocumentWithAuthenticatedManifest(document)).toBe(document)
    expect(harnessDocumentContentPolicy(prepared, 'http://127.0.0.1:12345')).toBe(harnessDocumentContentPolicy(original, 'http://127.0.0.1:12345'))
    expect(harnessDocumentContentPolicy(prepared, 'http://127.0.0.1:12345').split('; ')).toContain("manifest-src 'self'")
    for (const changed of [link + link, link.replace('/manifest.webmanifest', '//other.example/manifest'),
      link.replace('/manifest.webmanifest', '/manifest.webmanifest?user=other'), link.replace('/>', 'crossorigin="anonymous" />')]) {
      expect(() => harnessDocumentWithAuthenticatedManifest(document.replace('<head>', '<head>' + changed))).toThrow('manifest link')
    }
    expect(() => harnessDocumentWithAuthenticatedManifest(original + ' '.repeat(256 * 1024))).toThrow('document size')
  })
  it('selects only native root GET documents, never artifact or unknown routes', () => {
    for (const path of ['/', '/index.html', '/?ignored=1']) expect(isHarnessDocumentRequest('GET', path)).toBe(true)
    for (const path of ['/files/index.html', '/admin', '/index.html/extra', '/%69ndex.html', '/#root']) expect(isHarnessDocumentRequest('GET', path)).toBe(false)
    expect(isHarnessDocumentRequest('POST', '/')).toBe(false)
  })
  it('hashes exact inline bootstrap blocks, narrows external scripts and never allows inline event handlers', () => {
    const policy = harnessDocumentContentPolicy(document, 'http://127.0.0.1:12345')
    for (const source of [queue, graph]) expect(policy).toContain(`'sha256-${createHash('sha256').update(source).digest('base64')}'`)
    const scripts = policy.split('; ')[1]!
    expect(scripts).toContain('http://127.0.0.1:12345/assets/ http://127.0.0.1:12345/plugins/')
    expect(scripts).toContain("'unsafe-eval'")
    expect(scripts).not.toContain("'unsafe-inline'")
    expect(scripts).not.toContain("'self'")
    expect(policy).toContain("script-src-attr 'none'")
    expect(policy).toContain('ws://127.0.0.1:12345/api/events.host ws://127.0.0.1:12345/api/events.mux')
    expect(harnessDocumentContentPolicy(document, 'https://enterprise.example:9443')).toContain('wss://enterprise.example:9443/api/events.host')
  })
  it('adds only deployment-selected same-origin downlink paths without allowing arbitrary websocket origins', () => {
    const paths = ['/sidebar/ws/agent-terminals', '/sidebar/ws/agent-opens']
    const policy = harnessDocumentContentPolicy(document, 'https://enterprise.example:9443', paths)
    const connect = policy.split('; ').find(value => value.startsWith('connect-src'))!
    for (const path of paths) expect(connect).toContain('wss://enterprise.example:9443' + path)
    expect(connect).not.toContain(' wss: ')
    expect(harnessDocumentContentPolicy(document, 'https://enterprise.example:9443')).not.toContain('/sidebar/')
    for (const selected of [['/'], ['/sidebar/'], ['/sidebar//opens'], ['//other.example/path'],
      ['wss://other.example/path'], ['/sidebar/*'], ['/sidebar/opens?sessionId=a'], ['/sidebar/opens#x'], ['/sidebar/opens', '/sidebar/opens']]) {
      expect(() => harnessDocumentContentPolicy(document, 'https://enterprise.example:9443', selected)).toThrow('downlink path')
    }
  })
  it('fails closed on unknown bootstrap shapes, oversized documents or unsafe origins', () => {
    for (const html of ['<script>alert(1)</script>', document.replace('id="root"', 'id="different"'), document + ' '.repeat(256 * 1024),
      document.replace(`<script>${graph}`, `<script nonce="untrusted">${graph}`), document + '<script>extra()</script>'.repeat(8)]) {
      expect(() => harnessDocumentContentPolicy(html, 'http://127.0.0.1:12345')).toThrow()
    }
    for (const origin of ['javascript:alert(1)', 'https://user:password@example.com', 'https://example.com/path']) {
      expect(() => harnessDocumentContentPolicy(document, origin)).toThrow()
    }
  })
})

describe('canonical native session existence readback', () => {
  const reply = (result: unknown, rpcId = 'probe') => JSON.stringify({ type: 'server-response', rpcId, result })
  const success = { ok: true, value: { events: [], hasMore: false } }
  it('uses the original history method with an empty page boundary and exact correlation', () => {
    expect(JSON.parse(createHarnessSessionReadback('session-hansen', 'probe'))).toEqual({
      type: 'client-request', rpcId: 'probe', method: 'session.history', payload: { sessionId: 'session-hansen', beforeSeq: 0, maxMessages: 1 },
    })
    expect(decodeHarnessSessionReadback(reply(success), 'probe', 'session-hansen')).toBe('present')
    expect(decodeHarnessSessionReadback(reply({ ok: false, error: { code: 'session-not-found', message: 'missing',
      details: { sessionId: 'session-alex' } } }), 'probe', 'session-alex')).toBe('missing')
  })
  it('never treats errors, wrong correlation, missing fields or unexpected history content as proof', () => {
    for (const text of ['{}', 'not-json', reply(success, 'other-probe'), reply({ ok: true }),
      reply({ ok: true, value: { items: [] } }), reply({ ok: true, value: { events: [{}], hasMore: false } }),
      reply({ ok: false, error: { code: 'internal', message: 'failure', details: {} } }),
      reply({ ok: false, error: { code: 'session-not-found', message: 'missing', details: { sessionId: 'other' } } })]) {
      expect(() => decodeHarnessSessionReadback(text, 'probe', 'session-hansen')).toThrow()
    }
  })
})
