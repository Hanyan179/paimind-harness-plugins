// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { createConnection } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeGateway } from '../src/native-gateway.js'
import { createEnterpriseServer } from '../src/server.js'
import { authorizeNativeOperation } from '../src/native-operation-policy.js'
import { EnterpriseError } from '../src/errors.js'
import type { Identity } from '../src/identity.js'
import type { RuntimeGrant } from '../src/runtime-bindings.js'
import { CellTransport } from '../src/cell-transport.js'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { createNativeControlBroker, createNativeControlPeer, handleNativeControl } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'

// Actual HTTP + private HTTP/Unix control chain. Authority and directory values
// are explicit fault fixtures, NOT PostgreSQL/native-filesystem/browser proof.
const disposers: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No test port')
  return `http://127.0.0.1:${address.port}`
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
async function fixture(role: 'admin' | 'member' = 'member') {
  const calls: unknown[] = [], audit: string[] = []
  const state = { loggedIn: true, omitCheck: false, auditFailure: false, hold: false, closed: false,
    malformed: '', truncated: false, beforeReturn: () => {}, content: Buffer.from('Hansen 的文件'), version: 'a'.repeat(64),
    holdOffset: -1, release: () => {}, filePath: '/workspace/hansen/说明.txt' }
  const broker = await createNativeControlBroker(); disposers.push(() => broker.close())
  const peer = createNativeControlPeer(createConnection(broker.path), { handle: (op, input, signal) =>
    handleNativeControl({ get: () => ({ directory: async (sessionId: string, path: string | undefined, cancellation: AbortSignal) => {
      calls.push({ sessionId, path })
      if (sessionId !== 'hansen-session' || path !== undefined && !['/workspace/hansen', '/workspace/hansen/资料'].includes(path)) throw Error('PRIVATE_NATIVE_ERROR')
      if (state.hold) await new Promise<void>(resolve => {
        const stop = () => { state.closed = true; resolve() }
        if (cancellation.aborted) stop(); else cancellation.addEventListener('abort', stop, { once: true })
      })
      state.beforeReturn()
      const directory = state.malformed === 'path' ? '/workspace/foreign' : path ?? '/workspace/hansen'
      const value = { path: directory, entries: [{ name: '说明.txt', path: directory + '/说明.txt', type: 'file', symlink: false, unavailable: false },
        { name: '资料', path: directory + '/资料', type: 'directory', symlink: false, unavailable: false },
        { name: '外部', path: directory + '/外部', type: 'other', symlink: true, unavailable: true }], truncated: state.truncated }
      if (state.malformed === 'extra') return { ...value, secret: 'PRIVATE_NATIVE_ERROR' }
      if (state.malformed === 'duplicate') value.entries.push(value.entries[0]!)
      if (state.malformed === 'size') value.entries = Array.from({ length: 1001 }, (_, i) => ({ ...value.entries[0]!, name: String(i), path: directory + '/' + i }))
      return value
    }, file: async (sessionId: string, path: string, offset: number, version: string | undefined, cancellation: AbortSignal) => {
      calls.push({ sessionId, path, offset, version })
      if (sessionId !== 'hansen-session' || ![state.filePath.split('/').at(-1), state.filePath].includes(path)) throw Error('PRIVATE_NATIVE_ERROR')
      if (state.hold || offset === state.holdOffset) await new Promise<void>(resolve => {
        const stop = () => { state.closed = true; resolve() }
        state.release = () => { cancellation.removeEventListener('abort', stop); resolve() }
        if (cancellation.aborted) stop(); else cancellation.addEventListener('abort', stop, { once: true })
      })
      const size = state.content.length, data = state.content.subarray(offset, offset + 65536).toString('base64')
      const value = { path: state.filePath, offset, version: state.version, size, data,
        nextOffset: offset + 65536 < size ? offset + 65536 : null }
      if (version !== undefined && version !== state.version) throw Error('PRIVATE_NATIVE_ERROR')
      state.beforeReturn()
      if (state.malformed === 'extra') return { ...value, secret: 'PRIVATE_NATIVE_ERROR' }
      if (state.malformed === 'path') value.path = '/workspace/foreign/private'
      if (state.malformed === 'data') value.data = 'invalid!'
      if (state.malformed === 'offset') value.offset += 1
      if (state.malformed === 'next') value.nextOffset = 1
      return value
    } }) }, op, input, signal) })
  disposers.push(() => peer.close()); await vi.waitFor(() => expect(broker.ready).toBe(true))
  const key = randomBytes(32).toString('hex')
  const ingress = createNativeIngress({ token: key, control: (op, input, signal) => broker.request(op, input, signal) })
  const privateOrigin = await listen(ingress.server); disposers.push(() => ingress.close())
  const transport = new CellTransport(privateOrigin, key); disposers.push(() => transport.destroy())
  const reservation = createServer(), publicOrigin = await listen(reservation); await close(reservation)
  let grant: RuntimeGrant = { tenantId: 'explicit-files-fixture', userId: randomUUID(), role, cellId: randomUUID(), revision: randomUUID(),
    origin: privateOrigin, transport: 'private-cell', validForMs: 10000 }
  const gateway = new NativeGateway({ publicOrigin, transports: new Map([[privateOrigin, transport]]), revalidateMs: 20,
    resolve: async () => { if (!state.loggedIn) throw new EnterpriseError(401, 'auth-required', '登录失效'); return grant },
    authorize: async (_token, _id, selected, operation, verify) => {
      authorizeNativeOperation(selected.role, operation)
      try {
        if (!state.omitCheck) await verify()
        if (state.auditFailure) throw new EnterpriseError(503, 'audit-unavailable', '审计不可用')
        audit.push('allow')
      } catch (error) { audit.push('deny'); throw error }
    } })
  const server = createEnterpriseServer({ identity: {} as Identity, publicOrigin, loopbackDevelopment: true, nativeGateway: gateway })
  await new Promise<void>(resolve => server.listen(Number(new URL(publicOrigin).port), '127.0.0.1', resolve))
  disposers.push(async () => { gateway.close(); await close(server) })
  const headers = { origin: publicOrigin, cookie: 'paimind_haas_session=PRIVATE_TEST_COOKIE' }
  const get = (suffix = '', id = 'hansen-session', signal?: AbortSignal) => fetch(`${publicOrigin}/haas/v1/sessions/${id}/files${suffix}`, { headers, signal })
  const preview = (value: object = { sessionId: 'hansen-session', path: '/workspace/hansen/说明.txt' }, signal?: AbortSignal) =>
    fetch(publicOrigin + '/sidebar/api/fs.read', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(value), signal })
  const download = (selection = { sessionId: 'hansen-session', path: state.filePath, download: '1' }, signal?: AbortSignal) =>
    fetch(publicOrigin + '/sidebar/file?' + new URLSearchParams(selection), { headers, signal })
  return { state, calls, audit, get, preview, download, gateway, publicOrigin, headers,
    replace: () => { grant = { ...grant, revision: randomUUID() } } }
}
describe('versioned original-owner directory projection', () => {
  it.each(['member', 'admin'] as const)('uses the same private owner for %s without leaking authority', async role => {
    const f = await fixture(role), response = await f.get()
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    const result = await response.json()
    expect(result.data).toMatchObject({ kind: 'files', sessionId: 'hansen-session', path: '/workspace/hansen', truncated: false })
    expect(result.data.entries[0].name).toBe('资料')
    expect(result.data.entries.map((row: any) => row.name).sort()).toEqual(['外部', '说明.txt', '资料'].sort())
    expect(result.data.entries.find((row: any) => row.name === '外部')).toMatchObject({ isSymlink: true, broken: true, isDir: false })
    const nested = await f.get('?path=' + encodeURIComponent('/workspace/hansen/资料'))
    expect(nested.status).toBe(200); expect((await nested.json()).data.path).toBe('/workspace/hansen/资料')
    expect(JSON.stringify(f.calls)).not.toMatch(/PRIVATE_TEST_COOKIE|tenant|userId/)
    expect(f.audit).toEqual(['allow', 'allow'])
  })
  it('keeps the original sidebar response shape and shares its directory owner', async () => {
    const f = await fixture(), response = await fetch(f.publicOrigin + '/sidebar/api/fs.tree', { method: 'POST',
      headers: { ...f.headers, 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'hansen-session' }) })
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, value: { path: '/workspace/hansen' } })
    expect(f.calls).toHaveLength(1)
  })
  it('retains explicit original truncation and never labels a partial directory complete', async () => {
    const f = await fixture(); f.state.truncated = true
    expect((await (await f.get()).json()).data.truncated).toBe(true)
  })
  it.each(['?path=', '?path=relative', '?path=/workspace/hansen/../alex', '?path=/x%00', '?path=/x&path=/y', '?userId=alex', '?beforeSeq=1'])('rejects malformed query %s before contacting the owner', async query => {
    const f = await fixture(); expect((await f.get(query)).status).toBe(400); expect(f.calls).toHaveLength(0)
  })
  it.each(['alex-session', 'missing-session'])('denies %s through the audited owner boundary without native details', async id => {
    const f = await fixture(), response = await f.get('', id)
    expect(response.status).toBe(403); expect(await response.text()).not.toContain('PRIVATE_NATIVE_ERROR'); expect(f.audit).toEqual(['deny'])
  })
  it('rejects another directory, expired login and malformed session identity', async () => {
    const f = await fixture()
    expect((await f.get('?path=/workspace/alex')).status).toBe(403)
    expect((await f.get('', 'hansen%2Fprivate')).status).toBe(400)
    f.state.loggedIn = false
    expect((await f.get()).status).toBe(401); expect(f.calls).toHaveLength(1)
  })
  it.each(['extra', 'duplicate', 'size', 'path'])('withholds malformed %s metadata', async malformed => {
    const f = await fixture(); f.state.malformed = malformed
    const response = await f.get('?path=/workspace/hansen')
    expect(response.status).toBe(502); expect(await response.text()).not.toContain('PRIVATE_NATIVE_ERROR')
  })
  it.each(['logout', 'replace', 'audit', 'omit'])('withholds data after %s at the authorization boundary', async fault => {
    const f = await fixture()
    if (fault === 'logout') f.state.beforeReturn = () => { f.state.loggedIn = false }
    if (fault === 'replace') f.state.beforeReturn = f.replace
    if (fault === 'audit') f.state.auditFailure = true
    if (fault === 'omit') f.state.omitCheck = true
    const response = await f.get(); expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await response.text()).not.toContain('说明.txt')
    expect(f.calls).toHaveLength(fault === 'omit' ? 0 : 1)
  })
  it.each(['disconnect', 'logout', 'close'])('cancels the held private operation on %s', async mode => {
    const f = await fixture(); f.state.hold = true
    const controller = new AbortController()
    const pending = f.get('', 'hansen-session', controller.signal).then(async response => response.status, () => 499)
    await vi.waitFor(() => expect(f.calls).toHaveLength(1))
    if (mode === 'disconnect') controller.abort()
    else if (mode === 'logout') f.state.loggedIn = false
    else f.gateway.close()
    expect(await pending).toBeGreaterThanOrEqual(400)
    await vi.waitFor(() => expect(f.state.closed).toBe(true))
  })
})

