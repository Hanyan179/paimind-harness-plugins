import { createRequire } from 'node:module'
import { randomBytes, randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { readFileSync, statSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { Identity } from '../src/identity.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { Publications } from '../src/publications.js'
import { CellTransport } from '../src/cell-transport.js'
import { createAgentPublicationSnapshot } from '@paimind/agent-builder/publication'
import { adoptedPresetId } from '@paimind/agent-builder/adoption'
import { installManagedHarnessOriginGuard } from '../../../packages/harness-compat/src/managed-origins.js'
import { createManagedHarnessJobsProvider } from '../../../packages/harness-compat/src/managed-jobs.js'
import { createNativeControlBroker, createNativeControlPeer, authorizeNativeExecution, sealNativeJobOrigins } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'

const path = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!path || statSync(path).mode & 0o077) throw Error('Private isolated PostgreSQL configuration required')
const config = JSON.parse(readFileSync(path, 'utf8'))
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || ['3080', '5432', '10012', '55857'].includes(url.port)) throw Error('Unsafe job completion database')
}
const owner = postgres(config.ownerUrl, { max: 2, onnotice: () => {} }), sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
afterAll(async () => { await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })
const context = () => ({ key: randomUUID(), requestId: randomUUID() })
const local = createRequire(import.meta.url), native = createRequire(local.resolve('@deepseek-ai/dsh/package.json'))
const web = createRequire(native.resolve('@deepseek-ai/dsh-web-app/package.json'))
const { Context } = web('@deepseek-ai/cordis'), { AgentLoop } = web('@deepseek-ai/dsh-agent-loop')
const { AgentRegistry } = web('@deepseek-ai/dsh-agent'), { SessionStore } = web('@deepseek-ai/dsh-session')
const { LlmRuntime, LlmAdapter, createUserMessage } = web('@deepseek-ai/dsh-llm'), { ToolRuntime } = web('@deepseek-ai/dsh-tools')
const { SystemPrompt } = web('@deepseek-ai/dsh-system-prompt'), { LocalJobRegistry } = native('@deepseek-ai/dsh-jobs-local')
const controller = native('@deepseek-ai/dsh-tool-jobs')

