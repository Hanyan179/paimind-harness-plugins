import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { symbols, type Context } from '@deepseek-ai/cordis'
import type { ToolRuntime, ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'

interface Reference {
  readonly entryId: string | null
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  /** Ephemeral provider incarnation, not a persisted approval or permission. */
  readonly instanceId: string
}
type Call = Pick<ToolExecution, 'name' | 'agent'>
const failure = () => new Error('Native connector tool ownership is no longer current')
const original = (value: object): object => Reflect.get(value, symbols.original) ?? value
interface Capture { readonly reference: Readonly<Reference> | undefined; assertCurrent(): void }
const readers = new WeakMap<Context, { read(call: Call): Readonly<Reference> | undefined; capture(call: Call): Capture }>()
/** Observe the original registry's actual scoped definition, never a prefix,
 * caller-supplied ID or a second registry. Absence is NOT permission. */
export function readConnectorToolOrigin(root: Context, call: Call) {
  return readers.get(root)?.read(call)
}
export function captureConnectorToolOrigin(root: Context, call: Call) { return readers.get(root)?.capture(call) }

export function createConnectorToolOrigin(root: Context, NativeTools: typeof ToolRuntime): Readonly<{
  Tools: typeof ToolRuntime
  run<T>(context: Context, config: Record<string, unknown>, apply: () => Promise<T>): Promise<T>
  assertReady(): void
}> {
  assert.equal(root, root.root); assert.ok(!readers.has(root))
  type Entry = { readonly id: string; readonly disabled: boolean; readonly fiber?: { readonly ctx: Context } }
  type Owner = { readonly context: Context; readonly entry: Entry | undefined; readonly reference: Readonly<Reference>; live: boolean }
  const registration = new AsyncLocalStorage<Owner>(), runtimes = new WeakSet<object>()
  const definitions = new WeakMap<ToolDefinition, { owner: Owner; live: boolean; execute: ToolDefinition['execute'] }>()
  const executions = new WeakMap<Call, Capture>()
  let active = true
  const currentOwner = (owner: Owner) => {
    if (!active || !owner.live || owner.context.root !== root || owner.context.fiber.state !== 2
      // Loader stores a thenable Fiber handle, distinct from ctx.fiber. Its
      // exact original context is the stable identity, not a numeric UID.
      || owner.entry && (owner.entry.fiber?.ctx !== owner.context || owner.entry.disabled || owner.entry.id !== owner.reference.entryId)) throw failure()
  }
  const resolve = (call: Call) => {
    const tools = root.get('tools') as ToolRuntime | undefined
    if (!active || !tools || !runtimes.has(original(tools))) throw failure()
    return tools.get(call.name, call.agent)
  }
  const read = (call: Call) => {
    const definition = resolve(call), mark = definition && definitions.get(definition)
    if (!mark) return undefined
    currentOwner(mark.owner)
    if (!mark.live || definition!.execute !== mark.execute) throw failure()
    return mark.owner.reference
  }
  const reader = { read, capture(call: Call): Capture {
    const definition = resolve(call), reference = read(call)
    const capture = Object.freeze({ reference, assertCurrent() {
      const now = resolve(call)
      if ((reference || now && definitions.has(now)) && (now !== definition || read(call) !== reference)) throw failure()
    } })
    executions.set(call, capture)
    return capture
  } }
  readers.set(root, reader)
  root.effect(() => () => { active = false; if (readers.get(root) === reader) readers.delete(root) })
  class Tools extends NativeTools {
    constructor(context: Context, config: ConstructorParameters<typeof NativeTools>[1]) {
      super(context, config)
      assert.equal(context.root, root)
      runtimes.add(this); context.effect(() => () => { runtimes.delete(this) })
      // RC.2 resolves the body AFTER asynchronous around-dispatch wrappers.
      // Check exact definition identity at that last synchronous boundary;
      // do not let a later wrapper substitute a foreign same-name body.
      const dispatch = Reflect.get(NativeTools.prototype, 'dispatchToolBody')
      assert.equal(typeof dispatch, 'function')
      // Cordis proxies service methods per caller; a frozen data property is
      // incompatible with that proxy contract. Retain the caller's receiver.
      Object.defineProperty(this, 'dispatchToolBody', { configurable: true, value: function (this: ToolRuntime, execution: ToolExecution) {
        const capture = executions.get(execution); executions.delete(execution)
        if (capture) capture.assertCurrent()
        else if (read(execution)) throw failure()
        return dispatch.call(this, execution)
      } })
    }
    override register(definition: ToolDefinition) {
      const owner = registration.getStore()
      if (!owner) return super.register(definition)
      // The native provider's async startup/reconnect owns this exact context.
      // An unrelated nested plugin cannot borrow its registration provenance.
      if (!active || !owner.live || this.ctx.root !== root || this.ctx.fiber !== owner.context.fiber
        || !runtimes.has(original(this))) throw failure()
      const execute = definition.execute
      const wrapped: ToolDefinition = { ...definition, execute: async (args, execution) => {
        const current = () => {
          currentOwner(owner)
          if (!mark.live || resolve(execution) !== wrapped || wrapped.execute !== guardedExecute) throw failure()
          execution.signal.throwIfAborted()
        }
        current()
        const result = await execute.call(definition, args, execution)
        current()
        return result
      } }
      const mark = { owner, live: true, execute: wrapped.execute }, guardedExecute = mark.execute
      const dispose = super.register(wrapped)
      definitions.set(wrapped, mark)
      const release = this.ctx.effect(() => () => { mark.live = false })
      return () => { release(); dispose() }
    }
  }
  return Object.freeze({ Tools,
    async run<T>(context: Context, config: Record<string, unknown>, apply: () => Promise<T>): Promise<T> {
      if (!active || context.root !== root) throw failure()
      const entry = (context.fiber as unknown as { entry?: Entry }).entry
      if (entry && (typeof entry.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/u.test(entry.id))) throw failure()
      const reference = Object.freeze({ entryId: entry?.id ?? null, serverName: config.serverName as string,
        transport: config.transport as Reference['transport'], instanceId: randomUUID() })
      const owner: Owner = { context, entry, reference, live: true }
      context.effect(() => () => { owner.live = false })
      try { return await registration.run(owner, apply) }
      catch (error) { owner.live = false; throw error }
    },
    assertReady() {
      if (!active) throw failure()
      const tools = root.get('tools')
      if (tools && !runtimes.has(original(tools as object))) throw failure()
    },
  })
}
