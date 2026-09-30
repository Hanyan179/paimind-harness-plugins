// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto'
import { createConnection, createServer } from 'node:net'
import { request, createServer as createHttpServer, type Server } from 'node:http'
import { access } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeControlBroker, createNativeControlPeer, handleNativeControl, NATIVE_CONTROL_LIMIT, NATIVE_CONTROL_PATH } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { CellTransport, CellControlRejected } from '../src/cell-transport.js'
import { NativeGateway } from '../src/native-gateway.js'
import { authorizeNativeOperation } from '../src/native-operation-policy.js'
import { EnterpriseError } from '../src/errors.js'
import type { RuntimeGrant } from '../src/runtime-bindings.js'
import { createAgentPublicationSnapshot } from '@paimind/agent-builder/publication'
import { adoptedPresetId, type AgentPublicationAdoption } from '@paimind/agent-builder/adoption'

const disposers: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })
const selection = { presetId: 'hansen-client', expectedVersion: 'v1-test' }
const connectorReference = { entryId:'sales',configurationVersion:'a'.repeat(64),serverName:'sales',transport:'stdio' as const }
const connectorApproval = { reference:connectorReference,expectedApprovalRevision:1 }
const connectorUse = { reference:connectorReference,approvalRevision:1,execution:{nativeSessionId:'hansen-session',presetId:'standard',publication:null,skills:[],sources:['paimind-origin-v1.e30.'+'a'.repeat(43)]} }
const snapshot = createAgentPublicationSnapshot({ schema: 'paimind.agent-publication/v1', agentId: selection.presetId,
  presetId: selection.presetId, configVersion: selection.expectedVersion,
  profile: { name: 'Hansen', description: '', basePresetId: 'standard', role: 'Assistant', goal: 'Help', behavior: 'Explain', instructions: '', preferredSkillNames: [] },
  dependencies: [], nativeCompositionDigest: 'sha256:' + 'a'.repeat(64) })
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing fixture port')
  return `http://127.0.0.1:${address.port}`
}
async function fixture() {
  const broker = await createNativeControlBroker(); disposers.push(() => broker.close())
  const handle = vi.fn<(operation: string, input: unknown, signal: AbortSignal) => Promise<unknown>>(async () => snapshot)
  const client = createConnection(broker.path)
  const peer = createNativeControlPeer(client, { handle }); disposers.push(() => peer.close())
  await vi.waitFor(() => expect(broker.ready).toBe(true))
  const token = randomBytes(32).toString('hex')
  const ingress = createNativeIngress({ token, control: (operation: string, input: object, signal: AbortSignal) => broker.request(operation, input, signal) })
  const origin = await listen(ingress.server); disposers.push(() => ingress.close())
  const transport = new CellTransport(origin, token); disposers.push(() => transport.destroy())
  return { broker, peer, client, handle, token, ingress, origin, transport }
}

describe('private original event pages', () => {
  it('allows exact bounded file selections privately and rejects coercions, injected roots and invalid replies', async () => {
    const f = await fixture(), input = { sessionId: 'hansen', path: '说明.txt', offset: 0 }
    const value = { path: '/workspace/hansen/说明.txt', offset: 0, size: 1, version: 'a'.repeat(64), data: 'eA==', nextOffset: null }
    const file = vi.fn(async () => value)
    f.handle.mockImplementation((op, selected, signal) => handleNativeControl({ get: () => ({ file }) }, op, selected as object, signal))
    expect(await f.transport.requestControl('session.file', input)).toEqual(value)
    expect(file).toHaveBeenCalledExactlyOnceWith('hansen', '说明.txt', 0, undefined, expect.any(AbortSignal))
    for (const bad of [{ ...input, offset: 1 }, { ...input, offset: -1 }, { ...input, offset: 65536 }, { ...input, path: '../alex' },
      { ...input, cwd: '/other' }, { ...input, userId: 'alex' }, { ...input, version: ['a'.repeat(64)] }]) {
      // Malformed envelopes are rejected by ingress before the native peer;
      // valid selections with invalid owner replies use CellControlRejected.
      await expect(f.transport.requestControl('session.file', bad)).rejects.toThrow()
    }
    expect(file).toHaveBeenCalledOnce()
    for (const bad of [{ ...value, version: ['a'.repeat(64)] }, { ...value, data: 'eA' }, { ...value, nextOffset: 1 },
      { ...value, offset: 65536 }, { ...value, size: 0 }, { ...value, extra: 'PRIVATE' }]) {
      file.mockResolvedValueOnce(bad as never); await expect(f.transport.requestControl('session.file', input)).rejects.toBeInstanceOf(CellControlRejected)
    }
  })
  it('reads original approval correlation privately and rejects contradictory, injected or public replies', async () => {
    const f = await fixture(), input = { sessionId: 'owned', approvalId: randomUUID() }
    const state = { ...input, version: 'A'.repeat(43), toolName: 'diagnostic', askedSeq: 1, decidedSeq: null, outcome: null, answerable: true, rpcId: 'native-only', persisted: false }
    const approval = vi.fn(async () => state)
    f.handle.mockImplementation((op, value, signal) => handleNativeControl({ get: name => name === 'paimindNativeSessionReferences' ? { approval } : undefined }, op, value as object, signal))
    expect(await f.transport.requestControl('session.approval', input)).toEqual(state)
    expect(approval).toHaveBeenCalledWith(input.sessionId, input.approvalId, expect.any(AbortSignal))
    for (const bad of [{ ...input, approvalId: 'forged' }, { ...input, tenantId: 'other' }, { ...input, decision: 'approve' }, { ...input, sessionId: '' }]) {
      await expect(f.transport.requestControl('session.approval', bad)).rejects.toThrow()
    }
    expect(approval).toHaveBeenCalledOnce()
    for (const bad of [{ ...state, sessionId: 'foreign' }, { ...state, approvalId: randomUUID() }, { ...state, version: 'B'.repeat(43) },
      { ...state, reason: 'PRIVATE' }, { ...state, answerable: false }, { ...state, rpcId: null }, { ...state, outcome: 'allowed-once' },
      { ...state, decidedSeq: 2 }, { ...state, persisted: true }, { ...state, persisted: undefined },
      { ...state, answerable: false, rpcId: null, outcome: 'unknown', decidedSeq: 2 }]) {
      approval.mockResolvedValueOnce(bad as any); await expect(f.transport.requestControl('session.approval', input)).rejects.toThrow()
    }
    approval.mockResolvedValueOnce({ ...state, answerable: false, rpcId: null, decidedSeq: 2, outcome: 'rejected' } as any)
    expect(await f.transport.requestControl('session.approval', input)).toMatchObject({ answerable: false, outcome: 'rejected' })
    for (const role of ['admin', 'member'] as const) expect(() => authorizeNativeOperation(role, { method: 'POST', target: NATIVE_CONTROL_PATH,
      contentType: 'application/json', body: Buffer.from(JSON.stringify({ operation: 'session.approval', input })) })).toThrow()
  })
  it('validates exact selections and redacted replies over the real private carrier, never exposing public control', async () => {
    const f = await fixture(), input = { sessionId: 'owned', afterSeq: -1 }
    const page = { sessionId: 'owned', afterSeq: -1, headSeq: 0, hasMore: false, cursorMatched: true,
      events: [{ seq: 0, time: 1, digest: 'A'.repeat(43), kind: 'user.message', data: { text: 'Hansen', omittedBlocks: 0 } }] }
    const events = vi.fn(async () => page)
    f.handle.mockImplementation((op, value, signal) => handleNativeControl({ get: name => name === 'paimindNativeSessionReferences' ? { events } : undefined }, op, value as object, signal))
    expect(await f.transport.requestControl('session.events', input)).toEqual(page)
    expect(events).toHaveBeenCalledWith('owned', { afterSeq: -1 }, expect.any(AbortSignal))
    for (const bad of [{ ...input, userId: 'alex' }, { ...input, afterDigest: 'A'.repeat(43) }, { ...input, afterSeq: 0 }, { ...input, afterSeq: -2 }]) {
      await expect(f.transport.requestControl('session.events', bad)).rejects.toThrow()
    }
    expect(events).toHaveBeenCalledOnce()
    for (const bad of [{ ...page, sessionId: 'foreign' }, { ...page, raw: 'PRIVATE' },
      { ...page, events: [{ ...page.events[0], data: { text: 'text', source: 'PRIVATE' } }] },
      { ...page, events: [{ ...page.events[0], seq: 1 }] }, { ...page, hasMore: true },
      { ...page, cursorMatched: false }, { ...page, events: [{ ...page.events[0], digest: 'B'.repeat(43) }] }]) {
      events.mockResolvedValueOnce(bad as any); await expect(f.transport.requestControl('session.events', input)).rejects.toThrow()
    }
    for (const role of ['admin', 'member'] as const) expect(() => authorizeNativeOperation(role, { method: 'POST', target: NATIVE_CONTROL_PATH,
      contentType: 'application/json', body: Buffer.from(JSON.stringify({ operation: 'session.events', input })) })).toThrow()
  })
})

