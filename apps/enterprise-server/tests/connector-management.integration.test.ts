import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { mkdtemp, realpath, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { createConnection } from 'node:net'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import postgres from 'postgres'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { Identity } from '../src/identity.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { CellTransport } from '../src/cell-transport.js'
import { ConnectorManagement } from '../src/connector-management.js'
import { RuntimeAdmission } from '../src/runtime-admission.js'
import { createEnterpriseServer } from '../src/server.js'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { createNativeControlBroker, createNativeControlPeer, handleNativeControl, authorizeNativeConnectorUse, authorizeNativeExecution, type NativeConnectorReleaseReference, type NativeControlPeer } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { openPinnedOriginAuthority } from '../src/runtime-cell-reload.js'
import { createNativeConnectorConfiguration } from '../../../packages/harness-compat/src/connector-configuration.js'
import { createManagedConnectorAuthority } from '../../../packages/harness-compat/src/connector-authority.js'
import { createManagedHarnessConnectorProvider } from '../../../packages/harness-compat/src/managed-connector.js'
import { installManagedHarnessToolGuard, installManagedHarnessOriginGuard } from '../../../packages/harness-compat/src/managed-runtime.js'
import { createManagedToolGuard, MEMBER_TOOL_POLICY } from '../../../deploy/enterprise/worker/runtime/member-tool-policy.mjs'

const { boot } = await import(createRequire(new URL('../../../packages/harness-compat/package.json', import.meta.url)).resolve('@deepseek-ai/dsh-app-boot'))
const compatRequire=createRequire(new URL('../../../packages/harness-compat/package.json',import.meta.url))
const {symbols}=await import(compatRequire.resolve('@deepseek-ai/cordis'))
const {SystemPrompt}=await import(compatRequire.resolve('@deepseek-ai/dsh-system-prompt'))
const {ToolRuntime}=await import(compatRequire.resolve('@deepseek-ai/dsh-tools'))
const requireNative=createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
const mcp=requireNative('@deepseek-ai/dsh-mcp-client'),anchor=requireNative.resolve('@deepseek-ai/dsh-mcp-client/package.json')
const localConnector=(home:string)=>({transport:'stdio',serverName:'sales',command:process.execPath,
  args:[fileURLToPath(new URL('../../../packages/harness-compat/tests/connector-native-server.mjs',import.meta.url)),anchor,'actual-diagnostic'],cwd:home,env:{},
  toolCallTimeoutMs:1000,failOnStartupError:true,reconnect:{enabled:false,initialDelayMs:100,maxDelayMs:1000,maxAttempts:1}})

const configPath = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!configPath || statSync(configPath).mode & 0o077) throw Error('Private isolated PostgreSQL required')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
for (const key of ['ownerUrl', 'applicationUrl']) {
  const url = new URL(config[key])
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || ['3080','5432','54166'].includes(url.port)) throw Error('Unsafe fixture')
}
const owner = postgres(config.ownerUrl, { max: 2, onnotice: () => {} }), sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
const disposers: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const dispose of disposers.splice(0).reverse()) await dispose() })
afterAll(async () => { await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })
const context = () => ({ key: randomUUID(), requestId: randomUUID() })
const signal = () => new AbortController().signal
async function close(server: Server) { if (!server.listening) return; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
async function listen(server: Server) {
  for (let n = 0; n < 32; n++) {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('No isolated port')
    const origin = `http://127.0.0.1:${address.port}`
    if (!(await owner`select 1 from haas.runtime_bindings where origin=${origin}`).length) return origin
    await close(server)
  }
  throw Error('No fresh isolated port')
}
const connector = (name = 'sales') => ({ transport: 'streamable-http', serverName: name, url: 'https://example.invalid/mcp',
  headers: { Authorization: 'Bearer SYNTHETIC_CONNECTOR_SECRET' }, toolCallTimeoutMs: 5000, failOnStartupError: true,
  reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 1 } })
async function fixture(liveConnectors=false) {
  const tenantId = 'connector-' + randomUUID(), password = 'Explicit synthetic connector password 2026'
  await owner`insert into haas.tenants(tenant_id) values(${tenantId})`
  const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
  await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, context())
  const admin = await identity.login({ username: 'morgan', password }, context())
  const hooks: { before?: (op: string) => Promise<void>; after?: (op: string, value: any) => Promise<any> } = {}
  const received: Array<{ userId: string; op: string }> = []
  const mount = async (userId: string, home: string) => {
    // Actual installed app boot, Loader, Include and persistent file owner.
    // Cells are separate contexts in this test process, NOT final containers.
    const native = await boot('connector-governance-test', join(home, 'root.json'), [],undefined,
      liveConnectors?pathToFileURL(requireNative.resolve('@deepseek-ai/dsh/package.json')).href:undefined)
    disposers.push(() => native.fiber.dispose())
    const bridge:{peer?:NativeControlPeer}={},lifetime=new AbortController()
    let activation:ReturnType<typeof createManagedConnectorAuthority>|undefined
    if(liveConnectors){
      native.effect(()=>()=>lifetime.abort())
      const selected=createManagedHarnessConnectorProvider(native,mcp,{nodeExecutable:process.execPath,moduleAnchor:anchor,lookupCwd:home,
        prepare:r=>({argv:r.argv,cwd:r.cwd,env:{...r.env}})},ToolRuntime)
      const guard=installManagedHarnessToolGuard(native,createManagedToolGuard({role:'member',policy:MEMBER_TOOL_POLICY},(ref:any)=>activation?.admits(ref)===true))
      installManagedHarnessOriginGuard(native,(origins,signal)=>authorizeNativeExecution(native,bridge.peer!,origins,signal))
      await native.plugin(SystemPrompt,{});await native.plugin(selected.select(ToolRuntime) as typeof ToolRuntime,{})
      await vi.waitFor(()=>guard.assertReady())
      const loader=Reflect.get(native.loader,symbols.original),unwrap=loader.unwrapExports
      loader.unwrapExports=function(value:unknown){return selected.select(unwrap.call(this,value))}
      native.effect(()=>()=>{loader.unwrapExports=unwrap})
    }
    const configuration = await createNativeConnectorConfiguration(native, join(home, '.enterprise-connectors'))
    if(liveConnectors)activation=createManagedConnectorAuthority(native,configuration,{signal:lifetime.signal,
      readApproval:(reference,expectedApprovalRevision,signal)=>bridge.peer!.readConnectorApproval({reference,expectedApprovalRevision},signal),
      authorizeUse:(origins,reference,revision,signal)=>authorizeNativeConnectorUse(native,bridge.peer!,origins,reference,revision,signal)})
    const key = randomBytes(32).toString('hex')
    const ingress = createNativeIngress({ token: key, nativePort: 17893, control: async (op, input, cancellation) => {
      received.push({ userId, op }); await hooks.before?.(op)
      const result = await handleNativeControl({ get: name => name === 'paimindNativeConnectorConfiguration' ? configuration
        :name==='paimindNativeConnectorActivation'?activation:undefined }, op, input, cancellation)
      return hooks.after ? hooks.after(op, result) : result
    } })
    const origin = await listen(ingress.server); disposers.push(() => ingress.close())
    const transport = new CellTransport(origin, key, 17893); disposers.push(() => transport.destroy())
    return { native, configuration, ingress, origin, transport, activation, bridge, lifetime }
  }
  const cells = []
  for (const username of ['hansen','alex']) {
    const member = (await identity.createMember(admin.token, { username, displayName: username === 'hansen' ? 'Hansen' : 'Alex', password }, context())).data
    const home = await realpath(await mkdtemp(join(tmpdir(), 'paimind-connector-command-')))
    await writeFile(join(home, 'root.json'), '[]', { mode: 0o600 })
    const attached = await mount(member.userId, home)
    const pin: PrivateRuntimeCell = { cellId: randomUUID(), tenantId, userId: member.userId, role: 'member', revision: randomUUID(), origin: attached.origin,
      containerId: randomBytes(32).toString('hex'), imageId: 'sha256:' + 'd'.repeat(64), policyDigest: 'sha256:' + 'e'.repeat(64), volumeName: 'paimind-haas-member-connector-' + randomUUID() }
    await owner`insert into haas.runtime_bindings(cell_id,tenant_id,user_id,origin,revision,isolation_mode,status,lease_expires_at,container_id,image_id,volume_name,policy_digest)
      values(${pin.cellId},${tenantId},${pin.userId},${pin.origin},${pin.revision},'container-managed','ready',clock_timestamp()+interval '10 minutes',${pin.containerId},${pin.imageId},${pin.volumeName},${pin.policyDigest})`
    cells.push({ member, home, pin, ...attached })
  }
  const reservation = createServer(), url = await listen(reservation); await close(reservation)
  const makeManager = () => new ConnectorManagement(identity, new RuntimeBindings(sql, identity, url, [], cells.map(c => c.pin)), new Map(cells.map(c => [c.pin.origin, c.transport])))
  const options = { identity, connectorManagement: makeManager(), publicOrigin: url, loopbackDevelopment: true }
  disposers.push(() => options.connectorManagement.close())
  const server = createEnterpriseServer(options)
  await new Promise<void>(resolve => server.listen(Number(new URL(url).port), '127.0.0.1', resolve)); disposers.push(() => close(server))
  const post = (body: object, token = admin.token, key = randomUUID(), route = '/connector-commands') => fetch(url + '/haas/v1/admin' + route,
    { method: 'POST', redirect: 'error', headers: { origin: url, 'content-type': 'application/json', 'idempotency-key': key, cookie: 'paimind_haas_session=' + token }, body: JSON.stringify(body) })
  const get = (id: string, token = admin.token) => fetch(url + '/haas/v1/admin/connector-commands/' + id, { headers: { cookie: 'paimind_haas_session=' + token } })
  const input = (index = 0, change: object = { kind: 'upsert', entryId: 'sales', configuration: connector() }) => ({
    targetUserId: cells[index]!.member.userId, expectedCellRevision: cells[index]!.pin.revision,
    expectedConfigurationRevision: cells[index]!.configuration.read(signal()).revision, change, reason: '保存成员连接器停用配置', confirmed: true })
  const restartGateway = () => { options.connectorManagement.close(); options.connectorManagement = makeManager() }
  const replace = async () => {
    const cell = cells[0]!, old = cell.pin, admission = new RuntimeAdmission(owner, url)
    expect(await admission.suspend(old)).toBe(true); await cell.native.fiber.dispose(); await cell.ingress.close()
    const [suspended] = await owner`select revision from haas.runtime_bindings where cell_id=${old.cellId}`
    const attached = await mount(cell.member.userId, cell.home)
    const next = { ...old, origin: attached.origin, containerId: randomBytes(32).toString('hex'), revision: randomUUID() }
    await admission.replaceSuspended({ ...old, revision: suspended!.revision }, next)
    Object.assign(cell, attached, { pin: next }); restartGateway()
  }
  return { tenantId, identity, admin, cells, hooks, received, options, post, get, input, restartGateway, replace, password, url,
    writes: () => received.filter(v => v.op === 'connector.configure') }
}

