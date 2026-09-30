// @vitest-environment node
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Compatibility diagnosis against installed rc.2 owners. This is deliberately
// not enterprise authorization, a final Worker image or Browser E2E evidence.
const local = createRequire(import.meta.url)
const web = createRequire(createRequire(local.resolve('@deepseek-ai/dsh/package.json')).resolve('@deepseek-ai/dsh-web-app/package.json'))
const { Context } = web('@deepseek-ai/cordis')
const { SessionStore } = web('@deepseek-ai/dsh-session')
const { AgentRegistry } = web('@deepseek-ai/dsh-agent')
const { AgentLoop } = web('@deepseek-ai/dsh-agent-loop')
const { SystemPrompt } = web('@deepseek-ai/dsh-system-prompt')
const { LlmRuntime, createUserMessage } = web('@deepseek-ai/dsh-llm')
const { ToolRuntime } = web('@deepseek-ai/dsh-tools')
const { TypertRegistry } = web('@deepseek-ai/dsh-typert-registry')
const { TypertGatewayService } = web('@deepseek-ai/dsh-api-gateway')
const { HostConnectionService } = web('@deepseek-ai/dsh-client-connection')
const { CommandRuntime } = web('@deepseek-ai/dsh-commands')
const commandReflection = web(join(dirname(web.resolve('@deepseek-ai/dsh-commands/package.json')), 'lib/typert.host.js')).TYPERT
const exportCommand = web('@deepseek-ai/dsh-session-log-export')
const { PlanModeController } = web('@deepseek-ai/dsh-plan-mode')
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture() {
  const root = new Context()
  const held = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
  cleanups.push(async () => { held.resolve(); await root.fiber.dispose() })
  for (const [plugin, config] of [[TypertRegistry], [SessionStore], [AgentRegistry], [SystemPrompt, {}],
    [LlmRuntime], [ToolRuntime, {}], [AgentLoop, { agents: [] }]]) await root.plugin(plugin, config)
  root.provide('userQuestions', { registerProvider: () => () => {} })
  // Prevent any model request, while retaining the actual Agent/queue owners.
  root.on('agent/pre-step', async () => { entered.resolve(); await held.promise; return { kind: 'reject' } })
  const connection = new HostConnectionService(root, [])
  root.typert.register(commandReflection)
  await root.plugin(CommandRuntime)
  await root.plugin(exportCommand)
  await root.plugin(PlanModeController, { section: 'Synthetic plan guidance; do not call a model.' })
  await root.plugin(TypertGatewayService)
  const handle = await root.agents.create({ sessionId: 'command-origin-probe', meta: { agentPreset: 'standard' } })
  const fallback = vi.fn(async () => new Response('not found', { status: 404 }))
  const carrier = connection.createSharedFetchHandler('/api', { fetch: fallback })
  const call = async (line: string, rpcId = 'current-browser-request', extra: Record<string, unknown> = {}, method = 'commands/execute') => {
    const response = await carrier.fetch(new Request('http://127.0.0.1/api/commands/execute', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId, method,
        payload: { args: { agentId: handle.agent.id, line, images: [], ...extra } } }) }))
    expect(response.status).toBe(200)
    return response.json()
  }
  return { root, handle, call, entered, fallback }
}

describe('native rc.2 command origin gap: executable diagnosis, not a permission grant', () => {
  it('correlates the real export response but does not attach that identity to its command log', async () => {
    const f = await fixture(), before = f.handle.agent.session.events.length
    const reply = await f.call('/export', 'new-login-request')
    expect(reply).toMatchObject({ type: 'server-response', rpcId: 'new-login-request', result: { ok: true,
      value: { result: { kind: 'success', text: 'Session log download requested.' } } } })
    const added = [...f.handle.agent.session.events].slice(before)
    expect(added.map(event => event.type)).toEqual(['command/run', 'command/done'])
    expect(added[0].data).toMatchObject({ commandId: reply.result.value.commandId, name: 'export', source: { kind: 'user' } })
    expect(added[0].data.source).toEqual({ kind: 'user' })
    expect(added[1].data).toMatchObject({ commandId: reply.result.value.commandId, kind: 'success' })
    expect(f.fallback).not.toHaveBeenCalled()
  })
  it('still drops source when the caller merely puts a signed-looking value in rpcId', async () => {
    const f = await fixture(), synthetic = 'paimind-origin-v1.cHJvYmU.' + 's'.repeat(43)
    const reply = await f.call('/export', synthetic)
    expect(reply.rpcId).toBe(synthetic); expect(reply.result.ok).toBe(true)
    const run = [...f.handle.agent.session.events].find(event => event.type === 'command/run')
    expect(run.data.source).toEqual({ kind: 'user' })
    // This value is a synthetic carrier probe, never a real verified login.
    expect(JSON.stringify([...f.handle.agent.session.events])).not.toContain(synthetic)
  })
  it('retains native command failure without misreporting a successful export or artifact delivery', async () => {
    const f = await fixture(), reply = await f.call('/export /not-an-export-destination')
    expect(reply.result.ok).toBe(true)
    expect(reply.result.value.result).toEqual({ kind: 'error', text: 'The Web /export command does not accept a path.' })
    const done = [...f.handle.agent.session.events].find(event => event.type === 'command/done')
    expect(done.data.kind).toBe('error')
  })
  it('rejects caller-supplied identity arguments before the original handler', async () => {
    const f = await fixture(), before = [...f.handle.agent.session.events]
    for (const extra of [{ rpcId: 'pretend-identity' }, { role: 'admin' }, { userId: 'another-member' }, { source: { kind: 'user' } }]) {
      const reply = await f.call('/export', 'browser-id', extra)
      expect(reply.result.ok).toBe(false)
    }
    expect([...f.handle.agent.session.events]).toEqual(before)
  })
  it('rejects envelope/route mismatch and missing Agent without falling back to another Session', async () => {
    const f = await fixture(), before = [...f.handle.agent.session.events]
    expect((await f.call('/export', 'browser-id', {}, 'commands/list')).result.ok).toBe(false)
    expect((await f.call('/export', 'browser-id', { agentId: 'not-owned-or-present' })).result.ok).toBe(false)
    expect([...f.handle.agent.session.events]).toEqual(before)
  })
  it('demonstrates native plan steering has no current rpcId even beside an older signed user message', async () => {
    const f = await fixture()
    f.handle.agent.followup(createUserMessage({ source: { kind: 'user', rpcId: 'paimind-origin-v1.b2xk.' + 'o'.repeat(43) },
      content: [{ type: 'text', text: 'Hold native turn without model execution.' }] }))
    await f.entered.promise
    const reply = await f.call('/plan Inspect only this synthetic requirement.', 'current-plan-request')
    expect(reply.result.ok).toBe(true); expect(reply.result.value.result.kind).toBe('success')
    expect(f.handle.agent.inbox.nextStep).toHaveLength(1)
    expect(f.handle.agent.inbox.nextStep[0]).toMatchObject({ content: [{ type: 'text', text: 'Inspect only this synthetic requirement.' }] })
    expect(f.handle.agent.inbox.nextStep[0].source).toEqual({ kind: 'user' })
    expect([...f.handle.agent.session.events].filter(event => event.type === 'tool/call' || event.type === 'request/header')).toHaveLength(0)
  })
})
