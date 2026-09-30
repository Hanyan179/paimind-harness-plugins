import { fork, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createWriteStream, readFileSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire, isBuiltin } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { afterAll, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { Identity } from '../src/identity.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { CellTransport } from '../src/cell-transport.js'
import { Publications } from '../src/publications.js'
import { createNativeControlBroker } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { createAgentPublicationSnapshot } from '@paimind/agent-builder/publication'
import { adoptedPresetId } from '@paimind/agent-builder/adoption'

const path = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!path || statSync(path).mode & 0o077) throw Error('Private isolated PostgreSQL configuration required')
const config = JSON.parse(readFileSync(path, 'utf8'))
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || ['3080', '5432', '10012', '55857'].includes(url.port)) throw Error('Unsafe process-recovery database')
}
const owner = postgres(config.ownerUrl, { max: 2, onnotice: () => {} }), sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
afterAll(async () => { await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })
const context = () => ({ key: randomUUID(), requestId: randomUUID() })
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const local = createRequire(import.meta.url), native = createRequire(local.resolve('@deepseek-ai/dsh/package.json'))
const web = createRequire(native.resolve('@deepseek-ai/dsh-web-app/package.json'))

async function compileWorker(directory: string) {
  const outfile = join(directory, 'native-recovery.mjs')
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/native-recovery-worker.mjs', import.meta.url))],
    outfile, platform: 'node', target: 'node24', format: 'esm', bundle: true, logLevel: 'silent',
    plugins: [{ name: 'exact-installed-test-dependencies', setup(build) {
      build.onResolve({ filter: /^[^./]/ }, args => {
        if (isBuiltin(args.path)) return { path: args.path, external: true }
        // The compiled fixture is outside node_modules. Resolve original
        // installed exports to absolute files; do not copy native source.
        for (const resolver of [createRequire(args.importer), local, native, web]) {
          try { return { path: resolver.resolve(args.path), external: true } } catch {}
        }
        return undefined
      })
    } }] })
  return { outfile, sha256: hash(await readFile(outfile)) }
}
async function processClient(script: string, directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const out = createWriteStream(join(directory, 'stdout.log'), { mode: 0o600, flags: 'wx' })
  const err = createWriteStream(join(directory, 'stderr.log'), { mode: 0o600, flags: 'wx' })
  const child: ChildProcess = fork(script, [], { cwd: directory, execPath: process.execPath,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', PAIMIND_NATIVE_PROCESS_TEST: '1', DSH_HOME: join(directory, 'isolated-home') },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'json' })
  child.stdout!.pipe(out); child.stderr!.pipe(err)
  const pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error(`Owned native test process exited (${code ?? signal})`)) }
      pending.clear(); resolve({ code, signal })
    })
  })
  child.on('message', (reply: any) => {
    const item = pending.get(reply?.id)
    if (!item) return
    clearTimeout(item.timer); pending.delete(reply.id)
    if (reply.ok) item.resolve(reply.value); else item.reject(Error(reply.error))
  })
  const request = (method: string, input: object = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(Error('Bounded native process command timed out: ' + method)) }, 12000)
    pending.set(id, { resolve, reject, timer })
    child.send({ id, method, input }, error => { if (error) { clearTimeout(timer); pending.delete(id); reject(error) } })
  })
  return { child, closed, request, pid: child.pid!,
    async cleanup() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 10000)
      try { await closed } finally { clearTimeout(timer) }
    } }
}

