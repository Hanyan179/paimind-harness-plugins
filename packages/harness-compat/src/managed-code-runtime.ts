import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { WorkerThreadCodeRuntime, type Config } from '@deepseek-ai/dsh-code-runtime-worker-thread'
import type { CodeRuntime, CodeRunRequest, CodeRunResult, CodeRunFailure, CodeBindingFunction } from '@deepseek-ai/dsh-code-runtime'
import type {} from '@deepseek-ai/dsh-agent'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { ManagedHarnessExecutionDomain } from './managed-subprocess.js'
import { managedJsonBytes, managedJsonWriter, readManagedJson, snapshotManagedJson, type JsonData } from './managed-json-pipe.js'

const require = createRequire(import.meta.url)
const nativeVersion = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-code-runtime-worker-thread/package.json'), 'utf8')) as { version: string }
const kinds = new Set(['exception', 'timeout', 'abort', 'worker-exit', 'invalid-output', 'output-limit'])
const helperProgram = `import{createRequire}from'node:module';import{realpath}from'node:fs/promises';
import{pathToFileURL}from'node:url';const r=createRequire(await realpath(process.argv[1]));
const m=await import(pathToFileURL(r.resolve('@paimind/harness-compat/managed-code-runtime')).href);
await m.runManagedHarnessCodeOperation();`
const preflightAbort = AbortSignal.abort('managed native binding validation only')
type ObjectData = { [key: string]: JsonData }
function object(value: unknown): value is ObjectData { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function only(value: ObjectData, names: string[]) { return Object.keys(value).every(key => names.includes(key)) }
function reason(error: unknown) { return error instanceof Error ? error.message : String(error) }

export interface ManagedHarnessCodeOptions {
  executionWorld: Pick<ManagedHarnessExecutionDomain, 'nodeExecutable' | 'moduleAnchor' | 'lookupCwd'>
  /** Helper initialization bound, before the native program wall budget starts. */
  startupTimeoutMs?: number
}
export interface ManagedHarnessCodeConstructor {
  new(ctx: Context, config: Config): CodeRuntime
  readonly Config: typeof WorkerThreadCodeRuntime.Config
  readonly inject: readonly string[]
}

/** The original thread implementation runs in a fresh managed native process.
 * Native code parsing, budgets, error classes and binding semantics remain its
 * responsibility. This adapter owns only placement, hostile pipe admission and
 * joining the native process tree. No Agent, Session or tool dispatcher lives
 * here. Installing this slice alone does not grant enterprise admission. */
export function createManagedHarnessCodeProvider(options: ManagedHarnessCodeOptions): ManagedHarnessCodeConstructor {
  assert.equal(nativeVersion.version, '0.1.1-rc.2', 'Unsupported native Code Runtime contract')
  // Reuse this exact version's bounded failure formatter even during native
  // disposal. No copied output ledger or changed minimum-budget semantics.
  const nativeFailure = Reflect.get(WorkerThreadCodeRuntime.prototype, 'failureBeforeWorker') as
    (failure: CodeRunFailure) => CodeRunResult
  assert.equal(typeof nativeFailure, 'function', 'Native bounded failure formatter unavailable')
  const world = Object.freeze({ ...options.executionWorld })
  assert.ok(isAbsolute(world.nodeExecutable) && isAbsolute(world.moduleAnchor) && isAbsolute(world.lookupCwd))
  const startupMs = options.startupTimeoutMs ?? 10_000
  assert.ok(Number.isSafeInteger(startupMs) && startupMs > 0 && startupMs <= 2_147_483_647)
  return class ManagedHarnessCodeRuntime extends WorkerThreadCodeRuntime {
    static inject = ['subprocess', 'sandbox', 'sandboxPolicy']
    private withdrawn = false
    private readonly managedConfig: Config
    private readonly operations = new Set<{ abort: AbortController; done: Promise<void> }>()
    constructor(ctx: Context, config: Config) {
      super(ctx, config)
      this.managedConfig = Object.freeze({ ...config })
      // The native worker remains inside; the public seam descriptor describes
      // the outer execution placement, not a standalone security certification.
      Object.defineProperty(this, 'isolation', { value: 'process', writable: false, configurable: false })
      ctx.effect(() => async () => {
        this.withdrawn = true
        const live = [...this.operations]
        for (const operation of live) operation.abort.abort('runtime disposed')
        await Promise.all(live.map(operation => operation.done))
      }, 'managed native code process lifetime')
    }
    override async run(request: CodeRunRequest): Promise<CodeRunResult> {
      assert.ok(!this.withdrawn, 'Managed Code Runtime has been withdrawn')
      // The published native contract validates binding declarations BEFORE
      // checking an already-aborted signal, which guarantees no local worker.
      // Keep native rejection behavior instead of maintaining duplicate rules.
      if (request.signal?.aborted) return super.run(request)
      await super.run({ ...request, signal: preflightAbort })
      assert.ok(!this.withdrawn, 'Managed Code Runtime has been withdrawn')
      if (request.signal?.aborted) return super.run(request)
      const bindings = new Map<string, Map<string, CodeBindingFunction>>()
      const declarations = request.bindings.map(namespace => {
        const functions = new Map(Object.keys(namespace.functions).map(name => [name, namespace.functions[name]!]))
        bindings.set(namespace.global, functions)
        return { global: namespace.global, names: [...functions.keys()],
          ...(namespace.errorClass ? { errorClass: { ...namespace.errorClass } } : {}) }
      })
      const abort = new AbortController()
      const cancel = () => abort.abort(request.signal?.reason)
      request.signal?.addEventListener('abort', cancel, { once: true })
      if (request.signal?.aborted) cancel()
      let finish!: () => void
      const done = new Promise<void>(resolve => { finish = resolve })
      const operation = { abort, done }; this.operations.add(operation)
      const fail = (kind: CodeRunFailure['kind'], message: string) => nativeFailure.call(this, { kind, message })
      try {
        if (abort.signal.aborted) return fail('abort', String(abort.signal.reason))
        const command = [world.nodeExecutable, '--input-type=module', '-e', helperProgram, world.moduleAnchor]
        // CodeRunRequest is intentionally session-free. Use the original
        // native driver's asynchronous initiator boundary, never a guessed
        // session from bindings/program text or the provider's shared context.
        // Attribution alone is not authority: an inherited stale Agent denies.
        const agents = this.ctx.get('agents')
        const initiator = agents?.currentInitiator()
        assert.ok(!initiator || agents?.get(initiator.id) === initiator, 'Native code initiator is no longer live')
        const policy = this.ctx.sandboxPolicy.resolve(initiator ? { session: initiator.session } : undefined)
        const confined = policy.mode === 'danger-full-access' ? undefined : this.ctx.sandbox.confine(command, { ...policy, mode: policy.mode })
        assert.ok(!confined || confined.enforcement === 'full', 'Native code execution must be fully confined')
        const handle = this.ctx.subprocess.spawn({ argv: confined?.argv ?? command, cwd: world.lookupCwd,
          graceMs: 1000, stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 4096 } } })
        const send = managedJsonWriter(handle.stdin!)
        let accepting = true; let ready = false; let deadline = false
        let timer = setTimeout(() => { deadline = true; handle.terminate() }, startupMs)
        let abortFallback: ReturnType<typeof setTimeout> | undefined
        const terminate = () => handle.terminate()
        handle.stdin!.on('error', terminate)
        const stop = () => {
          if (!accepting) return
          void send({ kind: 'abort', reason: String(abort.signal.reason) }).catch(terminate)
          abortFallback ??= setTimeout(terminate, 1000)
        }
        abort.signal.addEventListener('abort', stop, { once: true })
        const answered = new Set<number>()
        try {
          await send({ kind: 'run', program: request.program, declarations, config: this.managedConfig })
          if (abort.signal.aborted) stop()
          for await (const message of readManagedJson(handle.stdout!)) {
            assert.ok(object(message) && typeof message.kind === 'string', 'Invalid code transport message')
            if (deadline) return fail('timeout', 'Managed code process deadline reached')
            if (message.kind === 'ready') {
              assert.ok(!ready && only(message, ['kind']), 'Duplicate code readiness')
              ready = true; clearTimeout(timer)
              timer = setTimeout(() => { deadline = true; handle.terminate() }, Math.min(2_147_483_647, this.managedConfig.maxWallMs! + 1000))
              continue
            }
            assert.ok(ready, 'Code message before readiness')
            if (message.kind === 'call') {
              assert.ok(only(message, ['kind', 'id', 'global', 'name', 'args']) && Number.isSafeInteger(message.id)
                && (message.id as number) > 0 && typeof message.global === 'string' && typeof message.name === 'string'
                && Object.hasOwn(message, 'args'), 'Invalid code binding call')
              const id = message.id as number
              if (answered.has(id)) continue
              answered.add(id)
              if (abort.signal.aborted) continue
              const fn = bindings.get(message.global)?.get(message.name)
              // Never resolve prototype members or a new capability from the
              // child-supplied name. Binding functions belong to this request.
              void (async () => {
                let reply: unknown
                try {
                  if (typeof fn !== 'function') throw Error(`unknown binding ${JSON.stringify(`${message.global}.${message.name}`)}`)
                  const resolved = await fn(message.args)
                  let value: JsonData
                  try { value = snapshotManagedJson(resolved) }
                  catch { throw Error('binding resolution must be lossless JSON') }
                  reply = { kind: 'reply', id, ok: true, value }
                } catch (error) { reply = { kind: 'reply', id, ok: false, message: reason(error) } }
                if (accepting && !abort.signal.aborted) await send(reply)
              })().catch(terminate)
              continue
            }
            assert.ok(message.kind === 'result' && only(message, ['kind', 'result']) && object(message.result), 'Invalid code result')
            const result = message.result
            assert.ok(only(result, ['logs', 'value', 'error']) && Array.isArray(result.logs)
              && result.logs.every(log => typeof log === 'string'), 'Invalid code logs')
            if (result.error !== undefined) assert.ok(object(result.error) && only(result.error, ['kind', 'message'])
              && typeof result.error.kind === 'string' && kinds.has(result.error.kind) && typeof result.error.message === 'string'
              && !Object.hasOwn(result, 'value'), 'Invalid code failure')
            accepting = false // claim settlement before asynchronous stream/tree cleanup
            const cap = this.managedConfig.maxOutputBytes!
            let bytes = managedJsonBytes(result.logs, cap)
            if (result.error !== undefined) bytes += managedJsonBytes((result.error as ObjectData).message!, cap - bytes)
            else if (Object.hasOwn(result, 'value')) bytes += managedJsonBytes(result.value!, cap - bytes)
            if (bytes > cap) return fail('output-limit', 'Managed code response exceeded the native output budget')
            if (abort.signal.aborted && !(object(result.error) && ['abort', 'output-limit'].includes(result.error.kind as string))) {
              return fail('abort', String(abort.signal.reason))
            }
            return result as unknown as CodeRunResult
          }
          return fail(abort.signal.aborted ? 'abort' : deadline ? 'timeout' : 'worker-exit',
            abort.signal.aborted ? String(abort.signal.reason) : deadline ? 'Managed code process deadline reached' : 'Managed code process exited before completion')
        } catch {
          return fail(abort.signal.aborted ? 'abort' : deadline ? 'timeout' : 'worker-exit',
            abort.signal.aborted ? String(abort.signal.reason) : deadline ? 'Managed code process deadline reached' : 'Managed code process transport failed')
        } finally {
          accepting = false; clearTimeout(timer); if (abortFallback) clearTimeout(abortFallback)
          abort.signal.removeEventListener('abort', stop)
          handle.stdin!.destroy(); handle.terminate(); await handle.waitForExit()
          handle.stdin!.off('error', terminate)
        }
      } catch {
        return fail(abort.signal.aborted ? 'abort' : 'worker-exit', abort.signal.aborted ? String(abort.signal.reason) : 'Managed code process could not start')
      } finally {
        request.signal?.removeEventListener('abort', cancel)
        this.operations.delete(operation); finish()
      }
    }
  }
}

