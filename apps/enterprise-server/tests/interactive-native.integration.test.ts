import { createRequire } from 'node:module'
import { createServer, type Server } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { readFileSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { Identity } from '../src/identity.js'
import { readHarnessPromptCorrelation } from '../../../packages/harness-compat/src/prompt-correlation.js'
import { NativeGateway } from '../src/native-gateway.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { createEnterpriseServer } from '../src/server.js'
import { CellTransport } from '../src/cell-transport.js'
// Internal native adapters must use the same module generation. Mixing the
// bundled guard with a source-only child adapter creates two private lifetimes.
import { installManagedHarnessOriginGuard } from '../../../packages/harness-compat/src/managed-origins.js'
import { createNativeControlBroker, createNativeControlPeer } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { Publications } from '../src/publications.js'
import { createAgentPublicationSnapshot } from '@paimind/agent-builder/publication'
import { adoptedPresetId } from '@paimind/agent-builder/adoption'
import { definePaimindHarnessTool, readPaimindNativeSessionPresetReference } from '@paimind/harness-compat/host'
import { guardManagedHarnessQueueApi, type ManagedHarnessQueueCheck } from '../../../packages/harness-compat/src/managed-queue.js'
import { createManagedHarnessDelegationProviders } from '../../../packages/harness-compat/src/managed-delegation.js'

const configPath = process.env.PAIMIND_HAAS_TEST_CONFIG
if (!configPath || (statSync(configPath).mode & 0o077) !== 0) throw Error('Private isolated PostgreSQL configuration required')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || ['3080', '5432', '10012'].includes(url.port)) throw Error('Unsafe integration database')
}
const owner = postgres(config.ownerUrl, { max: 2, onnotice: () => {} }), sql = postgres(config.applicationUrl, { max: 5, onnotice: () => {} })
afterAll(async () => { await sql.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })
const local = createRequire(import.meta.url)
const web = createRequire(createRequire(local.resolve('@deepseek-ai/dsh/package.json')).resolve('@deepseek-ai/dsh-web-app/package.json'))
const { Context } = web('@deepseek-ai/cordis'), { AgentLoop } = web('@deepseek-ai/dsh-agent-loop')
const { AgentRegistry } = web('@deepseek-ai/dsh-agent'), { SessionStore } = web('@deepseek-ai/dsh-session')
const { LlmRuntime, LlmAdapter } = web('@deepseek-ai/dsh-llm'), { ToolRuntime } = web('@deepseek-ai/dsh-tools')
const { SystemPrompt } = web('@deepseek-ai/dsh-system-prompt')
const { JsonlSessionPersistence } = web('@deepseek-ai/dsh-session-persistence-jsonl')
const { createApiProxy, toFetchHandler, AbstractApiClient } = web('@deepseek-ai/dsh-host-apiproxy')
const nativeSpawn = createRequire(local.resolve('@deepseek-ai/dsh/package.json'))('@deepseek-ai/dsh-subagent-spawn-in-process')
async function listen(server: Server) {
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing port')
  return `http://127.0.0.1:${address.port}`
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()))
}

