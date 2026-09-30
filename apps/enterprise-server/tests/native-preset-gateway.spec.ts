// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { NativeGateway } from '../src/native-gateway.js'
import { authorizeNativeOperation } from '../src/native-operation-policy.js'
import { EnterpriseError } from '../src/errors.js'
import type { RuntimeGrant } from '../src/runtime-bindings.js'
import { CellTransport } from '../src/cell-transport.js'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { createNativeControlBroker, createNativeControlPeer } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'

const retained = 'paimind-enterprise-11111111111141118111111111111111'
const withdrawn = 'paimind-enterprise-22222222222242228222222222222222'
const ids = ['standard', 'hansen-personal', retained, withdrawn]
const disposers: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const close of disposers.splice(0).reverse()) await close() })
async function listen(server: Server) {
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  disposers.push(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) })
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('No fixture port')
  return `http://127.0.0.1:${address.port}`
}

async function fixture(configured = true, privateSource = false) {
  const eligible = new Set(ids.filter(id => id !== withdrawn)), calls: string[] = [], checks: string[][] = []
  let beforeResponse = () => {}, policyFailure = false, malformedPolicy = false
  let sourcePreset: string | null = retained, sourceMissing = false, sourceCompleted = true
  let beforePolicy = () => {}
  const sourceReads: unknown[] = [], deniedResources: string[] = [], requests: any[] = []
  let creationKind: 'new' | 'existing' = 'new', defaultPreset = withdrawn
  let failAudit = false
  let grant: RuntimeGrant
  const upstream = await listen(createServer(async (request, response) => {
    let body = ''; for await (const part of request) body += part
    const call = JSON.parse(body)
    requests.push(call)
    calls.push(call.method)
    beforeResponse()
    const value = call.method === 'agentPreset.list' ? { presets: ids.map(id => ({ id, trust: 'user', isDefault: id === 'standard', name: id })), authorable: true, hasDocument: false }
      : call.method === 'agentPreset.read' ? { agentPreset: call.payload.agentPreset, trust: 'user', content: 'PRIVATE_PRESET_CONTENT' }
        : call.method === 'session.fork' ? { sessionId: 'forked-session' }
          : call.method === 'session.create' ? { sessionId: call.payload.sessionId ?? 'created-session', agentPreset: call.payload.agentPreset ?? (creationKind === 'existing' ? sourcePreset : defaultPreset) }
            : ['session.prompt', 'subagent.prompt', 'session.updateQueue', 'session.cancel'].includes(call.method) ? { accepted: true }
            : { agentPreset: call.payload.agentPreset }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ type: 'server-response', rpcId: call.rpcId, result: { ok: true, value } }))
  }))
  let gateway: NativeGateway
  const origin = await listen(createServer(async (request, response) => {
    response.setHeader('cache-control', 'no-store')
    try { await gateway.http(request, response, randomUUID()) }
    catch (error) { response.statusCode = error instanceof EnterpriseError ? error.status : 500; response.end(JSON.stringify({ denied: true })) }
  }))
  let selectedOrigin = upstream, transport: CellTransport | undefined
  if (privateSource) {
    const broker = await createNativeControlBroker(); disposers.push(() => broker.close())
    const peer = createNativeControlPeer(createConnection(broker.path), { handle: async (operation: string, input: { sessionId: string }) => {
      sourceReads.push({ operation, input })
      if (sourceMissing) throw Error('Original source unavailable')
      if (operation === 'session.creation') return { sessionId: input.sessionId ?? null, kind: creationKind, agentPreset: creationKind === 'existing' ? sourcePreset : defaultPreset }
      return { sessionId: input.sessionId, agentPreset: sourcePreset, hasForkBoundary: sourceCompleted }
    } }); disposers.push(() => peer.close())
    const deadline = Date.now() + 2000
    while (!broker.ready && Date.now() < deadline) await new Promise(done => setTimeout(done, 5))
    expect(broker.ready).toBe(true)
    const key = randomBytes(32).toString('hex')
    const ingress = createNativeIngress({ token: key, nativePort: Number(new URL(upstream).port),
      control: (operation: string, input: object, signal: AbortSignal) => broker.request(operation, input, signal) })
    selectedOrigin = await listen(ingress.server); disposers.push(() => ingress.close())
    transport = new CellTransport(selectedOrigin, key, Number(new URL(upstream).port)); disposers.push(() => transport!.destroy())
  }
  grant = { tenantId: 'preset-carrier-test', userId: randomUUID(), role: 'member', cellId: randomUUID(), revision: randomUUID(), origin: selectedOrigin,
    validForMs: 10000, ...(transport ? { transport: 'private-cell' as const } : {}) }
  gateway = new NativeGateway({ publicOrigin: origin, resolve: async () => grant,
    sealInteractiveOrigin: async () => 'explicit-test-source-only',
    ...(transport ? { transports: new Map([[selectedOrigin, transport]]) } : {}),
    authorize: async (_token, _id, selected, request, verify) => {
      authorizeNativeOperation(selected.role, request)
      try { await verify() } catch (error) {
        deniedResources.push(request.target)
        if (failAudit) throw new EnterpriseError(503, 'audit-unavailable', 'Explicit audit failure fixture')
        throw error
      }
    },
    ...(configured ? { agentPresetEligibility: async (_token: string | undefined, _requestId: string, _grant: RuntimeGrant, selected: readonly string[]) => {
      checks.push([...selected])
      beforePolicy()
      if (policyFailure) throw Error('Policy unavailable')
      return malformedPolicy ? [...selected, 'injected-foreign-preset'] : selected.filter(id => eligible.has(id))
    } } : {}),
  })
  disposers.push(() => gateway.close())
  const call = async (kind: 'list' | 'read' | 'select' | 'create' | 'fork' | 'resume' | 'prompt' | 'childPrompt' | 'editQueue' | 'removeQueue' | 'steerQueue' | 'cancel'
    | 'rename' | 'selectModel' | 'goalCreate' | 'goalEdit' | 'goalResume' | 'goalComplete' | 'goalClear' | 'goalPause' | 'attachment' | 'defaultCreate' | 'newId', presetId = withdrawn) => {
    const method = ['defaultCreate', 'newId'].includes(kind) ? 'session.create' : kind.startsWith('goal') ? 'goal.' + kind.slice(4).toLowerCase()
      : kind === 'childPrompt' ? 'subagent.prompt' : kind.endsWith('Queue') ? 'session.updateQueue'
      : ['create', 'resume', 'fork', 'prompt', 'cancel', 'rename', 'selectModel', 'attachment'].includes(kind) ? 'session.' + (kind === 'resume' ? 'create' : kind) : 'agentPreset.' + kind
    const content = [{ type: 'text', text: 'Explicit native carrier fixture' }]
    const payload = kind === 'defaultCreate' ? {} : kind === 'newId' ? { sessionId: 'new-fixture', workspaceId: 'workspace-fixture' }
      : kind === 'rename' ? { sessionId: 'session-fixture', title: 'Preserve original title' }
      : kind === 'selectModel' ? { sessionId: 'session-fixture', provider: 'local-only', model: 'synthetic' }
      : kind === 'attachment' ? { sessionId: 'session-fixture', attachmentId: 'original-attachment' }
      : kind.startsWith('goal') ? { sessionId: 'session-fixture', ...(kind === 'goalCreate' ? {} : { ref: { id: 'original-goal', revision: 1 } }),
        ...(['goalCreate', 'goalEdit'].includes(kind) ? { objective: 'Check quotation' } : {}) }
      : kind === 'prompt' ? { sessionId: 'session-fixture', mode: 'queue', content }
      : kind === 'childPrompt' ? { parentSessionId: 'parent-fixture', childSessionId: 'session-fixture', mode: 'continuable', content }
      : kind.endsWith('Queue') ? { sessionId: 'session-fixture', itemId: 'queued-fixture', action: { kind: kind.slice(0, -5), ...(kind === 'editQueue' ? { content } : {}) } }
      : kind === 'list' ? {} : kind === 'fork' || kind === 'resume' || kind === 'cancel' ? { sessionId: 'session-fixture' }
      : { agentPreset: presetId, ...(kind === 'select' ? { sessionId: 'session-fixture' } : {}) }
    const response = await fetch(origin + '/api/' + method, { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie: 'paimind_haas_session=fixture-only-token' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'fixture-call', method, payload }) })
    return { status: response.status, text: await response.text() }
  }
  return { call, calls, checks, eligible, sourceReads, deniedResources, requests, failAudit: () => { failAudit = true },
    setCreationKind: (kind: 'new' | 'existing') => { creationKind = kind }, setDefault: (preset: string) => { defaultPreset = preset },
    setSource: (preset: string | null, completed = true) => { sourcePreset = preset; sourceCompleted = completed },
    beforePolicy: (fn: () => void) => { beforePolicy = fn },
    removeSource: () => { sourceMissing = true }, beforeResponse: (fn: () => void) => { beforeResponse = fn },
    failPolicy: () => { policyFailure = true }, corruptPolicy: () => { malformedPolicy = true },
    replaceBinding: () => { grant = { ...grant, revision: randomUUID() } } }
}

