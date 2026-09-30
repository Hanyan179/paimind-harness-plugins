// Isolated test process: original complete native web/Standard composition,
// product owners and private authority. Only model I/O and container pins are
// diagnostic fixtures. This is not a final Worker or Browser E2E entry point.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { createConnection } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createNativeControlPeer, handleNativeControl, authorizeNativeExecution, authorizeNativeSkillUse } from '../../../../deploy/enterprise/worker/runtime/native-control.mjs'

assert.equal(process.env.PAIMIND_NATIVE_PROCESS_TEST, '1'); assert.ok(process.send)
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const local = createRequire(join(repo, 'package.json')), anchor = local.resolve('@deepseek-ai/dsh/package.json')
const native = createRequire(anchor)
const { boot: bootProfile, loadProfile, healProfilesModuleFallback } = native('@deepseek-ai/dsh-app-boot')
const { provideCmdline } = native('@deepseek-ai/dsh-cmdline')
const { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } = native('@deepseek-ai/dsh-launch-environment')
const { LlmAdapter, createUserMessage } = native('@deepseek-ai/dsh-llm')
const { renderSkillContent } = native('@deepseek-ai/dsh-skill')
const { settingsNamespace } = native('@deepseek-ai/dsh-settings')
const { symbols } = native('@deepseek-ai/cordis')
const { ApiProxyService } = native('@deepseek-ai/dsh-host-apiproxy')
const { defineTool } = native('@deepseek-ai/dsh-tools')
const { SETTINGS_NAMESPACE: presetSettingsNamespace } = native('@deepseek-ai/dsh-agent-presets')
const { installManagedHarnessOriginGuard, installManagedHarnessToolGuard } = await import(pathToFileURL(join(repo, 'packages/harness-compat/lib/managed-runtime.js')))
const { readPaimindNativeSessionPresetReference, readPaimindNativeSessionCreationReference, readPaimindNativeSessionEventPage, readPaimindNativeApprovalReference } = await import(pathToFileURL(join(repo, 'packages/harness-compat/lib/host.js')))
const { PaimindSkillInstallerService } = await import(pathToFileURL(join(repo, 'packages/skill-market/lib/index.js')))
const { PaimindAgentProfileService } = await import(pathToFileURL(join(repo, 'packages/agent-builder/lib/index.js')))
const { PaimindNotificationsService } = await import(pathToFileURL(join(repo, 'packages/notifications/lib/index.js')))
const { registerPaimindBootReadiness } = await import(pathToFileURL(join(repo, 'packages/extension-center/lib/index.js')))
let bootReceiptOrigin
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
let root, peer, directory, stopped, serial = Promise.resolve(), activePrompt
const handles = new Map(), calls = [], checks = [], uses = []
const nativeCreates = []
const approvalBodies = []
let approvalWriteFault
const wait = async predicate => {
  const end = performance.now() + 8000
  while (!predicate()) {
    if (performance.now() >= end) throw Error('Private native process readiness timed out')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
async function snapshot(sessionId, prefixBytes) {
  const agent = root.agents.get(sessionId); assert.ok(agent)
  await root.sessions.flush(agent.session)
  const raw = await root.sessionPersistence.readRaw(sessionId)
  return { pid: process.pid, sessionId, presetId: root.agentPresets.composedPreset(agent.ctx),
    rawSha256: hash(raw.content), rawBytes: Buffer.byteLength(raw.content),
    ...(prefixBytes === undefined ? {} : { historyPrefixSha256: hash(Buffer.from(raw.content).subarray(0, prefixBytes)) }),
    replies: agent.session.events.filter(event => event.type === 'assistant/message').map(event =>
      event.data.message?.content?.filter(block => block.type === 'text').map(block => block.text).join('')),
    endings: agent.session.events.filter(event => event.type === 'turn/end').map(event => event.data.reason.kind),
    calls, checks, uses }
}
async function boot(input) {
  assert.ok(!root); directory = process.cwd()
  // Test-only internal bundle: no new production package export. Resolve bare
  // dependencies from their real source owner, even outside repository cwd.
  const adapterPath = join(directory, 'native-turn-test-adapter.mjs')
  await local('esbuild').build({ entryPoints: [join(repo, 'packages/harness-compat/src/managed-queue.ts')],
    outfile: adapterPath, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    plugins: [{ name: 'original-test-dependencies', setup(build) {
      build.onResolve({ filter: /^[^./]/ }, args => ({ path: args.path.startsWith('node:') ? args.path
        : pathToFileURL(createRequire(args.importer).resolve(args.path)).href, external: true }))
    } }] })
  const { readNativeTurnReceipt, createManagedHarnessQueueApiProvider } = await import(pathToFileURL(adapterPath))
  assert.ok(Number.isInteger(input.nativePort) && input.nativePort >= 1024 && input.nativePort <= 65535 && input.nativePort !== 3080)
  const home = process.env.DSH_HOME; assert.equal(home, join(directory, 'home'))
  const profileDirectory = join(home, 'profiles/web'), presets = join(directory, 'presets')
  await mkdir(profileDirectory, { recursive: true, mode: 0o700 }); await mkdir(presets, { recursive: true })
  if (input.resume === true) {
    const manifest = JSON.parse(await readFile(join(profileDirectory, 'package.json'), 'utf8'))
    assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    for (const name of ['cordis.yml', 'cordis.patch.yml']) await readFile(join(profileDirectory, name))
  } else {
    await writeFile(join(profileDirectory, 'package.json'), JSON.stringify({ name: 'dsh-profile-web', private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }), { flag: 'wx', mode: 0o600 })
    for (const name of ['cordis.yml', 'cordis.patch.yml']) await writeFile(join(profileDirectory, name), '[]\n', { flag: 'wx', mode: 0o600 })
  }
  // Original public preparation only creates links in this fresh private home;
  // nested Loader entries need its installed dependency closure as well.
  healProfilesModuleFallback(anchor, home)
  peer = createNativeControlPeer(createConnection(input.socketPath), { handle: (operation, value, signal) => {
    assert.ok(root); return handleNativeControl(root, operation, value, signal)
  } })
  await wait(() => peer.ready)
  const profile = loadProfile('dsh', 'web', anchor, home)
  const patches = [...profile.layers.flatMap(layer => layer.patches), ...profile.patches,
    { id: 'agent-presets', config: { default: 'standard', includeUserRoot: false, roots: [
      { path: join(dirname(anchor), 'config/agent-presets'), trust: 'system' }, { path: presets, trust: 'user' },
    ] } }, { id: 'session-title-llm', disabled: true }, { id: 'telemetry', disabled: true }]
  let tools
  root = await bootProfile('dsh', join(profileDirectory, 'cordis.yml'), patches, context => {
    root = context
    context.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{ source: 'process', values: {
      DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED', PATH: process.env.PATH,
    } }]))
    provideCmdline(context, { args: ['--host', '127.0.0.1', '--port', String(input.nativePort), '--no-open'], exit: () => { throw Error('Unexpected native exit') } })
    const queue = createManagedHarnessQueueApiProvider(async ({ action, ...value }, signal) => {
      if (action === 'remove' || action === 'resume' || action === 'approval-reject') await peer.checkOrigins({ nativeSessionId: value.nativeSessionId, sources: value.sources }, signal)
      else await authorizeNativeExecution(context, peer, value, signal)
    })
    const loader = Reflect.get(context.loader, symbols.original), original = loader.unwrapExports
    assert.equal(Object.hasOwn(loader, 'unwrapExports'), false)
    const select = function(exports) { const plugin = original.call(this, exports); return plugin === ApiProxyService ? queue.Provider : plugin }
    context.effect(() => {
      Object.defineProperty(loader, 'unwrapExports', { value: select, configurable: true })
      return () => { if (loader.unwrapExports === select) Reflect.deleteProperty(loader, 'unwrapExports') }
    })
    const referenceLifetime = new AbortController()
    context.effect(() => () => referenceLifetime.abort())
    context.provide('paimindNativeSessionReferences', Object.freeze({ read: (sessionId, signal) =>
      readPaimindNativeSessionPresetReference(context, sessionId, AbortSignal.any([signal, referenceLifetime.signal])),
    creation: (sessionId, signal) => readPaimindNativeSessionCreationReference(context, sessionId, AbortSignal.any([signal, referenceLifetime.signal])),
    turnState: (sessionId, selection, signal) => readNativeTurnReceipt(context, sessionId, selection, AbortSignal.any([signal, referenceLifetime.signal])),
    events: (sessionId, selection, signal) => readPaimindNativeSessionEventPage(context, sessionId, selection, AbortSignal.any([signal, referenceLifetime.signal])),
    approval: (sessionId, approvalId, signal) => readPaimindNativeApprovalReference(context, sessionId, approvalId, AbortSignal.any([signal, referenceLifetime.signal])) }))
    tools = installManagedHarnessToolGuard(context, call => ['skill', 'diagnostic_approval_probe'].includes(call.name) ? undefined : 'All other test tool bodies remain sealed',
      () => peer.ready ? undefined : 'Current private authority unavailable')
    installManagedHarnessOriginGuard(context, async (value, signal) => {
      const check = { sessionId: value.nativeSessionId, presetId: value.presetId, allowed: false }; checks.push(check)
      const result = await authorizeNativeExecution(root, peer, value, signal); check.allowed = true; return result
    }, { render: renderSkillContent, check: async (input, value, signal) => {
      const reference = await authorizeNativeSkillUse(root, peer, input, value, signal)
      if (reference) uses.push({ name: reference.name, publicationId: reference.publicationId })
      return reference
    } })
    context.provide('paimindEnterpriseSkillEligibility', Object.freeze({ read: (references, signal) => peer.readSkillEligibility(references, signal) }))
  }, pathToFileURL(anchor).href)
  tools.assertReady()
  root.tools.register(defineTool({ name: 'diagnostic_approval_probe', description: 'Count a local diagnostic execution; no external effects', parameters: {},
    output: { schema: { type: 'number' }, render: () => [{ type: 'text', text: 'Explicit local body counted' }] },
    execute: async (_arguments, execution) => { approvalBodies.push({ sessionId: execution.agent.id, callId: execution.callId }); return 1 } }))
  root.on('tools/pre-execute', async (execution, next) => {
    const decision = await next()
    return execution.name === 'diagnostic_approval_probe' && decision.kind === 'allow'
      ? { kind: 'ask', reason: 'Explicit test-only approval for counted local body' } : decision
  })
  await root.plugin(PaimindSkillInstallerService, { skillRoot: join(directory, 'skills'), stateRoot: join(directory, 'skill-state') })
  await root.plugin(PaimindAgentProfileService, { presetRoot: presets, skillRoot: join(directory, 'skills'), stateRoot: join(directory, 'agent-state') })
  await root.plugin(PaimindNotificationsService)
  root.effect(() => registerPaimindBootReadiness(root), 'test: original boot receipt owner')
  bootReceiptOrigin = `http://127.0.0.1:${input.nativePort}`
  await root.paimindAgentProfiles.prepareRuntime()
  root.llm.registerAdapter(['local-only'], new class extends LlmAdapter {
    async *stream(request) {
      assert.ok(activePrompt)
      const wire = JSON.stringify(request.messages)
      calls.push({ sessionId: activePrompt.sessionId, skillBodyVisible: wire.includes('Use verified customer notes only.') })
      if (['tool', 'approval'].includes(activePrompt.mode) && !activePrompt.toolRequested) {
        activePrompt.toolRequested = true
        const name = activePrompt.mode === 'approval' ? 'diagnostic_approval_probe' : 'skill'
        const args = JSON.stringify(activePrompt.mode === 'approval' ? {} : { name: 'customer-notes' })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: 'original-skill-call', name, argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'original-skill-call', name, arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }; return
      }
      const text = 'Explicit local diagnostic reply; no external model'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }())
  // HTTP prompt resolves the native default selection, unlike a direct test
  // Agent.followup. Pin the explicit diagnostic route through its real owner.
  await root.agentDefaultModel.saveSelection({ provider: 'local-only', model: 'synthetic' })
  const createNativeAgent = root.agents.create.bind(root.agents)
  root.agents.create = options => { nativeCreates.push(options.sessionId); return createNativeAgent(options) }
  return { pid: process.pid, fullWebProfile: true, standardDigest: hash(await readFile(join(dirname(anchor), 'config/agent-presets/standard/agent.cordis.yml'))),
    originalSettingsProvider: !!root.get('settings'), originalProfileOwner: !!root.get('paimindAgentProfiles'), originalSkillOwner: !!root.get('paimindSkillInstaller') }
}
async function stop() {
  return stopped ??= (async () => {
    const timer = setTimeout(() => process.exit(1), 8000)
    try { peer?.close(); await root?.fiber.dispose() } finally { clearTimeout(timer) }
  })()
}
const commands = {
  boot,
  async failNextWorkspaceAttach({ workspaceId }) {
    const workspace = root.workspaceRegistry.get(workspaceId)
    assert.ok(workspace)
    const original = workspace.attachSession
    workspace.attachSession = async function () {
      workspace.attachSession = original
      throw Error('Explicit one-shot workspace-attach failure after real native creation')
    }
    return { armed: true }
  },
  async bootReceiptSnapshot() {
    const response = await fetch(bootReceiptOrigin + '/paimind/boot-readiness')
    assert.equal(response.status, 200)
    return response.json()
  },
  async seedDisplaySettings({ member }) {
    assert.ok(['hansen', 'alex'].includes(member))
    await root.settings.update(settingsNamespace('locale'), { preference: member === 'hansen' ? 'zh' : 'en' })
    await root.settings.update(settingsNamespace('ui-theme'), { preference: member === 'hansen' ? 'dark' : 'light' })
    return commands.displaySettingsSnapshot()
  },
  async displaySettingsSnapshot() {
    return { locale: root.settings.get(settingsNamespace('locale')),
      theme: root.settings.get(settingsNamespace('ui-theme')) }
  },
  async publishNotification({ member }) {
    assert.ok(['hansen', 'alex'].includes(member))
    return root.paimindNotifications.registerProducer({ id: 'isolated-notification-test', nameZh: '隔离验收', nameEn: 'Isolation acceptance' })
      .publish({ idempotencyKey: member, title: member + ' private notification', level: 'info' })
  },
  async notificationSnapshot() { return root.paimindNotifications.list() },
  async setDefaultPreset({ presetId }) {
    await root.agentPresets.resolve(presetId)
    await root.settings.update(settingsNamespace(presetSettingsNamespace), { default: presetId })
    assert.equal(root.agentPresets.defaultId, presetId)
    return { defaultId: root.agentPresets.defaultId }
  },
  async createSkill() {
    const owner = root.paimindSkillInstaller
    await owner.saveSkillSource({ name: 'customer-notes', description: 'Morgan approved customer method', instructions: 'Use verified customer notes only.' })
    await mkdir(join(directory, 'skills/customer-notes/empty'))
    await writeFile(join(directory, 'skills/customer-notes/sample.bin'), randomBytes(300000))
    return owner.getSkillPackage({ skillId: 'customer-notes' })
  },
  async createAgent({ id, name, skills = [] }) {
    await root.agentPresets.copy('standard', id, name)
    return root.paimindAgentProfiles.saveProfile({ agentId: id, presetId: id, name, description: name, basePresetId: 'standard',
      role: '工作助理', goal: '依据已核实资料完成工作', behavior: '区分事实和假设', instructions: '', preferredSkillNames: skills, productKind: 'personal' })
  },
  async enableAdoptedSkill({ publicationId }) {
    const owner = root.paimindSkillInstaller
    const records = (await owner.listInstalled()).items.filter(row => row.publication?.publicationId === publicationId)
    assert.equal(records.length, 1)
    const record = records[0], before = record.publicationPreference
    assert.ok(before); assert.equal(before.enabled, false); assert.equal(before.direct, false)
    const { schema: _schema, adoptedAt: _at, ...reference } = record.publication
    const selected = await owner.setAdoptedSkillPreference({ reference, expectedRevision: before.revision, field: 'enabled', value: true })
    return { before, selected, effective: await owner.getUserSkillPolicy() }
  },
  async catalog() {
    return { profiles: (await root.paimindAgentProfiles.listProfiles()).profiles,
      presets: (await root.agentPresets.list()).filter(row => row.trust === 'user').map(row => row.id) }
  },
  async commandReadState({ sessionId, prefixBytes }) {
    // Read the actual original registry/persistence without resolving a cold
    // Agent. Never fabricate an Agent or a second command catalog for a test.
    const agent = root.agents.get(sessionId)
    if (agent) await root.sessions.flush(agent.session)
    const raw = await root.sessionPersistence.readRaw(sessionId)
    const inspected = await root.sessionPersistence.inspect(sessionId)
    return { live: !!agent, rawSha256: hash(raw.content), rawBytes: Buffer.byteLength(raw.content),
      nativeCreateCalls: nativeCreates.filter(id => id === sessionId).length,
      ...(prefixBytes === undefined ? {} : { historyPrefixSha256: hash(Buffer.from(raw.content).subarray(0, prefixBytes)) }),
      events: inspected.events.map(event => event.type), modelCalls: calls.filter(call => call.sessionId === sessionId).length,
      insertionIds: inspected.events.filter(event => event.type === 'agent/inbox/spliced').flatMap(event => event.data.inserted.map(message => message.id)),
      ...(agent ? { queuedMessageIds: [...agent.inbox.nextTurn, ...agent.inbox.nextStep].map(message => message.id) } : {}),
      ...(agent ? { descriptors: root.commands.list(agent) } : {}) }
  },
  async start({ sessionId, presetId }) {
    assert.ok(!handles.has(sessionId))
    const handle = await root.agents.create({ sessionId, meta: { cwd: directory, agentPreset: presetId },
      agentOptions: { provider: 'local-only', model: 'synthetic' }, setup: async context => { await root.agentPresets.mount(context, presetId) } })
    handles.set(sessionId, handle)
    return { sessionId, presetId: root.agentPresets.composedPreset(handle.agent.ctx) }
  },
  async armPublicPrompt({ sessionId, allowCold = false, approval = false }) {
    if (!root.agents.get(sessionId)) {
      assert.equal(allowCold, true)
      assert.equal((await root.sessionPersistence.inspect(sessionId)).meta.id, sessionId)
    }
    assert.ok(!activePrompt)
    activePrompt = { sessionId, mode: approval ? 'approval' : 'text', toolRequested: false }
    return { explicitLocalModelOnly: true }
  },
  async approvalState({ sessionId }) {
    const agent = root.agents.get(sessionId); assert.ok(agent)
    const asked = agent.session.events.findLast(event => event.type === 'approval/asked')
    return { state: asked ? await readPaimindNativeApprovalReference(root, sessionId, asked.data.id, AbortSignal.timeout(2000)) : null,
      bodies: approvalBodies.filter(entry => entry.sessionId === sessionId),
      decisions: agent.session.events.filter(event => event.type === 'approval/decided').map(event => event.data) }
  },
  async holdApprovalDecisionWriteForCrash({ sessionId, approvalId }) {
    assert.equal(approvalWriteFault, undefined)
    const agent = root.agents.get(sessionId); assert.ok(agent)
    assert.ok(agent.session.events.some(event => event.type === 'approval/asked' && event.data.id === approvalId))
    assert.ok(!agent.session.events.some(event => event.type === 'approval/decided' && event.data.id === approvalId))
    await root.sessions.flush(agent.session)
    const backend = Reflect.get(root.sessionPersistence, symbols.original), original = backend.appendBatch
    assert.equal(typeof original, 'function'); assert.equal(Object.hasOwn(backend, 'appendBatch'), false)
    const fault = { sessionId, approvalId, held: false }; approvalWriteFault = fault
    // Exact test-owned backend boundary only. Original approval consumption
    // and event append remain real; one matching physical write waits until
    // the parent SIGKILLs this child. No production injection or fake receipt.
    Object.defineProperty(backend, 'appendBatch', { configurable: true, writable: true, value: function(meta, events, materialized) {
      if (meta.id === sessionId && events.some(event => event.type === 'approval/decided' && event.data.id === approvalId)) {
        fault.held = true; return new Promise(() => {})
      }
      return original.call(this, meta, events, materialized)
    } })
    const raw = await backend.readRaw(sessionId)
    return { pid: process.pid, sessionId, approvalId, rawSha256: hash(raw.content), originalAskedFlushed: true }
  },
  async approvalCrashProbe() {
    assert.ok(approvalWriteFault)
    const { sessionId, approvalId, held } = approvalWriteFault, agent = root.agents.get(sessionId)
    assert.ok(agent)
    // The coordinator is intentionally waiting on the held write. Read the
    // original backend's physical prefix directly, never the logical cache.
    const backend = Reflect.get(root.sessionPersistence, symbols.original)
    const stored = await backend.loadStored(sessionId), raw = await backend.readRaw(sessionId)
    return { pid: process.pid, sessionId, approvalId, held, rawSha256: hash(raw.content),
      liveDecisions: agent.session.events.filter(event => event.type === 'approval/decided' && event.data.id === approvalId).map(event => event.data.outcome),
      storedDecisions: stored.events.filter(event => event.type === 'approval/decided' && event.data.id === approvalId).map(event => event.data.outcome),
      bodies: approvalBodies.filter(entry => entry.sessionId === sessionId).length }
  },
  async unsignedApproval({ sessionId, approvalId, rpcId }) {
    return root.apiProxy.respond({ type: 'client-response', rpcId, result: { ok: true, value: { sessionId, approvalId, outcome: 'allowed-once' } } })
  },
  async holdNextNativeWakeForCrash({ sessionId }) {
    const agent = root.agents.get(sessionId); assert.ok(agent)
    assert.equal(agent.status, 'idle'); assert.equal(Object.hasOwn(agent, 'wakeDriver'), false)
    assert.equal(typeof agent.wakeDriver, 'function')
    // Explicit diagnostic fault at the original synchronous boundary after
    // native insertion and before the driver claims input. The parent will
    // SIGKILL this exact child; never used by the production Worker.
    Object.defineProperty(agent, 'wakeDriver', { configurable: true, value() {} })
    return { pid: process.pid, nativeInsertionNotReplaced: true, driverWakeHeld: true }
  },
  async settlePublicPrompt({ sessionId }) {
    const agent = root.agents.get(sessionId); assert.ok(agent)
    await agent.whenIdle(); activePrompt = undefined
    return snapshot(sessionId)
  },
  async resume({ sessionId, presetId, prefixBytes }) {
    assert.ok(!handles.has(sessionId)); assert.ok(Number.isSafeInteger(prefixBytes) && prefixBytes > 0)
    const handle = await root.agents.resume({ resumeSessionId: sessionId,
      agentOptions: { provider: 'local-only', model: 'synthetic' }, setup: async context => { await root.agentPresets.mount(context, presetId) } })
    handles.set(sessionId, handle)
    await handle.agent.whenIdle()
    return snapshot(sessionId, prefixBytes)
  },
  async prompt({ sessionId, source, mode }) {
    const agent = handles.get(sessionId)?.agent; assert.ok(agent)
    activePrompt = { sessionId, mode, toolRequested: false }
    try {
      agent.followup(createUserMessage({ source: { kind: 'user', rpcId: source },
        content: [{ type: 'text', text: mode === 'invocation' ? '/customer-notes Use the assigned method' : 'Use the assigned customer method' }] }))
      await agent.whenIdle(); return snapshot(sessionId)
    } finally { activePrompt = undefined }
  },
  snapshot: ({ sessionId }) => snapshot(sessionId),
  async stop() { await stop(); return { stopped: true, pid: process.pid } },
}
const send = value => new Promise((resolve, reject) => process.send(value, error => error ? reject(error) : resolve()))
process.on('message', request => {
  serial = serial.then(async () => {
    try {
      assert.ok(request && typeof request.id === 'string' && Object.hasOwn(commands, request.method))
      const value = await commands[request.method](request.input)
      await send({ id: request.id, ok: true, value })
      if (request.method === 'stop') process.disconnect()
    } catch (error) { await send({ id: request?.id, ok: false, error: String(error?.stack ?? error).slice(0, 12000) }) }
  }).catch(() => { void stop().finally(() => { if (process.connected) process.disconnect(); process.exitCode = 1 }) })
})
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  void stop().finally(() => { if (process.connected) process.disconnect() })
})
