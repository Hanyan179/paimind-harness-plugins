import assert from 'node:assert/strict'
import { readHarnessPromptCorrelation } from './prompt-correlation.js'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { boundContextSummary, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'

export interface ManagedHarnessOrigins {
  readonly nativeSessionId: string; readonly presetId: string; readonly sources: readonly string[]
  /** Opaque provenance requirements, never a cached permission. */
  readonly requirements?: readonly string[]
  /** Internal native job continuation only; never supplied by a client or sent
   * over the authority wire. Captured requirements are still checked afresh. */
  readonly skillSelection?: 'captured'
}
export type ManagedHarnessOriginCheck = (input: ManagedHarnessOrigins, signal: AbortSignal) => Promise<void | readonly string[]>
export interface ManagedHarnessLoadedSkill {
  readonly name: string; readonly provider: string; readonly content: string
  readonly resourceBase?: { readonly kind: 'directory'; readonly path: string } | { readonly kind: 'url'; readonly url: string }
    | { readonly kind: 'opaque'; readonly description: string }
}
export interface ManagedHarnessSkillUseReference {
  readonly name: string; readonly publicationId: string; readonly packageDigest: string
}
/** Same-process owner/body and current-authority check. The body is never sent
 * through the authorization wire, and a returned reference is not a grant. */
export type ManagedHarnessSkillUseCheck = (input: ManagedHarnessOrigins, skill: ManagedHarnessLoadedSkill, signal: AbortSignal) =>
  Promise<Readonly<ManagedHarnessSkillUseReference> | undefined>
export interface ManagedHarnessJobOriginRequest extends ManagedHarnessOrigins { readonly nativeJobId: string }
export type ManagedHarnessJobOriginSeal = (input: ManagedHarnessJobOriginRequest, signal: AbortSignal) =>
  Promise<{ readonly nativeSessionId: string; readonly sources: readonly string[] }>

/** Syntax projection only. Authenticity and the exact original login remain
 * the private authority's responsibility on EVERY actual execution. */
export function assertManagedJobSources(input: ManagedHarnessJobOriginRequest, sources: readonly string[]): void {
  if (!Array.isArray(sources) || !sources.length || sources.length > 64 || new Set(sources).size !== sources.length) throw failure()
  for (const source of sources) {
    if (typeof source !== 'string' || source.length > 8192 || !/^paimind-origin-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(source)) throw failure()
    let payload: any
    try { payload = JSON.parse(Buffer.from(source.split('.')[1]!, 'base64url').toString('utf8')) } catch { throw failure() }
    if (!payload || payload.nativeJobId !== input.nativeJobId || payload.nativeSessionId !== input.nativeSessionId
      || payload.delegatedPresetId !== input.presetId) throw failure()
  }
}
const failure = () => new Error('当前消息来源或智能体权限无法验证，执行已停止')
const skillName = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)
function loadedSkill(value: unknown): Readonly<ManagedHarnessLoadedSkill> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure()
  const row = value as Record<string, unknown>
  if (!['content,name,provider', 'content,name,provider,resourceBase'].includes(Object.keys(row).sort().join(','))
    || !skillName(row.name) || typeof row.provider !== 'string' || !row.provider || typeof row.content !== 'string') throw failure()
  if (Object.hasOwn(row, 'resourceBase')) {
    const base = row.resourceBase as Record<string, unknown> | undefined
    if (!base || typeof base !== 'object' || Array.isArray(base)) throw failure()
    const field = base.kind === 'directory' ? 'path' : base.kind === 'url' ? 'url' : base.kind === 'opaque' ? 'description' : undefined
    if (!field || Object.keys(base).sort().join(',') !== [field, 'kind'].sort().join(',') || typeof base[field] !== 'string') throw failure()
  }
  const copy = structuredClone(row)
  if (copy.resourceBase) Object.freeze(copy.resourceBase)
  return Object.freeze(copy) as unknown as Readonly<ManagedHarnessLoadedSkill>
}
function skillUseReference(value: unknown): Readonly<ManagedHarnessSkillUseReference> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure()
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'name,packageDigest,publicationId' || !skillName(row.name)
    || typeof row.publicationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(row.publicationId)
    || typeof row.packageDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(row.packageDigest)) throw failure()
  return Object.freeze({ name: row.name, publicationId: row.publicationId, packageDigest: row.packageDigest })
}
const useSummary = (name: string) => boundContextSummary('已读取企业技能：' + name)
function sourceSkillUse(source: Record<string, unknown>): Readonly<ManagedHarnessSkillUseReference> | undefined {
  if (source.kind === 'skill-invocation' && Object.hasOwn(source, 'paimindSkillUse')) {
    if (Object.keys(source).sort().join(',') !== 'form,kind,name,paimindSkillUse' || source.form !== 'instructions') throw failure()
    const reference = skillUseReference(source.paimindSkillUse)
    if (reference.name !== source.name) throw failure()
    return reference
  }
  if (source.kind !== 'plugin' || source.plugin !== '@paimind/harness-compat') return undefined
  if (Object.keys(source).sort().join(',') !== 'form,kind,paimindSkillUse,plugin,summary' || source.form !== 'notice') throw failure()
  const reference = skillUseReference(source.paimindSkillUse)
  if (source.summary !== useSummary(reference.name)) throw failure()
  return reference
}
const owners = new WeakSet<Context>()
type NativeAgent = NonNullable<ToolExecution['agent']>
export interface ManagedHarnessOriginCapture {
  readonly input: ManagedHarnessOrigins
  readonly signal: AbortSignal
  assertCurrent(): void
}
const captures = new WeakMap<Context, (agent: NativeAgent) => ManagedHarnessOriginCapture>()
const terminalCaptures = new WeakMap<Context, (agent: NativeAgent, messages: readonly unknown[], signal: AbortSignal) => Promise<ManagedHarnessOriginCapture>>()
/** Internal delegation seam: an actual guarded active turn is mandatory. */
export function captureManagedHarnessOrigins(root: Context, agent: NativeAgent): ManagedHarnessOriginCapture {
  const capture = captures.get(root)
  if (!capture) throw failure()
  return capture(agent)
}
/** Internal terminal-delivery seam. Inputs must be actual native message
 * objects, not supplied source strings or a replacement parent's login. */