it.each(['live', 'logout', 'withdraw', 'orderly'] as const)(
  'recovers actual native processes and current member authority after %s (explicit local-model/preset fixtures)', async mode => {
    const directory = await mkdtemp(join(config.evidence, 'native-process-recovery-'))
    const compiled = await compileWorker(directory), cleanups: (() => Promise<unknown> | void)[] = []
    const tenantId = 'process-recovery-' + randomUUID(), password = 'Synthetic isolated process recovery password 2026'
    const receipts: any[] = []
    try {
      await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
      const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
      await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, context())
      const admin = (await identity.login({ username: 'morgan', password }, context())).token
      const members = []
      for (const [username, displayName] of [['hansen', 'Hansen'], ['alex', 'Alex']]) {
        const account = (await identity.createMember(admin, { username, displayName, password }, context())).data
        members.push({ account, token: (await identity.login({ username, password }, context())).token })
      }
      const anotherHansen = (await identity.login({ username: 'hansen', password }, context())).token
      const snapshot = createAgentPublicationSnapshot({ schema: 'paimind.agent-publication/v1', agentId: 'hansen-recovery',
        presetId: 'hansen-recovery', configVersion: 'v1-fixture', nativeCompositionDigest: 'sha256:' + 'c'.repeat(64),
        profile: { name: 'Hansen 客户跟进助手', description: '进程恢复', basePresetId: 'standard', role: '客户助理',
          goal: '核对恢复与权限', behavior: '保留真实来源', instructions: '', preferredSkillNames: [] }, dependencies: [] })
      const publications = new Publications(identity, async () => snapshot)
      const submitted = (await publications.submit(members[0]!.token, { presetId: 'hansen-recovery', expectedVersion: 'v1-fixture', reason: '进程恢复夹具' }, context())).data
      const approved = (await publications.review(admin, submitted.publicationId, { decision: 'publish', expectedRevision: submitted.revision, reason: '批准恢复验证' }, context())).data
      const assigned = (await publications.assign(admin, approved.publicationId, { subjectKind: 'user', subjectId: members[0]!.account.userId,
        effect: 'allow', active: true, expectedRevision: approved.revision, reason: '仅分配给 Hansen' }, context())).data
      const runtimes = []
      for (const member of members) {
        let ingress: ReturnType<typeof createNativeIngress>
        const broker = await createNativeControlBroker('/tmp', (input, signal) => ingress.checkOrigins(input, signal),
          (input, signal) => ingress.authorizeExecution(input, signal), (input, signal) => ingress.deriveOrigins(input, signal))
        cleanups.push(() => broker.close())
        const key = randomBytes(32).toString('hex')
        ingress = createNativeIngress({ token: key, control: (operation, input, signal) => broker.request(operation, input, signal) })
        await new Promise<void>(resolve => ingress.server.listen(0, '127.0.0.1', resolve))
        cleanups.push(() => ingress.close())
        const address = ingress.server.address()
        if (!address || typeof address === 'string') throw Error('Missing owned ingress address')
        const origin = `http://127.0.0.1:${address.port}`, transport = new CellTransport(origin, key)
        cleanups.push(() => transport.destroy())
        const pin: PrivateRuntimeCell = { cellId: randomUUID(), tenantId, userId: member.account.userId, role: 'member', revision: randomUUID(), origin,
          containerId: randomBytes(32).toString('hex'), imageId: 'sha256:' + 'd'.repeat(64),
          volumeName: 'paimind-haas-member-fixture-' + randomUUID(), policyDigest: 'sha256:' + 'e'.repeat(64) }
        await owner`insert into haas.runtime_bindings (cell_id,tenant_id,user_id,origin,revision,isolation_mode,status,lease_expires_at,container_id,image_id,volume_name,policy_digest)
          values (${pin.cellId},${tenantId},${pin.userId},${origin},${pin.revision},'container-managed','ready',clock_timestamp()+interval '10 minutes',
            ${pin.containerId},${pin.imageId},${pin.volumeName},${pin.policyDigest})`
        const bindings = new RuntimeBindings(sql, identity, 'http://127.0.0.1:16999', [], [pin])
        await transport.openOriginAuthority((input, signal) => bindings.checkInteractiveOrigins(pin.cellId, input, signal),
          (input, signal) => bindings.authorizeInteractiveExecution(pin.cellId, input, signal),
          (input, signal) => bindings.deriveInteractiveOrigins(pin.cellId, input, signal))
        const enterprise = mode === 'withdraw' && member.account.username === 'hansen'
        const parentId = 'recovery-' + member.account.username
        const boot = { directory: join(directory, member.account.username + '-native-history'), socketPath: broker.path, parentId,
          presetId: enterprise ? adoptedPresetId(assigned.publicationId) : 'standard',
          publication: enterprise ? { tenantId, publicationId: assigned.publicationId, sourceUserId: member.account.userId, contentDigest: assigned.digest } : null }
        const seal = (token: string, nativeSessionId = parentId) => identity.sealInteractiveOrigin(token, randomUUID(), {
          tenantId, userId: member.account.userId, role: 'member', cellId: pin.cellId, nativeSessionId })
        const first = await processClient(compiled.outfile, join(directory, member.account.username + '-first'))
        cleanups.push(() => first.cleanup())
        await first.request('boot', { ...boot, holdParent: true, resume: false })
        await first.request('prompt', { source: await seal(member.token) })
        const seeded = await first.request('child')
        await writeFile(join(directory, member.account.username + '-before.json'), JSON.stringify(seeded, null, 2), { flag: 'wx', mode: 0o600 })
        expect(seeded.parent.nextStep).toHaveLength(1)
        const notice = seeded.parent.nextStep[0]
        expect(notice.source).toMatchObject({ kind: 'subagent-settled', senderSessionId: seeded.childId })
        expect(notice.source.paimindOrigins).toHaveLength(1)
        if (mode === 'orderly') { await first.request('stop'); expect(await first.closed).toEqual({ code: 0, signal: null }) }
        else { first.child.kill('SIGKILL'); expect(await first.closed).toEqual({ code: null, signal: 'SIGKILL' }) }
        await vi.waitFor(() => expect(broker.ready).toBe(false))
        runtimes.push({ member, broker, boot, seal, first, seeded, notice })
      }
      if (mode === 'logout') await identity.logout(members[0]!.token, {}, context())
      if (mode === 'withdraw') await publications.review(admin, assigned.publicationId, { decision: 'withdraw', expectedRevision: assigned.revision, reason: '停机期间撤销企业版本' }, context())
      for (const runtime of runtimes) {
        const { member, boot, seeded, notice } = runtime
        const second = await processClient(compiled.outfile, join(directory, member.account.username + '-second'))
        cleanups.push(() => second.cleanup())
        const ready = await second.request('boot', { ...boot, holdParent: false, resume: true })
        expect(ready.pid).not.toBe(runtime.first.pid); expect(ready.parentId).toBe(boot.parentId)
        const restored = await second.request('idle')
        await writeFile(join(directory, member.account.username + '-restored.json'), JSON.stringify(restored, null, 2), { flag: 'wx', mode: 0o600 })
        expect(restored.raw.startsWith(seeded.parent.raw)).toBe(true)
        expect(restored.presetId).toBe(boot.presetId)
        const revoked = member.account.username === 'hansen' && ['logout', 'withdraw'].includes(mode)
        expect(restored.calls).toHaveLength(0)
        expect(restored.checks).toHaveLength(0)
        if (mode === 'orderly') {
          expect(restored.nextStep).toHaveLength(0)
          expect(restored.events.some((event: any) => event.type === 'agent/inbox/spliced' && event.data.outcome === 'canceled')).toBe(true)
        } else expect(restored.nextStep).toEqual([notice])
        // Native resume projects its original durable inbox without waking.
        // A new followup wakes the original driver, which claims old next-step
        // work together with the next-turn input. Every source must be valid;
        // the current login cannot launder a revoked source in that batch.
        const token = member.account.username === 'hansen' && mode === 'logout' ? anotherHansen : member.token
        const wake = await second.request('prompt', { source: await runtime.seal(token) })
        const parentCalls = wake.calls.filter((call: any) => call.provider === 'parent-local-only')
        expect(parentCalls.length > 0).toBe(!revoked)
        if (mode !== 'orderly') {
          expect(wake.checks.some((input: any) => input.allowed === !revoked
            && input.sources.some((source: string) => notice.source.paimindOrigins.includes(source)))).toBe(true)
          expect(wake.events.some((event: any) => event.type === 'user/message' && event.data.id === notice.id)).toBe(!revoked)
          expect(wake.nextStep).toHaveLength(0)
        }
        // Read-only cold lineage checks must not publish the old child. A
        // separately submitted permitted turn can run after a rejected batch.
        expect(wake.liveIds).toEqual([boot.parentId])
        const fresh = await second.request('prompt', { source: await runtime.seal(token) })
        const freshCalls = fresh.calls.filter((call: any) => call.provider === 'parent-local-only').length
        expect(freshCalls > parentCalls.length).toBe(!(member.account.username === 'hansen' && mode === 'withdraw'))
        let continuation
        if (!(member.account.username === 'hansen' && mode === 'withdraw')) {
          const continued = await second.request('followup', { childId: seeded.childId, source: await runtime.seal(token, seeded.childId) })
          expect(continued.childRaw.startsWith(seeded.childRaw)).toBe(true)
          expect(continued.parent.endings.some((ending: any) => ending.id === seeded.childId)).toBe(true)
          expect(continued.parent.events.some((event: any) => event.type === 'user/message'
            && event.data.source.kind === 'subagent-settled' && event.data.source.senderSessionId === seeded.childId && event.data.id !== notice.id)).toBe(true)
          continuation = continued
        } else {
          // This is the internal native message API, not the public gateway's
          // request-admission boundary. Native cold resume records the attempt
          // and its rejected execution; it must not erase that history or
          // pretend acceptance means permission to invoke a model.
          continuation = await second.request('followup', { childId: seeded.childId,
            source: await runtime.seal(token, seeded.childId) })
          expect(continuation.childRaw.startsWith(seeded.childRaw)).toBe(true)
          const appended = continuation.childRaw.slice(seeded.childRaw.length).trim().split('\n').filter(Boolean).map((line: string) => JSON.parse(line))
          expect(appended.some((event: any) => event.type === 'turn/end' && event.data.reason.kind === 'error')).toBe(true)
          expect(appended.some((event: any) => event.type === 'user/message' || event.type === 'assistant/message')).toBe(false)
          expect(continuation.parent.liveIds).toEqual([boot.parentId])
          expect(continuation.parent.calls).toHaveLength(0)
          expect(continuation.parent.checks.some((input: any) => input.nativeSessionId === seeded.childId && input.allowed === false)).toBe(true)
        }
        await writeFile(join(directory, member.account.username + '-wake-and-fresh.json'), JSON.stringify({ wake, fresh, continuation }, null, 2), { flag: 'wx', mode: 0o600 })
        receipts.push({ member: member.account.username, firstPid: runtime.first.pid, secondPid: ready.pid,
          parentId: boot.parentId, childId: seeded.childId, revoked, beforeHash: seeded.parent.rawSha256, restoredHash: restored.rawSha256 })
        await second.request('stop'); expect(await second.closed).toEqual({ code: 0, signal: null })
      }
      await writeFile(join(directory, 'receipt.json'), JSON.stringify({ mode, compiledSha256: compiled.sha256, receipts,
        realSeparateNodeProcesses: true, realPostgresAndPrivateAuthority: true, syntheticPresetOwnerContainerPinsAndModels: true,
        browserE2EVerified: false, externalModelCalls: 0 }, null, 2), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      await writeFile(join(directory, 'failure.json'), JSON.stringify({ mode, tenantId,
        error: String(error instanceof Error ? error.stack : error) }, null, 2), { flag: 'wx', mode: 0o600 })
      throw error
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup()
      // Unique synthetic tenants remain in this separately owned disposable
      // database with the evidence. Do not weaken foreign keys to clean them.
    }
  }, 60000)
