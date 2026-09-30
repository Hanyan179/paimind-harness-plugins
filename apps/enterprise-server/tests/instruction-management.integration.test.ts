import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import postgres from 'postgres'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Identity } from '../src/identity.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { RuntimeAdmission } from '../src/runtime-admission.js'
import { CellTransport } from '../src/cell-transport.js'
import { InstructionManagement } from '../src/instruction-management.js'
import { createEnterpriseServer } from '../src/server.js'
import { isolatedDatabase } from './fixtures/isolated-database.js'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import * as enterprise from '../../../packages/enterprise-admin/src/index.js'

const config = isolatedDatabase()
const owner = postgres(config.ownerUrl, { max: 2, onnotice: () => {} }), sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
const local = createRequire(import.meta.url)
const host = createRequire(local.resolve('@deepseek-ai/dsh/package.json'))
const base = createRequire(host.resolve('@deepseek-ai/dsh-base/package.json')), web = createRequire(host.resolve('@deepseek-ai/dsh-web-app/package.json'))
const { Context } = base('@deepseek-ai/cordis'), { SystemPrompt, renderPrompt } = base('@deepseek-ai/dsh-system-prompt')
const { FileSettingsProvider } = base('@deepseek-ai/dsh-settings-file'), { settingsNamespace } = base('@deepseek-ai/dsh-settings')
const { createApiProxy, toFetchHandler } = web('@deepseek-ai/dsh-host-apiproxy')
const ns = settingsNamespace('paimind-enterprise-instructions')
const disposers: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })
afterAll(async () => { await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })
const context = () => ({ key: randomUUID(), requestId: randomUUID() })
async function close(server: Server) { if (!server.listening) return; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
async function listen(server: Server) {
  for (let n = 0; n < 32; n++) {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('No isolated port')
    const origin = `http://127.0.0.1:${address.port}`
    if (!(await owner`select 1 from haas.runtime_bindings where origin=${origin}`).length) return origin
    await close(server)
  }
  throw Error('No isolated port')
}

// Real isolated PostgreSQL, authentication, private ingress and two independent
// native Settings/Prompt owners. Container identities below are deliberate
// admission fixtures, NOT real double-Worker or Browser E2E acceptance.
async function fixture() {
  const tenantId = 'instructions-' + randomUUID(), password = 'Synthetic instruction fixture password 2026'
  await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
  const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
  await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, context())
  const admin = await identity.login({ username: 'morgan', password }, context())
  const hooks: { before?: (method: string, root: any) => Promise<void>; after?: (method: string, root: any) => Promise<void>;
    fault?: 'lost' | 'wrong-rpc' | 'rejected' } = {}
  const received: Array<{ userId: string; method: string }> = [], errors: unknown[] = []
  const mount = async (userId: string, home: string) => {
    const root = new Context()
    await root.plugin(FileSettingsProvider, { path: join(home, 'settings.json'), dshHome: home, watch: false })
    await root.plugin(SystemPrompt, { persona: 'Native fixture persona.' }); await root.plugin(enterprise)
    root.provide('userQuestions', { registerProvider: () => () => {} })
    const carrier = toFetchHandler(createApiProxy(root, { defaultModelSelection: () => undefined, cwd: home }))
    const native = createServer(async (request, response) => {
      try {
        let body = ''; for await (const chunk of request) body += chunk
        const call = JSON.parse(body); received.push({ userId, method: call.method })
        expect(['settings.describe','settings.update']).toContain(call.method)
        if (call.method === 'settings.update') expect(call.payload.ns).toBe(ns)
        expect(request.headers).not.toHaveProperty('cookie'); expect(request.headers).not.toHaveProperty('x-paimind-cell-token')
        await hooks.before?.(call.method, root)
        const result = await carrier.fetch(new Request('http://native.invalid' + request.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body }))
        let wire = await result.text(); await hooks.after?.(call.method, root)
        if (call.method === 'settings.update' && hooks.fault) {
          if (hooks.fault === 'lost') { response.destroy(); return }
          const decoded = JSON.parse(wire)
          if (hooks.fault === 'wrong-rpc') decoded.rpcId = randomUUID()
          else decoded.result = { ok: false, error: { code: 'settings-rejected', message: 'Private native storage detail', details: {} } }
          wire = JSON.stringify(decoded)
        }
        response.writeHead(result.status, { 'content-type': 'application/json' }); response.end(wire)
      } catch (error) { errors.push(error); response.destroy() }
    })
    const nativeOrigin = await listen(native), nativePort = Number(new URL(nativeOrigin).port), key = randomBytes(32).toString('hex')
    const ingress = createNativeIngress({ token: key, nativePort, control: async () => { throw Error('No generic control operation') } })
    const origin = await listen(ingress.server), transport = new CellTransport(origin, key, nativePort)
    let closed = false
    const stop = async () => { if (closed) return; closed = true; transport.destroy(); await ingress.close(); await close(native); await root.fiber.dispose() }
    disposers.push(stop)
    return { root, origin, transport, stop, prompt: async () => renderPrompt(await root.systemPrompt.assemble()) }
  }
  const cells = []
  for (const username of ['hansen','alex']) {
    const member = (await identity.createMember(admin.token, { username, displayName: username === 'hansen' ? 'Hansen' : 'Alex', password }, context())).data
    const home = await mkdtemp(join(config.evidence, 'native-instructions-')), attached = await mount(member.userId, home)
    const pin: PrivateRuntimeCell = { cellId: randomUUID(), tenantId, userId: member.userId, role: 'member', revision: randomUUID(), origin: attached.origin,
      containerId: randomBytes(32).toString('hex'), imageId: 'sha256:' + 'd'.repeat(64), policyDigest: 'sha256:' + 'e'.repeat(64), volumeName: 'paimind-haas-member-instructions-' + randomUUID() }
    await owner`insert into haas.runtime_bindings (cell_id,tenant_id,user_id,origin,revision,isolation_mode,status,lease_expires_at,container_id,image_id,volume_name,policy_digest)
      values (${pin.cellId},${tenantId},${pin.userId},${pin.origin},${pin.revision},'container-managed','ready',clock_timestamp()+interval '10 minutes',${pin.containerId},${pin.imageId},${pin.volumeName},${pin.policyDigest})`
    cells.push({ member, home, pin, ...attached })
  }
  const reservation = createServer(), url = await listen(reservation); await close(reservation)
  const make = () => new InstructionManagement(identity, new RuntimeBindings(sql, identity, url, [], cells.map(c => c.pin)), new Map(cells.map(c => [c.origin,c.transport])))
  const options = { identity, instructionManagement: make(), publicOrigin: url, loopbackDevelopment: true }
  const server = createEnterpriseServer(options)
  await new Promise<void>(resolve => server.listen(Number(new URL(url).port), '127.0.0.1', resolve)); disposers.push(() => close(server))
  const post = (path: string, input: object, token = admin.token, key = randomUUID()) => fetch(url + '/haas/v1/admin/' + path, {
    method: 'POST', redirect: 'error', headers: { origin: url, 'content-type': 'application/json', 'idempotency-key': key, cookie: 'paimind_haas_session=' + token }, body: JSON.stringify(input) })
  const get = (id: string, token = admin.token) => fetch(url + '/haas/v1/admin/instruction-commands/' + id, { redirect: 'error', headers: { cookie: 'paimind_haas_session=' + token } })
  const inspect = (index = 0, token = admin.token) => post('instruction-configuration', { targetUserId: cells[index]!.member.userId, reason: '核对该成员的企业指令', confirmed: true }, token)
  const input = (index = 0, instructions = 'Synthetic enterprise instruction ' + index) => {
    const cell = cells[index]!, descriptor = cell.root.settings.describe().find((row: any) => row.ns === ns)
    return { targetUserId: cell.member.userId, expectedCellRevision: cell.pin.revision, expectedSettingsRevision: descriptor.revision,
      change: { enabled: true, instructions }, reason: '更新该成员的企业指令', confirmed: true }
  }
  const restart = () => { options.instructionManagement.close(); options.instructionManagement = make() }
  const replace = async (index = 0) => {
    const cell = cells[index]!, previous = cell.pin, admission = new RuntimeAdmission(owner, url)
    expect(await admission.suspend(previous)).toBe(true); await cell.stop()
    const [suspended] = await owner`select revision from haas.runtime_bindings where cell_id=${previous.cellId}`
    const attached = await mount(cell.member.userId, cell.home)
    const next = { ...previous, origin: attached.origin, containerId: randomBytes(32).toString('hex'), revision: randomUUID() }
    await admission.replaceSuspended({ ...previous, revision: suspended!.revision }, next)
    Object.assign(cell, attached, { pin: next }); restart()
  }
  return { tenantId, identity, admin, cells, hooks, received, errors, post, get, inspect, input, restart, replace, options,
    memberLogin: (username = 'hansen') => identity.login({ username, password }, context()), writes: () => received.filter(r => r.method === 'settings.update') }
}

