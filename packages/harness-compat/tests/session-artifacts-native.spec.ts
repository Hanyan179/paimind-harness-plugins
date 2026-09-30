// @vitest-environment node
import { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { prepareHarnessSessionProducedRead } from '../src/session-artifacts.js'
import { artifactProjectionDefinition } from '../../artifact-runtime/src/index.js'

it.each([true, false])('reads actual native live/cold projection across owner restart (closed turn: %s) without activating an Agent or altering stored bytes', async closedTurn => {
  const local = createRequire(new URL('../../../package.json', import.meta.url))
  const cli = createRequire(local.resolve('@deepseek-ai/dsh/package.json'))
  const web = createRequire(cli.resolve('@deepseek-ai/dsh-web-app/package.json'))
  const { SessionStore, isAppendSurfaceEvent } = web('@deepseek-ai/dsh-session')
  const { JsonlSessionPersistence } = web('@deepseek-ai/dsh-session-persistence-jsonl')
  const { SessionProjectionRegistry } = web('@deepseek-ai/dsh-session-projection')
  const { createApiProxy } = web('@deepseek-ai/dsh-host-apiproxy')
  const { createToolResultMessage } = web('@deepseek-ai/dsh-llm')
  const { UserQuestionService } = web('@deepseek-ai/dsh-user-questions')
  const base = await mkdtemp(join(tmpdir(), 'haas-original-artifacts-')), roots: Context[] = []
  const activation = vi.fn(() => { throw Error('Read must never activate an Agent') })
  const boot = async () => {
    const root = new Context(); roots.push(root)
    await root.plugin(SessionStore); await root.plugin(JsonlSessionPersistence, { root: base, compression: 'none' })
    await root.plugin(SessionProjectionRegistry); await root.plugin(UserQuestionService)
    root.provide('agents', { get: () => undefined, create: activation, resume: activation } as never)
    // Explicit presenter fixture; original API performs the actual lookup.
    // This proves transport/owner behavior, not a business generator run.
    root.provide('tools', { get: () => ({ presentCall: ({ path }: { path: string }) => ({ card: 'diff', locations: [{ path }] }) }) } as never)
    root.get('sessionProjections').register(artifactProjectionDefinition as never)
    return { root, api: createApiProxy(root, { cwd: base, defaultModelSelection: activation }) }
  }
  try {
    const first = await boot(), sessionId = 'native-artifact-session', sessions = first.root.get('sessions')
    const session = sessions.create(sessionId, { meta: { cwd: base } })
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', { turn: 1, step: 1, callId: 'native-call', name: 'explicit_write_fixture', arguments: JSON.stringify({ path: 'report.html' }) })
    const envelope = { schema: 'paimind.artifact-produced/v1', artifactId: 'artifact-one', sessionId, workspaceId: 'original-workspace',
      path: join(base, 'report.html'), title: 'Native durable fixture', kind: 'html', previewKind: 'html-document', revision: 1,
      producerId: 'fixture.html', taskId: 'fixture-job', state: 'available', producedAt: 100 }
    session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: 'native-call',
      content: [{ type: 'text', text: 'Explicit synthetic tool result; no bytes created' }], isError: false }),
      meta: { schema: 'paimind.tool-result/v1', artifact: envelope } }, { surfaceOp: 'append' })
    const producedSeq = session.events.at(-1).seq
    if (closedTurn) session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await sessions.flush(session)
    const wire = prepareHarnessSessionProducedRead(sessionId, 'paimind.artifacts', 'read')
    const inspect = async (api: any) => {
      const response = await api.sessions.history(JSON.parse(wire.body))
      expect(response.result.ok, JSON.stringify(response.result)).toBe(true)
      return { response, decoded: wire.decode(JSON.stringify({ type: 'server-response', ...response })) }
    }
    const warm = await inspect(first.api)
    expect(warm.decoded.produced).toMatchObject([{ path: 'report.html', seq: producedSeq }])
    expect(warm.decoded.projection).toMatchObject({ artifacts: [envelope] })

    // Invoke the exact selected native client registration, not a copied fold.
    // Its reducer parity is not represented as real browser interaction.
    let definition: any, client: any
    runInNewContext(await readFile(web.resolve('@deepseek-ai/dsh-client-ui-deliverables/client'), 'utf8'), {
      window: { __ModuleLoader__: { load: ({ factory }: any) => { client = factory((name: string) => name === '@deepseek-ai/dsh-client-runtime/client'
        ? { isAppendSurfaceEvent } : local(name)) } } },
    })
    client.apply({ get: () => ({}), conversationEvents: { register: (value: unknown) => { definition = value } }, effect: () => {},
      slots: { inject: () => {} }, locale: { bind: () => () => '' }, provide: () => {} })
    let state: any
    for (const entry of warm.response.result.value.events) {
      const match = definition.match(entry.event)
      if (!match) continue
      const value = { ...match, ...entry }
      state = match.role === 'start' ? definition.start({}, value) : definition.update({ state }, value)
    }
    const original = definition.buildLocationData({ state }, 'turn').value.produced
    expect(warm.decoded.produced.map(({ seq, path }) => ({ seq, path }))).toEqual(original)

    const before = await first.root.get('sessionPersistence').readRaw(sessionId)
    await first.root.fiber.dispose()
    const second = await boot()
    expect(second.root.get('sessions').get(sessionId)).toBeUndefined()
    const stopped = await second.root.get('sessionPersistence').readRaw(sessionId)
    expect(stopped.content.startsWith(before.content)).toBe(true)
    const cold = await inspect(second.api)
    // Original detached recovery supplies an interrupted closer for an open
    // turn. Its read cut, not the pre-stop live watermark, is authoritative.
    expect(cold.response.result.value.events.slice(warm.response.result.value.events.length)).toMatchObject(closedTurn ? [] : [
      { event: { type: 'turn/end', seq: warm.decoded.asOfSeq + 1, data: { reason: { kind: 'interrupted' } } } },
    ])
    expect(cold.decoded).toEqual({ ...warm.decoded, asOfSeq: warm.decoded.asOfSeq + (closedTurn ? 0 : 1) })
    expect(second.root.get('sessions').get(sessionId)).toBeUndefined()
    expect((await second.root.get('sessionPersistence').readRaw(sessionId)).content).toBe(stopped.content)
    expect(activation).not.toHaveBeenCalled()
  } finally {
    for (const root of roots.reverse()) await root.fiber.dispose()
    await rm(base, { recursive: true, force: true })
  }
})