describe('connector reverse authority protocol, explicit authority doubles not DB or native execution',()=>{
  it('carries exact activation privately, pins approval revision and rejects public access or malformed success',async()=>{
    const f=await fixture(),input={entryId:'sales',configurationVersion:'a'.repeat(64),expectedRevision:'b'.repeat(64),enabled:true,expectedApprovalRevision:3},
      state={schema:'paimind.connector-observation/v1',revision:'c'.repeat(64),entries:[{...connectorReference,enabled:true,authority:'live',phase:'active',connection:'not-probed'}]},
      activate=vi.fn(async()=>({outcome:'activated'})),observeActivation=vi.fn(async()=>state)
    f.handle.mockImplementation((op,data,signal)=>handleNativeControl({get:name=>name==='paimindNativeConnectorActivation'?{activate}:name==='paimindNativeConnectorConfiguration'?{observeActivation}:undefined},op,data as object,signal))
    expect(await f.transport.requestControl('connector.activate',input)).toEqual({outcome:'activated',state})
    const {expectedApprovalRevision,...selection}=input;expect(activate).toHaveBeenCalledExactlyOnceWith(selection,expect.any(AbortSignal),3)
    for(const body of [{...input,expectedApprovalRevision:null},{...input,enabled:false},{...input,configuration:{}},{...input,userId:randomUUID()},
      {...input,expectedApprovalRevision:0},{...input,expectedApprovalRevision:2147483648},{...input,configurationVersion:'x'}])await expect(f.transport.requestControl('connector.activate',body)).rejects.toThrow()
    expect(activate).toHaveBeenCalledOnce()
    for(const role of ['admin','member'] as const)expect(()=>authorizeNativeOperation(role,{method:'POST',target:NATIVE_CONTROL_PATH,contentType:'application/json',body:Buffer.from(JSON.stringify({operation:'connector.activate',input}))})).toThrow()
    observeActivation.mockResolvedValueOnce({...state,entries:[{...state.entries[0]!,authority:'absent'}]})
    await expect(f.transport.requestControl('connector.activate',input)).rejects.toBeInstanceOf(CellControlRejected)
    activate.mockResolvedValueOnce({outcome:'conflict'});expect(await f.transport.requestControl('connector.activate',input)).toMatchObject({outcome:'conflict'})
    activate.mockResolvedValueOnce({outcome:'disabled'});observeActivation.mockResolvedValueOnce({...state,entries:[{...state.entries[0]!,enabled:false,authority:'absent',phase:null as any}]})
    expect(await f.transport.requestControl('connector.activate',{...input,enabled:false,expectedApprovalRevision:null})).toMatchObject({outcome:'disabled'})
  })
  it('reads connector lifecycle privately without turning gate presence into connection or execution permission',async()=>{
    const f=await fixture(),entry={...connectorReference,enabled:true,authority:'live',phase:'active',connection:'not-probed'},
      state={schema:'paimind.connector-observation/v1',revision:'b'.repeat(64),entries:[entry]},activationState=vi.fn(async()=>state)
    f.handle.mockImplementation((op,input,signal)=>handleNativeControl({get:name=>name==='paimindNativeConnectorConfiguration'?{observeActivation:activationState}:undefined},op,input as object,signal))
    expect(await f.transport.requestControl('connector.activation-state',{})).toEqual(state)
    for(const input of [{entryId:'sales'},{enabled:true},{userId:randomUUID()},{configuration:{}}])await expect(f.transport.requestControl('connector.activation-state',input)).rejects.toThrow()
    expect(activationState).toHaveBeenCalledOnce()
    for(const role of ['admin','member'] as const)expect(()=>authorizeNativeOperation(role,{method:'POST',target:NATIVE_CONTROL_PATH,contentType:'application/json',body:Buffer.from(JSON.stringify({operation:'connector.activation-state',input:{}}))})).toThrow()
    for(const bad of [{...state,permission:true},{...state,entries:[{...entry,headers:{secret:'PRIVATE'}}]},
      {...state,entries:[entry,entry]},{...state,entries:[{...entry,phase:6}]},{...state,entries:[{...entry,connection:'connected'}]},
      {...state,entries:[{...entry,configurationVersion:null}]},{...state,entries:[{...entry,enabled:false}]}]){
      activationState.mockResolvedValueOnce(bad as any);await expect(f.transport.requestControl('connector.activation-state',{})).rejects.toBeInstanceOf(CellControlRejected)
    }
    activationState.mockResolvedValueOnce({...state,entries:[{...entry,enabled:false,authority:'absent',phase:null,configurationVersion:null}]} as any)
    expect(await f.transport.requestControl('connector.activation-state',{})).toMatchObject({entries:[{enabled:false,configurationVersion:null}]})
  })
  it('restores only existing intent through an empty private command and rejects injected configuration or malformed recovery claims',async()=>{
    const f=await fixture(),restore=vi.fn(async()=>({restored:['sales'],pending:['support']}))
    f.handle.mockImplementation((op,input,signal)=>handleNativeControl({get:name=>name==='paimindNativeConnectorActivation'?{restore}:undefined},op,input as object,signal))
    expect(await f.transport.requestControl('connector.restore',{})).toEqual({restored:['sales'],pending:['support']})
    for(const body of [{enabled:true},{entryId:'new'},{approvalRevision:1},{reference:connectorReference}])await expect(f.transport.requestControl('connector.restore',body)).rejects.toThrow()
    expect(restore).toHaveBeenCalledOnce()
    for(const value of [{restored:['sales'],pending:['sales']},{restored:['../foreign'],pending:[]},{restored:[],pending:[],healthy:true}]){
      restore.mockResolvedValueOnce(value as any);await expect(f.transport.requestControl('connector.restore',{})).rejects.toThrow()
    }
    for(const role of ['admin','member'] as const)expect(()=>authorizeNativeOperation(role,{method:'POST',target:NATIVE_CONTROL_PATH,contentType:'application/json',body:Buffer.from(JSON.stringify({operation:'connector.restore',input:{}}))})).toThrow()
  })
  it('separates current approval reads from execution and forbids the normal/public command direction',async()=>{
    const f=await fixture(),read=vi.fn(async()=>1),authorize=vi.fn(async()=>{})
    await f.transport.openOriginAuthority(async()=>{},undefined,undefined,undefined,undefined,read,authorize)
    expect(await f.ingress.readConnectorApproval(connectorApproval)).toBe(1);expect(authorize).not.toHaveBeenCalled()
    await f.ingress.authorizeConnectorExecution(connectorUse)
    expect(read).toHaveBeenCalledOnce();expect(authorize).toHaveBeenCalledExactlyOnceWith(connectorUse,expect.any(AbortSignal))
    for(const operation of ['connector.approval','connector.authorize']){
      await expect(f.transport.requestControl(operation as any,connectorApproval)).rejects.toThrow()
      for(const role of ['member','admin'] as const)expect(()=>authorizeNativeOperation(role,{method:'POST',target:NATIVE_CONTROL_PATH,contentType:'application/json',body:Buffer.from(JSON.stringify({operation,input:connectorApproval}))})).toThrow()
    }
  })
  it('rejects malformed references and injected identities before contacting the authority',async()=>{
    const f=await fixture(),read=vi.fn(async()=>1),authorize=vi.fn(async()=>{})
    await f.transport.openOriginAuthority(async()=>{},undefined,undefined,undefined,undefined,read,authorize)
    for(const input of [null,{}, {...connectorApproval,userId:randomUUID()}, {...connectorApproval,expectedApprovalRevision:0},
      {...connectorApproval,expectedApprovalRevision:2147483648},{...connectorApproval,reference:{...connectorReference,headers:{}}},
      {...connectorApproval,reference:{...connectorReference,entryId:'../sales'}},{...connectorApproval,reference:{...connectorReference,configurationVersion:'x'}}])
      await expect(f.ingress.readConnectorApproval(input)).rejects.toThrow()
    for(const input of [{...connectorUse,approvalRevision:null},{...connectorUse,execution:{...connectorUse.execution,sources:[]}},
      {...connectorUse,execution:{...connectorUse.execution,tenantId:'invented'}},{...connectorUse,permission:true}])
      await expect(f.ingress.authorizeConnectorExecution(input)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled();expect(authorize).not.toHaveBeenCalled()
    expect(await f.ingress.readConnectorApproval(connectorApproval)).toBe(1)
  })
  it('rejects wrong revision and malformed authority answers, without a last-good fallback',async()=>{
    const f=await fixture(),read=vi.fn(async()=>1),authorize=vi.fn(async()=>{})
    await f.transport.openOriginAuthority(async()=>{},undefined,undefined,undefined,undefined,read,authorize)
    expect(await f.ingress.readConnectorApproval(connectorApproval)).toBe(1)
    for(const value of [2,0,-1,NaN,'1',null,{revision:1}]){
      read.mockResolvedValueOnce(value as any);await expect(f.ingress.readConnectorApproval(connectorApproval)).rejects.toThrow()
    }
    authorize.mockRejectedValueOnce(Error('DB unavailable'))
    await expect(f.ingress.authorizeConnectorExecution(connectorUse)).rejects.toThrow()
    expect(await f.ingress.readConnectorApproval(connectorApproval)).toBe(1)
  })
  it('propagates cancellation to the current authority and discards its late result',async()=>{
    const f=await fixture(),entered=Promise.withResolvers<AbortSignal>(),finish=Promise.withResolvers<number>()
    const read=vi.fn(async(_input:unknown,signal:AbortSignal)=>{entered.resolve(signal);return finish.promise})
    await f.transport.openOriginAuthority(async()=>{},undefined,undefined,undefined,undefined,read)
    const cancel=new AbortController(),pending=f.ingress.readConnectorApproval(connectorApproval,cancel.signal),rejected=expect(pending).rejects.toThrow()
    const upstream=await entered.promise;cancel.abort();await rejected
    await vi.waitFor(()=>expect(upstream.aborted).toBe(true));finish.resolve(1)
    read.mockResolvedValueOnce(1);expect(await f.ingress.readConnectorApproval(connectorApproval)).toBe(1)
  })
  it('missing authority callbacks and closed control channels never authorize',async()=>{
    const f=await fixture();await f.transport.openOriginAuthority(async()=>{})
    await expect(f.ingress.readConnectorApproval(connectorApproval)).rejects.toThrow()
    await expect(f.ingress.authorizeConnectorExecution(connectorUse)).rejects.toThrow()
    f.transport.destroy()
    await expect(f.ingress.readConnectorApproval(connectorApproval)).rejects.toThrow()
    await expect(f.ingress.authorizeConnectorExecution(connectorUse)).rejects.toThrow()
  })
})

function adoptionGateway(f: Awaited<ReturnType<typeof fixture>>) {
  const tenantId = 'control.adoption:tenant', userId = randomUUID(), publicationId = randomUUID()
  const principal = { sessionId: randomUUID(), account: { userId, tenantId, username: 'alex', displayName: 'Alex', role: 'member' as const, status: 'active' as const } }
  const input = { tenantId, sourceUserId: randomUUID(), publicationId, snapshot }
  const receipt: AgentPublicationAdoption = { ...input, schema: 'paimind.agent-adoption/v1', presetId: adoptedPresetId(publicationId),
    configVersion: 'native-version', nativeCompositionDigest: 'sha256:' + 'b'.repeat(64), adoptedAt: 100 }
  let grant: RuntimeGrant = { cellId: randomUUID(), tenantId, userId, role: 'member', revision: randomUUID(), origin: f.origin, validForMs: 10000, transport: 'private-cell' }
  const gateway = new NativeGateway({ publicOrigin: 'http://127.0.0.1:62345', resolve: async () => grant,
    transports: new Map([[f.origin, f.transport]]), revalidateMs: 20,
    authorize: async () => { throw Error('Private adoption is not a public native operation') } })
  disposers.push(() => gateway.close()); f.handle.mockResolvedValue(receipt)
  return { gateway, principal, input, receipt, swap: () => { grant = { ...grant, revision: randomUUID() } } }
}

describe('private launcher/native control with real HTTP and Unix sockets; not browser/member acceptance', () => {
  it('carries exact connector release references privately and rejects mismatched identity, revisions and secret-bearing results', async () => {
    const f = await fixture(), input = { entryId: 'sales', expectedRevision: 'a'.repeat(64) }
    const result = { outcome: 'current', revision: input.expectedRevision, reference: { entryId: 'sales', serverName: 'sales', transport: 'stdio', configurationVersion: 'b'.repeat(64) } }
    const release = vi.fn(async () => result)
    f.handle.mockImplementation((operation, body, signal) => handleNativeControl({ get: () => ({ release }) }, operation, body as object, signal))
    expect(await f.transport.requestControl('connector.release', input)).toEqual(result)
    for (const outcome of ['missing','unversioned','conflict']) {
      const next = { outcome, revision: outcome === 'conflict' ? 'c'.repeat(64) : input.expectedRevision, reference: null }
      release.mockResolvedValue(next as never); expect(await f.transport.requestControl('connector.release', input)).toEqual(next)
    }
    for (const invalid of [{ ...result, revision: 'c'.repeat(64) }, { ...result, reference: { ...result.reference, entryId: 'alex' } },
      { ...result, reference: { ...result.reference, paimindVersionKey: 'PRIVATE' } }, { ...result, outcome: 'approved' },
      { ...result, outcome: 'unversioned' }, { ...result, reference: { ...result.reference, configurationVersion: 'not-a-version' } }]) {
      release.mockResolvedValue(invalid as never); await expect(f.transport.requestControl('connector.release', input)).rejects.toBeInstanceOf(CellControlRejected)
    }
    for (const role of ['admin','member'] as const) expect(() => authorizeNativeOperation(role, { method:'POST',target:NATIVE_CONTROL_PATH,contentType:'application/json',
      body:Buffer.from(JSON.stringify({operation:'connector.release',input})) })).toThrow()
    const count = release.mock.calls.length
    await expect(f.transport.requestControl('connector.release', { ...input, enabled:true })).rejects.toThrow();expect(release).toHaveBeenCalledTimes(count)
  })
  it('carries connector configuration only privately, validates redacted results and never accepts activation', async () => {
    const f = await fixture(), state = { schema: 'paimind.connector-configuration/v1', revision: 'b'.repeat(64), activation: 'not-authorized',
      entries: [{ entryId: 'sales', serverName: 'sales', transport: 'streamable-http', enabled: false }] }
    const read = vi.fn(async () => state), configure = vi.fn(async () => ({ outcome: 'saved-disabled', state }))
    f.handle.mockImplementation((operation, input, signal) => handleNativeControl({ get: name => name === 'paimindNativeConnectorConfiguration' ? { read, configure } : undefined }, operation, input as object, signal))
    expect(await f.transport.requestControl('connector.configuration', {})).toEqual(state)
    const input = { kind: 'upsert', entryId: 'sales', expectedRevision: 'a'.repeat(64), configuration: { explicit: 'OWNER_FIXTURE_NOT_A_REAL_CONFIG' } }
    expect(await f.transport.requestControl('connector.configure', input)).toEqual({ outcome: 'saved-disabled', state })
    expect(configure).toHaveBeenCalledExactlyOnceWith(input, expect.any(AbortSignal))
    for (const patch of [{ kind: 'enable' }, { enabled: true }, { expectedRevision: 'bad' }, { origin: 'http://127.0.0.1:3080' }]) {
      await expect(f.transport.requestControl('connector.configure', { ...input, ...patch })).rejects.toThrow()
    }
    expect(configure).toHaveBeenCalledTimes(1)
    for (const role of ['admin','member'] as const) for (const operation of ['connector.configuration','connector.configure']) {
      expect(() => authorizeNativeOperation(role, { method: 'POST', target: NATIVE_CONTROL_PATH, contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ operation, input })) })).toThrow()
    }
    for (const invalid of [{ ...state, headers: { Authorization: 'PRIVATE' } }, { ...state, activation: 'approved' },
      { ...state, entries: [{ ...state.entries[0], enabled: true }] }]) {
      configure.mockResolvedValue({ outcome: 'saved-disabled', state: invalid } as never)
      await expect(f.transport.requestControl('connector.configure', input)).rejects.toBeInstanceOf(CellControlRejected)
    }
  })
  it('carries strict read-only connector metadata on the private channel, with no public role bypass', async () => {
    const f = await fixture(), value = { schema: 'paimind.native-connectors/v1', scope: 'loader-tree', connection: 'not-probed',
      entries: [{ entryId: 'mcp-sales', serverName: 'sales', transport: 'stdio', enabled: false, phase: null, configuration: 'recognized' }] }
    const read = vi.fn(async () => value), get = vi.fn(name => name === 'paimindNativeConnectorReferences' ? { read } : undefined)
    f.handle.mockImplementation((operation, input, signal) => handleNativeControl({ get }, operation, input as object, signal))
    expect(await f.transport.requestControl('connector.inventory', {})).toEqual(value)
    expect(read).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal))
    for (const body of [{ userId: randomUUID() }, { entryId: 'other' }, { config: {} }]) await expect(f.transport.requestControl('connector.inventory', body)).rejects.toThrow()
    expect(read).toHaveBeenCalledTimes(1)
    for (const role of ['admin', 'member'] as const) expect(() => authorizeNativeOperation(role, { method: 'POST', target: NATIVE_CONTROL_PATH,
      contentType: 'application/json', body: Buffer.from(JSON.stringify({ operation: 'connector.inventory', input: {} })) })).toThrow()
    for (const invalid of [{ ...value, credentials: 'PRIVATE' }, { ...value, connection: 'healthy' }, { ...value, entries: [...value.entries,...value.entries] },
      { ...value, entries: [{ ...value.entries[0], headers: { Authorization: 'PRIVATE' } }] },
      { ...value, entries: [{ ...value.entries[0], phase: 'unknown' }] }]) {
      read.mockResolvedValue(invalid as never)
      await expect(f.transport.requestControl('connector.inventory', {})).rejects.toBeInstanceOf(CellControlRejected)
    }
  })
  it('binds the original tree request to private native session ownership, strips cwd and rechecks before returning metadata', async () => {
    const f = await fixture(), sourceReads: unknown[] = [], audits: string[] = []
    let swapDuringRead = false, loggedOut = false, omitResourceCheck = false
    let grant: RuntimeGrant = { cellId: randomUUID(), tenantId: 'directory-test', userId: randomUUID(), role: 'member',
      revision: randomUUID(), origin: f.origin, validForMs: 10000, transport: 'private-cell' }
    const directory = vi.fn(async (sessionId: string, path?: string) => {
      sourceReads.push({ sessionId, path })
      if (sessionId !== 'hansen' || path !== undefined && path !== '/workspace/docs') throw Error('Not owned')
      if (swapDuringRead) grant = { ...grant, revision: randomUUID() }
      return { path: '/workspace/docs', entries: [{ name: '说明.txt', path: '/workspace/docs/说明.txt', type: 'file', symlink: false, unavailable: false }], truncated: false }
    })
    f.handle.mockImplementation((operation, input, signal) => handleNativeControl({ get: () => ({ directory }) }, operation, input as object, signal))
    let gateway: NativeGateway
    const server = createHttpServer(async (request, response) => {
      try { await gateway.http(request, response, randomUUID()) }
      catch (error) { response.statusCode = error instanceof EnterpriseError ? error.status : 500; response.end('denied') }
    })
    const origin = await listen(server)
    disposers.push(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) })
    gateway = new NativeGateway({ publicOrigin: origin, transports: new Map([[f.origin, f.transport]]),
      resolve: async () => { if (loggedOut) throw new EnterpriseError(401, 'unauthenticated', 'Logged out'); return grant },
      authorize: async (_token, _id, current, operation, verify) => {
        authorizeNativeOperation(current.role, operation)
        try { if (!omitResourceCheck) await verify(); audits.push('allow') }
        catch (error) { audits.push('deny'); throw error }
      } })
    disposers.push(() => gateway.close())
    const call = (body: object) => fetch(origin + '/sidebar/api/fs.tree', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const response = await call({ sessionId: 'hansen', cwd: '/foreign-home', path: '/workspace/docs' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, value: { path: '/workspace/docs', entries: [
      { name: '说明.txt', path: '/workspace/docs/说明.txt', isDir: false, hidden: false, isSymlink: false, broken: false }], truncated: false } })
    expect(sourceReads).toEqual([{ sessionId: 'hansen', path: '/workspace/docs' }])
    expect(JSON.stringify(f.handle.mock.calls)).not.toContain('/foreign-home')
    for (const body of [{ sessionId: 'alex' }, { sessionId: 'hansen', path: '/private' }]) expect((await call(body)).status).toBe(403)
    expect(audits.filter(a => a === 'deny')).toHaveLength(2)
    const count = directory.mock.calls.length
    expect((await call({ sessionId: 'hansen', userId: 'alex' })).status).toBe(400)
    expect(directory).toHaveBeenCalledTimes(count)
    omitResourceCheck = true
    expect((await call({ sessionId: 'hansen' })).status).toBe(502)
    expect(directory).toHaveBeenCalledTimes(count)
    omitResourceCheck = false; swapDuringRead = true
    const changed = await call({ sessionId: 'hansen' }); expect(changed.status).toBe(502); expect(await changed.text()).not.toContain('说明')
    loggedOut = true
    expect((await call({ sessionId: 'hansen' })).status).toBe(401)
    for (const input of [{ sessionId: 'hansen', cwd: '/foreign' }, { sessionId: '' }, { sessionId: 'hansen', userId: 'alex' }]) {
      await expect(f.transport.requestControl('session.directory', input)).rejects.toThrow()
    }
  })
  it('keeps creation resolution metadata-only, scoped, strictly validated and private', async () => {
    const f = await fixture(), creation = vi.fn(async (sessionId?: string) => ({ sessionId: sessionId ?? null, kind: 'new', agentPreset: 'standard' }))
    f.handle.mockImplementation((operation, input, signal) => handleNativeControl({ get: () => ({ creation }) }, operation, input as object, signal))
    for (const input of [{}, { sessionId: 'preallocated' }]) expect(await f.transport.requestControl('session.creation', input))
      .toEqual({ sessionId: 'sessionId' in input ? input.sessionId : null, kind: 'new', agentPreset: 'standard' })
    for (const invalid of [{ sessionId: '' }, { sessionId: null }, { sessionId: ' other ' }, { presetId: 'claimed-default' }, { userId: randomUUID() }]) {
      await expect(f.transport.requestControl('session.creation', invalid)).rejects.toThrow()
    }
    expect(creation).toHaveBeenCalledTimes(2)
    for (const value of [{ sessionId: null, kind: 'existing', agentPreset: 'standard' },
      { sessionId: 'foreign', kind: 'new', agentPreset: 'standard' }, { sessionId: null, kind: 'new', agentPreset: null },
      { sessionId: null, kind: 'new', agentPreset: '../private' }, { sessionId: null, kind: 'new', agentPreset: 'standard', history: 'PRIVATE' }]) {
      creation.mockResolvedValue(value as never)
      await expect(f.transport.requestControl('session.creation', {})).rejects.toBeInstanceOf(CellControlRejected)
    }
    for (const role of ['admin', 'member'] as const) expect(() => authorizeNativeOperation(role, { method: 'POST', target: NATIVE_CONTROL_PATH,
      contentType: 'application/json', body: Buffer.from(JSON.stringify({ operation: 'session.creation', input: {} })) })).toThrow()
  })
  it('exposes only exact version and insertion references privately, never turn content or public authority', async () => {
    const f = await fixture(), sessionId = 'owned', digest = randomBytes(32).toString('base64url')
    const selection = { commandId: randomUUID(), expectedVersion: digest, contentDigest: digest }
    const value = { sessionId, presetId: 'standard', version: digest, persisted: true, pending: false, accepted: { messageId: 'original-message', seq: 3 } }
    const turnState = vi.fn(async () => value)
    f.handle.mockImplementation((operation, input, signal) => handleNativeControl({ get: () => ({ turnState }) }, operation, input as object, signal))
    expect(await f.transport.requestControl('session.turn-state', { sessionId, selection })).toEqual(value)
    expect(turnState).toHaveBeenCalledExactlyOnceWith(sessionId, selection, expect.any(AbortSignal))
    for (const invalid of [{}, { sessionId, selection: { ...selection, commandId: 'forged' } },
      { sessionId, selection: { ...selection, contentDigest: 'a'.repeat(43) } }, { sessionId, text: 'PRIVATE' },
      { sessionId, selection: { ...selection, userId: randomUUID() } }]) {
      await expect(f.transport.requestControl('session.turn-state', invalid)).rejects.toThrow()
    }
    expect(turnState).toHaveBeenCalledTimes(1)
    for (const invalid of [{ ...value, sessionId: 'foreign' }, { ...value, history: 'PRIVATE' },
      { ...value, accepted: { messageId: 'original-message', seq: -1 } }, { ...value, presetId: '../private' },
      { ...value, accepted: null }, { ...value, persisted: 'yes' }, { ...value, pending: 'yes' },
      { ...value, persisted: false, accepted: null, pending: true }]) {
      turnState.mockResolvedValue(invalid as never)
      await expect(f.transport.requestControl('session.turn-state', { sessionId })).rejects.toBeInstanceOf(CellControlRejected)
    }
    for (const role of ['admin', 'member'] as const) expect(() => authorizeNativeOperation(role, { method: 'POST', target: NATIVE_CONTROL_PATH,
      contentType: 'application/json', body: Buffer.from(JSON.stringify({ operation: 'session.turn-state', input: { sessionId } })) })).toThrow()
  })
  it('reads only exact native session preset metadata over the private carrier and denies public access', async () => {
    const f = await fixture(), input = { sessionId: 'owned-session' }, value = { ...input, agentPreset: 'personal-agent', hasForkBoundary: true }
    const owner = { read: vi.fn(async () => value) }, get = vi.fn(name => name === 'paimindNativeSessionReferences' ? owner : undefined)
    f.handle.mockImplementation((operation, input, signal) => handleNativeControl({ get }, operation, input as object, signal))
    expect(await f.transport.requestControl('session.preset', input)).toEqual(value)
    expect(owner.read).toHaveBeenCalledExactlyOnceWith(input.sessionId, expect.any(AbortSignal))
    expect(get.mock.calls).toEqual([['paimindNativeSessionReferences']])
    for (const role of ['admin', 'member'] as const) expect(() => authorizeNativeOperation(role, { method: 'POST', target: NATIVE_CONTROL_PATH,
      contentType: 'application/json', body: Buffer.from(JSON.stringify({ operation: 'session.preset', input })) })).toThrow()
    for (const invalid of [{}, { sessionId: '' }, { sessionId: ' other ' }, { ...input, userId: randomUUID() }, { ...input, agentPreset: 'claimed' }]) {
      await expect(f.transport.requestControl('session.preset', invalid)).rejects.toThrow()
    }
    expect(owner.read).toHaveBeenCalledTimes(1)
  })
  it('fails closed when native metadata is missing, mismatched, malformed or contains extra content', async () => {
    const f = await fixture(), input = { sessionId: 'owned' }
    for (const value of [{ sessionId: 'foreign', agentPreset: 'standard', hasForkBoundary: true },
      { sessionId: 'owned', agentPreset: '../foreign', hasForkBoundary: true },
      { sessionId: 'owned', agentPreset: 'standard', hasForkBoundary: 'yes' },
      { sessionId: 'owned', agentPreset: 'standard', hasForkBoundary: true, history: 'PRIVATE' }]) {
      f.handle.mockImplementation((operation, input, signal) => handleNativeControl({ get: () => ({ read: async () => value }) }, operation, input as object, signal))
      await expect(f.transport.requestControl('session.preset', input)).rejects.toBeInstanceOf(CellControlRejected)
    }
    f.handle.mockImplementation((operation, input, signal) => handleNativeControl({ get: () => undefined }, operation, input as object, signal))
    await expect(f.transport.requestControl('session.preset', input)).rejects.toBeInstanceOf(CellControlRejected)
  })
  it('routes only three exact Feature Pack operations to their original owner and keeps public routing closed', async () => {
    const f = await fixture(), source = { id: 'paimind:pack:operations', enabled: false, expectedRevision: 0 }
    const command = { commandId: randomUUID(), requestDigest: 'sha256:' + 'a'.repeat(64), planDigest: 'sha256:' + 'b'.repeat(64),
      selection: source, approvedPackIds: ['paimind:pack:operations'] }
    const owner = { describeGovernedFeatures: vi.fn(async () => ({ state: 'read' })), previewGovernedChange: vi.fn(async () => ({ state: 'preview' })),
      applyGovernedChange: vi.fn(async () => ({ state: 'applied' })) }
    const get = vi.fn(name => name === 'paimindFeaturePacks' ? owner : undefined)
    f.handle.mockImplementation((operation, input, signal) => handleNativeControl({ get }, operation, input as object, signal))
    expect(await f.transport.requestControl('feature.describe', {})).toEqual({ state: 'read' })
    expect(await f.transport.requestControl('feature.plan', source)).toEqual({ state: 'preview' })
    expect(await f.transport.requestControl('feature.apply', command)).toEqual({ state: 'applied' })
    expect(owner.previewGovernedChange).toHaveBeenCalledWith(source)
    expect(owner.applyGovernedChange).toHaveBeenCalledWith(command, expect.any(AbortSignal))
    expect(get.mock.calls.every(call => call[0] === 'paimindFeaturePacks')).toBe(true)
    expect(JSON.stringify(f.handle.mock.calls)).not.toContain(f.token)
    for (const role of ['admin', 'member'] as const) expect(() => authorizeNativeOperation(role, {
      method: 'POST', target: NATIVE_CONTROL_PATH, contentType: 'application/json', body: Buffer.from(JSON.stringify({ operation: 'feature.apply', input: command })),
    })).toThrow()
  })
  it('rejects forged Feature Pack control selectors before owner access and does not use another provider when absent', async () => {
    const f = await fixture(), selection = { id: 'paimind:pack:operations', enabled: true, expectedRevision: 1 }
    const command = { commandId: randomUUID(), requestDigest: 'sha256:' + 'a'.repeat(64), planDigest: 'sha256:' + 'b'.repeat(64),
      selection, approvedPackIds: ['paimind:pack:operations'] }
    for (const [operation, input] of [
      ['feature.describe', { userId: randomUUID() }], ['feature.plan', { ...selection, tenantId: 'forged' }],
      ['feature.plan', { ...selection, expectedRevision: -1 }], ['feature.plan', { ...selection, id: '../../loader' }],
      ['feature.apply', { ...command, role: 'admin' }], ['feature.apply', { ...command, selection: { ...selection, origin: 'http://127.0.0.1:3080' } }],
      ['feature.apply', { ...command, approvedPackIds: ['paimind:pack:operations', 'paimind:pack:operations'] }],
      ['feature.apply', { ...command, approvedPackIds: ['paimind:capability:runtime-orbs'] }],
      ['feature.apply', { ...command, commandId: 'caller-selected' }], ['feature.apply', { ...command, requestDigest: '' }],
      ['feature.install', {}],
    ] as const) await expect(f.transport.requestControl(operation as never, input)).rejects.toThrow()
    expect(f.handle).not.toHaveBeenCalled()
    const get = vi.fn(() => undefined)
    f.handle.mockImplementation((operation, input, signal) => handleNativeControl({ get }, operation, input as object, signal))
    await expect(f.transport.requestControl('feature.describe', {})).rejects.toBeInstanceOf(CellControlRejected)
    expect(get).toHaveBeenCalledExactlyOnceWith('paimindFeaturePacks')
  })
  it('reads only bounded current Skill eligibility without invoking execution or login authorization', async () => {
    const reference = { tenantId: 'private-cell-test', publicationId: randomUUID(), sourceUserId: randomUUID(), name: 'customer-notes',
      packageDigest: 'sha256:' + 'a'.repeat(64), archiveDigest: 'sha256:' + 'b'.repeat(64), archiveBytes: 12, expandedBytes: 10, entryCount: 1 }
    const check = vi.fn(async () => {}), execute = vi.fn(async () => {}), read = vi.fn(async () => [reference.publicationId])
    const broker = await createNativeControlBroker('/tmp', check, execute, undefined, undefined, read)
    disposers.push(() => broker.close())
    const peer = createNativeControlPeer(createConnection(broker.path), { handle: async () => { throw Error('No management call expected') } })
    disposers.push(() => peer.close()); await vi.waitFor(() => expect(broker.ready).toBe(true))
    expect(await peer.readSkillEligibility([reference])).toEqual([reference.publicationId])
    expect(check).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled()
    const originalCalls = read.mock.calls.length
    for (const value of [[{ ...reference, userId: randomUUID() }], [reference, reference],
      { skills: [reference], sources: [] }]) await expect(peer.readSkillEligibility(value as never)).rejects.toThrow()
    expect(read).toHaveBeenCalledTimes(originalCalls)
    read.mockResolvedValue([randomUUID()])
    await expect(peer.readSkillEligibility([reference])).rejects.toThrow()
    expect(check).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled()
    peer.close(); await expect(peer.readSkillEligibility([reference])).rejects.toThrow()
  })
  it('does not fall back to a login check when the private eligibility consumer is absent', async () => {
    const check = vi.fn(async () => {})
    const broker = await createNativeControlBroker('/tmp', check); disposers.push(() => broker.close())
    const peer = createNativeControlPeer(createConnection(broker.path), { handle: async () => null }); disposers.push(() => peer.close())
    await vi.waitFor(() => expect(broker.ready).toBe(true))
    await expect(peer.readSkillEligibility([])).rejects.toThrow()
    expect(check).not.toHaveBeenCalled()
  })
  it('adopts only into the authenticated private cell and uses read-only receipt verification on replay', async () => {
    const f = await fixture(), a = adoptionGateway(f)
    expect(await a.gateway.adoptAgentPublication('private-browser-cookie', randomUUID(), a.principal, a.input, 'adopt')).toEqual(a.receipt)
    expect(f.handle.mock.calls[0]?.slice(0, 2)).toEqual(['publication.adopt', a.input])
    expect(await a.gateway.adoptAgentPublication('private-browser-cookie', randomUUID(), a.principal, a.input, 'verify')).toEqual(a.receipt)
    expect(f.handle.mock.calls[1]?.slice(0, 2)).toEqual(['publication.receipt', { presetId: a.receipt.presetId }])
    expect(JSON.stringify(f.handle.mock.calls)).not.toContain('private-browser-cookie')
    expect(JSON.stringify(f.handle.mock.calls)).not.toContain(f.token)
    await expect(a.gateway.adoptAgentPublication('cookie', randomUUID(), { ...a.principal, account: { ...a.principal.account, userId: randomUUID() } }, a.input, 'adopt'))
      .rejects.toMatchObject({ status: 403 })
    expect(f.handle).toHaveBeenCalledTimes(2)
    await expect(a.gateway.adoptAgentPublication('cookie', randomUUID(), a.principal, { ...a.input, userId: 'forged' } as never, 'adopt')).rejects.toThrow()
    expect(f.handle).toHaveBeenCalledTimes(2)
  })

  it.each(['adopt', 'verify'] as const)('verifies exact native Skill receipts before and after Agent %s without installing or enabling Skills', async mode => {
    const f = await fixture(), a = adoptionGateway(f)
    const skill = { tenantId: a.input.tenantId, publicationId: randomUUID(), sourceUserId: randomUUID(), name: 'customer-notes',
      packageDigest: 'sha256:' + 'c'.repeat(64), archiveDigest: 'sha256:' + 'd'.repeat(64), archiveBytes: 12, expandedBytes: 10, entryCount: 1 }
    const selected = { ...a.input, snapshot: createAgentPublicationSnapshot({ ...snapshot.content,
      profile: { ...snapshot.content.profile, preferredSkillNames: [skill.name] }, dependencies: [{ name: skill.name, digest: skill.packageDigest }] }) }
    const receipt = { ...a.receipt, snapshot: selected.snapshot }
    f.handle.mockImplementation(async operation => operation === 'skill.adopt.receipt'
      ? { ...skill, schema: 'paimind.skill-adoption/v1', adoptedAt: 42 } : receipt)
    expect(await a.gateway.adoptAgentPublication('cookie', randomUUID(), a.principal, selected, mode, [skill])).toEqual(receipt)
    expect(f.handle.mock.calls.map(call => call[0])).toEqual(['skill.adopt.receipt', mode === 'adopt' ? 'publication.adopt' : 'publication.receipt', 'skill.adopt.receipt'])
    expect(f.handle.mock.calls[0]?.[1]).toEqual(skill)
    await expect(a.gateway.adoptAgentPublication('cookie', randomUUID(), a.principal, selected, mode)).rejects.toMatchObject({ code: 'skill-publication-required' })
    expect(f.handle).toHaveBeenCalledTimes(3)
  })

  it.each(['before', 'after'] as const)('rejects another Skill publication with identical bytes %s the native Agent write', async when => {
    const f = await fixture(), a = adoptionGateway(f)
    const skill = { tenantId: a.input.tenantId, publicationId: randomUUID(), sourceUserId: randomUUID(), name: 'customer-notes',
      packageDigest: 'sha256:' + 'c'.repeat(64), archiveDigest: 'sha256:' + 'd'.repeat(64), archiveBytes: 12, expandedBytes: 10, entryCount: 1 }
    const selected = { ...a.input, snapshot: createAgentPublicationSnapshot({ ...snapshot.content,
      profile: { ...snapshot.content.profile, preferredSkillNames: [skill.name] }, dependencies: [{ name: skill.name, digest: skill.packageDigest }] }) }
    let reads = 0
    f.handle.mockImplementation(async operation => {
      if (operation !== 'skill.adopt.receipt') return { ...a.receipt, snapshot: selected.snapshot }
      reads++
      return { ...skill, publicationId: reads === (when === 'before' ? 1 : 2) ? randomUUID() : skill.publicationId,
        schema: 'paimind.skill-adoption/v1', adoptedAt: 42 }
    })
    await expect(a.gateway.adoptAgentPublication('cookie', randomUUID(), a.principal, selected, 'adopt', [skill]))
      .rejects.toMatchObject({ code: 'publication-adoption-unconfirmed' })
    expect(f.handle.mock.calls.some(call => call[0] === 'publication.adopt')).toBe(when === 'after')
    expect(f.handle.mock.calls.some(call => /release|remove|install|begin/.test(call[0]))).toBe(false)
  })
  it.each(['tenant', 'publication', 'author', 'snapshot', 'binding'] as const)('refuses an adoption reply with changed %s instead of asserting no native files changed', async kind => {
    const f = await fixture(), a = adoptionGateway(f)
    f.handle.mockImplementation(async () => {
      if (kind === 'binding') a.swap()
      return { ...a.receipt, ...(kind === 'tenant' ? { tenantId: 'another-tenant' }
        : kind === 'publication' ? { publicationId: randomUUID() }
          : kind === 'author' ? { sourceUserId: randomUUID() }
            : kind === 'snapshot' ? { snapshot: createAgentPublicationSnapshot({ ...snapshot.content, configVersion: 'other' }) } : {}) }
    })
    await expect(a.gateway.adoptAgentPublication('cookie', randomUUID(), a.principal, a.input, 'adopt'))
      .rejects.toMatchObject({ status: 503, code: 'publication-adoption-unconfirmed', retryable: true })
    expect(f.handle).toHaveBeenCalledOnce()
  })
  it('does not fall back to a development/native HTTP adoption endpoint or retry an owner rejection', async () => {
    const f = await fixture(), a = adoptionGateway(f)
    const development = new NativeGateway({ publicOrigin: 'http://127.0.0.1:62345', resolve: async () => ({
      cellId: randomUUID(), tenantId: a.input.tenantId, userId: a.principal.account.userId, role: 'admin', revision: randomUUID(), origin: f.origin, validForMs: 10000,
    }), authorize: async () => {} }); disposers.push(() => development.close())
    await expect(development.adoptAgentPublication('cookie', randomUUID(), { ...a.principal, account: { ...a.principal.account, role: 'admin' } }, a.input, 'adopt'))
      .rejects.toMatchObject({ code: 'publication-adoption-unavailable' })
    expect(f.handle).not.toHaveBeenCalled()
    f.handle.mockRejectedValue(Error('private owner diagnostic'))
    await expect(a.gateway.adoptAgentPublication('cookie', randomUUID(), a.principal, a.input, 'adopt'))
      .rejects.toMatchObject({ status: 409, code: 'publication-adoption-rejected' })
    expect(f.handle).toHaveBeenCalledOnce()
  })
  it('uses the private route and local peer without forwarding credentials or identities to the owner', async () => {
    const f = await fixture()
    expect(await f.transport.requestControl('publication.snapshot', selection)).toEqual(snapshot)
    expect(f.handle).toHaveBeenCalledTimes(1)
    expect(f.handle.mock.calls[0]?.slice(0, 2)).toEqual(['publication.snapshot', selection])
    expect(JSON.stringify(f.handle.mock.calls)).not.toContain(f.token)
    expect(await f.transport.requestControl('publication.receipt', { presetId: 'paimind-enterprise-' + 'a'.repeat(32) })).toEqual(snapshot)
    expect(await f.transport.requestControl('publication.adopt', { tenantId: 'fixture-only' })).toEqual(snapshot)
    // This explicit handler fixture is NOT the real owner's adoption schema.
  })
  it('requires the exact cell key and rejects browser origins, cookies, queries and public member/admin routing', async () => {
    const f = await fixture(), body = JSON.stringify({ operation: 'publication.snapshot', input: selection })
    for (const extra of [{}, { 'x-paimind-cell-token': 'a'.repeat(64) }, { 'x-paimind-cell-token': f.token, origin: f.origin },
      { 'x-paimind-cell-token': f.token, cookie: 'browser-cookie' }]) {
      const response = await fetch(f.origin + NATIVE_CONTROL_PATH, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body })
      expect(response.status).toBe(403)
    }
    expect((await fetch(f.origin + NATIVE_CONTROL_PATH + '?cellId=forged', { method: 'POST', headers: { 'content-type': 'application/json', 'x-paimind-cell-token': f.token }, body })).status).toBe(403)
    for (const role of ['admin', 'member'] as const) expect(() => authorizeNativeOperation(role, {
      method: 'POST', target: NATIVE_CONTROL_PATH, contentType: 'application/json', body: Buffer.from(body),
    })).toThrow()
    expect(f.handle).not.toHaveBeenCalled()
  })
  it('rejects duplicate keys and cannot use another cell key', async () => {
    const f = await fixture(), other = await fixture()
    const wrong = new CellTransport(other.origin, f.token); disposers.push(() => wrong.destroy())
    await expect(wrong.requestControl('publication.snapshot', selection)).rejects.toThrow()
    const body = JSON.stringify({ operation: 'publication.snapshot', input: selection })
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const call = request(f.origin + NATIVE_CONTROL_PATH, { method: 'POST', headers: {
        'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), 'x-paimind-cell-token': [f.token, f.token],
      } }, response => { response.resume(); resolve(response.statusCode) })
      call.once('error', reject); call.end(body)
    })
    expect(status).toBe(403); expect(f.handle).not.toHaveBeenCalled(); expect(other.handle).not.toHaveBeenCalled()
  })
  it('bounds bytes, operation names and input fields before invoking the owner', async () => {
    const f = await fixture()
    await expect(f.transport.requestControl('session.prompt' as never, {})).rejects.toThrow()
    await expect(f.transport.requestControl('publication.snapshot', { ...selection, userId: 'forged' })).rejects.toThrow()
    await expect(f.transport.requestControl('publication.adopt', { text: 'x'.repeat(NATIVE_CONTROL_LIMIT) })).rejects.toThrow()
    expect(f.handle).not.toHaveBeenCalled()
    expect(await f.transport.requestControl('publication.snapshot', selection)).toEqual(snapshot)
  })
  it('correlates concurrent results without sharing payloads or reusing a completed request', async () => {
    const f = await fixture()
    f.handle.mockImplementation(async (_operation, input) => {
      const value = input as typeof selection
      await new Promise(resolve => setTimeout(resolve, value.expectedVersion === 'one' ? 20 : 1))
      return { result: value.expectedVersion }
    })
    expect(await Promise.all(['one', 'two'].map(expectedVersion => f.transport.requestControl('publication.snapshot', { ...selection, expectedVersion }))))
      .toEqual([{ result: 'one' }, { result: 'two' }])
  })
  it('propagates caller cancellation and deadlines, rejecting late results', async () => {
    const f = await fixture(), abort = new AbortController()
    let complete!: (value: unknown) => void
    f.handle.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const pending = f.transport.requestControl('publication.snapshot', selection, abort.signal)
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(f.handle).toHaveBeenCalledTimes(1)); abort.abort(); await rejected
    await vi.waitFor(() => expect(f.handle.mock.calls[0]![2].aborted).toBe(true))
    complete({ late: true })
    await expect(f.transport.requestControl('publication.snapshot', selection, undefined, 20)).rejects.toThrow()
  })
  it('keeps owner rejection distinct and rejects pending requests after peer withdrawal', async () => {
    const f = await fixture()
    f.handle.mockRejectedValue(new Error('private owner detail must not be returned'))
    await expect(f.transport.requestControl('publication.snapshot', selection)).rejects.toBeInstanceOf(CellControlRejected)
    f.handle.mockImplementation(() => new Promise(() => {}))
    const pending = f.transport.requestControl('publication.snapshot', selection), rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(f.handle).toHaveBeenCalledTimes(2)); f.peer.close(); await rejected
    await expect(f.transport.requestControl('publication.snapshot', selection)).rejects.toThrow()
  })
  it('stops every pending control request on transport disposal and removes the private socket on broker close', async () => {
    const f = await fixture()
    f.handle.mockImplementation(() => new Promise(() => {}))
    const pending = f.transport.requestControl('publication.snapshot', selection), rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(f.handle).toHaveBeenCalledTimes(1)); f.transport.destroy(); await rejected
    await f.broker.close(); await expect(access(f.broker.directory)).rejects.toThrow()
    await expect(f.transport.requestControl('publication.snapshot', selection)).rejects.toThrow()
  })
  it('fails closed on malformed or oversized peer frames', async () => {
    for (const wire of ['not-json\n', JSON.stringify({ protocol: 'foreign', kind: 'ready' }) + '\n', 'x'.repeat(NATIVE_CONTROL_LIMIT + 1),
      JSON.stringify({ protocol: 'paimind.native-control/v1', kind: 'reply', id: ['a'.repeat(32)], ok: true, value: {} }) + '\n']) {
      const f = await fixture(); f.client.write(wire)
      await vi.waitFor(() => expect(f.broker.ready).toBe(false))
      await expect(f.broker.request('publication.snapshot', selection)).rejects.toThrow()
    }
  })
  it('closes a connected but silent peer after the bounded ready handshake', async () => {
    let connected!: () => void
    const accepted = new Promise<void>(resolve => { connected = resolve })
    const server = createServer(socket => { createNativeControlPeer(socket, { timeoutMs: 20 }); connected() })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    disposers.push(() => new Promise<void>(resolve => server.close(() => resolve())))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing fixture port')
    const client = createConnection(address.port, '127.0.0.1'); disposers.push(() => client.destroy())
    const closed = new Promise<void>(resolve => client.once('close', () => resolve()))
    await accepted; await closed
    expect(client.destroyed).toBe(true)
  })
  it('bounds simultaneous owner operations without retrying or dropping established request identities', async () => {
    const f = await fixture()
    const completions: (() => void)[] = []
    f.handle.mockImplementation(() => new Promise(resolve => { completions.push(() => resolve(snapshot)) }))
    const pending = Array.from({ length: 16 }, () => f.broker.request('publication.snapshot', selection))
    await vi.waitFor(() => expect(f.handle).toHaveBeenCalledTimes(16))
    await expect(f.broker.request('publication.snapshot', selection)).rejects.toThrow()
    expect(f.handle).toHaveBeenCalledTimes(16)
    for (const complete of completions) complete()
    expect(await Promise.all(pending)).toEqual(Array.from({ length: 16 }, () => snapshot))
    f.handle.mockResolvedValue(snapshot)
    expect(await f.broker.request('publication.snapshot', selection)).toEqual(snapshot)
  })
  it('rejects overload while canceled owner operations drain without tearing down the native peer', async () => {
    const f = await fixture(), abort = new AbortController(), completions: (() => void)[] = []
    f.handle.mockImplementation(() => new Promise(resolve => { completions.push(() => resolve(snapshot)) }))
    const pending = Promise.allSettled(Array.from({ length: 16 }, () => f.broker.request('publication.snapshot', selection, abort.signal)))
    await vi.waitFor(() => expect(f.handle).toHaveBeenCalledTimes(16)); abort.abort()
    expect((await pending).every(result => result.status === 'rejected')).toBe(true)
    await expect(f.broker.request('publication.snapshot', selection)).rejects.toMatchObject({ code: 'NATIVE_CONTROL_REJECTED' })
    expect(f.broker.ready).toBe(true); expect(f.handle).toHaveBeenCalledTimes(16)
    for (const complete of completions) complete()
    f.handle.mockResolvedValue(snapshot)
    expect(await f.broker.request('publication.snapshot', selection)).toEqual(snapshot)
    expect(f.broker.ready).toBe(true)
  })
  it('routes admitted source reads over the control channel and rechecks identity/lease after the reply', async () => {
    const f = await fixture(), userId = randomUUID(), tenantId = 'private-control-test'
    const principal = { sessionId: randomUUID(), account: { userId, tenantId, username: 'hansen', displayName: 'Hansen', role: 'member' as const, status: 'active' as const } }
    let grant: RuntimeGrant = { cellId: randomUUID(), tenantId, userId, role: 'member', revision: randomUUID(), origin: f.origin, validForMs: 10000, transport: 'private-cell' }
    const gateway = new NativeGateway({ publicOrigin: 'http://127.0.0.1:62345', resolve: async () => grant,
      transports: new Map([[f.origin, f.transport]]), revalidateMs: 20,
      authorize: async (_token, _id, selected, native, verify) => { authorizeNativeOperation(selected.role, native); await verify() } })
    disposers.push(() => gateway.close())
    const chosen = { ...selection, reason: 'Not native content', userId: 'not-the-source' }
    expect(await gateway.readAgentPublication('private-browser-token', randomUUID(), principal, chosen)).toEqual(snapshot)
    expect(f.handle.mock.calls[0]?.slice(0, 2)).toEqual(['publication.snapshot', selection])
    expect(JSON.stringify(f.handle.mock.calls)).not.toContain('private-browser-token')
    f.handle.mockImplementation(async () => { grant = { ...grant, revision: randomUUID() }; return snapshot })
    await expect(gateway.readAgentPublication('token', randomUUID(), principal, selection)).rejects.toMatchObject({ status: 502 })
    f.handle.mockRejectedValue(Error('No saved version'))
    await expect(gateway.readAgentPublication('token', randomUUID(), principal, selection)).rejects.toMatchObject({ status: 409 })
  })
})
