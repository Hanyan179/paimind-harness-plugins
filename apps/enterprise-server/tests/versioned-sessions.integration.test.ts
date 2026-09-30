import { fork } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { createWriteStream, readFileSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { build } from 'esbuild'
import { afterAll, expect, it, vi } from 'vitest'
import { Identity } from '../src/identity.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { NativeGateway } from '../src/native-gateway.js'
import { Publications } from '../src/publications.js'
import { SessionCreation } from '../src/session-creation.js'
import { CellTransport } from '../src/cell-transport.js'
import { CellTransportDirectory } from '../src/cell-transport-directory.js'
import { RuntimeAdmission } from '../src/runtime-admission.js'
import { createEnterpriseServer } from '../src/server.js'
import { createNativeControlBroker } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'

const configPath = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!configPath || statSync(configPath).mode & 0o077) throw Error('Private isolated PostgreSQL required')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || ['3080', '5432', '10012', '55857', '57631'].includes(url.port)) throw Error('Unsafe session-read test database')
}
const owner = postgres(config.ownerUrl, { max: 2, onnotice: () => {} })
const sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
afterAll(async () => { await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })
const command = () => ({ key: randomUUID(), requestId: randomUUID() })
async function port() {
  const reservation = createServer()
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const address = reservation.address()
  if (!address || typeof address === 'string') throw Error('No isolated port')
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  return address.port
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
async function listenUnusedRuntimeOrigin(server: Server) {
  // Retained evidence DBs keep old immutable runtime origins. An OS-free
  // port may still be a historical identity; never repoint or delete it.
  for (let attempt = 0; attempt < 32; attempt += 1) {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('No ingress')
    const [prior] = await owner`select 1 from haas.runtime_bindings where origin=${'http://127.0.0.1:' + address.port}`
    if (!prior) return
    await close(server)
  }
  throw Error('No unused diagnostic runtime origin; prior identities preserved')
}
async function worker(directory: string, resume = false) {
  await mkdir(directory, { mode: 0o700, recursive: resume })
  const child = fork(fileURLToPath(new URL('./fixtures/full-native-worker.mjs', import.meta.url)), [], {
    cwd: directory, execPath: process.execPath, execArgv: [],
    env: { PATH: process.env.PATH, NODE_ENV: 'test', PAIMIND_NATIVE_PROCESS_TEST: '1', DSH_HOME: join(directory, 'home'), DSH_TELEMETRY_MODE: 'DISABLED' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'json',
  })
  const suffix = resume ? '-replacement-' + randomUUID() : ''
  child.stdout!.pipe(createWriteStream(join(directory, 'stdout' + suffix + '.log'), { flags: 'wx', mode: 0o600 }))
  child.stderr!.pipe(createWriteStream(join(directory, 'stderr' + suffix + '.log'), { flags: 'wx', mode: 0o600 }))
  const pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', () => {
      for (const call of pending.values()) { clearTimeout(call.timer); call.reject(Error('Owned native test process closed')) }
      pending.clear(); resolve()
    })
  })
  child.on('message', (reply: any) => {
    const call = pending.get(reply?.id)
    if (!call) return
    clearTimeout(call.timer); pending.delete(reply.id)
    if (reply.ok) call.resolve(reply.value); else call.reject(Error(reply.error))
  })
  return { request(method: string, input: object = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(Error('Native test command timeout: ' + method)) }, 20000)
      pending.set(id, { resolve, reject, timer })
      child.send({ id, method, input }, error => { if (error) { clearTimeout(timer); pending.delete(id); reject(error) } })
    })
  }, async crash() {
    expect(child.exitCode).toBeNull(); expect(child.signalCode).toBeNull()
    expect(child.kill('SIGKILL')).toBe(true); await closed
    expect(child.signalCode).toBe('SIGKILL')
    return { pid: child.pid, signal: child.signalCode }
  }, async cleanup() {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 10000)
    try { await closed } finally { clearTimeout(timer) }
  } }
}

