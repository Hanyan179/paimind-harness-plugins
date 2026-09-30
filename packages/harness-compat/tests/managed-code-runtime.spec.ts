// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createManagedHarnessCodeProvider } from '../src/managed-code-runtime.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Agent } from '@deepseek-ai/dsh-agent'

// Native processes/Code Runtime, with an explicitly identity-only placement
// fixture. Hostile message fixtures replace only the helper, never claim Linux
// confinement. The separate immutable-image tests prove that boundary.
const contexts: Context[] = []; const directories: string[] = []
afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})
async function runtime(maxOutputBytes = 4096, adversarial?: string) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'paimind-managed-code-'))); directories.push(cwd)
  const root = new Context(); contexts.push(root)
  const handles: SubprocessHandle[] = []
  const policies: unknown[] = []
  const fake = `import{managedJsonWriter,readManagedJson}from${JSON.stringify(new URL('../src/managed-json-pipe.ts', import.meta.url).href)};
    const send=managedJsonWriter(process.stdout),input=readManagedJson(process.stdin)[Symbol.asyncIterator]();
    await input.next();${adversarial ?? ''};process.stdin.destroy();`
  class RecordedSubprocess extends LocalSubprocessRuntime {
    override spawn(spec: SubprocessSpawnSpec) {
      const handle = super.spawn(adversarial === undefined ? spec : { ...spec, argv: [process.execPath, '--input-type=module', '-e', fake] })
      handles.push(handle); return handle
    }
  }
  root.provide('sandbox', { confine: (argv: string[], policy: unknown) => { policies.push(policy); return { argv, enforcement: 'full' } } })
  await root.plugin(RecordedSubprocess)
  await root.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: cwd })
  await root.plugin(createManagedHarnessCodeProvider({ executionWorld: {
    nodeExecutable: process.execPath, moduleAnchor: fileURLToPath(new URL('../package.json', import.meta.url)), lookupCwd: cwd,
  } }), { computeMs: 500, maxWallMs: 2000, maxOutputBytes, maxOldGenerationSizeMb: 128 })
  return { root, code: root.codeRuntime, handles, policies }
}

