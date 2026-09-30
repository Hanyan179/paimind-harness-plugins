// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { classifyHarnessReadRequest, decodeHarnessRpcOperation, isHarnessDownlink } from '../src/gateway-transport.js'

const envelope = (method: string, payload: unknown) => Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'test-request', method, payload }))
describe('published native operation carrier', () => {
  it('classifies only the exact original manifest as an authenticated finite asset', () => {
    for (const method of ['GET', 'HEAD']) expect(classifyHarnessReadRequest(method, '/manifest.webmanifest')).toBe('asset')
    for (const target of ['/manifest.webmanifest?', '/manifest.webmanifest?userId=other', '/manifest.webmanifest/', '/%6danifest.webmanifest']) {
      expect(classifyHarnessReadRequest('GET', target)).toBeUndefined()
    }
    expect(classifyHarnessReadRequest('POST', '/manifest.webmanifest')).toBeUndefined()
  })
  it('classifies the original setting writes and external document opener without deciding enterprise authority', () => {
    for (const endpoint of ['settings.update', 'settings.replace', 'settings.mutate']) {
      expect(decodeHarnessRpcOperation('POST', '/api/' + endpoint, 'application/json', envelope(endpoint, { ns: 'paimind-feature-packs' })))
        .toMatchObject({ capability: 'settings-write', args: { ns: 'paimind-feature-packs' } })
    }
    expect(decodeHarnessRpcOperation('POST', '/api/settings.openDocument', 'application/json', envelope('settings.openDocument', {})).capability).toBe('settings-document')
    expect(decodeHarnessRpcOperation('POST', '/api/settings.futureWrite', 'application/json', envelope('settings.futureWrite', {})).capability).toBe('unsupported-settings')
  })
  it('uses the native response schema for question replies, not the request schema', () => {
    const body = Buffer.from(JSON.stringify({ type: 'client-response', rpcId: 'question-owned', result: { ok: true, value: {} } }))
    expect(decodeHarnessRpcOperation('POST', '/api/respond', 'application/json', body).kind).toBe('response')
    expect(() => decodeHarnessRpcOperation('POST', '/api/respond', 'application/json', envelope('respond', {}))).toThrow()
  })
  it('uses the upstream request schema for both native and Remote carriers', () => {
    expect(decodeHarnessRpcOperation('POST', '/api/session.prompt', 'application/json; charset=utf-8',
      envelope('session.prompt', { sessionId: 'owned' }))).toMatchObject({ endpoint: 'session.prompt', capability: 'conversation', args: { sessionId: 'owned' } })
    expect(decodeHarnessRpcOperation('POST', '/api/paimindAgentProfiles/saveProfile', 'application/json',
      envelope('paimindAgentProfiles/saveProfile', { args: { input: { productKind: 'personal' } } })))
      .toMatchObject({ endpoint: 'paimindAgentProfiles/saveProfile', capability: undefined, args: { input: { productKind: 'personal' } } })
  })
  it('does not assign conversation capability by namespace prefix or caller-supplied method', () => {
    for (const name of ['session.newAdminMethod', 'credentials.set', 'llm.discoverModels', 'host.openPath']) {
      expect(decodeHarnessRpcOperation('POST', `/api/${name}`, 'application/json', envelope(name, {})).capability).toBeUndefined()
    }
    expect(() => decodeHarnessRpcOperation('POST', '/api/session.prompt', 'application/json', envelope('settings.replace', {}))).toThrow()
  })
  it('rejects carrier aliases, invalid UTF-8, loose payloads, missing envelope fields and non-JSON bodies', () => {
    for (const target of ['/api/session.prompt?method=settings.replace', '/api/session.prompt/', '/api/session%2eprompt',
      '/api//session.prompt', '/api/a/b/c', '/api/session.prompt#x']) {
      expect(() => decodeHarnessRpcOperation('POST', target, 'application/json', envelope('session.prompt', {}))).toThrow()
    }
    for (const payload of [{ args: {}, other: true }, { args: [] }, [], null]) {
      expect(() => decodeHarnessRpcOperation('POST', '/api/a/b', 'application/json', envelope('a/b', payload))).toThrow()
    }
    for (const body of [Buffer.from('{}'), Buffer.from('{'), Buffer.from([0xff]), new Uint8Array(8 * 1024 * 1024 + 1)]) {
      expect(() => decodeHarnessRpcOperation('POST', '/api/session.prompt', 'application/json', body)).toThrow()
    }
    expect(() => decodeHarnessRpcOperation('POST', '/api/session.prompt', 'text/plain', envelope('session.prompt', {}))).toThrow()
    expect(() => decodeHarnessRpcOperation('GET', '/api/session.prompt', 'application/json', envelope('session.prompt', {}))).toThrow()
  })
  it('classifies native read surfaces without promoting unknown files or encoded traversal', () => {
    for (const path of ['/', '/index.html?view=1']) expect(classifyHarnessReadRequest('GET', path)).toBe('document')
    for (const path of ['/assets/index.js', '/plugins/@paimind/enterprise-admin/client.js?v=1']) expect(classifyHarnessReadRequest('GET', path)).toBe('asset')
    expect(classifyHarnessReadRequest('GET', '/api/events.host')).toBe('event-downlink')
    expect(classifyHarnessReadRequest('GET', '/api/session.export?sessionId=owned')).toBe('session-export')
    for (const path of ['/files/secrets', '/admin', '/assets/../files/x', '/assets/%2e%2e/files/x', '//external.invalid/a',
      '/api/session.export?sessionId=a&sessionId=b', '/api/session.export?sessionId=a&path=/secrets', '/api/events.host?other=1']) {
      expect(classifyHarnessReadRequest('GET', path)).toBeUndefined()
    }
  })
  it('classifies only the exact plugin event GET as long-lived without promoting it to WebSocket', () => {
    expect(classifyHarnessReadRequest('GET', '/plugins/events')).toBe('event-downlink')
    expect(isHarnessDownlink('GET', '/plugins/events')).toBe(false)
    for (const target of ['/plugins/events?x=1', '/plugins/events/', '/plugins/%65vents', '/plugins/events#x']) {
      expect(classifyHarnessReadRequest('GET', target)).not.toBe('event-downlink')
    }
    expect(classifyHarnessReadRequest('HEAD', '/plugins/events')).not.toBe('event-downlink')
    expect(classifyHarnessReadRequest('POST', '/plugins/events')).toBeUndefined()
  })
  it('preserves original export HEAD/GET query values and rejects duplicate or extra authority selectors', () => {
    for (const method of ['HEAD', 'GET']) {
      for (const suffix of ['', '&includeDescendants=true', '&includeDescendants=false']) {
        expect(classifyHarnessReadRequest(method, '/api/session.export?sessionId=owned' + suffix)).toBe('session-export')
      }
      for (const suffix of ['&includeDescendants=1', '&includeDescendants=True', '&includeDescendants=',
        '&includeDescendants=true&includeDescendants=false', '&sessionId=foreign', '&userId=alex', '&path=/secrets']) {
        expect(classifyHarnessReadRequest(method, '/api/session.export?sessionId=owned' + suffix)).toBeUndefined()
      }
      expect(classifyHarnessReadRequest(method, '/api/session.export?includeDescendants=true')).toBeUndefined()
      expect(classifyHarnessReadRequest(method, '/api/session.export?sessionId=&includeDescendants=true')).toBeUndefined()
    }
    expect(classifyHarnessReadRequest('POST', '/api/session.export?sessionId=owned&includeDescendants=true')).toBeUndefined()
  })
})