export function captureManagedHarnessTerminalOrigins(root: Context, agent: NativeAgent, messages: readonly unknown[], signal: AbortSignal) {
  const capture = terminalCaptures.get(root)
  if (!capture) throw failure()
  return capture(agent, messages, signal)
}
export interface ManagedHarnessExecutionScope {
  readonly agentId: string
  readonly sessionId: string
  readonly presetId?: string
}
/** One version-specific projection shared by the synchronous floor and the
 * asynchronous execution check. A mounted owner never falls back to a header. */
export function executionScope(agent: NativeAgent): Readonly<ManagedHarnessExecutionScope> {
  const value = agent as unknown as { id: string; session: { id: string; header?: { agentPreset?: string } };
    ctx?: { get(name: string): unknown } }
  if (typeof value?.id !== 'string' || !value.id || typeof value.session?.id !== 'string' || !value.session.id) throw failure()
  const presets = value.ctx?.get('agentPresets') as { composedPreset(context: unknown): string | undefined } | undefined
  const presetId = presets === undefined ? value.session.header?.agentPreset : presets.composedPreset(value.ctx)
  if (presetId !== undefined && (typeof presetId !== 'string' || !presetId)) throw failure()
  return Object.freeze({ agentId: value.id, sessionId: value.session.id, ...(presetId === undefined ? {} : { presetId }) })
}
interface TurnFacts { readonly sessionId: string; readonly presetId: string; readonly turn: number; readonly step: number;
  readonly sources: readonly string[]; readonly reportSenders: readonly string[]; readonly contextRequirements: readonly string[] }

/** Read only the original model-visible surface and its declared provenance.
 * A native replacement/compaction still derives from the nodes it cites. An
 * unrelated log-only/queued message does not enter this projection. These IDs
 * only ADD requirements to a fresh current-principal check; they never grant
 * access or keep the original sender's historical login alive. */