/** Internal same-package helper entry, never an HTTP or Agent invocation API. */
export async function runManagedHarnessCodeOperation(): Promise<void> {
  const send = managedJsonWriter(process.stdout)
  const abort = new AbortController()
  const root = new Context()
  const pending = new Map<number, { resolve(value: JsonData): void; reject(reason: unknown): void }>()
  let nextId = 0; let running = false; let task: Promise<void> | undefined
  process.stdout.on('error', () => abort.abort('code output closed'))
  try {
    for await (const message of readManagedJson(process.stdin)) {
      assert.ok(object(message) && typeof message.kind === 'string')
      if (message.kind === 'run') {
        assert.ok(!running && typeof message.program === 'string' && Array.isArray(message.declarations) && object(message.config))
        running = true
        await root.plugin(WorkerThreadCodeRuntime, message.config)
        const bindings = message.declarations.map(row => {
          assert.ok(object(row) && typeof row.global === 'string' && Array.isArray(row.names) && row.names.every(name => typeof name === 'string'))
          const functions = Object.create(null) as Record<string, CodeBindingFunction>
          for (const name of row.names as string[]) Object.defineProperty(functions, name, { enumerable: true,
            value: async (args: unknown) => {
              if (abort.signal.aborted) throw Error('code run stopped')
              const id = ++nextId
              const result = new Promise<JsonData>((resolve, reject) => { pending.set(id, { resolve, reject }) })
              void send({ kind: 'call', id, global: row.global, name, args }).catch(error => { pending.get(id)?.reject(error); pending.delete(id) })
              return await result
            } })
          return { global: row.global, functions, ...(row.errorClass ? { errorClass: row.errorClass as never } : {}) }
        })
        await send({ kind: 'ready' })
        task = (async () => {
          try {
            const result = await root.codeRuntime.run({ program: message.program as string, bindings, signal: abort.signal })
            await send({ kind: 'result', result })
          } finally { process.stdin.destroy() }
        })()
        void task.catch(() => abort.abort('native code run failed'))
      } else if (message.kind === 'abort') abort.abort(message.reason)
      else {
        assert.ok(message.kind === 'reply' && Number.isSafeInteger(message.id))
        const waiter = pending.get(message.id as number)
        if (!waiter) continue
        pending.delete(message.id as number)
        if (message.ok === true && Object.hasOwn(message, 'value')) waiter.resolve(message.value!)
        else waiter.reject(new Error(String(message.message)))
      }
    }
  } catch (error) {
    if (!process.stdin.destroyed) throw error
  } finally {
    abort.abort('code helper closed')
    for (const waiter of pending.values()) waiter.reject(new Error('code helper closed'))
    pending.clear()
    await root.fiber.dispose(); await task
  }
}