describe('managed original Code Runtime process composition', () => {
  it('keeps concurrent native initiator session roots separate and denies a stale inherited agent before spawn', async () => {
    const { root, code, handles, policies } = await runtime()
    // Explicit initiator-service fixture, not authentication or real Agent
    // acceptance. The Linux profile test uses the original registry/driver.
    const current = new AsyncLocalStorage<Agent>()
    const members = ['Hansen', 'Alex'].map(id => ({ id, session: { id, header: { cwd: `/tmp/${id}-policy-root` }, events: [] } }) as unknown as Agent)
    const live = new Map(members.map(member => [member.id, member]))
    root.provide('agents', { currentInitiator: () => current.getStore(), get: (id: string) => live.get(id) } as unknown as Context['agents'])
    const results = await Promise.all(members.map(member => current.run(member, async () => {
      await Promise.resolve(); return code.run({ bindings: [], program: 'return true' })
    })))
    expect(results.every(result => result.value === true)).toBe(true)
    expect(policies).toEqual(expect.arrayContaining(members.map(member => expect.objectContaining({ workspaceRoot: member.session.header.cwd, sessionId: member.id }))))
    const before = handles.length; live.delete(members[0]!.id)
    const denied = await current.run(members[0]!, () => code.run({ bindings: [], program: 'return true' }))
    expect(denied.error?.kind).toBe('worker-exit'); expect(handles).toHaveLength(before)
    expect(current.getStore()).toBeUndefined()
  })
  it('preserves native configuration and binding misuse without launching a local worker or helper', async () => {
    const { code, handles } = await runtime()
    expect(code.isolation).toBe('process')
    await expect(code.run({ program: 'return true', bindings: [{ global: 'console', functions: {} }] })).rejects.toThrow('reserved')
    await expect(code.run({ program: 'return true', bindings: [{ global: 'lambda', functions: {} }], signal: AbortSignal.abort() })).rejects.toThrow('identifier')
    expect((await code.run({ program: 'return true', bindings: [], signal: AbortSignal.abort('cancelled') })).error?.kind).toBe('abort')
    expect(handles).toHaveLength(0)
  })

  it('retains error classes, literal function names, lossless replies and fresh run state', async () => {
    const { code, handles } = await runtime()
    const functions = Object.assign(Object.create(null), { constructor: async (args: unknown) => args,
      lossy: async () => undefined as never })
    const value = await code.run({ program: `const answer=await tools.constructor({hello:'Hansen'});
      try {await tools.lossy(null)} catch(e) {return {answer,typed:e instanceof ToolError,member:e.member,message:e.message}}`,
      bindings: [{ global: 'tools', functions, errorClass: { name: 'ToolError', memberNameProperty: 'member' } }] })
    expect(value).toEqual({ logs: [], value: { answer: { hello: 'Hansen' }, typed: true, member: 'lossy', message: 'binding resolution must be lossless JSON' } })
    expect(await code.run({ program: 'globalThis.secret="Hansen";return null', bindings: [] })).toEqual({ logs: [], value: null })
    expect(await code.run({ program: 'return typeof globalThis.secret', bindings: [] })).toEqual({ logs: [], value: 'undefined' })
    for (const handle of handles) expect(await handle.waitForExit(AbortSignal.timeout(3000))).toBe(true)
  })

  it.each([4, 8, 128])('preserves the native minimum and combined output budget (%s bytes)', async maximum => {
    const { code } = await runtime(maximum)
    expect(await code.run({ program: 'return ""', bindings: [] })).toEqual({ logs: [], value: '' })
    const output = await code.run({ program: 'console.log("a".repeat(1000));return true', bindings: [] })
    expect(output.error?.kind).toBe('output-limit')
    expect(Buffer.byteLength(JSON.stringify(output.logs)) + Buffer.byteLength(JSON.stringify(output.error!.message))).toBeLessThanOrEqual(maximum)
  })

  it('admits only own declared bindings and answers duplicate forged call ids at most once', async () => {
    const { code } = await runtime(4096, `
      await send({kind:'ready'});
      await send({kind:'call',id:1,global:'allowed',name:'constructor',args:null});await input.next();
      await send({kind:'call',id:2,global:'allowed',name:'bump',args:null});await input.next();
      await send({kind:'call',id:2,global:'allowed',name:'bump',args:null});
      await send({kind:'result',result:{logs:[],value:'done'}});`)
    let calls = 0
    expect(await code.run({ program: 'not executed by the message fixture', bindings: [
      { global: 'allowed', functions: { bump: async () => { calls++; return null } } },
    ] })).toEqual({ logs: [], value: 'done' })
    expect(calls).toBe(1)
  })

  it('never dispatches a binding after the result has claimed settlement', async () => {
    const { code } = await runtime(4096, `
      await send({kind:'ready'});await send({kind:'result',result:{logs:[],value:'done'}});
      await send({kind:'call',id:1,global:'allowed',name:'bump',args:null});`)
    let calls = 0
    expect((await code.run({ program: '', bindings: [{ global: 'allowed', functions: { bump: async () => { calls++; return null } } }] })).value).toBe('done')
    expect(calls).toBe(0)
  })

  it('rechecks forged outer output against the native cap in the protected controller', async () => {
    const { code } = await runtime(8, `await send({kind:'ready'});await send({kind:'result',result:{logs:['x'.repeat(5000)],value:true}});`)
    const output = await code.run({ program: '', bindings: [] })
    expect(output.error?.kind).toBe('output-limit')
    expect(Buffer.byteLength(JSON.stringify(output.logs)) + Buffer.byteLength(JSON.stringify(output.error!.message))).toBeLessThanOrEqual(8)
  })

  it.each([
    `await send({kind:'result',result:{logs:[],value:true}})`,
    `await send({kind:'ready'});await send({kind:'ready'})`,
    `await send({kind:'ready'});await send({kind:'result',result:{logs:[],error:{kind:'admin',message:'forged'}}})`,
  ])('rejects malformed protocol state without turning it into completion', async script => {
    const { code } = await runtime(4096, script)
    expect((await code.run({ program: '', bindings: [] })).error?.kind).toBe('worker-exit')
  })

  it('disposes an active run without awaiting caller-owned binding settlement or retaining the helper', async () => {
    const { root, code, handles } = await runtime()
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve })
    let finishBinding!: (value: null) => void
    const pending = new Promise<null>(resolve => { finishBinding = resolve })
    const run = code.run({ program: 'await host.pending(null)', bindings: [{ global: 'host', functions: {
      pending: async () => { entered(); return pending },
    } }] })
    await started; await root.fiber.dispose()
    expect((await run).error?.kind).toBe('abort')
    finishBinding(null)
    await expect(code.run({ program: '', bindings: [] })).rejects.toThrow(/withdrawn|disposal/)
    for (const handle of handles) expect(await handle.waitForExit(AbortSignal.timeout(3000))).toBe(true)
  })

  it('keeps concurrent binding maps and cancellation independent within one member runtime', async () => {
    const { code } = await runtime()
    const controllers = [new AbortController(), new AbortController()]
    const started: Array<() => void> = []; const release: Array<(value: string) => void> = []
    const readiness = [0, 1].map(index => new Promise<void>(resolve => { started[index] = resolve }))
    const resolutions = [0, 1].map(index => new Promise<string>(resolve => { release[index] = resolve }))
    const runs = [0, 1].map(index => code.run({ program: 'return await host.wait(null)',
      bindings: [{ global: 'host', functions: { wait: async () => { started[index]!(); return await resolutions[index]! } } }],
      signal: controllers[index]!.signal }))
    await Promise.all(readiness); controllers[0]!.abort('cancel first run')
    expect((await runs[0]!).error?.kind).toBe('abort')
    release[1]!('second run'); expect(await runs[1]!).toEqual({ logs: [], value: 'second run' })
    release[0]!('late first reply')
  })
})
