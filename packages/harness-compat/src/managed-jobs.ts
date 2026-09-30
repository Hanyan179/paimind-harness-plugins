import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { isDeepStrictEqual } from 'node:util'
import { symbols, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { assertManagedJobSources, captureManagedHarnessOrigins, executionScope,
  type ManagedHarnessOriginCheck, type ManagedHarnessOrigins, type ManagedHarnessJobOriginSeal } from './managed-origins.js'

// The bootstrap supplies the exact installed rc.2 class. Keep this internal
// structural seam out of the package API; no second job registry or producer.
interface NativeJobHooks {
  cancel(reason?: string): void
  done: Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string; output?: string }>
  readOutput?(): string
}
interface NativeJobStart { kind: string; label: string; outputLimitBytes?: number; owner?: Agent; run(): NativeJobHooks }
interface NativeJobSnapshot { id: string; ownerSession?: string; reported: boolean; status: string; [key: string]: unknown }
type NativeJobListener = (snapshot: NativeJobSnapshot, owner?: Agent) => unknown
interface NativeJobs {
  start(spec: NativeJobStart): string
  kill(id: string, owner: Agent, reason?: string): 'requested' | 'already-finished'
  get(id: string, owner: Agent): NativeJobSnapshot
  onJobDone(listener: NativeJobListener): () => void
}
type NativeController = { apply(context: Context, config: any): unknown }
type NativeJobsConstructor = new (context: Context, config: any) => NativeJobs
const original = (value: object): object => Reflect.get(value, symbols.original) ?? value
const failure = () => new Error('后台任务的原始来源或当前权限无法验证，任务已请求停止')

/** A running native job retains its exact initiating origins, not the current
 * turn's login and not a cached allow. Logout therefore revokes this bounded
 * continuation. Only the exact native completion controller can request a
 * same-session, same-job signed notice; scheduled runs remain unauthorized.
 * Native preflight, IDs, records, output cursors, settlement and cleanup remain
 * in the original provider. Only authorization renewal has an extra lifetime. */
