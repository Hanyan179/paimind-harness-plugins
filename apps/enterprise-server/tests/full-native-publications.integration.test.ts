import { fork } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createWriteStream, readFileSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { fromBufferPromise } from 'yauzl'
import { afterAll, expect, it } from 'vitest'
import { Identity } from '../src/identity.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { NativeGateway } from '../src/native-gateway.js'
import { CellTransport } from '../src/cell-transport.js'
import { Publications } from '../src/publications.js'
import { SkillPublications } from '../src/skill-publications.js'
import { MemberContent } from '../src/member-content.js'
import { ModelInspection } from '../src/model-inspection.js'
import { createEnterpriseServer } from '../src/server.js'
import { createNativeControlBroker } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'

const path = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!path || statSync(path).mode & 0o077) throw Error('Private isolated PostgreSQL configuration required')
const config = JSON.parse(readFileSync(path, 'utf8'))
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || ['3080', '5432', '10012', '55857'].includes(url.port)) throw Error('Unsafe full-native test database')
}
const owner = postgres(config.ownerUrl, { max: 2, onnotice: () => {} }), sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
afterAll(async () => { await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })
const command = () => ({ key: randomUUID(), requestId: randomUUID() })
const signal = () => new AbortController().signal
async function nativePort() {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing private native port')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return address.port
}
async function processClient(directory: string, generation = 'first') {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const child = fork(fileURLToPath(new URL('./fixtures/full-native-worker.mjs', import.meta.url)), [], {
    cwd: directory, execPath: process.execPath, execArgv: [],
    env: { PATH: process.env.PATH, NODE_ENV: 'test', PAIMIND_NATIVE_PROCESS_TEST: '1',
      DSH_HOME: join(directory, 'home'), DSH_TELEMETRY_MODE: 'DISABLED' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'json',
  })
  child.stdout!.pipe(createWriteStream(join(directory, 'stdout-' + generation + '.log'), { flags: 'wx', mode: 0o600 }))
  child.stderr!.pipe(createWriteStream(join(directory, 'stderr-' + generation + '.log'), { flags: 'wx', mode: 0o600 }))
  const pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error(`Owned full-native process exited (${code ?? signal})`)) }
      pending.clear(); resolve({ code, signal })
    })
  })
  child.on('message', (reply: any) => {
    const item = pending.get(reply?.id); if (!item) return
    clearTimeout(item.timer); pending.delete(reply.id)
    if (reply.ok) item.resolve(reply.value); else item.reject(Error(reply.error))
  })
  return { child, closed, request(method: string, input: object = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(Error('Full-native command deadline: ' + method)) }, 20000)
      pending.set(id, { resolve, reject, timer })
      child.send({ id, method, input }, error => { if (error) { clearTimeout(timer); pending.delete(id); reject(error) } })
    })
  }, async cleanup() {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 10000)
    try { await closed } finally { clearTimeout(timer) }
  } }
}

