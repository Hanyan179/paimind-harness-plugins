// Test-only process entry. Real installed native owners and source adapters;
// explicit preset/model fixtures, not a production Worker image or browser.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createConnection } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { LlmRuntime, LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { JsonlSessionPersistence } from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { installManagedHarnessOriginGuard } from '../../../../packages/harness-compat/src/managed-origins.js'
import { createManagedHarnessDelegationProviders } from '../../../../packages/harness-compat/src/managed-delegation.js'
import { createNativeControlPeer } from '../../../../deploy/enterprise/worker/runtime/native-control.mjs'

assert.equal(process.env.PAIMIND_NATIVE_PROCESS_TEST, '1')
assert.ok(process.send)
const text = value => [{ type: 'text', text: value }]
const hash = value => createHash('sha256').update(value).digest('hex')
const wait = async predicate => {
  const end = performance.now() + 6000
  while (!predicate()) {
    if (performance.now() >= end) throw Error('Native process fixture wait exceeded its bound')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
const aborted = signal => new Promise(resolve => {
  if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true })
})
let root, parent, peer, config, stopped, serial = Promise.resolve()
const calls = [], checks = [], insertions = [], endings = []
async function snapshot() {
  assert.ok(root && parent)
  await root.sessions.flush(parent.agent.session)
  const raw = await root.sessionPersistence.readRaw(parent.agent.id)
  return { pid: process.pid, parentId: parent.agent.id, presetId: parent.agent.session.header.agentPreset,
    status: parent.agent.status, events: parent.agent.session.events, raw: raw.content, rawSha256: hash(raw.content),
    nextTurn: parent.agent.inbox.nextTurn, nextStep: parent.agent.inbox.nextStep,
    calls, checks, insertions, endings, liveIds: root.agents.list().map(agent => agent.id) }
}
async function boot(input) {
  assert.ok(!root); config = input
  assert.ok(input.directory && input.socketPath && input.parentId && input.presetId)
  root = new Context()
  peer = createNativeControlPeer(createConnection(input.socketPath), {
    handle: async () => { throw Error('No publication fixture operation is supported') },
  })
  await wait(() => peer.ready)
  const execution = input => ({ ...input, sources: [...input.sources], publication: config.publication, skills: [] })
  installManagedHarnessOriginGuard(root, async (input, signal) => {
    const decision = { ...input, sources: [...input.sources], allowed: false }
    checks.push(decision)
    await peer.authorizeExecution(execution(input), signal)
    decision.allowed = true
  })
  const managed = createManagedHarnessDelegationProviders(root, (input, signal) => peer.deriveOrigins(execution(input), signal), [spawn])
  for (const [plugin, settings] of [[SessionStore], [managed.Agents], [SystemPrompt, {}], [LlmRuntime], [ToolRuntime, {}], [managed.Subagents]])
    await root.plugin(plugin, settings)
  await root.plugin(JsonlSessionPersistence, { root: input.directory, compression: 'none' })
  // This owner is deliberately a fixture. No actual immutable preset adoption
  // or production runtime composition is claimed by this process test.
  root.provide('agentPresets', { composedPreset: ctx => ctx.agent?.session.header.agentPreset, composeFrom: () => {} })
  for (const provider of ['parent-local-only', 'child-local-only']) root.llm.registerAdapter([provider], new class extends LlmAdapter {
    async *stream(request) {
      calls.push({ provider, model: request.model })
      if (provider === 'parent-local-only' && config.holdParent) { await aborted(request.signal); return }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: `Synthetic ${provider} result; no external model` }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: `Synthetic ${provider} result; no external model` } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }())
  await root.plugin(AgentLoop, { agents: [] })
  await root.plugin(managed.selectProvider(spawn), { providerName: 'original-spawn' })
  root.on('agent/inbox/inserted', ({ agent, message }) => insertions.push({ agentId: agent.id, message }))
  root.on('subagent/end', info => endings.push(info))
  parent = input.resume ? await root.agents.resume({ resumeSessionId: input.parentId,
    agentOptions: { provider: 'parent-local-only', model: 'synthetic' } })
    : await root.agents.create({ sessionId: input.parentId, meta: { agentPreset: input.presetId },
      agentOptions: { provider: 'parent-local-only', model: 'synthetic' } })
  return { pid: process.pid, parentId: parent.agent.id, resumed: !!input.resume }
}
async function stop() {
  return stopped ??= (async () => {
    // Match the managed entry's ordering: close private authority first, then
    // let the original native owners cancel/drain and persist their outcomes.
    const deadline = setTimeout(() => process.exit(1), 8000)
    try { peer?.close(); await root?.fiber.dispose() }
    finally { clearTimeout(deadline) }
  })()
}
const commands = {
  boot,
  async prompt({ source }) {
    parent.agent.followup(createUserMessage({ source: { kind: 'user', rpcId: source }, content: text('Synthetic persisted parent input') }))
    if (config.holdParent) await wait(() => calls.some(call => call.provider === 'parent-local-only'))
    else await parent.agent.whenIdle()
    return snapshot()
  },
  async child() {
    const result = await root.subagents.startContinuable({ provider: 'original-spawn', label: '客户跟进子任务',
      request: { parent: parent.agent, prompt: text('Synthetic persisted delegated input'),
        agentOptions: { provider: 'child-local-only', model: 'synthetic' } }, signal: new AbortController().signal })
    await wait(() => endings.some(info => info.id === result.childId))
    const raw = await root.sessionPersistence.readRaw(result.childId)
    return { ...result, childRaw: raw.content, childRawSha256: hash(raw.content), parent: await snapshot() }
  },
  async followup({ childId, source }) {
    const previous = endings.filter(info => info.id === childId).length
    const messageId = await root.subagents.followup(parent.agent, childId, text('Synthetic new-epoch direct-user input'), {
      source: { kind: 'user', rpcId: source }, signal: new AbortController().signal,
    })
    await wait(() => endings.filter(info => info.id === childId).length > previous)
    await parent.agent.whenIdle()
    const raw = await root.sessionPersistence.readRaw(childId)
    return { messageId, childRaw: raw.content, parent: await snapshot() }
  },
  async idle() { await parent.agent.whenIdle(); return snapshot() },
  snapshot,
  async stop() { await stop(); return { pid: process.pid, stopped: true } },
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
  void stop().then(() => { if (process.connected) process.disconnect() }, () => { process.exitCode = 1; if (process.connected) process.disconnect() })
})