describe('original sidebar file preview through private bounded chunks', () => {
  it.each(['member', 'admin'] as const)('returns native text for %s and discards browser roots', async role => {
    const f = await fixture(role), response = await f.preview({ sessionId: 'hansen-session', path: '说明.txt', cwd: '/foreign', repoRoot: '/secret' })
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ ok: true, value: { kind: 'text', content: 'Hansen 的文件', truncated: false } })
    expect(f.calls).toEqual([{ sessionId: 'hansen-session', path: '说明.txt', offset: 0, version: undefined }])
  })
  it.each(['empty', 'unicode', 'binary', 'large'] as const)('retains original %s shape, exact chunk versions and preview bounds', async kind => {
    const f = await fixture()
    f.state.content = kind === 'empty' ? Buffer.alloc(0) : kind === 'unicode' ? Buffer.from('汉'.repeat(30000))
      : Buffer.alloc(600000, kind === 'binary' ? 0 : 65)
    const response = await f.preview(); expect(response.status).toBe(200)
    const result = await response.json(), prefix = f.state.content.subarray(0, 524288)
    expect(result).toEqual({ ok: true, value: kind === 'binary'
      ? { kind: 'binary', size: 600000, head: prefix.subarray(0, 4096).toString('base64'), truncated: true }
      : { kind: 'text', content: prefix.toString('utf8'), truncated: kind === 'large' } })
    expect(f.calls).toHaveLength(Math.max(1, Math.ceil(prefix.length / 65536)))
    for (const [i, call] of f.calls.entries()) expect(call).toMatchObject({ offset: i * 65536, version: i ? 'a'.repeat(64) : undefined })
  })
  it('withholds every chunk when the actual file version changes midway', async () => {
    const f = await fixture(); f.state.content = Buffer.alloc(100000, 65)
    f.state.beforeReturn = () => { f.state.version = 'b'.repeat(64) }
    const response = await f.preview(); expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('AAAA'); expect(f.calls).toHaveLength(2); expect(f.audit).toContain('deny')
  })
  it.each(['logout', 'replace', 'audit', 'omit'])('withholds preview on %s after or instead of resource authorization', async fault => {
    const f = await fixture()
    if (fault === 'logout') f.state.beforeReturn = () => { f.state.loggedIn = false }
    if (fault === 'replace') f.state.beforeReturn = f.replace
    if (fault === 'audit') f.state.beforeReturn = () => { f.state.auditFailure = true }
    if (fault === 'omit') f.state.omitCheck = true
    const response = await f.preview(); expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await response.text()).not.toContain('Hansen 的文件')
    expect(f.calls).toHaveLength(fault === 'omit' ? 0 : 1)
  })
  it.each(['extra', 'path', 'data', 'offset', 'next'])('rejects malformed private %s replies without disclosing content', async malformed => {
    const f = await fixture(); f.state.malformed = malformed
    const response = await f.preview(); expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await response.text()).not.toMatch(/Hansen 的文件|PRIVATE_NATIVE_ERROR/)
  })
  it('rejects known foreign sessions and roots; bad selectors never reach the native owner', async () => {
    const f = await fixture()
    for (const value of [{ sessionId: 'alex-session', path: '说明.txt' }, { sessionId: 'hansen-session', path: '/workspace/alex/private' }]) {
      expect((await f.preview(value)).status).toBe(403)
    }
    for (const value of [{ sessionId: 'hansen-session', path: '../alex' }, { sessionId: 'hansen-session', path: '' },
      { sessionId: 'hansen-session', path: '说明.txt', userId: 'alex' }]) expect((await f.preview(value)).status).toBe(400)
    expect(f.calls).toHaveLength(2)
    for (const role of ['admin', 'member'] as const) expect(() => authorizeNativeOperation(role, { method: 'POST', target: '/_paimind/native-control',
      contentType: 'application/json', body: Buffer.from(JSON.stringify({ operation: 'session.file', input: {} })) })).toThrow()
  })
  it.each(['disconnect', 'logout', 'close'])('joins a pending file read after %s', async mode => {
    const f = await fixture(); f.state.hold = true; const controller = new AbortController()
    const pending = f.preview(undefined, controller.signal).then(response => response.status, () => 499)
    await vi.waitFor(() => expect(f.calls).toHaveLength(1))
    if (mode === 'disconnect') controller.abort()
    else if (mode === 'logout') f.state.loggedIn = false
    else f.gateway.close()
    expect(await pending).toBeGreaterThanOrEqual(400); await vi.waitFor(() => expect(f.state.closed).toBe(true))
  })
})

