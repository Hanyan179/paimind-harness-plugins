import { fork } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { FEATURE_CATALOG_DIGEST, FEATURE_RECONCILED_PACK_IDS } from '@paimind/extension-center/governance'
import { Identity } from '../src/identity.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { RuntimeAdmission } from '../src/runtime-admission.js'
import { CellTransport } from '../src/cell-transport.js'
import { FeatureManagement } from '../src/feature-management.js'
import { createEnterpriseServer } from '../src/server.js'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { createNativeControlBroker } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'

const configPath = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!configPath || statSync(configPath).mode & 0o077) throw Error('Private isolated PostgreSQL required')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || ['3080', '55857', '5432', '10012'].includes(url.port)) throw Error('Unsafe feature fixture')
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const owner = postgres(config.ownerUrl, { max: 2, onnotice: () => {} }), sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
const disposers: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const dispose of disposers.splice(0).reverse()) await dispose() })
afterAll(async () => { await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })
const context = () => ({ key: randomUUID(), requestId: randomUUID() })
const imageId = 'sha256:' + 'd'.repeat(64)
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
async function listen(server: Server) {
  for (let attempt = 0; attempt < 32; attempt++) {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('No isolated port')
    const origin = `http://127.0.0.1:${address.port}`
    if (!(await owner`select 1 from haas.runtime_bindings where origin = ${origin}`).length) return origin
    await close(server)
  }
  throw Error('No fresh binding port')
}
async function nativeOwner(existingDirectory?: string) {
  const directory = existingDirectory ?? await mkdtemp(resolve(dirname(repo), '.paimind-goal-evidence/haas-feature-owner-'))
  const child = fork(resolve(repo, 'apps/enterprise-server/tests/fixtures/feature-command-owner.mjs'), [], {
    cwd: directory, env: { PATH: process.env.PATH, PAIMIND_FEATURE_OWNER_TEST: '1', DSH_TELEMETRY_MODE: 'DISABLED' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let output = ''
  child.stdout!.on('data', bytes => { output += bytes }); child.stderr!.on('data', bytes => { output += bytes })
  const pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  child.on('message', (message: any) => {
    const entry = pending.get(message.id); if (!entry) return
    clearTimeout(entry.timer); pending.delete(message.id)
    if (message.error) entry.reject(Error(message.error.message)); else entry.resolve(message.value)
  })
  child.on('exit', () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('Native owner exited')) }; pending.clear() })
  const request = (operation: string, input?: unknown): Promise<any> => new Promise((resolve, reject) => {
    const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(Error('Native owner request timed out')) }, 10_000)
    pending.set(id, { resolve, reject, timer }); child.send({ id, operation, input })
  })
  let recorded = false
  const stop = async () => {
    if (recorded) return
    if (child.exitCode === null && child.signalCode === null) {
      const exit = new Promise(resolve => child.once('exit', resolve))
      try { const stopped = await request('stop'); expect(stopped.live).toEqual([]) }
      catch (error) { child.kill('SIGTERM'); await exit; throw error }
      await exit; expect(child.exitCode).toBe(0)
    }
    await writeFile(resolve(directory, `process-${child.pid}.json`), JSON.stringify({ pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode,
      realNativeOwner: true, diagnosticGroupBodies: true, browserE2E: false }), { mode: 0o600, flag: 'wx' })
    await writeFile(resolve(directory, `process-${child.pid}.log`), output, { mode: 0o600, flag: 'wx' })
    const evidence = process.env.PAIMIND_FEATURE_OWNER_EVIDENCE
    if (evidence) {
      expect(dirname(evidence)).toBe(resolve(dirname(repo), '.paimind-goal-evidence'))
      await writeFile(resolve(evidence, `native-fixture-${child.pid}.json`), JSON.stringify({ directory, pid: child.pid,
        exitCode: child.exitCode, signalCode: child.signalCode, realNativeOwner: true, diagnosticGroupBodies: true, browserE2E: false }), { mode: 0o600, flag: 'wx' })
    }
    recorded = true
  }
  disposers.push(stop)
  await request('boot')
  const broker = await createNativeControlBroker('.'); disposers.push(() => broker.close())
  await request('connect', { path: relative(directory, resolve(broker.path)) })
  await vi.waitFor(() => expect(broker.ready).toBe(true))
  return { request, broker, directory, pid: child.pid, stop }
}
async function fixture() {
  const tenantId = 'feature-' + randomUUID(), password = 'Explicit synthetic feature password 2026'
  await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
  const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
  await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, context())
  const admin = await identity.login({ username: 'morgan', password }, context())
  const hooks: { before?: (operation: string, input: any) => Promise<void>; after?: (operation: string, result: any) => Promise<void>; loseApply?: boolean } = {}
  const received: Array<{ userId: string; operation: string; input: any }> = []
  const cells = []
  const attach = async (member: { userId: string }, worker: Awaited<ReturnType<typeof nativeOwner>>) => {
    const key = randomBytes(32).toString('hex')
    const ingress = createNativeIngress({ token: key, control: async (operation: string, input: any, signal: AbortSignal) => {
      received.push({ userId: member.userId, operation, input }); await hooks.before?.(operation, input)
      const result = await worker.broker.request(operation, input, signal)
      await hooks.after?.(operation, result)
      if (operation === 'feature.apply' && hooks.loseApply) throw Error('Explicit lost native response')
      return result
    } })
    const origin = await listen(ingress.server); disposers.push(() => ingress.close())
    const transport = new CellTransport(origin, key); disposers.push(() => transport.destroy())
    return { origin, transport }
  }
  for (const [username, displayName] of [['hansen', 'Hansen'], ['alex', 'Alex']]) {
    const member = (await identity.createMember(admin.token, { username, displayName, password }, context())).data
    const worker = await nativeOwner(), { origin, transport } = await attach(member, worker)
    // Diagnostic pins exercise exact DB/operator binding comparisons. They are
    // not container evidence and never count as immutable final Worker E2E.
    const pin: PrivateRuntimeCell = { cellId: randomUUID(), tenantId, userId: member.userId, role: 'member', revision: randomUUID(), origin,
      containerId: randomBytes(32).toString('hex'), imageId, policyDigest: 'sha256:' + 'e'.repeat(64), volumeName: 'paimind-haas-member-fixture-' + randomUUID() }
    await owner`insert into haas.runtime_bindings (cell_id,tenant_id,user_id,origin,revision,isolation_mode,status,lease_expires_at,container_id,image_id,volume_name,policy_digest)
      values (${pin.cellId},${tenantId},${pin.userId},${origin},${pin.revision},'container-managed','ready',clock_timestamp()+interval '10 minutes',
      ${pin.containerId},${pin.imageId},${pin.volumeName},${pin.policyDigest})`
    cells.push({ member, pin, transport, worker })
  }
  const reservation = createServer(), url = await listen(reservation); await close(reservation)
  const bindings = new RuntimeBindings(sql, identity, url, [], cells.map(cell => cell.pin))
  const transports = new Map(cells.map(cell => [cell.pin.origin, cell.transport]))
  const features = new FeatureManagement(identity, bindings, transports, [{ imageId, catalogDigest: FEATURE_CATALOG_DIGEST, packIds: FEATURE_RECONCILED_PACK_IDS }])
  disposers.push(() => features.close())
  const options = { identity, featureManagement: features, publicOrigin: url, loopbackDevelopment: true }
  const server = createEnterpriseServer(options)
  await new Promise<void>(resolve => server.listen(Number(new URL(url).port), '127.0.0.1', resolve)); disposers.push(() => close(server))
  const post = (path: string, body: object, token = admin.token, key = randomUUID()) => fetch(url + '/haas/v1/admin/' + path, {
    method: 'POST', redirect: 'error', headers: { origin: url, 'content-type': 'application/json', 'idempotency-key': key, cookie: 'paimind_haas_session=' + token }, body: JSON.stringify(body),
  })
  const get = (id: string, token = admin.token) => fetch(url + '/haas/v1/admin/feature-commands/' + id, { headers: { cookie: 'paimind_haas_session=' + token }, redirect: 'error' })
  const approval = (target = cells[0]!, expectedRevision = 0, packIds = [...FEATURE_RECONCILED_PACK_IDS]) => ({ targetUserId: target.member.userId,
    imageId, catalogDigest: FEATURE_CATALOG_DIGEST, packIds, expectedRevision, reason: '批准指定成员的完整功能包范围', confirmed: true })
  const preview = async (target = cells[0]!) => {
    const state = await target.worker.request('snapshot')
    return { targetUserId: target.member.userId, selection: { id: 'paimind:pack:operations', enabled: false, expectedRevision: state.view.revision } }
  }
  const prepare = async (target = cells[0]!) => {
    expect((await post('feature-packs/approvals', approval(target))).status).toBe(200)
    const input = await preview(target), response = await post('feature-packs/preview', input); expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data).not.toHaveProperty('cell'); expect(data).not.toHaveProperty('actor')
    return { ...input, planDigest: data.plan.planDigest, approvalRevision: 1, reason: '停用指定成员的运营功能包', confirmed: true }
  }
  const replace = async (patch: Partial<PrivateRuntimeCell> = {}, preserveSettings = true) => {
    const cell = cells[0]!, old = cell.pin, admission = new RuntimeAdmission(owner, url)
    expect(await admission.suspend(old)).toBe(true)
    await cell.worker.stop()
    const [suspended] = await owner<{ revision: string }[]>`select revision from haas.runtime_bindings where cell_id=${old.cellId}`
    const worker = await nativeOwner(preserveSettings ? cell.worker.directory : undefined), attached = await attach(cell.member, worker)
    const pin = { ...old, revision: randomUUID(), containerId: randomBytes(32).toString('hex'), origin: attached.origin, ...patch }
    await admission.replaceSuspended({ ...old, revision: suspended!.revision }, pin)
    cell.pin = pin; cell.worker = worker; cell.transport = attached.transport
    const currentBindings = new RuntimeBindings(sql, identity, url, [], cells.map(row => row.pin))
    const currentTransports = new Map(cells.map(row => [row.pin.origin, row.transport]))
    options.featureManagement.close()
    const next = new FeatureManagement(identity, currentBindings, currentTransports,
      [...new Set(cells.map(row => row.pin.imageId))].map(imageId => ({ imageId, catalogDigest: FEATURE_CATALOG_DIGEST, packIds: FEATURE_RECONCILED_PACK_IDS })))
    options.featureManagement = next; disposers.push(() => next.close())
    return { old, pin, worker }
  }
  return { tenantId, identity, admin, cells, bindings, transports, features, hooks, received, post, get, approval, preview, prepare, password, replace }
}