function contextRequirements(agent: NativeAgent, accepted: readonly unknown[] = []): readonly string[] {
  const { session } = agent, events = session.events, nodes = session.surface?.nodes
  if (!Array.isArray(nodes)) throw failure()
  const pending = [...nodes], visited = new Set<number>(), required = new Set<string>()
  // Only messages selected by the native pre-step/terminal owner count here.
  // A restored additional context must be checked BEFORE its first request;
  // scanning every unrelated raw inbox entry would impose another turn's data.
  for (const message of accepted) {
    const source = (message as { source?: Record<string, unknown> } | null)?.source
    const use = source && sourceSkillUse(source)
    if (use) required.add(use.publicationId)
    if (required.size > 128) throw failure()
  }
  while (pending.length) {
    const seq = pending.pop()!
    if (visited.has(seq)) continue
    const event = events[seq]
    if (!Number.isSafeInteger(seq) || seq < 0 || !event || event.seq !== seq) throw failure()
    visited.add(seq)
    if (event.type === 'user/message') {
      const source = event.data.source as unknown as Record<string, unknown>
      const use = sourceSkillUse(source)
      if (use) required.add(use.publicationId)
      if (required.size > 128) throw failure()
      if (['coordinator', 'subagent-report', 'subagent-settled'].includes(source.kind as string)
        || source.kind === 'plugin' && source.plugin === 'tool-jobs') {
        if (!Array.isArray(source.paimindOrigins) || !source.paimindOrigins.length || source.paimindOrigins.length > 64) throw failure()
        for (const origin of source.paimindOrigins) {
          if (typeof origin !== 'string' || origin.length > 8192
            || !/^paimind-origin-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(origin)) throw failure()
          let payload: any
          try { payload = JSON.parse(Buffer.from(origin.split('.')[1]!, 'base64url').toString('utf8')) } catch { throw failure() }
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw failure()
          const ids = Object.hasOwn(payload, 'requiredSkillIds') ? payload.requiredSkillIds : []
          if (!Array.isArray(ids) || ids.length > 128 || new Set(ids).size !== ids.length
            || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(id))) throw failure()
          for (const id of ids) required.add(id)
          if (required.size > 128) throw failure()
        }
      }
    }
    if (event.type !== 'user/message' && event.type !== 'assistant/message' && event.type !== 'tool/result') continue
    for (const source of event.sourceEventSeqs ?? []) {
      if (!Number.isSafeInteger(source) || source < 0 || source >= seq) throw failure()
      pending.push(source)
    }
  }
  return Object.freeze([...required].sort())
}

function openTurn(agent: NativeAgent) {
  const session = agent.session as unknown as { id: string; events: readonly { type: string; data: any }[] }
  if (typeof session.id !== 'string' || !session.id || !Array.isArray(session.events)) throw failure()
  const start = session.events.findLastIndex(event => event.type === 'turn/start')
  const turn = session.events[start]?.data?.turn
  if (start < 0 || !Number.isSafeInteger(turn) || turn < 1) throw failure()
  const events = session.events.slice(start + 1)
  if (events.some(event => event.type === 'turn/end')) throw failure()
  return { session, turn: turn as number, events }
}

/** Read the canonical active turn, not a shadow Session/turn registry. rc.2
 * appends turn/start before pre-step and appends accepted messages afterward. */
function facts(agent: NativeAgent, extra: readonly unknown[] = []): TurnFacts {
  const scope = executionScope(agent)
  if (!scope.presetId) throw failure()
  const { session, turn, events } = openTurn(agent)
  let step = 0
  const messages: unknown[] = []
  for (const event of events) {
    if (event.type === 'step/start') {
      if (event.data?.turn !== turn || !Number.isSafeInteger(event.data.step) || event.data.step < 1) throw failure()
      step = event.data.step
    }
    if (event.type === 'user/message') messages.push(event.data)
  }
  const origins = messageOrigins(agent, [...messages, ...extra])
  return Object.freeze({ sessionId: session.id, presetId: scope.presetId, turn, step, ...origins,
    contextRequirements: contextRequirements(agent, extra) })
}
/** rc.2's original tool-skill producer adds these durable context messages.
 * They describe registry-owned content, not an independent actor. The human
 * invocation remains a separate signed user message. Never read permission
 * claims from this metadata, parse its prose, or let it authorize a turn alone.
 * Native RPC owns the user source; arbitrary plugin/background kinds still
 * require their own explicit principal below. */