describe('complete original file resource with bounded and revocable streaming', () => {
  it.each(['member', 'admin'] as const)('keeps exact binary bytes, native headers and download names for %s', async role => {
    const f = await fixture(role); f.state.content = randomBytes(200000); f.state.filePath = '/workspace/hansen/Hansen 报告.pdf'
    const response = await f.download(); expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('200000'); expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''" + encodeURIComponent('Hansen 报告.pdf'))
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(response.headers.get('content-security-policy')).not.toContain('allow-scripts')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(f.state.content); expect(f.calls).toHaveLength(4)
    expect(JSON.stringify(f.calls)).not.toContain('PRIVATE_TEST_COOKIE')
  })
  it('keeps original inline media and inert HTML without promoting user content to an app document', async () => {
    const f = await fixture(); f.state.filePath = '/workspace/hansen/example.html'; f.state.content = Buffer.from('<script>parent.location="https://invalid.test"</script>')
    const response = await f.download({ sessionId: 'hansen-session', path: 'example.html', cwd: '/foreign' } as any)
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('text/html')
    expect(response.headers.get('content-disposition')).toBeNull(); expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(await response.text()).toBe(f.state.content.toString()); expect(f.calls[0]).toMatchObject({ path: 'example.html' })
  })
  it.each([0, 65536, 65537, 20971520])('returns exactly %i bytes including the original maximum, never a preview', async size => {
    const f = await fixture(); f.state.content = Buffer.alloc(size, 65)
    const response = await f.download(); expect(response.status).toBe(200)
    const body = Buffer.from(await response.arrayBuffer()); expect(body.equals(f.state.content)).toBe(true)
    expect(body.length).toBe(size); expect(f.calls).toHaveLength(Math.max(1, Math.ceil(size / 65536)))
  }, 20000)
  it('rejects oversize input before resource headers or bytes and never truncates it', async () => {
    const f = await fixture(); f.state.content = Buffer.alloc(20971521, 65)
    const response = await f.download(); expect(response.status).toBe(413)
    expect(response.headers.get('content-disposition')).toBeNull(); expect(await response.text()).not.toContain('AAAA')
    expect(f.calls).toHaveLength(1)
  })
  it.each(['foreign-session', 'foreign-path', 'audit', 'omit', 'malformed'])('withholds the first byte on %s', async fault => {
    const f = await fixture(), selected = { sessionId: 'hansen-session', path: f.state.filePath, download: '1' }
    if (fault === 'foreign-session') selected.sessionId = 'alex-session'
    if (fault === 'foreign-path') selected.path = '/workspace/alex/private'
    if (fault === 'audit') f.state.beforeReturn = () => { f.state.auditFailure = true }
    if (fault === 'omit') f.state.omitCheck = true
    if (fault === 'malformed') f.state.malformed = 'data'
    const response = await f.download(selected); expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.headers.get('content-disposition')).toBeNull(); expect(await response.text()).not.toContain('Hansen 的文件')
  })
  it.each(['logout', 'replace', 'change', 'audit', 'disconnect', 'close'])('does not report a truncated successful download after midstream %s', async fault => {
    const f = await fixture(); f.state.content = randomBytes(200000); f.state.holdOffset = 65536
    const abort = new AbortController(), response = await f.download(undefined, abort.signal)
    expect(response.status).toBe(200); const pending = response.arrayBuffer(); const failed = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(f.calls).toHaveLength(2))
    if (fault === 'logout') f.state.loggedIn = false
    else if (fault === 'replace') f.replace()
    else if (fault === 'change') { f.state.version = 'b'.repeat(64); f.state.release() }
    else if (fault === 'audit') { f.state.beforeReturn = () => { f.state.auditFailure = true }; f.state.release() }
    else if (fault === 'disconnect') abort.abort()
    else f.gateway.close()
    await failed
    if (!['change', 'audit'].includes(fault)) await vi.waitFor(() => expect(f.state.closed).toBe(true))
    expect(f.calls).toHaveLength(2)
  })
  it('rejects ambiguous resource queries and prefix aliases for both roles before contacting the owner', async () => {
    for (const role of ['member', 'admin'] as const) {
      const f = await fixture(role)
      for (const suffix of ['?sessionId=hansen-session&path=x&path=y', '?sessionId=hansen-session&path=x&download=0', '?sessionId=hansen-session&path=x&userId=alex',
        '?sessionId=hansen-session&path=../alex', '/suffix?sessionId=hansen-session&path=x']) {
        const response = await fetch(f.publicOrigin + '/sidebar/file' + suffix, { headers: f.headers })
        expect(response.status).toBeGreaterThanOrEqual(400)
      }
      expect(f.calls).toHaveLength(0)
    }
  })
})
