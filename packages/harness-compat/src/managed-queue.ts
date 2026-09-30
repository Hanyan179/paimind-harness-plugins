import { AsyncLocalStorage } from "node:async_hooks"
import { createHash } from "node:crypto"
import { resolveSessionPreset } from "@deepseek-ai/dsh-agent-presets"
import { sessionPromptRequestSchema } from "@deepseek-ai/dsh-host-apiproxy/api/sessions.schema"
import { readHarnessPromptCorrelation } from "./prompt-correlation.js"
import { readPaimindNativeSessionReference, type PaimindNativeSessionReference } from "./host.js"
import assert from 'node:assert/strict'
import { symbols, type Context } from '@deepseek-ai/cordis'
import { ApiProxyService, type ApiProxy, type Config } from '@deepseek-ai/dsh-host-apiproxy'
import { sessionUpdateQueueRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/sessions.schema'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import { Inbox } from '@deepseek-ai/dsh-agent'
import { executionScope, type ManagedHarnessOrigins } from './managed-origins.js'
import { projectPaimindNativeSessionList } from './host.js'
import { guardManagedHarnessApprovalApi } from './managed-approval.js'

export interface ManagedHarnessQueueRequest extends ManagedHarnessOrigins { readonly action: 'edit' | 'remove' | 'steer' | 'submit' | 'resume' | 'approval-approve' | 'approval-reject' }
export type ManagedHarnessQueueCheck = (input: ManagedHarnessQueueRequest, signal: AbortSignal) => Promise<void>
type Sessions = ApiProxy['sessions']
const denied = () => new Error('排队消息的当前操作身份无法验证，请重新回读')

/** rc.2 updateQueue validates and mutates synchronously before returning its
 * Promise. Keep that original operation, including its text-only, subagent and
 * steering rules. Only its one exact native mutation receives editor provenance.
 * The temporary projection never spans await, patches a prototype, stores an
 * inbox, invents a message ID or writes a second event/history stream. */
export function guardManagedHarnessQueueApi(context: Context, sessions: Sessions, check: ManagedHarnessQueueCheck): Sessions {
  assert.equal(typeof check, 'function')
  const lifetime = new AbortController()
  context.effect(() => () => lifetime.abort())
  const native = sessions.updateQueue.bind(sessions)
  return { ...sessions, async updateQueue(input) {
    try {
      lifetime.signal.throwIfAborted()
      const payload = sessionUpdateQueueRequestSchema.parse(input.payload), request = { rpcId: input.rpcId, payload }
      if (typeof request.rpcId !== 'string' || request.rpcId.length > 1536
        || !/^paimind-origin-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(request.rpcId)) throw denied()
      const agent = context.agents.get(payload.sessionId)
      // The original owner reports missing/claimed items. This path cannot
      // mutate anything and does not mint authority for a nonexistent Agent.
      if (!agent) return native(request)
      const locate = () => {
        for (const target of ['nextTurn', 'nextStep'] as const) {
          const message = agent.inbox[target].find(item => item.id === payload.itemId)
          if (message) return { target, message }
        }
      }
      const before = locate()
      if (!before) return native(request)
      const scope = executionScope(agent)
      if (!scope.presetId || scope.sessionId !== payload.sessionId) throw denied()
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(4000)])
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(denied())
        signal.addEventListener('abort', abort, { once: true })
        Promise.resolve().then(() => {
          signal.throwIfAborted()
          return check(Object.freeze({ nativeSessionId: scope.sessionId, presetId: scope.presetId!,
            sources: Object.freeze([request.rpcId]), action: payload.action.kind }), signal)
        }).then(() => { if (signal.aborted) reject(denied()); else resolve() }, () => reject(denied()))
          .finally(() => signal.removeEventListener('abort', abort))
      })
      signal.throwIfAborted()
      const after = locate()
      if (context.agents.get(payload.sessionId) !== agent || agent.session.id !== scope.sessionId
        || executionScope(agent).presetId !== scope.presetId || after?.target !== before.target || after.message !== before.message) throw denied()
      if (payload.action.kind === 'remove') return native(request)
      const source = { ...(before.message.source.kind === 'user' ? before.message.source : {}), kind: 'user' as const, rpcId: request.rpcId }
      let projecting = true, mutations = 0
      // These are original object methods, not Cordis service registrations.
      // Refuse a competing owner and restore only this exact temporary slot.
      const owner = payload.action.kind === 'edit' ? agent.inbox : agent
      const key = payload.action.kind === 'edit' ? 'replace' : 'steer'
      assert.ok(!Object.hasOwn(owner, key), 'Queue mutation already has another owner')
      const original = Reflect.get(owner, key)
      assert.equal(typeof original, 'function')
      const projection = (...args: unknown[]) => {
        if (!projecting || ++mutations !== 1) throw denied()
        if (payload.action.kind === 'edit') {
          const [id, message] = args as [unknown, typeof before.message]
          if (id !== payload.itemId) throw denied()
          assert.deepEqual(message, { ...before.message, content: payload.action.content })
          return original.call(owner, id, freezeMessage({ ...message, source }))
        }
        if (args.length !== 1 || args[0] !== before.message) throw denied()
        return original.call(owner, freezeMessage({ ...before.message, source }))
      }
      Object.defineProperty(owner, key, { value: projection, configurable: true })
      try { return native(request) }
      finally {
        projecting = false
        assert.equal(Reflect.get(owner, key), projection, 'Queue projection ownership changed')
        Reflect.deleteProperty(owner, key)
      }
    } catch {
      return { rpcId: input.rpcId, result: { ok: false, error: { code: 'internal', message: denied().message, details: {} } } }
    }
  } }
}

