import { createRequire } from 'node:module'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { Identity } from '../src/identity.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { installManagedHarnessOriginGuard } from '../../../packages/harness-compat/src/managed-origins.js'
import { createManagedHarnessJobsProvider } from '../../../packages/harness-compat/src/managed-jobs.js'
import { authorizeNativeExecution } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'

const path = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!path || statSync(path).mode & 0o077) throw Error('Private isolated PostgreSQL configuration required')
const config = JSON.parse(readFileSync(path, 'utf8'))
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || ['3080', '5432', '10012', '55857'].includes(url.port)) throw Error('Unsafe job integration database')
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
const { SkillRegistry } = native('@deepseek-ai/dsh-skill'), ToolSkill = native('@deepseek-ai/dsh-tool-skill')

it.each(['logout', 'disabled-member', 'suspended-binding'] as const)(
  'revokes only the initiating members original idle-owner job after %s, with real PG and explicit native-producer/pin/model fixtures', async mode => {
    const tenantId = 'job-authority-' + randomUUID(), password = 'Synthetic isolated job authority password 2026'
    const roots: any[] = [], tasks: any[] = [], runtimes: any[] = []
    try {
      await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
      const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
      await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, context())
      const admin = (await identity.login({ username: 'morgan', password }, context())).token
      for (const [username, displayName] of [['hansen', 'Hansen'], ['alex', 'Alex']]) {
        const account = (await identity.createMember(admin, { username, displayName, password }, context())).data
        const token = (await identity.login({ username, password }, context())).token
        const [unused] = await owner`select candidate from generate_series(17000,26999) ports(candidate)
          where not exists (select 1 from haas.runtime_bindings where origin='http://127.0.0.1:' || candidate::text)
          order by candidate limit 1`
        if (!unused) throw Error('No unused synthetic job fixture origin')
        // These are explicit operator pin fixtures, not actual containers or
        // transports. Native owners and DB authorization below are real.
        const pin: PrivateRuntimeCell = { cellId: randomUUID(), tenantId, userId: account.userId, role: 'member',
          revision: randomUUID(), origin: 'http://127.0.0.1:' + unused.candidate,
          containerId: randomBytes(32).toString('hex'), imageId: 'sha256:' + 'd'.repeat(64),
          volumeName: 'paimind-haas-member-fixture-' + randomUUID(), policyDigest: 'sha256:' + 'e'.repeat(64) }
        await owner`insert into haas.runtime_bindings (cell_id,tenant_id,user_id,origin,revision,isolation_mode,status,lease_expires_at,container_id,image_id,volume_name,policy_digest)
          values (${pin.cellId},${tenantId},${pin.userId},${pin.origin},${pin.revision},'container-managed','ready',clock_timestamp()+interval '10 minutes',
            ${pin.containerId},${pin.imageId},${pin.volumeName},${pin.policyDigest})`
        const bindings = new RuntimeBindings(sql, identity, 'http://127.0.0.1:16999', [], [pin])
        const root = new Context(); roots.push(root)
        const checks: { sources: readonly string[]; allowed: boolean }[] = []
        const check = async (input: any, signal: AbortSignal) => {
          try {
            const requirements = await authorizeNativeExecution(root, { ready: true,
              authorizeExecution: (request, abort) => bindings.authorizeInteractiveExecution(pin.cellId, request, abort!) }, input, signal)
            checks.push({ sources: input.sources, allowed: true })
            return requirements
          } catch (error) { checks.push({ sources: input.sources, allowed: false }); throw error }
        }
        installManagedHarnessOriginGuard(root, check)
        const exit = vi.fn(), jobs = createManagedHarnessJobsProvider(root, LocalJobRegistry, check, exit)
        for (const [plugin, settings] of [[SessionStore], [AgentRegistry], [SystemPrompt, {}], [LlmRuntime], [ToolRuntime, {}], [SkillRegistry], [ToolSkill, {}], [jobs.Provider, {}]]) await root.plugin(plugin, settings)
        root.skills.register({ name: username + '-method', description: displayName + ' original scoped method',
          content: displayName + ' local fixture instructions', source: 'custom' })
        root.jobs.attachController('original-job-controller-fixture')
        const entered = Promise.withResolvers<void>(), held = Promise.withResolvers<void>()
        let modelCalls = 0
        root.llm.registerAdapter(['local-only'], new class extends LlmAdapter {
          async *stream(request: { signal: AbortSignal }) {
            modelCalls++; entered.resolve()
            await Promise.race([held.promise, new Promise<void>(resolve => {
              if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', () => resolve(), { once: true })
            })])
            yield { type: 'finish', reason: { kind: 'stop' } }
          }
        }())
        await root.plugin(AgentLoop, { agents: [] })
        const handle = await root.agents.create({ sessionId: username, meta: { agentPreset: 'standard' },
          agentOptions: { provider: 'local-only', model: 'synthetic' } })
        const seal = (login: string) => identity.sealInteractiveOrigin(login, randomUUID(), {
          tenantId, userId: account.userId, role: 'member', cellId: pin.cellId, nativeSessionId: handle.agent.id })
        const source = await seal(token)
        handle.agent.followup(createUserMessage({ source: { kind: 'user', rpcId: source }, content: [{ type: 'text', text: '/' + username + '-method Run an owned task' }] }))
        await entered.promise
        const nativeMessages = handle.agent.session.events.filter((event: any) => event.type === 'user/message').map((event: any) => event.data)
        expect(nativeMessages.find((message: any) => message.source.kind === 'skill-catalog').source.entries)
          .toEqual([{ name: username + '-method', description: displayName + ' original scoped method' }])
        expect(nativeMessages.find((message: any) => message.source.kind === 'skill-invocation').source.name).toBe(username + '-method')
        const done = Promise.withResolvers<any>(), cancel = vi.fn(() => done.resolve({ status: 'killed' }))
        tasks.push({ done })
        const id = root.jobs.start({ kind: 'bash', label: displayName + ' private result', owner: handle.agent,
          run: () => ({ done: done.promise, cancel }) })
        held.resolve(); await handle.agent.whenIdle()
        await vi.waitFor(() => expect(checks.length).toBeGreaterThanOrEqual(2))
        expect(checks.every(row => row.allowed)).toBe(true)
        expect(cancel).not.toHaveBeenCalled(); expect(root.jobs.get(id, handle.agent).status).toBe('running')
        runtimes.push({ username, account, token, pin, root, handle, seal, source, bindings, checks, id, done, cancel, exit, modelCalls: () => modelCalls })
      }
      const [hansen, alex] = runtimes
      const alternate = (await identity.login({ username: 'hansen', password }, context())).token
      const fresh = await hansen.seal(alternate)
      if (mode === 'logout') await identity.logout(hansen.token, {}, context())
      else if (mode === 'disabled-member') await identity.setMemberStatus(admin, hansen.account.userId, { status: 'disabled', reason: '原生后台任务撤销验收' }, context())
      else await owner`update haas.runtime_bindings set status='suspended' where cell_id=${hansen.pin.cellId}`
      if (mode === 'logout') await hansen.bindings.authorizeInteractiveExecution(hansen.pin.cellId,
        { nativeSessionId: 'hansen', presetId: 'standard', sources: [fresh], publication: null, skills: [] }, new AbortController().signal)
      await vi.waitFor(() => expect(hansen.cancel).toHaveBeenCalledOnce(), { timeout: 6500 })
      await vi.waitFor(() => expect(hansen.root.jobs.get(hansen.id, hansen.handle.agent).status).toBe('killed'))
      expect(hansen.checks.some((row: any) => !row.allowed && row.sources.includes(hansen.source))).toBe(true)
      expect(hansen.checks.every((row: any) => row.sources.length === 1 && row.sources[0] === hansen.source)).toBe(true)
      expect(alex.cancel).not.toHaveBeenCalled(); expect(alex.root.jobs.get(alex.id, alex.handle.agent).status).toBe('running')
      alex.done.resolve({ status: 'completed', output: 'Alex only' })
      await vi.waitFor(() => expect(alex.root.jobs.get(alex.id, alex.handle.agent).status).toBe('completed'))
      expect(alex.root.jobs.read(alex.id, alex.handle.agent).text).toBe('Alex only')
      for (const runtime of runtimes) {
        expect(runtime.exit).not.toHaveBeenCalled(); expect(runtime.modelCalls()).toBe(1)
        expect(runtime.handle.agent.status).toBe('idle')
      }
      const directory = await mkdtemp(join(config.evidence, 'native-job-authority-'))
      await writeFile(join(directory, 'receipt.json'), JSON.stringify({ mode, tenantId, realPostgres: true,
        realNativeOwners: true, syntheticProducersPinsAndModels: true, directAuthorizationService: true,
        browserE2EVerified: false, finalImageVerified: false, externalModelCalls: 0,
        members: runtimes.map(runtime => ({ name: runtime.username, jobId: runtime.id,
          terminal: runtime.root.jobs.get(runtime.id, runtime.handle.agent).status,
          currentChecks: runtime.checks.length, deniedChecks: runtime.checks.filter((row: any) => !row.allowed).length,
          cancelCalls: runtime.cancel.mock.calls.length })) }, null, 2), { flag: 'wx', mode: 0o600 })
    } finally {
      for (const task of tasks) task.done.resolve({ status: 'killed' })
      for (const root of roots.reverse()) {
        for (const agent of root.get('agents')?.list() ?? []) agent.cancel({ kind: 'user' })
        await root.fiber.dispose()
      }
    }
  })
