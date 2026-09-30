import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { availableParallelism } from 'node:os'
import { isAbsolute } from 'node:path'
import { Script } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import NativeWorkflow, { validateMeta, type Config } from '@deepseek-ai/dsh-workflow-worker-thread'
import { WorkflowError, WorkflowRunId, type WorkflowRun, type WorkflowStartRequest, type WorkflowResult,
  type WorkflowAgentInfo, type WorkflowEventName } from '@deepseek-ai/dsh-workflow'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ManagedHarnessExecutionDomain } from './managed-subprocess.js'
import { managedJsonWriter, readManagedJson, snapshotManagedJson, type JsonData } from './managed-json-pipe.js'

const require = createRequire(import.meta.url)
const version = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-workflow-worker-thread/package.json'), 'utf8')) as { version: string }
const helperProgram = `import{createRequire}from'node:module';import{realpath}from'node:fs/promises';
import{pathToFileURL}from'node:url';const r=createRequire(await realpath(process.argv[1]));
await(await import(pathToFileURL(r.resolve('@paimind/harness-compat/managed-workflow')).href)).runManagedHarnessWorkflowOperation();`
type Data = { [key: string]: JsonData }
function object(value: unknown): value is Data { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function fields(value: Data, keys: string[]) { return Object.keys(value).every(key => keys.includes(key)) }
function rendered(error: unknown) { return error instanceof Error ? error.message : String(error) }
function positiveId(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0 }
function within(promise: Promise<unknown>, ms: number) {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([promise, new Promise<void>(resolve => { timer = setTimeout(resolve, ms) })])
    .finally(() => clearTimeout(timer))
}

export interface ManagedHarnessWorkflowOptions {
  executionWorld: Pick<ManagedHarnessExecutionDomain, 'nodeExecutable' | 'moduleAnchor' | 'lookupCwd'>
  /** Bounds helper readiness, not the native workflow's legitimate lifetime. */
  startupTimeoutMs?: number
}

/** Placement adapter over the original workflow engine. Only data and opaque
 * per-run child handles cross the pipe. Real Agent/Session ownership, provider
 * selection and every actual child start remain on the original host seam.
 * This isolated factory alone does not install a preset or admit a member. */
export function createManagedHarnessWorkflowProvider(options: ManagedHarnessWorkflowOptions): typeof NativeWorkflow {
  assert.equal(version.version, '0.1.1-rc.2', 'Unsupported native workflow contract')
  const world = Object.freeze({ ...options.executionWorld })
  assert.ok(isAbsolute(world.nodeExecutable) && isAbsolute(world.moduleAnchor) && isAbsolute(world.lookupCwd))
  const startupMs = options.startupTimeoutMs ?? 10_000
  assert.ok(Number.isSafeInteger(startupMs) && startupMs > 0 && startupMs <= 2_147_483_647)
  return class ManagedHarnessWorkflowEngine extends NativeWorkflow {
    static inject = ['subagents', 'subprocess', 'sandbox', 'sandboxPolicy']
    private withdrawn = false
    private readonly managedConfig: Required<Config>
    constructor(ctx: Context, config: Config) {
      super(ctx, config)
      this.managedConfig = Object.freeze({ ...config }) as Required<Config>
      assert.ok(this.managedConfig.disposeGraceMs <= 2_147_482_647, 'Managed workflow grace exceeds the native timer range')
      // Native workflow runs are holder-owned. Unloading this engine removes
      // new-start authority, not a holder's already accepted run or children.
      ctx.effect(() => () => { this.withdrawn = true }, 'managed workflow start authority')
    }
    override start(request: WorkflowStartRequest): WorkflowRun {
      assert.ok(!this.withdrawn, 'Managed workflow engine has been withdrawn')
      const meta = validateMeta(request.meta)
      // Parse only, never execute model text on the host. The published seam
      // requires a synchronous parse error before any run/start notification.
      if (/^\s*export\s+const\s+meta\b/u.test(request.script)) throw new WorkflowError(
        'workflow meta belongs in the meta request field, not the script body', 'SCRIPT_PARSE')
      try { new Script(`(async () => {\n${request.script}\n})()`, { filename: `workflow:${meta.name}`, lineOffset: -1 }) }
      catch (error) { throw new WorkflowError(`workflow script does not parse: ${String(error)}`, 'SCRIPT_PARSE', { cause: error }) }
      const config = this.managedConfig
      const provider = request.subagentProvider ?? config.provider
      if (typeof provider !== 'string' || !provider || provider !== provider.trim()) throw new WorkflowError(
        'workflow subagentProvider must be a non-empty normalized string', 'INVALID_ARGUMENT')
      const subagents = this.ctx.subagents // capture the native holder-bound handle
      const logger = this.ctx.logger
      if (subagents.getProvider(provider) === undefined) throw new WorkflowError(`no subagent provider registered for "${provider}"`, 'AGENT_START')
      const total = request.maxTotalAgents ?? config.maxTotalAgents
      if (!positiveId(total) || total > config.maxTotalAgents) throw new WorkflowError(
        'workflow maxTotalAgents must be a positive safe integer within the engine ceiling', 'INVALID_ARGUMENT')
      const concurrency = config.maxConcurrentAgents || Math.min(16, Math.max(1, availableParallelism() - 2))
      const data = snapshotManagedJson({ script: request.script, meta,
        ...(request.args !== undefined ? { args: request.args } : {}), config: { ...config, provider, maxTotalAgents: total,
          maxConcurrentAgents: concurrency } })
      const parent = request.parent // never serialize or accept a replacement from the child
      const info = { id: WorkflowRunId(randomUUID()), meta }
      const result = Promise.withResolvers<WorkflowResult>()
      const controller = new AbortController()
      const children = new Map<number, { run: SubagentRun; ended: boolean; disposal?: Promise<void> }>()
      const pending = new Set<Promise<void>>()
      const published = new Set<string>()
      const narrated = new Set<string>()
      const starts = new Map<number, WorkflowAgentInfo>()
      const callIds = new Set<number>()
      const sequences = new Set<number>()
      let activeStarts = 0; let terminal = false; let ready = false
      let cancelReason: string | undefined
      let grace: ReturnType<typeof setTimeout> | undefined
      let startup: ReturnType<typeof setTimeout> | undefined
      let send: ReturnType<typeof managedJsonWriter> | undefined
      let terminate = () => {}
      let done = Promise.resolve()
      let disposal: Promise<void> | undefined
      const emit = (name: WorkflowEventName, ...payload: unknown[]) => this.emitWorkflowEvent(name, info, ...payload)
      const release = (call: number, record: NonNullable<ReturnType<typeof children.get>>) => record.disposal ??=
        Promise.resolve().then(() => record.run.dispose()).catch(error => {
          logger.warn(`Managed workflow child disposal failed: ${rendered(error)}`)
        }).finally(() => { children.delete(call) })
      const cleanupChildren = () => {
        controller.abort(cancelReason ?? 'workflow settled')
        for (const [call, record] of children) void release(call, record)
      }
      const settle = (outcome: WorkflowResult) => {
        if (terminal) return
        terminal = true // claim before reentrant cancellation/child teardown
        clearTimeout(grace); clearTimeout(startup)
        request.signal?.removeEventListener('abort', onAbort)
        cleanupChildren()
        for (const item of starts.values()) emit('workflow/agent-end', { ...item, outcome: 'cancelled' })
        starts.clear()
        const final = cancelReason === undefined ? outcome : { value: null, stopReason: 'cancelled' as const,
          error: `workflow run cancelled: ${cancelReason}`, agentsStarted: outcome.agentsStarted }
        result.resolve(final)
        emit('workflow/end', { stopReason: final.stopReason, agentsStarted: final.agentsStarted,
          ...(final.error === undefined ? {} : { error: final.error }) })
      }
      const failure = (message: string) => settle({ value: null, stopReason: 'error', error: message, agentsStarted: callIds.size })
      const cancel = (reason?: string) => {
        if (terminal || cancelReason !== undefined) return
        cancelReason = reason ?? 'workflow cancelled'
        controller.abort(cancelReason)
        if (ready) void send?.({ kind: 'cancel', reason: cancelReason }).catch(() => terminate())
        grace = setTimeout(() => { failure('workflow cancellation grace reached'); terminate() }, config.disposeGraceMs)
      }
      const onAbort = () => cancel('workflow signal aborted')
      const run: WorkflowRun = { id: info.id, meta, result: result.promise, cancel,
        dispose: () => disposal ??= (async () => {
          cancel('workflow disposed'); cleanupChildren()
          await within(Promise.all([result.promise, ...pending, ...[...children.entries()].map(([id, record]) => release(id, record))]), config.disposeGraceMs)
          if (!terminal) failure('workflow disposal grace reached')
          terminate(); await done
        })() }
      if (request.signal?.aborted) {
        emit('workflow/start'); cancel('workflow start signal already aborted'); failure('workflow cancelled'); return run
      }
      const argv = [world.nodeExecutable, '--input-type=module', '-e', helperProgram, world.moduleAnchor]
      // Workflow has an explicit native parent; its immutable Session cwd is
      // the execution root, not this provider realm's agentless fallback.
      const policy = this.ctx.sandboxPolicy.resolve({ session: parent.session })
      const confined = policy.mode === 'danger-full-access' ? undefined : this.ctx.sandbox.confine(argv, { ...policy, mode: policy.mode })
      assert.ok(!confined || confined.enforcement === 'full', 'Native workflow execution must be fully confined')
      const handle = this.ctx.subprocess.spawn({ argv: confined?.argv ?? argv, cwd: world.lookupCwd, graceMs: 1000,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 4096 } } })
      send = managedJsonWriter(handle.stdin!); terminate = () => handle.terminate()
      handle.stdin!.on('error', terminate)
      startup = setTimeout(() => { failure('Managed workflow helper did not become ready'); terminate() }, startupMs)
      request.signal?.addEventListener('abort', onAbort, { once: true })
      const transmit = (message: unknown) => send!(message).catch(() => { failure('Managed workflow pipe closed'); terminate() })
      const startChild = (call: number, payload: Data) => {
        assert.ok(fields(payload, ['prompt', 'outputSchema', 'agentOptions']) && Array.isArray(payload.prompt)
          && payload.prompt.length === 1 && object(payload.prompt[0]) && fields(payload.prompt[0], ['type', 'text'])
          && payload.prompt[0].type === 'text' && typeof payload.prompt[0].text === 'string' && payload.prompt[0].text.trim(),
        'Invalid workflow child prompt')
        if (payload.outputSchema !== undefined) assertObjectJsonSchema(payload.outputSchema)
        if (payload.agentOptions !== undefined) assert.ok(object(payload.agentOptions)
          && fields(payload.agentOptions, ['provider', 'model']) && Object.values(payload.agentOptions).every(value => typeof value === 'string' && value.trim()),
        'Invalid workflow child model selection')
        if (terminal) return
        if (controller.signal.aborted) { void transmit({ kind: 'child-rejected', call, message: 'workflow child admission closed' }); return }
        if (callIds.has(call)) return
        assert.ok(callIds.size < total && activeStarts + [...children.values()].filter(row => !row.ended).length < concurrency,
          'Managed workflow child limit exceeded')
        callIds.add(call); activeStarts++
        const task = (async () => {
          let child: SubagentRun
          try {
            child = await subagents.start(provider, { ...payload, parent, signal: controller.signal } as unknown as SubagentStartRequest)
          } catch (error) {
            if (!terminal) await transmit({ kind: 'child-rejected', call, message: rendered(error) })
            return
          } finally { activeStarts-- }
          const record = { run: child, ended: false }; children.set(call, record)
          const childResult = child.result.then(value => {
            record.ended = true
            return { kind: 'child-result', call, result: snapshotManagedJson({ output: value.output, stopReason: value.stopReason,
              ...(value.structured === undefined ? {} : { structured: value.structured }) }) }
          }).catch(error => { record.ended = true; return { kind: 'child-failed', call, message: rendered(error) } })
          if (terminal || controller.signal.aborted) { await release(call, record); return }
          published.add(child.id)
          await transmit({ kind: 'child-open', call, id: child.id })
          void childResult.then(value => { if (!terminal) return transmit(value) })
        })()
        pending.add(task); void task.finally(() => pending.delete(task)).catch(() => { failure('Managed child relay failed'); terminate() })
      }
      emit('workflow/start')
      if (request.signal?.aborted) onAbort()
      done = (async () => {
        try {
          await transmit({ kind: 'run', data, ...(cancelReason === undefined ? {} : { cancelled: cancelReason }) })
          for await (const message of readManagedJson(handle.stdout!)) {
            if (terminal) break
            assert.ok(object(message) && typeof message.kind === 'string', 'Invalid workflow message')
            if (message.kind === 'ready') {
              assert.ok(!ready && fields(message, ['kind']), 'Duplicate workflow readiness')
              ready = true; clearTimeout(startup)
              await transmit({ kind: 'go', ...(cancelReason === undefined ? {} : { cancelled: cancelReason }) })
              continue
            }
            assert.ok(ready, 'Workflow message before readiness')
            if (message.kind === 'cancel-children') {
              assert.ok(fields(message, ['kind'])); cleanupChildren(); continue
            }
            if (message.kind === 'child-start') {
              assert.ok(fields(message, ['kind', 'call', 'request']) && positiveId(message.call) && object(message.request))
              startChild(message.call, message.request); continue
            }
            if (message.kind === 'child-dispose') {
              assert.ok(fields(message, ['kind', 'call']) && positiveId(message.call) && callIds.has(message.call))
              const call = message.call; const record = children.get(call)
              void (record ? release(call, record) : Promise.resolve()).then(() => {
                if (!terminal) return transmit({ kind: 'child-disposed', call })
              }); continue
            }
            if (message.kind === 'event') {
              assert.ok(fields(message, ['kind', 'event', 'value']) && typeof message.event === 'string')
              if (message.event === 'workflow/phase' || message.event === 'workflow/log') {
                assert.equal(typeof message.value, 'string')
                if (!controller.signal.aborted) emit(message.event, message.value)
                continue
              }
              const value = message.value
              assert.ok(object(value) && fields(value, ['seq', 'label', 'phase', 'childId', 'outcome']) && positiveId(value.seq)
                && typeof value.label === 'string' && typeof value.childId === 'string'
                && (value.phase === undefined || typeof value.phase === 'string'))
              if (message.event === 'workflow/agent-start') {
                assert.ok(value.outcome === undefined && published.has(value.childId) && !narrated.has(value.childId) && !sequences.has(value.seq))
                const item = { seq: value.seq, label: value.label, childId: value.childId,
                  ...(value.phase === undefined ? {} : { phase: value.phase }) } as WorkflowAgentInfo
                starts.set(item.seq, item); sequences.add(item.seq); narrated.add(item.childId); emit('workflow/agent-start', item)
              } else {
                assert.equal(message.event, 'workflow/agent-end')
                const item = starts.get(value.seq)
                assert.ok(item && item.childId === value.childId && item.label === value.label && item.phase === value.phase
                  && ['completed', 'failed', 'cancelled'].includes(String(value.outcome)))
                starts.delete(value.seq); emit('workflow/agent-end', { ...item, outcome: value.outcome })
              }
              continue
            }
            assert.ok(message.kind === 'result' && fields(message, ['kind', 'result']) && object(message.result))
            const value = message.result
            assert.ok(fields(value, ['value', 'stopReason', 'error', 'agentsStarted']) && Object.hasOwn(value, 'value')
              && ['completed', 'cancelled', 'error'].includes(String(value.stopReason)) && Number.isSafeInteger(value.agentsStarted)
              && (value.agentsStarted as number) >= callIds.size && (value.agentsStarted as number) <= total
              && (value.stopReason === 'completed' ? value.error === undefined : typeof value.error === 'string' && value.value === null))
            settle(value as unknown as WorkflowResult)
          }
          if (!terminal) failure('Managed workflow helper exited before completion')
        } catch { failure('Managed workflow transport failed') }
        finally {
          clearTimeout(startup); clearTimeout(grace); request.signal?.removeEventListener('abort', onAbort)
          cleanupChildren(); handle.stdin!.destroy(); handle.terminate(); await handle.waitForExit()
          handle.stdin!.off('error', terminate)
        }
      })()
      void done.catch(() => failure('Managed workflow cleanup failed'))
      return run
    }
  }
}