it.each([['skill-deny', 'invocation'], ['agent-deny', 'tool'], ['logout', 'invocation']] as const)(
  'executes complete native adopted presets with current PG/private Skill authority and isolates %s (%s)', async (fault, mode) => {
    const directory = await mkdtemp(join(config.evidence, 'full-native-publications-'))
    const cleanup: Array<() => unknown | Promise<unknown>> = [], receipts: any[] = [], modelReads: any[] = [], transitions: any[] = [], downloads: any[] = []
    const tenantId = 'full-native-' + randomUUID(), password = 'Explicit synthetic full-native password 2026'
    try {
      await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
      const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
      await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, command())
      const login = await identity.login({ username: 'morgan', password }, command()), admin = login.token
      const actors: { username: string; userId: string; role: 'admin' | 'member'; token: string }[] = [
        { username: 'morgan', userId: login.data.userId, role: 'admin', token: admin },
      ]
      for (const [username, displayName] of [['hansen', 'Hansen'], ['alex', 'Alex']]) {
        const account = (await identity.createMember(admin, { username, displayName, password }, command())).data
        actors.push({ username: username!, userId: account.userId, role: 'member', token: (await identity.login({ username, password }, command())).token })
      }
      const cells = []
      for (const actor of actors) {
        const port = await nativePort()
        let ingress: ReturnType<typeof createNativeIngress>
        const broker = await createNativeControlBroker('/tmp', (input, signal) => ingress.checkOrigins(input, signal),
          (input, signal) => ingress.authorizeExecution(input, signal), (input, signal) => ingress.deriveOrigins(input, signal),
          (input, signal) => ingress.sealJobOrigins(input, signal), (input, signal) => ingress.readSkillEligibility(input, signal))
        cleanup.push(() => broker.close())
        const key = randomBytes(32).toString('hex')
        ingress = createNativeIngress({ token: key, nativePort: port, control: (operation, input, signal) => broker.request(operation, input, signal) })
        await new Promise<void>(resolve => ingress.server.listen(0, '127.0.0.1', resolve)); cleanup.push(() => ingress.close())
        const address = ingress.server.address(); if (!address || typeof address === 'string') throw Error('Missing owned ingress address')
        const origin = `http://127.0.0.1:${address.port}`, transport = new CellTransport(origin, key, port)
        cleanup.push(() => transport.destroy())
        // Native processes are real. These explicit container/image/volume pins
        // exercise current binding validation but do not prove container isolation.
        const pin: PrivateRuntimeCell = { cellId: randomUUID(), tenantId, userId: actor.userId, role: actor.role, origin, revision: randomUUID(),
          containerId: randomBytes(32).toString('hex'), imageId: 'sha256:' + 'd'.repeat(64),
          volumeName: 'paimind-haas-member-fixture-' + randomUUID(), policyDigest: 'sha256:' + 'e'.repeat(64) }
        await owner`insert into haas.runtime_bindings (cell_id,tenant_id,user_id,origin,revision,isolation_mode,status,lease_expires_at,container_id,image_id,volume_name,policy_digest)
          values (${pin.cellId},${tenantId},${actor.userId},${origin},${pin.revision},'container-managed','ready',clock_timestamp()+interval '10 minutes',
            ${pin.containerId},${pin.imageId},${pin.volumeName},${pin.policyDigest})`
        const process = await processClient(join(directory, actor.username)); cleanup.push(() => process.cleanup())
        const ready = await process.request('boot', { socketPath: broker.path, nativePort: port })
        expect(ready).toMatchObject({ fullWebProfile: true, originalSettingsProvider: true, originalProfileOwner: true, originalSkillOwner: true })
        cells.push({ ...actor, pin, broker, transport, process, ready, nativePort: port })
      }
      expect(new Set(cells.map(cell => cell.ready.pid)).size).toBe(3)
      expect(new Set(cells.map(cell => cell.ready.standardDigest)).size).toBe(1)
      const publicPort = await nativePort(), publicOrigin = `http://127.0.0.1:${publicPort}`
      const bindings = new RuntimeBindings(sql, identity, publicOrigin, [], cells.map(cell => cell.pin))
      for (const cell of cells) await cell.transport.openOriginAuthority((input, signal) => bindings.checkInteractiveOrigins(cell.pin.cellId, input, signal),
        (input, signal) => bindings.authorizeInteractiveExecution(cell.pin.cellId, input, signal),
        (input, signal) => bindings.deriveInteractiveOrigins(cell.pin.cellId, input, signal),
        (input, signal) => bindings.sealJobOrigins(cell.pin.cellId, input, signal),
        (input, signal) => bindings.readSkillEligibility(cell.pin.cellId, input, signal))
      const gateway = new NativeGateway({ publicOrigin, transports: new Map(cells.map(cell => [cell.pin.origin, cell.transport])),
        resolve: (token, requestId) => bindings.resolve(token, requestId),
        sealInteractiveOrigin: (token, requestId, scope, clientRpcId) => identity.sealInteractiveOrigin(token, requestId, scope, clientRpcId),
        agentPresetEligibility: (token, requestId, grant, ids) => bindings.readAgentPresetEligibility(token, requestId, grant, ids),
        authorize: (token, requestId, grant, operation, verify) => identity.authorizeRuntimeOperation(token, requestId, grant, operation, verify) })
      cleanup.push(() => gateway.close())
      const server = createEnterpriseServer({ identity, publicOrigin, loopbackDevelopment: true, nativeGateway: gateway })
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(publicPort, '127.0.0.1', () => { server.off('error', reject); resolve() }) })
      cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
      const nativeCall = async (member: typeof cells[number], method: string, payload: object) => {
        const rpcId = randomUUID(), response = await fetch(publicOrigin + '/api/' + method, {
          method: 'POST', headers: { origin: publicOrigin, cookie: 'paimind_haas_session=' + member.token, 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId, method, payload }), signal: AbortSignal.timeout(10000),
        })
        const body = await response.json()
        transitions.push({ member: member.username, method, payload, status: response.status, body })
        if (response.status === 200) expect(body.rpcId).toBe(rpcId)
        return { status: response.status, body }
      }
      const skills = new SkillPublications(sql, identity, (...args) => gateway.exportSkillPublication(...args), (...args) => gateway.adoptSkillPublication(...args))
      const agents = new Publications(identity, (...args) => gateway.readAgentPublication(...args), (...args) => gateway.adoptAgentPublication(...args))
      const [morgan, hansen, alex] = cells
      // Plain JSON belongs to the actual boot diagnostic owner in each native
      // process. Current real PG identity chooses the cell, never body fields.
      const postBoot = async (member: typeof cells[number], value: object) => {
        const response = await fetch(publicOrigin + '/paimind/boot-readiness', {
          method: 'POST', headers: { origin: publicOrigin, cookie: 'paimind_haas_session=' + member.token, 'content-type': 'application/json' },
          body: JSON.stringify(value), signal: AbortSignal.timeout(5000),
        })
        return { status: response.status, body: await response.json() }
      }
      for (const member of [hansen!, alex!]) {
        const receipt = { schema: 'paimind.boot-readiness/v1', state: 'milestone', phase: 'bootstrap', id: member.username }
        expect((await postBoot(member, receipt)).status).toBe(202)
        const invalid = await postBoot(member, { ...receipt, userId: morgan!.userId })
        expect(invalid.status).toBe(400)
        const audit = await owner`select actor_user_id,outcome,reason from haas.audit_events
          where tenant_id=${tenantId} and request_id=${invalid.body.requestId} and action='runtime.operation'`
        expect(audit).toEqual([{ actor_user_id: member.userId, outcome: 'denied', reason: 'invalid-native-operation' }])
        const own = await member.process.request('bootReceiptSnapshot', {})
        expect(own.receipts).toEqual([{ receivedAt: expect.any(Number), receipt }])
        const deniedRead = await fetch(publicOrigin + '/paimind/boot-readiness', {
          headers: { cookie: 'paimind_haas_session=' + member.token }, signal: AbortSignal.timeout(5000),
        })
        expect(deniedRead.status).toBe(400)
      }
      expect((await morgan!.process.request('bootReceiptSnapshot', {})).receipts).toEqual([])
      // The original settings owner stores independent display values. Its
      // full describe response is projected only on the authenticated member
      // carrier, never by changing the native service or its configuration.
      const displaySnapshots = new Map<string, any>()
      for (const member of [hansen!, alex!]) {
        const original = await member.process.request('seedDisplaySettings', { member: member.username })
        displaySnapshots.set(member.username, original)
        const view = await nativeCall(member, 'settings.describe', {})
        expect(view.status).toBe(200)
        expect(view.body.result.value).toMatchObject({ writable: false, hasDocument: false })
        const rows = view.body.result.value.namespaces
        expect(rows.map((row: any) => row.ns).sort()).toEqual(['locale', 'ui-theme'])
        expect(rows.find((row: any) => row.ns === 'locale').value).toEqual(original.locale)
        expect(rows.find((row: any) => row.ns === 'ui-theme').value).toEqual(original.theme)
        for (const row of rows) { expect(row.base).toBeUndefined(); expect(row.user).toBeUndefined(); expect(row.secrets).toEqual([]) }
        for (const [method, payload] of [['settings.describe', { userId: member.username === 'hansen' ? alex!.userId : hansen!.userId }],
          ['settings.mutate', { ns: 'locale', ops: [{ op: 'set', path: ['preference'], value: 'en' }] }],
          ['credentials.describe', {}]] as const) {
          const denied = await nativeCall(member, method, payload)
          expect(denied.status).toBe(403)
          const audit = await owner`select actor_user_id,outcome,reason from haas.audit_events
            where tenant_id=${tenantId} and request_id=${denied.body.requestId} and action='runtime.operation'`
          expect(audit).toEqual([{ actor_user_id: member.userId, outcome: 'denied', reason: 'native-operation-denied' }])
        }
        expect(await member.process.request('displaySettingsSnapshot')).toEqual(original)
      }
      const adminSettings = await nativeCall(morgan!, 'settings.describe', {})
      expect(adminSettings.status).toBe(200)
      expect(adminSettings.body.result.value.namespaces.length).toBeGreaterThan(2)
      expect(adminSettings.body.result.value.writable).toBe(true)
      // Real original notification owners, durable storage and authenticated
      // gateway. Fixture-only IPC seeds each private process; publishing is
      // deliberately not a browser or member remote capability.
      const notificationRows = new Map<string, any>()
      for (const member of [hansen!, alex!]) {
        const empty = await nativeCall(member, 'paimindNotifications/list', { args: {} })
        expect(empty.status).toBe(200)
        expect(empty.body.result).toMatchObject({ ok: true, value: { items: [] } })
        const notice = await member.process.request('publishNotification', { member: member.username })
        notificationRows.set(member.username, notice)
        const listed = await nativeCall(member, 'paimindNotifications/list', { args: {} })
        expect(listed.body.result).toEqual({ ok: true, value: { items: [notice] } })
      }
      for (const [member, foreign] of [[hansen!, alex!], [alex!, hansen!]]) {
        const notice = notificationRows.get(member!.username), other = notificationRows.get(foreign!.username)
        const foreignMark = await nativeCall(member!, 'paimindNotifications/markRead', { args: { request: { id: other.id, ifVersion: other.version } } })
        expect(foreignMark.status).toBe(200)
        expect(foreignMark.body.result).toMatchObject({ ok: true, value: { ok: false, error: { code: 'not-found', id: other.id } } })
        for (const [method, args] of [['paimindNotifications/list', { userId: foreign!.userId }],
          ['paimindNotifications/publish', {}]] as const) {
          const denied = await nativeCall(member!, method, { args })
          expect(denied.status).toBe(403); expect(denied.body.code).toBe('native-operation-denied')
          const audit = await owner`select actor_user_id,outcome,reason from haas.audit_events
            where tenant_id=${tenantId} and request_id=${denied.body.requestId} and action='runtime.operation'`
          expect(audit).toEqual([{ actor_user_id: member!.userId, outcome: 'denied', reason: 'native-operation-denied' }])
        }
        const marked = await nativeCall(member!, 'paimindNotifications/markRead', { args: { request: { id: notice.id, ifVersion: notice.version } } })
        expect(marked.status).toBe(200)
        expect(marked.body.result).toMatchObject({ ok: true, value: { ok: true, value: { id: notice.id, readAt: expect.any(Number) } } })
        const all = await nativeCall(member!, 'paimindNotifications/markAllRead', { args: {} })
        expect(all.status).toBe(200)
        expect(all.body.result).toEqual({ ok: true, value: { items: [marked.body.result.value.value] } })
        notificationRows.set(member!.username, marked.body.result.value.value)
      }
      const modelInspection = new ModelInspection(identity, bindings, new Map(cells.map(cell => [cell.pin.origin, cell.transport])))
      cleanup.push(() => modelInspection.close())
      const inspectModel = (member: typeof hansen, token = admin) => modelInspection.read(token, { memberId: member!.userId,
        reason: '核对原生模型状态', confirmed: true }, randomUUID(), signal())
      for (const member of [hansen!, alex!]) {
        const model = await inspectModel(member)
        expect(model.disclosure).toMatchObject({ memberId: member.userId, readOnly: true })
        expect(model.data.selection).not.toBeNull()
        expect(model.data).toMatchObject({ authorization: 'not-evaluated', modelCall: 'not-performed' })
        expect(model.data.providers.some(row => row.provider === 'deepseek-official' && row.active)).toBe(true)
        expect(model.data.catalog.groups.some(group => group.provider === 'deepseek-official')).toBe(true)
        // This original settings owner has no named credential reference.
        // Native provider fallback is not inspected and must not be reported
        // as a missing credential or an authorization/model-call result.
        expect(model.data.credential).toBe('not-inspected')
        expect(model.data.configuration.credentialWritable).toBeNull()
        modelReads.push({ member: member.username, phase: 'boot', ...model })
      }
      await expect(inspectModel(hansen, alex!.token)).rejects.toMatchObject({ status: 403 })
      const skill = await morgan!.process.request('createSkill')
      const submittedSkill = (await skills.submit(admin, { skillId: skill.skillId, expectedDigest: skill.digest, reason: '提交完整原生来源技能' }, command(), signal())).data
      let skillRevision = (await skills.review(admin, submittedSkill.publicationId, { expectedRevision: 1, decision: 'publish', reason: '批准完整固定技能' }, command())).data.revision
      for (const member of [hansen!, alex!]) skillRevision = (await skills.assign(admin, submittedSkill.publicationId, { expectedRevision: skillRevision,
        subjectKind: 'user', subjectId: member.userId, effect: 'allow', active: true, reason: '分别授权准确版本' }, command())).data.revision
      for (const member of [hansen!, alex!]) {
        await skills.adopt(member.token, submittedSkill.publicationId,
          { expectedRevision: skillRevision, expectedDigest: submittedSkill.digest }, command(), signal())
        const choice = await member.process.request('enableAdoptedSkill', { publicationId: submittedSkill.publicationId })
        expect(choice.before).toMatchObject({ enabled: false, direct: false })
        expect(choice.selected).toMatchObject({ reference: { publicationId: submittedSkill.publicationId }, enabled: true, direct: false, runtimeGrant: false })
        expect(choice.effective.enabledBusinessSkillNames).toEqual(['customer-notes'])
        expect(choice.effective.directBusinessSkillNames).toEqual([])
      }
      const source = await morgan!.process.request('createAgent', { id: 'morgan-customer-method', name: 'Morgan 客户方法助手', skills: ['customer-notes'] })
      const submittedAgent = (await agents.submit(admin, { presetId: source.presetId, expectedVersion: source.configVersion, reason: '发布原生智能体与准确依赖' }, command())).data
      let agentRevision = (await agents.review(admin, submittedAgent.publicationId, { expectedRevision: 1, decision: 'publish', reason: '选择准确技能发布编号',
        skillPublications: [{ name: submittedSkill.name, publicationId: submittedSkill.publicationId }] }, command())).data.revision
      for (const member of [hansen!, alex!]) agentRevision = (await agents.assign(admin, submittedAgent.publicationId, { expectedRevision: agentRevision,
        subjectKind: 'user', subjectId: member.userId, effect: 'allow', active: true, reason: '分别授权企业智能体' }, command())).data.revision
      const seal = (member: typeof hansen, sessionId: string) => identity.sealInteractiveOrigin(member!.token, randomUUID(), {
        tenantId, userId: member!.userId, role: member!.role, cellId: member!.pin.cellId, nativeSessionId: sessionId })
      const entries = []
      for (const member of [hansen!, alex!]) {
        const names = member === hansen ? ['Hansen 客户跟进助手', 'Hansen 报价核对助手'] : ['Alex 市场研究助手', 'Alex 竞品摘要助手']
        const profiles = []
        for (const [index, name] of names.entries()) {
          const profile = await member.process.request('createAgent', { id: member.username + '-personal-' + index, name }); profiles.push(profile)
          const sessionId = member.username + '-personal-session-' + index
          await member.process.request('start', { sessionId, presetId: profile.presetId })
          const result = await member.process.request('prompt', { sessionId, source: await seal(member, sessionId), mode: 'plain' })
          expect(result.replies).toEqual(['Explicit local diagnostic reply; no external model'])
        }
        const adopted = (await agents.adopt(member.token, submittedAgent.publicationId, { expectedRevision: agentRevision, expectedDigest: submittedAgent.digest }, command())).data
        const catalog = await member.process.request('catalog')
        expect(catalog.profiles.map((profile: any) => profile.name).sort()).toEqual([...names].sort())
        expect(catalog.presets.sort()).toEqual([...profiles.map(profile => profile.presetId), adopted.presetId].sort())
        const sessionId = member.username + '-enterprise-session', source = await seal(member, sessionId)
        expect(await member.process.request('start', { sessionId, presetId: adopted.presetId })).toEqual({ sessionId, presetId: adopted.presetId })
        const result = await member.process.request('prompt', { sessionId, source, mode })
        expect(result.replies).toContain('Explicit local diagnostic reply; no external model')
        expect(result.calls.some((call: any) => call.sessionId === sessionId && call.skillBodyVisible)).toBe(true)
        expect(result.uses.some((use: any) => use.publicationId === submittedSkill.publicationId)).toBe(true)
        expect(result.checks.some((check: any) => check.sessionId === sessionId && check.presetId === adopted.presetId && check.allowed)).toBe(true)
        entries.push({ member, sessionId, source, before: result })
      }
      const h = entries[0]!, a = entries[1]!
      // Exact original browser preflight/download carrier, real PG authority
      // and original Session archive owner. This is still not Browser E2E.
      for (const entry of entries) {
        const path = '/api/session.export?sessionId=' + encodeURIComponent(entry.sessionId) + '&includeDescendants=true'
        const before = await entry.member.process.request('snapshot', { sessionId: entry.sessionId })
        for (const method of ['HEAD', 'GET']) {
          const response = await fetch(publicOrigin + path, { method, headers: { origin: publicOrigin,
            cookie: 'paimind_haas_session=' + entry.member.token }, signal: AbortSignal.timeout(10000) })
          expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('application/zip')
          expect(response.headers.get('content-disposition')).toContain('dsh-session-' + entry.sessionId + '.zip')
          const bytes = Buffer.from(await response.arrayBuffer())
          const rows = []
          if (method === 'HEAD') expect(bytes.byteLength).toBe(0)
          else {
            expect(bytes.byteLength).toBeGreaterThan(0); expect(bytes.byteLength).toBeLessThan(1024 * 1024)
            const archive = await fromBufferPromise(bytes, { autoClose: false, validateEntrySizes: true, strictFileNames: true })
            try {
              expect(archive.entryCount).toBe(1)
              for await (const file of archive.eachEntry()) {
                expect(file.isEncrypted()).toBe(false); expect(file.fileName).toMatch(/\.jsonl$/)
                expect(file.uncompressedSize).toBe(before.rawBytes)
                const chunks: Buffer[] = []; let size = 0
                const stream = await archive.openReadStreamPromise(file)
                for await (const value of stream) {
                  const chunk = Buffer.from(value); size += chunk.byteLength
                  expect(size).toBeLessThanOrEqual(before.rawBytes); chunks.push(chunk)
                }
                const raw = Buffer.concat(chunks), digest = createHash('sha256').update(raw).digest('hex')
                expect(digest).toBe(before.rawSha256)
                expect(raw.toString('utf8')).toContain('Explicit local diagnostic reply; no external model')
                expect(raw.toString('utf8')).not.toContain(entry === h ? a.sessionId : h.sessionId)
                rows.push({ path: file.fileName, bytes: size, sha256: digest })
              }
            } finally { archive.close() }
            await writeFile(join(directory, entry.member.username + '-native-session-export.zip'), bytes, { flag: 'wx', mode: 0o600 })
          }
          downloads.push({ member: entry.member.username, method, path, status: response.status, bytes: bytes.byteLength,
            sha256: createHash('sha256').update(bytes).digest('hex'), entries: rows })
        }
        expect((await entry.member.process.request('snapshot', { sessionId: entry.sessionId })).rawSha256).toBe(before.rawSha256)
        const foreign = entry === h ? a.sessionId : h.sessionId
        for (const method of ['HEAD', 'GET']) {
          const denied = await fetch(publicOrigin + '/api/session.export?sessionId=' + foreign + '&includeDescendants=true',
            { method, headers: { origin: publicOrigin, cookie: 'paimind_haas_session=' + entry.member.token }, signal: AbortSignal.timeout(10000) })
          expect(denied.status).toBe(404)
          expect(denied.headers.get('content-type')).not.toBe('application/zip')
          await denied.arrayBuffer(); downloads.push({ member: entry.member.username, method, foreignSessionId: foreign, status: denied.status })
        }
      }
      const commandReads: any[] = []
      for (const entry of entries) {
        const before = await entry.member.process.request('commandReadState', { sessionId: entry.sessionId })
        const listed = await nativeCall(entry.member, 'commands/list', { args: { agentId: entry.sessionId } })
        expect(listed.status).toBe(200); expect(listed.body.result).toEqual({ ok: true, value: before.descriptors })
        expect(before.descriptors.length).toBeGreaterThan(0)
        expect(await entry.member.process.request('commandReadState', { sessionId: entry.sessionId })).toEqual(before)
        commandReads.push({ phase: 'warm-original-command-directory', member: entry.member.username, before, listed })
      }
      expect((await nativeCall(a.member, 'commands/list', { args: { agentId: h.sessionId } })).status).toBe(403)
      const inspection = new MemberContent(identity, bindings, new Map(cells.map(cell => [cell.pin.origin, cell.transport])))
      cleanup.push(() => inspection.close())
      const inspect = (member: typeof hansen, token = admin, list = false) => inspection.read(token, { memberId: member!.userId,
        reason: '核对成员客户工作记录', confirmed: true, selection: list ? { kind: 'sessions' } : {
          kind: 'history', sessionId: member!.username + '-enterprise-session', beforeSeq: null } }, randomUUID(), signal())
      for (const entry of entries) {
        const list = await inspect(entry.member, admin, true)
        expect(list.data.kind).toBe('sessions')
        if (list.data.kind === 'sessions') expect(list.data.items.map(row => row.sessionId).sort()).toEqual([
          entry.sessionId, entry.member.username + '-personal-session-0', entry.member.username + '-personal-session-1'].sort())
        const history = await inspect(entry.member)
        expect(history.disclosure).toMatchObject({ memberId: entry.member.userId, readOnly: true, reason: '核对成员客户工作记录' })
        expect(history.data.kind).toBe('history')
        if (history.data.kind === 'history') expect(history.data.messages.some(message => message.text.includes('Explicit local diagnostic reply; no external model'))).toBe(true)
        expect((await entry.member.process.request('snapshot', { sessionId: entry.sessionId })).rawSha256).toBe(entry.before.rawSha256)
      }
      await expect(inspect(hansen, alex!.token)).rejects.toMatchObject({ status: 403 })
      const swapped = await h.member.process.request('prompt', { sessionId: h.sessionId, source: a.source, mode })
      expect(swapped.calls).toHaveLength(h.before.calls.length)
      // Original settings owner, in these fresh test homes only. A withdrawn
      // enterprise default must not bypass selection checks through {} create.
      for (const entry of [h, a]) expect(await entry.member.process.request('setDefaultPreset', { presetId: entry.before.presetId }))
        .toEqual({ defaultId: entry.before.presetId })
      if (fault === 'skill-deny') await skills.assign(admin, submittedSkill.publicationId, { expectedRevision: skillRevision,
        subjectKind: 'user', subjectId: hansen!.userId, effect: 'deny', active: true, reason: '仅撤销 Hansen 技能' }, command())
      else if (fault === 'agent-deny') await agents.assign(admin, submittedAgent.publicationId, { expectedRevision: agentRevision,
        subjectKind: 'user', subjectId: hansen!.userId, effect: 'deny', active: true, reason: '仅撤销 Hansen 智能体' }, command())
      else await identity.logout(hansen!.token, {}, command())
      // Real native HTTP mutations and owner metadata, not mocked RPC bodies.
      // Reject before native creation; preserve history-only restore semantics.
      const beforeTransitions = await h.member.process.request('snapshot', { sessionId: h.sessionId })
      const hStatus = fault === 'logout' ? 401 : 403
      const rejectedPresetOperations: Array<[string, object]> = [
        ['commands/list', { args: { agentId: h.sessionId } }],
        ['session.create', { sessionId: 'hansen-denied-creation', agentPreset: h.before.presetId }],
        ['session.create', {}],
        ['session.create', { sessionId: 'hansen-denied-implicit' }],
        ['session.fork', { sessionId: h.sessionId }],
        ['agentPreset.read', { agentPreset: h.before.presetId }],
        ['agentPreset.select', { sessionId: h.sessionId, agentPreset: h.before.presetId }],
        ['session.rename', { sessionId: h.sessionId, title: 'Revoked history must keep its original title' }],
        ['session.selectModel', { sessionId: h.sessionId, provider: 'local-only', model: 'synthetic' }],
        ['goal.create', { sessionId: h.sessionId, objective: 'Revoked history must not gain a new goal' }],
        ['goal.edit', { sessionId: h.sessionId, ref: { id: 'unknown-goal', revision: 1 }, objective: 'No withdrawn goal edit' }],
        ...['goal.resume', 'goal.complete', 'goal.clear'].map(method => [method, { sessionId: h.sessionId,
          ref: { id: 'unknown-goal', revision: 1 } }] as [string, object]),
      ]
      const presetDenials = []
      for (const [method, payload] of rejectedPresetOperations) {
        const denied = await nativeCall(h.member, method, payload)
        expect(denied.status).toBe(hStatus); presetDenials.push(denied)
      }
      const restoredViaHttp = await nativeCall(h.member, 'session.create', { sessionId: h.sessionId })
      expect(restoredViaHttp.status).toBe(fault === 'logout' ? 401 : 200)
      if (fault !== 'logout') expect(restoredViaHttp.body.result).toMatchObject({ ok: true,
        value: { sessionId: h.sessionId, agentPreset: h.before.presetId } })
      const historyViaHttp = await nativeCall(h.member, 'session.history', { sessionId: h.sessionId, maxMessages: 20 })
      expect(historyViaHttp.status).toBe(fault === 'logout' ? 401 : 200)
      if (fault !== 'logout') {
        expect(historyViaHttp.body.result.ok).toBe(true)
        expect(historyViaHttp.body.result.value.events.length).toBeGreaterThan(0)
        const paused = await nativeCall(h.member, 'goal.pause', { sessionId: h.sessionId, ref: { id: 'unknown-goal', revision: 1 } })
        // The original goal owner receives the stop request and rejects its
        // unknown CAS reference. A publication withdrawal does not hide stop.
        expect(paused.status).toBe(200); expect(paused.body.result.ok).toBe(false)
      }
      // A rejected next message must not first append to the member's original
      // history and only fail later in the model loop. Exercise the real HTTP
      // carrier with its original identity signer, not a direct process helper.
      const deniedPrompt = await nativeCall(h.member, 'session.prompt', { sessionId: h.sessionId,
        mode: 'queue', content: [{ type: 'text', text: 'Revoked HTTP message must not enter history' }],
      })
      expect(deniedPrompt.status).toBe(hStatus)
      if (fault !== 'logout') {
        for (const denied of [...presetDenials, deniedPrompt]) {
          expect(denied.body.code).toBe('preset-not-eligible')
          const audit = await owner`select actor_user_id,action,outcome,reason from haas.audit_events
            where tenant_id=${tenantId} and request_id=${denied.body.requestId} and action='runtime.operation'`
          expect(audit).toEqual([{ actor_user_id: h.member.userId, action: 'runtime.operation', outcome: 'denied', reason: 'preset-not-eligible' }])
        }
        // Exact synthetic-tenant trigger only: audit failure must not let a
        // rejected prompt reach the native inbox or become a reported success.
        expect(tenantId).toMatch(/^full-native-[a-f0-9-]+$/)
        const trigger = 'test_preflight_audit_' + randomUUID().replaceAll('-', '')
        await owner.unsafe(`create function haas.${trigger}() returns trigger language plpgsql as $$
          begin if NEW.tenant_id='${tenantId}' and NEW.action='runtime.operation' then
            raise exception 'isolated preflight audit fault'; end if; return NEW; end; $$;
          create trigger ${trigger} before insert on haas.audit_events for each row execute function haas.${trigger}();`)
        try {
          for (const [method, payload] of rejectedPresetOperations) {
            const unavailable = await nativeCall(h.member, method, payload)
            expect(unavailable.status).toBe(503); expect(unavailable.body.code).toBe('audit-unavailable')
          }
          const unavailable = await nativeCall(h.member, 'session.prompt', { sessionId: h.sessionId,
            mode: 'queue', content: [{ type: 'text', text: 'Audit failure must not append this message' }] })
          expect(unavailable.status).toBe(503); expect(unavailable.body.code).toBe('audit-unavailable')
        } finally { await owner.unsafe(`drop trigger ${trigger} on haas.audit_events; drop function haas.${trigger}();`) }
      }
      const sourceReference = await h.member.transport.requestControl('session.preset', { sessionId: h.sessionId })
      expect(sourceReference).toEqual({ sessionId: h.sessionId, agentPreset: h.before.presetId, hasForkBoundary: true })
      await expect(h.member.transport.requestControl('session.preset', { sessionId: 'hansen-denied-creation' })).rejects.toThrow()
      await expect(h.member.transport.requestControl('session.preset', { sessionId: 'hansen-denied-implicit' })).rejects.toThrow()
      const unchangedSessions = (await inspect(hansen, admin, true)).data
      expect(unchangedSessions.kind).toBe('sessions')
      if (unchangedSessions.kind === 'sessions') expect(unchangedSessions.items.map(row => row.sessionId).sort())
        .toEqual([h.sessionId, 'hansen-personal-session-0', 'hansen-personal-session-1'].sort())
      const afterTransitions = await h.member.process.request('snapshot', { sessionId: h.sessionId })
      expect(afterTransitions.rawSha256).toBe(beforeTransitions.rawSha256)
      expect(afterTransitions.calls).toEqual(beforeTransitions.calls)
      // Alex remains eligible, so this proves cell-local source lookup rather
      // than a blanket refusal caused by Hansen's revoked publication/login.
      const foreignFork = await nativeCall(a.member, 'session.fork', { sessionId: h.sessionId })
      expect(foreignFork.status).toBe(403)
      const foreignAudit = await owner`select actor_user_id,action,outcome,reason from haas.audit_events
        where tenant_id=${tenantId} and request_id=${foreignFork.body.requestId} and action='runtime.operation'`
      expect(foreignAudit).toEqual([{ actor_user_id: a.member.userId, action: 'runtime.operation', outcome: 'denied', reason: 'fork-source-unavailable' }])
      const allowedCreate = await nativeCall(a.member, 'session.create', {
        sessionId: 'alex-allowed-creation', agentPreset: a.before.presetId,
      })
      expect(allowedCreate.status).toBe(200)
      expect(allowedCreate.body.result).toMatchObject({ ok: true, value: { sessionId: 'alex-allowed-creation', agentPreset: a.before.presetId } })
      expect(await a.member.transport.requestControl('session.preset', { sessionId: 'alex-allowed-creation' }))
        .toEqual({ sessionId: 'alex-allowed-creation', agentPreset: a.before.presetId, hasForkBoundary: false })
      for (const payload of [{}, { sessionId: 'alex-implicit-creation' }]) {
        const implicit = await nativeCall(a.member, 'session.create', payload)
        expect(implicit.status).toBe(200); expect(implicit.body.result.ok).toBe(true)
        expect(implicit.body.result.value.agentPreset).toBe(a.before.presetId)
        if ('sessionId' in payload) expect(implicit.body.result.value.sessionId).toBe(payload.sessionId)
        expect(await a.member.transport.requestControl('session.creation', { sessionId: implicit.body.result.value.sessionId }))
          .toEqual({ sessionId: implicit.body.result.value.sessionId, kind: 'existing', agentPreset: a.before.presetId })
      }
      expect((await nativeCall(a.member, 'session.fork', { sessionId: 'alex-allowed-creation' })).status).toBe(409)
      const allowedFork = await nativeCall(a.member, 'session.fork', { sessionId: a.sessionId })
      expect(allowedFork.status).toBe(200); expect(allowedFork.body.result.ok).toBe(true)
      const forkId = allowedFork.body.result.value.sessionId
      expect(forkId).not.toBe(a.sessionId)
      expect(await a.member.transport.requestControl('session.preset', { sessionId: forkId }))
        .toEqual({ sessionId: forkId, agentPreset: a.before.presetId, hasForkBoundary: true })
      const beforeOwnRename = await a.member.process.request('snapshot', { sessionId: a.sessionId })
      const ownRename = await nativeCall(a.member, 'session.rename', { sessionId: a.sessionId, title: 'Alex 可用的原生历史' })
      expect(ownRename.status).toBe(200)
      expect(ownRename.body.result).toMatchObject({ ok: true, value: { title: 'Alex 可用的原生历史' } })
      const afterOwnRename = await a.member.process.request('snapshot', { sessionId: a.sessionId })
      expect(afterOwnRename.rawSha256).not.toBe(beforeOwnRename.rawSha256)
      expect(afterOwnRename.calls).toEqual(beforeOwnRename.calls)
      expect(afterOwnRename.replies).toEqual(beforeOwnRename.replies)
      // Admin inspection has its own reason/audit; it never borrows the now
      // revoked member login or re-executes the withdrawn enterprise preset.
      expect((await inspect(hansen)).data.kind).toBe('history')
      const denied = await h.member.process.request('prompt', { sessionId: h.sessionId, source: h.source, mode })
      expect(denied.calls).toHaveLength(h.before.calls.length); expect(denied.endings.at(-1)).toBe('error')
      const unaffected = await a.member.process.request('prompt', { sessionId: a.sessionId, source: a.source, mode })
      expect(unaffected.calls.length).toBeGreaterThan(a.before.calls.length)
      for (const entry of entries) {
        const member = entry.member, after = entry === h ? denied : unaffected, firstPid = member.ready.pid
        await member.process.request('stop'); expect(await member.process.closed).toEqual({ code: 0, signal: null })
        const restarted = await processClient(join(directory, member.username), 'second'); cleanup.push(() => restarted.cleanup())
        member.process = restarted
        const ready = await restarted.request('boot', { socketPath: member.broker.path, nativePort: member.nativePort, resume: true })
        expect(await restarted.request('notificationSnapshot')).toEqual({ items: [notificationRows.get(member.username)] })
        expect(await restarted.request('displaySettingsSnapshot')).toEqual(displaySnapshots.get(member.username))
        if (member === alex || fault !== 'logout') {
          const display = await nativeCall(member, 'settings.describe', {})
          expect(display.status).toBe(200)
          expect(display.body.result.value.namespaces.map((row: any) => row.ns).sort()).toEqual(['locale', 'ui-theme'])
        } else expect((await nativeCall(member, 'settings.describe', {})).status).toBe(401)
        expect(ready.pid).not.toBe(firstPid); expect(ready.standardDigest).toBe(member.ready.standardDigest)
        expect(await member.transport.requestControl('session.preset', { sessionId: entry.sessionId }))
          .toEqual({ sessionId: entry.sessionId, agentPreset: after.presetId, hasForkBoundary: true })
        const model = await inspectModel(member)
        const bootModel = modelReads.find(row => row.member === member.username && row.phase === 'boot').data
        // Native settings registrations start revision 0 in each process;
        // persisted values survive, this in-memory CAS counter does not.
        // Assert the exact restored counter AND all unchanged configuration,
        // rather than requiring the previous process's revision to persist.
        expect(bootModel.configuration.revision).toBe(1)
        expect(model.data).toEqual({ ...bootModel, configuration: { ...bootModel.configuration, revision: 0 } })
        modelReads.push({ member: member.username, phase: 'cold-recovery', ...model })
        if (entry === h) {
          const before = await restarted.request('commandReadState', { sessionId: entry.sessionId })
          expect(before.live).toBe(false)
          const listed = await nativeCall(member, 'commands/list', { args: { agentId: entry.sessionId } })
          expect(listed.status).toBe(hStatus)
          const after = await restarted.request('commandReadState', { sessionId: entry.sessionId })
          expect(after).toEqual(before)
          commandReads.push({ phase: 'cold-withdrawn-no-native-resume-or-history-write', member: member.username, before, after, listed })
        } else {
          // An eligible cold session keeps the original Agent resolver. Use a
          // distinct existing personal session, not the helper-resumed one.
          const sessionId = member.username + '-personal-session-0'
          const before = await restarted.request('commandReadState', { sessionId })
          expect(before.live).toBe(false)
          const listed = await nativeCall(member, 'commands/list', { args: { agentId: sessionId } })
          expect(listed.status).toBe(200)
          const after = await restarted.request('commandReadState', { sessionId, prefixBytes: before.rawBytes })
          expect(after.live).toBe(true); expect(after.historyPrefixSha256).toBe(before.rawSha256)
          expect(after.events.slice(before.events.length)).toEqual(['session/end-seed'])
          expect(after.modelCalls).toBe(0); expect(listed.body.result).toEqual({ ok: true, value: after.descriptors })
          commandReads.push({ phase: 'cold-eligible-original-resolver', member: member.username, before, after, listed })
        }
        const restored = await restarted.request('resume', { sessionId: entry.sessionId, presetId: after.presetId, prefixBytes: after.rawBytes })
        expect(restored.historyPrefixSha256).toBe(after.rawSha256)
        expect(restored.replies).toEqual(after.replies); expect(restored.calls).toHaveLength(0)
        expect(restored.checks).toHaveLength(0); expect(restored.presetId).toBe(after.presetId)
        const resumed = await restarted.request('prompt', { sessionId: entry.sessionId, source: entry.source, mode })
        if (entry === h) { expect(resumed.calls).toHaveLength(0); expect(resumed.endings.at(-1)).toBe('error') }
        else {
          expect(resumed.calls.some((call: any) => call.skillBodyVisible)).toBe(true)
          expect(resumed.uses.some((use: any) => use.publicationId === submittedSkill.publicationId)).toBe(true)
        }
        expect((await restarted.request('catalog')).profiles).toHaveLength(2)
        receipts.push({ member: member.username, firstPid, secondPid: ready.pid, before: entry.before, after, restored, resumed })
      }
      for (const cell of cells) { await cell.process.request('stop'); expect(await cell.process.closed).toEqual({ code: 0, signal: null }) }
      await writeFile(join(directory, 'receipt.json'), JSON.stringify({ fault, mode, receipts, modelReads, commandReads, transitions, downloads, realSeparateNativeProcesses: true,
        fullOriginalPresetAndLoop: true, realPostgresGatewayAndPrivateAuthority: true, actualCompleteSkillBytes: true,
        actualNativeProcessColdRecoveryAndCurrentRevocation: true,
        containerPinsAndModelWireAreFixtures: true, browserE2EVerified: false, finalWorkerImageAccepted: false, externalModelCalls: 0 }, null, 2), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      await writeFile(join(directory, 'failure.json'), JSON.stringify({ fault, mode, transitions, downloads, error: String(error instanceof Error ? error.stack : error) }, null, 2), { flag: 'wx', mode: 0o600 })
      throw error
    } finally { for (const dispose of cleanup.reverse()) await dispose() }
  }, 90000)