export function createManagedHarnessJobsProvider(root: Context, Native: NativeJobsConstructor,
  check: ManagedHarnessOriginCheck, requestExit: (code: number) => void,
  completion?: { controller: NativeController; seal: ManagedHarnessJobOriginSeal; ownsFollowup?: (agent: Agent, method: Agent['followup']) => boolean }): {
    Provider: NativeJobsConstructor; owns(service: object): boolean; selectController(plugin: unknown): unknown
  } {
  assert.equal(root, root.root); assert.equal(typeof Native, 'function')
  assert.equal(typeof check, 'function'); assert.equal(typeof requestExit, 'function')
  const instances = new WeakSet<object>()
  const registration = new AsyncLocalStorage<Context>(), wrapped = new Map<unknown, unknown>()
  if (completion) { assert.equal(typeof completion.controller.apply, 'function'); assert.equal(typeof completion.seal, 'function') }
  class ManagedJobs extends Native {
    private live = true
    private readonly ownerContext: Context
    // Provenance attachment until native settlement, NOT a registry: no IDs,
    // status, output, queues, persistence or caller lookup are owned here.
    private readonly origins = new Map<string, { owner: Agent; input: ManagedHarnessOrigins; assertScope(): void }>()
    constructor(context: Context, config: any) {
      super(context, config)
      this.ownerContext = context; instances.add(this)
      context.effect(() => () => { this.live = false; instances.delete(this); this.origins.clear() })
      super.onJobDone(snapshot => {
        // All original listeners acquire the attachment synchronously before
        // their bounded async authorization. No terminal record is retained.
        queueMicrotask(() => this.origins.delete(snapshot.id))
      })
    }
    override onJobDone(listener: NativeJobListener): () => void {
      const controller = registration.getStore()
      if (!completion || !controller) return super.onJobDone(listener)
      return super.onJobDone(async (snapshot, owner) => {
        if (snapshot.reported || !owner) return
        const entry = this.origins.get(snapshot.id)
        if (!entry || entry.owner !== owner || snapshot.ownerSession !== owner.id) throw failure()
        const input = Object.freeze({ ...entry.input, nativeJobId: snapshot.id }), abort = new AbortController()
        const releases: (() => void)[] = [], timeout = setTimeout(() => abort.abort(), 4000)
        try {
          for (const context of [controller, this.ownerContext, owner.ctx]) releases.push(context.effect(() => () => abort.abort()))
          entry.assertScope(); abort.signal.throwIfAborted()
          const sealed = await new Promise<Awaited<ReturnType<ManagedHarnessJobOriginSeal>>>((resolve, reject) => {
            const aborted = () => reject(failure())
            abort.signal.addEventListener('abort', aborted, { once: true })
            Promise.resolve().then(() => { abort.signal.throwIfAborted(); return completion.seal(input, abort.signal) })
              .then(resolve, () => reject(failure())).finally(() => abort.signal.removeEventListener('abort', aborted))
          })
          abort.signal.throwIfAborted(); entry.assertScope()
          if (sealed.nativeSessionId !== input.nativeSessionId || sealed.sources.length > input.sources.length
            || sealed.sources.some(value => input.sources.includes(value))) throw failure()
          assertManagedJobSources(input, sealed.sources)
          const current = super.get(snapshot.id, owner)
          if (current.reported) return // An original waiter/read/cancel won.
          if (!isDeepStrictEqual(current, snapshot)) throw failure()
          const methods = ['followup', 'inject'] as const
          const saved = methods.map(method => ({ method, send: owner[method], descriptor: Object.getOwnPropertyDescriptor(owner, method) }))
          if (saved.some(row => typeof row.send !== 'function' || row.descriptor &&
            (row.method !== 'followup' || !completion.ownsFollowup?.(owner, row.send)))) throw failure()
          let used = false
          const installed = saved.map(row => ({ ...row, projected: function (this: Agent, message: Parameters<Agent['followup']>[0]) {
            abort.signal.throwIfAborted(); entry.assertScope()
            if (this !== owner || used || message.source.kind !== 'plugin'
              || Object.keys(message.source).sort().join(',') !== 'form,kind,plugin,summary'
              || message.source.plugin !== 'tool-jobs' || message.source.form !== 'notice') throw failure()
            used = true
            return row.send.call(owner, { ...message, source: { ...message.source, nativeJobId: input.nativeJobId,
              paimindOrigins: Object.freeze([...sealed.sources]) } } as Parameters<Agent['followup']>[0])
          } }))
          try {
            for (const row of installed) Object.defineProperty(owner, row.method, { value: row.projected, configurable: true, writable: true })
            const result = listener(current, owner)
            if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
              void Promise.resolve(result).catch(() => undefined)
              throw failure()
            }
          } finally {
            for (const row of installed) if (owner[row.method] === row.projected) {
              if (row.descriptor) Object.defineProperty(owner, row.method, row.descriptor)
              else Reflect.deleteProperty(owner, row.method)
            }
          }
        } finally { clearTimeout(timeout); for (const release of releases.reverse()) release(); abort.abort() }
      })
    }
    override start(spec: NativeJobStart): string {
      const service = original(this), owner = spec.owner
      const assertOwner = () => {
        if (!this.live || !instances.has(service) || original(root.get('jobs') as object ?? {}) !== service
          || !owner || owner.ctx.root !== root || root.agents.get(owner.id) !== owner || owner.session.id !== owner.id) throw failure()
      }
      assertOwner()
      const capture = captureManagedHarnessOrigins(root, owner!)
      const session = owner!.session
      // An independent producer does not consume the parent's later catalog.
      // Keep its exact initiating dependencies, including the explicit empty
      // set; current identity, bytes and grants are still checked each time.
      const input: ManagedHarnessOrigins = Object.freeze({ ...capture.input,
        requirements: Object.freeze([...(capture.input.requirements ?? [])]), skillSelection: 'captured' })
      const assertScope = () => {
        assertOwner()
        if (owner!.session !== session || executionScope(owner!).presetId !== input.presetId
          || session.id !== input.nativeSessionId) throw failure()
      }
      // Start is native-synchronous. The current active-turn lease must exist
      // before even entering native preflight, and again before its producer.
      capture.assertCurrent(); assertScope()
      let id: string | undefined, live = true, release = () => {}, checking = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let expiry: ReturnType<typeof setTimeout> | undefined
      const lifetime = new AbortController()
      const stop = () => { if (!live) return; live = false; clearTimeout(timer); clearTimeout(expiry); lifetime.abort(); release() }
      const revoke = () => {
        if (!live) return
        stop()
        if (id === undefined) return
        try { super.kill(id, owner!, failure().message) }
        catch {
          // Native contract violations may leave a producer running. Do not
          // claim cancellation succeeded or swallow it: close this owned cell
          // through the existing bounded shutdown path, never another cell.
          requestExit(1)
        }
      }
      const renew = async () => {
        if (!live || checking) return
        checking = true
        const started = Date.now()
        const deadline = new AbortController(), signal = AbortSignal.any([lifetime.signal, deadline.signal])
        const timeout = setTimeout(() => deadline.abort(), 4000)
        try {
          assertScope(); signal.throwIfAborted()
          await new Promise<void>((resolve, reject) => {
            const aborted = () => reject(failure())
            signal.addEventListener('abort', aborted, { once: true })
            Promise.resolve().then(() => { signal.throwIfAborted(); return check(input, signal) })
              .then(() => resolve(), reject).finally(() => signal.removeEventListener('abort', aborted))
          })
          if (!live) return
          signal.throwIfAborted(); assertScope()
          clearTimeout(expiry)
          expiry = setTimeout(revoke, Math.max(0, started + 5000 - Date.now()))
          timer = setTimeout(() => void renew(), 1000)
        } catch { if (live) revoke() }
        finally { clearTimeout(timeout); checking = false }
      }
      try {
        id = super.start({ ...spec, run: () => {
          capture.assertCurrent(); assertScope()
          const hooks = spec.run()
          // Observe, do not replace, the original producer's terminal promise
          // or receiver. Settlement/listener ordering remains native-owned.
          void hooks.done.then(stop, stop)
          return hooks
        } })
        this.origins.set(id, { owner: owner!, input, assertScope })
        release = this.ownerContext.effect(() => () => { stop() }, 'managed native job authority')
        expiry = setTimeout(revoke, 5000)
        void renew()
        return id
      } catch (error) { stop(); throw error }
    }
  }
  return { Provider: ManagedJobs, owns: (service: object) => instances.has(original(service)),
    selectController(plugin) {
      if (!completion || !plugin || typeof plugin !== 'object' || (plugin as NativeController).apply !== completion.controller.apply) return plugin
      if (!wrapped.has(plugin)) wrapped.set(plugin, { ...plugin, apply(context: Context, config: unknown) {
        return registration.run(context, () => completion.controller.apply(context, config))
      } })
      return wrapped.get(plugin)
    } }
}