/** Internal native-engine helper. The guarded marker is NOT an Agent replica:
 * this exact upstream version only carries it to the child-start bridge, which
 * discards it. The actual host request always restores its retained live parent.
 * Any new upstream attempt to inspect the marker fails closed. */
export async function runManagedHarnessWorkflowOperation(): Promise<void> {
  assert.equal(version.version, '0.1.1-rc.2')
  const root = new Context(); const send = managedJsonWriter(process.stdout)
  const input = readManagedJson(process.stdin)[Symbol.asyncIterator]()
  const abort = new AbortController()
  const marker = new Proxy(Object.create(null) as object, { get() { throw Error('Workflow parent reference cannot be inspected in the execution domain') } }) as Agent
  const pending = new Map<number, { opened: ReturnType<typeof Promise.withResolvers<string>>;
    result: ReturnType<typeof Promise.withResolvers<unknown>>; disposed: ReturnType<typeof Promise.withResolvers<void>> }>()
  let call = 0; let run: WorkflowRun | undefined; let completion: Promise<void> | undefined
  let childSignal: AbortSignal | undefined
  const cancelled = () => { void send({ kind: 'cancel-children' }).catch(() => abort.abort()) }
  process.stdout.on('error', () => abort.abort())
  try {
    const first = (await input.next()).value
    assert.ok(object(first) && first.kind === 'run' && object(first.data) && object(first.data.config))
    const data = first.data
    assert.ok(object(data.config))
    if (first.cancelled !== undefined) abort.abort(first.cancelled)
    root.provide('subagents', {
      getProvider: (provider: string) => provider === (data.config as Data).provider ? {} : undefined,
      start: async (provider: string, request: SubagentStartRequest) => {
        assert.equal(provider, (data.config as Data).provider); assert.equal(request.parent, marker)
        const id = ++call
        const record = { opened: Promise.withResolvers<string>(), result: Promise.withResolvers<unknown>(), disposed: Promise.withResolvers<void>() }
        pending.set(id, record)
        // Observe immediately: a close/rejection can arrive before publication.
        void record.opened.promise.catch(() => undefined); void record.result.promise.catch(() => undefined); void record.disposed.promise.catch(() => undefined)
        if (childSignal === undefined) {
          childSignal = request.signal; childSignal.addEventListener('abort', cancelled, { once: true })
          if (childSignal.aborted) cancelled()
        } else assert.equal(childSignal, request.signal, 'Native workflow must keep one canonical child signal')
        await send({ kind: 'child-start', call: id, request: { prompt: request.prompt,
          ...(request.outputSchema === undefined ? {} : { outputSchema: request.outputSchema }),
          ...(request.agentOptions === undefined ? {} : { agentOptions: request.agentOptions }) } })
        const childId = await record.opened.promise
        return { id: childId, result: record.result.promise,
          dispose: async () => { await send({ kind: 'child-dispose', call: id }); await record.disposed.promise } }
      },
    } as unknown as Context['subagents'])
    for (const event of ['workflow/phase', 'workflow/log', 'workflow/agent-start', 'workflow/agent-end'] as const) {
      root.on(event, (_info: unknown, value: unknown) => { void send({ kind: 'event', event, value }).catch(() => abort.abort()) })
    }
    await root.plugin(NativeWorkflow, data.config)
    await send({ kind: 'ready' })
    const go = (await input.next()).value
    assert.ok(object(go) && go.kind === 'go')
    if (go.cancelled !== undefined) abort.abort(go.cancelled)
    run = root.workflowEngine.start({ script: data.script as string, meta: data.meta as never,
      ...(data.args === undefined ? {} : { args: data.args }), parent: marker, signal: abort.signal })
    completion = run.result.then(async result => { await send({ kind: 'result', result }) })
    void completion.catch(() => abort.abort())
    for (;;) {
      const step = await input.next(); if (step.done) break
      const message = step.value; assert.ok(object(message))
      if (message.kind === 'cancel') { run.cancel(String(message.reason)); continue }
      assert.ok(positiveId(message.call))
      const record = pending.get(message.call); if (!record) continue
      if (message.kind === 'child-open') { assert.equal(typeof message.id, 'string'); record.opened.resolve(message.id as string) }
      else if (message.kind === 'child-rejected') record.opened.reject(Error(String(message.message)))
      else if (message.kind === 'child-result') record.result.resolve(message.result)
      else if (message.kind === 'child-failed') record.result.reject(Error(String(message.message)))
      else if (message.kind === 'child-disposed') { record.disposed.resolve(); pending.delete(message.call) }
      else throw Error('Invalid native workflow reply')
    }
  } finally {
    childSignal?.removeEventListener('abort', cancelled)
    abort.abort('workflow helper closed')
    for (const record of pending.values()) {
      record.opened.reject(Error('workflow helper closed')); record.result.reject(Error('workflow helper closed')); record.disposed.resolve()
    }
    await run?.dispose(); await root.fiber.dispose(); await completion?.catch(() => undefined)
  }
}