describe('ISO-03 admin commands through real authentication, database and native settings', () => {
  it('audits exact member reads/writes, preserves the other member, and never stores instruction text in the journal', async () => {
    const f = await fixture(), desired = f.input(0, 'Hansen private synthetic text {{literal}} 中文'), key = randomUUID()
    const initial = await f.inspect(); expect(initial.status).toBe(200)
    const inspected = (await initial.json()).data
    expect(inspected).toMatchObject({ targetUserId: f.cells[0]!.member.userId, cellRevision: f.cells[0]!.pin.revision,
      configuration: { enabled: true, instructions: '', revision: 0, writable: true, applies: 'live' } })
    expect(inspected.audit.requestId).toMatch(/^[a-f0-9-]{36}$/u)
    expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and request_id=${inspected.audit.requestId}
      and action='runtime.instructions.read' and outcome='succeeded' and reason=${inspected.audit.reason}`).toHaveLength(1)
    f.hooks.before = async method => { if (method === 'settings.update') {
      expect(await owner`select 1 from haas.instruction_commands where tenant_id=${f.tenantId} and outcome='unconfirmed'`).toHaveLength(1)
      expect(await owner`select 1 from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.instructions.requested' and outcome='succeeded'`).toHaveLength(1)
    } }
    const response = await f.post('instruction-commands', desired, f.admin.token, key); expect(response.status).toBe(200)
    const receipt = (await response.json()).data; expect(receipt).toMatchObject({ outcome: 'applied', historicalReceipt: true, runtimeGrant: false,
      confirmation: { observation: { revision: 1, enabled: true, instructionLength: desired.change.instructions.length } } })
    expect(await f.cells[0]!.prompt()).toContain(desired.change.instructions); expect(await f.cells[1]!.prompt()).not.toContain(desired.change.instructions)
    const records = await owner`select * from haas.instruction_commands where tenant_id=${f.tenantId}`
    const audit = await owner`select * from haas.audit_events where tenant_id=${f.tenantId}`
    expect(JSON.stringify([records,audit,receipt])).not.toContain(desired.change.instructions)
    expect(JSON.parse(await readFile(join(f.cells[0]!.home,'settings.json'),'utf8'))[ns].instructions).toBe(desired.change.instructions)
    const before = f.received.length; f.restart()
    expect((await (await f.post('instruction-commands', desired, f.admin.token, key)).json()).data).toEqual(receipt)
    expect((await (await f.get(receipt.commandId)).json()).data).toEqual(receipt); expect(f.received).toHaveLength(before)
    await expect(sql`delete from haas.instruction_commands where tenant_id=${f.tenantId}`).rejects.toBeDefined()
    await expect(owner`update haas.instruction_commands set outcome='conflict' where tenant_id=${f.tenantId}`).rejects.toBeDefined()
    expect(f.errors).toEqual([])
  })
  it('rejects members, anonymous users, foreign member ids and foreign receipt ids without native I/O', async () => {
    const f = await fixture(), foreign = await fixture(), member = await f.memberLogin()
    const result = await foreign.post('instruction-commands', foreign.input()), receipt = (await result.json()).data
    const before = f.received.length
    for (const token of [member.token, '']) {
      expect((await f.inspect(0,token)).status).toBe(token ? 403 : 401)
      expect((await f.post('instruction-commands',f.input(),token)).status).toBe(token ? 403 : 401)
      expect((await f.post('instruction-command-state',{targetUserId:f.cells[0]!.member.userId},token)).status).toBe(token ? 403 : 401)
      expect((await f.get(receipt.commandId,token)).status).toBe(token ? 403 : 401)
    }
    expect((await f.post('instruction-commands',{...f.input(),targetUserId:foreign.cells[0]!.member.userId})).status).toBe(404)
    expect((await f.get(receipt.commandId)).status).toBe(404)
    expect(f.received).toHaveLength(before); expect(f.errors).toEqual([]); expect(foreign.errors).toEqual([])
  })
  it.each(['lost','wrong-rpc','rejected'] as const)('retains %s response uncertainty and does not resend or block another member', async fault => {
    const f=await fixture(), input=f.input(), key=randomUUID(); f.hooks.fault=fault
    const response=await f.post('instruction-commands',input,f.admin.token,key);expect(response.status).toBe(202)
    const receipt=(await response.json()).data;expect(receipt.outcome).toBe('unconfirmed');expect(await f.cells[0]!.prompt()).toContain(input.change.instructions)
    f.hooks.fault=undefined;f.restart();const before=f.received.length
    expect((await f.post('instruction-commands',input,f.admin.token,key)).status).toBe(202)
    expect((await f.post('instruction-commands',input)).status).toBe(409);expect(f.received).toHaveLength(before)
    const pending=await f.post('instruction-command-state',{targetUserId:input.targetUserId});expect((await pending.json()).data.command.commandId).toBe(receipt.commandId)
    expect((await f.post('instruction-commands/'+receipt.commandId+'/resolve',{expectedCellRevision:input.expectedCellRevision,reason:'旧单元不能消除不确定性',confirmed:true})).status).toBe(409)
    expect((await f.post('instruction-commands',f.input(1))).status).toBe(200);expect(f.writes()).toHaveLength(2)
    expect(f.errors).toEqual([])
  })
  it('only supersedes uncertainty after exact stopped-writer replacement; cold native files survive', async () => {
    const f=await fixture(),input=f.input();f.hooks.fault='lost'
    const receipt=(await (await f.post('instruction-commands',input)).json()).data;f.hooks.fault=undefined
    await f.replace();expect(await f.cells[0]!.prompt()).toContain(input.change.instructions)
    const writes=f.writes().length,response=await f.post('instruction-commands/'+receipt.commandId+'/resolve',{
      expectedCellRevision:f.cells[0]!.pin.revision,reason:'隔离旧写入者后核对原生配置',confirmed:true})
    expect(response.status).toBe(200);expect((await response.json()).data).toMatchObject({outcome:'superseded',confirmation:{effect:'unknown'}})
    expect(f.writes()).toHaveLength(writes)
    expect((await f.post('instruction-commands',f.input(0,'New explicit instructions.'))).status).toBe(200)
    expect(await f.cells[0]!.prompt()).toContain('New explicit instructions.');expect(f.errors).toEqual([])
  })
  it('serializes same-key concurrent writes and conflicts on a changed payload or stale pin/revision', async () => {
    const f=await fixture(),input=f.input(),key=randomUUID()
    const responses=await Promise.all([f.post('instruction-commands',input,f.admin.token,key),f.post('instruction-commands',input,f.admin.token,key)])
    expect(responses.map(r=>r.status).every(status=>[200,202].includes(status))).toBe(true);expect(f.writes()).toHaveLength(1)
    expect((await f.post('instruction-commands',{...input,change:{...input.change,instructions:'different'}},f.admin.token,key)).status).toBe(409)
    expect((await f.post('instruction-commands',input)).status).toBe(409)
    expect((await f.post('instruction-commands',{...f.input(),expectedCellRevision:randomUUID()})).status).toBe(409)
    expect(f.writes()).toHaveLength(1)
  })
  it('keeps a real owner CAS conflict terminal and refuses unknown input or oversized instructions before dispatch', async () => {
    const f=await fixture()
    f.hooks.before=async(method,root)=>{if(method==='settings.update')await root.settings.update(ns,{instructions:'Concurrent native writer.'})}
    const response=await f.post('instruction-commands',f.input());expect(response.status).toBe(200);expect((await response.json()).data.outcome).toBe('conflict')
    expect(await f.cells[0]!.prompt()).toContain('Concurrent native writer.');f.hooks.before=undefined
    const before=f.received.length
    for(const input of [{...f.input(),namespace:'other'},{...f.input(),confirmed:false},
      {...f.input(),change:{enabled:true,instructions:'x'.repeat(8001)}},{...f.input(),change:{enabled:true,instructions:'x',apiKey:'not-allowed'}}]){
      expect((await f.post('instruction-commands',input)).status).toBe(400)
    }
    expect(f.received).toHaveLength(before)
    expect((await f.post('instruction-commands',f.input(0,'中'.repeat(8000)))).status).toBe(200)
  })
  it('rechecks current login after native read and refuses to write after logout', async () => {
    const f=await fixture();let revoked=false
    f.hooks.after=async method=>{if(method==='settings.describe'&&!revoked){revoked=true;await f.identity.logout(f.admin.token,{},context())}}
    const response=await f.post('instruction-commands',f.input());expect(response.status).toBe(401);expect(f.writes()).toHaveLength(0)
  })
  it('does not release inspected content after member disable', async () => {
    const f=await fixture();f.hooks.after=async method=>{if(method==='settings.describe')await owner`update haas.users set status='disabled' where tenant_id=${f.tenantId} and user_id=${f.cells[0]!.member.userId}`}
    const response=await f.inspect();expect(response.status).toBe(404);expect(await response.text()).not.toContain('configuration')
    expect(f.writes()).toHaveLength(0)
  })
  it.each(['requested','confirmed'] as const)('fails closed when instruction %s audit cannot commit',async phase=>{
    const f=await fixture()
    await owner.unsafe(`create function haas.reject_instruction_audit() returns trigger language plpgsql as $$ begin if NEW.tenant_id='${f.tenantId}' and NEW.action='runtime.instructions.${phase}' and NEW.outcome='succeeded' then raise exception 'explicit instruction audit fault'; end if; return NEW; end $$`)
    await owner`create trigger reject_instruction_audit before insert on haas.audit_events for each row execute function haas.reject_instruction_audit()`
    try{
      expect((await f.post('instruction-commands',f.input())).status).toBe(503)
      const rows=await owner`select outcome from haas.instruction_commands where tenant_id=${f.tenantId}`
      expect(rows.map(row=>row.outcome)).toEqual(phase==='requested'?[]:['unconfirmed']);expect(f.writes()).toHaveLength(phase==='requested'?0:1)
    }finally{await owner`drop trigger reject_instruction_audit on haas.audit_events`;await owner`drop function haas.reject_instruction_audit()`}
  })
  it('cancels dispatch observation on service close without replaying a persisted write',async()=>{
    const f=await fixture(),input=f.input(),key=randomUUID();let entered!:()=>void,release!:()=>void
    const ready=new Promise<void>(done=>{entered=done}),hold=new Promise<void>(done=>{release=done})
    f.hooks.after=async method=>{if(method==='settings.update'){entered();await hold}}
    const running=f.post('instruction-commands',input,f.admin.token,key)
    await ready;f.restart();release()
    expect((await running).status).toBe(503)
    expect((await f.post('instruction-commands',input,f.admin.token,key)).status).toBe(202);expect(f.writes()).toHaveLength(1)
  })
})
