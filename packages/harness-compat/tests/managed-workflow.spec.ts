// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createManagedHarnessWorkflowProvider } from '../src/managed-workflow.js'

// Real published workflow engine and OS subprocesses. The child-provider and
// parent objects here are explicit lifecycle fixtures, not browser, model,
// member-admission or kernel-isolation evidence.
const contexts: Context[] = []; const directories: string[] = []; const runs: WorkflowRun[] = []
afterEach(async () => {
  for (const run of runs.splice(0)) await run.dispose()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
const meta = { name: 'hansen-delivery', description: 'Review delivery', phases: [{ title: 'Review' }] }
const hansen = Object.freeze({ id: 'Hansen-parent' }) as Agent
const alex = Object.freeze({ id: 'Alex-parent' }) as Agent
async function fixture(start?: (provider: string, request: SubagentStartRequest) => Promise<SubagentRun>, adversarial?: string) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'paimind-managed-workflow-'))); directories.push(cwd)
  const root = new Context(); contexts.push(root)
  const handles: SubprocessHandle[] = []
  const policies: unknown[] = []
  const calls: { provider: string; request: SubagentStartRequest }[] = []
  const disposed: string[] = []
  const events: { name: string; payload: unknown[] }[] = []
  const script = `import{managedJsonWriter,readManagedJson}from${JSON.stringify(new URL('../src/managed-json-pipe.ts', import.meta.url).href)};
    const send=managedJsonWriter(process.stdout),input=readManagedJson(process.stdin)[Symbol.asyncIterator]();
    await input.next();await send({kind:'ready'});await input.next();${adversarial ?? ''};process.stdin.destroy();`
  class RecordedSubprocess extends LocalSubprocessRuntime {
    override spawn(spec: SubprocessSpawnSpec) {
      const handle = super.spawn(adversarial === undefined ? spec : { ...spec, argv: [process.execPath, '--input-type=module', '-e', script] })
      handles.push(handle); return handle
    }
  }
  root.provide('sandbox', { confine: (argv: string[], policy: unknown) => { policies.push(policy); return { argv, enforcement: 'full' } } })
  root.provide('subagents', { getProvider: (name: string) => ['spawn', 'approved'].includes(name) ? {} : undefined,
    start: async (provider: string, request: SubagentStartRequest) => {
      calls.push({ provider, request })
      if (start) return start(provider, request)
      const id = `${request.parent.id}-child-${calls.length}`
      return { id, result: Promise.resolve({ output: [{ type: 'text', text: `${request.parent.id}:${calls.length}` }],
        structured: { member: request.parent.id }, stopReason: 'completed' }), dispose: async () => { disposed.push(id) } }
    } } as unknown as Context['subagents'])
  for (const name of ['workflow/start', 'workflow/phase', 'workflow/log', 'workflow/agent-start', 'workflow/agent-end', 'workflow/end'] as const) {
    root.on(name, (...payload: unknown[]) => { events.push({ name, payload }) })
  }
  await root.plugin(RecordedSubprocess)
  await root.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: cwd })
  const owner = root.plugin(createManagedHarnessWorkflowProvider({ executionWorld: {
    nodeExecutable: process.execPath, moduleAnchor: fileURLToPath(new URL('../package.json', import.meta.url)), lookupCwd: cwd,
  } }), { maxConcurrentAgents: 2, maxTotalAgents: 5, maxItemsPerCall: 10, syncTimeoutMs: 500, disposeGraceMs: 100 })
  await owner
  const engine = root.workflowEngine
  const run = (script: string, parent = hansen, options = {}) => {
    const value = engine.start({ meta, parent, script, ...options }); runs.push(value); return value
  }
  return { root, owner, engine, run, calls, disposed, events, handles, policies }
}

