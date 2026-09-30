// @vitest-environment node
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManagedHarnessCommandProviders } from '../src/managed-command.js'
import { prepareHarnessExportCommandRequest, COMMAND_BINDING_HEADER, COMMAND_ORIGIN_HEADER } from '../src/command-execution.js'
const local = createRequire(import.meta.url)
const web = createRequire(createRequire(local.resolve('@deepseek-ai/dsh/package.json')).resolve('@deepseek-ai/dsh-web-app/package.json'))
const { Context } = web('@deepseek-ai/cordis'), { SessionStore } = web('@deepseek-ai/dsh-session'), { AgentRegistry } = web('@deepseek-ai/dsh-agent')
const { AgentLoop } = web('@deepseek-ai/dsh-agent-loop'), { SystemPrompt } = web('@deepseek-ai/dsh-system-prompt')
const { LlmRuntime } = web('@deepseek-ai/dsh-llm'), { ToolRuntime } = web('@deepseek-ai/dsh-tools')
const { TypertRegistry } = web('@deepseek-ai/dsh-typert-registry'), { TypertGatewayService } = web('@deepseek-ai/dsh-api-gateway')
const connection = web('@deepseek-ai/dsh-client-connection'), { WebServer } = web('@deepseek-ai/dsh-host-webserver')
const { CommandRuntime } = web('@deepseek-ai/dsh-commands'), exportModule = web('@deepseek-ai/dsh-session-log-export')
const reflection = web(join(dirname(web.resolve('@deepseek-ai/dsh-commands/package.json')), 'lib/typert.host.js')).TYPERT
const source = (char = 'h') => 'paimind-origin-v1.c3ludGhldGlj.' + char.repeat(43)
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture() {
  const root = new Context(), check = vi.fn(async (_input: any, _signal: AbortSignal) => {})
  cleanups.push(async () => { await root.fiber.dispose() })
  const managed = createManagedHarnessCommandProviders(root, WebServer, CommandRuntime, exportModule, check)
  for (const [plugin, config] of [[TypertRegistry], [SessionStore], [AgentRegistry], [SystemPrompt, {}], [LlmRuntime],
    [ToolRuntime, {}], [AgentLoop, { agents: [] }]]) await root.plugin(plugin, config)
  root.on('agent/pre-step', () => { throw Error('No model is permitted in this native command test') })
  await root.plugin(managed.Web, { host: '127.0.0.1', port: 0 })
  await root.plugin(connection)
  root.typert.register(reflection)
  await root.plugin(managed.Commands)
  const owner = await root.plugin(managed.selectExport(exportModule))
  await root.plugin(TypertGatewayService)
  const handle = await root.agents.create({ sessionId: 'hansen-command-test', meta: { agentPreset: 'standard' } })
  const origin = `http://127.0.0.1:${root.webServer.port}`
  const call = async (options: { line?: string; source?: string; args?: object; headers?: Record<string, string>; omitHeaders?: boolean; signal?: AbortSignal } = {}) => {
    const body = { type: 'client-request', rpcId: 'browser-command', method: 'commands/execute',
      payload: { args: { agentId: handle.agent.id, line: options.line ?? '/export', images: [], ...options.args } } }
    const wire = Buffer.from(JSON.stringify(body))
    const prepared = prepareHarnessExportCommandRequest('POST', '/api/commands/execute', 'application/json', wire)!
    const signed = options.source ?? source()
    const response = await fetch(origin + '/api/commands/execute', { method: 'POST', signal: options.signal ?? AbortSignal.timeout(7000),
      headers: { origin, 'content-type': 'application/json', ...options.omitHeaders ? {} : prepared.privateHeaders(signed), ...options.headers },
      body: prepared.stamp(signed) })
    const text = await response.text()
    return { status: response.status, text, wire: response.status === 200 ? JSON.parse(text) : undefined }
  }
  const events = () => [...handle.agent.session.events].filter((e: any) => e.type.startsWith('command/'))
  return { root, check, managed, handle, owner, call, events }
}

