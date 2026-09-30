import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { symbols, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { assertCommandOrigin, COMMAND_BINDING_HEADER, COMMAND_ORIGIN_HEADER, commandInvocationBinding, isNativeExportLine } from './command-execution.js'
import { executionScope, type ManagedHarnessOriginCheck } from './managed-origins.js'

// Internal structural imports supplied from the exact installed native profile.
// No additional service, HTTP route, registry, queue, log or business handler.
interface Route { kind: string; path: string; handler(req: IncomingMessage, res: ServerResponse): unknown }
interface WebServer { register(route: Route): () => void }
interface Definition { name: string; handler: (...args: any[]) => unknown; input?: unknown; recordInput?: boolean }
interface Commands {
  ctx: Context
  register(definition: Definition): () => void
  find(agent: Agent, name: string): Definition | undefined
  execute(agent: Agent, line: string, images: readonly unknown[], signal: AbortSignal): Promise<unknown>
}
type WebConstructor = new (ctx: Context, config: any) => WebServer
type CommandConstructor = new (ctx: Context) => Commands
type ExportModule = { apply(ctx: Context, config: any): unknown }
const original = (value: object): object => Reflect.get(value, symbols.original) ?? value
const denied = () => new Error('当前导出请求的登录来源、会话或权限无法确认，请重新登录后重试')

export function createManagedHarnessCommandProviders(root: Context, NativeWeb: WebConstructor, NativeCommands: CommandConstructor,
  exportModule: ExportModule, check: ManagedHarnessOriginCheck): {
    Web: WebConstructor; Commands: CommandConstructor; selectExport(plugin: unknown): unknown
    ownsWeb(value: object): boolean; ownsCommands(value: object): boolean
  } {
  assert.equal(root, root.root); assert.equal(typeof check, 'function'); assert.equal(typeof exportModule.apply, 'function')
  type Call = { source: string; binding: string; open: boolean; consumed: boolean; signal: AbortSignal }
  const calls = new AsyncLocalStorage<Call>(), registration = new AsyncLocalStorage<boolean>()
  const handlers = new WeakSet<Definition['handler']>(), webOwners = new WeakSet<object>(), commandOwners = new WeakSet<object>()
  const wrappers = new Map<object, unknown>(), lifetime = new AbortController()
  let active = true
  root.effect(() => () => { active = false; lifetime.abort() })
  class ManagedWeb extends NativeWeb {
    constructor(ctx: Context, config: any) {
      super(ctx, config); webOwners.add(this); ctx.effect(() => () => webOwners.delete(this))
    }
    override register(route: Route) {
      if (route.kind !== 'prefix' || route.path !== '/api') return super.register(route)
      const owner = this
      return super.register({ ...route, handler: async (request, response) => {
        if (request.url !== '/api/commands/execute') return route.handler(request, response)
        const sources = request.headersDistinct[COMMAND_ORIGIN_HEADER], bindings = request.headersDistinct[COMMAND_BINDING_HEADER]
        // Other native command policies remain unchanged outside this slice.
        // An export lacking this context is separately rejected by its owner.
        if (!sources && !bindings) return route.handler(request, response)
        const abort = new AbortController(), cancel = () => abort.abort()
        let call: Call | undefined
        try {
          if (!active || !webOwners.has(original(owner)) || request.method !== 'POST'
            || sources?.length !== 1 || bindings?.length !== 1 || !/^[a-f0-9]{64}$/u.test(bindings[0]!)) throw denied()
          assertCommandOrigin(sources[0]!)
          call = { source: sources[0]!, binding: bindings[0]!, open: true, consumed: false,
            signal: AbortSignal.any([abort.signal, lifetime.signal]) }
          request.once('aborted', cancel); response.once('close', cancel)
          return await calls.run(call, () => route.handler(request, response))
        } catch {
          if (!response.headersSent && !response.destroyed) response.writeHead(403, { 'cache-control': 'no-store' }).end('Command origin unavailable')
          else if (!response.destroyed) response.destroy()
        } finally {
          if (call) call.open = false
          abort.abort(); request.off('aborted', cancel); response.off('close', cancel)
        }
      } })
    }
  }
  class ManagedCommands extends NativeCommands {
    constructor(ctx: Context) {
      super(ctx); commandOwners.add(this); ctx.effect(() => () => commandOwners.delete(this))
    }
    override register(definition: Definition) {
      if (!registration.getStore()) return super.register(definition)
      assert.equal(definition.name, 'export'); assert.equal(definition.input, undefined)
      assert.equal(definition.recordInput, undefined); assert.equal(typeof definition.handler, 'function')
      const dispose = super.register(definition)
      const release = this.ctx.effect(() => { handlers.add(definition.handler); return () => handlers.delete(definition.handler) })
      return () => { release(); dispose() }
    }
    override async execute(agent: Agent, line: string, images: readonly unknown[], signal: AbortSignal): Promise<unknown> {
      const call = calls.getStore()
      if (!isNativeExportLine(line)) {
        if (call) throw denied()
        return super.execute(agent, line, images, signal)
      }
      const scope = executionScope(agent), definition = super.find(agent, 'export')
      const current = () => {
        if (!active || !commandOwners.has(original(this)) || !call?.open || calls.getStore() !== call
          || agent.ctx.root !== root || root.agents.get(agent.id) !== agent || scope.sessionId !== agent.id || !scope.presetId
          || executionScope(agent).presetId !== scope.presetId || images.length !== 0
          || commandInvocationBinding(call.source, scope.sessionId, line) !== call.binding
          || !definition || !handlers.has(definition.handler) || super.find(agent, 'export') !== definition) throw denied()
        signal.throwIfAborted(); call.signal.throwIfAborted()
      }
      current()
      if (call!.consumed) throw denied()
      call!.consumed = true
      const checkNow = async () => {
        current()
        const bound = AbortSignal.any([signal, call!.signal, AbortSignal.timeout(4000)])
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(denied())
          bound.addEventListener('abort', abort, { once: true })
          Promise.resolve().then(() => {
            bound.throwIfAborted()
            return check(Object.freeze({ nativeSessionId: scope.sessionId, presetId: scope.presetId!, sources: Object.freeze([call!.source]) }), bound)
          }).then(() => { if (bound.aborted) reject(denied()); else resolve() }, () => reject(denied()))
            .finally(() => bound.removeEventListener('abort', abort))
        })
        bound.throwIfAborted(); current()
      }
      await checkNow()
      // The pinned original Web export handler has no model/IO continuation:
      // native execution logs its request and settles immediately. Do not
      // extend this assumption to compact, plan, goal, feedback or permission.
      const result = await super.execute(agent, line, images, AbortSignal.any([signal, call!.signal]))
      await checkNow()
      return result
    }
  }
  return { Web: ManagedWeb, Commands: ManagedCommands,
    selectExport(plugin) {
      if (!plugin || typeof plugin !== 'object' || (plugin as ExportModule).apply !== exportModule.apply) return plugin
      if (!wrappers.has(plugin)) wrappers.set(plugin, { ...plugin, apply(ctx: Context, config: any) {
        if (!active) throw denied()
        return registration.run(true, () => exportModule.apply(ctx, config))
      } })
      return wrappers.get(plugin)
    },
    ownsWeb(value) { return active && webOwners.has(original(value)) },
    ownsCommands(value) { return active && commandOwners.has(original(value)) },
  }
}