it.each(['live', 'logout', 'withdraw'] as const)(
  'delivers original native job completions through real PG and both private links after %s (explicit producer/preset/pin/model fixtures)', async mode => {
    const tenantId = 'job-completion-' + randomUUID(), password = 'Synthetic isolated job completion password 2026'
    const cleanups: (() => unknown | Promise<unknown>)[] = [], runtimes: any[] = []
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
      const alternate = (await identity.login({ username: 'hansen', password }, context())).token
      const snapshot = createAgentPublicationSnapshot({ schema: 'paimind.agent-publication/v1', agentId: 'hansen-jobs',
        presetId: 'hansen-jobs', configVersion: 'v1-fixture', nativeCompositionDigest: 'sha256:' + 'c'.repeat(64),
        profile: { name: 'Hansen 客户跟进助手', description: '后台任务完成', basePresetId: 'standard', role: '客户助理',
          goal: '收取原任务结果', behavior: '保留权限来源', instructions: '', preferredSkillNames: [] }, dependencies: [] })
      const publications = new Publications(identity, async () => snapshot)
      const submitted = (await publications.submit(members[0]!.token, { presetId: 'hansen-jobs', expectedVersion: 'v1-fixture', reason: '后台任务完成通知验收' }, context())).data
      const approved = (await publications.review(admin, submitted.publicationId, { decision: 'publish', expectedRevision: submitted.revision, reason: '批准原生任务验收' }, context())).data
      const assigned = (await publications.assign(admin, approved.publicationId, { subjectKind: 'user', subjectId: members[0]!.account.userId,
        effect: 'allow', active: true, expectedRevision: approved.revision, reason: '仅分配给 Hansen' }, context())).data
      for (const member of members) {
        const username = member.account.username
        let ingress: ReturnType<typeof createNativeIngress>
        const broker = await createNativeControlBroker('/tmp', (input, signal) => ingress.checkOrigins(input, signal),
          (input, signal) => ingress.authorizeExecution(input, signal), (input, signal) => ingress.deriveOrigins(input, signal),
          (input, signal) => ingress.sealJobOrigins(input, signal))
        cleanups.push(() => broker.close())
        const key = randomBytes(32).toString('hex')
        ingress = createNativeIngress({ token: key, control: (operation, input, signal) => broker.request(operation, input, signal) })
        await new Promise<void>(resolve => ingress.server.listen(0, '127.0.0.1', resolve)); cleanups.push(() => ingress.close())
        const address = ingress.server.address(); if (!address || typeof address === 'string') throw Error('Missing private fixture address')
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
          (input, signal) => bindings.deriveInteractiveOrigins(pin.cellId, input, signal),
          (input, signal) => bindings.sealJobOrigins(pin.cellId, input, signal))
        const peer = createNativeControlPeer(createConnection(broker.path), { handle: async () => { throw Error('Unused publication RPC') } })
        cleanups.push(() => peer.close()); await vi.waitFor(() => expect(peer.ready).toBe(true))
        const root = new Context(), done = Promise.withResolvers<any>(), entered = Promise.withResolvers<void>(), held = Promise.withResolvers<void>()
        const signing = Promise.withResolvers<void>(), resumeSigning = Promise.withResolvers<void>(), signed = Promise.withResolvers<void>()
        let modelCalls = 0; const notices: any[] = [], signErrors: string[] = [], exit = vi.fn()
        cleanups.push(async () => {
          resumeSigning.resolve(); held.resolve(); done.resolve({ status: 'killed' })
          for (const agent of root.get('agents')?.list() ?? []) agent.cancel({ kind: 'user' })
          await root.fiber.dispose()
        })
        const presetId = username === 'hansen' ? adoptedPresetId(assigned.publicationId) : 'standard'
        // Only receipt/preset composition and producer/model are fixtures;
        // native owners, signing, current DB policy and both links are real.
        root.provide('paimindAgentProfiles', { getAdoptedPublication: async () => ({ tenantId,
          publicationId: assigned.publicationId, sourceUserId: members[0]!.account.userId, snapshot }) })
        const check = (input: any, signal: AbortSignal) => authorizeNativeExecution(root, peer, input, signal)
        installManagedHarnessOriginGuard(root, check)
        const jobs = createManagedHarnessJobsProvider(root, LocalJobRegistry, check, exit, { controller,
          seal: async (input, signal) => {
            signing.resolve()
            if (username === 'hansen' && mode !== 'live') await resumeSigning.promise
            try { return await sealNativeJobOrigins(root, peer, input, signal) }
            catch (error) { signErrors.push('denied'); throw error }
            finally { signed.resolve() }
          } })
        for (const [plugin, settings] of [[SessionStore], [AgentRegistry], [SystemPrompt, {}], [LlmRuntime], [ToolRuntime, {}], [jobs.Provider, {}]]) await root.plugin(plugin, settings)
        root.llm.registerAdapter(['local-only'], new class extends LlmAdapter {
          async *stream(request: { signal: AbortSignal }) {
            modelCalls++; entered.resolve()
            await Promise.race([held.promise, new Promise<void>(resolve => {
              if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', () => resolve(), { once: true })
            })])
            yield { type: 'finish', reason: { kind: 'stop' } }
          }
        }())
        await root.plugin(AgentLoop, { agents: [] }); await root.plugin(jobs.selectController(controller), {})
        root.on('agent/inbox/inserted', ({ message }: any) => { if (message.source.plugin === 'tool-jobs') notices.push(message) })
        const handle = await root.agents.create({ sessionId: username, meta: { agentPreset: presetId }, agentOptions: { provider: 'local-only', model: 'synthetic' } })
        const source = await identity.sealInteractiveOrigin(member.token, randomUUID(), {
          tenantId, userId: member.account.userId, role: 'member', cellId: pin.cellId, nativeSessionId: handle.agent.id })
        handle.agent.followup(createUserMessage({ source: { kind: 'user', rpcId: source }, content: [{ type: 'text', text: 'Start own task' }] }))
        await entered.promise
        const cancel = vi.fn(() => done.resolve({ status: 'killed' }))
        const id = root.jobs.start({ kind: 'bash', label: member.account.displayName + ' private job', owner: handle.agent,
          run: () => ({ done: done.promise, cancel }) })
        held.resolve(); await handle.agent.whenIdle()
        runtimes.push({ ...member, root, peer, pin, handle, presetId, source, done, id, cancel, notices, signing, signed, resumeSigning,
          modelCalls: () => modelCalls, signErrors, exit, check })
      }
      const [hansen, alex] = runtimes
      for (const runtime of runtimes) runtime.done.resolve({ status: 'completed', output: runtime.account.username + ' only' })
      await hansen.signing.promise
      if (mode === 'logout') await identity.logout(hansen.token, {}, context())
      if (mode === 'withdraw') await publications.review(admin, assigned.publicationId, { decision: 'withdraw', expectedRevision: assigned.revision, reason: '签名等待期间撤销' }, context())
      hansen.resumeSigning.resolve(); await hansen.signed.promise
      await vi.waitFor(() => expect(alex.modelCalls()).toBe(2)); await alex.handle.agent.whenIdle()
      if (mode === 'live') {
        await vi.waitFor(() => expect(hansen.modelCalls()).toBe(2)); await hansen.handle.agent.whenIdle()
        for (const runtime of runtimes) {
          expect(runtime.notices).toHaveLength(1)
          const notice = runtime.notices[0], payload = JSON.parse(Buffer.from(notice.source.paimindOrigins[0].split('.')[1], 'base64url').toString('utf8'))
          expect(payload).toMatchObject({ nativeJobId: runtime.id, nativeSessionId: runtime.handle.agent.id, delegatedPresetId: runtime.presetId })
          expect(notice.source.paimindOrigins).not.toContain(runtime.source)
          expect(runtime.handle.agent.session.events.some((event: any) => event.type === 'user/message' && event.data.id === notice.id)).toBe(true)
          await expect(runtime.check({ nativeSessionId: runtime.handle.agent.id, presetId: 'other-preset', sources: notice.source.paimindOrigins }, new AbortController().signal)).rejects.toThrow()
        }
        await expect(alex.peer.authorizeExecution({ nativeSessionId: 'alex', presetId: 'standard', publication: null, skills: [],
          sources: hansen.notices[0].source.paimindOrigins })).rejects.toThrow()
      } else {
        expect(hansen.notices).toHaveLength(0); expect(hansen.modelCalls()).toBe(1); expect(hansen.signErrors).toEqual(['denied'])
        const otherSource = await identity.sealInteractiveOrigin(alternate, randomUUID(), {
          tenantId, userId: hansen.account.userId, role: 'member', cellId: hansen.pin.cellId, nativeSessionId: 'hansen' })
        await hansen.peer.checkOrigins({ nativeSessionId: 'hansen', sources: [otherSource] })
      }
      for (const runtime of runtimes) {
        expect(runtime.cancel).not.toHaveBeenCalled(); expect(runtime.exit).not.toHaveBeenCalled()
        expect(runtime.root.jobs.get(runtime.id, runtime.handle.agent).status).toBe('completed')
        expect(runtime.root.jobs.read(runtime.id, runtime.handle.agent).text).toBe(runtime.account.username + ' only')
      }
      const directory = await mkdtemp(join(config.evidence, 'native-job-completion-'))
      await writeFile(join(directory, 'receipt.json'), JSON.stringify({ mode, tenantId, realPostgresAndBothPrivateLinks: true,
        realNativeJobAndCompletionController: true, syntheticProducersPresetsReceiptsPinsAndModels: true,
        externalModelCalls: 0, browserE2EVerified: false, finalImageVerified: false,
        members: runtimes.map(runtime => ({ name: runtime.account.username, jobId: runtime.id, modelCalls: runtime.modelCalls(),
          noticeCount: runtime.notices.length, signingDenied: runtime.signErrors.length, cancelCalls: runtime.cancel.mock.calls.length })) }, null, 2), { flag: 'wx', mode: 0o600 })
    } finally { for (const cleanup of cleanups.reverse()) await cleanup() }
  })