describe('original native HTTP/Connection/Typert/export with synthetic current authority; not Browser E2E', () => {
  it('executes the original owner once, preserving original lifecycle and requiring the current actor twice', async () => {
    const f = await fixture(), reply = await f.call()
    expect(reply.status).toBe(200); expect(reply.wire.result).toMatchObject({ ok: true, value: { result: { kind: 'success', text: 'Session log download requested.' } } })
    expect(f.events().map((e: any) => e.type)).toEqual(['command/run', 'command/done'])
    expect(f.check).toHaveBeenCalledTimes(2)
    expect(f.check.mock.calls.map(call => call[0])).toEqual(Array(2).fill({ nativeSessionId: f.handle.agent.id, presetId: 'standard', sources: [source()] }))
    expect(f.managed.ownsCommands(f.root.commands)).toBe(true); expect(f.managed.ownsWeb(f.root.webServer)).toBe(true)
    expect(f.events()[0].data.source).toEqual({ kind: 'user' })
  })
  it('keeps the original argument error and never claims a file was delivered', async () => {
    const f = await fixture(), reply = await f.call({ line: '/export /not-an-output-path' })
    expect(reply.wire.result.value.result).toEqual({ kind: 'error', text: 'The Web /export command does not accept a path.' })
    expect(f.events()[1].data.kind).toBe('error'); expect(f.check).toHaveBeenCalledTimes(2)
  })
  it.each(['missing', 'binding', 'source', 'partial'])('rejects %s private provenance before any native log mutation', async kind => {
    const f = await fixture(), reply = await f.call(kind === 'missing' ? { omitHeaders: true } : kind === 'binding'
      ? { headers: { [COMMAND_BINDING_HEADER]: '0'.repeat(64) } } : kind === 'source'
        ? { headers: { [COMMAND_ORIGIN_HEADER]: 'unverified' } } : { omitHeaders: true, headers: { [COMMAND_ORIGIN_HEADER]: source() } })
    expect(reply.status !== 200 || !reply.wire.result.ok).toBe(true)
    expect(f.events()).toEqual([]); expect(f.check).not.toHaveBeenCalled()
  })
  it('denies revoked login/preset authority before the original handler and hides checker details', async () => {
    const f = await fixture(); f.check.mockRejectedValue(Error('private credential detail'))
    const reply = await f.call()
    expect(reply.wire.result.ok).toBe(false); expect(reply.text).not.toContain('private credential detail'); expect(f.events()).toEqual([])
  })
  it('does not return a successful receipt after the post-execution authority check fails', async () => {
    const f = await fixture(); f.check.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('revoked after acceptance'))
    const reply = await f.call()
    expect(reply.wire.result.ok).toBe(false)
    // Native acceptance already happened; it must not be erased or reported as
    // zero native work, and it still is not proof of a browser download.
    expect(f.events().map((e: any) => e.data.kind ?? e.type)).toEqual(['command/run', 'success'])
  })
  it('does not let a scoped same-name handler borrow the reviewed original export permission', async () => {
    const f = await fixture(), body = vi.fn(() => ({ kind: 'success', text: 'not native export' }))
    await f.handle.agent.ctx.plugin({ inject: ['commands'], apply(ctx: any) {
      ctx.commands.register({ name: 'export', description: 'Synthetic shadow', handler: body })
    } })
    const reply = await f.call()
    expect(reply.wire.result.ok).toBe(false); expect(body).not.toHaveBeenCalled(); expect(f.events()).toEqual([])
  })
  it('keeps concurrent exact calls and their actors separate', async () => {
    const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    let held = false
    f.check.mockImplementation(async input => { if (!held && input.sources[0] === source('a')) { held = true; entered.resolve(); await release.promise } })
    const slow = f.call({ source: source('a') }); await entered.promise
    const fast = await f.call({ source: source('b') }); expect(fast.wire.result.ok).toBe(true)
    release.resolve(); expect((await slow).wire.result.ok).toBe(true)
    expect(f.check.mock.calls.map(x => x[0].sources[0])).toEqual([source('a'), source('b'), source('b'), source('a')])
    expect(new Set(f.events().filter((x: any) => x.type === 'command/run').map((x: any) => x.data.commandId)).size).toBe(2)
  })
  it('cancels the bounded authority wait on client disconnect before executing', async () => {
    const f = await fixture(), entered = Promise.withResolvers<AbortSignal>(), abort = new AbortController()
    f.check.mockImplementation(async (_input, signal) => { entered.resolve(signal); await new Promise(() => {}) })
    const pending = f.call({ signal: abort.signal }), assertion = expect(pending).rejects.toThrow()
    const signal = await entered.promise; abort.abort(); await assertion
    await vi.waitFor(() => expect(signal.aborted).toBe(true)); expect(f.events()).toEqual([])
  })
  it('rejects withdrawn original registrations and retained references without changing provider-owned objects', async () => {
    const f = await fixture(), retained = f.root.commands, originalPrototype = Object.getPrototypeOf(retained)
    await f.owner.dispose()
    expect((await f.call()).wire.result.ok).toBe(false); expect(f.events()).toEqual([])
    expect(Object.getPrototypeOf(retained)).toBe(originalPrototype)
    await f.root.fiber.dispose(); expect(f.managed.ownsCommands(retained)).toBe(false)
    await expect(retained.execute(f.handle.agent, '/export', [], new AbortController().signal)).rejects.toThrow()
  })
})