describe('connector commands with real PostgreSQL/auth/HTTP and actual native Include, not Browser E2E or final workers', () => {
  const approvalInput = (f: Awaited<ReturnType<typeof fixture>>, revision = 0) => ({
    decision: 'approved', targetUserId: f.cells[0]!.member.userId, entryId: 'sales', expectedApprovalRevision: revision,
    expectedCellRevision: f.cells[0]!.pin.revision, expectedConfigurationRevision: f.cells[0]!.configuration.read(signal()).revision,
    reason: '批准准确成员连接器版本', confirmed: true,
  })
  const revokeInput = (f: Awaited<ReturnType<typeof fixture>>, revision = 1) => ({ decision: 'revoked', targetUserId: f.cells[0]!.member.userId,
    entryId: 'sales', expectedApprovalRevision: revision, reason: '撤销所选连接器批准', confirmed: true })
  const approvalState = (f: Awaited<ReturnType<typeof fixture>>) => ({ targetUserId: f.cells[0]!.member.userId, entryId: 'sales', reason: '读取历史批准记录', confirmed: true })
  const decide = (f: Awaited<ReturnType<typeof fixture>>, body: object, key = randomUUID(), token = f.admin.token) => f.post(body, token, key, '/connector-approvals')
  async function authorityFixture(liveConnectors=false) {
    const f = await fixture(liveConnectors); expect((await f.post(liveConnectors?f.input(0,{kind:'upsert',entryId:'sales',configuration:localConnector(f.cells[0]!.home)}):f.input())).status).toBe(200)
    expect((await decide(f, approvalInput(f))).status).toBe(200)
    const bindings = new RuntimeBindings(sql, f.identity, f.url, [], f.cells.map(cell => cell.pin)), peers = []
    for (const cell of f.cells) {
      // The actual reverse chain includes Unix broker + launcher ingress +
      // HTTP upgrade + production immutable-pin closure + real DB authority.
      const broker = await createNativeControlBroker(undefined,
        (input, cancellation) => cell.ingress.checkOrigins(input, cancellation),
        (input, cancellation) => cell.ingress.authorizeExecution(input, cancellation),
        (input, cancellation) => cell.ingress.deriveOrigins(input, cancellation),
        (input, cancellation) => cell.ingress.sealJobOrigins(input, cancellation),
        (input, cancellation) => cell.ingress.readSkillEligibility(input, cancellation),
        (input, cancellation) => cell.ingress.readConnectorApproval(input, cancellation),
        (input, cancellation) => cell.ingress.authorizeConnectorExecution(input, cancellation))
      disposers.push(() => broker.close())
      const peer = createNativeControlPeer(createConnection(broker.path), { handle: async () => { throw Error('No invocation fixture') } })
      cell.bridge.peer=peer
      disposers.push(() => peer.close()); await vi.waitFor(() => expect(broker.ready).toBe(true))
      await openPinnedOriginAuthority(bindings, cell.pin, cell.transport); peers.push(peer)
    }
    const release = f.cells[0]!.configuration.release({entryId:'sales',expectedRevision:f.cells[0]!.configuration.read(signal()).revision},signal())
    if (!release.reference) throw Error('Missing original configuration version')
    const reference: NativeConnectorReleaseReference = release.reference
    const approval = (expectedApprovalRevision: number | null = null) => ({ reference, expectedApprovalRevision })
    const execution = async (index = 0) => {
      const cell = f.cells[index]!, login = await f.identity.login({ username: cell.member.username, password:f.password },context())
      const nativeSessionId = 'connector-native-' + randomUUID()
      const source = await f.identity.sealInteractiveOrigin(login.token,randomUUID(),{tenantId:f.tenantId,userId:cell.member.userId,role:'member',cellId:cell.pin.cellId,nativeSessionId})
      return { login, input:{reference,approvalRevision:1,execution:{nativeSessionId,presetId:'standard',publication:null,skills:[],sources:[source]}} }
    }
    return {...f, bindings, peers, reference, approval, execution}
  }
  async function nativeUse(f:Awaited<ReturnType<typeof authorityFixture>>,index:number){
    const use=await f.execution(index),root=f.cells[index]!.native,source={source:{kind:'user',rpcId:use.input.execution.sources[0]}}
    // Real ToolRuntime + MCP + DB; active-turn hook fixtures are explicit and
    // do not claim final persistent Session/model/browser acceptance.
    const events:any[]=[{type:'turn/start',data:{turn:1}}],abort=new AbortController()
    const agent={id:'native-connector-'+randomUUID(),cancel:()=>abort.abort(),session:{id:use.input.execution.nativeSessionId,header:{agentPreset:'standard'},events,surface:{nodes:[]}}}
    await root.waterfall('agent/pre-step',{agent,turn:1,step:1,messages:[source],signal:abort.signal} as never,()=>Promise.resolve({kind:'enter',messages:[source]} as never))
    events.push({type:'step/start',data:{turn:1,step:1}},{type:'user/message',data:source})
    return {login:use.login,run:()=>root.tools.execute({name:'mcp__sales__echo',agent,callId:randomUUID(),arguments:{message:'real-db-use'},signal:signal()} as never)}
  }
  const activationInput=(cell:Awaited<ReturnType<typeof fixture>>['cells'][number])=>{
    const state=cell.configuration.activationState(signal()),row=state.entries.find(row=>row.entryId==='sales')!
    return {entryId:'sales',configurationVersion:row.configurationVersion!,expectedRevision:state.revision,enabled:true}
  }
  const activationCommand=(f:Awaited<ReturnType<typeof fixture>>,index=0,enabled=true,revision=1)=>{
    const cell=f.cells[index]!,input=activationInput(cell)
    return {targetUserId:cell.member.userId,expectedCellRevision:cell.pin.revision,expectedConfigurationRevision:input.expectedRevision,
      entryId:input.entryId,configurationVersion:input.configurationVersion,enabled,expectedApprovalRevision:enabled?revision:null,reason:'确认成员连接器启停',confirmed:true}
  }
  const sendActivation=(f:Awaited<ReturnType<typeof fixture>>,input=activationCommand(f),key=randomUUID(),token=f.admin.token)=>f.post(input,token,key,'/connector-activation-commands')
  const activationWrites=(f:Awaited<ReturnType<typeof fixture>>)=>f.received.filter(row=>row.op==='connector.activate')
  const activationReceipt=(f:Awaited<ReturnType<typeof fixture>>,id:string)=>fetch(f.url+'/haas/v1/admin/connector-activation-commands/'+id,{headers:{cookie:'paimind_haas_session='+f.admin.token}})
  it('durable activation enables real native use for two approved members, disables only one, and replays without I/O or stale grants',async()=>{
    const f=await authorityFixture(true),hansen=f.cells[0]!,alex=f.cells[1]!
    await f.post(f.input(1,{kind:'upsert',entryId:'sales',configuration:localConnector(alex.home)}))
    expect((await decide(f,{...approvalInput(f),targetUserId:alex.member.userId,expectedCellRevision:alex.pin.revision,expectedConfigurationRevision:alex.configuration.read(signal()).revision})).status).toBe(200)
    f.hooks.before=async op=>{if(op==='connector.activate'){
      expect(await owner`select 1 from haas.connector_activation_commands where tenant_id=${f.tenantId} and outcome='unconfirmed'`).toHaveLength(1)
      expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.connector.activation.requested' and outcome='succeeded'`).not.toHaveLength(0)
    }}
    const input=activationCommand(f),key=randomUUID(),response=await sendActivation(f,input,key)
    expect(response.status).toBe(200);const enabled=(await response.json()).data
    expect(enabled).toMatchObject({outcome:'enabled',runtimeGrant:false,historicalReceipt:true,confirmation:{lifecycle:{entries:[{enabled:true,authority:'live',phase:'active',connection:'not-probed'}]}}})
    expect((await sendActivation(f,activationCommand(f,1))).status).toBe(200)
    const h=await nativeUse(f,0),a=await nativeUse(f,1);expect((await h.run()).isError).toBe(false);expect((await a.run()).isError).toBe(false)
    expect((await sendActivation(f,activationCommand(f,0,false))).status).toBe(200)
    expect(hansen.native.tools.get('mcp__sales__echo')).toBeUndefined();expect((await a.run()).isError).toBe(false)
    expect(hansen.configuration.read(signal()).entries[0]?.enabled).toBe(false)
    const calls=f.received.length;f.restartGateway()
    expect((await (await sendActivation(f,input,key)).json()).data).toEqual(enabled)
    expect((await (await activationReceipt(f,enabled.commandId)).json()).data).toEqual(enabled)
    expect(f.received).toHaveLength(calls);expect(activationWrites(f)).toHaveLength(3)
    const records=await owner`select * from haas.connector_activation_commands where tenant_id=${f.tenantId}`,audit=await owner`select * from haas.audit_events where tenant_id=${f.tenantId} and action like 'runtime.connector.activation.%'`
    expect(JSON.stringify([enabled,records,audit])).not.toMatch(/actual-diagnostic|paimindVersionKey|"headers"|"args"|"env"/u)
    await expect(sql`update haas.connector_activation_commands set outcome='conflict' where tenant_id=${f.tenantId}`).rejects.toThrow(/immutable/u)
    await expect(sql`delete from haas.connector_activation_commands where tenant_id=${f.tenantId}`).rejects.toThrow(/permission denied/u)
  })
  it('durable activation rejects stale versions, stale approvals, malformed inputs and unauthorized targets before reservation',async()=>{
    const f=await authorityFixture(true),other=await fixture(),input=activationCommand(f),member=await f.identity.login({username:'hansen',password:f.password},context())
    for(const patch of [{expectedApprovalRevision:2},{expectedCellRevision:randomUUID()},{expectedConfigurationRevision:'f'.repeat(64)},{configurationVersion:'f'.repeat(64)}])expect((await sendActivation(f,{...input,...patch})).status).toBe(409)
    for(const patch of [{expectedApprovalRevision:0},{expectedApprovalRevision:null},{confirmed:false},{enabled:false},{configuration:{url:'PRIVATE'}}])expect((await sendActivation(f,{...input,...patch} as any)).status).toBe(400)
    expect((await sendActivation(f,input,randomUUID(),member.token)).status).toBe(403)
    expect((await sendActivation(f,{...input,targetUserId:other.cells[0]!.member.userId})).status).toBe(404)
    await decide(f,revokeInput(f));expect((await sendActivation(f,input)).status).toBe(409)
    expect(activationWrites(f)).toHaveLength(0);expect(await owner`select 1 from haas.connector_activation_commands where tenant_id=${f.tenantId}`).toHaveLength(0)
  })
  it('durable activation retains lost effects as unknown, blocks other changes, permits revocation, and fences explicit resolution by replacement',async()=>{
    const f=await authorityFixture(true),cell=f.cells[0]!,input=activationCommand(f),key=randomUUID(),oldConfiguration=f.input()
    f.hooks.after=async(op,value)=>{if(op==='connector.activate')throw Error('Explicit lost acknowledgement');return value}
    const response=await sendActivation(f,input,key);expect(response.status).toBe(202);const unknown=(await response.json()).data
    expect(unknown).toMatchObject({outcome:'unconfirmed',confirmation:null,runtimeGrant:false})
    expect(cell.configuration.activationState(signal()).entries[0]).toMatchObject({enabled:true,authority:'live'})
    const use=await nativeUse(f,0);expect((await use.run()).isError).toBe(false)
    f.hooks.after=undefined;const calls=f.received.length;f.restartGateway()
    expect((await (await sendActivation(f,input,key)).json()).data).toEqual(unknown);expect(f.received).toHaveLength(calls)
    expect((await sendActivation(f,activationCommand(f))).status).toBe(409)
    expect((await f.post(oldConfiguration)).status).toBe(409)
    const state=await f.post({targetUserId:cell.member.userId},f.admin.token,randomUUID(),'/connector-activation-command-state');expect((await state.json()).data.command).toEqual(unknown)
    const resolve=(revision:string)=>f.post({expectedCellRevision:revision,reason:'核准替代单元，历史效果仍未知',confirmed:true},f.admin.token,randomUUID(),'/connector-activation-commands/'+unknown.commandId+'/resolve')
    expect((await resolve(cell.pin.revision)).status).toBe(409)
    expect((await decide(f,revokeInput(f))).status).toBe(200);expect((await use.run()).isError).toBe(true)
    expect((await decide(f,{decision:'approved',targetUserId:cell.member.userId,entryId:'sales',expectedApprovalRevision:2,
      expectedCellRevision:cell.pin.revision,expectedConfigurationRevision:cell.configuration.activationState(signal()).revision,reason:'重新批准准确连接器版本',confirmed:true})).status).toBe(409)
    await f.replace();const before=activationWrites(f).length,resolved=await resolve(f.cells[0]!.pin.revision)
    expect(resolved.status).toBe(200);expect((await resolved.json()).data).toMatchObject({outcome:'superseded',confirmation:{effect:'unknown',lifecycle:{entries:[{enabled:true,authority:'absent'}]}}})
    expect(activationWrites(f)).toHaveLength(before);expect((await resolve(f.cells[0]!.pin.revision)).status).toBe(409)
    expect((await sendActivation(f,activationCommand(f,0,false))).status).toBe(200)
    expect(f.cells[0]!.configuration.read(signal()).entries[0]?.enabled).toBe(false)
  })
  it.each(['identical','competing'] as const)('durable activation serializes %s concurrent submissions to one native sender',async mode=>{
    const f=await authorityFixture(true),input=activationCommand(f),key=randomUUID()
    const responses=await Promise.all([sendActivation(f,input,key),sendActivation(f,input,mode==='identical'?key:randomUUID())])
    if(mode==='identical'){expect(responses.some(r=>r.status===200)).toBe(true);expect(responses.every(r=>[200,202].includes(r.status))).toBe(true)}
    else expect(responses.map(r=>r.status).sort()).toEqual([200,409])
    expect(activationWrites(f)).toHaveLength(1);expect(await owner`select 1 from haas.connector_activation_commands where tenant_id=${f.tenantId}`).toHaveLength(1)
    expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.connector.activation.requested' and outcome='succeeded'`).toHaveLength(1)
    expect((await sendActivation(f,{...input,reason:'另一个确认原因'},key)).status).toBe(409)
  })
  it.each(['before','after'] as const)('durable activation does not confirm success when approval is revoked %s native activation',async phase=>{
    const f=await authorityFixture(true),cell=f.cells[0]!,input=activationCommand(f),before=await readFile(join(cell.home,'.enterprise-connectors/cordis.json'),'utf8')
    const revoke=async(op:string)=>{if(op==='connector.activate')expect((await decide(f,revokeInput(f))).status).toBe(200)}
    if(phase==='before')f.hooks.before=revoke;else f.hooks.after=async(op,value)=>{await revoke(op);return value}
    const response=await sendActivation(f,input);expect(response.status).toBe(202);expect((await response.json()).data.outcome).toBe('unconfirmed')
    if(phase==='before')expect(await readFile(join(cell.home,'.enterprise-connectors/cordis.json'),'utf8')).toBe(before)
    await vi.waitFor(()=>expect(cell.configuration.activationState(signal()).entries[0]?.authority).toBe('absent'),{timeout:5000})
    expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.connector.activation.confirmed' and outcome='succeeded'`).toHaveLength(0)
  })
  it('durable activation records an exact original revision conflict without activating or guessing success',async()=>{
    const f=await authorityFixture(true),cell=f.cells[0]!,input=activationCommand(f)
    f.hooks.before=async op=>{if(op==='connector.activate')await cell.configuration.configure({kind:'upsert',entryId:'support',expectedRevision:cell.configuration.read(signal()).revision,configuration:connector('support')},signal())}
    const response=await sendActivation(f,input);expect(response.status).toBe(200);expect((await response.json()).data.outcome).toBe('conflict')
    expect(cell.configuration.read(signal()).entries.every(row=>row.enabled===false)).toBe(true);expect(cell.native.tools.get('mcp__sales__echo')).toBeUndefined()
  })
  it('durable activation contains secret-bearing acknowledgements without leaking data or repeating the write',async()=>{
    const f=await authorityFixture(true),input=activationCommand(f),key=randomUUID()
    f.hooks.after=async(op,value)=>op==='connector.activate'?{...value,config:'SYNTHETIC_PRIVATE_ACTIVATION'}:value
    const response=await sendActivation(f,input,key);expect(response.status).toBe(202);const body=await response.text();expect(body).not.toContain('SYNTHETIC_PRIVATE_ACTIVATION')
    f.hooks.after=undefined;expect((await sendActivation(f,input,key)).status).toBe(202);expect(activationWrites(f)).toHaveLength(1)
    const rows=await owner`select * from haas.connector_activation_commands where tenant_id=${f.tenantId}`,audit=await owner`select * from haas.audit_events where tenant_id=${f.tenantId}`
    expect(JSON.stringify([rows,audit])).not.toContain('SYNTHETIC_PRIVATE_ACTIVATION')
  })
  it('durable activation cancellation retains the reservation without late native execution or a resend',async()=>{
    const f=await authorityFixture(true),input=activationCommand(f),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),cancel=new AbortController(),ctx=context()
    f.hooks.before=async op=>{if(op==='connector.activate'){entered.resolve();await release.promise}}
    const pending=f.options.connectorManagement.createActivation(f.admin.token,input,ctx,cancel.signal)
    await entered.promise;cancel.abort();const result=await pending;expect(result.outcome).toBe('unconfirmed')
    release.resolve();f.hooks.before=undefined
    await vi.waitFor(()=>expect(f.cells[0]!.configuration.activationState(signal()).entries[0]?.authority).toBe('absent'))
    expect(await f.cells[0]!.transport.requestControl('connector.activation-state',{})).toMatchObject({entries:[{enabled:false,authority:'absent'}]})
    expect((await f.options.connectorManagement.createActivation(f.admin.token,input,ctx,signal())).commandId).toBe(result.commandId)
    expect(activationWrites(f)).toHaveLength(1)
  })
  it.each(['requested','confirmed'] as const)('durable activation does not claim completion if %s audit cannot commit',async phase=>{
    const f=await authorityFixture(true),input=activationCommand(f),action='runtime.connector.activation.'+phase
    await owner.unsafe(`create function haas.reject_activation_audit() returns trigger language plpgsql as $$ begin if NEW.tenant_id='${f.tenantId}' and NEW.action='${action}' and NEW.outcome='succeeded' then raise exception 'explicit activation audit fault'; end if; return NEW; end $$`)
    await owner`create trigger reject_activation_audit before insert on haas.audit_events for each row execute function haas.reject_activation_audit()`
    try{
      expect((await sendActivation(f,input)).status).toBe(503)
      const rows=await owner`select outcome from haas.connector_activation_commands where tenant_id=${f.tenantId}`
      expect(rows).toHaveLength(phase==='requested'?0:1);if(rows.length)expect(rows[0]!.outcome).toBe('unconfirmed')
      expect(activationWrites(f)).toHaveLength(phase==='requested'?0:1)
    }finally{await owner`drop trigger reject_activation_audit on haas.audit_events`;await owner`drop function haas.reject_activation_audit()`}
  })
  it.each(['logout','binding'] as const)('durable activation rechecks %s after native acknowledgement without confirming stale success',async change=>{
    const f=await authorityFixture(true),input=activationCommand(f)
    f.hooks.after=async(op,value)=>{if(op==='connector.activate'){
      if(change==='logout')await f.identity.logout(f.admin.token,{},context())
      else await owner`update haas.runtime_bindings set revision=${randomUUID()} where cell_id=${f.cells[0]!.pin.cellId}`
    }return value}
    const response=await sendActivation(f,input)
    expect(response.status).toBe(change==='logout'?401:202)
    const rows=await owner`select outcome from haas.connector_activation_commands where tenant_id=${f.tenantId}`
    expect(rows).toEqual([{outcome:'unconfirmed'}])
    expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.connector.activation.confirmed' and outcome='succeeded'`).toHaveLength(0)
  })
  it('activation observation reports real enabled, revoked-pending and disabled native states without rewriting data or granting use',async()=>{
    const f=await authorityFixture(true),cell=f.cells[0]!,input={targetUserId:cell.member.userId,reason:'核对成员启停状态',confirmed:true}
    const observe=()=>f.post(input,f.admin.token,randomUUID(),'/connector-activation-state')
    f.hooks.before=async op=>{if(op==='connector.activation-state')expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.connector.command.authorized' and reason=${input.reason}`).not.toHaveLength(0)}
    expect((await (await observe()).json()).data.lifecycle.entries[0]).toMatchObject({enabled:false,authority:'absent',connection:'not-probed'})
    await cell.activation!.activate(activationInput(cell),signal())
    const filename=join(cell.home,'.enterprise-connectors/cordis.json'),before=await readFile(filename,'utf8'),received=f.received.length
    const response=await observe();expect(response.status).toBe(200)
    const active=(await response.json()).data
    expect(active).toMatchObject({targetUserId:cell.member.userId,cellRevision:cell.pin.revision,observation:'native-lifecycle-only',runtimeGrant:false,
      lifecycle:{schema:'paimind.connector-observation/v1',entries:[{enabled:true,authority:'live',phase:'active',connection:'not-probed'}]}})
    expect(f.received.slice(received).map(r=>r.op)).toEqual(['connector.activation-state']);expect(await readFile(filename,'utf8')).toBe(before)
    expect((await f.post(input,f.admin.token,randomUUID(),'/connector-configuration')).status).toBe(502)
    expect((await decide(f,revokeInput(f))).status).toBe(200)
    await vi.waitFor(()=>expect(cell.configuration.activationState(signal()).entries[0]?.authority).toBe('absent'),{timeout:5000})
    expect((await (await observe()).json()).data.lifecycle.entries[0]).toMatchObject({enabled:true,authority:'absent'})
    expect(await readFile(filename,'utf8')).toBe(before)
    await cell.activation!.activate({...activationInput(cell),enabled:false},signal())
    expect((await (await observe()).json()).data.lifecycle.entries[0]).toMatchObject({enabled:false,authority:'absent'})
    const audit=await owner`select * from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.connector.activation.read' and outcome='succeeded'`
    expect(audit).toHaveLength(4);expect(audit.every(row=>row.reason===input.reason&&row.target_id===cell.member.userId)).toBe(true)
    expect(JSON.stringify([active,audit])).not.toMatch(/paimindVersionKey|actual-diagnostic|"args"|"env"|"headers"/u)
  })
  it('activation observation denies member and foreign targets, invalid confirmation and secret-bearing native replies',async()=>{
    const f=await fixture(),foreign=await fixture(),input={targetUserId:f.cells[0]!.member.userId,reason:'核对连接器状态',confirmed:true}
    const member=await f.identity.login({username:'hansen',password:f.password},context()),before=f.received.length
    expect((await f.post(input,member.token,randomUUID(),'/connector-activation-state')).status).toBe(403)
    expect((await f.post({...input,targetUserId:foreign.cells[0]!.member.userId},f.admin.token,randomUUID(),'/connector-activation-state')).status).toBe(404)
    expect((await f.post({...input,confirmed:false},f.admin.token,randomUUID(),'/connector-activation-state')).status).toBe(400)
    expect(f.received).toHaveLength(before)
    f.hooks.after=async(op,value)=>op==='connector.activation-state'?{...value,config:'SYNTHETIC_PRIVATE_REPLY'}:value
    const response=await f.post(input,f.admin.token,randomUUID(),'/connector-activation-state')
    expect(response.status).toBe(502);expect(await response.text()).not.toContain('SYNTHETIC_PRIVATE_REPLY')
    expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.connector.activation.read' and outcome='succeeded'`).toHaveLength(0)
  })
  it.each(['logout','binding'] as const)('activation observation rechecks %s after native I/O before disclosing a snapshot',async change=>{
    const f=await fixture(),input={targetUserId:f.cells[0]!.member.userId,reason:'核对连接器状态',confirmed:true}
    f.hooks.after=async(op,value)=>{if(op==='connector.activation-state'){
      if(change==='logout')await f.identity.logout(f.admin.token,{},context())
      else await owner`update haas.runtime_bindings set revision=${randomUUID()} where cell_id=${f.cells[0]!.pin.cellId}`
    }return value}
    const response=await f.post(input,f.admin.token,randomUUID(),'/connector-activation-state')
    expect(response.status).toBeGreaterThanOrEqual(400);expect(await response.text()).not.toContain('paimind.connector-observation/v1')
    expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.connector.activation.read' and outcome='succeeded'`).toHaveLength(0)
  })
  it.each(['authorized','read'] as const)('activation observation withholds data when the %s audit cannot commit',async phase=>{
    const f=await fixture(),input={targetUserId:f.cells[0]!.member.userId,reason:'核对连接器状态',confirmed:true}
    const action=phase==='authorized'?'runtime.connector.command.authorized':'runtime.connector.activation.read'
    await owner.unsafe(`create function haas.reject_connector_observation_audit() returns trigger language plpgsql as $$ begin if NEW.tenant_id='${f.tenantId}' and NEW.action='${action}' and NEW.outcome='succeeded' then raise exception 'explicit observation audit fault'; end if; return NEW; end $$`)
    await owner`create trigger reject_connector_observation_audit before insert on haas.audit_events for each row execute function haas.reject_connector_observation_audit()`
    try{
      const response=await f.post(input,f.admin.token,randomUUID(),'/connector-activation-state')
      expect(response.status).toBe(503);expect(await response.text()).not.toContain('paimind.connector-observation/v1')
      expect(f.received.filter(row=>row.op==='connector.activation-state')).toHaveLength(phase==='authorized'?0:1)
      expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action=${action} and outcome='succeeded'`).toHaveLength(0)
    }finally{await owner`drop trigger reject_connector_observation_audit on haas.audit_events`;await owner`drop function haas.reject_connector_observation_audit()`}
  })
  it('live native connector executes for two independently approved members, then denies revoked use and unloads only that member',async()=>{
    const f=await authorityFixture(true),hansen=f.cells[0]!,alex=f.cells[1]!
    expect((await f.post(f.input(1,{kind:'upsert',entryId:'sales',configuration:localConnector(alex.home)}))).status).toBe(200)
    expect((await decide(f,{...approvalInput(f),targetUserId:alex.member.userId,expectedCellRevision:alex.pin.revision,expectedConfigurationRevision:alex.configuration.read(signal()).revision})).status).toBe(200)
    await hansen.activation!.activate(activationInput(hansen),signal());await alex.activation!.activate(activationInput(alex),signal())
    const h=await nativeUse(f,0),a=await nativeUse(f,1)
    expect((await h.run()).isError).toBe(false);expect((await a.run()).isError).toBe(false)
    expect((await decide(f,revokeInput(f))).status).toBe(200)
    expect((await h.run()).isError).toBe(true)
    await vi.waitFor(()=>expect(hansen.native.tools.get('mcp__sales__echo')).toBeUndefined(),{timeout:5000})
    expect((await a.run()).isError).toBe(false)
    await f.identity.logout(a.login.token,{},context());expect((await a.run()).isError).toBe(true)
    expect(alex.configuration.activationState(signal()).entries[0]?.authority).toBe('live')
  })
  it('live native connector restores existing intent through the real private control path only while exact DB approval is current',async()=>{
    const f=await authorityFixture(true),cell=f.cells[0]!
    await cell.activation!.activate(activationInput(cell),signal());const bytes=await readFile(join(cell.home,'.enterprise-connectors/cordis.json'),'utf8')
    await cell.activation!.withdraw('sales');expect(cell.native.tools.get('mcp__sales__echo')).toBeUndefined()
    expect(await cell.transport.requestControl('connector.restore',{})).toEqual({restored:['sales'],pending:[]})
    const h=await nativeUse(f,0);expect((await h.run()).isError).toBe(false)
    expect(await cell.transport.requestControl('connector.restore',{})).toEqual({restored:['sales'],pending:[]})
    expect((await decide(f,revokeInput(f))).status).toBe(200);await cell.activation!.withdraw('sales')
    expect(await cell.transport.requestControl('connector.restore',{})).toEqual({restored:[],pending:['sales']})
    expect(cell.native.tools.get('mcp__sales__echo')).toBeUndefined();expect(await readFile(join(cell.home,'.enterprise-connectors/cordis.json'),'utf8')).toBe(bytes)
  })
  it('current connector authority crosses the real reverse chain and never substitutes an approval read for current login', async () => {
    const f=await authorityFixture(), peer=f.peers[0]!, use=await f.execution()
    expect(await peer.readConnectorApproval(f.approval())).toBe(1)
    await expect(peer.authorizeConnectorExecution(use.input)).resolves.toBeUndefined()
    await f.identity.logout(use.login.token,{},context())
    expect(await peer.readConnectorApproval(f.approval(1))).toBe(1)
    await expect(peer.authorizeConnectorExecution(use.input)).rejects.toThrow()
    const fresh=await f.execution();await expect(peer.authorizeConnectorExecution(fresh.input)).resolves.toBeUndefined()
  })
  it('current connector authority rejects cross member, tenant, session and invented approval scope', async () => {
    const f=await authorityFixture(), other=await authorityFixture(), use=await f.execution()
    await expect(f.peers[1]!.readConnectorApproval(f.approval())).rejects.toThrow()
    await expect(other.peers[0]!.readConnectorApproval(f.approval())).rejects.toThrow()
    await expect(f.peers[1]!.authorizeConnectorExecution(use.input)).rejects.toThrow()
    const foreign=await other.execution(), alex=await f.execution(1)
    for(const execution of [foreign.input.execution,alex.input.execution,{...use.input.execution,nativeSessionId:'different-session'}])
      await expect(f.peers[0]!.authorizeConnectorExecution({...use.input,execution})).rejects.toThrow()
    for(const patch of [{entryId:'another'},{configurationVersion:'f'.repeat(64)},{serverName:'other'},{transport:'stdio'}])
      await expect(f.peers[0]!.readConnectorApproval({...f.approval(),reference:{...f.reference,...patch} as NativeConnectorReleaseReference})).rejects.toThrow()
    await expect(f.peers[0]!.readConnectorApproval({...f.approval(),tenantId:f.tenantId} as any)).rejects.toThrow()
    expect(await f.peers[0]!.readConnectorApproval(f.approval())).toBe(1)
  })
  it('current connector authority denies revoked and superseded approval revisions after a previous successful check', async () => {
    const f=await authorityFixture(), peer=f.peers[0]!, use=await f.execution()
    expect(await peer.readConnectorApproval(f.approval(1))).toBe(1)
    expect((await decide(f,revokeInput(f))).status).toBe(200)
    await expect(peer.readConnectorApproval(f.approval())).rejects.toThrow()
    await expect(peer.authorizeConnectorExecution(use.input)).rejects.toThrow()
    expect((await decide(f,approvalInput(f,2))).status).toBe(200)
    expect(await peer.readConnectorApproval(f.approval())).toBe(3)
    await expect(peer.readConnectorApproval(f.approval(1))).rejects.toThrow()
    await expect(peer.authorizeConnectorExecution(use.input)).rejects.toThrow()
    await expect(peer.authorizeConnectorExecution({...use.input,approvalRevision:3})).resolves.toBeUndefined()
  })
  it.each(['member','tenant','lease','container','image','volume','policy','revision'] as const)('current connector authority fails closed after %s admission changes',async change=>{
    const f=await authorityFixture(),peer=f.peers[0]!,use=await f.execution(),pin=f.cells[0]!.pin
    if(change==='member')await f.identity.setMemberStatus(f.admin.token,pin.userId,{status:'disabled',reason:'停止成员运行权限'},context())
    else if(change==='tenant')await owner`update haas.tenants set status='disabled' where tenant_id=${f.tenantId}`
    else if(change==='lease')await owner`update haas.runtime_bindings set lease_expires_at=clock_timestamp()-interval '1 second' where cell_id=${pin.cellId}`
    else if(change==='container')await owner`update haas.runtime_bindings set container_id=${randomBytes(32).toString('hex')} where cell_id=${pin.cellId}`
    else if(change==='image')await owner`update haas.runtime_bindings set image_id=${'sha256:'+'a'.repeat(64)} where cell_id=${pin.cellId}`
    else if(change==='volume')await owner`update haas.runtime_bindings set volume_name=${'paimind-haas-member-'+randomUUID()} where cell_id=${pin.cellId}`
    else if(change==='policy')await owner`update haas.runtime_bindings set policy_digest=${'sha256:'+'a'.repeat(64)} where cell_id=${pin.cellId}`
    else await owner`update haas.runtime_bindings set revision=${randomUUID()} where cell_id=${pin.cellId}`
    await expect(peer.readConnectorApproval(f.approval())).rejects.toThrow()
    await expect(peer.authorizeConnectorExecution(use.input)).rejects.toThrow()
  })
  it('current connector authority retains other members on cancellation and fails closed when gateway transport closes',async()=>{
    const f=await authorityFixture(),peer=f.peers[0]!,use=await f.execution(),cancel=new AbortController();cancel.abort()
    expect((await f.post(f.input(1))).status).toBe(200)
    const alex=f.cells[1]!,revision=alex.configuration.read(signal()).revision
    expect((await decide(f,{...approvalInput(f),targetUserId:alex.member.userId,expectedCellRevision:alex.pin.revision,expectedConfigurationRevision:revision})).status).toBe(200)
    const reference=alex.configuration.release({entryId:'sales',expectedRevision:revision},signal()).reference!
    await expect(peer.readConnectorApproval(f.approval(),cancel.signal)).rejects.toThrow()
    await expect(peer.authorizeConnectorExecution(use.input,cancel.signal)).rejects.toThrow()
    expect(await peer.readConnectorApproval(f.approval())).toBe(1)
    f.cells[0]!.transport.destroy()
    await expect(peer.readConnectorApproval(f.approval())).rejects.toThrow()
    await expect(peer.authorizeConnectorExecution(use.input)).rejects.toThrow()
    expect(await f.peers[1]!.readConnectorApproval({reference,expectedApprovalRevision:1})).toBe(1)
    await expect(f.peers[1]!.authorizeConnectorExecution({... (await f.execution(1)).input,reference})).resolves.toBeUndefined()
  })
  it('current connector authority refuses a new unapproved native version and any uncertain configuration command',async()=>{
    const f=await authorityFixture(),peer=f.peers[0]!,use=await f.execution()
    expect((await f.post(f.input(0,{kind:'upsert',entryId:'sales',configuration:connector('renamed')}))).status).toBe(200)
    const state=f.cells[0]!.configuration.read(signal()),reference=f.cells[0]!.configuration.release({entryId:'sales',expectedRevision:state.revision},signal()).reference!
    expect(reference.configurationVersion).not.toBe(f.reference.configurationVersion)
    await expect(peer.readConnectorApproval({reference,expectedApprovalRevision:null})).rejects.toThrow()
    await expect(peer.authorizeConnectorExecution({...use.input,reference})).rejects.toThrow()
    // Native owner must use its actual reference, not the historical old wire
    // reference. A lost write ack additionally denies all uses until resolved.
    f.hooks.after=async(op,value)=>{if(op==='connector.configure')throw Error('Explicit uncertain configuration');return value}
    expect((await f.post(f.input(0,{kind:'upsert',entryId:'another',configuration:connector('another')}))).status).toBe(202)
    expect(await owner`select 1 from haas.connector_commands where tenant_id=${f.tenantId} and outcome='unconfirmed'`).toHaveLength(1)
    await expect(peer.readConnectorApproval(f.approval())).rejects.toThrow()
    await expect(peer.authorizeConnectorExecution(use.input)).rejects.toThrow()
  })
  it('current connector authority cannot override missing enterprise publication or Skill authorization',async()=>{
    const f=await authorityFixture(),peer=f.peers[0]!,use=await f.execution(),publicationId=randomUUID()
    const publication={tenantId:f.tenantId,sourceUserId:f.admin.data.userId,publicationId,contentDigest:'sha256:'+'b'.repeat(64)}
    const skill={tenantId:f.tenantId,sourceUserId:f.admin.data.userId,publicationId:randomUUID(),name:'customer-notes',
      packageDigest:'sha256:'+'b'.repeat(64),archiveDigest:'sha256:'+'c'.repeat(64),archiveBytes:16,expandedBytes:8,entryCount:1}
    expect(await peer.readConnectorApproval(f.approval())).toBe(1)
    await expect(peer.authorizeConnectorExecution({...use.input,execution:{...use.input.execution,publication,presetId:'paimind-enterprise-'+publicationId.replaceAll('-','')}})).rejects.toThrow()
    await expect(peer.authorizeConnectorExecution({...use.input,execution:{...use.input.execution,skills:[skill]}})).rejects.toThrow()
    await expect(peer.authorizeConnectorExecution(use.input)).resolves.toBeUndefined()
  })
  it('approves the exact native version and persistent runtime scope atomically, with audited idempotent replay and no activation', async () => {
    const f = await fixture(); expect((await f.post(f.input())).status).toBe(200)
    const empty = await f.post(approvalState(f), f.admin.token, randomUUID(), '/connector-approval-state')
    expect((await empty.json()).data).toMatchObject({ approval: null, observation: 'stored-only' })
    const input = approvalInput(f), key = randomUUID(), cell = f.cells[0]!, before = await readFile(join(cell.home,'.enterprise-connectors/cordis.json'),'utf8')
    const release = cell.configuration.release({ entryId:'sales', expectedRevision:input.expectedConfigurationRevision },signal())
    const response = await decide(f,input,key); expect(response.status).toBe(200); const result = await response.json()
    expect(result).toMatchObject({replayed:false,data:{decision:'approved',revision:1,configurationVersion:release.reference?.configurationVersion,
      imageId:cell.pin.imageId,policyDigest:cell.pin.policyDigest,historicalRecord:true,runtimeGrant:false,activation:'not-observed'}})
    const [row] = await owner`select * from haas.connector_approvals where tenant_id=${f.tenantId}`
    expect(row).toMatchObject({target_user_id:cell.member.userId,cell_id:cell.pin.cellId,volume_name:cell.pin.volumeName,image_id:cell.pin.imageId,policy_digest:cell.pin.policyDigest})
    const audit = await owner`select * from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.connector.approval' and outcome='succeeded'`
    expect(audit).toHaveLength(1)
    expect(JSON.stringify([result,row,audit])).not.toMatch(/SYNTHETIC|example\.invalid|headers|paimindVersionKey/u)
    expect(JSON.stringify([result,row,audit])).not.toContain(JSON.parse(before)[0].paimindVersionKey)
    expect(await readFile(join(cell.home,'.enterprise-connectors/cordis.json'),'utf8')).toBe(before)
    expect(cell.configuration.read(signal()).entries[0]?.enabled).toBe(false)
    const calls = f.received.length; f.restartGateway()
    const replay = await (await decide(f,input,key)).json();expect(replay).toMatchObject({operationId:result.operationId,replayed:true,data:result.data})
    expect(f.received).toHaveLength(calls)
    expect((await decide(f,{...input,reason:'改用不同批准原因'},key)).status).toBe(409)
    await f.replace();const recovered = await (await decide(f,input,key)).json()
    expect(recovered).toMatchObject({operationId:result.operationId,replayed:true,data:result.data})
  })
  it('revokes and reads stored approval with a disabled member, deleted config and offline ingress; stale approval replay cannot revive it', async () => {
    const f = await fixture();await f.post(f.input());const approve = approvalInput(f), key = randomUUID()
    expect((await decide(f,approve,key)).status).toBe(200)
    expect((await f.post(f.input(0,{kind:'remove',entryId:'sales'}))).status).toBe(200)
    await f.identity.setMemberStatus(f.admin.token,f.cells[0]!.member.userId,{status:'disabled',reason:'停止成员授权使用'},context())
    await f.cells[0]!.ingress.close();const calls=f.received.length,revokeKey=randomUUID()
    const response=await decide(f,revokeInput(f),revokeKey);expect(response.status).toBe(200)
    const revoked=await response.json();expect(revoked.data).toMatchObject({decision:'revoked',revision:2,runtimeGrant:false,activation:'not-observed'})
    expect((await (await decide(f,revokeInput(f),revokeKey)).json()).replayed).toBe(true)
    const state=await f.post(approvalState(f),f.admin.token,randomUUID(),'/connector-approval-state')
    expect((await state.json()).data.approval).toEqual(revoked.data);expect(f.received).toHaveLength(calls)
    expect((await decide(f,approve,key)).status).toBe(409)
  })
  it('denies member accounts and foreign tenant/member targets before private release I/O', async () => {
    const f=await fixture(),foreign=await fixture();await f.post(f.input());const calls=f.received.length
    for(const username of ['hansen','alex']){
      const login=await f.identity.login({username,password:f.password},context())
      expect((await decide(f,approvalInput(f),randomUUID(),login.token)).status).toBe(403)
      expect((await f.post(approvalState(f),login.token,randomUUID(),'/connector-approval-state')).status).toBe(403)
    }
    const targetUserId=foreign.cells[0]!.member.userId
    expect((await decide(f,{...approvalInput(f),targetUserId})).status).toBe(404)
    expect((await decide(f,{...revokeInput(f),targetUserId})).status).toBe(404)
    expect((await f.post({...approvalState(f),targetUserId},f.admin.token,randomUUID(),'/connector-approval-state')).status).toBe(404)
    expect(f.received).toHaveLength(calls)
  })
  it('rejects stale pins/config/approval revisions and caller-invented identity or permission fields', async () => {
    const f=await fixture();await f.post(f.input());const input=approvalInput(f)
    for(const patch of [{expectedCellRevision:randomUUID()},{expectedConfigurationRevision:'a'.repeat(64)},{expectedApprovalRevision:1}]){
      expect((await decide(f,{...input,...patch})).status).toBe(409)
    }
    const calls=f.received.length
    for(const patch of [{confirmed:false},{configurationVersion:'a'.repeat(64)},{imageId:f.cells[0]!.pin.imageId},{expectedApprovalRevision:-1},{decision:'enabled'}]){
      expect((await decide(f,{...input,...patch})).status).toBe(400)
    }
    expect(f.received).toHaveLength(calls);expect(await owner`select 1 from haas.connector_approvals where tenant_id=${f.tenantId}`).toHaveLength(0)
  })
  it('serializes concurrent identical and competing approval decisions without duplicate success audit or revision jumps', async () => {
    const f=await fixture();await f.post(f.input());const input=approvalInput(f),key=randomUUID()
    const responses=await Promise.all([decide(f,input,key),decide(f,input,key)]);expect(responses.map(r=>r.status)).toEqual([200,200])
    const results=await Promise.all(responses.map(r=>r.json()));expect(results.map(r=>r.replayed).sort()).toEqual([false,true])
    expect(new Set(results.map(r=>r.operationId)).size).toBe(1)
    const competing=await Promise.all([decide(f,approvalInput(f,1)),decide(f,approvalInput(f,1))])
    expect(competing.map(r=>r.status).sort()).toEqual([200,409])
    const [row]=await owner`select revision from haas.connector_approvals where tenant_id=${f.tenantId}`;expect(row!.revision).toBe(2)
    expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.connector.approval' and outcome='succeeded'`).toHaveLength(2)
  })
  it('does not overwrite a revocation committed while the native version read was in flight', async () => {
    const f=await fixture();await f.post(f.input());await decide(f,approvalInput(f))
    f.hooks.after=async(op,value)=>{if(op==='connector.release')expect((await decide(f,revokeInput(f))).status).toBe(200);return value}
    expect((await decide(f,approvalInput(f,1))).status).toBe(409)
    const [row]=await owner`select decision,revision from haas.connector_approvals where tenant_id=${f.tenantId}`;expect(row).toMatchObject({decision:'revoked',revision:2})
  })
  it.each(['logout','binding'] as const)('rechecks %s after the original owner read, without storing a successful approval', async phase => {
    const f=await fixture();await f.post(f.input());const input=approvalInput(f)
    f.hooks.after=async(op,value)=>{if(op==='connector.release'){
      if(phase==='logout')await f.identity.logout(f.admin.token,{},context())
      else await owner`update haas.runtime_bindings set revision=${randomUUID()} where cell_id=${f.cells[0]!.pin.cellId}`
    }return value}
    expect([401,409,503]).toContain((await decide(f,input)).status)
    expect(await owner`select 1 from haas.connector_approvals where tenant_id=${f.tenantId}`).toHaveLength(0)
  })
  it('requires a real versioned record and rejects approval while a configuration command remains uncertain', async () => {
    const f=await fixture();expect((await decide(f,approvalInput(f))).status).toBe(409)
    f.hooks.after=async(op,value)=>{if(op==='connector.configure')throw Error('Synthetic missing acknowledgement');return value}
    expect((await f.post(f.input())).status).toBe(202);delete f.hooks.after
    const calls=f.received.length;expect((await decide(f,approvalInput(f))).status).toBe(409);expect(f.received).toHaveLength(calls)
  })
  it.each(['approved','revoked'] as const)('rolls back the %s decision if its success audit cannot commit', async decision => {
    const f=await fixture();await f.post(f.input());if(decision==='revoked')await decide(f,approvalInput(f))
    await owner.unsafe(`create function haas.reject_connector_approval_audit() returns trigger language plpgsql as $$ begin if NEW.tenant_id='${f.tenantId}' and NEW.action='runtime.connector.approval' and NEW.outcome='succeeded' then raise exception 'explicit approval audit fault'; end if; return NEW; end $$`)
    await owner.unsafe('create trigger reject_connector_approval_audit before insert on haas.audit_events for each row execute function haas.reject_connector_approval_audit()')
    try{
      expect((await decide(f,decision==='approved'?approvalInput(f):revokeInput(f))).status).toBe(503)
      const rows=await owner`select decision,revision from haas.connector_approvals where tenant_id=${f.tenantId}`
      expect(rows).toEqual(decision==='approved'?[]:[{decision:'approved',revision:1}])
    }finally{await owner.unsafe('drop trigger reject_connector_approval_audit on haas.audit_events; drop function haas.reject_connector_approval_audit()')}
  })
  it('retains approval identity and exact withdrawn references under restricted database grants', async()=>{
    const f=await fixture();await f.post(f.input());await decide(f,approvalInput(f))
    await expect(sql`delete from haas.connector_approvals where tenant_id=${f.tenantId}`).rejects.toThrow(/permission denied/u)
    await expect(sql`update haas.connector_approvals set entry_id='other' where tenant_id=${f.tenantId}`).rejects.toThrow(/permission denied/u)
    await expect(sql`update haas.connector_approvals set decision='revoked' where tenant_id=${f.tenantId}`).rejects.toThrow(/identity and revision/u)
    await expect(sql`update haas.connector_approvals set decision='revoked',revision=revision+1,configuration_version=${'f'.repeat(64)} where tenant_id=${f.tenantId}`).rejects.toThrow(/identity and revision/u)
    expect((await decide(f,revokeInput(f))).status).toBe(200)
  })
  it('denies and audits an actual retained legacy unversioned record without modifying it, then accepts explicit full replacement', async () => {
    const f = await fixture(); await f.post(f.input())
    const file = join(f.cells[0]!.home, '.enterprise-connectors/cordis.json')
    await f.cells[0]!.native.fiber.dispose()
    const rows = JSON.parse(await readFile(file, 'utf8')); delete rows[0].paimindVersionKey
    const bytes = JSON.stringify(rows); await writeFile(file, bytes, { mode: 0o600 }); await f.replace()
    const denied = await decide(f, approvalInput(f)); expect(denied.status).toBe(409)
    expect((await denied.json()).code).toBe('connector-version-required')
    expect(await readFile(file, 'utf8')).toBe(bytes)
    expect(await owner`select 1 from haas.connector_approvals where tenant_id=${f.tenantId}`).toHaveLength(0)
    expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.connector.approval' and outcome='denied' and reason='connector-version-required'`).toHaveLength(1)
    expect((await f.post(f.input())).status).toBe(200)
    expect((await decide(f, approvalInput(f))).status).toBe(200)
  })
  it('denies malformed private release evidence with a sanitized audit and no approval or leaked secret', async () => {
    const f = await fixture(); await f.post(f.input())
    f.hooks.after = async (op, value) => op === 'connector.release' ? { ...value, secret: 'SYNTHETIC_PRIVATE_RELEASE' } : value
    const response = await decide(f, approvalInput(f)); expect(response.status).toBe(502)
    const audit = await owner`select * from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.connector.approval'`
    expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ outcome: 'denied', reason: 'connector-configuration-unavailable' })
    expect(JSON.stringify([await response.json(), audit])).not.toContain('SYNTHETIC_PRIVATE_RELEASE')
    expect(await owner`select 1 from haas.connector_approvals where tenant_id=${f.tenantId}`).toHaveLength(0)
  })
  it('cancels an in-flight approval read on manager unload without creating an approval or success receipt', async () => {
    const f = await fixture(); await f.post(f.input()); let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    f.hooks.before = async op => { if (op === 'connector.release') await waiting }
    const pending = f.options.connectorManagement.decideApproval(f.admin.token, approvalInput(f), context(), signal())
    const denied = expect(pending).rejects.toBeDefined()
    try {
      await vi.waitFor(() => expect(f.received.some(call => call.op === 'connector.release')).toBe(true))
      f.options.connectorManagement.close()
    } finally { release(); await denied }
    expect(await owner`select 1 from haas.connector_approvals where tenant_id=${f.tenantId}`).toHaveLength(0)
    expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.connector.approval' and outcome='succeeded'`).toHaveLength(0)
  })
  it('retains exact release identity through an admitted replacement without exposing the private version key to commands, audit or old configuration clients', async () => {
    const f = await fixture(), response = await f.post(f.input())
    expect(response.status).toBe(200)
    const body = await response.json(), cell = f.cells[0]!
    const before = await cell.transport.requestControl('connector.release', {entryId:'sales',expectedRevision:cell.configuration.read(signal()).revision}) as any
    expect(before.outcome).toBe('current')
    const bytes = await readFile(join(cell.home,'.enterprise-connectors/cordis.json'),'utf8'), key = JSON.parse(bytes)[0].paimindVersionKey
    expect(key).toMatch(/^[a-f0-9]{64}$/u);expect(JSON.stringify(body)).not.toContain(key)
    await f.replace()
    const after = await cell.transport.requestControl('connector.release', {entryId:'sales',expectedRevision:cell.configuration.read(signal()).revision}) as any
    expect(after.reference).toEqual(before.reference);expect(after.revision).not.toBe(before.revision)
    expect(await readFile(join(cell.home,'.enterprise-connectors/cordis.json'),'utf8')).toBe(bytes)
    const records = await owner`select row_to_json(c)::text as value from haas.connector_commands c where tenant_id=${f.tenantId}`
    const audit = await owner`select row_to_json(a)::text as value from haas.audit_events a where tenant_id=${f.tenantId}`
    expect(JSON.stringify([records,audit])).not.toContain(key)
    expect(cell.configuration.read(signal()).entries[0]?.enabled).toBe(false)
    const sibling = f.cells[1]!
    expect(await sibling.transport.requestControl('connector.release', {entryId:'sales',expectedRevision:sibling.configuration.read(signal()).revision})).toMatchObject({outcome:'missing',reference:null})
  })
  it('saves exactly once, audits before sending, persists privately, redacts secrets and replays after gateway recreation without I/O', async () => {
    const f = await fixture(), input = f.input(), key = randomUUID()
    f.hooks.before = async op => { if (op !== 'connector.configure') return
      expect(await owner`select 1 from haas.connector_commands where tenant_id=${f.tenantId} and outcome='unconfirmed'`).toHaveLength(1)
      expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.connector.requested' and outcome='succeeded'`).toHaveLength(1)
    }
    const response = await f.post(input, f.admin.token, key); expect(response.status).toBe(200)
    const result = (await response.json()).data
    expect(result).toMatchObject({ outcome: 'saved-disabled', runtimeGrant: false, confirmation: { activation: 'not-authorized', configuration: { entries: [{ entryId: 'sales', enabled: false }] } } })
    const file = join(f.cells[0]!.home, '.enterprise-connectors/cordis.json')
    expect(await readFile(file, 'utf8')).toContain('SYNTHETIC_CONNECTOR_SECRET'); expect(statSync(file).mode & 0o077).toBe(0)
    expect(f.cells[1]!.configuration.read(signal()).entries).toEqual([])
    const records = await owner`select * from haas.connector_commands where tenant_id=${f.tenantId}`, audit = await owner`select * from haas.audit_events where tenant_id=${f.tenantId}`
    for (const value of [result, records, audit]) expect(JSON.stringify(value)).not.toMatch(/SYNTHETIC_CONNECTOR_SECRET|example\.invalid|"headers"|"configuration":\{"transport"/u)
    const calls = f.received.length; f.restartGateway()
    expect((await (await f.post(input, f.admin.token, key)).json()).data).toEqual(result)
    expect((await (await f.get(result.commandId)).json()).data).toEqual(result)
    expect(f.received).toHaveLength(calls); expect(f.writes()).toHaveLength(1)
    await expect(sql`update haas.connector_commands set outcome='conflict' where tenant_id=${f.tenantId}`).rejects.toThrow(/immutable/u)
    await expect(sql`delete from haas.connector_commands where tenant_id=${f.tenantId}`).rejects.toThrow(/permission denied/u)
  })
  it('edits, returns unchanged and removes without modifying the other member or activating native entries', async () => {
    const f = await fixture()
    for (const change of [undefined, { kind: 'upsert', entryId: 'sales', configuration: { ...connector(), url: 'https://example.invalid/edited' } },
      { kind: 'upsert', entryId: 'sales', configuration: { ...connector(), url: 'https://example.invalid/edited' } }, { kind: 'remove', entryId: 'sales' }]) {
      const r = await f.post(f.input(0, change)); expect(r.status).toBe(200)
      const result = (await r.json()).data; expect(['saved-disabled', 'unchanged']).toContain(result.outcome)
      expect(f.cells[1]!.configuration.read(signal()).entries).toEqual([])
    }
    expect(f.cells[0]!.configuration.read(signal()).entries).toEqual([])
    const state = await f.post({ targetUserId: f.cells[0]!.member.userId, reason: '核对停用配置', confirmed: true }, f.admin.token, randomUUID(), '/connector-configuration')
    expect(state.status).toBe(200); expect((await state.json()).data.configuration.entries).toEqual([])
  })
  it('rejects stale revisions, unapproved activation and invalid native syntax before reserving a command', async () => {
    const f = await fixture()
    expect((await f.post({ ...f.input(), expectedConfigurationRevision: 'f'.repeat(64) })).status).toBe(409)
    expect((await f.post(f.input(0, { kind: 'enable', entryId: 'sales' }))).status).toBe(400)
    const invalid = await f.post(f.input(0, { kind: 'upsert', entryId: 'sales', configuration: { ...connector(), url: 'file:///private' } }))
    expect(invalid.status).toBe(502); expect(await invalid.text()).not.toContain('/private')
    expect(await owner`select 1 from haas.connector_commands where tenant_id=${f.tenantId}`).toHaveLength(0); expect(f.writes()).toHaveLength(0)
  })
  it('uses a keyed full-payload digest: same key with changed secret conflicts without native I/O', async () => {
    const f = await fixture(), input = f.input(), key = randomUUID()
    expect((await f.post(input, f.admin.token, key)).status).toBe(200)
    const calls = f.received.length
    expect((await f.post({ ...input, change: { kind: 'upsert', entryId: 'sales', configuration: { ...connector(), headers: { Authorization: 'CHANGED_SYNTHETIC_SECRET' } } } }, f.admin.token, key)).status).toBe(409)
    expect(f.received).toHaveLength(calls)
  })
  it('rejects the native-invalid zero reconnect count before reservation, then accepts an explicit valid correction', async () => {
    const f = await fixture(), key = randomUUID(), filename = join(f.cells[0]!.home, '.enterprise-connectors/cordis.json')
    const before = await readFile(filename, 'utf8'), invalid = connector()
    invalid.reconnect.maxAttempts = 0
    const result = await f.post(f.input(0, { kind: 'upsert', entryId: 'sales', configuration: invalid }), f.admin.token, key)
    expect(result.status).toBe(502); expect(await result.text()).not.toContain('SYNTHETIC_CONNECTOR_SECRET')
    expect(await readFile(filename, 'utf8')).toBe(before)
    expect(await owner`select 1 from haas.connector_commands where tenant_id=${f.tenantId}`).toHaveLength(0)
    expect(f.writes()).toHaveLength(0)
    const corrected = await f.post(f.input(), f.admin.token, key)
    expect(corrected.status).toBe(200); expect((await corrected.json()).data.outcome).toBe('saved-disabled')
    expect(f.writes()).toHaveLength(1)
  })
  it('denies both members, known receipts and foreign tenant targets before private I/O', async () => {
    const f = await fixture(), other = await fixture()
    const result = (await (await f.post(f.input())).json()).data, count = f.received.length
    for (const username of ['hansen','alex']) {
      const login = await f.identity.login({ username, password: f.password }, context())
      expect((await f.post(f.input(), login.token)).status).toBe(403)
      expect((await f.get(result.commandId, login.token)).status).toBe(403)
      expect((await f.post({ targetUserId: f.cells[0]!.member.userId }, login.token, randomUUID(), '/connector-command-state')).status).toBe(403)
    }
    expect((await f.post({ ...f.input(), targetUserId: other.cells[0]!.member.userId })).status).toBe(404)
    expect((await other.get(result.commandId)).status).toBe(404); expect(f.received).toHaveLength(count)
  })
  it.each(['preparation','write'])('revalidates logout after native %s and never returns a successful receipt', async phase => {
    const f = await fixture()
    f.hooks.after = async (op, value) => { if (op === (phase === 'preparation' ? 'connector.prepare' : 'connector.configure')) await f.identity.logout(f.admin.token, {}, context()); return value }
    expect((await f.post(f.input())).status).toBe(401); expect(f.writes()).toHaveLength(phase === 'preparation' ? 0 : 1)
    const rows = await owner`select outcome from haas.connector_commands where tenant_id=${f.tenantId}`
    expect(rows).toHaveLength(phase === 'preparation' ? 0 : 1); if (rows.length) expect(rows[0]!.outcome).toBe('unconfirmed')
  })
  it('rechecks the optimistic revision at dispatch and records a conflict without overwriting another native write', async () => {
    const f = await fixture()
    f.hooks.before = async op => { if (op === 'connector.configure') await f.cells[0]!.configuration.configure({ kind: 'upsert', entryId: 'other', configuration: connector('other'), expectedRevision: f.cells[0]!.configuration.read(signal()).revision }, signal()) }
    const r = await f.post(f.input()); expect(r.status).toBe(200); expect((await r.json()).data.outcome).toBe('conflict')
    expect(f.cells[0]!.configuration.read(signal()).entries.map(e => e.entryId)).toEqual(['other'])
  })
  it('keeps a lost acknowledgement unconfirmed; replay/recreation/readback do not resend or infer secret success', async () => {
    const f = await fixture(), input = f.input(), key = randomUUID()
    f.hooks.after = async (op, value) => { if (op === 'connector.configure') throw Error('Synthetic lost acknowledgement'); return value }
    const r = await f.post(input, f.admin.token, key); expect(r.status).toBe(202)
    const receipt = (await r.json()).data; expect(receipt.outcome).toBe('unconfirmed')
    expect(f.cells[0]!.configuration.read(signal()).entries).toHaveLength(1)
    f.restartGateway(); f.hooks.after = undefined
    const calls = f.received.length
    expect((await (await f.post(input, f.admin.token, key)).json()).data).toEqual(receipt)
    expect((await f.post(f.input())).status).toBe(409)
    expect((await (await f.post({ targetUserId: input.targetUserId }, f.admin.token, randomUUID(), '/connector-command-state')).json()).data.command).toEqual(receipt)
    expect(f.received).toHaveLength(calls); expect(f.writes()).toHaveLength(1)
  })
  it('resolves unknown effects only after an exact replacement; native file survives and old command is never resent', async () => {
    const f = await fixture(), input = f.input(), key = randomUUID()
    f.hooks.after = async (op, value) => { if (op === 'connector.configure') throw Error('Synthetic lost acknowledgement'); return value }
    const receipt = (await (await f.post(input, f.admin.token, key)).json()).data
    f.hooks.after = undefined
    const resolve = () => f.post({ expectedCellRevision: f.cells[0]!.pin.revision, reason: '确认替换后保留未知历史效果', confirmed: true }, f.admin.token, randomUUID(), `/connector-commands/${receipt.commandId}/resolve`)
    expect((await resolve()).status).toBe(409)
    const filename = join(f.cells[0]!.home, '.enterprise-connectors/cordis.json'), before = await readFile(filename, 'utf8')
    await f.replace(); expect(await readFile(filename, 'utf8')).toBe(before)
    const r = await resolve(); expect(r.status).toBe(200); expect((await r.json()).data).toMatchObject({ outcome: 'superseded', confirmation: { effect: 'unknown' } })
    expect((await (await f.post(input, f.admin.token, key)).json()).data.outcome).toBe('superseded')
    expect(f.writes()).toHaveLength(1)
  })
  it('reserves at most one sender for concurrent identical submissions', async () => {
    const f = await fixture(), input = f.input(), key = randomUUID()
    const responses = await Promise.all([f.post(input, f.admin.token, key), f.post(input, f.admin.token, key)])
    expect(responses.every(r => [200,202].includes(r.status))).toBe(true)
    const values = await Promise.all(responses.map(r => r.json()))
    expect(values[0].data.commandId).toBe(values[1].data.commandId); expect(f.writes()).toHaveLength(1)
  })
  it('contains malformed or secret-bearing native acknowledgements as unconfirmed and never exposes them', async () => {
    const f = await fixture()
    f.hooks.after = async (op, value) => op === 'connector.configure' ? { ...value, secret: 'SYNTHETIC_CONNECTOR_SECRET' } : value
    const r = await f.post(f.input()); expect(r.status).toBe(202); expect(await r.text()).not.toContain('SYNTHETIC_CONNECTOR_SECRET')
  })
  it('cancels pending preparation on manager unload with no command reserved or write', async () => {
    const f = await fixture(); let release!: () => void
    const waiting = new Promise<void>(r => { release = r })
    f.hooks.before = async op => { if (op === 'connector.prepare') await waiting }
    const pending = f.options.connectorManagement.create(f.admin.token, f.input(), context(), signal())
    const rejected = expect(pending).rejects.toBeDefined()
    await vi.waitFor(() => expect(f.received).toHaveLength(1)); f.options.connectorManagement.close(); release(); await rejected
    expect(f.writes()).toHaveLength(0)
    expect(await owner`select 1 from haas.connector_commands where tenant_id=${f.tenantId}`).toHaveLength(0)
  })
  it.each(['requested','confirmed'])('does not report false success when %s audit cannot commit', async phase => {
    const f = await fixture()
    await owner.unsafe(`create function haas.reject_connector_command_audit() returns trigger language plpgsql as $$ begin if NEW.tenant_id='${f.tenantId}' and NEW.action='runtime.connector.${phase}' and NEW.outcome='succeeded' then raise exception 'explicit audit fault'; end if; return NEW; end $$`)
    await owner`create trigger reject_connector_command_audit before insert on haas.audit_events for each row execute function haas.reject_connector_command_audit()`
    try {
      expect((await f.post(f.input())).status).toBe(503)
      expect(f.writes()).toHaveLength(phase === 'requested' ? 0 : 1)
      const rows = await owner`select outcome from haas.connector_commands where tenant_id=${f.tenantId}`
      expect(rows).toHaveLength(phase === 'requested' ? 0 : 1); if (rows.length) expect(rows[0]!.outcome).toBe('unconfirmed')
    } finally { await owner`drop trigger reject_connector_command_audit on haas.audit_events`; await owner`drop function haas.reject_connector_command_audit()` }
  })
  it('bounds concurrent inspections per login and globally without holding SQL locks during native I/O', async () => {
    const f = await fixture(); let release!: () => void
    const waiting = new Promise<void>(r => { release = r }), pending: Promise<unknown>[] = []
    f.hooks.before = async op => { if (op === 'connector.configuration') await waiting }
    const input = { targetUserId: f.cells[0]!.member.userId, reason: '测试有界配置读取', confirmed: true }
    const tokens = [f.admin.token]
    for (let n = 0; n < 4; n++) tokens.push((await f.identity.login({ username: 'morgan', password: f.password }, context())).token)
    try {
      for (const token of tokens.slice(0,4)) for (let n = 0; n < 2; n++) pending.push(f.options.connectorManagement.inspect(token, input, randomUUID(), signal()))
      await vi.waitFor(() => expect(f.received).toHaveLength(8))
      await expect(f.options.connectorManagement.inspect(tokens[0], input, randomUUID(), signal())).rejects.toMatchObject({ code: 'connector-management-busy' })
      await expect(f.options.connectorManagement.inspect(tokens[4], input, randomUUID(), signal())).rejects.toMatchObject({ code: 'connector-management-busy' })
      expect((await owner`select 1 as value`)[0]!.value).toBe(1)
    } finally { release(); await Promise.all(pending) }
  })
})