it.each([false, true])('carries exact live login provenance through real HTTP and native rc.2, reverse gate=%s (no external model or Browser E2E)', async reverse => {
  const root = new Context(), held = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
  const insertions: any[] = [], upstreamRequests: any[] = []
  let modelCalls = 0, gateway: NativeGateway | undefined
  const servers: Server[] = []
  const cleanups: (() => unknown | Promise<unknown>)[] = []
  const decisions: { sources: string[]; allowed: boolean }[] = []
  const tenantId = `native-origin-${randomUUID()}`, context = () => ({ key: randomUUID(), requestId: randomUUID() })
  try {
    await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
    const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
    const credentials = { username: 'hansen', password: 'Synthetic native origin password 2026' }
    const bootstrap = { ...credentials, username: reverse ? 'morgan' : 'hansen' }
    let account = (await identity.bootstrap({ ...bootstrap, displayName: reverse ? 'Morgan' : 'Hansen', bootstrapSecret: config.bootstrapSecret }, context())).data
    if (reverse) {
      const admin = (await identity.login(bootstrap, context())).token
      account = (await identity.createMember(admin, { ...credentials, displayName: 'Hansen' }, context())).data
      await identity.logout(admin, {}, context())
    }
    const role = reverse ? 'member' as const : 'admin' as const
    const first = await identity.login(credentials, context()), second = await identity.login(credentials, context())
    for (const [plugin, settings] of [[SessionStore], [AgentRegistry], [SystemPrompt, {}], [LlmRuntime], [ToolRuntime, {}]]) await root.plugin(plugin, settings)
    root.llm.registerAdapter(['origin-no-model'], new class extends LlmAdapter {
      async *stream() { modelCalls++; throw Error('Real model calls are forbidden in this integration fixture') }
    }())
    await root.plugin(AgentLoop, { agents: [] })
    root.provide('userQuestions', { registerProvider: () => () => {} }) // unused host question fixture
    root.on('agent/inbox/inserted', ({ message }: any) => insertions.push(structuredClone(message)))
    root.on('agent/pre-step', async (_event: unknown, next: () => Promise<unknown>) => {
      entered.resolve(); await held.promise; return reverse ? next() : { kind: 'reject' }
    }, { prepend: true })
    const handle = await root.agents.create({ sessionId: 'native-hansen-origin', meta: { agentPreset: 'standard' }, agentOptions: { provider: 'origin-no-model', model: 'never-dispatched' } })
    expect(handle.agent.session.header.agentPreset).toBe('standard')
    const api = createApiProxy(root, { defaultModelSelection: () => ({ provider: 'origin-no-model', model: 'never-dispatched' }) })
    let queueAuthority: ManagedHarnessQueueCheck | undefined
    const sessions = reverse ? guardManagedHarnessQueueApi(root, api.sessions, async (input, signal) => {
      if (!queueAuthority) throw Error('Queue authority not attached')
      await queueAuthority(input, signal)
    }) : api.sessions
    const handler = toFetchHandler({ ...api, sessions })
    const native = createServer((req, res) => { void (async () => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      upstreamRequests.push({ headers: req.headers, body: JSON.parse(body.toString()) })
      const reply = await handler.fetch(new Request('http://dsh.internal' + req.url, { method: req.method,
        headers: { 'content-type': 'application/json' }, body }))
      res.statusCode = reply.status; reply.headers.forEach((value: string, key: string) => res.setHeader(key, value))
      res.end(Buffer.from(await reply.arrayBuffer()))
    })().catch(() => { res.statusCode = 500; res.end() }) })
    servers.push(native); const nativeOrigin = await listen(native)
    const reservation = createServer(); const publicOrigin = await listen(reservation); await close(reservation)
    const cellId = randomUUID()
    let transport: CellTransport | undefined, privateCell: PrivateRuntimeCell | undefined, peer: ReturnType<typeof createNativeControlPeer> | undefined
    if (reverse) {
      let ingress: ReturnType<typeof createNativeIngress>
      const broker = await createNativeControlBroker('/tmp', (input: unknown, signal: AbortSignal) => ingress.checkOrigins(input, signal),
        (input: unknown, signal: AbortSignal) => ingress.authorizeExecution(input, signal),
        (input: unknown, signal: AbortSignal) => ingress.deriveOrigins(input, signal))
      cleanups.push(() => broker.close())
      peer = createNativeControlPeer(createConnection(broker.path), { handle: async (operation, input, signal) => {
        if (operation !== 'session.preset') throw Error('Publication operations unused')
        return readPaimindNativeSessionPresetReference(root, (input as { sessionId: string }).sessionId, signal)
      } })
      cleanups.push(() => peer!.close())
      const key = randomBytes(32).toString('hex')
      ingress = createNativeIngress({ token: key, nativePort: Number(new URL(nativeOrigin).port),
        control: (op: string, input: object, signal: AbortSignal) => broker.request(op, input, signal) })
      cleanups.push(() => ingress.close())
      const origin = await listen(ingress.server)
      transport = new CellTransport(origin, key, Number(new URL(nativeOrigin).port)); cleanups.push(() => transport!.destroy())
      // Identity and carrier are real; these are explicit synthetic container
      // pins, never evidence of actual immutable Worker isolation/admission.
      privateCell = { cellId, tenantId, userId: account.userId, role, revision: randomUUID(), origin,
        containerId: randomBytes(32).toString('hex'), imageId: 'sha256:' + 'd'.repeat(64), volumeName: 'paimind-haas-member-fixture-' + cellId,
        policyDigest: 'sha256:' + 'e'.repeat(64) }
      await owner`insert into haas.runtime_bindings (cell_id, tenant_id, user_id, origin, revision, isolation_mode, status,
        lease_expires_at, container_id, image_id, volume_name, policy_digest)
        values (${cellId}, ${tenantId}, ${account.userId}, ${origin}, ${privateCell.revision}, 'container-managed', 'ready',
          clock_timestamp() + interval '10 minutes', ${privateCell.containerId}, ${privateCell.imageId}, ${privateCell.volumeName}, ${privateCell.policyDigest})`
    } else {
      await owner`insert into haas.runtime_bindings (cell_id, tenant_id, user_id, origin, revision, isolation_mode, status, lease_expires_at)
        values (${cellId}, ${tenantId}, ${account.userId}, ${nativeOrigin}, ${randomUUID()}, 'development-process', 'ready', clock_timestamp() + interval '10 minutes')`
    }
    const bindings = new RuntimeBindings(sql, identity, publicOrigin, reverse ? [] : [nativeOrigin], privateCell ? [privateCell] : [])
    if (transport && peer) {
      await transport.openOriginAuthority(async (input, signal) => {
        try { await bindings.checkInteractiveOrigins(cellId, input, signal); decisions.push({ sources: input.sources, allowed: true }) }
        catch (error) { decisions.push({ sources: input.sources, allowed: false }); throw error }
      }, async (input, signal) => {
        try { await bindings.authorizeInteractiveExecution(cellId, input, signal); decisions.push({ sources: input.sources, allowed: true }) }
        catch (error) { decisions.push({ sources: input.sources, allowed: false }); throw error }
      }, (input, signal) => bindings.deriveInteractiveOrigins(cellId, input, signal))
      const selectedPeer = peer
      installManagedHarnessOriginGuard(root, async (input, signal) => selectedPeer.authorizeExecution({ ...input, sources: [...input.sources], publication: null, skills: [] }, signal))
      queueAuthority = async ({ action, ...input }, signal) => {
        if (action === 'remove') await selectedPeer.checkOrigins({ nativeSessionId: input.nativeSessionId, sources: [...input.sources] }, signal)
        else await selectedPeer.authorizeExecution({ ...input, sources: [...input.sources], publication: null, skills: [] }, signal)
      }
    }
    gateway = new NativeGateway({ publicOrigin, resolve: (token, id) => bindings.resolve(token, id),
      agentPresetEligibility: (token, id, grant, ids) => bindings.readAgentPresetEligibility(token, id, grant, ids),
      ...(transport && privateCell ? { transports: new Map([[privateCell.origin, transport]]) } : {}),
      sealInteractiveOrigin: (token, id, scope, clientRpcId) => identity.sealInteractiveOrigin(token, id, scope, clientRpcId),
      authorize: (token, id, grant, request, verify) => identity.authorizeRuntimeOperation(token, id, grant, request, verify) })
    const server = createEnterpriseServer({ identity, publicOrigin, loopbackDevelopment: true, nativeGateway: gateway })
    servers.push(server); await new Promise<void>(done => server.listen(Number(new URL(publicOrigin).port), '127.0.0.1', done))
    let currentToken = first.token
    const client = new class extends AbstractApiClient {
      mintRpcId() { return 'same-browser-rpc-id' }
      resolveBase() { return publicOrigin }
      doFetch(input: string, init: RequestInit) { return fetch(input, { ...init, headers: { ...init.headers,
        origin: publicOrigin, cookie: `paimind_haas_session=${currentToken}` } }) }
    }()
    for (const [index, mode] of ['queue', 'queue', 'steer'].entries()) {
      if (index > 0) currentToken = second.token
      const reply = await client.sessions.prompt({ sessionId: handle.agent.id, mode, clientTimeZone: 'Asia/Shanghai',
        content: [{ type: 'text', text: `Native message ${index}` }] })
      expect(reply).toMatchObject({ rpcId: 'same-browser-rpc-id', result: { ok: true, value: { accepted: true } } })
      if (index === 0) await Promise.race([entered.promise, new Promise((_, reject) => setTimeout(() => reject(Error('Missing native pre-step')), 3000).unref())])
    }
    expect(insertions).toHaveLength(3)
    expect(new Set(insertions.map(message => message.id)).size).toBe(3)
    expect(new Set(insertions.map(message => message.source.rpcId)).size).toBe(3)
    // The actual native source keeps unique signed login provenance, while its
    // read-only display projection recovers the original client's correlation.
    for (const message of insertions) {
      expect(readHarnessPromptCorrelation(message.source, handle.agent.id)).toBe('same-browser-rpc-id')
      expect(readHarnessPromptCorrelation(message.source, 'different-session')).toBeNull()
    }
    const scope = { tenantId, userId: account.userId, role, cellId, nativeSessionId: handle.agent.id }
    const origins = await Promise.all(insertions.map(message => identity.withInteractiveOrigin(message.source.rpcId, randomUUID(), scope, async p => p.sessionId)))
    expect(origins[0]).not.toBe(origins[1]); expect(origins[1]).toBe(origins[2])
    for (const message of insertions) expect(message.source.clientTimeZone).toBe('Asia/Shanghai')
    for (const token of [first.token, second.token]) expect(JSON.stringify(upstreamRequests)).not.toContain(token)
    const queuedId = insertions[1].id
    let editedSource: string | undefined
    let delegated: { nativeSessionId: string; sources: string[] } | undefined
    if (reverse) {
      // Real signing, PG and both protected links; the target here is an
      // explicit scope fixture, not evidence of actual native child creation.
      delegated = await peer!.deriveOrigins({ nativeSessionId: handle.agent.id, presetId: 'standard', publication: null, skills: [],
        sources: insertions.map(message => message.source.rpcId), targetSessionId: 'native-child-scope-fixture' })
      expect(delegated.sources).toHaveLength(2)
      await peer!.authorizeExecution({ ...delegated, presetId: 'standard', publication: null, skills: [] })
      await expect(peer!.authorizeExecution({ ...delegated, presetId: 'other-preset', publication: null, skills: [] })).rejects.toThrow()
      currentToken = first.token
      expect((await client.sessions.updateQueue({ sessionId: handle.agent.id, itemId: queuedId,
        action: { kind: 'edit', content: [{ type: 'text', text: 'First-login edit of second-login message' }] } })).result.ok).toBe(true)
      const edited = handle.agent.inbox.nextTurn.find((message: { id: string }) => message.id === queuedId)
      expect(edited.source.clientTimeZone).toBe('Asia/Shanghai')
      expect(await identity.withInteractiveOrigin(edited.source.rpcId, randomUUID(), scope, async p => p.sessionId)).toBe(origins[0])
      currentToken = second.token
      expect((await client.sessions.updateQueue({ sessionId: handle.agent.id, itemId: queuedId, action: { kind: 'steer' } })).result.ok).toBe(true)
      const steered = handle.agent.inbox.nextStep.find((message: { id: string }) => message.id === queuedId)
      expect(await identity.withInteractiveOrigin(steered.source.rpcId, randomUUID(), scope, async p => p.sessionId)).toBe(origins[1])
      currentToken = first.token
      expect((await client.sessions.updateQueue({ sessionId: handle.agent.id, itemId: queuedId,
        action: { kind: 'edit', content: [{ type: 'text', text: 'First-login final edit, subsequently revoked' }] } })).result.ok).toBe(true)
      editedSource = handle.agent.inbox.nextStep.find((message: { id: string }) => message.id === queuedId).source.rpcId
    }
    await identity.logout(first.token, {}, context())
    await expect(identity.withInteractiveOrigin(insertions[0].source.rpcId, randomUUID(), scope, async () => true)).rejects.toMatchObject({ status: 401 })
    expect(await identity.withInteractiveOrigin(insertions[1].source.rpcId, randomUUID(), scope, async () => true)).toBe(true)
    if (reverse) {
      await expect(peer!.authorizeExecution({ ...delegated!, presetId: 'standard', publication: null, skills: [] })).rejects.toThrow()
      await expect(peer!.deriveOrigins({ ...delegated!, presetId: 'standard', publication: null, skills: [],
        targetSessionId: 'grandchild-scope-fixture' })).rejects.toThrow()
      const validChild = await peer!.deriveOrigins({ nativeSessionId: handle.agent.id, presetId: 'standard', publication: null, skills: [],
        sources: [insertions[1].source.rpcId], targetSessionId: 'native-child-scope-fixture' })
      await peer!.authorizeExecution({ ...validChild, presetId: 'standard', publication: null, skills: [] })
      await expect(peer!.checkOrigins({ nativeSessionId: handle.agent.id, sources: [editedSource!] })).rejects.toThrow()
      await expect(peer!.checkOrigins({ nativeSessionId: handle.agent.id, sources: [insertions[1].source.rpcId] })).resolves.toBeUndefined()
      const before = structuredClone(handle.agent.inbox.nextStep)
      expect((await sessions.updateQueue({ rpcId: editedSource!, payload: { sessionId: handle.agent.id, itemId: queuedId,
        action: { kind: 'edit', content: [{ type: 'text', text: 'Must not borrow the other live login' }] } } })).result.ok).toBe(false)
      expect(handle.agent.inbox.nextStep).toEqual(before)
      currentToken = second.token
      expect((await client.sessions.updateQueue({ sessionId: handle.agent.id, itemId: queuedId, action: { kind: 'remove' } })).result.ok).toBe(true)
      // Isolate the first proposed step using the original inbox owner. The
      // queued messages have already proved signed native source propagation.
      for (const queued of insertions.slice(1)) handle.agent.inbox.remove(queued.id)
    }
    held.resolve(); await handle.agent.whenIdle(); expect(modelCalls).toBe(0)
    if (reverse) {
      expect(decisions.some(row => !row.allowed && row.sources.includes(insertions[0].source.rpcId))).toBe(true)
      await client.sessions.prompt({ sessionId: handle.agent.id, mode: 'queue', content: [{ type: 'text', text: 'New valid-login step' }] })
      await handle.agent.whenIdle()
      expect(decisions.at(-1)?.allowed).toBe(true)
      expect(modelCalls).toBe(1) // local throwing adapter only; no credential/network/model provider
      const valid = { nativeSessionId: handle.agent.id, sources: [insertions.at(-1).source.rpcId] }
      await owner`update haas.runtime_bindings set status = 'suspended' where cell_id = ${cellId}`
      await expect(peer!.checkOrigins(valid)).rejects.toThrow()
      expect(decisions.at(-1)?.allowed).toBe(false)
    }
  } finally {
    held.resolve(); gateway?.close()
    for (const server of servers.reverse()) await close(server)
    for (const cleanup of cleanups.reverse()) await cleanup()
    await root.fiber.dispose()
  }
})