describe('managed original workflow process placement', () => {
  it('projects the explicit parent session policy instead of the provider fallback', async () => {
    const f = await fixture()
    const parent = { id: 'Hansen-policy-parent', session: { id: 'Hansen-policy-parent',
      header: { cwd: '/tmp/Hansen-workflow-root' }, events: [] } } as unknown as Agent
    expect((await f.run('return 42', parent).result).value).toBe(42)
    expect(f.policies).toEqual([expect.objectContaining({ workspaceRoot: '/tmp/Hansen-workflow-root', sessionId: parent.id })])
  })
  it('rejects invalid requests synchronously before publication and does not execute a pre-aborted script', async () => {
    const f = await fixture()
    expect(() => f.run('return 1', hansen, { meta: { name: '' } })).toThrowError(expect.objectContaining({ code: 'META_INVALID' }))
    expect(() => f.run('return (')).toThrowError(expect.objectContaining({ code: 'SCRIPT_PARSE' }))
    expect(() => f.run('return 1', hansen, { subagentProvider: 'unknown' })).toThrowError(expect.objectContaining({ code: 'AGENT_START' }))
    expect(() => f.run('return 1', hansen, { maxTotalAgents: 6 })).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(f.events).toHaveLength(0); expect(f.handles).toHaveLength(0)
    const result = await f.run('while(true){}', hansen, { signal: AbortSignal.abort() }).result
    expect(result.stopReason).toBe('cancelled'); expect(f.handles).toHaveLength(0)
    expect(f.events.map(event => event.name)).toEqual(['workflow/start', 'workflow/end'])
  })
  it('uses the original script hooks, events and host-owned children with exact parent and provider', async () => {
    const f = await fixture()
    const run = f.run(`phase('Review');log('Hansen reviewing');
      const results=await parallel([()=>agent('review order',{label:'Order'}),()=>agent('review invoice',{label:'Invoice'})]);
      return {results,input:args};`, hansen, { args: { approved: true }, subagentProvider: 'approved' })
    expect(await run.result).toEqual({ stopReason: 'completed', value: { results: ['Hansen-parent:1', 'Hansen-parent:2'], input: { approved: true } }, agentsStarted: 2 })
    await run.dispose()
    expect(f.calls).toHaveLength(2)
    expect(f.calls.every(call => call.provider === 'approved' && call.request.parent === hansen)).toBe(true)
    expect(f.calls[0]!.request.signal).toBe(f.calls[1]!.request.signal)
    expect(f.disposed).toHaveLength(2)
    expect(f.events.filter(event => event.name === 'workflow/agent-start')).toHaveLength(2)
    expect(f.events.filter(event => event.name === 'workflow/agent-end')).toHaveLength(2)
    expect(f.events.filter(event => event.name === 'workflow/end')).toHaveLength(1)
    expect(await f.handles[0]!.waitForExit(AbortSignal.timeout(2000))).toBe(true)
  })
  it('preserves structured results and original workflow argument, cap and output failures', async () => {
    const f = await fixture()
    expect((await f.run(`return await agent('structured',{schema:{type:'object',properties:{member:{type:'string'}},required:['member'],additionalProperties:false}})`).result).value)
      .toEqual({ member: 'Hansen-parent' })
    for (const script of ["return await agent('')", "return await agent('x',{unsupported:true})", 'return ()=>1',
      'return await parallel(Array.from({length:11},()=>()=>1))']) {
      expect((await f.run(script).result).stopReason).toBe('error')
    }
    expect(f.calls).toHaveLength(1)
  })
  it('isolates concurrent parent references and terminal outcomes', async () => {
    const f = await fixture()
    const first = f.run("return await agent('Hansen request')")
    const second = f.run("return await agent('Alex request')", alex)
    const [a, b] = await Promise.all([first.result, second.result])
    expect(String(a.value)).toContain('Hansen-parent'); expect(String(b.value)).toContain('Alex-parent')
    expect(f.calls.map(call => call.request.parent)).toEqual(expect.arrayContaining([hansen, alex]))
    first.cancel('too late'); expect(await first.result).toEqual(a)
  })
  it('retains accepted holder-owned work when the engine unloads while denying new starts', async () => {
    const f = await fixture()
    const run = f.run('return args', hansen, { args: 'still-owned' })
    await f.owner.dispose()
    expect(() => f.run('return 2')).toThrow('withdrawn')
    expect((await run.result).value).toBe('still-owned')
    await run.dispose()
  })
  it('cancels and disposes a late provider fulfillment without publishing it or duplicating cleanup', async () => {
    const began = Promise.withResolvers<void>(); const released = Promise.withResolvers<SubagentRun>()
    let cleanup = 0
    const f = await fixture(async () => { began.resolve(); return released.promise })
    const run = f.run("return await agent('slow startup')")
    await began.promise; run.cancel('Hansen stopped'); const disposal = run.dispose()
    released.resolve({ id: 'late-child', result: Promise.resolve({ output: [], stopReason: 'aborted' }),
      dispose: async () => { cleanup++ } } as unknown as SubagentRun)
    expect((await run.result).stopReason).toBe('cancelled')
    await disposal; await run.dispose()
    expect(f.calls[0]!.request.signal.aborted).toBe(true); expect(cleanup).toBe(1)
    expect(f.events.filter(event => event.name === 'workflow/agent-start')).toHaveLength(0)
  })
  it('bounds disposal with a noncooperative pending start and still cleans a later fulfillment', async () => {
    const began = Promise.withResolvers<void>(); const released = Promise.withResolvers<SubagentRun>()
    const cleaned = Promise.withResolvers<void>(); let cleanup = 0
    const f = await fixture(async () => { began.resolve(); return released.promise })
    const run = f.run("return await agent('late startup')")
    await began.promise
    const start = Date.now(); await run.dispose(); expect(Date.now() - start).toBeLessThan(1500)
    expect((await run.result).stopReason).toBe('cancelled')
    released.resolve({ id: 'late-after-disposal', result: Promise.resolve({ output: [], stopReason: 'aborted' }),
      dispose: async () => { cleanup++; cleaned.resolve() } } as unknown as SubagentRun)
    await cleaned.promise; expect(cleanup).toBe(1)
    expect(f.events.filter(event => event.name === 'workflow/agent-start')).toHaveLength(0)
  })
  it('cancellation before helper readiness prevents the initial synchronous script body', async () => {
    const f = await fixture(); const controller = new AbortController()
    f.root.on('workflow/start', () => controller.abort())
    const run = f.run("log('must-not-execute');return true", hansen, { signal: controller.signal })
    expect((await run.result).stopReason).toBe('cancelled'); await run.dispose()
    expect(f.events.filter(event => event.name === 'workflow/log')).toHaveLength(0)
  })
  it('pairs a published child exactly once on cancellation and forwards its one canonical signal', async () => {
    const ended = Promise.withResolvers<unknown>(); const narrated = Promise.withResolvers<void>(); let cleanup = 0
    const f = await fixture(async (_provider, request) => {
      request.signal.addEventListener('abort', () => ended.resolve({ output: [], stopReason: 'aborted' }), { once: true })
      return { id: 'published-child', result: ended.promise,
        dispose: async () => { cleanup++; ended.resolve({ output: [], stopReason: 'aborted' }) } } as unknown as SubagentRun
    })
    f.root.on('workflow/agent-start', () => narrated.resolve())
    const run = f.run("return await agent('wait for cancel')")
    await narrated.promise; run.cancel('Hansen cancelled'); await run.dispose()
    expect((await run.result).stopReason).toBe('cancelled'); expect(cleanup).toBe(1)
    expect(f.calls[0]!.request.signal.aborted).toBe(true)
    expect(f.events.filter(event => event.name === 'workflow/agent-start')).toHaveLength(1)
    expect(f.events.filter(event => event.name === 'workflow/agent-end')).toHaveLength(1)
  })
  it.each([
    `await send({kind:'child-start',call:1,request:{prompt:[{type:'text',text:'x'}],parent:{id:'Alex'}}});`,
    `await send({kind:'event',event:'workflow/agent-start',value:{seq:1,label:'fake',childId:'Alex'}});`,
    `await send({kind:'result',result:{value:true,stopReason:'completed',agentsStarted:999}});`,
  ])('rejects hostile authority or result claims without host child side effects', async attack => {
    const f = await fixture(undefined, attack)
    expect((await f.run('return true').result).stopReason).toBe('error')
    expect(f.calls).toHaveLength(0)
  })
  it('admits a repeated transport call at most once and denies calls after settlement', async () => {
    const f = await fixture(undefined, `
      const request={prompt:[{type:'text',text:'Hansen allowed'}]};
      await send({kind:'child-start',call:1,request});await input.next();
      await send({kind:'child-start',call:1,request});
      await send({kind:'result',result:{value:true,stopReason:'completed',agentsStarted:1}});
      await send({kind:'child-start',call:2,request});`)
    const run = f.run('return true'); expect((await run.result).stopReason).toBe('completed'); await run.dispose()
    expect(f.calls).toHaveLength(1); expect(f.disposed).toHaveLength(1)
  })
})
