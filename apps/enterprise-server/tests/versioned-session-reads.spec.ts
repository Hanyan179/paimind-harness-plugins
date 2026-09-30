// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeGateway } from '../src/native-gateway.js'
import { authorizeNativeOperation } from '../src/native-operation-policy.js'
import { EnterpriseError } from '../src/errors.js'
import type { RuntimeGrant } from '../src/runtime-bindings.js'

const disposers: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  disposers.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing test port')
  return `http://127.0.0.1:${address.port}`
}
async function fixture() {
  const calls: Array<{ call: any; headers: object; closed: boolean }> = []
  const state: { hold: boolean; mode: string; authenticated: boolean; omitVerify: boolean; beforeReply?: () => void } = {
    hold: false, mode: 'valid', authenticated: true, omitVerify: false,
  }
  let release: (() => void) | undefined
  const upstream = await listen(createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    const call = JSON.parse(raw), observation = { call, headers: request.headers, closed: false }
    calls.push(observation)
    response.once('close', () => { observation.closed = true })
    if (state.hold) await new Promise<void>(resolve => { release = resolve; response.once('close', resolve) })
    if (response.destroyed) return
    state.beforeReply?.()
    if (state.mode === 'redirect') { response.writeHead(302, { location: 'http://127.0.0.1:3080' }); response.end(); return }
    response.writeHead(200, { 'content-type': 'application/json' })
    if (state.mode === 'truncated') { response.write('{'); response.destroy(); return }
    if (state.mode === 'oversized') { response.end('x'.repeat(2 * 1024 * 1024 + 1)); return }
    const result = call.method === 'session.list'
      ? { ok: true, value: { items: [{ sessionId: 'owned', updatedAt: 1, running: false, blank: true }] } }
      : call.payload.sessionId === 'owned'
        ? { ok: true, value: { events: [], hasMore: false } }
        : { ok: false, error: { code: 'session-not-found', message: 'Sensitive native path must not escape', details: { sessionId: call.payload.sessionId } } }
    response.end(JSON.stringify({ type: 'server-response', rpcId: state.mode === 'correlation' ? 'wrong' : call.rpcId, result }))
  }))
  const publicOrigin = await listen(createServer())
  let grant: RuntimeGrant = { tenantId: 'explicit-authority-fixture', userId: randomUUID(), role: 'member',
    cellId: randomUUID(), revision: randomUUID(), origin: upstream, validForMs: 10000 }
  const gateway = new NativeGateway({ publicOrigin, revalidateMs: 20,
    resolve: async () => { if (!state.authenticated) throw new EnterpriseError(401, 'auth-required', 'Explicit revoked authority fixture'); return grant },
    authorize: async (_token, _id, selected, request, verify) => {
      authorizeNativeOperation(selected.role, request)
      if (!state.omitVerify) await verify()
    },
  })
  disposers.push(() => gateway.close())
  const read = (signal = new AbortController().signal, sessionId?: string) => gateway.readSessions('SECRET_TEST_COOKIE', randomUUID(),
    sessionId === undefined ? { kind: 'sessions' } : { kind: 'history', sessionId }, signal)
  return { state, calls, gateway, read, release: () => release?.(), replace: () => { grant = { ...grant, revision: randomUUID() } } }
}
describe('versioned session read failure boundaries (explicit authority/wire fixtures, not final acceptance)', () => {
  it('does not forward enterprise credentials or identity; missing and foreign IDs share an audited resource gate', async () => {
    const f = await fixture()
    expect(await f.read()).toMatchObject({ kind: 'sessions', items: [{ sessionId: 'owned' }] })
    expect(await f.read(undefined, 'owned')).toMatchObject({ kind: 'history', sessionId: 'owned', messages: [] })
    await expect(f.read(undefined, 'foreign')).rejects.toMatchObject({ status: 403, code: 'native-session-denied' })
    expect(f.calls.map(row => row.call.method)).toEqual(['session.list', 'session.history', 'session.history', 'session.history'])
    expect(JSON.stringify(f.calls)).not.toContain('SECRET_TEST_COOKIE')
    for (const { headers } of f.calls) expect(headers).not.toHaveProperty('cookie')
  })
  it('rejects cancellation before admission without invoking the native owner', async () => {
    const f = await fixture(), controller = new AbortController(); controller.abort()
    await expect(f.read(controller.signal)).rejects.toMatchObject({ code: 'native-unavailable' })
    expect(f.calls).toHaveLength(0)
  })
  it.each(['list', 'ownership'] as const)('aborts the native %s request when its versioned caller disconnects', async phase => {
    const f = await fixture(), controller = new AbortController(); f.state.hold = true
    const result = f.read(controller.signal, phase === 'ownership' ? 'owned' : undefined)
    const rejected = expect(result).rejects.toMatchObject({ code: 'native-unavailable' })
    await vi.waitFor(() => expect(f.calls).toHaveLength(1))
    controller.abort(); await rejected
    await vi.waitFor(() => expect(f.calls[0]!.closed).toBe(true))
    f.state.hold = false
    expect(await f.read()).toMatchObject({ kind: 'sessions' })
  })
  it.each(['logout', 'binding', 'close'] as const)('releases no pending content after %s', async fault => {
    const f = await fixture(); f.state.hold = true
    const rejected = expect(f.read()).rejects.toMatchObject({ code: 'native-unavailable' })
    await vi.waitFor(() => expect(f.calls).toHaveLength(1))
    if (fault === 'logout') f.state.authenticated = false
    else if (fault === 'binding') f.replace()
    else f.gateway.close()
    await rejected
    await vi.waitFor(() => expect(f.calls[0]!.closed).toBe(true))
  })
  it('rechecks the binding after a valid native response, without waiting for a polling tick', async () => {
    const f = await fixture(); f.state.beforeReply = f.replace
    await expect(f.read()).rejects.toMatchObject({ code: 'native-unavailable' })
  })
  it.each(['correlation', 'oversized', 'redirect', 'truncated'] as const)('fails closed on %s without leaking native output or following redirects', async mode => {
    const f = await fixture(); f.state.mode = mode
    await expect(f.read()).rejects.toMatchObject({ status: 502, code: 'native-unavailable' })
    expect(f.calls).toHaveLength(1)
  })
  it('requires the original audited resource callback before contacting a session owner', async () => {
    const f = await fixture(); f.state.omitVerify = true
    await expect(f.read(undefined, 'owned')).rejects.toMatchObject({ code: 'native-unavailable' })
    expect(f.calls).toHaveLength(0)
  })
})