it.each(['logout', 'withdraw', 'disable', 'binding', 'disconnect', 'stalled', 'tool-withdraw'] as const)(
  'interrupts live native %s through real PostgreSQL/private authority, preserving Alex and queued work (synthetic adapter/pins, not Worker or Browser E2E)', async mode => {
    const cleanups: (() => unknown | Promise<unknown>)[] = [], context = () => ({ key: randomUUID(), requestId: randomUUID() })
    const tenantId = 'active-origin-' + randomUUID(), password = 'Synthetic active-origin fixture password 2026'
    try {
      await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
      const identity = new Identity(sql, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
      await identity.bootstrap({ username: 'morgan', displayName: 'Morgan', password, bootstrapSecret: config.bootstrapSecret }, context())
      const admin = (await identity.login({ username: 'morgan', password }, context())).token
      const accounts = []
      for (const [username, displayName] of [['hansen', 'Hansen'], ['alex', 'Alex']]) {
        const account = (await identity.createMember(admin, { username, displayName, password }, context())).data
        const token = (await identity.login({ username, password }, context())).token
        accounts.push({ account, token })
      }
      const [hansenIdentity, alexIdentity] = accounts
      const anotherHansen = (await identity.login({ username: 'hansen', password }, context())).token
      // Governance and identity are real. This source/provenance is an explicit
      // content fixture, not evidence that immutable Worker presets were adopted.
      const snapshot = createAgentPublicationSnapshot({ schema: 'paimind.agent-publication/v1', agentId: 'hansen-fixture',
        presetId: 'hansen-fixture', configVersion: 'v1-fixture', nativeCompositionDigest: 'sha256:' + 'c'.repeat(64),
        profile: { name: 'Hansen 客户跟进助手', description: '隔离执行验证', basePresetId: 'standard', role: '客户助理',
          goal: '核对执行权限', behavior: '保留来源', instructions: '', preferredSkillNames: [] }, dependencies: [] })
      const publications = new Publications(identity, async () => snapshot)
      const submitted = (await publications.submit(hansenIdentity.token, { presetId: 'hansen-fixture', expectedVersion: 'v1-fixture', reason: '执行撤销测试提交' }, context())).data
      const approved = (await publications.review(admin, submitted.publicationId, { decision: 'publish', expectedRevision: submitted.revision, reason: '执行撤销测试批准' }, context())).data
      const assigned = (await publications.assign(admin, approved.publicationId, { subjectKind: 'user', subjectId: hansenIdentity.account.userId,
        effect: 'allow', active: true, expectedRevision: approved.revision, reason: '只分配给 Hansen' }, context())).data
      const enterprise = mode === 'withdraw' || mode === 'tool-withdraw'
      const proof = { tenantId, publicationId: assigned.publicationId, sourceUserId: hansenIdentity.account.userId, contentDigest: assigned.digest }
      const waitForAbort = async (signal: AbortSignal) => {
        signal.throwIfAborted()
        await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      }
      const createNative = async (member: typeof hansenIdentity, selectedPreset: string, useTool: boolean) => {
        const withChildren = mode === 'logout' || mode === 'withdraw'
        const persistenceRoot = withChildren ? await mkdtemp(join(tmpdir(), 'haas-native-followup-')) : undefined
        if (persistenceRoot) cleanups.push(() => rm(persistenceRoot, { recursive: true, force: true }))
        const root = new Context(); cleanups.push(() => root.fiber.dispose())
        let ingress: ReturnType<typeof createNativeIngress>, activeSignal: AbortSignal | undefined, calls = 0, stalled = false, toolSettled = false
        const broker = await createNativeControlBroker('/tmp', (input, signal) => ingress.checkOrigins(input, signal),
          (input, signal) => ingress.authorizeExecution(input, signal),
          (input, signal) => ingress.deriveOrigins(input, signal))
        cleanups.push(() => broker.close())
        const peer = createNativeControlPeer(createConnection(broker.path), { handle: async () => { throw Error('Unused publication fixture operation') } })
        cleanups.push(() => peer.close())
        const key = randomBytes(32).toString('hex')
        ingress = createNativeIngress({ token: key, control: (operation: string, input: object, signal: AbortSignal) => broker.request(operation, input, signal) })
        cleanups.push(() => ingress.close()); const origin = await listen(ingress.server)
        const transport = new CellTransport(origin, key); cleanups.push(() => transport.destroy())
        const pin: PrivateRuntimeCell = { cellId: randomUUID(), tenantId, userId: member.account.userId, role: 'member',
          revision: randomUUID(), origin, containerId: randomBytes(32).toString('hex'), imageId: 'sha256:' + 'd'.repeat(64),
          volumeName: 'paimind-haas-member-fixture-' + randomUUID(), policyDigest: 'sha256:' + 'e'.repeat(64) }
        await owner`insert into haas.runtime_bindings (cell_id,tenant_id,user_id,origin,revision,isolation_mode,status,
          lease_expires_at,container_id,image_id,volume_name,policy_digest)
          values (${pin.cellId},${tenantId},${pin.userId},${origin},${pin.revision},'container-managed','ready',
            clock_timestamp() + interval '10 minutes',${pin.containerId},${pin.imageId},${pin.volumeName},${pin.policyDigest})`
        const bindings = new RuntimeBindings(sql, identity, 'http://127.0.0.1:16999', [], [pin])
        await transport.openOriginAuthority((input, signal) => bindings.checkInteractiveOrigins(pin.cellId, input, signal), async (input, signal) => {
          if (stalled) await waitForAbort(signal)
          await bindings.authorizeInteractiveExecution(pin.cellId, input, signal)
        }, (input, signal) => bindings.deriveInteractiveOrigins(pin.cellId, input, signal))
        installManagedHarnessOriginGuard(root, async (input, signal) => {
          expect(input.presetId).toBe(selectedPreset)
          await peer.authorizeExecution({ ...input, sources: [...input.sources], publication: input.presetId === adoptedPresetId(assigned.publicationId) ? proof : null, skills: [] }, signal)
        })
        const managed = withChildren ? createManagedHarnessDelegationProviders(root, async (input, signal) =>
          peer.deriveOrigins({ ...input, sources: [...input.sources], publication: input.presetId === adoptedPresetId(assigned.publicationId) ? proof : null, skills: [] }, signal), [nativeSpawn]) : undefined
        for (const [plugin, settings] of [[SessionStore], [managed?.Agents ?? AgentRegistry], [SystemPrompt, {}], [LlmRuntime], [ToolRuntime, {}]]) await root.plugin(plugin, settings)
        const childSignals = new Map<string, AbortSignal>()
        const terminalEntered = Promise.withResolvers<void>(), terminalRelease = Promise.withResolvers<void>()
        if (managed) {
          await root.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
          await root.plugin(managed.Subagents)
          await root.plugin(managed.selectProvider(nativeSpawn), { providerName: 'real-spawn' })
          // Original child creation/composition is real, but this preset owner
          // and container pins remain explicit fixtures, not image acceptance.
          root.provide('agentPresets', { composedPreset: (ctx: any) => ctx.agent?.session.header.agentPreset, composeFrom: () => {} })
          root.llm.registerAdapter(['child-local-only'], new class extends LlmAdapter {
            async *stream(request: { signal: AbortSignal; model: string }) {
              childSignals.set(request.model, request.signal); await waitForAbort(request.signal)
            }
          }())
          root.llm.registerAdapter(['terminal-local-only'], new class extends LlmAdapter {
            async *stream(request: { signal: AbortSignal }) {
              terminalEntered.resolve(); await Promise.race([terminalRelease.promise, waitForAbort(request.signal)])
              if (request.signal.aborted) return
              yield { type: 'block-start', index: 0, blockType: 'text' }
              yield { type: 'text-delta', index: 0, text: 'Synthetic terminal output, not an external model' }
              yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Synthetic terminal output, not an external model' } }
              yield { type: 'finish', reason: { kind: 'stop' } }
            }
          }())
        }
        root.llm.registerAdapter(['active-local-only'], new class extends LlmAdapter {
          async *stream(request: { signal: AbortSignal }) {
            calls++
            if (useTool) {
              yield { type: 'block-start', index: 0, blockType: 'tool-call' }
              yield { type: 'tool-call-delta', index: 0, id: 'active-tool', name: 'read', argumentsDelta: '{}' }
              yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'active-tool', name: 'read', arguments: '{}' } }
              yield { type: 'finish', reason: { kind: 'tool-calls' } }
            } else {
              yield { type: 'block-start', index: 0, blockType: 'text' }
              yield { type: 'text-delta', index: 0, text: 'Synthetic pending adapter; not a real model reply' }
              activeSignal = request.signal
              await waitForAbort(request.signal)
            }
          }
        }())
        root.tools.register(definePaimindHarnessTool({ name: 'read', description: 'Synthetic cooperative tool behind original dispatcher', parameters: {},
          output: { schema: { type: 'object', additionalProperties: false, properties: { ran: { type: 'boolean', required: true } } }, render: () => [] },
          execute: async (_args: unknown, execution: { signal: AbortSignal }) => {
            activeSignal = execution.signal
            try { await waitForAbort(execution.signal) } finally { toolSettled = true }
            return { ran: true }
          } }))
        await root.plugin(AgentLoop, { agents: [] }); root.provide('userQuestions', { registerProvider: () => () => {} })
        const handle = await root.agents.create({ sessionId: 'active-' + member.account.username,
          meta: { agentPreset: selectedPreset }, agentOptions: { provider: 'active-local-only', model: 'synthetic-pending' } })
        const handler = toFetchHandler(createApiProxy(root, { defaultModelSelection: () => ({ provider: 'active-local-only', model: 'synthetic-pending' }) }))
        const prompt = async (token = member.token) => {
          // Original API handler mints the message/inbox/history; only its
          // signed login association is supplied by the actual identity owner.
          const rpcId = await identity.sealInteractiveOrigin(token, randomUUID(), { tenantId, userId: pin.userId, role: 'member',
            cellId: pin.cellId, nativeSessionId: handle.agent.id })
          const response = await handler.fetch(new Request('http://dsh.internal/api/session.prompt', { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId, method: 'session.prompt',
              payload: { sessionId: handle.agent.id, mode: 'queue', content: [{ type: 'text', text: 'Synthetic active cancellation check' }] } }) }))
          expect(response.status).toBe(200); expect((await response.json()).result.ok).toBe(true)
        }
        const startChild = async (name: string, parent = handle.agent, continuable = false) => {
          const request = { parent, prompt: [{ type: 'text', text: 'Synthetic native delegated check' }],
            agentOptions: { provider: 'child-local-only', model: name } }
          const signal = new AbortController().signal
          const run = continuable
            ? { localAgent: root.agents.get((await root.subagents.startContinuable({ provider: 'real-spawn', label: name, request, signal })).childId) }
            : await root.subagents.start('real-spawn', { ...request, signal })
          if ('dispose' in run) cleanups.push(() => run.dispose())
          await vi.waitFor(() => expect(childSignals.has(name)).toBe(true), { timeout: 5000 })
          return run
        }
        const settleChild = async (parent: any) => {
          const { childId } = await root.subagents.startContinuable({ provider: 'real-spawn', label: '独立结束通知',
            request: { parent, prompt: [{ type: 'text', text: 'Synthetic terminal authority check' }],
              agentOptions: { provider: 'terminal-local-only', model: 'synthetic' } }, signal: new AbortController().signal })
          await terminalEntered.promise; terminalRelease.resolve()
          await vi.waitFor(() => expect(root.agents.get(childId)).toBeUndefined(), { timeout: 5000 })
          const message = parent.inbox.nextStep.find((message: any) => message.source.kind === 'subagent-settled' && message.source.senderSessionId === childId)
          expect(message.source.paimindOrigins).toHaveLength(1)
          return message
        }
        return { root, pin, handle, prompt, transport, peer, signal: () => activeSignal, calls: () => calls, startChild, settleChild, childSignals,
          toolSettled: () => toolSettled, stall: () => { stalled = true } }
      }
      const hansen = await createNative(hansenIdentity, enterprise ? adoptedPresetId(assigned.publicationId) : 'standard', mode === 'tool-withdraw')
      const alex = await createNative(alexIdentity, 'standard', false)
      await hansen.prompt(); await alex.prompt()
      await vi.waitFor(() => { expect(hansen.signal()).toBeDefined(); expect(alex.signal()).toBeDefined() }, { timeout: 5000 })
      const followups: { authority: typeof hansen; input: any; revoked: boolean }[] = []
      if (mode === 'logout' || mode === 'withdraw') {
        for (const [name, authority, revoked] of [['hansen', hansen, true], ['alex', alex, false]] as const) {
          const child = await authority.startChild(name + '-child')
          const grandchild = await authority.startChild(name + '-grandchild', child.localAgent, true)
          const source = child.localAgent.session.events.find((event: any) => event.type === 'user/message').data.source
          expect(source).toMatchObject({ kind: 'coordinator', senderSessionId: authority.handle.agent.id })
          expect(source.paimindOrigins).toHaveLength(1)
          const messageId = await authority.root.subagents.followup(child.localAgent, grandchild.localAgent.id,
            [{ type: 'text', text: name + ' independent native follow-up' }], {
              source: { kind: 'coordinator', form: 'relay', senderSessionId: child.localAgent.id }, signal: new AbortController().signal,
            })
          const queuedMessage = grandchild.localAgent.inbox.nextTurn.find((message: { id: string }) => message.id === messageId)
          expect(queuedMessage.source).toMatchObject({ kind: 'coordinator', senderSessionId: child.localAgent.id })
          expect(queuedMessage.source.paimindOrigins).toHaveLength(1)
          expect(queuedMessage.source.paimindOrigins).not.toEqual(source.paimindOrigins)
          const input = { nativeSessionId: grandchild.localAgent.id, presetId: grandchild.localAgent.session.header.agentPreset,
            sources: queuedMessage.source.paimindOrigins, publication: revoked && enterprise ? proof : null, skills: [] }
          await authority.peer.authorizeExecution(input, new AbortController().signal)
          followups.push({ authority, input, revoked })
          const reportId = await authority.root.subagents.reportFrom(grandchild.localAgent,
            [{ type: 'text', text: name + ' independent native report' }], { delivery: 'next-step', signal: new AbortController().signal })
          const report = child.localAgent.inbox.nextStep.find((message: { id: string }) => message.id === reportId)
          expect(report.source).toMatchObject({ kind: 'subagent-report', form: 'relay', senderSessionId: grandchild.localAgent.id })
          expect(report.source.paimindOrigins).toHaveLength(1)
          expect(report.source.paimindOrigins).not.toEqual(queuedMessage.source.paimindOrigins)
          const reportInput = { ...input, nativeSessionId: child.localAgent.id, sources: report.source.paimindOrigins }
          await authority.peer.authorizeExecution(reportInput, new AbortController().signal)
          followups.push({ authority, input: reportInput, revoked })
          const settled = await authority.settleChild(child.localAgent)
          expect(settled.source).toMatchObject({ kind: 'subagent-settled', form: 'notice' })
          expect(settled.source.paimindOrigins).not.toEqual(report.source.paimindOrigins)
          const settlementInput = { ...reportInput, sources: settled.source.paimindOrigins }
          await authority.peer.authorizeExecution(settlementInput, new AbortController().signal)
          followups.push({ authority, input: settlementInput, revoked })
        }
      }
      await hansen.prompt(anotherHansen)
      const queued = hansen.handle.agent.inbox.nextTurn.map((message: { id: string }) => message.id)
      expect(queued).toHaveLength(1)
      const started = performance.now()
      if (mode === 'logout') await identity.logout(hansenIdentity.token, {}, context())
      if (enterprise) await publications.review(admin, assigned.publicationId, { decision: 'withdraw', expectedRevision: assigned.revision, reason: '撤销正在执行的企业版本' }, context())
      if (mode === 'disable') await identity.setMemberStatus(admin, hansenIdentity.account.userId, { status: 'disabled', reason: '停止正在执行的成员' }, context())
      if (mode === 'binding') await owner`update haas.runtime_bindings set status = 'suspended' where cell_id = ${hansen.pin.cellId}`
      if (mode === 'disconnect') hansen.transport.destroy()
      if (mode === 'stalled') hansen.stall()
      await vi.waitFor(() => expect(hansen.signal()?.aborted).toBe(true), { timeout: 6500 })
      await hansen.handle.agent.whenIdle()
      expect(performance.now() - started).toBeLessThan(6500)
      expect(alex.signal()?.aborted).toBe(false); expect(alex.handle.agent.status).toBe('running')
      expect(hansen.handle.agent.inbox.nextTurn.map((message: { id: string }) => message.id)).toEqual(queued)
      expect(hansen.handle.agent.session.events.findLast((event: { type: string }) => event.type === 'turn/end').data.reason)
        .toMatchObject({ kind: 'aborted', reason: { kind: 'hook' } })
      expect(hansen.calls()).toBe(1); expect(alex.calls()).toBe(1)
      if (mode === 'logout' || mode === 'withdraw') {
        await vi.waitFor(() => expect([...hansen.childSignals.values()].every(signal => signal.aborted)).toBe(true), { timeout: 6500 })
        expect(hansen.childSignals.size).toBe(2); expect(alex.childSignals.size).toBe(2)
        expect([...alex.childSignals.values()].every(signal => !signal.aborted)).toBe(true)
        for (const { authority, input, revoked } of followups) {
          const check = authority.peer.authorizeExecution(input, new AbortController().signal)
          if (revoked) await expect(check).rejects.toThrow()
          else await expect(check).resolves.toBeUndefined()
        }
      }
      if (mode === 'tool-withdraw') {
        expect(hansen.toolSettled()).toBe(true)
        const results = hansen.handle.agent.session.events.filter((event: { type: string }) => event.type === 'tool/result')
        expect(results).toHaveLength(1)
        expect(results[0].data.message.content).toMatchObject([{ type: 'tool-result', toolCallId: 'active-tool', isError: true }])
      }
      if (mode === 'disconnect') expect(hansen.peer.ready).toBe(true)
    } finally { for (const cleanup of cleanups.reverse()) await cleanup() }
  })