describe('real PostgreSQL and native Settings/Loader through HTTP and Unix control; diagnostic groups and pins, not Browser E2E', () => {
  it.each(['applied', 'applying'] as const)('explicitly recovers the original %s journal after a real cold process replacement', async phase => {
    const f = await fixture(), input = await f.prepare(), key = randomUUID(), initial = await f.cells[0]!.worker.request('snapshot')
    if (phase === 'applying') await f.cells[0]!.worker.request('failReceipt', { phase: 'applied' })
    else f.hooks.loseApply = true
    const pending = await f.post('feature-packs/commands', input, f.admin.token, key); expect(pending.status).toBe(202)
    const command = (await pending.json()).data, original = await f.cells[0]!.worker.request('snapshot')
    expect(original.command.phase).toBe(phase)
    const alex = await f.cells[1]!.worker.request('snapshot'), replacement = await f.replace()
    f.hooks.loseApply = false
    const before = await replacement.worker.request('snapshot')
    expect(before.pid).not.toBe(original.pid); expect(before.command).toEqual(original.command)
    const state = (await (await f.post('feature-packs/state', { targetUserId: input.targetUserId })).json()).data
    expect(state.recovery).toMatchObject({ kind: 'replacement-runtime', currentPinDigest: expect.stringMatching(/^sha256:/), originalPinDigest: expect.stringMatching(/^sha256:/) })
    const request = { reason: '确认同成员原数据及镜像的替代运行环境', confirmed: true }
    expect((await f.post('feature-packs/commands', input, f.admin.token, key)).status).toBe(409)
    expect((await f.post('feature-commands/' + command.commandId + '/resume', request)).status).toBe(409)
    expect((await f.post('feature-commands/' + command.commandId + '/resume', { ...request, allowReplacement: true, expectedRuntimeDigest: 'sha256:' + '0'.repeat(64) })).status).toBe(409)
    const response = await f.post('feature-commands/' + command.commandId + '/resume', { ...request, allowReplacement: true, expectedRuntimeDigest: state.recovery.currentPinDigest })
    expect(response.status).toBe(200); expect((await response.json()).data).toMatchObject({ commandId: command.commandId, outcome: 'applied' })
    const after = await replacement.worker.request('snapshot')
    if (phase === 'applied') expect(after.transitions).toEqual(before.transitions)
    else {
      // The original owner deliberately rebuilds every approved product group
      // from all-disabled state. Recovery repeats that exact full reconciliation,
      // not a fictitious single-group toggle.
      expect(after.transitions.slice(before.transitions.length)).toEqual(original.transitions.slice(initial.transitions.length))
      expect(after.live).toEqual(original.live); expect(after.live).not.toContain('paimind-pack-operations')
    }
    expect(await f.cells[1]!.worker.request('snapshot')).toEqual(alex)
    const [stored] = await owner`select target_pin,input,outcome from haas.feature_commands where tenant_id=${f.tenantId} and command_id=${command.commandId}`
    expect(stored!.target_pin).toEqual(replacement.old); expect(stored!.input).toEqual(input); expect(stored!.outcome).toBe('applied')
    const audits = await owner`select reason from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.feature.confirmed' and outcome='succeeded'`
    expect(audits).toHaveLength(1); expect(JSON.parse(audits[0]!.reason).recovery).toEqual({ originalPinDigest: state.recovery.originalPinDigest, currentPinDigest: state.recovery.currentPinDigest })
  })
  it('permits same-runtime confirmation after explicit reapproval and fresh administrator login without repeating transitions', async () => {
    const f = await fixture(), input = await f.prepare(); f.hooks.loseApply = true
    const command = (await (await f.post('feature-packs/commands', input)).json()).data, original = await f.cells[0]!.worker.request('snapshot')
    const request = { reason: '重新批准后确认既有原命令', confirmed: true }
    expect((await f.post('feature-packs/approvals', f.approval(undefined, 1, []))).status).toBe(200)
    expect((await f.post('feature-commands/' + command.commandId + '/resume', request)).status).toBe(403)
    expect((await f.post('feature-packs/approvals', f.approval(undefined, 2))).status).toBe(200)
    await f.identity.logout(f.admin.token, {}, context())
    expect((await f.post('feature-commands/' + command.commandId + '/resume', request)).status).toBe(401)
    const login = await f.identity.login({ username: 'morgan', password: f.password }, context()); f.hooks.loseApply = false
    expect((await f.post('feature-commands/' + command.commandId + '/resume', request, login.token)).status).toBe(200)
    expect((await f.cells[0]!.worker.request('snapshot')).transitions).toEqual(original.transitions)
  })
  it.each(['policy','image','missing-journal'] as const)('refuses replacement recovery with %s mismatch without a native apply',async mismatch=>{
    const f=await fixture(),input=await f.prepare();f.hooks.loseApply=true
    const response=await f.post('feature-packs/commands',input);expect(response.status).toBe(202)
    const command=(await response.json()).data
    const patch=mismatch==='policy'?{policyDigest:'sha256:'+'f'.repeat(64)}:mismatch==='image'?{imageId:'sha256:'+'c'.repeat(64)}:{}
    await f.replace(patch,mismatch!=='missing-journal');f.hooks.loseApply=false
    const stateResponse=await f.post('feature-packs/state',{targetUserId:input.targetUserId});expect(stateResponse.status).toBe(200)
    const state=(await stateResponse.json()).data;expect(state.recovery.kind).toBe('blocked')
    const before=await f.cells[0]!.worker.request('snapshot'),applies=f.received.filter(row=>row.operation==='feature.apply').length
    const resumed=await f.post('feature-commands/'+command.commandId+'/resume',{reason:'明确检查原命令恢复边界',confirmed:true,allowReplacement:true,expectedRuntimeDigest:state.recovery.currentPinDigest})
    expect(resumed.status).toBe(mismatch==='image'?403:409)
    expect(f.received.filter(row=>row.operation==='feature.apply')).toHaveLength(applies)
    expect(await f.cells[0]!.worker.request('snapshot')).toEqual(before)
    expect((await (await f.get(command.commandId)).json()).data.outcome).toBe('unconfirmed')
  })
  it.each(['approval','logout','binding'] as const)('rechecks %s after replacement journal read before any replay',async fault=>{
    const f=await fixture(),input=await f.prepare();f.hooks.loseApply=true
    const response=await f.post('feature-packs/commands',input);expect(response.status).toBe(202)
    const command=(await response.json()).data;await f.replace();f.hooks.loseApply=false
    const state=(await(await f.post('feature-packs/state',{targetUserId:input.targetUserId})).json()).data
    const before=await f.cells[0]!.worker.request('snapshot'),alex=await f.cells[1]!.worker.request('snapshot'),applies=f.received.filter(row=>row.operation==='feature.apply').length
    f.hooks.after=async operation=>{
      if(operation!=='feature.describe')return
      if(fault==='approval')expect((await f.post('feature-packs/approvals',f.approval(undefined,1,[]))).status).toBe(200)
      else if(fault==='logout')await f.identity.logout(f.admin.token,{},context())
      else await owner`update haas.runtime_bindings set revision=${randomUUID()} where cell_id=${f.cells[0]!.pin.cellId}`
    }
    const resumed=await f.post('feature-commands/'+command.commandId+'/resume',{reason:'核对恢复期间的当前授权',confirmed:true,allowReplacement:true,expectedRuntimeDigest:state.recovery.currentPinDigest})
    expect(resumed.status).toBe(fault==='approval'?403:fault==='logout'?401:503)
    expect(f.received.filter(row=>row.operation==='feature.apply')).toHaveLength(applies)
    expect(await f.cells[0]!.worker.request('snapshot')).toEqual(before);expect(await f.cells[1]!.worker.request('snapshot')).toEqual(alex)
    const [stored]=await owner`select outcome from haas.feature_commands where tenant_id=${f.tenantId} and command_id=${command.commandId}`
    expect(stored!.outcome).toBe('unconfirmed')
  })
  it('accepts legacy same-runtime input but rejects unknown fields and malformed optional recovery confirmation before forwarding',async()=>{
    const f=await fixture(),input=await f.prepare();f.hooks.loseApply=true
    const response=await f.post('feature-packs/commands',input);expect(response.status).toBe(202)
    const command=(await response.json()).data,count=f.received.length
    const common={reason:'核对明确恢复确认格式',confirmed:true}
    for(const patch of [{allowReplacement:true},{allowReplacement:false},{expectedRuntimeDigest:'invalid'},{expectedRuntimeDigest:null},{origin:'http://127.0.0.1:3080'}]) {
      expect((await f.post('feature-commands/'+command.commandId+'/resume',{...common,...patch})).status).toBe(400)
    }
    expect(f.received).toHaveLength(count)
    const state=(await(await f.post('feature-packs/state',{targetUserId:input.targetUserId})).json()).data
    expect(state.recovery.kind).toBe('same-runtime');expect(state.recovery.originalPinDigest).toBe(state.recovery.currentPinDigest)
    f.hooks.loseApply=false
    expect((await f.post('feature-commands/'+command.commandId+'/resume',{...common,expectedRuntimeDigest:state.recovery.currentPinDigest})).status).toBe(200)
  })
  it('reads each current native state and finds the durable pending command after a fresh read without actuating or auto-confirming it', async () => {
    const f = await fixture()
    for (const cell of f.cells) {
      const response = await f.post('feature-packs/state', { targetUserId: cell.member.userId }); expect(response.status).toBe(200)
      const { data } = await response.json()
      expect(data).toMatchObject({ targetUserId: cell.member.userId, targetName: cell.member.displayName, imageId,
        catalogDigest: FEATURE_CATALOG_DIGEST, view: { status: 'ready' }, approval: null, command: null, nativeCommand: null })
      expect(data.view.packs.map((pack: any) => pack.id).sort()).toEqual(FEATURE_RECONCILED_PACK_IDS)
      expect(data).not.toHaveProperty('cell'); expect(data).not.toHaveProperty('actor'); expect(data).not.toHaveProperty('origin')
    }
    expect(f.received.every(row => row.operation === 'feature.describe')).toBe(true)
    const input = await f.prepare(); f.hooks.loseApply = true
    const result = (await (await f.post('feature-packs/commands', input)).json()).data
    const before = await f.cells[0]!.worker.request('snapshot'), applies = f.received.filter(row => row.operation === 'feature.apply').length
    const response = await f.post('feature-packs/state', { targetUserId: input.targetUserId }); expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.command).toMatchObject({ commandId: result.commandId, outcome: 'unconfirmed' })
    expect(data.nativeCommand).toMatchObject({ commandId: result.commandId, phase: 'applied' })
    expect((await f.cells[0]!.worker.request('snapshot')).transitions).toEqual(before.transitions)
    expect(f.received.filter(row => row.operation === 'feature.apply')).toHaveLength(applies)
    const alexState = (await (await f.post('feature-packs/state', { targetUserId: f.cells[1]!.member.userId })).json()).data
    expect(alexState.command).toBeNull(); expect(alexState.nativeCommand).toBeNull()
  })
  it.each(['logout', 'binding'] as const)('does not disclose stale state when %s changes during the native read', async fault => {
    const f = await fixture()
    f.hooks.after = async operation => {
      if (operation !== 'feature.describe') return
      if (fault === 'logout') await f.identity.logout(f.admin.token, {}, context())
      else await owner`update haas.runtime_bindings set revision=${randomUUID()} where cell_id=${f.cells[0]!.pin.cellId}`
    }
    const response = await f.post('feature-packs/state', { targetUserId: f.cells[0]!.member.userId })
    expect(response.status).toBe(fault === 'logout' ? 401 : 503); expect(await response.json()).not.toHaveProperty('data')
    expect((await f.cells[0]!.worker.request('snapshot')).command).toBeNull()
  })
  it('audits approval and intent before effect, isolates Hansen from Alex, and replays the original receipt without another native change', async () => {
    const f = await fixture(), input = await f.prepare(), key = randomUUID(), alexBefore = await f.cells[1]!.worker.request('snapshot')
    f.hooks.before = async (operation, command) => {
      if (operation !== 'feature.apply') return
      const rows = await owner`select outcome from haas.feature_commands where tenant_id=${f.tenantId} and command_id=${command.commandId}`
      expect(rows[0]!.outcome).toBe('unconfirmed')
      const audits = await owner`select action from haas.audit_events where tenant_id=${f.tenantId} order by sequence`
      expect(audits.map(row => row.action)).toEqual(expect.arrayContaining(['runtime.feature.approval', 'runtime.feature.requested', 'runtime.feature.authorized']))
    }
    const response = await f.post('feature-packs/commands', input, f.admin.token, key); expect(response.status).toBe(200)
    const result = (await response.json()).data
    expect(result).toMatchObject({ outcome: 'applied', targetUserId: f.cells[0]!.member.userId, historicalReceipt: true, runtimeGrant: false })
    const hansenAfter = await f.cells[0]!.worker.request('snapshot'); expect(hansenAfter.live).not.toContain('paimind-pack-operations')
    expect(await f.cells[1]!.worker.request('snapshot')).toEqual(alexBefore)
    const count = f.received.length
    expect((await f.post('feature-packs/commands', input, f.admin.token, key)).status).toBe(200)
    expect(f.received).toHaveLength(count); expect((await f.cells[0]!.worker.request('snapshot')).transitions).toEqual(hansenAfter.transitions)
    expect((await f.post('feature-packs/commands', { ...input, reason: '不同的原始请求内容' }, f.admin.token, key)).status).toBe(409)
    expect((await f.get(result.commandId)).status).toBe(200)
    const [audit] = await owner`select reason from haas.audit_events where tenant_id=${f.tenantId} and action='runtime.feature.approval' and outcome='succeeded'`
    expect(JSON.parse(audit!.reason)).toMatchObject({ imageId, catalogDigest: FEATURE_CATALOG_DIGEST, revision: 1, packIds: [...FEATURE_RECONCILED_PACK_IDS] })
    const alexInput = await f.prepare(f.cells[1]!)
    expect((await f.post('feature-packs/commands', alexInput)).status).toBe(200)
    expect((await f.cells[1]!.worker.request('snapshot')).live).not.toContain('paimind-pack-operations')
    expect((await f.cells[0]!.worker.request('snapshot')).transitions).toEqual(hansenAfter.transitions)
  })
  it('refuses members, anonymous callers, foreign targets, invented fields and incomplete approval without native mutation', async () => {
    const f = await fixture(), input = await f.preview(), member = await f.identity.login({ username: 'alex', password: f.password }, context())
    for (const [token, status] of [[member.token, 403], ['', 401]] as const) {
      expect((await f.post('feature-packs/preview', input, token)).status).toBe(status)
      expect((await f.post('feature-packs/state', { targetUserId: input.targetUserId }, token)).status).toBe(status)
      expect((await f.post('feature-packs/approvals', f.approval(), token)).status).toBe(status)
      expect((await f.get(randomUUID(), token)).status).toBe(status)
    }
    const foreignTenant = 'foreign-feature-' + randomUUID(), foreignId = randomUUID()
    await owner`insert into haas.tenants (tenant_id) values (${foreignTenant})`
    await owner`insert into haas.users (tenant_id,user_id,username,display_name,role,status,credential)
      select ${foreignTenant},${foreignId},'riley','Riley','member','active',credential from haas.users where user_id=${f.cells[0]!.member.userId}`
    for (const targetUserId of [randomUUID(), foreignId]) expect((await f.post('feature-packs/preview', { ...input, targetUserId })).status).toBe(403)
    expect((await f.post('feature-packs/preview', { ...input, origin: 'http://127.0.0.1:3080' })).status).toBe(400)
    expect(f.received).toHaveLength(0)
    expect((await f.post('feature-packs/approvals', f.approval(undefined, 0, ['paimind:pack:operations']))).status).toBe(200)
    const plan = (await (await f.post('feature-packs/preview', input)).json()).data.plan
    expect((await f.post('feature-packs/commands', { ...input, planDigest: plan.planDigest, approvalRevision: 1, reason: '必须覆盖依赖和回退', confirmed: true })).status).toBe(403)
    expect(f.received.every(row => row.operation === 'feature.plan')).toBe(true)
    const [count] = await owner`select count(*)::int as value from haas.feature_commands where tenant_id=${f.tenantId}`; expect(count!.value).toBe(0)
  })
  it('requires an operator-approved image ceiling and current revision for every approval, with no runtime effect', async () => {
    const f = await fixture(), input = f.approval(), key = randomUUID()
    const unapproved = new FeatureManagement(f.identity, f.bindings, f.transports, []); disposers.push(() => unapproved.close())
    await expect(unapproved.approve(f.admin.token, input, context())).rejects.toMatchObject({ code: 'feature-not-approved' })
    expect((await f.post('feature-packs/approvals', { ...input, imageId: 'sha256:' + 'a'.repeat(64) })).status).toBe(403)
    expect((await f.post('feature-packs/approvals', { ...input, packIds: ['invented:pack'] })).status).toBe(400)
    expect((await f.post('feature-packs/approvals', input, f.admin.token, key)).status).toBe(200)
    expect((await (await f.post('feature-packs/approvals', input, f.admin.token, key)).json()).replayed).toBe(true)
    expect((await f.post('feature-packs/approvals', input)).status).toBe(409)
    expect((await f.post('feature-packs/approvals', f.approval(undefined, 1, []))).status).toBe(200)
    expect((await f.post('feature-packs/approvals', input, f.admin.token, key)).status).toBe(409)
    expect(f.received).toHaveLength(0)
  })
  it('retains an accepted unknown result and recovers only the same durable command without duplicate native transitions', async () => {
    const f = await fixture(), input = await f.prepare(), key = randomUUID(); f.hooks.loseApply = true
    const response = await f.post('feature-packs/commands', input, f.admin.token, key); expect(response.status).toBe(202)
    const result = (await response.json()).data, native = await f.cells[0]!.worker.request('snapshot')
    expect(result.outcome).toBe('unconfirmed'); expect(native.command.phase).toBe('applied')
    expect(native.command.commandId).toBe(result.commandId)
    expect((await (await f.get(result.commandId)).json()).data.outcome).toBe('unconfirmed')
    const anotherPreview = await f.preview(), anotherPlan = (await (await f.post('feature-packs/preview', anotherPreview)).json()).data.plan
    expect((await f.post('feature-packs/commands', { ...input, ...anotherPreview, planDigest: anotherPlan.planDigest })).status).toBe(409)
    f.hooks.loseApply = false
    expect((await f.post('feature-commands/' + result.commandId + '/resume', { reason: '确认原命令最终结果', confirmed: true })).status).toBe(200)
    expect((await f.cells[0]!.worker.request('snapshot')).transitions).toEqual(native.transitions)
    const rows = await owner`select outcome from haas.feature_commands where tenant_id=${f.tenantId}`; expect(rows).toHaveLength(1); expect(rows[0]!.outcome).toBe('applied')
  })
  it.each(['approval', 'logout', 'binding'] as const)('does not report success when %s changes after native acceptance', async fault => {
    const f = await fixture(), input = await f.prepare()
    f.hooks.after = async operation => {
      if (operation !== 'feature.apply') return
      if (fault === 'approval') expect((await f.post('feature-packs/approvals', f.approval(undefined, 1, []))).status).toBe(200)
      else if (fault === 'logout') await f.identity.logout(f.admin.token, {}, context())
      else await owner`update haas.runtime_bindings set revision=${randomUUID()} where cell_id=${f.cells[0]!.pin.cellId}`
    }
    const response = await f.post('feature-packs/commands', input)
    expect(response.status).toBe(fault === 'approval' ? 403 : fault === 'logout' ? 401 : 503)
    expect(await response.json()).not.toHaveProperty('data')
    expect((await f.cells[0]!.worker.request('snapshot')).command.phase).toBe('applied')
    const [row] = await owner`select outcome,confirmation from haas.feature_commands where tenant_id=${f.tenantId}`
    expect(row).toMatchObject({ outcome: 'unconfirmed', confirmation: null })
  })
  it.each(['runtime.feature.requested', 'runtime.feature.authorized', 'runtime.feature.confirmed'] as const)('fails closed on %s audit failure and preserves any accepted intent', async action => {
    const f = await fixture(), input = await f.prepare()
    await owner.unsafe(`create function haas.reject_feature_audit() returns trigger language plpgsql as $$ begin if NEW.action = '${action}' then raise exception 'Explicit audit refusal'; end if; return NEW; end $$`)
    await owner`create trigger reject_feature_audit before insert on haas.audit_events for each row execute function haas.reject_feature_audit()`
    try {
      const response = await f.post('feature-packs/commands', input); expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty('data')
      const rows = await owner`select outcome from haas.feature_commands where tenant_id=${f.tenantId}`
      expect(rows).toHaveLength(action === 'runtime.feature.requested' ? 0 : 1)
      if (rows.length) expect(rows[0]!.outcome).toBe('unconfirmed')
      expect(f.received.filter(row => row.operation === 'feature.apply')).toHaveLength(action === 'runtime.feature.confirmed' ? 1 : 0)
    } finally { await owner`drop trigger reject_feature_audit on haas.audit_events`; await owner`drop function haas.reject_feature_audit()` }
  })
  it('enforces immutable command identity, non-null matching terminal receipts and role-limited updates in PostgreSQL', async () => {
    const f = await fixture(), input = await f.prepare(); f.hooks.loseApply = true
    const result = (await (await f.post('feature-packs/commands', input)).json()).data, id = result.commandId
    await expect(sql`update haas.feature_commands set target_user_id=${f.cells[1]!.member.userId} where command_id=${id}`).rejects.toBeDefined()
    await expect(sql`delete from haas.feature_commands where command_id=${id}`).rejects.toBeDefined()
    await expect(owner`update haas.feature_commands set target_user_id=${f.cells[1]!.member.userId} where command_id=${id}`).rejects.toBeDefined()
    for (const confirmation of [{}, { phase: 'applied', commandId: id }]) {
      await expect(sql`update haas.feature_commands set outcome='applied',confirmation=${sql.json(confirmation)},confirmed_at=clock_timestamp() where command_id=${id}`).rejects.toBeDefined()
    }
    f.hooks.loseApply = false
    expect((await f.post('feature-commands/' + id + '/resume', { reason: '确认准确原生回执', confirmed: true })).status).toBe(200)
    await expect(sql`update haas.feature_commands set confirmed_at=clock_timestamp() where command_id=${id}`).rejects.toBeDefined()
    await expect(owner`delete from haas.feature_commands where command_id=${id}`).rejects.toBeDefined()
  })
  it('rejects every entry after service close without creating approvals, commands or native requests', async () => {
    const f = await fixture(), input = await f.preview(); f.features.close()
    expect((await f.post('feature-packs/preview', input)).status).toBe(503)
    expect((await f.post('feature-packs/approvals', f.approval())).status).toBe(503)
    expect((await f.post('feature-packs/commands', {})).status).toBe(503)
    expect((await f.get(randomUUID())).status).toBe(503)
    expect(f.received).toHaveLength(0)
  })
  it('rejects a binding replacement during preview and a stale reviewed plan before accepting any durable command', async () => {
    const f = await fixture(), input = await f.prepare(), pin = f.cells[0]!.pin
    expect((await f.post('feature-packs/commands', { ...input, planDigest: 'sha256:' + 'b'.repeat(64) })).status).toBe(409)
    expect((await f.post('feature-packs/commands', { ...input, approvalRevision: 0 })).status).toBe(403)
    f.hooks.after = async operation => {
      if (operation === 'feature.plan') await owner`update haas.runtime_bindings set revision=${randomUUID()} where cell_id=${pin.cellId}`
    }
    expect((await f.post('feature-packs/commands', input)).status).toBe(503)
    expect(f.received.every(row => row.operation === 'feature.plan')).toBe(true)
    const [count] = await owner`select count(*)::int as value from haas.feature_commands where tenant_id=${f.tenantId}`; expect(count!.value).toBe(0)
  })
})