function nativeSkillContext(source: Record<string, unknown>): boolean {
  if (source.kind === 'skill-invocation') {
    if (!['form,kind,name', 'form,kind,name,paimindSkillUse'].includes(Object.keys(source).sort().join(','))
      || source.form !== 'instructions' || !skillName(source.name)) throw failure()
    if (Object.hasOwn(source, 'paimindSkillUse')) sourceSkillUse(source)
    return true
  }
  if (source.kind !== 'skill-catalog') return false
  if (!['entries,form,kind', 'entries,form,kind,update'].includes(Object.keys(source).sort().join(','))
    || source.form !== 'catalog' || Object.hasOwn(source, 'update') && source.update !== true || !Array.isArray(source.entries)) throw failure()
  const names = new Set<string>()
  for (const entry of source.entries) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).sort().join(',') !== 'description,name' || !skillName(entry.name)
      || typeof entry.description !== 'string' || names.has(entry.name)) throw failure()
    names.add(entry.name)
  }
  return true
}
function messageOrigins(agent: NativeAgent, messages: readonly unknown[]) {
  const scope = executionScope(agent)
  const sources = new Set<string>(), reportSenders = new Set<string>()
  for (const message of messages) {
    const source = (message as { source?: { kind?: string; plugin?: string; rpcId?: unknown; form?: string;
      senderSessionId?: string; paimindOrigins?: unknown; summary?: unknown; nativeJobId?: unknown } } | null)?.source
    // Native dynamic context is not a second user's authority. Background or
    // arbitrary plugin messages need their own explicit principal, not a login
    // borrowed from another message in the same turn.
    if (source?.kind === 'plugin' && source.plugin === '@deepseek-ai/dsh-system-prompt') continue
    if (source && sourceSkillUse(source as Record<string, unknown>)) continue
    if (source && nativeSkillContext(source as Record<string, unknown>)) continue
    if (source?.kind === 'plugin' && source.plugin === 'tool-jobs') {
      if (Object.keys(source).sort().join(',') !== 'form,kind,nativeJobId,paimindOrigins,plugin,summary'
        || source.form !== 'notice' || typeof source.summary !== 'string' || !source.summary.trim() || source.summary.length > 1000
        || typeof source.nativeJobId !== 'string' || !source.nativeJobId.trim() || source.nativeJobId.length > 200
        || !Array.isArray(source.paimindOrigins) || !scope.presetId) throw failure()
      assertManagedJobSources({ nativeSessionId: scope.sessionId, presetId: scope.presetId,
        nativeJobId: source.nativeJobId, sources: [] }, source.paimindOrigins)
      for (const value of source.paimindOrigins) sources.add(value)
      continue
    }
    if (source?.kind === 'coordinator' || source?.kind === 'subagent-report' || source?.kind === 'subagent-settled') {
      const header = agent.session.header
      const settled = source.kind === 'subagent-settled'
      if (Object.keys(source).sort().join(',') !== (settled ? 'form,kind,paimindOrigins,senderSessionId,summary' : 'form,kind,paimindOrigins,senderSessionId')
        || source.form !== (settled ? 'notice' : 'relay')
        || settled && (typeof source.summary !== 'string' || !source.summary.trim() || source.summary.length > 1000)
        || typeof source.senderSessionId !== 'string' || !source.senderSessionId || source.senderSessionId.length > 200
        || source.senderSessionId === scope.sessionId
        || !Array.isArray(source.paimindOrigins) || !source.paimindOrigins.length || source.paimindOrigins.length > 64
        || source.paimindOrigins.some(value => typeof value !== 'string' || value.length > 8192
          || !/^paimind-origin-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(value))
        || new Set(source.paimindOrigins).size !== source.paimindOrigins.length) throw failure()
      if (source.kind === 'coordinator') {
        if (header.origin !== 'subagent' || header.parentSession !== source.senderSessionId) throw failure()
      } else reportSenders.add(source.senderSessionId)
      for (const value of source.paimindOrigins) sources.add(value)
      continue
    }
    if (source?.kind !== 'user' || typeof source.rpcId !== 'string'
      || source.rpcId.length > 8192 || !/^paimind-origin-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(source.rpcId)) throw failure()
    sources.add(source.rpcId)
  }
  if (!sources.size || sources.size > 64 || reportSenders.size > 64) throw failure()
  return Object.freeze({ sources: Object.freeze([...sources].sort()), reportSenders: Object.freeze([...reportSenders].sort()) })
}
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, i) => value === b[i])
function retainRequirements(previous: readonly string[], added: void | readonly string[]): readonly string[] {
  if (added !== undefined && (!Array.isArray(added) || added.length > 128
    || added.some(value => typeof value !== 'string' || !value || value.length > 200))) throw failure()
  const result = [...new Set([...previous, ...(added ?? [])])].sort()
  if (result.length > 128) throw failure()
  return Object.freeze(result)
}
const required = (requirements: readonly string[]) => requirements.length ? { requirements } : {}
const same = (a: TurnFacts, b: TurnFacts) => a.sessionId === b.sessionId && a.presetId === b.presetId && a.turn === b.turn && a.step === b.step
  && sameList(a.sources, b.sources) && sameList(a.reportSenders, b.reportSenders) && sameList(a.contextRequirements, b.contextRequirements)