/** Select through the original Loader; native config, injection, service and
 * all other API methods remain owned by the original provider. */
export function createManagedHarnessQueueApiProvider(check: ManagedHarnessQueueCheck): {
  Provider: typeof ApiProxyService; owns(api: ApiProxy): boolean
} {
  const live = new WeakSet<object>()
  class ManagedApiProxy extends ApiProxyService {
    constructor(context: Context, config: Config) {
      super(context, config)
      Object.defineProperty(this, 'sessions', { value: projectPaimindNativeSessionList(context,
        guardManagedHarnessTurnApi(context, guardManagedHarnessQueueApi(context, this.sessions, check), check)),
        writable: false, configurable: false })
      const respond = guardManagedHarnessApprovalApi(context, this.respond, check)
      // Cordis binds service functions through a Proxy. A frozen data property
      // would prohibit that binding by the JS Proxy invariant. A getter keeps
      // this sole owner non-replaceable while allowing the original binding.
      Object.defineProperty(this, 'respond', { get: () => respond, configurable: false })
      live.add(this); context.effect(() => () => { live.delete(this) })
    }
  }
  return { Provider: ManagedApiProxy, owns(api: ApiProxy) { return live.has(Reflect.get(api, symbols.original) ?? api) } }
}

const prefix = 'haas-turn-v1.'
export interface NativeTurnSelection { commandId: string; expectedVersion: string; contentDigest: string }
export interface NativeTurnState {
  sessionId: string; presetId: string | null; version: string
  accepted: { messageId: string; seq: number } | null; pending: boolean
}
const digest = (value: string) => createHash('sha256').update(value).digest('base64url')
export const nativeTurnContentDigest = (text: string): string => digest(JSON.stringify([{ type: 'text', text }]))

/** Correlation is not authorization. The existing origin authority must verify
 * the signature and current account/cell/preset on every read and submission. */