it('serves owner-only reads, creation and durable turns through real PG and two native processes without duplicating native work', async () => {
  const directory = await mkdtemp(join(config.evidence, 'versioned-sessions-'))
  const cleanup: Array<() => unknown | Promise<unknown>> = []
  const tenantId = 'versioned-sessions-' + randomUUID(), password = 'Synthetic session-read password 2026'
  const receipts: object[] = [], reads: object[] = []
  let failure: unknown
  try {
    await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
    const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
    await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, command())
    const admin = (await identity.login({ username: 'morgan', password }, command())).token
    const adminLogout = command()
    cleanup.push(() => identity.logout(admin, {}, adminLogout))
    const cells = []
    for (const username of ['hansen', 'alex']) {
      const account = (await identity.createMember(admin, { username, displayName: username === 'hansen' ? 'Hansen' : 'Alex', password }, command())).data
      const token = (await identity.login({ username, password }, command())).token
      const logoutContext = command(), logout = () => identity.logout(token, {}, logoutContext)
      cleanup.push(logout)
      let ingress: ReturnType<typeof createNativeIngress>
      const broker = await createNativeControlBroker('/tmp', (input, signal) => ingress.checkOrigins(input, signal),
        (input, signal) => ingress.authorizeExecution(input, signal), (input, signal) => ingress.deriveOrigins(input, signal),
        (input, signal) => ingress.sealJobOrigins(input, signal), (input, signal) => ingress.readSkillEligibility(input, signal))
      cleanup.push(() => broker.close())
      const nativePort = await port(), key = randomBytes(32).toString('hex')
      ingress = createNativeIngress({ token: key, nativePort, control: (operation, input, signal) => broker.request(operation, input, signal) })
      cleanup.push(() => ingress.close()); await listenUnusedRuntimeOrigin(ingress.server)
      const address = ingress.server.address(); if (!address || typeof address === 'string') throw Error('No ingress')
      const origin = `http://127.0.0.1:${address.port}`, transport = new CellTransport(origin, key, nativePort)
      cleanup.push(() => transport.destroy())
      // Processes and native owners are real; these explicit diagnostic pins
      // do not claim final container/image or Browser E2E acceptance.
      const pin: PrivateRuntimeCell = { cellId: randomUUID(), tenantId, userId: account.userId, role: 'member', origin, revision: randomUUID(),
        containerId: randomBytes(32).toString('hex'), imageId: 'sha256:' + 'd'.repeat(64),
        volumeName: 'paimind-haas-member-fixture-' + randomUUID(), policyDigest: 'sha256:' + 'e'.repeat(64) }
      await owner`insert into haas.runtime_bindings (cell_id,tenant_id,user_id,origin,revision,isolation_mode,status,lease_expires_at,container_id,image_id,volume_name,policy_digest)
        values (${pin.cellId},${tenantId},${account.userId},${origin},${pin.revision},'container-managed','ready',clock_timestamp()+interval '10 minutes',
          ${pin.containerId},${pin.imageId},${pin.volumeName},${pin.policyDigest})`
      const process = await worker(join(directory, username)); cleanup.push(() => process.cleanup())
      const ready = await process.request('boot', { socketPath: broker.path, nativePort })
      expect(ready).toMatchObject({ fullWebProfile: true, originalProfileOwner: true })
      cells.push({ username, token, pin, transport, process, ready, logout, transportKey: key, nativePort, ingress, broker })
    }
    expect(new Set(cells.map(cell => cell.ready.pid)).size).toBe(2)
    const publicPort = await port(), publicOrigin = `http://127.0.0.1:${publicPort}`
    const bindings = new RuntimeBindings(sql, identity, publicOrigin, [], cells.map(cell => cell.pin))
    for (const cell of cells) await cell.transport.openOriginAuthority((input, signal) => bindings.checkInteractiveOrigins(cell.pin.cellId, input, signal),
      (input, signal) => bindings.authorizeInteractiveExecution(cell.pin.cellId, input, signal),
      (input, signal) => bindings.deriveInteractiveOrigins(cell.pin.cellId, input, signal),
      (input, signal) => bindings.sealJobOrigins(cell.pin.cellId, input, signal),
      (input, signal) => bindings.readSkillEligibility(cell.pin.cellId, input, signal))
    const transports = new CellTransportDirectory(new Map(cells.map(cell => [cell.pin.origin, cell.transport])), cells.map(cell => cell.pin))
    const eventFailures: object[] = []
    receipts.push({ kind: 'transport-failures', failures: eventFailures })
    const gateway = new NativeGateway({ publicOrigin, transports, onTransportFailure: entry => eventFailures.push(entry),
      resolve: (token, requestId) => bindings.resolve(token, requestId),
      sealInteractiveOrigin: (...args) => identity.sealInteractiveOrigin(...args),
      agentPresetEligibility: (token, requestId, grant, ids) => bindings.readAgentPresetEligibility(token, requestId, grant, ids),
      authorize: (token, requestId, grant, operation, verify) => identity.authorizeRuntimeOperation(token, requestId, grant, operation, verify) })
    cleanup.push(() => gateway.close())
    const server = createEnterpriseServer({ identity, publicOrigin, loopbackDevelopment: true, nativeGateway: gateway })
    await new Promise<void>(resolve => server.listen(publicPort, '127.0.0.1', resolve)); cleanup.push(() => close(server))
    const get = async (path: string, token?: string) => {
      const response = await fetch(publicOrigin + path, { headers: token ? { cookie: 'paimind_haas_session=' + token } : {}, signal: AbortSignal.timeout(15000) })
      const body = await response.json()
      reads.push({ path, status: response.status, body })
      expect(body.requestId).toBe(response.headers.get('x-request-id'))
      expect(response.headers.get('cache-control')).toBe('no-store')
      return { status: response.status, body }
    }
    const snapshots = []
    for (const cell of cells) {
      const presetId = cell.username + '-notes', sessionId = cell.username + '-session'
      const profile = await cell.process.request('createAgent', { id: presetId, name: cell.username + ' notes' })
      await cell.process.request('start', { sessionId, presetId })
      const source = await identity.sealInteractiveOrigin(cell.token, randomUUID(), {
        tenantId, userId: cell.pin.userId, role: 'member', cellId: cell.pin.cellId, nativeSessionId: sessionId,
      }, randomUUID())
      const before = await cell.process.request('prompt', { sessionId, source, mode: 'text' })
      snapshots.push({ cell, sessionId, before, profile })
      const list = await get('/haas/v1/sessions', cell.token)
      expect(list.status).toBe(200)
      expect(list.body.data.items.map((row: any) => row.sessionId)).toEqual([sessionId])
      expect(list.body.data.items[0].presetId).toBe(presetId)
      const history = await get('/haas/v1/sessions/' + sessionId, cell.token)
      expect(history.status).toBe(200)
      expect(history.body.data.sessionId).toBe(sessionId)
      expect(history.body.data.messages.some((row: any) => row.role === 'assistant' && row.text.includes('Explicit local diagnostic reply'))).toBe(true)
      const last = history.body.data.messages.at(-1).seq
      const earlier = await get('/haas/v1/sessions/' + sessionId + '?beforeSeq=' + last, cell.token)
      expect(earlier.status).toBe(200)
      expect(earlier.body.data.messages.every((row: any) => row.seq < last)).toBe(true)
    }
    const hansen = cells[0]!, alex = cells[1]!
    for (const [token, id] of [[hansen.token, 'alex-session'], [alex.token, 'hansen-session'], [hansen.token, 'unknown-session']]) {
      const denied = await get('/haas/v1/sessions/' + id, token)
      expect(denied.status).toBe(403)
      expect(denied.body.code).toBe('native-session-denied')
      const audit = await owner`select outcome,reason from haas.audit_events where tenant_id=${tenantId} and request_id=${denied.body.requestId} and action='runtime.operation'`
      expect(audit).toEqual([{ outcome: 'denied', reason: 'native-session-denied' }])
    }
    expect((await get('/haas/v1/sessions')).status).toBe(401)
    const otherTenant = 'session-other-' + randomUUID()
    await owner`insert into haas.tenants (tenant_id) values (${otherTenant})`
    const other = new Identity(sql, otherTenant, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
    await other.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, command())
    const foreign = (await other.login({ username: 'morgan', password }, command())).token
    cleanup.push(() => other.logout(foreign, {}, command()))
    expect((await get('/haas/v1/sessions/hansen-session', foreign)).status).toBe(401)
    for (const target of ['/haas/v1/sessions?beforeSeq=1', '/haas/v1/sessions/hansen-session?beforeSeq=0',
      '/haas/v1/sessions/hansen-session?beforeSeq=2&beforeSeq=3', '/haas/v1/sessions/hansen-session?userId=alex',
      '/haas/v1/sessions/%00', '/haas/v1/sessions/%2F', '/haas/v1/sessions/%E0%A4', '/haas/v1/sessions/' + 'x'.repeat(201)]) {
      expect((await get(target, hansen.token)).status).toBe(400)
    }
    const nativeLongId = 'x'.repeat(200)
    await hansen.process.request('start', { sessionId: nativeLongId, presetId: 'hansen-notes' })
    const longIdRead = await get('/haas/v1/sessions/' + nativeLongId, hansen.token)
    expect(longIdRead.status).toBe(200)
    expect(longIdRead.body.data.sessionId).toBe(nativeLongId)
    // HAAS-08: real authentication/private authority and the original native
    // approval owner. A counted local tool/model is explicit, not external I/O.
    const approvals: object[] = []; receipts.push({ kind: 'native-approval-carrier', calls: approvals })
    const nativePost = async (cell: typeof hansen, endpoint: string, message: object, token = cell.token) => {
      const response = await fetch(publicOrigin + '/api/' + endpoint, { method: 'POST', headers: { origin: publicOrigin,
        'content-type': 'application/json', cookie: 'paimind_haas_session=' + token }, body: JSON.stringify(message), signal: AbortSignal.timeout(15000) })
      return { status: response.status, body: await response.json() }
    }
    for (const cell of cells) for (const outcome of ['allowed-once', 'rejected']) {
      const sessionId = cell.username + '-approval-' + outcome, presetId = cell.username + '-notes'
      await cell.process.request('start', { sessionId, presetId })
      await cell.process.request('armPublicPrompt', { sessionId, approval: true })
      const sent = await nativePost(cell, 'session.prompt', { type: 'client-request', rpcId: randomUUID(), method: 'session.prompt',
        payload: { sessionId, mode: 'queue', content: [{ type: 'text', text: 'Explicit diagnostic approval test' }] } })
      expect(sent.status).toBe(200); expect(sent.body.result.ok).toBe(true)
      let before: any
      await vi.waitFor(async () => { before = await cell.process.request('approvalState', { sessionId }); expect(before.state?.answerable).toBe(true) }, { timeout: 6000 })
      expect(before.bodies).toHaveLength(0); expect(before.decisions).toHaveLength(0)
      expect(await cell.process.request('unsignedApproval', { sessionId, approvalId: before.state.approvalId, rpcId: before.state.rpcId })).toEqual({ accepted: false, reason: 'bad-response' })
      const response = { type: 'client-response', rpcId: before.state.rpcId,
        result: { ok: true, value: { sessionId, approvalId: before.state.approvalId, outcome } } }
      const other = cells.find(entry => entry !== cell)!
      const foreign = await nativePost(other, 'respond', response)
      expect(foreign.status).toBe(403)
      const audited = await owner`select outcome from haas.audit_events where tenant_id=${tenantId} and request_id=${foreign.body.requestId} and action='runtime.operation'`
      expect(audited.some(row => row.outcome === 'denied')).toBe(true)
      expect((await cell.process.request('approvalState', { sessionId })).state.version).toBe(before.state.version)
      const replies = await Promise.all([nativePost(cell, 'respond', response), nativePost(cell, 'respond', response)])
      expect(replies.filter(reply => reply.status === 200 && reply.body.accepted === true)).toHaveLength(1)
      expect(replies.every(reply => reply.status === 200 || reply.status === 409)).toBe(true)
      await cell.process.request('settlePublicPrompt', { sessionId })
      const after = await cell.process.request('approvalState', { sessionId })
      expect(after.bodies).toHaveLength(outcome === 'allowed-once' ? 1 : 0)
      expect(after.decisions).toEqual([{ id: before.state.approvalId, outcome }])
      expect(after.state).toMatchObject({ answerable: false, rpcId: null, outcome })
      expect(after.state.version).not.toBe(before.state.version)
      expect((await nativePost(cell, 'respond', response)).status).toBe(409)
      approvals.push({ sessionId, outcome, before, replies, after, foreignStatus: foreign.status, audited })
    }
    let recoverApprovals: ((next: Awaited<ReturnType<typeof worker>>) => Promise<void>) | undefined
    let prepareApprovalCrash: (() => Promise<void>) | undefined
    {
    const publicApprovals: object[] = []; receipts.push({ kind: 'versioned-approval-commands', calls: publicApprovals })
    const recoverable: Array<{ sessionId: string; approvalId: string; input: object; key: string; receipt: any; before: any;
      consumedBeforeStorage?: { operationId: string; response: Promise<any>; fault: any; carrierAccepted: boolean } }> = []
    const decideApproval = async (cell: typeof hansen, sessionId: string, approvalId: string, value: object, key = randomUUID(), token = cell.token) => {
      const response = await fetch(publicOrigin + '/haas/v1/sessions/' + sessionId + '/approvals/' + approvalId, { method: 'POST',
        headers: { origin: publicOrigin, 'content-type': 'application/json', cookie: 'paimind_haas_session=' + token, 'idempotency-key': key },
        body: JSON.stringify(value), signal: AbortSignal.timeout(15000) })
      const body = await response.json(); expect(response.headers.get('cache-control')).toBe('no-store')
      expect(body.requestId).toBe(response.headers.get('x-request-id'))
      publicApprovals.push({ sessionId, status: response.status, body }); return { status: response.status, body }
    }
    const approvalWrites = vi.spyOn(gateway, 'submitSessionApproval')
    for (const cell of cells) for (const decision of ['approve', 'reject'] as const) {
      const sessionId = cell.username + '-public-approval-' + decision
      await cell.process.request('start', { sessionId, presetId: cell.username + '-notes' })
      await cell.process.request('armPublicPrompt', { sessionId, approval: true })
      expect((await nativePost(cell, 'session.prompt', { type: 'client-request', rpcId: randomUUID(), method: 'session.prompt',
        payload: { sessionId, mode: 'queue', content: [{ type: 'text', text: 'Public approval diagnostic request' }] } })).status).toBe(200)
      let pending: any
      await vi.waitFor(async () => { pending = await cell.process.request('approvalState', { sessionId }); expect(pending.state?.answerable).toBe(true) }, { timeout: 6000 })
      const approvalId = pending.state.approvalId, key = randomUUID(), input = { decision, expectedVersion: pending.state.version, reason: '核对本地诊断工具再决定' }
      expect(pending.bodies).toHaveLength(0)
      expect((await decideApproval(cell, sessionId, approvalId, { ...input, expectedVersion: randomBytes(32).toString('base64url') })).status).toBe(409)
      expect((await decideApproval(cell, sessionId, approvalId, { ...input, reason: 'x' })).status).toBe(400)
      expect((await decideApproval(cell, sessionId, approvalId, { ...input, userId: cell.pin.userId })).status).toBe(400)
      expect((await decideApproval(cell, sessionId, approvalId, input, randomUUID(), cells.find(other => other !== cell)!.token)).status).toBe(403)
      expect((await decideApproval(cell, sessionId, approvalId, input, randomUUID(), foreign)).status).toBe(401)
      expect((await decideApproval(cell, sessionId, approvalId, input, randomUUID(), '')).status).toBe(401)
      const beforeWrites = approvalWrites.mock.calls.length
      const accepted = await Promise.all([decideApproval(cell, sessionId, approvalId, input, key), decideApproval(cell, sessionId, approvalId, input, key)])
      expect(accepted.some(row => row.status === 200 && row.body.data.carrierAccepted)).toBe(true)
      expect(accepted.every(row => [200, 202].includes(row.status))).toBe(true)
      expect(new Set(accepted.map(row => row.body.operationId)).size).toBe(1)
      await cell.process.request('settlePublicPrompt', { sessionId })
      const after = await cell.process.request('approvalState', { sessionId }), writes = approvalWrites.mock.calls.length
      expect(writes - beforeWrites).toBeLessThanOrEqual(2)
      expect(after.bodies).toHaveLength(decision === 'approve' ? 1 : 0); expect(after.decisions).toHaveLength(1)
      const replay = await decideApproval(cell, sessionId, approvalId, input, key)
      expect(replay.status).toBe(200); expect(replay.body).toMatchObject({ operationId: accepted[0]!.body.operationId, replayed: true,
        data: { decision, carrierAccepted: true, decisionPersisted: true, executionComplete: false, runtimeGrant: false,
          observation: { outcome: decision === 'approve' ? 'allowed-once' : 'rejected', answerable: false, persisted: true } } })
      expect(approvalWrites.mock.calls.length).toBe(writes)
      expect(JSON.stringify(replay)).not.toContain(pending.state.rpcId)
      expect((await decideApproval(cell, sessionId, approvalId, { ...input, decision: decision === 'approve' ? 'reject' : 'approve' }, key)).status).toBe(409)
      expect((await decideApproval(cell, sessionId, approvalId, { ...input, reason: '改写旧命令原因应被拒绝' }, key)).status).toBe(409)
      const rows = await owner`select decision,reason,carrier_accepted from haas.session_approval_commands where tenant_id=${tenantId} and command_id=${replay.body.operationId}`
      expect(rows).toEqual([{ decision, reason: input.reason, carrier_accepted: true }])
      const audit = await owner`select actor_user_id,reason from haas.audit_events where tenant_id=${tenantId} and target_id=${replay.body.operationId} and action='session.approval.requested'`
      expect(audit.some(row => row.actor_user_id === cell.pin.userId && row.reason === input.reason)).toBe(true)
      if (cell === hansen) recoverable.push({ sessionId, approvalId, input, key, receipt: replay,
        before: await cell.process.request('commandReadState', { sessionId }) })
    }
    const oppositeId = 'hansen-public-opposite-decisions'
    await hansen.process.request('start', { sessionId: oppositeId, presetId: 'hansen-notes' })
    await hansen.process.request('armPublicPrompt', { sessionId: oppositeId, approval: true })
    await nativePost(hansen, 'session.prompt', { type: 'client-request', rpcId: randomUUID(), method: 'session.prompt', payload: {
      sessionId: oppositeId, mode: 'queue', content: [{ type: 'text', text: 'Concurrent opposite decisions diagnostic' }] } })
    let oppositeBefore: any
    await vi.waitFor(async () => { oppositeBefore = await hansen.process.request('approvalState', { sessionId: oppositeId }); expect(oppositeBefore.state?.answerable).toBe(true) }, { timeout: 6000 })
    const opposite = await Promise.all(['approve', 'reject'].map(decision => decideApproval(hansen, oppositeId, oppositeBefore.state.approvalId,
      { decision, expectedVersion: oppositeBefore.state.version, reason: '验证相反决定竞态只消费一次' })))
    expect(opposite.map(row => row.status).sort()).toEqual([200, 409])
    const winner = opposite.find(row => row.status === 200)!.body.data.decision
    await hansen.process.request('settlePublicPrompt', { sessionId: oppositeId })
    const oppositeAfter = await hansen.process.request('approvalState', { sessionId: oppositeId })
    expect(oppositeAfter.decisions).toHaveLength(1); expect(oppositeAfter.bodies).toHaveLength(winner === 'approve' ? 1 : 0)
    // Drop the actual positive response after the original owner consumed it.
    // Same native outcome cannot prove this command's causal ownership.
    const lostId = 'hansen-public-approval-lost'
    await hansen.process.request('start', { sessionId: lostId, presetId: 'hansen-notes' })
    await hansen.process.request('armPublicPrompt', { sessionId: lostId, approval: true })
    await nativePost(hansen, 'session.prompt', { type: 'client-request', rpcId: randomUUID(), method: 'session.prompt', payload: {
      sessionId: lostId, mode: 'queue', content: [{ type: 'text', text: 'Lost approval acknowledgement diagnostic' }] } })
    let lostBefore: any
    await vi.waitFor(async () => { lostBefore = await hansen.process.request('approvalState', { sessionId: lostId }); expect(lostBefore.state?.answerable).toBe(true) }, { timeout: 6000 })
    const originalSubmitApproval = gateway.submitSessionApproval.bind(gateway), lostKey = randomUUID()
    approvalWrites.mockImplementationOnce(async (...args) => { const result = await originalSubmitApproval(...args); expect(result).toBe(true); throw Error('Explicit lost carrier acknowledgement after native acceptance') })
    const lostInput = { decision: 'approve', expectedVersion: lostBefore.state.version, reason: '验证丢回包不重复执行' }
    const lost = await decideApproval(hansen, lostId, lostBefore.state.approvalId, lostInput, lostKey)
    expect(lost.status).toBe(202); expect(lost.body.data.carrierAccepted).toBe(false)
    await hansen.process.request('settlePublicPrompt', { sessionId: lostId })
    const lossWrites = approvalWrites.mock.calls.length
    const lostReplay = await decideApproval(hansen, lostId, lostBefore.state.approvalId, lostInput, lostKey)
    expect(lostReplay.status).toBe(202); expect(lostReplay.body.operationId).toBe(lost.body.operationId)
    expect(lostReplay.body.data).toMatchObject({ carrierAccepted: false, decisionPersisted: null,
      observation: { outcome: 'allowed-once', answerable: false, persisted: true } })
    expect(approvalWrites.mock.calls.length).toBe(lossWrites)
    expect((await hansen.process.request('approvalState', { sessionId: lostId })).bodies).toHaveLength(1)
    recoverable.push({ sessionId: lostId, approvalId: lostBefore.state.approvalId, input: lostInput, key: lostKey, receipt: lostReplay,
      before: await hansen.process.request('commandReadState', { sessionId: lostId }) })
    await expect(sql`update haas.session_approval_commands set decision='reject' where tenant_id=${tenantId}`).rejects.toBeDefined()
    await expect(owner`update haas.session_approval_commands set carrier_accepted=false,acknowledged_at=null where tenant_id=${tenantId} and carrier_accepted=true`).rejects.toBeDefined()
    approvalWrites.mockRestore()
    prepareApprovalCrash = async () => {
      const sessionId = 'hansen-public-approval-consumed-crash'
      await hansen.process.request('start', { sessionId, presetId: 'hansen-notes' })
      await hansen.process.request('armPublicPrompt', { sessionId, approval: true })
      expect((await nativePost(hansen, 'session.prompt', { type: 'client-request', rpcId: randomUUID(), method: 'session.prompt',
        payload: { sessionId, mode: 'queue', content: [{ type: 'text', text: 'Approval consumed but decision write interrupted by an actual process crash' }] } })).status).toBe(200)
      let pending: any
      await vi.waitFor(async () => { pending = await hansen.process.request('approvalState', { sessionId }); expect(pending.state?.answerable).toBe(true) }, { timeout: 6000 })
      expect(pending.bodies).toHaveLength(0)
      const key = randomUUID(), input = { decision: 'approve', expectedVersion: pending.state.version, reason: '原生答复已消费而决定尚未落盘时真实中断' }
      const before = await hansen.process.request('holdApprovalDecisionWriteForCrash', { sessionId, approvalId: pending.state.approvalId })
      const response = decideApproval(hansen, sessionId, pending.state.approvalId, input, key)
      let fault: any
      await vi.waitFor(async () => {
        fault = await hansen.process.request('approvalCrashProbe')
        expect(fault.held).toBe(true)
      }, { timeout: 6000 })
      expect(fault).toMatchObject({ pid: before.pid, rawSha256: before.rawSha256, liveDecisions: ['allowed-once'], storedDecisions: [], bodies: 0 })
      const [row] = await owner`select command_id,carrier_accepted from haas.session_approval_commands where tenant_id=${tenantId} and idempotency_key=${key}`
      recoverable.push({ sessionId, approvalId: pending.state.approvalId, key, input, receipt: undefined, before,
        consumedBeforeStorage: { operationId: row!.command_id, response, fault, carrierAccepted: row!.carrier_accepted } })
    }
    recoverApprovals = async next => {
      const writes = vi.spyOn(gateway, 'submitSessionApproval')
      try {
        for (const item of recoverable) {
          if (item.consumedBeforeStorage) {
            const response = await item.consumedBeforeStorage.response
            // Carrier ACK may win the race with the held physical write. That
            // is not a persisted decision. Otherwise the interrupted read is
            // an explicit upstream failure, never a fabricated success.
            expect([200, 502]).toContain(response.status)
            const [row] = await owner`select carrier_accepted from haas.session_approval_commands
              where tenant_id=${tenantId} and command_id=${item.consumedBeforeStorage.operationId}`
            item.consumedBeforeStorage.carrierAccepted = row!.carrier_accepted
            expect(row!.carrier_accepted).toBe(response.status === 200)
            if (response.status === 200) expect(response.body.data).toMatchObject({ carrierAccepted: true, decisionPersisted: null,
              executionComplete: false, runtimeGrant: false, observation: { persisted: false } })
            receipts.push({ kind: 'approval-consumed-before-storage-crash', fault: item.consumedBeforeStorage.fault, response,
              operationId: item.consumedBeforeStorage.operationId })
          }
          const before = await next.request('commandReadState', { sessionId: item.sessionId })
          expect(before).toMatchObject({ live: false, rawSha256: item.before.rawSha256, modelCalls: 0, nativeCreateCalls: 0 })
          const replay = await decideApproval(hansen, item.sessionId, item.approvalId, item.input, item.key)
          expect(replay.status).toBe(item.consumedBeforeStorage ? item.consumedBeforeStorage.carrierAccepted ? 200 : 202 : item.receipt.status)
          expect(replay.body.operationId).toBe(item.consumedBeforeStorage?.operationId ?? item.receipt.body.operationId)
          expect(replay.body.data).toMatchObject({ carrierAccepted: item.consumedBeforeStorage ? item.consumedBeforeStorage.carrierAccepted : item.receipt.body.data.carrierAccepted,
            decisionPersisted: item.consumedBeforeStorage ? null : item.receipt.body.data.decisionPersisted, executionComplete: false, runtimeGrant: false,
            observation: { answerable: false } })
          if (item.consumedBeforeStorage) expect(replay.body.data.observation).toMatchObject({ outcome: null, persisted: false })
          const after = await next.request('commandReadState', { sessionId: item.sessionId })
          expect(after).toMatchObject({ live: false, rawSha256: before.rawSha256, modelCalls: 0, nativeCreateCalls: 0 })
          receipts.push({ kind: 'approval-process-crash-readonly-recovery', sessionId: item.sessionId,
            oldPid: hansen.ready.pid, before, replay, after,
            fault: item.consumedBeforeStorage ? 'original-consumed-decision-write-not-committed' : 'terminal-original-decision' })
        }
        expect(writes).not.toHaveBeenCalled()
      } finally { writes.mockRestore() }
    }
    }
    // Public HAAS-05/07 turn commands use real current login authority, PG,
    // private transport and original native prompt/persistence, never a mock
    // session service. Separate test sessions preserve earlier read baselines.
    const turnReceipts: object[] = []
    receipts.push({ kind: 'versioned-turns', calls: turnReceipts })
    const postTurn = async (cell: typeof hansen, sessionId: string, input: object, key: string, token = cell.token) => {
      const result = await fetch(publicOrigin + '/haas/v1/sessions/' + sessionId + '/turns', {
        method: 'POST', headers: { origin: publicOrigin, cookie: 'paimind_haas_session=' + token,
          'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(input), signal: AbortSignal.timeout(20000) })
      const body = await result.json()
      turnReceipts.push({ sessionId, status: result.status, body })
      return { status: result.status, body }
    }
    // HAAS-06 original events: real public HTTP, authentication, PG, original
    // mux and private owner reads. These are not final image/browser claims.
    const eventSessionId = 'hansen-events', eventReceipts: object[] = []
    receipts.push({ kind: 'versioned-events', calls: eventReceipts })
    await hansen.process.request('start', { sessionId: eventSessionId, presetId: 'hansen-notes' })
    const eventPrompt = async () => {
      const before = await get('/haas/v1/sessions/' + eventSessionId, hansen.token)
      await hansen.process.request('armPublicPrompt', { sessionId: eventSessionId })
      const reply = await postTurn(hansen, eventSessionId, { text: 'Event continuation Hansen', expectedVersion: before.body.data.version }, randomUUID())
      expect(reply.body.data.outcome, JSON.stringify(reply)).toBe('accepted')
      return hansen.process.request('settlePublicPrompt', { sessionId: eventSessionId })
    }
    await eventPrompt()
    const eventStream = async (sessionId: string, token: string, cursor?: string) => {
      const controller = new AbortController()
      const response = await fetch(publicOrigin + '/haas/v1/sessions/' + sessionId + '/events', {
        headers: { cookie: 'paimind_haas_session=' + token, ...(cursor === undefined ? {} : { 'last-event-id': cursor }) },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      if (response.status !== 200) {
        const body = await response.json(); eventReceipts.push({ sessionId, status: response.status, body })
        return { status: response.status, body }
      }
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      expect(response.headers.get('cache-control')).toBe('no-store')
      const frames: Array<{ cursor: string; event: any }> = [], reader = response.body!.getReader(), decoder = new TextDecoder()
      let text = '', ready = 0, ended = false
      const finished = (async () => {
        try {
          for (;;) {
            const chunk = await reader.read(); if (chunk.done) break
            text += decoder.decode(chunk.value, { stream: true })
            for (let boundary; (boundary = text.indexOf('\n\n')) !== -1;) {
              const frame = text.slice(0, boundary); text = text.slice(boundary + 2)
              if (frame === ': ready') { ready++; continue }
              const lines = frame.split('\n'), id = lines.find(line => line.startsWith('id: ')), data = lines.find(line => line.startsWith('data: '))
              if (id && data) frames.push({ cursor: id.slice(4), event: JSON.parse(data.slice(6)) })
            }
          }
        } catch (error) { if (!controller.signal.aborted) eventReceipts.push({ kind: 'server-ended-stream', error: error instanceof Error ? error.message : String(error) }) }
        finally { ended = true; reader.releaseLock() }
      })()
      const stop = async () => { controller.abort(); await finished }
      cleanup.push(stop)
      eventReceipts.push({ sessionId, status: response.status, frames })
      return { status: response.status, frames, ready: () => ready, ended: () => ended, stop }
    }
    const privateEvents = await hansen.transport.requestControl('session.events', { sessionId: eventSessionId, afterSeq: -1 })
    expect(privateEvents).toMatchObject({ sessionId: eventSessionId, cursorMatched: true })
    const initialEvents = await eventStream(eventSessionId, hansen.token)
    expect(initialEvents.status, JSON.stringify(eventFailures)).toBe(200)
    await vi.waitFor(() => expect(initialEvents.ready!()).toBeGreaterThan(0))
    const initialFrames = initialEvents.frames!, initialCount = initialFrames.length
    expect(initialCount).toBeGreaterThan(0)
    expect(initialFrames.map(frame => frame.event.data.seq)).toEqual(Array.from({ length: initialCount }, (_, n) => n))
    expect(initialFrames.every(frame => frame.event.id === frame.cursor && frame.event.sessionId === eventSessionId && !Number.isNaN(Date.parse(frame.event.occurredAt)))).toBe(true)
    expect(initialFrames.some(frame => frame.event.type === 'turn.delta' && frame.event.data.kind === 'assistant.message' && frame.event.data.text.includes('Explicit local diagnostic reply'))).toBe(true)
    const firstCursor = initialFrames.at(-1)!.cursor
    await eventPrompt()
    await vi.waitFor(() => expect(initialFrames.filter(frame => frame.event.type === 'turn.completed')).toHaveLength(2), { timeout: 5000 })
    expect(initialFrames.map(frame => frame.event.data.seq)).toEqual(Array.from({ length: initialFrames.length }, (_, n) => n))
    expect(JSON.stringify(initialFrames)).not.toMatch(/paimind-origin-v1|requestConfig|"rpcId"|"reasoning"/u)
    await initialEvents.stop!()
    const eventSnapshot = await hansen.process.request('snapshot', { sessionId: eventSessionId })
    const replayEvents = await eventStream(eventSessionId, hansen.token, firstCursor)
    await vi.waitFor(() => expect(replayEvents.ready!()).toBeGreaterThan(0))
    expect(replayEvents.frames).toEqual(initialFrames.slice(initialCount)); await replayEvents.stop!()
    expect((await hansen.process.request('snapshot', { sessionId: eventSessionId })).rawSha256).toBe(eventSnapshot.rawSha256)
    expect((await eventStream(eventSessionId, alex.token)).status).toBe(403)
    expect((await eventStream('alex-session', alex.token, firstCursor)).status).toBe(409)
    expect((await eventStream(eventSessionId, hansen.token, 'malformed')).status).toBe(409)
    expect((await eventStream(eventSessionId, foreign)).status).toBe(401)
    expect((await get('/haas/v1/sessions/' + eventSessionId + '/events?cursor=forged', hansen.token)).status).toBe(400)
    const streamLogin = (await identity.login({ username: 'hansen', password }, command())).token
    const logoutStream = command(); cleanup.push(() => identity.logout(streamLogin, {}, logoutStream))
    const revokedEvents = await eventStream(eventSessionId, streamLogin, initialFrames.at(-1)!.cursor)
    await vi.waitFor(() => expect(revokedEvents.ready!()).toBeGreaterThan(0))
    const concurrentEvents = await eventStream(eventSessionId, hansen.token, initialFrames.at(-1)!.cursor)
    await vi.waitFor(() => expect(concurrentEvents.ready!()).toBeGreaterThan(0))
    expect((await eventStream(eventSessionId, hansen.token)).status).toBe(503)
    await concurrentEvents.stop!()
    await identity.logout(streamLogin, {}, logoutStream)
    await vi.waitFor(() => expect(revokedEvents.ended!()).toBe(true), { timeout: 5000 })
    expect(revokedEvents.frames).toEqual([])
    expect((await eventStream(eventSessionId, streamLogin)).status).toBe(401)
    const afterCapacity = await eventStream(eventSessionId, hansen.token, initialFrames.at(-1)!.cursor)
    await vi.waitFor(() => expect(afterCapacity.ready!()).toBeGreaterThan(0)); await afterCapacity.stop!()
    eventReceipts.push({ kind: 'read-only-and-revocation', rawSha256: eventSnapshot.rawSha256, noDuplicateSequences: true, noRawSource: true })

    const turnCommands = []
    for (const cell of cells) {
      const sessionId = cell.username + '-turn'
      await cell.process.request('start', { sessionId, presetId: cell.username + '-notes' })
      const before = await get('/haas/v1/sessions/' + sessionId, cell.token)
      expect(before.status).toBe(200)
      expect(before.body.data.version).toMatch(/^[A-Za-z0-9_-]{43}$/u)
      const input = { text: '  Private turn marker ' + cell.username + '\n保留空白\n', expectedVersion: before.body.data.version }, key = randomUUID()
      await cell.process.request('armPublicPrompt', { sessionId })
      const concurrent = await Promise.all([postTurn(cell, sessionId, input, key), postTurn(cell, sessionId, input, key)])
      expect(concurrent.map(value => value.status), JSON.stringify(concurrent)).toEqual([202, 202])
      expect(concurrent.every(value => value.body.data.outcome === 'accepted'), JSON.stringify(concurrent)).toBe(true)
      expect(new Set(concurrent.map(value => value.body.operationId)).size).toBe(1)
      const settled = await cell.process.request('settlePublicPrompt', { sessionId })
      expect(settled.endings).toEqual(['completed'])
      expect(settled.calls.filter((call: any) => call.sessionId === sessionId)).toHaveLength(1)
      expect(settled.replies).toEqual(['Explicit local diagnostic reply; no external model'])
      const replay = await postTurn(cell, sessionId, input, key)
      expect(replay.body).toMatchObject({ replayed: true, operationId: concurrent[0]!.body.operationId,
        data: { outcome: 'accepted', executionComplete: false, runtimeGrant: false } })
      expect((await cell.process.request('snapshot', { sessionId })).rawSha256).toBe(settled.rawSha256)
      const changed = await postTurn(cell, sessionId, { ...input, text: 'different' }, key)
      expect(changed.status).toBe(409); expect(changed.body.code).toBe('idempotency-conflict')
      const stale = await postTurn(cell, sessionId, input, randomUUID())
      expect(stale.status).toBe(409); expect(stale.body.code).toBe('session-version-conflict')
      const foreign = await postTurn(cell, sessionId, input, randomUUID(), cell === hansen ? alex.token : hansen.token)
      expect(foreign.status).toBe(403)
      for (const invalid of [{ text: '', expectedVersion: input.expectedVersion }, { ...input, expectedVersion: 'forged' },
        { ...input, userId: cell.pin.userId }, { ...input, text: 'x'.repeat(65537) }]) {
        expect((await postTurn(cell, sessionId, invalid, randomUUID())).status).toBe(400)
      }
      turnCommands.push({ cell, sessionId, input, key, settled })
    }
    const selected = turnCommands[0]!
    const fresh = await get('/haas/v1/sessions/' + selected.sessionId, hansen.token)
    const lostInput = { text: 'Lost acknowledgement marker, native insertion must stay unique', expectedVersion: fresh.body.data.version }, lostTurnKey = randomUUID()
    const nativeSubmit = gateway.submitSessionTurn.bind(gateway)
    const lostAck = vi.spyOn(gateway, 'submitSessionTurn').mockImplementationOnce(async (...args) => {
      expect(await nativeSubmit(...args)).toBe(true)
      throw Error('Explicit lost acknowledgement after actual native durable admission')
    })
    await hansen.process.request('armPublicPrompt', { sessionId: selected.sessionId })
    const unknown = await postTurn(hansen, selected.sessionId, lostInput, lostTurnKey)
    expect(unknown.status).toBe(202); expect(unknown.body.data.outcome).toBe('unconfirmed')
    lostAck.mockRestore()
    const afterLoss = await hansen.process.request('settlePublicPrompt', { sessionId: selected.sessionId })
    const recoveredTurn = await postTurn(hansen, selected.sessionId, lostInput, lostTurnKey)
    expect(recoveredTurn.body).toMatchObject({ operationId: unknown.body.operationId, replayed: true, data: { outcome: 'accepted' } })
    expect((await hansen.process.request('snapshot', { sessionId: selected.sessionId })).rawSha256).toBe(afterLoss.rawSha256)
    const freshLogin = (await identity.login({ username: 'hansen', password }, command())).token
    await identity.logout(freshLogin, {}, command())
    expect((await postTurn(hansen, selected.sessionId, lostInput, lostTurnKey, freshLogin)).status).toBe(401)
    const turnRows = await owner`select * from haas.session_turn_commands where tenant_id=${tenantId} order by created_at`
    expect(turnRows).toHaveLength(5) // Two event-stream prompts plus the three existing turn-command cases.
    expect(turnRows.every(row => row.outcome === 'accepted' && row.native_message_id && Number(row.native_seq) >= 0)).toBe(true)
    const auditRows = await owner`select * from haas.audit_events where tenant_id=${tenantId} and action like 'session.turn.%'`
    expect(JSON.stringify([turnRows, auditRows])).not.toContain('Private turn marker')
    expect(JSON.stringify([turnRows, auditRows])).not.toContain('Lost acknowledgement marker')
    await expect(sql`update haas.session_turn_commands set native_message_id='forged' where tenant_id=${tenantId}`).rejects.toBeDefined()
    await expect(owner`update haas.session_turn_commands set outcome='unconfirmed',confirmed_at=null,native_message_id=null,native_seq=null where tenant_id=${tenantId}`).rejects.toBeDefined()
    receipts.push({ kind: 'turn-native-evidence', turnRows, durableReplayRawSha256: afterLoss.rawSha256,
      members: turnCommands.map(({ cell, sessionId, settled }) => ({ name: cell.username, pid: cell.ready.pid, sessionId,
        rawSha256: settled.rawSha256, replies: settled.replies, completedTurns: settled.endings.length })),
      signedCurrentAuthority: true, messageBodiesAbsentFromCommandAndAuditTables: true, immutableAcceptedRecords: true })
    // HAAS-05/07 creation uses the original native Workspace and adopted
    // publication. Real governed resources, not a second session catalogue.
    const publications = new Publications(identity, (...args) => gateway.readAgentPublication(...args), (...args) => gateway.adoptAgentPublication(...args))
    const profile = snapshots[0]!.profile
    const submitted = (await publications.submit(hansen.token, { presetId: 'hansen-notes', expectedVersion: profile.configVersion, reason: '验证版本化会话创建' }, command())).data
    const published = (await publications.review(admin, submitted.publicationId, { decision: 'publish', expectedRevision: submitted.revision, reason: '批准准确原生版本' }, command())).data
    let assigned = (await publications.assign(admin, published.publicationId, { subjectKind: 'user', subjectId: hansen.pin.userId,
      effect: 'allow', active: true, expectedRevision: published.revision, reason: '仅分配给 Hansen 验证' }, command())).data
    await publications.adopt(hansen.token, assigned.publicationId, { expectedRevision: assigned.revision, expectedDigest: assigned.digest }, command())
    const workspaceReply = await fetch(publicOrigin + '/api/workspace.create', { method: 'POST', headers: { origin: publicOrigin,
      cookie: 'paimind_haas_session=' + hansen.token, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: 'workspace.create', payload: { path: join(directory, 'hansen') } }) })
    expect(workspaceReply.status).toBe(200)
    const workspaceEnvelope = await workspaceReply.json()
    expect(workspaceEnvelope.result.ok).toBe(true)
    const input = { workspaceId: workspaceEnvelope.result.value.workspace.workspaceId, agentId: 'hansen-notes',
      releaseId: assigned.publicationId, configVersion: profile.configVersion }
    const key = randomUUID(), creations: object[] = []
    receipts.push({ kind: 'session-creation-requests', creations })
    const postCreate = async (selected: object = input, actorToken = hansen.token, idempotencyKey = key) => {
      const result = await fetch(publicOrigin + '/haas/v1/sessions', { method: 'POST', headers: { origin: publicOrigin,
        cookie: 'paimind_haas_session=' + actorToken, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify(selected), signal: AbortSignal.timeout(20000) })
      const body = await result.json(); creations.push({ status: result.status, body }); return { status: result.status, body }
    }
    const nativeCreate = gateway.sessionCreation.bind(gateway)
    let concurrentWrites = 0
    const concurrentProbe = vi.spyOn(gateway, 'sessionCreation').mockImplementation(async (...args) => {
      const result = await nativeCreate(...args)
      if (result.dispatched) concurrentWrites++
      return result
    })
    const concurrently = await Promise.all(Array.from({ length: 5 }, () => postCreate()))
    expect(concurrently.every(row => [201, 202].includes(row.status)), JSON.stringify(concurrently)).toBe(true)
    const created = await postCreate()
    expect(created.status).toBe(201)
    expect(created.body.replayed).toBe(true)
    expect(concurrentWrites).toBe(1)
    concurrentProbe.mockRestore()
    expect(new Set(concurrently.map(row => row.body.data.sessionId)).size).toBe(1)
    const createdId = created.body.data.sessionId
    const governedTurnId = 'hansen-published-turn', governedTurnKey = randomUUID()
    await hansen.process.request('start', { sessionId: governedTurnId, presetId: created.body.data.presetId })
    const governedHistory = await get('/haas/v1/sessions/' + governedTurnId, hansen.token)
    const governedTurnInput = { text: 'Explicit approved native publication turn', expectedVersion: governedHistory.body.data.version }
    await hansen.process.request('armPublicPrompt', { sessionId: governedTurnId })
    const governedLoss = vi.spyOn(gateway, 'submitSessionTurn').mockImplementationOnce(async (...args) => {
      expect(await nativeSubmit(...args)).toBe(true)
      throw Error('Explicit durable turn acknowledgement loss before native process replacement')
    })
    const pendingTurn = await postTurn(hansen, governedTurnId, governedTurnInput, governedTurnKey)
    expect(pendingTurn.body.data.outcome, JSON.stringify(pendingTurn)).toBe('unconfirmed')
    governedLoss.mockRestore()
    const governedTurnBefore = await hansen.process.request('settlePublicPrompt', { sessionId: governedTurnId })
    expect(governedTurnBefore.endings).toEqual(['completed'])
    const originalCreated = await hansen.process.request('commandReadState', { sessionId: createdId })
    expect(originalCreated.nativeCreateCalls).toBe(1)
    const restartedOwner = new SessionCreation(identity, gateway)
    expect((await restartedOwner.create(hansen.token, input, { key, requestId: randomUUID() }, new AbortController().signal)).data.sessionId).toBe(createdId)
    expect((await hansen.process.request('commandReadState', { sessionId: createdId })).rawSha256).toBe(originalCreated.rawSha256)
    // Explicit unavailable-owner projection only: a historical success may
    // not turn into permission to recreate an object. Native bytes stay intact.
    const missingCalls: boolean[] = []
    const missing = vi.spyOn(gateway, 'sessionCreation').mockImplementation(async (...args) => {
      missingCalls.push(args[4]); return { workspaceExists: true, created: false, dispatched: false }
    })
    expect((await postCreate()).status).toBe(202)
    expect(missingCalls).toEqual([false, false])
    missing.mockRestore()
    expect((await postCreate({ ...input, workspaceId: 'unknown' })).status).toBe(409)
    expect((await postCreate({ ...input, configVersion: 'stale-version' }, hansen.token, randomUUID())).status).toBe(409)
    expect((await postCreate({ ...input, agentId: 'alex-notes' }, hansen.token, randomUUID())).status).toBe(409)
    expect((await postCreate({ ...input, workspaceId: 'unknown' }, hansen.token, randomUUID())).status).toBe(404)
    expect((await postCreate(input, alex.token, randomUUID())).status).toBe(404)
    expect((await postCreate(input, admin, randomUUID())).status).toBe(503) // This fixture has no administrator native cell.
    expect((await get('/haas/v1/sessions/' + createdId, alex.token)).status).toBe(403)
    await expect(restartedOwner.create(hansen.token, input, command(), AbortSignal.abort())).rejects.toBeDefined()
    // Lose the create reply after the real native effect. A repeated request
    // reconciles only by reading the original session/preset/workspace owners.
    const method = gateway.sessionCreation.bind(gateway)
    let lost = false, writes = 0
    const fault = vi.spyOn(gateway, 'sessionCreation').mockImplementation(async (...args) => {
      const result = await method(...args)
      if (result.dispatched) { writes++; if (!lost) { lost = true; throw Error('Explicit lost reply after original create') } }
      return result
    })
    const lostKey = randomUUID()
    expect((await postCreate(input, hansen.token, lostKey)).status).toBe(202)
    const recovered = await postCreate(input, hansen.token, lostKey)
    expect(recovered.status).toBe(201)
    expect(writes).toBe(1)
    fault.mockRestore()
    // Kill a real separate command process AFTER the PG reservation commits
    // and BEFORE it dispatches anything to the still-live native owner.
    const childEntry = fileURLToPath(new URL('../lib/session-creation-test-process.mjs', import.meta.url))
    await build({ entryPoints: [fileURLToPath(new URL('./fixtures/session-creation-process.ts', import.meta.url))],
      outfile: childEntry, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22' })
    const startCommandProcess = (idempotencyKey: string, pause: boolean) => {
      const child = fork(childEntry, [], { execPath: process.execPath, execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { PATH: process.env.PATH, PAIMIND_SESSION_CREATE_PROCESS_TEST: '1', PAIMIND_HAAS_TEST_CONFIG: configPath } })
      child.stderr!.pipe(createWriteStream(join(directory, `command-${child.pid}.log`), { flags: 'wx', mode: 0o600 }))
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }))
      })
      cleanup.push(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed })
      const reply = new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Command process response missing')), 20000)
        child.once('message', value => { clearTimeout(timer); resolve(value) })
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('close', () => { clearTimeout(timer); reject(Error('Command process closed before response')) })
      })
      child.send({ tenantId, token: hansen.token, publicOrigin, pin: hansen.pin, transportKey: hansen.transportKey,
        nativePort: hansen.nativePort, request: input, context: { key: idempotencyKey, requestId: randomUUID() }, pause })
      return { child, reply, closed }
    }
    const crashKey = randomUUID(), paused = startCommandProcess(crashKey, true)
    expect(await paused.reply).toEqual({ phase: 'reservation-committed-before-native-dispatch' })
    const [beforeCrash] = await owner`select native_session_id,outcome from haas.session_create_commands where tenant_id=${tenantId} and idempotency_key=${crashKey}`
    expect(beforeCrash!.outcome).toBe('unconfirmed')
    expect((await hansen.transport.requestControl('session.creation', { sessionId: beforeCrash!.native_session_id })).kind).toBe('new')
    paused.child.kill('SIGKILL')
    expect(await paused.closed).toEqual({ code: null, signal: 'SIGKILL' })
    const recoveredCrash = await postCreate(input, hansen.token, crashKey)
    expect(recoveredCrash.status).toBe(201)
    expect(recoveredCrash.body.data.sessionId).toBe(beforeCrash!.native_session_id)
    // Two independent gateway/command-owner processes recover the same still
    // unconfirmed identity. Native ensureSession/attach owns deduplication.
    const parallelKey = randomUUID(), parallelPaused = startCommandProcess(parallelKey, true)
    expect((await parallelPaused.reply).phase).toBe('reservation-committed-before-native-dispatch')
    parallelPaused.child.kill('SIGKILL'); await parallelPaused.closed
    const independent = [startCommandProcess(parallelKey, false), startCommandProcess(parallelKey, false)]
    const outcomes = await Promise.all(independent.map(child => child.reply))
    for (const result of outcomes) expect(result).toMatchObject({ phase: 'completed', result: { data: { outcome: 'created' } } })
    expect(new Set(outcomes.map(row => row.result.data.sessionId)).size).toBe(1)
    for (const child of independent) expect(await child.closed).toEqual({ code: 0, signal: null })
    const independentNativeState = await hansen.process.request('commandReadState', { sessionId: outcomes[0].result.data.sessionId })
    expect(independentNativeState.nativeCreateCalls).toBe(1)
    // Fail exactly the native attachment, after original session creation.
    await hansen.process.request('failNextWorkspaceAttach', { workspaceId: input.workspaceId })
    const partialKey = randomUUID(), partial = await postCreate(input, hansen.token, partialKey)
    expect(partial.status).toBe(202)
    const partialState = await hansen.process.request('commandReadState', { sessionId: partial.body.data.sessionId })
    expect(partialState.nativeCreateCalls).toBe(1)
    const partialRecovered = await postCreate(input, hansen.token, partialKey)
    expect(partialRecovered.status).toBe(201)
    expect(partialRecovered.body.data.sessionId).toBe(partial.body.data.sessionId)
    const repairedState = await hansen.process.request('commandReadState', { sessionId: partial.body.data.sessionId })
    expect(repairedState.rawSha256).toBe(partialState.rawSha256)
    expect(repairedState.nativeCreateCalls).toBe(1)
    receipts.push({ kind: 'creation-recovery', killedBeforeDispatch: paused.child.pid, crashedCommand: beforeCrash,
      recoveredCrashId: recoveredCrash.body.data.sessionId, independentProcessResults: outcomes,
      independentNativeCreateCalls: independentNativeState.nativeCreateCalls,
      partialCreateId: partial.body.data.sessionId, partialHistoryUnchanged: true, partialNativeCreateCalls: repairedState.nativeCreateCalls,
      confirmedMissingOwnerProjectionDispatched: missingCalls.some(Boolean) })
    const originalCreatedBeforeReplacement = await hansen.process.request('commandReadState', { sessionId: createdId })
    expect(originalCreatedBeforeReplacement.rawSha256).toBe(originalCreated.rawSha256)
    for (const { cell, sessionId, before } of snapshots) {
      const after = await cell.process.request('snapshot', { sessionId })
      expect(after.rawSha256).toBe(before.rawSha256)
      receipts.push({ username: cell.username, pid: cell.ready.pid, before, after })
    }
    const queuedSessionId = 'hansen-crash-pending-turn', queuedKey = randomUUID()
    await hansen.process.request('start', { sessionId: queuedSessionId, presetId: created.body.data.presetId })
    const queuedVersion = await get('/haas/v1/sessions/' + queuedSessionId, hansen.token)
    expect(queuedVersion.status).toBe(200)
    const queuedInput = { text: 'This original pending message must survive a real process crash',
      expectedVersion: queuedVersion.body.data.version }
    const heldWake = await hansen.process.request('holdNextNativeWakeForCrash', { sessionId: queuedSessionId })
    const queuedReceipt = await postTurn(hansen, queuedSessionId, queuedInput, queuedKey)
    expect(queuedReceipt.body.data.outcome).toBe('accepted')
    const queuedBefore = await hansen.process.request('commandReadState', { sessionId: queuedSessionId })
    expect(queuedBefore.modelCalls).toBe(0); expect(queuedBefore.events).not.toContain('turn/start')
    expect(queuedBefore.queuedMessageIds).toEqual([queuedReceipt.body.data.messageId])
    expect(queuedBefore.insertionIds).toEqual([queuedReceipt.body.data.messageId])
    await prepareApprovalCrash!()
    // Replace only this diagnostic native process, joining it before reuse of
    // its private home. Container/volume pins remain explicitly synthetic here;
    // production controller stop/volume verification is a separate gate.
    const replacementKey = randomUUID(), pendingReplacement = startCommandProcess(replacementKey, true)
    expect((await pendingReplacement.reply).phase).toBe('reservation-committed-before-native-dispatch')
    pendingReplacement.child.kill('SIGKILL'); await pendingReplacement.closed
    const [pendingRow] = await owner`select command_id,native_session_id,target,outcome from haas.session_create_commands
      where tenant_id=${tenantId} and idempotency_key=${replacementKey}`
    const admission = new RuntimeAdmission(owner, publicOrigin)
    const beforeReplacementEvents = await eventStream(eventSessionId, hansen.token, initialFrames.at(-1)!.cursor)
    await vi.waitFor(() => expect(beforeReplacementEvents.ready!()).toBeGreaterThan(0))
    // Kill before administrative revocation: suspending first can cancel the
    // pending approval cleanly and would not exercise the abrupt-loss window.
    const nativeCrash = await hansen.process.crash()
    expect(nativeCrash.pid).toBe(heldWake.pid)
    expect(await admission.suspend(hansen.pin)).toBe(true)
    await vi.waitFor(() => expect(beforeReplacementEvents.ended!()).toBe(true), { timeout: 5000 })
    expect(beforeReplacementEvents.frames).toEqual([])
    expect((await postCreate(input, hansen.token, replacementKey)).status).toBe(503)
    const [withdrawn] = await owner`select revision from haas.runtime_bindings where cell_id=${hansen.pin.cellId}`
    await hansen.ingress.close(); await hansen.broker.close(); hansen.transport.destroy()
    let replacementIngress: ReturnType<typeof createNativeIngress>
    const replacementBroker = await createNativeControlBroker('/tmp', (value, signal) => replacementIngress.checkOrigins(value, signal),
      (value, signal) => replacementIngress.authorizeExecution(value, signal), (value, signal) => replacementIngress.deriveOrigins(value, signal),
      (value, signal) => replacementIngress.sealJobOrigins(value, signal), (value, signal) => replacementIngress.readSkillEligibility(value, signal))
    cleanup.push(() => replacementBroker.close())
    const replacementPort = await port()
    replacementIngress = createNativeIngress({ token: hansen.transportKey, nativePort: replacementPort,
      control: (operation, value, signal) => replacementBroker.request(operation, value, signal) })
    cleanup.push(() => replacementIngress.close()); await listenUnusedRuntimeOrigin(replacementIngress.server)
    const replacementAddress = replacementIngress.server.address()
    if (!replacementAddress || typeof replacementAddress === 'string') throw Error('Replacement ingress missing')
    const nextPin = { ...hansen.pin, revision: randomUUID(), containerId: randomBytes(32).toString('hex'),
      origin: `http://127.0.0.1:${replacementAddress.port}` }
    const nextTransport = new CellTransport(nextPin.origin, hansen.transportKey, replacementPort)
    cleanup.push(() => nextTransport.destroy())
    const nextProcess = await worker(join(directory, 'hansen'), true); cleanup.push(() => nextProcess.cleanup())
    const nextReady = await nextProcess.request('boot', { socketPath: replacementBroker.path, nativePort: replacementPort, resume: true })
    expect(nextReady.pid).not.toBe(hansen.ready.pid)
    await admission.replaceSuspended({ ...hansen.pin, revision: withdrawn.revision }, nextPin, undefined, undefined, hansen.pin)
    await bindings.replacePrivateCell(hansen.pin, nextPin, () => transports.replace(hansen.transport, nextTransport, nextPin), new AbortController().signal)
    await nextTransport.openOriginAuthority((value, signal) => bindings.checkInteractiveOrigins(nextPin.cellId, value, signal),
      (value, signal) => bindings.authorizeInteractiveExecution(nextPin.cellId, value, signal),
      (value, signal) => bindings.deriveInteractiveOrigins(nextPin.cellId, value, signal),
      (value, signal) => bindings.sealJobOrigins(nextPin.cellId, value, signal),
      (value, signal) => bindings.readSkillEligibility(nextPin.cellId, value, signal))
    await recoverApprovals!(nextProcess)
    const coldEventsBefore = await nextProcess.request('commandReadState', { sessionId: eventSessionId })
    expect(coldEventsBefore).toMatchObject({ live: false, rawSha256: eventSnapshot.rawSha256, modelCalls: 0 })
    const coldEvents = await eventStream(eventSessionId, hansen.token, firstCursor)
    await vi.waitFor(() => expect(coldEvents.ready!()).toBeGreaterThan(0))
    expect(coldEvents.frames).toEqual(initialFrames.slice(initialCount)); await coldEvents.stop!()
    const coldEventsAfter = await nextProcess.request('commandReadState', { sessionId: eventSessionId })
    expect(coldEventsAfter).toMatchObject({ live: false, rawSha256: eventSnapshot.rawSha256, modelCalls: 0, nativeCreateCalls: 0 })
    eventReceipts.push({ kind: 'replacement-cold-event-replay', oldPid: hansen.ready.pid, newPid: nextReady.pid,
      stableCellId: nextPin.cellId, retainedRawSha256: eventSnapshot.rawSha256, noActivationOrModelCall: true, oldConnectionClosed: true })
    const coldBefore = await nextProcess.request('commandReadState', { sessionId: createdId, prefixBytes: originalCreatedBeforeReplacement.rawBytes })
    expect(coldBefore.historyPrefixSha256).toBe(originalCreatedBeforeReplacement.rawSha256)
    expect(coldBefore.live).toBe(false)
    expect((await postCreate()).status).toBe(201)
    const coldAfter = await nextProcess.request('commandReadState', { sessionId: createdId })
    expect(coldAfter.live).toBe(false); expect(coldAfter.nativeCreateCalls).toBe(0)
    expect(coldAfter.rawSha256).toBe(coldBefore.rawSha256)
    const coldTurnBefore = await nextProcess.request('commandReadState', { sessionId: governedTurnId })
    expect(coldTurnBefore.live).toBe(false); expect(coldTurnBefore.rawSha256).toBe(governedTurnBefore.rawSha256)
    const coldTurnReplay = await postTurn(hansen, governedTurnId, governedTurnInput, governedTurnKey)
    expect(coldTurnReplay.body).toMatchObject({ operationId: pendingTurn.body.operationId, replayed: true, data: { outcome: 'accepted' } })
    const coldTurnAfter = await nextProcess.request('commandReadState', { sessionId: governedTurnId })
    expect(coldTurnAfter).toMatchObject({ live: false, rawSha256: coldTurnBefore.rawSha256, nativeCreateCalls: 0, modelCalls: 0 })
    receipts.push({ kind: 'turn-replacement-cold-replay', sessionId: governedTurnId, operationId: pendingTurn.body.operationId,
      previousPid: hansen.ready.pid, nextPid: nextReady.pid, immutableOperatorLineageRevalidated: true,
      noActivationOrModelReplay: true, retainedRawSha256: coldTurnAfter.rawSha256 })
    const newColdHistory = await get('/haas/v1/sessions/' + governedTurnId, hansen.token)
    expect(newColdHistory.status).toBe(200)
    await nextProcess.request('armPublicPrompt', { sessionId: governedTurnId, allowCold: true })
    const newColdKey = randomUUID(), newColdInput = { text: 'Explicit new turn on the exact recovered native session',
      expectedVersion: newColdHistory.body.data.version }
    const coldSubmissions = await Promise.all([postTurn(hansen, governedTurnId, newColdInput, newColdKey),
      postTurn(hansen, governedTurnId, newColdInput, newColdKey)])
    expect(coldSubmissions.every(result => result.status === 202 && result.body.data.outcome === 'accepted')).toBe(true)
    expect(new Set(coldSubmissions.map(result => result.body.operationId)).size).toBe(1)
    const resumedTurn = await nextProcess.request('settlePublicPrompt', { sessionId: governedTurnId })
    expect(resumedTurn.endings).toEqual(['completed', 'completed'])
    const resumedState = await nextProcess.request('commandReadState', { sessionId: governedTurnId, prefixBytes: coldTurnBefore.rawBytes })
    expect(resumedState).toMatchObject({ live: true, nativeCreateCalls: 0, modelCalls: 1,
      historyPrefixSha256: coldTurnBefore.rawSha256 })
    receipts.push({ kind: 'turn-replacement-cold-new-submission', sessionId: governedTurnId,
      operationId: coldSubmissions[0]!.body.operationId, actualNativeResume: true, noNativeCreate: true,
      concurrentRequests: 2, newModelCalls: 1, retainedHistoryPrefixSha256: resumedState.historyPrefixSha256,
      completedTurns: resumedTurn.endings, rawSha256: resumedState.rawSha256 })
    const pendingCold = await nextProcess.request('commandReadState', { sessionId: queuedSessionId })
    expect(pendingCold).toMatchObject({ live: false, modelCalls: 0, rawSha256: queuedBefore.rawSha256 })
    await nextProcess.request('armPublicPrompt', { sessionId: queuedSessionId, allowCold: true })
    const recoveredQueued = await Promise.all([postTurn(hansen, queuedSessionId, queuedInput, queuedKey),
      postTurn(hansen, queuedSessionId, queuedInput, queuedKey)])
    expect(recoveredQueued.every(result => result.status === 202 && result.body.data.outcome === 'accepted')).toBe(true)
    expect(recoveredQueued.every(result => result.body.operationId === queuedReceipt.body.operationId
      && result.body.data.messageId === queuedReceipt.body.data.messageId)).toBe(true)
    const completedQueued = await nextProcess.request('settlePublicPrompt', { sessionId: queuedSessionId })
    expect(completedQueued.endings).toEqual(['completed'])
    const queuedAfter = await nextProcess.request('commandReadState', { sessionId: queuedSessionId, prefixBytes: queuedBefore.rawBytes })
    expect(queuedAfter).toMatchObject({ live: true, modelCalls: 1, nativeCreateCalls: 0,
      historyPrefixSha256: queuedBefore.rawSha256, insertionIds: queuedBefore.insertionIds, queuedMessageIds: [] })
    expect((await postTurn(hansen, queuedSessionId, queuedInput, queuedKey)).body.data.outcome).toBe('accepted')
    expect((await nextProcess.request('commandReadState', { sessionId: queuedSessionId })).rawSha256).toBe(queuedAfter.rawSha256)
    receipts.push({ kind: 'turn-pending-queue-process-crash-recovery', nativeCrash, fault: heldWake,
      sessionId: queuedSessionId, operationId: queuedReceipt.body.operationId, messageId: queuedReceipt.body.data.messageId,
      initialAdmissionDurable: true, originalPendingInsertionRetained: true, modelCallsBeforeCrash: 0,
      modelCallsAfterRecovery: 1, oldHistoryPrefixSha256: queuedAfter.historyPrefixSha256,
      noReplacementMessage: true, noNativeCreate: true, concurrentRecoveryRequests: 2,
      completedReplayHistoryUnchanged: true, unrelatedAlexPid: alex.ready.pid })
    const replaced = await postCreate(input, hansen.token, replacementKey)
    expect(replaced.status).toBe(201); expect(replaced.body.data.sessionId).toBe(pendingRow!.native_session_id)
    expect((await nextProcess.request('commandReadState', { sessionId: pendingRow!.native_session_id })).nativeCreateCalls).toBe(1)
    const [retainedCommand] = await owner`select command_id,native_session_id,target,outcome from haas.session_create_commands
      where tenant_id=${tenantId} and idempotency_key=${replacementKey}`
    expect(retainedCommand).toEqual({ ...pendingRow, outcome: 'created' })
    expect((await get('/haas/v1/sessions/alex-session', alex.token)).status).toBe(200)
    receipts.push({ kind: 'replacement-creation', previousPid: hansen.ready.pid, nextPid: nextReady.pid,
      commandIdentityPreserved: true, previousTargetRetained: true, confirmedColdHistoryUnchanged: coldAfter.rawSha256 === coldBefore.rawSha256,
      preReplacementHistoryPrefixPreserved: coldBefore.historyPrefixSha256 === originalCreatedBeforeReplacement.rawSha256,
      confirmedColdSessionNotResumed: !coldAfter.live, pendingSessionId: pendingRow!.native_session_id, nextPin,
      oldPin: hansen.pin, unrelatedAlexPid: alex.ready.pid })
    assigned = (await publications.assign(admin, assigned.publicationId, { subjectKind: 'user', subjectId: hansen.pin.userId,
      effect: 'deny', active: true, expectedRevision: assigned.revision, reason: '撤回后重放仍须拒绝' }, command())).data
    expect((await postCreate()).status).toBe(404)
    const revokedTurnReplay = await postTurn(hansen, governedTurnId, governedTurnInput, governedTurnKey)
    expect(revokedTurnReplay.status).toBe(403); expect(revokedTurnReplay.body.code).toBe('preset-not-eligible')
    expect((await get('/haas/v1/sessions/' + governedTurnId, hansen.token)).status).toBe(200)
    expect((await nextProcess.request('commandReadState', { sessionId: governedTurnId })).rawSha256).toBe(resumedState.rawSha256)
    const rows = await owner`select native_session_id,outcome from haas.session_create_commands where tenant_id=${tenantId} order by created_at`
    expect(rows).toEqual([createdId, recovered.body.data.sessionId, recoveredCrash.body.data.sessionId,
      outcomes[0].result.data.sessionId, partial.body.data.sessionId, pendingRow!.native_session_id].map(native_session_id => ({ native_session_id, outcome: 'created' })))
    await expect(sql`update haas.session_create_commands set native_session_id='forged' where tenant_id=${tenantId}`).rejects.toBeDefined()
    await expect(owner`update haas.session_create_commands set outcome='unconfirmed' where tenant_id=${tenantId}`).rejects.toBeDefined()
    receipts.push({ kind: 'session-create', creations, rows, concurrentNativeWrites: concurrentWrites,
      recoveredAfterLostReplyWithoutResend: writes === 1,
      replayHistoryUnchanged: originalCreatedBeforeReplacement.rawSha256 === originalCreated.rawSha256 })
    await hansen.logout()
    expect((await get('/haas/v1/sessions', hansen.token)).status).toBe(401)
    expect((await get('/haas/v1/sessions/alex-session', alex.token)).status).toBe(200)
    await writeFile(join(directory, 'receipt.json'), JSON.stringify({ status: 'OWNER_SESSION_READS_CREATION_AND_TURNS_VERIFIED', tenantId,
      scope: 'HAAS-05 reads, HAAS-05/07 creation and live/cold-session turns, HAAS-06 event continuation, HAAS-08 original approval carrier, stored decision proof and before-body checkpoint with terminal/lost-ack/consumed-before-storage actual SIGKILL recovery; real PG and two native processes, explicit held-write/local-model/tool/container-pin fixtures; not final image or browser acceptance',
      receipts, reads }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    console.log('Versioned session read/create evidence:', directory)
  } catch (error) {
    failure = error
    await writeFile(join(directory, 'failed.json'), JSON.stringify({ tenantId, error: String(error), receipts, reads }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  } finally {
    const errors: string[] = []
    for (const dispose of cleanup.reverse()) { try { await dispose() } catch (error) { errors.push(String(error)) } }
    await writeFile(join(directory, 'cleanup.json'), JSON.stringify({ complete: errors.length === 0, errors }) + '\n', { flag: 'wx', mode: 0o600 })
    if (failure) throw failure
    if (errors.length) throw Error('Test cleanup incomplete: ' + errors.join('; '))
  }
}, 120000)