/** Async native lifecycle checks; never install an async monotonic tool guard.
 * The callback owns current identity/resource decisions; no allow is cached. */
export function installManagedHarnessOriginGuard(root: Context, check: ManagedHarnessOriginCheck,
  skillUse?: { check: ManagedHarnessSkillUseCheck; render(skill: ManagedHarnessLoadedSkill): string }): void {
  assert.ok(root === root.root && !owners.has(root)); assert.equal(typeof check, 'function'); owners.add(root)
  assert.equal(root.get('paimindManagedOriginGuard'), undefined, 'Managed origin guard already has a scoped owner')
  if (skillUse) { assert.equal(typeof skillUse.check, 'function'); assert.equal(typeof skillUse.render, 'function') }
  let active = true
  const lifetime = new AbortController()
  const running = new Set<() => void>()
  root.effect(() => () => {
    active = false
    for (const revoke of [...running]) revoke()
    lifetime.abort()
  })
  // A report may remain queued after its child has been released. Consult the
  // native Session owner and non-publishing persistence inspector, never a
  // second lineage registry or a parent login inferred from the message.
  const verifyReportLineage = async (selected: TurnFacts, signal: AbortSignal) => {
    if (!selected.reportSenders.length) return
    type Session = { id?: unknown; header?: { id?: unknown; origin?: unknown; parentSession?: unknown } }
    const sessions = root.get('sessions') as { get(id: string): Session | undefined } | undefined
    const persistence = root.get('sessionPersistence') as { inspect?(id: string, signal: AbortSignal): Promise<{ meta: Session['header'] }> } | undefined
    if (typeof sessions?.get !== 'function') throw failure()
    for (const id of selected.reportSenders) {
      signal.throwIfAborted()
      let session = sessions.get(id)
      if (session === undefined) {
        if (typeof persistence?.inspect !== 'function') throw failure()
        const cold = await persistence.inspect(id, signal)
        signal.throwIfAborted()
        session = sessions.get(id)
        if (session === undefined) {
          if (!cold?.meta) throw failure()
          session = { id, header: cold.meta }
        }
      }
      if (session?.id !== id || session.header?.id !== id || session.header.origin !== 'subagent'
        || session.header.parentSession !== selected.sessionId) throw failure()
    }
  }
  const verify = async (selected: TurnFacts, signal: AbortSignal, requirements: readonly string[] = []) => {
    if (!active) throw failure()
    requirements = retainRequirements(requirements, selected.contextRequirements)
    const deadline = AbortSignal.timeout(4000), combined = AbortSignal.any([signal, deadline, lifetime.signal])
    combined.throwIfAborted()
    return await new Promise<readonly string[]>((resolve, reject) => {
      const aborted = () => reject(failure())
      combined.addEventListener('abort', aborted, { once: true })
      Promise.resolve().then(async () => {
        await verifyReportLineage(selected, combined)
        const observed = await check({ nativeSessionId: selected.sessionId, presetId: selected.presetId, sources: selected.sources, ...required(requirements) }, combined)
        await verifyReportLineage(selected, combined)
        return retainRequirements(requirements, observed)
      })
        .then(value => { if (!active || combined.aborted) reject(failure()); else resolve(value) }, () => reject(failure()))
        .finally(() => combined.removeEventListener('abort', aborted))
    })
  }
  terminalCaptures.set(root, async (agent, messages, signal) => {
    const scope = executionScope(agent), events = agent.session.events, length = events.length
    if (!scope.presetId || !messages.length) throw failure()
    const nativeMessages = new Set<unknown>()
    for (const event of events) {
      if (event.type === 'user/message') nativeMessages.add(event.data)
      if (event.type === 'agent/inbox/spliced') for (const message of event.data.inserted) nativeMessages.add(message)
    }
    if (messages.some(message => !nativeMessages.has(message))) throw failure()
    const origins = messageOrigins(agent, messages)
    const assertCurrent = () => {
      if (!active || signal.aborted || agent.status !== 'idle' || agent.ctx.root !== root
        || root.agents.get(agent.id) !== agent || agent.id !== scope.sessionId || agent.session.events !== events
        || events.length !== length || executionScope(agent).presetId !== scope.presetId) throw failure()
      const start = events.findLastIndex(event => event.type === 'turn/start')
      if (start >= 0 && !events.slice(start + 1).some(event => event.type === 'turn/end')) throw failure()
    }
    assertCurrent()
    const requirements = await verify({ sessionId: scope.sessionId, presetId: scope.presetId, turn: 0, step: 0, ...origins,
      contextRequirements: contextRequirements(agent, messages) }, signal)
    assertCurrent()
    return Object.freeze({ input: Object.freeze({ nativeSessionId: scope.sessionId, presetId: scope.presetId,
      sources: origins.sources, ...required(requirements) }), signal: lifetime.signal, assertCurrent })
  })
  root.effect(() => () => { terminalCaptures.delete(root) })
  // One renewal lifetime per actual native turn, not a Session/permission
  // registry. Polling exists only while that turn is active. Even a stalled
  // checker cannot keep the last allow: freshness expires five seconds after
  // the successful check STARTED, not after a delayed reply finally arrived.
  type Watch = { agent: NativeAgent; turn: number; presetId: string; nativeSignal: AbortSignal;
    signal: AbortSignal; live: boolean; sources: readonly string[]; reportSenders: readonly string[]; requirements: readonly string[];
    renew(started: number): void; stop(): void }
  const watches = new WeakMap<object, Watch>()
  const sourceMessages = (sources: readonly string[]) => sources.map(rpcId => ({ source: { kind: 'user', rpcId } }))
  const watchTurn = (agent: NativeAgent, selected: TurnFacts, nativeSignal: AbortSignal, started: number, requirements: readonly string[]): Watch => {
    if (typeof agent.cancel !== 'function') throw failure()
    const previous = watches.get(agent.session)
    if (previous) {
      if (!previous.live || previous.agent !== agent || previous.turn !== selected.turn
        || previous.presetId !== selected.presetId || previous.nativeSignal !== nativeSignal) throw failure()
      previous.sources = selected.sources; previous.reportSenders = selected.reportSenders
      previous.requirements = retainRequirements(previous.requirements, requirements)
      previous.renew(started); previous.signal.throwIfAborted(); return previous
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined, expiry: ReturnType<typeof setTimeout> | undefined
    let newest = -Infinity
    const belongs = () => { try { return openTurn(agent).turn === selected.turn } catch { return false } }
    const stop = () => {
      if (!watch.live) return
      watch.live = false; clearTimeout(timer); clearTimeout(expiry)
      nativeSignal.removeEventListener('abort', stop); running.delete(revoke)
      if (watches.get(agent.session) === watch) watches.delete(agent.session)
      controller.abort(failure())
    }
    const revoke = () => {
      if (!watch.live) return
      const cancel = belongs() && !nativeSignal.aborted
      stop()
      // Preserve unstarted messages, including those from another still-valid
      // login. Native cancellation owns the transcript and provider teardown.
      if (cancel) agent.cancel({ kind: 'hook', reason: '当前消息权限已失效或无法确认，执行已停止' }, { keepInbox: true })
    }
    const renew = (observed: number) => {
      if (!watch.live || observed < newest) return
      newest = observed; clearTimeout(expiry)
      const remaining = observed + 5000 - performance.now()
      if (remaining <= 0) { revoke(); return }
      expiry = setTimeout(revoke, remaining); expiry.unref?.()
    }
    const read = () => {
      const current = facts(agent, sourceMessages(watch.sources))
      if (current.turn !== watch.turn || current.presetId !== watch.presetId) throw failure()
      return Object.freeze({ ...current, reportSenders: Object.freeze([...new Set([...current.reportSenders, ...watch.reportSenders])].sort()) })
    }
    const schedule = (delay: number) => { timer = setTimeout(() => { timer = undefined; void tick() }, delay); timer.unref?.() }
    const tick = async () => {
      const observed = performance.now()
      try {
        const current = read()
        const requirements = await verify(current, controller.signal, watch.requirements)
        if (!watch.live) return
        watch.requirements = retainRequirements(watch.requirements, requirements)
        const after = read()
        // A legitimate next step may have accepted additional signed sources
        // during the read. Recheck them immediately without renewing old proof.
        if (!sameList(current.sources, after.sources) || !sameList(current.reportSenders, after.reportSenders)
          || !sameList(current.contextRequirements, after.contextRequirements)) schedule(0)
        else renew(observed)
      } catch { if (watch.live) revoke() }
      finally { if (watch.live && timer === undefined) schedule(1000) }
    }
    const watch: Watch = { agent, turn: selected.turn, presetId: selected.presetId, nativeSignal,
      signal: controller.signal, live: true, sources: selected.sources, reportSenders: selected.reportSenders, requirements, renew, stop }
    watches.set(agent.session, watch); running.add(revoke)
    nativeSignal.addEventListener('abort', stop, { once: true })
    renew(started)
    if (nativeSignal.aborted) stop()
    watch.signal.throwIfAborted(); schedule(1000)
    return watch
  }
  root.on('session/event', (session, event) => {
    const watch = watches.get(session)
    if (watch && event.type === 'turn/end' && event.data.turn === watch.turn) watch.stop()
  })
  const currentWatch = (agent: NativeAgent, selected: TurnFacts): Watch => {
    const watch = watches.get(agent.session)
    if (!watch?.live || watch.agent !== agent || watch.turn !== selected.turn || watch.presetId !== selected.presetId
      || selected.contextRequirements.some(id => !watch.requirements.includes(id))) throw failure()
    watch.signal.throwIfAborted(); return watch
  }
  const attestSkill = async (selected: TurnFacts, watch: Watch, value: unknown, read: () => TurnFacts, signal: AbortSignal) => {
    if (!skillUse) throw failure()
    const skill = loadedSkill(value), started = performance.now()
    const combined = AbortSignal.any([signal, watch.signal, lifetime.signal, AbortSignal.timeout(4000)])
    combined.throwIfAborted()
    const reference = await new Promise<Awaited<ReturnType<ManagedHarnessSkillUseCheck>>>((resolve, reject) => {
      const aborted = () => reject(failure())
      combined.addEventListener('abort', aborted, { once: true })
      Promise.resolve().then(() => skillUse.check({ nativeSessionId: selected.sessionId, presetId: selected.presetId,
        sources: selected.sources, ...required(watch.requirements) }, skill, combined))
        .then(resolve, reject).finally(() => combined.removeEventListener('abort', aborted))
    })
    combined.throwIfAborted()
    if (!active || !watch.live || !same(selected, read())) throw failure()
    if (reference === undefined) return undefined
    const checked = skillUseReference(reference)
    if (checked.name !== skill.name) throw failure()
    watch.requirements = retainRequirements(watch.requirements, [checked.publicationId])
    watch.renew(started)
    return checked
  }
  root.effect(() => {
    const capture = (agent: NativeAgent): ManagedHarnessOriginCapture => {
      const selected = facts(agent), watch = currentWatch(agent, selected), requirements = watch.requirements
      const assertCurrent = () => {
        if (!active || currentWatch(agent, selected) !== watch || !same(selected, facts(agent))
          || !sameList(selected.sources, watch.sources) || !sameList(selected.reportSenders, watch.reportSenders)
          || !sameList(requirements, watch.requirements)) throw failure()
      }
      assertCurrent()
      return Object.freeze({ input: Object.freeze({ nativeSessionId: selected.sessionId, presetId: selected.presetId, sources: selected.sources, ...required(requirements) }),
        signal: watch.signal, assertCurrent })
    }
    captures.set(root, capture)
    return () => { if (captures.get(root) === capture) captures.delete(root) }
  })
  root.on('agent/pre-step', async (event, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const selected = facts(event.agent, decision.messages)
    if (selected.turn !== event.turn || event.step !== selected.step + 1) throw failure()
    if (selected.sources.some(rpcId => readHarnessPromptCorrelation({ kind: 'user', rpcId }, selected.sessionId)?.startsWith('haas-turn-v1.'))) {
      // The original durable inbox insertion must survive a process loss BEFORE
      // model/tool execution. Post-response flush alone cannot provide that
      // ordering. Native SessionStore owns the checkpoint and its failure;
      // never reconstruct a second receipt/history or assume no listener means
      // durable. This barrier is only for the versioned submission carrier.
      const signal = AbortSignal.any([event.signal, lifetime.signal, AbortSignal.timeout(4000)])
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(failure())
        signal.addEventListener('abort', abort, { once: true })
        Promise.resolve().then(async () => {
          signal.throwIfAborted()
          if (!(await root.sessions.flush(event.agent.session))) throw failure()
          signal.throwIfAborted()
        }).then(resolve, () => reject(failure())).finally(() => signal.removeEventListener('abort', abort))
      })
    }
    const started = performance.now()
    const previous = watches.get(event.agent.session)
    if (previous && (!previous.live || previous.agent !== event.agent || previous.turn !== selected.turn || previous.presetId !== selected.presetId)) throw failure()
    const requirements = await verify(selected, event.signal, previous?.requirements)
    if (!same(selected, facts(event.agent, decision.messages))) throw failure()
    const watch = watchTurn(event.agent, selected, event.signal, started, requirements)
    if (!skillUse) return decision
    const messages: UserMessage[] = []
    for (const message of decision.messages) {
      const source = message.source as unknown as Record<string, unknown>
      if (source.kind !== 'skill-invocation') { messages.push(message); continue }
      const registry = event.agent.ctx.get('skills') as { get(name: string, options: unknown): Promise<ManagedHarnessLoadedSkill | undefined> } | undefined
      if (!registry || !skillName(source.name)) throw failure()
      const loaded = await registry.get(source.name, { cwd: event.agent.session.header.cwd, scope: event.agent, signal: event.signal })
      if (!loaded) throw failure()
      const value = loadedSkill({ name: loaded.name, provider: loaded.provider, content: loaded.content,
        ...(loaded.resourceBase === undefined ? {} : { resourceBase: loaded.resourceBase }) })
      if (message.content.length !== 1 || message.content[0]?.type !== 'text' || message.content[0].text !== skillUse.render(value)) throw failure()
      const reference = await attestSkill(selected, watch, value, () => facts(event.agent, decision.messages), event.signal)
      if (Object.hasOwn(source, 'paimindSkillUse') && JSON.stringify(sourceSkillUse(source)) !== JSON.stringify(reference)) throw failure()
      messages.push(reference ? { ...message, source: { ...source, paimindSkillUse: reference } } as unknown as UserMessage : message)
    }
    return { ...decision, messages }
  }, { prepend: true })
  const prepared = new WeakMap<object, { selected: TurnFacts; watch: Watch }>()
  root.on('tools/pre-execute', async (execution, next) => {
    if (!execution.agent) throw failure()
    const selected = facts(execution.agent)
    const watch = currentWatch(execution.agent, selected)
    const requirements = await verify(selected, AbortSignal.any([execution.signal, watch.signal]), watch.requirements)
    if (!same(selected, facts(execution.agent))) throw failure()
    watch.requirements = retainRequirements(watch.requirements, requirements)
    prepared.set(execution, { selected, watch })
    return next()
  }, { prepend: true })
  root.on('tools/execute', async (execution, next) => {
    const entry = prepared.get(execution); prepared.delete(execution)
    if (!entry || !execution.agent || !same(entry.selected, facts(execution.agent))) throw failure()
    const { selected, watch } = entry
    if (currentWatch(execution.agent, selected) !== watch) throw failure()
    const original = execution.signal, combined = AbortSignal.any([original, watch.signal])
    const requirements = await verify(selected, combined, watch.requirements)
    if (!same(selected, facts(execution.agent))) throw failure()
    watch.requirements = retainRequirements(watch.requirements, requirements)
    // The original registry fuses this delegated signal with its captured
    // caller signal; downstream wrappers cannot detach either cancellation.
    execution.signal = combined
    try {
      const result = await next()
      // The original scheduler converts a started call to its canonical abort
      // outcome and drains the composite's deferred contexts. Throwing here
      // instead discards already-read nested provenance along with the result.
      // No new body attestation or value delivery may start after cancellation.
      if (original.aborted) return result
      combined.throwIfAborted()
      if (skillUse && execution.name === 'skill' && !result.isError) {
        const reference = await attestSkill(selected, watch, result.value, () => facts(execution.agent!), combined)
        if (reference) {
          const context = createUserMessage({ source: { kind: 'plugin', plugin: '@paimind/harness-compat', form: 'notice',
            summary: useSummary(reference.name), paimindSkillUse: reference } as UserMessage['source'],
          content: [{ type: 'text', text: `本轮已读取企业技能「${reference.name}」的固定版本，后续运行仍需验证当前授权。` }] })
          // Native additionalContexts are ferried by composite tools and
          // committed by the original loop. Do not borrow tool-private meta,
          // rewrite tool identity/output, or append a second event vocabulary.
          return { ...result, additionalContexts: [...result.additionalContexts ?? [], context] }
        }
      }
      return result
    } finally { execution.signal = original }
  }, { prepend: true })
  // Publish only after every lifecycle hook has registered. This witness is
  // not an allow decision: downstream native steps still invoke check above.
  // Native scope owns removal; a retained witness refuses after disposal.
  root.provide('paimindManagedOriginGuard', Object.freeze({
    schema: 'paimind.managed-origin-guard/v1',
    assertReady() { if (!active || lifetime.signal.aborted) throw failure() },
  }))
}
