// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createAgentPublicationSnapshot } from '@paimind/agent-builder/publication'
import { PAIMIND_AGENT_PROFILE_REMOTE_DESCRIPTORS } from '@paimind/agent-builder/remote'
import { NativeGateway } from '../src/native-gateway.js'
import { authorizeNativeOperation } from '../src/native-operation-policy.js'
import type { RuntimeGrant } from '../src/runtime-bindings.js'
import { createHarnessServiceReadback, decodeHarnessServiceReadback } from '@paimind/harness-compat/gateway-transport'

const servers: Server[] = [], gateways: NativeGateway[] = []
const publicationInput = (PAIMIND_AGENT_PROFILE_REMOTE_DESCRIPTORS.find(row => row.method === 'getPublicationSnapshot')!
  .parameters[0] as { codec: { schema: { safeParse(input: unknown): { success: boolean } } } }).codec.schema
afterEach(async () => {
  for (const gateway of gateways.splice(0)) gateway.close()
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) }
})
async function fixture(mode = 'valid') {
  const selection = { presetId: 'hansen-client', expectedVersion: 'v1-test' }
  const snapshot = createAgentPublicationSnapshot({ schema: 'paimind.agent-publication/v1', agentId: selection.presetId,
    presetId: selection.presetId, configVersion: selection.expectedVersion,
    profile: { name: 'Hansen', description: '', basePresetId: 'standard', role: 'Assistant', goal: 'Help', behavior: 'Explain', instructions: '', preferredSkillNames: [] },
    dependencies: [], nativeCompositionDigest: 'sha256:' + 'a'.repeat(64) })
  const userId = randomUUID(), tenantId = 'publication-carrier-test'
  const principal = { sessionId: randomUUID(), account: { userId, tenantId, username: 'hansen', displayName: 'Hansen', role: 'member' as const, status: 'active' as const } }
  let grant: RuntimeGrant
  const calls: { headers: unknown; body: unknown; url: string | undefined }[] = []
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk
    const message = JSON.parse(body)
    calls.push({ headers: request.headers, body: message, url: request.url })
    if (mode === 'swap') grant = { ...grant, revision: randomUUID() }
    response.setHeader('content-type', 'application/json')
    const validInput = publicationInput.safeParse(message.payload?.args?.input).success
    response.end(mode === 'oversized' ? 'x'.repeat(140000) : JSON.stringify({ type: 'server-response',
      rpcId: mode === 'wrong-request' ? randomUUID() : message.rpcId,
      result: validInput && mode !== 'rejected-source' ? { ok: true, value: mode === 'changed-version' ? { ...snapshot, content: { ...snapshot.content, configVersion: 'changed' } } : snapshot }
        : { ok: false, error: { code: 'internal', message: 'Source rejected by owner', details: {} } } }))
  })
  servers.push(server); await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing fixture port')
  grant = { cellId: randomUUID(), tenantId, userId, role: 'member', revision: randomUUID(), origin: `http://127.0.0.1:${address.port}`, validForMs: 10000 }
  // Reserve a distinct OS-selected public port. The upstream ephemeral port
  // can equal a hard-coded public port and fail the isolation check before the
  // malformed publication response is exercised.
  const publicListener = createServer((_request, response) => response.writeHead(404).end())
  servers.push(publicListener); await new Promise<void>(done => publicListener.listen(0, '127.0.0.1', done))
  const publicAddress = publicListener.address(); if (!publicAddress || typeof publicAddress === 'string') throw Error('Missing public fixture port')
  expect(publicAddress.port).not.toBe(address.port)
  const gateway = new NativeGateway({ publicOrigin: `http://127.0.0.1:${publicAddress.port}`, resolve: async () => grant,
    authorize: async (_token, _id, selected, request, verify) => { authorizeNativeOperation(selected.role, request); await verify() } })
  gateways.push(gateway)
  return { gateway, principal, selection, snapshot, calls }
}

describe('publication carrier with explicit native HTTP fixture, not Browser E2E', () => {
  it('reads the exact owner version without forwarding enterprise authority or accepting caller source URLs', async () => {
    const f = await fixture()
    expect(await f.gateway.readAgentPublication('private-fixture-token', randomUUID(), f.principal, f.selection)).toEqual(f.snapshot)
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]?.url).toBe('/api/paimindAgentProfiles/getPublicationSnapshot')
    expect(f.calls[0]?.body).toMatchObject({ payload: { args: { input: f.selection } } })
    expect(JSON.stringify(f.calls)).not.toContain('private-fixture-token')
    expect(JSON.stringify(f.calls)).not.toContain(f.principal.account.userId)
  })
  it.each(['wrong-request', 'changed-version', 'oversized', 'swap'])('rejects %s instead of persisting an unverified snapshot', async mode => {
    const f = await fixture(mode)
    await expect(f.gateway.readAgentPublication('token', randomUUID(), f.principal, f.selection)).rejects.toMatchObject({ status: 502 })
    expect(f.calls).toHaveLength(1)
  })
  it('projects only the native selection even when a structurally compatible caller includes governance fields', async () => {
    const f = await fixture(), selected = { ...f.selection, reason: 'Private enterprise review reason', sourceUserId: randomUUID() }
    expect(publicationInput.safeParse(selected).success).toBe(false)
    expect(await f.gateway.readAgentPublication('token', randomUUID(), f.principal, selected)).toEqual(f.snapshot)
    expect((f.calls[0]?.body as { payload: unknown }).payload).toEqual({ args: { input: f.selection } })
    expect(JSON.stringify(f.calls)).not.toContain(selected.reason)
    expect(JSON.stringify(f.calls)).not.toContain(selected.sourceUserId)
  })
  it('keeps a native owner rejection distinct from a malformed transport response', async () => {
    const f = await fixture('rejected-source')
    await expect(f.gateway.readAgentPublication('token', randomUUID(), f.principal, f.selection))
      .rejects.toMatchObject({ status: 409, code: 'publication-source-unavailable' })
  })
  it('rejects changed principal before any source request and refuses new reads after closure', async () => {
    const f = await fixture()
    await expect(f.gateway.readAgentPublication('token', randomUUID(), { ...f.principal, account: { ...f.principal.account, userId: randomUUID() } }, f.selection)).rejects.toMatchObject({ status: 403 })
    expect(f.calls).toEqual([])
    f.gateway.close()
    await expect(f.gateway.readAgentPublication('token', randomUUID(), f.principal, f.selection)).rejects.toThrow()
    expect(f.calls).toEqual([])
  })
  it('validates the native response schema and correlated request id', () => {
    const request = JSON.parse(createHarnessServiceReadback('paimindAgentProfiles/getPublicationSnapshot', { input: {} }, 'request-id'))
    expect(request).toMatchObject({ type: 'client-request', payload: { args: { input: {} } } })
    const response = { type: 'server-response', rpcId: 'request-id', result: { ok: true, value: {} } }
    expect(decodeHarnessServiceReadback(JSON.stringify(response), 'request-id')).toEqual({ ok: true, value: {} })
    expect(() => decodeHarnessServiceReadback(JSON.stringify({ ...response, type: 'client-response' }), 'request-id')).toThrow()
    expect(() => decodeHarnessServiceReadback(JSON.stringify(response), 'other-id')).toThrow()
  })
})