describe('native preset eligibility carrier (HTTP fixture, not Browser E2E)', () => {
  it.each(['defaultCreate', 'newId'] as const)('rejects an implicit withdrawn default in managed %s without creating an orphan', async kind => {
    const f = await fixture(true, true)
    expect((await f.call(kind)).status).toBe(403); expect(f.calls).toEqual([])
    expect(f.deniedResources).toEqual(['/api/session.create'])
  })
  it.each(['defaultCreate', 'newId'] as const)('pins the original allowed default in %s despite a concurrent native default change', async kind => {
    const f = await fixture(true, true); f.setDefault(retained)
    f.beforePolicy(() => f.setDefault(withdrawn))
    const result = await f.call(kind)
    expect(result.status).toBe(200)
    expect(JSON.parse(result.text).result.value.agentPreset).toBe(retained)
    expect(f.requests[0]).toMatchObject({ rpcId: 'fixture-call', payload: { agentPreset: retained } })
    if (kind === 'newId') expect(f.requests[0].payload).toEqual({ sessionId: 'new-fixture', workspaceId: 'workspace-fixture', agentPreset: retained })
  })
  it('retains an existing managed withdrawn history restore without granting default creation or changing the native body', async () => {
    const f = await fixture(true, true); f.setCreationKind('existing'); f.setSource(withdrawn)
    const result = await f.call('resume')
    expect(result.status).toBe(200)
    expect(JSON.parse(result.text).result.value).toEqual({ sessionId: 'session-fixture', agentPreset: withdrawn })
    expect(f.requests[0].payload).toEqual({ sessionId: 'session-fixture' })
    expect(f.checks).toEqual([[]])
  })
  it('does not create on a failed native creation inspection, changed binding, or audit failure', async () => {
    const missing = await fixture(true, true); missing.removeSource()
    expect((await missing.call('newId')).status).toBe(503); expect(missing.calls).toEqual([])
    const changed = await fixture(true, true); changed.setDefault(retained); changed.beforePolicy(changed.replaceBinding)
    expect((await changed.call('newId')).status).toBe(502); expect(changed.calls).toEqual([])
    const audit = await fixture(true, true); audit.failAudit()
    expect((await audit.call('newId')).status).toBe(503); expect(audit.calls).toEqual([])
  })
  it.each(['rename', 'selectModel', 'goalCreate', 'goalEdit', 'goalResume', 'goalComplete', 'goalClear'] as const)(
    'gates managed %s before mutation and preserves allowed behavior', async kind => {
      const f = await fixture(true, true); f.setSource(withdrawn)
      expect((await f.call(kind)).status).toBe(403); expect(f.calls).toEqual([]); expect(f.deniedResources).toHaveLength(1)
      f.setSource(retained)
      expect((await f.call(kind)).status).toBe(200); expect(f.calls).toHaveLength(1)
      expect(f.sourceReads).toHaveLength(3)
    })
  it.each(['goalPause', 'attachment'] as const)('keeps original %s available without borrowing an execution grant', async kind => {
    const f = await fixture(true, true); f.setSource(withdrawn)
    expect((await f.call(kind)).status).toBe(200)
    expect(f.sourceReads).toEqual([]); expect(f.checks).toEqual([]); expect(f.calls).toHaveLength(1)
  })
  it.each(['read', 'select', 'create', 'fork'] as const)('keeps denied %s inside the original audited resource boundary', async kind => {
    const f = await fixture(true, true); f.setSource(withdrawn)
    expect((await f.call(kind)).status).toBe(403)
    expect(f.calls).toEqual([])
    expect(f.deniedResources).toEqual(['/api/' + (['create', 'fork'].includes(kind) ? 'session.' : 'agentPreset.') + kind])
    f.failAudit()
    expect((await f.call(kind)).status).toBe(503); expect(f.calls).toEqual([])
  })
  it('audits withdrawal during the native response and withholds content if the audit fails', async () => {
    const f = await fixture(); f.beforeResponse(() => f.eligible.delete(retained))
    const first = await f.call('read', retained)
    expect(first.status).toBe(403); expect(first.text).not.toContain('PRIVATE_PRESET_CONTENT')
    expect(f.deniedResources).toEqual(['/api/agentPreset.read'])
    f.eligible.add(retained); f.failAudit()
    const second = await f.call('read', retained)
    expect(second.status).toBe(503); expect(second.text).not.toContain('PRIVATE_PRESET_CONTENT')
    expect(f.calls).toEqual(['agentPreset.read', 'agentPreset.read'])
  })
  it.each(['prompt', 'childPrompt', 'editQueue', 'steerQueue'] as const)('rejects withdrawn managed %s before native inbox/history mutation', async kind => {
    const f = await fixture(true, true); f.setSource(withdrawn)
    expect((await f.call(kind)).status).toBe(403)
    expect(f.calls).toEqual([]); expect(f.checks).toEqual([[withdrawn]])
  })
  it.each(['prompt', 'childPrompt', 'editQueue', 'steerQueue'] as const)('preserves allowed managed %s including a first-turn blank session', async kind => {
    const f = await fixture(true, true); f.setSource(retained, false)
    const result = await f.call(kind)
    expect(result.status).toBe(200); expect(JSON.parse(result.text).rpcId).toBe('fixture-call')
    expect(f.sourceReads).toEqual(Array.from({ length: 2 }, () => ({ operation: 'session.preset', input: { sessionId: 'session-fixture' } })))
    expect(f.checks).toEqual([[retained]]); expect(f.calls).toHaveLength(1)
  })
  it.each(['removeQueue', 'cancel'] as const)('allows authenticated %s cleanup after withdrawal without treating it as new execution', async kind => {
    const f = await fixture(true, true); f.setSource(withdrawn)
    expect((await f.call(kind)).status).toBe(200)
    expect(f.sourceReads).toEqual([]); expect(f.checks).toEqual([]); expect(f.calls).toHaveLength(1)
  })
  it('does not dispatch managed writes without current governance', async () => {
    const f = await fixture(false, true)
    expect((await f.call('prompt')).status).toBe(503); expect(f.calls).toEqual([])
  })
  it('rejects missing, foreign or unresolved native sources before a managed write', async () => {
    const f = await fixture(true, true); f.setSource(null)
    expect((await f.call('prompt')).status).toBe(409); expect(f.calls).toEqual([])
    f.removeSource()
    expect((await f.call('prompt')).status).toBe(403); expect(f.calls).toEqual([])
  })
  it('refuses a changed blank-session preset during current policy IO', async () => {
    const f = await fixture(true, true); f.setSource(retained, false)
    f.beforePolicy(() => f.setSource(withdrawn, false))
    expect((await f.call('prompt')).status).toBe(409); expect(f.calls).toEqual([])
  })
  it('does not dispatch a managed write after its binding changes during policy IO', async () => {
    const f = await fixture(true, true); f.beforePolicy(f.replaceBinding)
    expect((await f.call('prompt')).status).toBe(502); expect(f.calls).toEqual([])
  })
  it.each(['failPolicy', 'corruptPolicy'] as const)('fails closed on managed prompt %s', async mode => {
    const f = await fixture(true, true); f[mode]()
    expect((await f.call('prompt')).status).toBe(502); expect(f.calls).toEqual([])
  })
  it('denies explicit withdrawn-preset session creation before the native owner can create an object', async () => {
    const f = await fixture(), result = await f.call('create')
    expect(result.status).toBe(403); expect(f.calls).toEqual([])
  })
  it('preserves original allowed-preset creation and its native session identity', async () => {
    const f = await fixture(), result = await f.call('create', retained)
    expect(result.status).toBe(200)
    expect(JSON.parse(result.text).result.value).toEqual({ sessionId: 'created-session', agentPreset: retained })
    expect(f.checks).toEqual([[retained], [retained]])
  })
  it('does not equate an existing history-only resume with permission to execute its withdrawn preset', async () => {
    const f = await fixture(), result = await f.call('resume')
    expect(result.status).toBe(200)
    expect(JSON.parse(result.text).result.value).toEqual({ sessionId: 'session-fixture', agentPreset: withdrawn })
    expect(f.calls).toEqual(['session.create'])
    expect(f.checks).not.toContainEqual([withdrawn])
  })
  it('reads the fork source from the admitted private native owner, not caller claims', async () => {
    const f = await fixture(true, true)
    expect((await f.call('fork')).status).toBe(200)
    expect(f.sourceReads).toEqual([{ operation: 'session.preset', input: { sessionId: 'session-fixture' } }])
    expect(f.checks).toEqual([[retained], [retained]])
    expect(f.calls).toEqual(['session.fork'])
  })
  it('denies forking a withdrawn source before native mutation', async () => {
    const f = await fixture(true, true); f.setSource(withdrawn)
    expect((await f.call('fork')).status).toBe(403); expect(f.calls).toEqual([])
  })
  it('fails closed if exact private source inspection is unavailable', async () => {
    const f = await fixture()
    expect((await f.call('fork')).status).toBe(503); expect(f.calls).toEqual([])
  })
  it('does not forward a fork whose source is missing or cannot be inspected', async () => {
    const f = await fixture(true, true); f.removeSource()
    expect((await f.call('fork')).status).toBe(403); expect(f.calls).toEqual([])
  })
  it('refuses an unfinished source rather than racing a preset switch before its first completed turn', async () => {
    const f = await fixture(true, true); f.setSource(retained, false)
    expect((await f.call('fork')).status).toBe(409); expect(f.calls).toEqual([])
  })
  it('filters only ineligible publication rows while preserving native identity and metadata', async () => {
    const f = await fixture(), result = await f.call('list')
    expect(result.status).toBe(200)
    expect(JSON.parse(result.text)).toMatchObject({ rpcId: 'fixture-call', result: { ok: true, value: { authorable: true, hasDocument: false } } })
    expect(JSON.parse(result.text).result.value.presets.map((row: { id: string }) => row.id)).toEqual(ids.filter(id => id !== withdrawn))
    expect(f.calls).toEqual(['agentPreset.list'])
  })
  it.each(['read', 'select'] as const)('rejects a known withdrawn id before native %s, not just in the client', async kind => {
    const f = await fixture(), result = await f.call(kind)
    expect(result.status).toBe(403)
    expect(f.calls).toEqual([])
    expect(result.text).not.toContain('PRIVATE_PRESET_CONTENT')
  })
  it.each(['standard', 'hansen-personal', retained])('keeps the original permitted read for %s', async id => {
    const f = await fixture(), result = await f.call('read', id)
    expect(result.status).toBe(200)
    expect(JSON.parse(result.text).result.value.agentPreset).toBe(id)
    expect(f.checks).toEqual([[id], [id]])
  })
  it('rechecks current permission after native IO and does not return withdrawn content', async () => {
    const f = await fixture(); f.beforeResponse(() => f.eligible.delete(retained))
    const result = await f.call('read', retained)
    expect(result.status).toBe(403); expect(result.text).not.toContain('PRIVATE_PRESET_CONTENT')
    expect(f.calls).toEqual(['agentPreset.read'])
  })
  it('checks the current binding again after native IO', async () => {
    const f = await fixture(); f.beforeResponse(f.replaceBinding)
    expect((await f.call('read', retained)).status).toBe(502)
  })
  it('fails closed when the governance callback is absent', async () => {
    const f = await fixture(false)
    expect((await f.call('list')).status).toBe(503)
    expect(f.calls).toEqual([])
  })
  it.each(['failPolicy', 'corruptPolicy'] as const)('does not treat %s as an empty or successful catalog', async mode => {
    const f = await fixture(); f[mode]()
    const result = await f.call('list')
    expect(result.status).toBe(502)
    expect(result.text).not.toContain('hansen-personal')
  })
})