export function encodeNativeTurnSelection(input: NativeTurnSelection): string {
  const value = `${prefix}${input.commandId}.${input.expectedVersion}.${input.contentDigest}`
  if (!decodeNativeTurnSelection(value)) throw Error('Invalid native turn identity')
  return value
}
export function decodeNativeTurnSelection(value: string): NativeTurnSelection | undefined {
  if (!value.startsWith(prefix)) return undefined
  const match = /^haas-turn-v1\.([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/u.exec(value)
  if (!match || [match[2]!, match[3]!].some(part => Buffer.from(part, 'base64url').toString('base64url') !== part)) {
    throw Error('Invalid native turn identity')
  }
  return { commandId: match[1]!, expectedVersion: match[2]!, contentDigest: match[3]! }
}

/** Pure bounded projection. Native events remain the only durable submission
 * evidence, including an insertion later consumed, removed, edited or canceled.
 * Forked parent events cannot prove a submission to the child's identity. */
export function projectNativeTurnState(reference: PaimindNativeSessionReference, selection?: NativeTurnSelection): NativeTurnState {
  if (reference.id !== reference.header.id || reference.events.length > 10000) throw Error('Native turn history cannot be verified')
  if (selection) encodeNativeTurnSelection(selection)
  const preset = resolveSessionPreset(reference as unknown as Parameters<typeof resolveSessionPreset>[0])
  if (preset !== undefined && (typeof preset !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,159}$/u.test(preset))) throw Error('Native turn preset cannot be verified')
  const bytes = JSON.stringify({ sessionId: reference.id, presetId: preset ?? null, events: reference.events })
  if (Buffer.byteLength(bytes) > 2 * 1024 * 1024) throw Error('Native turn history exceeds its bound')
  let accepted: NativeTurnState['accepted'] = null, previous = -1
  for (const raw of reference.events) {
    const event = raw as { seq: number; type: string; data: { inserted?: unknown[] } }
    if (!event || !Number.isSafeInteger(event.seq) || event.seq !== previous + 1) throw Error('Native turn history is not contiguous')
    previous = event.seq
    if (!selection || event.type !== 'agent/inbox/spliced') continue
    if (!Array.isArray(event.data?.inserted)) throw Error('Invalid native inbox evidence')
    for (const value of event.data.inserted) {
      const message = value as { id?: unknown; source?: { kind?: unknown; rpcId?: unknown }; content?: unknown }
      if (message.source?.kind !== 'user' || typeof message.source.rpcId !== 'string'
        || !/^paimind-origin-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(message.source.rpcId)) continue
      const correlation = readHarnessPromptCorrelation(message.source, reference.id)
      if (!correlation) continue
      const command = decodeNativeTurnSelection(correlation)
      if (!command || command.commandId !== selection.commandId) continue
      if (command.expectedVersion !== selection.expectedVersion || command.contentDigest !== selection.contentDigest
        || typeof message.id !== 'string' || !message.id || message.id.length > 200
        || digest(JSON.stringify(message.content)) !== selection.contentDigest
        || accepted && accepted.messageId !== message.id) throw Error('Native turn receipt conflicts')
      accepted ??= { messageId: message.id, seq: event.seq }
    }
  }
  // Use the original Inbox fold, including its seed boundary and malformed
  // splice checks. This detached read never registers or mutates a queue.
  let pending = false
  if (selection && accepted) {
    const readOnly = { header: reference.header, events: reference.events } as ConstructorParameters<typeof Inbox>[0]
    const forbidden = () => { throw Error('Read-only native inbox projection cannot mutate') }
    const inbox = new Inbox(readOnly, { inserted: forbidden, discarded: forbidden, claimed: forbidden })
    const message = [...inbox.nextTurn, ...inbox.nextStep].find(value => value.id === accepted!.messageId)
    pending = !!message && message.source.kind === 'user' && 'rpcId' in message.source
      && readHarnessPromptCorrelation(message.source, reference.id) === encodeNativeTurnSelection(selection)
      && digest(JSON.stringify(message.content)) === selection.contentDigest
  }
  return { sessionId: reference.id, presetId: preset ?? null, version: digest(bytes), accepted, pending }
}

export async function readNativeTurnState(context: Parameters<typeof readPaimindNativeSessionReference>[0],
  sessionId: string, selection: NativeTurnSelection | undefined, signal: AbortSignal): Promise<NativeTurnState> {
  signal.throwIfAborted()
  const reference = await readPaimindNativeSessionReference(context, sessionId)
  signal.throwIfAborted()
  return projectNativeTurnState(reference, selection)
}

/** Receipt confirmation reads the original persisted bytes, not merely a live
 * insertion or a model outcome. It never resumes, flushes or requeues work. */
export async function readNativeTurnReceipt(context: Context, sessionId: string,
  selection: NativeTurnSelection | undefined, signal: AbortSignal): Promise<NativeTurnState & { persisted: boolean }> {
  const state = await readNativeTurnState(context as never, sessionId, selection, signal)
  let persisted = false
  if (selection && state.accepted) {
    // inspect() deliberately borrows a live Session when one exists. Only
    // readFrom() reads the backend-owned stored prefix without flushing it.
    const inspected = await context.sessionPersistence.readFrom(sessionId as Parameters<Context['sessionPersistence']['readFrom']>[0], 0, signal)
    signal.throwIfAborted()
    const stored = projectNativeTurnState({ id: sessionId, header: inspected.meta, events: inspected.events }, selection)
    persisted = stored.presetId === state.presetId && stored.accepted?.messageId === state.accepted.messageId
      && stored.accepted.seq === state.accepted.seq
  }
  return { ...state, persisted }
}

type Agent = NonNullable<ReturnType<Context['agents']['get']>>
interface Scope { agent: Agent; presetId: string; selection: NativeTurnSelection; writeVersion: string; source: string; signal: AbortSignal; armed: boolean }
const turnDenied = () => Error('轮次状态或当前权限无法确认，请保留原请求标识并回读')

/** rc.2 Session's constructor appends exactly this marker to a resumed seed.
 * Keep the original version in the signed command. Permit only that one
 * lifecycle transition, with the entire prior event prefix and preset intact;
 * never strip markers generally or rebase across concurrent user changes. */
function matchesNativeHydrationVersion(reference: PaimindNativeSessionReference, expectedVersion: string): boolean {
  if (projectNativeTurnState(reference).version === expectedVersion) return true
  const end = reference.events.at(-1) as { type?: unknown; seq?: unknown; time?: unknown; data?: unknown } | undefined
  if (!end || end.type !== 'session/end-seed' || end.seq !== reference.events.length - 1
    || typeof end.time !== 'number' || !Number.isFinite(end.time) || JSON.stringify(end.data) !== '{}'
    || Object.keys(end).sort().join(',') !== 'data,seq,time,type'
    || (reference.events.at(-2) as { type?: unknown } | undefined)?.type === 'session/end-seed') return false
  return projectNativeTurnState({ ...reference, events: reference.events.slice(0, -1) }).version === expectedVersion
}

/** Adapts the existing prompt owner, not a new invocation or message store.
 * Its asynchronous content preparation ends at the original synchronous
 * followup boundary. Only that request's async scope receives the final
 * version/dedup check; unrelated browser/model/native callers pass through.
 * No prototype patch; every exact temporary own slot is reference-counted and
 * removed when its last native call settles. Disposal aborts first; an
 * in-flight native preparation retains the rejecting fence until it settles. */
export function guardManagedHarnessTurnApi(context: Context, sessions: ApiProxy['sessions'], check: ManagedHarnessQueueCheck): ApiProxy['sessions'] {
  const lifetime = new AbortController(), calls = new AsyncLocalStorage<Scope>()
  const hooks = new Map<Agent, { original: Agent['followup']; wrapper: Agent['followup']; count: number }>()
  const restore = (agent: Agent) => {
    const hook = hooks.get(agent)
    if (!hook) return
    if (agent.followup === hook.wrapper) Reflect.deleteProperty(agent, 'followup')
    hooks.delete(agent)
  }
  context.effect(() => () => lifetime.abort())
  const native = sessions.prompt.bind(sessions)
  return { ...sessions, async prompt(request) {
    let selected = false
    try {
      const correlation = readHarnessPromptCorrelation({ kind: 'user', rpcId: request.rpcId }, request.payload.sessionId)
      if (!correlation?.startsWith('haas-turn-v1.')) return native(request)
      selected = true
      request = structuredClone(request)
      const selection = decodeNativeTurnSelection(correlation)!
      if (!/^paimind-origin-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(request.rpcId)) throw turnDenied()
      const payload = sessionPromptRequestSchema.parse(request.payload)
      if (payload.mode !== 'queue' || payload.content.length !== 1 || payload.content[0]?.type !== 'text'
        || payload.content[0].text.length === 0 || payload.content[0].text.length > 65536
        || nativeTurnContentDigest(payload.content[0].text) !== selection.contentDigest) throw turnDenied()
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(8000)])
      const bounded = async <T>(run: () => Promise<T>): Promise<T> => {
        signal.throwIfAborted()
        return new Promise((resolve, reject) => {
          const abort = () => reject(turnDenied())
          signal.addEventListener('abort', abort, { once: true })
          Promise.resolve().then(() => { signal.throwIfAborted(); return run() }).then(value => {
            if (signal.aborted) reject(turnDenied()); else resolve(value)
          }, () => reject(turnDenied())).finally(() => signal.removeEventListener('abort', abort))
        })
      }
      const state = await bounded(() => readNativeTurnState(context as never, payload.sessionId, selection, signal))
      if (!state.presetId) throw turnDenied()
      const presetId = state.presetId
      if ((!state.accepted || state.pending) && !context.agents.get(payload.sessionId)) {
        if (!state.accepted && state.version !== selection.expectedVersion) throw turnDenied()
        // Current login/cell is required before hydration. The original Host
        // resolver owns exact-id cold resume, preset/model setup, coalescing
        // and the subagent fence. Missing history never falls back to create.
        // This does not grant execution: full composition authority is checked
        // below after the original session/skill scopes exist.
        await bounded(() => check({ nativeSessionId: payload.sessionId, presetId, sources: [request.rpcId], action: 'resume' }, signal))
        const lookup = context.get('typert')?.lookups.get('agent')
        if (!lookup || lookup.parameter !== 'agent' || lookup.wire !== 'agentId'
          || lookup.hostTypeSymbol !== '@deepseek-ai/dsh-agent#Agent') throw turnDenied()
        const resumed = await bounded(async () => lookup.resolve(payload.sessionId))
        if (!resumed || context.agents.get(payload.sessionId) !== resumed) throw turnDenied()
      }
      await bounded(() => check({ nativeSessionId: payload.sessionId, presetId, sources: [request.rpcId], action: 'submit' }, signal))
      const currentReference = await bounded(() => readPaimindNativeSessionReference(context as never, payload.sessionId))
      const current = projectNativeTurnState(currentReference, selection)
      if (current.presetId !== state.presetId) throw turnDenied()
      const flush = async () => {
        const session = context.sessions.get(payload.sessionId)
        if (session && !(await bounded(() => context.sessions.flush(session)))) throw turnDenied()
      }
      if (current.accepted) {
        // Cold inspection already uses the persistent owner; live history must
        // cross the same native durability barrier before acknowledgement.
        await flush()
        if (current.pending) {
          const agent = context.agents.get(payload.sessionId)
          if (!agent || executionScope(agent).presetId !== presetId) throw turnDenied()
          const queued = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].find(message => message.id === current.accepted!.messageId)
          if (!queued || queued.source.kind !== 'user' || !('rpcId' in queued.source)) throw turnDenied()
          const queuedSource = queued.source.rpcId
          // Both the explicit retry and the original queued login must still
          // be allowed. A new login cannot silently adopt revoked old work.
          await bounded(() => check({ nativeSessionId: payload.sessionId, presetId,
            sources: [...new Set([request.rpcId, queuedSource])], action: 'submit' }, signal))
          const final = projectNativeTurnState({ id: agent.session.id, header: agent.session.header,
            events: agent.session.events }, selection)
          if (context.agents.get(payload.sessionId) !== agent || final.presetId !== presetId) throw turnDenied()
          if (final.pending && agent.status === 'idle') {
            if (final.version !== current.version) throw turnDenied()
            // Selected rc.2 driver: invoke its existing synchronous reservation
            // without adding/reordering a message or copying driver logic. All
            // subsequent model/tool steps keep the original origin guards.
            const prototype = Object.getPrototypeOf(agent), wake = prototype?.wakeDriver
            if (prototype?.constructor?.name !== 'ReactLoopAgent' || typeof wake !== 'function'
              || Object.hasOwn(agent, 'wakeDriver')) throw turnDenied()
            signal.throwIfAborted()
            wake.call(agent)
          }
        }
        return { rpcId: request.rpcId, result: { ok: true, value: { accepted: true } } }
      }
      if (!matchesNativeHydrationVersion(currentReference, selection.expectedVersion)) throw turnDenied()
      const agent = context.agents.get(payload.sessionId)
      // The original resolver may publish during another request. Require the
      // exact current Agent and full authority before attaching a write fence.
      if (!agent || executionScope(agent).presetId !== state.presetId || hooks.size >= 128 && !hooks.has(agent)) throw turnDenied()
      let hook = hooks.get(agent)
      if (!hook) {
        assert.ok(!Object.hasOwn(agent, 'followup'), 'Native followup already has another owner')
        const original = agent.followup
        const wrapper: Agent['followup'] = function(message) {
          const call = calls.getStore()
          if (!call || call.agent !== agent || !call.armed) return original.call(agent, message)
          call.signal.throwIfAborted()
          if (context.agents.get(payload.sessionId) !== agent || message.source.kind !== 'user' || !('rpcId' in message.source) || message.source.rpcId !== call.source
            || message.content.length !== 1 || message.content[0]?.type !== 'text'
            || nativeTurnContentDigest(message.content[0].text) !== call.selection.contentDigest) throw turnDenied()
          const reference = { id: agent.session.id, header: agent.session.header, events: agent.session.events }
          const final = projectNativeTurnState(reference, call.selection)
          if (final.presetId !== call.presetId) throw turnDenied()
          call.armed = false
          if (final.accepted) return
          if (final.version !== call.writeVersion) throw turnDenied()
          // No await between exact state check and the original inbox write.
          return original.call(agent, message)
        }
        hook = { original, wrapper, count: 0 }; hooks.set(agent, hook)
        Object.defineProperty(agent, 'followup', { value: wrapper, configurable: true })
      }
      hook.count += 1
      const scope: Scope = { agent, presetId: state.presetId, selection, writeVersion: current.version, source: request.rpcId, signal, armed: true }
      try {
        const reply = await calls.run(scope, () => native(request))
        if (reply.result.ok) {
          if (scope.armed) throw turnDenied()
          await flush()
        }
        signal.throwIfAborted()
        return reply
      } finally {
        scope.armed = false
        if (--hook.count === 0) restore(agent)
      }
    } catch {
      // Ordinary prompt semantics are unchanged; errors from the managed
      // reserved carrier never expose private source/history/authority data.
      if (!selected) throw turnDenied()
      return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: turnDenied().message, details: {} } } }
    }
  } }
}
