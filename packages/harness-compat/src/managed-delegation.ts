import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { isDeepStrictEqual } from 'node:util'
import { symbols, type Context } from '@deepseek-ai/cordis'
import { AgentRegistry, type Agent, type CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { SubagentRuntime, type SubagentStartRequest, type ContinuableStartSpec,
  type CoordinatorMessageSource, type SubagentFollowupOptions, type SubagentReportOptions } from '@deepseek-ai/dsh-subagent'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import { captureManagedHarnessOrigins, captureManagedHarnessTerminalOrigins, executionScope, type ManagedHarnessOrigins, type ManagedHarnessOriginCapture } from './managed-origins.js'
import { installManagedHarnessSettlements } from './managed-settlement.js'

export interface ManagedHarnessDelegationRequest extends ManagedHarnessOrigins { readonly targetSessionId: string }
export type ManagedHarnessOriginDerive = (input: ManagedHarnessDelegationRequest, signal: AbortSignal) =>
  Promise<{ readonly nativeSessionId: string; readonly sources: readonly string[] }>
type NativeProviderModule = { readonly apply: (context: Context, config: any) => unknown }
type SubagentProvider = Parameters<SubagentRuntime['registerProvider']>[0]
const failure = () => new Error('子任务委派来源或原生作用域无法确认，执行已停止')
const original = (value: object): object => Reflect.get(value, symbols.original) ?? value

/** One adapter over the original providers, registry, and creation transaction.
 * The bootstrap supplies exact installed in-process provider modules. Unknown
 * providers are refused before start: a remote start must not run first and be
 * discovered unguarded only after it returns. No child IDs/queue/history owner. */
export function createManagedHarnessDelegationProviders(root: Context, derive: ManagedHarnessOriginDerive,
  modules: readonly NativeProviderModule[]): {
    Agents: typeof AgentRegistry; Subagents: typeof SubagentRuntime
    selectProvider(plugin: unknown): unknown
    ownsAgents(service: AgentRegistry): boolean; ownsSubagents(service: SubagentRuntime): boolean
    ownsFollowup(agent: Agent, method: Agent['followup']): boolean
  } {
  assert.equal(root, root.root); assert.equal(typeof derive, 'function')
  assert.ok(modules.length && modules.every(module => typeof module.apply === 'function'))
  let active = true
  const lifetime = new AbortController(), registries = new WeakSet<object>(), runtimes = new WeakSet<object>()
  const enrolled = new WeakSet<object>(), registration = new AsyncLocalStorage<boolean>()
  type Delegation = { parent: Agent; capture: ManagedHarnessOriginCapture; prompt: ContentBlock[]; signal: AbortSignal;
    open: boolean; claimed: boolean; ready: boolean; accepted: boolean; child?: Agent; release?: () => void }
  const calls = new AsyncLocalStorage<Delegation>()
  type Delivery = Delegation & { targetSessionId: string; source: CoordinatorMessageSource; sources: readonly string[]; messageId?: string }
  const deliveries = new AsyncLocalStorage<Delivery>()
  // Only identifies our child-scoped method installation. Residency, lineage,
  // admission locks, message identities and queues remain native-owned.
  const continuationHooks = new WeakMap<Agent, Agent['followup']>()
  let settlements: ReturnType<typeof installManagedHarnessSettlements> | undefined
  root.effect(() => () => { active = false; lifetime.abort() })
  const assertLive = (service: object, owners: WeakSet<object>) => {
    if (!active || !owners.has(original(service))) throw failure()
  }
  const current = (entry: Delegation) => {
    if (!active || !entry.open || entry.parent.ctx.root !== root || root.agents.get(entry.parent.id) !== entry.parent) throw failure()
    entry.signal.throwIfAborted(); entry.capture.assertCurrent()
  }
  const begin = (parent: Agent, prompt: ContentBlock[], signal: AbortSignal): Delegation => {
    if (!active || parent.ctx.root !== root || root.agents.get(parent.id) !== parent) throw failure()
    const capture = captureManagedHarnessOrigins(root, parent)
    const entry = { parent, capture, prompt: structuredClone(prompt), signal, open: true, claimed: false, ready: false, accepted: false }
    current(entry); return entry
  }
  const deriveFor = async (entry: Delegation, targetSessionId: string) => {
    current(entry)
    const signal = AbortSignal.any([entry.signal, entry.capture.signal, lifetime.signal, AbortSignal.timeout(4000)])
    signal.throwIfAborted()
    const request = Object.freeze({ ...entry.capture.input, targetSessionId })
    const result = await new Promise<Awaited<ReturnType<ManagedHarnessOriginDerive>>>((resolve, reject) => {
      const aborted = () => reject(failure()); signal.addEventListener('abort', aborted, { once: true })
      Promise.resolve().then(() => derive(request, signal)).then(resolve, () => reject(failure()))
        .finally(() => signal.removeEventListener('abort', aborted))
    })
    signal.throwIfAborted(); current(entry)
    if (!result || result.nativeSessionId !== targetSessionId || !Array.isArray(result.sources) || !result.sources.length
      || result.sources.length > entry.capture.input.sources.length || new Set(result.sources).size !== result.sources.length
      || result.sources.some(value => typeof value !== 'string' || value.length > 8192
        || !/^paimind-origin-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(value)
        || entry.capture.input.sources.includes(value))) throw failure()
    return Object.freeze([...result.sources])
  }
  const assertChild = (entry: Delegation, child: Agent) => {
    const scope = executionScope(child), header = child.session.header
    if (child.ctx.root !== root || scope.sessionId !== child.id || child.id === entry.parent.id
      || scope.presetId !== entry.capture.input.presetId || header.origin !== 'subagent'
      || header.parentSession !== entry.parent.id) throw failure()
  }
  class ManagedAgents extends AgentRegistry {
    constructor(context: Context) {
      super(context); registries.add(this); context.effect(() => () => { registries.delete(this) })
    }
    override async create(options: CreateAgentOptions) {
      assertLive(this, registries)
      const entry = calls.getStore()
      if (!entry?.open) return super.create(options)
      current(entry)
      if (entry.claimed || options.meta?.origin !== 'subagent' || options.meta.parentSession !== entry.parent.id) throw failure()
      entry.claimed = true
      const handle = await super.create({ ...options, setup: async context => {
        const commit = await options.setup?.(context), child = context.agent
        if (!child || entry.child) throw failure()
        entry.child = child; current(entry); assertChild(entry, child)
        const sources = await deriveFor(entry, child.id)
        assertChild(entry, child)
        const followup = child.followup
        const descriptor = Object.getOwnPropertyDescriptor(child, 'followup')
        if ((descriptor && continuationHooks.get(child) !== followup) || typeof followup !== 'function') throw failure()
        let installed = false
        const release = () => {
          if (!installed) return
          installed = false
          if (child.followup === projected) {
            if (descriptor && continuationHooks.get(child) === followup) Object.defineProperty(child, 'followup', descriptor)
            else Reflect.deleteProperty(child, 'followup')
          }
        }
        const projected: Agent['followup'] = function (this: Agent, message: UserMessage) {
          current(entry); assertChild(entry, child)
          if (calls.getStore() !== entry || !entry.ready || entry.accepted || child.followup !== projected
            || message.source.kind !== 'user' || Object.keys(message.source).join(',') !== 'kind'
            || !isDeepStrictEqual(message.content, entry.prompt)) throw failure()
          const source: CoordinatorMessageSource & { readonly paimindOrigins: readonly string[] } = Object.freeze({
            kind: 'coordinator', form: 'relay', senderSessionId: entry.parent.id, paimindOrigins: sources,
          })
          entry.accepted = true; release()
          return followup.call(child, { ...message, source })
        }
        context.effect(() => {
          Object.defineProperty(child, 'followup', { value: projected, writable: true, configurable: true })
          installed = true; entry.release = release; return release
        })
        return { commit() { current(entry); assertChild(entry, child); commit?.commit(); current(entry); assertChild(entry, child) } }
      } })
      try {
        current(entry)
        if (handle.agent !== entry.child) throw failure()
        assertChild(entry, handle.agent); entry.ready = true; return handle
      } catch (error) { await handle.dispose(); throw error }
    }
  }
  class ManagedSubagents extends SubagentRuntime {
    private readonly serviceLifetime = new AbortController()
    constructor(context: Context) {
      super(context); runtimes.add(this)
      context.effect(() => () => { runtimes.delete(this); this.serviceLifetime.abort() })
      settlements = installManagedHarnessSettlements(context, root, async (child, messages, parent, signal) => {
        assertLive(this, runtimes)
        const capture = await captureManagedHarnessTerminalOrigins(root, child, messages, signal)
        const entry: Delegation = { parent: child, capture, prompt: [], signal: AbortSignal.any([signal, this.serviceLifetime.signal]),
          open: true, claimed: false, ready: false, accepted: false }
        try { return await deriveFor(entry, parent.id) } finally { entry.open = false }
      }, (parent, send) => continuationHooks.get(parent) === send)
      // Original activation setup runs for BOTH initial creation and cold
      // resume, after native composition and before publication. Its registry
      // owns rollback and immediate removal on either lifetime ending.
      this.registerContinuableSetup(childContext => {
        const child = childContext.agent, entry = deliveries.getStore()
        if (!child || Object.hasOwn(child, 'followup')) throw failure()
        if (entry?.open && !entry.accepted) {
          current(entry); assertChild(entry, child)
          if (child.id !== entry.targetSessionId) throw failure()
        }
        const followup = child.followup
        const projected: Agent['followup'] = function (this: Agent, message: UserMessage) {
          const delivery = deliveries.getStore()
          // Child execution may inherit the async context that admitted its
          // first turn. A completed delivery is not authority for later work.
          if (!delivery?.open || delivery.accepted) return followup.call(this, message)
          current(delivery); assertChild(delivery, child)
          if (this !== child || root.agents.get(child.id) !== child || child.id !== delivery.targetSessionId
            || !settlements?.current(child, 'followup', projected) || continuationHooks.get(child) !== projected || delivery.accepted
            || !isDeepStrictEqual(message.source, delivery.source) || !isDeepStrictEqual(message.content, delivery.prompt)) throw failure()
          const source = Object.freeze({ ...delivery.source, paimindOrigins: delivery.sources })
          const result = followup.call(child, { ...message, source })
          delivery.accepted = true; delivery.messageId = message.id
          return result
        }
        Object.defineProperty(child, 'followup', { value: projected, writable: true, configurable: true })
        continuationHooks.set(child, projected)
        return () => {
          if (child.followup === projected) Reflect.deleteProperty(child, 'followup')
          if (continuationHooks.get(child) === projected) continuationHooks.delete(child)
        }
      })
    }
    override registerProvider(provider: SubagentProvider) {
      assertLive(this, runtimes)
      const dispose = super.registerProvider(provider)
      if (registration.getStore()) {
        enrolled.add(provider); this.ctx.effect(() => () => { enrolled.delete(provider) })
      }
      return dispose
    }
    private assertProvider(name: string) {
      assertLive(this, runtimes)
      const provider = this.getProvider(name)
      if (provider && !enrolled.has(provider)) throw failure()
    }
    override async start(name: string, request: SubagentStartRequest) {
      this.assertProvider(name)
      const entry = begin(request.parent, request.prompt, AbortSignal.any([request.signal, this.serviceLifetime.signal]))
      try {
        const run = await calls.run(entry, () => super.start(name, request))
        if (!entry.child || run.localAgent !== entry.child || !entry.ready || (!entry.accepted && !request.signal.aborted)) {
          await run.dispose(); throw failure()
        }
        return run
      } finally { entry.open = false; entry.release?.() }
    }
    override async startContinuable(spec: ContinuableStartSpec) {
      this.assertProvider(spec.provider)
      const entry = begin(spec.request.parent, spec.request.prompt, AbortSignal.any([spec.signal, this.serviceLifetime.signal]))
      try { return await calls.run(entry, () => super.startContinuable(spec)) }
      finally { entry.open = false; entry.release?.() }
    }
    override async followup(parent: Agent, childId: Parameters<SubagentRuntime['followup']>[1], content: ContentBlock[], options: SubagentFollowupOptions) {
      assertLive(this, runtimes)
      // The authenticated browser path already carries a target-bound user
      // signature. Never substitute the idle parent's or another login's turn.
      if (options.source.kind === 'user') return super.followup(parent, childId, content, options)
      const source = options.source
      if (source.kind !== 'coordinator' || Object.keys(source).sort().join(',') !== 'form,kind,senderSessionId'
        || source.form !== 'relay' || source.senderSessionId !== parent.id
        || !childId || childId.length > 200 || childId === parent.id) throw failure()
      const entry: Delivery = { ...begin(parent, content, AbortSignal.any([options.signal, this.serviceLifetime.signal])), targetSessionId: childId,
        source: Object.freeze({ ...source }), sources: [] }
      // The native manager observes this only until inbox acceptance. Do not
      // cancel an accepted child's turn when its caller later finishes.
      const signal = AbortSignal.any([entry.signal, entry.capture.signal, lifetime.signal])
      try {
        entry.sources = await deriveFor(entry, childId)
        const id = await deliveries.run(entry, () => super.followup(parent, childId, entry.prompt, { source: entry.source, signal }))
        if (!entry.accepted || entry.messageId !== id) throw failure()
        return id
      } finally { entry.open = false }
    }
    override async reportFrom(child: Agent, content: ContentBlock[], options: SubagentReportOptions) {
      assertLive(this, runtimes)
      const { delivery, signal } = options
      const parentId = child.session.header.parentSession
      const parent = parentId === undefined ? undefined : root.agents.get(parentId)
      if (!parent || child.session.header.origin !== 'subagent' || !['quiet', 'next-step'].includes(delivery)) throw failure()
      const entry = begin(child, content, AbortSignal.any([signal, this.serviceLifetime.signal]))
      const assertTarget = () => {
        current(entry)
        if (root.agents.get(parent.id) !== parent || parent.ctx.root !== root || child.session.header.parentSession !== parent.id
          || parent.id === child.id || executionScope(parent).presetId !== entry.capture.input.presetId) throw failure()
      }
      try {
        assertTarget()
        const sources = await deriveFor(entry, parent.id)
        assertTarget()
        const method = delivery === 'quiet' ? 'inject' : 'steer', originalSend = parent[method]
        const descriptor = Object.getOwnPropertyDescriptor(parent, method)
        if (descriptor && !settlements?.owns(parent, method, originalSend) || typeof originalSend !== 'function') throw failure()
        let messageId: string | undefined
        const projected: Agent['inject'] = function (this: Agent, message: UserMessage) {
          assertTarget()
          if (this !== parent || parent[method] !== projected || entry.accepted
            || !isDeepStrictEqual(message.source, { kind: 'subagent-report', form: 'relay', senderSessionId: child.id })
            || message.content.length !== entry.prompt.length + 1 || message.content[0]?.type !== 'text'
            || !isDeepStrictEqual(message.content.slice(1), entry.prompt)) throw failure()
          const result = originalSend.call(parent, { ...message, source: Object.freeze({ ...message.source, paimindOrigins: sources }) })
          entry.accepted = true; messageId = message.id
          return result
        }
        // rc.2's original reportFrom performs its resident-child authorizer,
        // direct-parent resolution and send synchronously before returning its
        // Promise. Project exactly that span, never an async parent-wide hook.
        Object.defineProperty(parent, method, { value: projected, writable: true, configurable: true })
        let pending: ReturnType<SubagentRuntime['reportFrom']>
        try { pending = super.reportFrom(child, entry.prompt, { delivery, signal }) }
        finally {
          if (parent[method] === projected) {
            if (descriptor && settlements?.owns(parent, method, originalSend)) Object.defineProperty(parent, method, descriptor)
            else Reflect.deleteProperty(parent, method)
          }
        }
        const id = await pending
        if (!entry.accepted || messageId !== id) throw failure()
        return id
      } finally { entry.open = false }
    }
  }
  const wrapped = new Map<unknown, unknown>()
  return { Agents: ManagedAgents, Subagents: ManagedSubagents,
    selectProvider(plugin: unknown) {
      if (!plugin || typeof plugin !== 'object' || !modules.some(module => module.apply === (plugin as NativeProviderModule).apply)) return plugin
      if (!wrapped.has(plugin)) {
        const source = plugin as NativeProviderModule
        wrapped.set(plugin, { ...plugin, apply(context: Context, config: unknown) {
          if (!active) throw failure()
          return registration.run(true, () => source.apply(context, config))
        } })
      }
      return wrapped.get(plugin)
    },
    ownsAgents(service) { return registries.has(original(service)) }, ownsSubagents(service) { return runtimes.has(original(service)) },
    ownsFollowup(agent, method) { return continuationHooks.get(agent) === method },
  }
}
