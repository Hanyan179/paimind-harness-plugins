import { defineTool } from '@deepseek-ai/dsh-tools'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { Service, type Context } from '@deepseek-ai/cordis'
import {
  Remote,
  TypertRemoteService,
} from '@deepseek-ai/dsh-typert-protocol'
import {
  defineDomain,
  domainTable,
} from '@deepseek-ai/dsh-storage-domain'
import {
  foldScheduleEvents,
  scheduleView,
} from '@deepseek-ai/dsh-schedule'
import { resolveHarnessSettingsNamespace } from './index.js'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { isAbsolute, normalize } from 'node:path'
import { createHash } from 'node:crypto'

/** Host Remote base kept behind the rc.8 compatibility boundary. */
export abstract class PaimindHostRemoteService extends TypertRemoteService {
  protected constructor(ctx: object, serviceKey: string) {
    super(ctx as Context, serviceKey)
  }
}

/** Cordis service base kept inside the compatibility boundary for PAIMind Host services. */
export abstract class PaimindHostService extends Service {
  protected constructor(ctx: object, serviceKey: string) {
    super(ctx as Context, serviceKey)
  }
}

/** Same-process installation witness only, never a current execution grant.
 * The original root guard still checks each native step/tool independently.
 * Keeping the witness in the native service scope also works across separately
 * bundled public entry points without a duplicate module-private authority. */
export function assertPaimindManagedOriginGuard(context: { get(name: 'paimindManagedOriginGuard'): unknown }): void {
  const value = context.get('paimindManagedOriginGuard') as {
    schema?: unknown; assertReady?: () => unknown
  } | undefined
  const failure = () => new Error('企业采用版本需要当前运行时的来源与权限守卫')
  if (!value || value.schema !== 'paimind.managed-origin-guard/v1' || typeof value.assertReady !== 'function') throw failure()
  const result = value.assertReady()
  if (result !== undefined) {
    if (typeof (result as PromiseLike<unknown>)?.then === 'function') void Promise.resolve(result).catch(() => undefined)
    throw failure()
  }
}

/** Native rc.2 owns preset creation; no composition text or target path crosses
 * this facade. The native copy operation refuses every occupied target. */
export async function copyPaimindNativeStandardPreset(
  context: { readonly agentPresets: { copy?(from: string, id: string, name?: string): Promise<void> } },
  presetId: string, name: string,
): Promise<void> {
  if (typeof presetId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,159}$/.test(presetId) || typeof name !== 'string' || name.length > 80) {
    throw new Error('原生标准预设复制参数无效')
  }
  if (typeof context.agentPresets.copy !== 'function') throw new Error('原生标准预设复制服务不可用')
  await context.agentPresets.copy('standard', presetId, name)
}

/** Detached read-only identity and events; never a second Session owner. */
export interface PaimindNativeSessionReference {
  readonly id: string
  readonly header: { readonly id: string; readonly agentPreset?: string; readonly seedLength?: number }
  readonly events: readonly unknown[]
}

/** Read through native live ownership, then the native non-publishing inspector. */
export async function readPaimindNativeSessionReference(
  context: { readonly sessions: { get(id: string): unknown }; get(name: 'sessionPersistence'): unknown },
  sessionId: string,
): Promise<Readonly<PaimindNativeSessionReference>> {
  const session = await nativeSessionSnapshot(context, sessionId)
  return Object.freeze({ id: sessionId, header: Object.freeze({ id: sessionId,
    ...(typeof session.header.agentPreset === 'string' ? { agentPreset: session.header.agentPreset } : {}),
    ...(typeof session.header.seedLength === 'number' ? { seedLength: session.header.seedLength } : {}) }),
  events: Object.freeze([...session.events]) })
}

/** Read-only original cwd, including cold history; never invokes agent resume. */
export async function readPaimindNativeSessionDirectoryReference(
  context: Parameters<typeof readPaimindNativeSessionReference>[0], sessionId: string, signal: AbortSignal,
): Promise<Readonly<{ sessionId: string; cwd: string }>> {
  signal.throwIfAborted()
  const session = await nativeSessionSnapshot(context, sessionId, signal)
  signal.throwIfAborted()
  const cwd = session.header.cwd
  if (typeof cwd !== 'string' || cwd.length > 4096 || cwd.includes('\0') || !isAbsolute(cwd)
    || normalize(cwd) !== cwd) throw new Error('原生会话目录无法验证')
  return Object.freeze({ sessionId, cwd })
}

async function nativeSessionSnapshot(
  context: Parameters<typeof readPaimindNativeSessionReference>[0], sessionId: string, signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 200
    || sessionId.trim() !== sessionId || /[\u0000-\u001f\u007f]/u.test(sessionId)) throw new Error('原生会话标识无效')
  const reference = (value: unknown) => {
    const session = value as { id?: unknown; header?: { id?: unknown; agentPreset?: unknown; cwd?: unknown; seedLength?: unknown }; events?: unknown } | undefined
    if (!session || session.header?.id !== sessionId || session.id !== undefined && session.id !== sessionId
      || !Array.isArray(session.events) || session.header.agentPreset !== undefined && typeof session.header.agentPreset !== 'string') {
      throw new Error('原生会话身份或历史无法验证')
    }
    if (session.header.seedLength !== undefined && (!Number.isSafeInteger(session.header.seedLength)
      || (session.header.seedLength as number) < 0 || (session.header.seedLength as number) > session.events.length)) {
      throw new Error('原生会话种子边界无法验证')
    }
    return { header: { ...session.header }, events: [...session.events] }
  }
  const live = context.sessions.get(sessionId)
  if (live !== undefined) return reference(live)
  const persistence = context.get('sessionPersistence') as {
    inspect?(id: string, signal: AbortSignal): Promise<{ meta: unknown; events: unknown }>
  } | undefined
  if (typeof persistence?.inspect !== 'function') throw new Error('原生历史会话检查服务不可用')
  let cold: { meta: unknown; events: unknown }
  try { cold = await persistence.inspect(sessionId, AbortSignal.any([AbortSignal.timeout(5_000), ...(signal ? [signal] : [])])) }
  catch { throw new Error('原生会话不存在或历史无法读取') }
  signal?.throwIfAborted()
  // A concurrently published native Session supersedes the inspected cold view.
  const current = context.sessions.get(sessionId)
  return reference(current ?? { header: cold?.meta, events: cold?.events })
}

export interface PaimindNativeEventSelection { readonly afterSeq: number; readonly afterDigest?: string }
export interface PaimindNativeEvent {
  readonly seq: number; readonly time: number; readonly digest: string
  readonly kind: 'user.message' | 'assistant.message' | 'turn.started' | 'turn.ended' | 'step.started' | 'step.ended'
    | 'tool.started' | 'tool.ended' | 'queue.changed' | 'session.checkpoint' | 'approval.required' | 'approval.decided'
  readonly data: Readonly<Record<string, string | number | boolean>>
}
export type PaimindNativeEventPage = {
  readonly sessionId: string; readonly afterSeq: number; readonly headSeq: number; readonly hasMore: boolean
  readonly events: readonly PaimindNativeEvent[]; readonly cursorMatched: boolean
}

/** One bounded, detached projection of the original log. No history cache,
 * resume, persistence write or event subscription is owned by this reader.
 * Prefix checks detect truncation/replacement instead of silently moving a
 * cursor. Internal sources, request configs and reasoning never cross it. */
export async function readPaimindNativeSessionEventPage(
  context: Parameters<typeof readPaimindNativeSessionReference>[0], sessionId: string,
  selection: PaimindNativeEventSelection, signal: AbortSignal,
): Promise<PaimindNativeEventPage> {
  signal.throwIfAborted()
  if (!Number.isSafeInteger(selection.afterSeq) || selection.afterSeq < -1
    || (selection.afterSeq === -1 ? selection.afterDigest !== undefined
      : typeof selection.afterDigest !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(selection.afterDigest)
        || Buffer.from(selection.afterDigest, 'base64url').toString('base64url') !== selection.afterDigest)) throw Error('事件游标格式无效')
  const original = await nativeSessionSnapshot(context, sessionId, signal)
  signal.throwIfAborted()
  const events = original.events
  if (events.length > 10000 || Buffer.byteLength(JSON.stringify(events)) > 2 * 1024 * 1024) throw Error('原生事件历史超出读取界限')
  const result: PaimindNativeEvent[] = [], headSeq = events.length - 1
  if (selection.afterSeq > headSeq) return { sessionId, afterSeq: selection.afterSeq, headSeq, events: [], hasMore: false, cursorMatched: false }
  const hash = createHash('sha256').update(JSON.stringify({ sessionId, seedLength: original.header.seedLength ?? 0 }) + '\n')
  let cursorMatched = selection.afterSeq === -1, bytes = 0
  const record = (value: unknown): Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
  for (let seq = 0; seq < events.length; seq++) {
    const event = record(events[seq])
    if (event.seq !== seq || typeof event.type !== 'string' || typeof event.time !== 'number' || !Number.isFinite(event.time)) throw Error('原生事件顺序无法验证')
    hash.update(JSON.stringify(events[seq]) + '\n')
    const digest = hash.copy().digest('base64url')
    if (seq === selection.afterSeq) cursorMatched = digest === selection.afterDigest
    if (seq <= selection.afterSeq) continue
    if (!cursorMatched) break
    let kind: PaimindNativeEvent['kind'] = 'session.checkpoint', data: Record<string, string | number | boolean> = {}
    const raw = record(event.data), message = event.type === 'user/message' ? raw : record(raw.message)
    if (['user/message', 'assistant/message'].includes(event.type)
      && record(message.source).kind === (event.type === 'user/message' ? 'user' : 'model')
      && message.visibility !== 'hidden' && message.hidden !== true && raw.visibility !== 'hidden' && raw.hidden !== true) {
      if (!Array.isArray(message.content)) throw Error('原生消息内容无法验证')
      const blocks = message.content.filter((block: unknown) => {
        const item = record(block); return item.type === 'text' && typeof item.text === 'string' && item.visibility !== 'hidden' && item.hidden !== true
      })
      kind = event.type === 'user/message' ? 'user.message' : 'assistant.message'
      data = { text: blocks.map((block: any) => block.text).join('\n'), omittedBlocks: message.content.length - blocks.length }
    } else if (['turn/start', 'turn/end', 'step/start', 'step/end'].includes(event.type)) {
      if (!Number.isSafeInteger(raw.turn) || raw.turn < 1) throw Error('原生轮次无法验证')
      kind = ({ 'turn/start': 'turn.started', 'turn/end': 'turn.ended', 'step/start': 'step.started', 'step/end': 'step.ended' } as const)[event.type as 'turn/start']
      data = { turn: raw.turn }
      if (event.type.startsWith('step/')) {
        if (!Number.isSafeInteger(raw.step) || raw.step < 1) throw Error('原生步骤无法验证')
        data.step = raw.step
      }
      if (event.type === 'turn/end') data.reason = ['completed', 'blocked', 'aborted', 'interrupted', 'error', 'max-tokens'].includes(raw.reason?.kind) ? raw.reason.kind : 'unknown'
    } else if (event.type === 'tool/call' && typeof raw.callId === 'string' && typeof raw.name === 'string') {
      if (raw.callId.length > 200 || raw.name.length > 200) throw Error('原生工具标识超出界限')
      kind = 'tool.started'; data = { callId: raw.callId, name: raw.name }
    } else if (event.type === 'tool/result' && typeof message.callId === 'string' && typeof message.isError === 'boolean') {
      if (message.callId.length > 200) throw Error('原生工具标识超出界限')
      kind = 'tool.ended'; data = { callId: message.callId, isError: message.isError }
    } else if (['approval/asked', 'approval/decided'].includes(event.type)) {
      const approval = projectNativeApprovalReference(sessionId, events.slice(0, seq + 1), raw.id)
      kind = event.type === 'approval/asked' ? 'approval.required' : 'approval.decided'
      data = { approvalId: approval.approvalId, version: approval.version, toolName: approval.toolName }
      if (approval.outcome !== null) data.outcome = approval.outcome
    } else if (event.type === 'agent/inbox/spliced') kind = 'queue.changed'
    const projected = { seq, time: event.time, digest, kind, data }, length = Buffer.byteLength(JSON.stringify(projected))
    if (length > 128 * 1024) throw Error('单个原生事件超出读取界限')
    if (result.length >= 128 || bytes + length > 128 * 1024) break
    bytes += length; result.push(projected)
  }
  signal.throwIfAborted()
  return { sessionId, afterSeq: selection.afterSeq, headSeq, events: cursorMatched ? result : [], cursorMatched,
    hasMore: cursorMatched && (result.at(-1)?.seq ?? selection.afterSeq) < headSeq }
}

/** Original audit state is distinct from a live, answerable native request.
 * rpcId is private owner correlation only, never a public approval grant. */
export interface PaimindNativeApprovalReference {
  readonly sessionId: string; readonly approvalId: string; readonly version: string
  readonly toolName: string; readonly askedSeq: number; readonly decidedSeq: number | null
  readonly outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable' | null
  readonly answerable: boolean; readonly rpcId: string | null
  readonly persisted: boolean
}

function projectNativeApprovalReference(sessionId: string, events: readonly unknown[], approvalId: unknown): PaimindNativeApprovalReference {
  if (typeof approvalId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(approvalId)) throw Error('原生审批标识无效')
  if (events.length > 10000 || Buffer.byteLength(JSON.stringify(events)) > 2 * 1024 * 1024) throw Error('原生审批历史超出读取界限')
  let asked: any, decided: any
  for (let seq = 0; seq < events.length; seq++) {
    const event = events[seq] as { seq?: unknown; type?: unknown; data?: { id?: unknown; toolName?: unknown; outcome?: unknown } }
    if (!event || event.seq !== seq) throw Error('原生审批历史顺序无法验证')
    if (event.data?.id !== approvalId || !['approval/asked', 'approval/decided'].includes(event.type as string)) continue
    if (event.type === 'approval/asked') {
      if (asked || typeof event.data.toolName !== 'string' || !event.data.toolName || event.data.toolName.length > 200) throw Error('原生审批请求无法验证')
      asked = event
    } else {
      if (!asked || decided || !['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(event.data.outcome as string)) throw Error('原生审批决定无法验证')
      decided = event
    }
  }
  if (!asked) throw Error('原生审批不存在或历史不可读')
  return { sessionId, approvalId, toolName: asked.data.toolName, askedSeq: asked.seq, decidedSeq: decided?.seq ?? null,
    outcome: decided?.data.outcome ?? null, answerable: false, rpcId: null, persisted: false,
    version: createHash('sha256').update(JSON.stringify({ sessionId, approvalId, asked, decided: decided ?? null })).digest('base64url') }
}

/** Physical stored-prefix read, unlike inspect() which may borrow live memory.
 * A matching terminal pair proves storage, not who caused it or tool success.
 * Never flush, repair, resume or reconstruct a pending request while reading. */
async function persistedApproval(context: { get(name: 'sessionPersistence'): unknown },
  state: PaimindNativeApprovalReference, signal: AbortSignal): Promise<PaimindNativeApprovalReference> {
  signal.throwIfAborted()
  if (state.outcome === null) return state
  const owner = context.get('sessionPersistence') as {
    readFrom?(id: string, fromSeq: number, signal: AbortSignal): Promise<{ meta: { id?: unknown }; events: unknown[] }>
    readStoredRevision?(id: string, signal: AbortSignal): Promise<unknown>
  } | undefined
  if (typeof owner?.readFrom !== 'function' || typeof owner.readStoredRevision !== 'function') throw Error('原生审批持久化读取不可用')
  const revision = await owner.readStoredRevision(state.sessionId, signal)
  signal.throwIfAborted()
  if (revision === undefined) return state
  const stored = await owner.readFrom(state.sessionId, 0, signal)
  signal.throwIfAborted()
  if (stored.meta?.id !== state.sessionId || !Array.isArray(stored.events)
    || stored.events.length > 10000 || Buffer.byteLength(JSON.stringify(stored.events)) > 2 * 1024 * 1024) throw Error('原生审批持久化身份或范围无法验证')
  if (stored.events.length <= state.askedSeq) return state
  const confirmed = projectNativeApprovalReference(state.sessionId, stored.events, state.approvalId)
  if (confirmed.outcome !== null && confirmed.version !== state.version) throw Error('原生审批持久化结果冲突')
  return { ...state, persisted: confirmed.outcome !== null && confirmed.version === state.version }
}

/** Detached historical projection plus bounded observation of the original
 * ApiProxy pending snapshot. No second pending table, resume, decision or
 * persistence write. Absence of a frame means not observed answerable, never
 * automatic rejection, approval, restart recovery or retry permission. */
export async function readPaimindNativeApprovalReference(
  context: { readonly sessions: { get(id: string): unknown }; get(name: 'sessionPersistence' | 'apiProxy'): unknown },
  sessionId: string, approvalId: string, signal: AbortSignal,
): Promise<PaimindNativeApprovalReference> {
  const before = await nativeSessionSnapshot(context, sessionId, signal)
  const state = projectNativeApprovalReference(sessionId, before.events, approvalId)
  const live = context.sessions.get(sessionId)
  if (state.outcome !== null || !live || state.askedSeq < (typeof before.header.seedLength === 'number' ? before.header.seedLength : 0)) return persistedApproval(context, state, signal)
  const api = context.get('apiProxy') as { events?: { mux(request: { rpcId: string; payload: object }, signal: AbortSignal): AsyncIterable<unknown> } } | undefined
  if (typeof api?.events?.mux !== 'function') return state
  const stop = new AbortController(), observation = AbortSignal.any([signal, stop.signal])
  const deadline = setTimeout(() => stop.abort(), 250); deadline.unref()
  let rpcId: string | null = null, count = 0
  try {
    for await (const raw of api.events.mux({ rpcId: 'approval-read', payload: {} }, observation)) {
      signal.throwIfAborted()
      if (++count > 512) throw Error('原生审批观察超出读取界限')
      const frame = raw as { rpcId?: unknown; payload?: { type?: unknown; sessionId?: unknown; approvalId?: unknown; toolName?: unknown } }
      if (frame.payload?.type === 'stream/error') throw Error('原生审批观察失败')
      if (frame.payload?.type !== 'approval/requested' || frame.payload.sessionId !== sessionId || frame.payload.approvalId !== approvalId) continue
      if (typeof frame.rpcId !== 'string' || !frame.rpcId || frame.rpcId.length > 200 || frame.payload.toolName !== state.toolName) throw Error('原生审批关联无法验证')
      rpcId = frame.rpcId; break
    }
  } catch (error) { if (!stop.signal.aborted || signal.aborted) throw error }
  finally { clearTimeout(deadline); stop.abort() }
  signal.throwIfAborted()
  const after = await nativeSessionSnapshot(context, sessionId, signal)
  const latest = projectNativeApprovalReference(sessionId, after.events, approvalId)
  if (latest.version !== state.version || context.sessions.get(sessionId) !== live) return persistedApproval(context, latest, signal)
  return { ...latest, answerable: rpcId !== null, rpcId }
}

/** Minimal private governance readback, not a session/permission registry. */
export interface PaimindNativeSessionPresetReference {
  readonly sessionId: string
  readonly agentPreset: string | null
  readonly hasForkBoundary: boolean
}

export async function readPaimindNativeSessionPresetReference(
  context: Parameters<typeof readPaimindNativeSessionReference>[0], sessionId: string, signal: AbortSignal,
): Promise<Readonly<PaimindNativeSessionPresetReference>> {
  signal.throwIfAborted()
  const session = await nativeSessionSnapshot(context, sessionId, signal)
  signal.throwIfAborted()
  // The original resolver consumes header.agentPreset and the native selected
  // events. Use the detached original header, not a fabricated creation fact
  // or a reconstruction of the native selection algorithm.
  const preset = resolveSessionPreset(session as unknown as Parameters<typeof resolveSessionPreset>[0])
  if (preset !== undefined && (typeof preset !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,159}$/u.test(preset))) {
    throw new Error('原生会话智能体身份无法验证')
  }
  return Object.freeze({ sessionId, agentPreset: preset ?? null,
    hasForkBoundary: session.events.some(event => event !== null && typeof event === 'object' && 'type' in event && event.type === 'turn/end') })
}

/** rc.2's cold list uses the creation header, unlike its live list and resume
 * resolver. Correct only this display field through the original non-publishing
 * inspector and preset resolver. No log writes, Agent activation, cache, shadow
 * registry, cross-cell lookup or authorization decision is introduced. */
export function projectPaimindNativeSessionList(
  context: Parameters<typeof readPaimindNativeSessionReference>[0] & Pick<Context, 'effect'>,
  sessions: ApiProxy['sessions'],
): ApiProxy['sessions'] {
  const lifetime = new AbortController()
  context.effect(() => () => lifetime.abort())
  const native = sessions.list.bind(sessions)
  let pending = 0
  return { ...sessions, async list(input) {
    if (lifetime.signal.aborted || pending >= 4) return failure()
    pending += 1
    const stop = new AbortController(), signal = AbortSignal.any([lifetime.signal, stop.signal, AbortSignal.timeout(5_000)])
    const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
      signal.throwIfAborted()
      return new Promise<T>((resolve, reject) => {
        const abort = () => reject(new Error('Native list read aborted'))
        signal.addEventListener('abort', abort, { once: true })
        Promise.resolve().then(() => { signal.throwIfAborted(); return operation() })
          .then(value => { signal.throwIfAborted(); resolve(value) }, reject)
          .catch(reject).finally(() => signal.removeEventListener('abort', abort))
      })
    }
    function failure(): Awaited<ReturnType<ApiProxy['sessions']['list']>> {
      return { rpcId: input.rpcId, result: { ok: false, error: { code: 'internal',
        message: '无法确认会话列表中的当前智能体，请重试。', details: {} } } }
    }
    try {
      const response = await bounded(() => native(input))
      if (!response.result.ok) return response
      const original = response.result.value.items, items = [...original]
      let next = 0
      await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
        while (next < items.length) {
          signal.throwIfAborted()
          const index = next++, row = original[index]!
          const reference = await bounded(() => readPaimindNativeSessionPresetReference(context, row.sessionId, signal))
          const { agentPreset: _creationPreset, ...fields } = row
          items[index] = { ...fields, ...(reference.agentPreset === null ? {} : { agentPreset: reference.agentPreset }) }
        }
      }))
      signal.throwIfAborted()
      return { ...response, result: { ...response.result, value: { ...response.result.value, items } } }
    } catch { return failure() }
    finally { stop.abort(); pending -= 1 }
  } }
}

export interface PaimindNativeSessionCreationReference {
  readonly sessionId: string | null
  readonly kind: 'new' | 'existing'
  readonly agentPreset: string | null
}

/** Read-only rc.2 creation resolution. The selected JSONL owner exposes its
 * revision lookup: only explicit absence means new; corrupt/unreadable stored
 * sessions are never reclassified from a failed inspection. No registry, raw
 * file scan, recovery commit or native session creation happens here. */
export async function readPaimindNativeSessionCreationReference(
  context: Parameters<typeof readPaimindNativeSessionReference>[0] & { get(name: 'agentPresets'): unknown },
  sessionId: string | undefined, signal: AbortSignal,
): Promise<Readonly<PaimindNativeSessionCreationReference>> {
  signal.throwIfAborted()
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200
    || sessionId.trim() !== sessionId || /[\u0000-\u001f\u007f]/u.test(sessionId))) throw Error('原生会话标识无效')
  const existing = async (): Promise<Readonly<PaimindNativeSessionCreationReference> | undefined> => {
    if (sessionId === undefined) return undefined
    let present = context.sessions.get(sessionId) !== undefined
    if (!present) {
      const persistence = context.get('sessionPersistence') as { readStoredRevision?(id: string, signal: AbortSignal): Promise<unknown> } | undefined
      if (typeof persistence?.readStoredRevision !== 'function') throw Error('原生会话存在性检查不可用')
      present = await persistence.readStoredRevision(sessionId, signal) !== undefined
      signal.throwIfAborted()
      present ||= context.sessions.get(sessionId) !== undefined
    }
    if (!present) return undefined
    const reference = await readPaimindNativeSessionPresetReference(context, sessionId, signal)
    return Object.freeze({ sessionId, kind: 'existing', agentPreset: reference.agentPreset })
  }
  const current = await existing()
  if (current) return current
  const presets = context.get('agentPresets') as { resolve?(id?: string): Promise<{ id: string }> } | undefined
  if (typeof presets?.resolve !== 'function') throw Error('原生默认智能体检查不可用')
  const selected = await presets.resolve()
  signal.throwIfAborted()
  if (typeof selected?.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,159}$/u.test(selected.id)) throw Error('原生默认智能体身份无法验证')
  return await existing() ?? Object.freeze({ sessionId: sessionId ?? null, kind: 'new', agentPreset: selected.id })
}

/** Model message facts only; the product owner decides whether their content is visible. */
export interface PaimindNativeModelReply {
  readonly seq: number
  readonly content: unknown
}

/**
 * Read completed steps of the first native turn containing a human message.
 * A queued batch is one turn. Later turns, interrupted/replaced messages and
 * incomplete/error boundaries cannot supply proof for that first turn.
 */
export function listPaimindNativeFirstHumanTurnReplies(
  session: Pick<PaimindNativeSessionReference, 'events'>,
): readonly Readonly<PaimindNativeModelReply>[] {
  const object = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const rows = session.events.map(object)
  const firstHuman = rows.findIndex(row => row.type === 'user/message'
    && object(object(row.data).source).kind === 'user')
  const empty: readonly Readonly<PaimindNativeModelReply>[] = Object.freeze([])
  if (firstHuman < 0 || rows[firstHuman]?.surfaceOp !== 'append') return empty
  let start = firstHuman - 1
  while (start >= 0 && rows[start]?.type !== 'turn/start') {
    if (rows[start]?.type === 'turn/end') return empty
    start--
  }
  if (start < 0) return empty
  const turn = object(rows[start]?.data).turn
  if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 0) return empty
  let end = firstHuman + 1
  while (end < rows.length && rows[end]?.type !== 'turn/end') {
    if (rows[end]?.type === 'turn/start') return empty
    end++
  }
  const ending = object(rows[end]?.data)
  if (ending.turn !== turn || object(ending.reason).kind !== 'completed') return empty

  const replies: Readonly<PaimindNativeModelReply>[] = []
  let openStep: number | undefined
  let pending: Readonly<PaimindNativeModelReply>[] = []
  let previousSeq = -1
  for (let index = start; index <= end; index++) {
    const row = rows[index]!, data = object(row.data)
    if (typeof row.seq !== 'number' || !Number.isSafeInteger(row.seq) || row.seq <= previousSeq) return empty
    previousSeq = row.seq
    if (row.type === 'step/start') {
      if (openStep !== undefined || data.turn !== turn || typeof data.step !== 'number'
        || !Number.isSafeInteger(data.step) || data.step < 0) return empty
      openStep = data.step
      pending = []
    } else if (row.type === 'step/end') {
      if (openStep === undefined || data.turn !== turn || data.step !== openStep) return empty
      replies.push(...pending)
      pending = []
      openStep = undefined
    } else if (index > firstHuman && row.type === 'assistant/message') {
      const message = object(data.message), source = object(message.source)
      if (openStep !== undefined && data.turn === turn && data.step === openStep
        && row.surfaceOp === 'append' && data.interrupted !== true
        && message.role === 'assistant' && source.kind === 'model'
        && typeof source.provider === 'string' && source.provider.trim() !== ''
        && typeof source.model === 'string' && source.model.trim() !== '') {
        pending.push(Object.freeze({ seq: row.seq, content: message.content }))
      }
    }
  }
  return openStep === undefined ? Object.freeze(replies) : empty
}

/** Browser-safe Schedule view projected from Harness's canonical Session log. */
export interface PaimindNativeScheduleView {
  readonly id: string
  readonly kind: 'after' | 'at' | 'every'
  readonly prompt: string
  readonly scheduledAt: string
  readonly state: 'scheduled' | 'overdue'
  readonly deliveryMode: 'session-local'
  readonly afterSeconds?: number
  readonly everySeconds?: number
}

/** Structural live Session subset isolated from the feature package. */
export interface PaimindHostScheduleSession {
  readonly header: { readonly seedLength?: number }
  readonly events: readonly unknown[]
}

/** Structural native SessionStore subset used only for Schedule projection. */
export interface PaimindHostScheduleSessionStore {
  get(id: string): PaimindHostScheduleSession | undefined
}

/**
 * Fold the exact native `schedule/change` event stream for one live Session.
 * This is the only version-sensitive Schedule projection used by PAIMind.
 */
export function listPaimindNativeSchedules(
  sessions: PaimindHostScheduleSessionStore,
  sessionId: string,
  now = Date.now(),
): readonly Readonly<PaimindNativeScheduleView>[] {
  const session = sessions.get(sessionId)
  if (session === undefined) return Object.freeze([])
  const folded = foldScheduleEvents(session.events as never, session.header.seedLength)
  return Object.freeze(folded.active.map(record => {
    const view = scheduleView(record, now)
    return Object.freeze({
      id: String(view.id),
      kind: view.kind,
      prompt: view.prompt,
      scheduledAt: view.scheduledAt,
      state: view.state,
      deliveryMode: view.deliveryMode,
      ...(view.kind === 'after' ? { afterSeconds: view.afterSeconds } : {}),
      ...(view.kind === 'every' ? { everySeconds: view.everySeconds } : {}),
    })
  }))
}

/** Stable field vocabulary used to build one Harness settings namespace schema. */
export type PaimindSettingsFieldSpec =
  | {
      readonly kind: 'boolean'
      readonly default: boolean
      readonly description?: string
    }
  | {
      readonly kind: 'enum'
      readonly values: readonly [string, ...string[]]
      readonly default: string
      readonly description?: string
    }
  | {
      readonly kind: 'string'
      readonly default: string
      readonly maxLength: number
      readonly description?: string
    }

/** Structural owner handle returned by the native Harness Settings service. */
export interface PaimindHostSettingsScope<T extends object> {
  get(): Readonly<T>
  watch(callback: (next: Readonly<T>, prev: Readonly<T>) => void | Promise<void>): () => void
  update(patch: Partial<T>): Promise<void>
  replace(section: Partial<T>): Promise<void>
}

/** Structural native Settings service consumed by PAIMind owners. */
export interface PaimindHostSettingsFacility {
  readonly writable: boolean
  register<T extends object>(
    namespace: unknown,
    schema: object,
    options?: { readonly base?: Partial<T>; readonly applies?: 'live' | 'restart' },
  ): PaimindHostSettingsScope<T>
  describe(options?: { readonly redactSecrets?: boolean }): readonly {
    readonly ns: unknown
    readonly value: unknown
    readonly revision: number
    readonly user?: unknown
  }[]
  mutate(
    namespace: unknown,
    operations: readonly ({ readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
      | { readonly op: 'unset'; readonly path: readonly string[] })[],
    expectedRevision?: number,
  ): Promise<void>
}

/** Read one PAIMind namespace through the Host-only native Settings face. */
export function describePaimindHostSettings(
  settings: PaimindHostSettingsFacility,
  namespace: string,
): { readonly value: unknown; readonly user?: unknown; readonly revision: number; readonly writable: boolean } | undefined {
  const branded = settingsNamespace(resolveHarnessSettingsNamespace(namespace))
  const descriptor = settings.describe({ redactSecrets: true })
    .find(candidate => String(candidate.ns) === String(branded))
  return descriptor === undefined ? undefined : {
    value: descriptor.value,
    ...(descriptor.user === undefined ? {} : { user: descriptor.user }),
    revision: descriptor.revision,
    writable: settings.writable,
  }
}

/** Host-internal raw user layer for one-time migrations; never expose this result over a Remote. */
export function describePaimindHostSettingsUserLayer(
  settings: PaimindHostSettingsFacility,
  namespace: string,
): { readonly user?: unknown; readonly revision: number } | undefined {
  const branded = settingsNamespace(resolveHarnessSettingsNamespace(namespace))
  const descriptor = settings.describe()
    .find(candidate => String(candidate.ns) === String(branded))
  return descriptor === undefined ? undefined : {
    ...(descriptor.user === undefined ? {} : { user: descriptor.user }),
    revision: descriptor.revision,
  }
}

export type PaimindHostSettingsMutationOperation =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

/** Apply a bounded set of CAS-protected field operations through native Settings. */
export async function mutatePaimindHostSettingsOperations(
  settings: PaimindHostSettingsFacility,
  namespace: string,
  operations: readonly PaimindHostSettingsMutationOperation[],
  expectedRevision: number,
): Promise<void> {
  await settings.mutate(settingsNamespace(resolveHarnessSettingsNamespace(namespace)), operations, expectedRevision)
}

/** CAS-protected single-field mutation inside the canonical Host Settings document. */
export async function mutatePaimindHostSettings(
  settings: PaimindHostSettingsFacility,
  namespace: string,
  field: string,
  value: unknown,
  expectedRevision: number,
): Promise<void> {
  await mutatePaimindHostSettingsOperations(
    settings,
    namespace,
    [{ op: 'set', path: [field], value }],
    expectedRevision,
  )
}

/**
 * Register a PAIMind-owned namespace through the current native Settings API.
 * Feature packages describe product fields but never import version-sensitive
 * Harness Settings or Schemastery symbols directly.
 */
export function registerPaimindHostSettings<T extends object>(
  settings: PaimindHostSettingsFacility,
  namespace: string,
  fields: Readonly<Record<keyof T & string, PaimindSettingsFieldSpec>>,
  options?: { readonly base?: Partial<T>; readonly applies?: 'live' | 'restart' },
): PaimindHostSettingsScope<T> {
  const shape: Record<string, Schema> = {}
  for (const [field, spec] of Object.entries(fields) as [string, PaimindSettingsFieldSpec][]) {
    const schema = spec.kind === 'boolean'
      ? Schema.boolean().default(spec.default)
      : spec.kind === 'enum'
        ? Schema.union(spec.values.map(value => Schema.const(value)) as [Schema<string>, ...Schema<string>[]]).default(spec.default)
        : Schema.string().max(spec.maxLength).default(spec.default)
    shape[field] = spec.description === undefined ? schema : schema.description(spec.description)
  }
  return settings.register(
    settingsNamespace(resolveHarnessSettingsNamespace(namespace)),
    Schema.object(shape),
    options,
  ) as unknown as PaimindHostSettingsScope<T>
}

/** One exact model route used by the PAIMind auxiliary title call. */
export interface PaimindConversationTitleModelRoute {
  readonly provider: string
  readonly model: string
}

/** Minimal native Session face used by conversation auto-naming. */
export interface PaimindConversationTitleSession {
  readonly id: string
  append(type: 'session/title', data: {
    readonly title: string
    readonly messageSeqs: readonly number[]
    readonly source:
      | { readonly kind: 'fallback' }
      | { readonly kind: 'provider'; readonly provider: string; readonly model: PaimindConversationTitleModelRoute }
  }): unknown
}

/** Native event subset consumed without reading conversation history. */
export type PaimindConversationTitleSessionEvent =
  | {
      readonly type: 'user/message'
      readonly seq: number
      readonly data: {
        readonly source: { readonly kind: string }
        readonly content: readonly { readonly type: string; readonly text?: string }[]
      }
    }
  | {
      readonly type: 'request/header'
      readonly seq: number
      readonly data: { readonly header: { readonly config: PaimindConversationTitleModelRoute } }
    }
  | { readonly type: string; readonly seq: number; readonly data: unknown }

/** Current title snapshot needed for optimistic late-result protection. */
export interface PaimindConversationTitleSnapshot {
  readonly title: string
  readonly eventSeq: number
  readonly source: { readonly kind: 'fallback' | 'provider' | 'user' }
}

/** Structural Host services used by the version-isolated title adapter. */
export interface PaimindConversationTitleAutomationContext {
  readonly sessionTitle: {
    get(session: PaimindConversationTitleSession): PaimindConversationTitleSnapshot | undefined
    /** Native provider seam available in current Harness; optional keeps the compatibility adapter usable on older releases. */
    register?(provider: {
      readonly id: string
      readonly automatic: 'first-prompt'
      generate(request: {
        readonly session: PaimindConversationTitleSession
        readonly messages: readonly { readonly seq: number; readonly text: string }[]
        readonly route?: PaimindConversationTitleModelRoute
        readonly signal: AbortSignal
      }): Promise<{
        readonly title: string
        readonly messageSeqs: readonly number[]
        readonly model?: PaimindConversationTitleModelRoute
      }>
    }): () => void | Promise<void>
  }
  readonly llm: {
    stream(options: {
      readonly provider: string
      readonly model: string
      readonly messages: ReturnType<typeof createUserMessage>[]
      readonly maxTokens: number
      readonly sessionId: string
      readonly purpose: 'session-title'
      readonly signal: AbortSignal
    }): AsyncIterable<unknown>
  }
  readonly logger: { warn(message: unknown): void }
  on(
    event: 'session/event',
    listener: (session: PaimindConversationTitleSession, event: PaimindConversationTitleSessionEvent) => void,
  ): () => void
  on(
    event: 'session/disposed',
    listener: (session: PaimindConversationTitleSession) => void,
  ): () => void
}

/** Product-owned policy callbacks; Harness-specific event and LLM shapes stay above. */
export interface PaimindConversationTitleAutomationOptions {
  readonly providerId: string
  readonly enabled: () => boolean
  readonly route: () => PaimindConversationTitleModelRoute | undefined
  readonly temporaryTitle: (message: string) => string
  readonly prompt: (message: string) => string
  readonly finalizeTitle: (output: string) => string | undefined
  readonly maxOutputTokens: number
  readonly timeoutMs: number
}

interface PaimindConversationTitleWork {
  readonly triggerSeq: number
  readonly triggerText: string
  readonly temporaryEventSeq: number
  readonly temporaryTitle: string
  controller?: AbortController
  started: boolean
}

function titleMessageText(event: Extract<PaimindConversationTitleSessionEvent, { readonly type: 'user/message' }>): string {
  return event.data.content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text ?? '')
    .join('\n')
}

function titleRouteFromHeader(event: Extract<PaimindConversationTitleSessionEvent, { readonly type: 'request/header' }>): PaimindConversationTitleModelRoute | undefined {
  const { provider, model } = event.data.header.config
  return provider.length === 0 || model.length === 0 ? undefined : { provider, model }
}

/**
 * Install PAIMind conversation auto-naming over the native Session title log.
 * The exact triggering user event is retained in memory; no historical message
 * collection or shadow Session is created. The generated result commits only
 * while the same temporary title event remains current.
 */
export function installPaimindConversationTitleAutomation(
  ctx: PaimindConversationTitleAutomationContext,
  options: PaimindConversationTitleAutomationOptions,
): () => void | Promise<void> {
  if (ctx.sessionTitle.register !== undefined) {
    return ctx.sessionTitle.register({
      id: options.providerId,
      automatic: 'first-prompt',
      async generate(request) {
        const first = request.messages[0]
        if (first === undefined) throw new Error('conversation title provider received no human message')
        const configuredRoute = options.route()
        const route = configuredRoute ?? request.route
        if (!options.enabled() || route === undefined) {
          const title = options.temporaryTitle(first.text)
          if (title === '') throw new Error('conversation title provider could not derive a fallback title')
          return { title, messageSeqs: [first.seq] }
        }
        const timeout = AbortSignal.timeout(options.timeoutMs)
        const signal = AbortSignal.any([request.signal, timeout])
        const assembler = new BlockAssembler()
        const message = createUserMessage({
          content: [{ type: 'text', text: options.prompt(first.text) }],
          source: { kind: 'plugin', plugin: options.providerId },
        })
        for await (const chunk of ctx.llm.stream({
          provider: route.provider,
          model: route.model,
          messages: [message],
          maxTokens: options.maxOutputTokens,
          sessionId: request.session.id,
          purpose: 'session-title',
          signal,
        })) assembler.push(chunk as Parameters<BlockAssembler['push']>[0])
        if (assembler.finish.kind !== 'stop') throw new Error('conversation title model call did not finish normally')
        const output = assembler.message({ kind: 'plugin', plugin: options.providerId }).content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join(' ')
        const title = options.finalizeTitle(output)
        if (title === undefined) throw new Error('conversation title model returned no valid title')
        return { title, messageSeqs: [first.seq], model: route }
      },
    })
  }
  const workBySession = new Map<PaimindConversationTitleSession, PaimindConversationTitleWork>()
  let disposed = false

  const start = (
    session: PaimindConversationTitleSession,
    work: PaimindConversationTitleWork,
    route: PaimindConversationTitleModelRoute,
  ): void => {
    if (disposed || work.started) return
    work.started = true
    const controller = new AbortController()
    work.controller = controller
    const timer = setTimeout(() => {
      controller.abort(new Error('conversation title generation timed out'))
    }, options.timeoutMs)

    void (async () => {
      const assembler = new BlockAssembler()
      const prompt = options.prompt(work.triggerText)
      const message = createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'plugin', plugin: options.providerId },
      })
      for await (const chunk of ctx.llm.stream({
        provider: route.provider,
        model: route.model,
        messages: [message],
        maxTokens: options.maxOutputTokens,
        sessionId: session.id,
        purpose: 'session-title',
        signal: controller.signal,
      })) {
        assembler.push(chunk as Parameters<BlockAssembler['push']>[0])
      }
      if (assembler.finish.kind !== 'stop') throw new Error('conversation title model call did not finish normally')
      const text = assembler.message({ kind: 'plugin', plugin: options.providerId }).content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join(' ')
      const title = options.finalizeTitle(text)
      if (title === undefined) throw new Error('conversation title model returned no valid title')
      if (!options.enabled()) return
      const current = ctx.sessionTitle.get(session)
      if (current?.eventSeq !== work.temporaryEventSeq
        || current.title !== work.temporaryTitle
        || current.source.kind !== 'fallback') return
      session.append('session/title', {
        title,
        messageSeqs: [work.triggerSeq],
        source: { kind: 'provider', provider: options.providerId, model: route },
      })
    })().catch((error: unknown) => {
      if (!controller.signal.aborted && !disposed) {
        ctx.logger.warn(`conversation title generation failed for session "${session.id}": ${String(error)}`)
      }
    }).finally(() => {
      clearTimeout(timer)
      delete work.controller
    })
  }

  const stopEvents = ctx.on('session/event', (session, rawEvent) => {
    if (disposed || !options.enabled()) return
    if (rawEvent.type === 'user/message') {
      const event = rawEvent as Extract<PaimindConversationTitleSessionEvent, { readonly type: 'user/message' }>
      if (event.data.source.kind !== 'user' || workBySession.has(session)) return
      const triggerText = titleMessageText(event)
      const temporaryTitle = options.temporaryTitle(triggerText)
      if (temporaryTitle.length === 0) return
      queueMicrotask(() => {
        if (disposed || !options.enabled() || workBySession.has(session)) return
        const before = ctx.sessionTitle.get(session)
        // The native title service may have produced its deterministic fallback
        // later in the same user-event dispatch. Replace only that same-event
        // fallback; an older fallback or any provider/user title is already a
        // real title and must never be treated as an untitled conversation.
        if (before !== undefined && (before.source.kind !== 'fallback' || before.eventSeq <= event.seq)) return
        session.append('session/title', {
          title: temporaryTitle,
          messageSeqs: [event.seq],
          source: { kind: 'fallback' },
        })
        const current = ctx.sessionTitle.get(session)
        if (current?.source.kind !== 'fallback' || current.title !== temporaryTitle) return
        const work: PaimindConversationTitleWork = {
          triggerSeq: event.seq,
          triggerText,
          temporaryEventSeq: current.eventSeq,
          temporaryTitle,
          started: false,
        }
        workBySession.set(session, work)
        const explicit = options.route()
        if (explicit !== undefined) queueMicrotask(() => { start(session, work, explicit) })
      })
      return
    }
    if (rawEvent.type !== 'request/header') return
    const event = rawEvent as Extract<PaimindConversationTitleSessionEvent, { readonly type: 'request/header' }>
    const work = workBySession.get(session)
    if (work === undefined || work.started || event.seq <= work.triggerSeq) return
    const route = options.route() ?? titleRouteFromHeader(event)
    if (route !== undefined) queueMicrotask(() => { start(session, work, route) })
  })
  const stopDisposed = ctx.on('session/disposed', session => {
    const work = workBySession.get(session)
    work?.controller?.abort(new Error('session disposed during conversation title generation'))
    workBySession.delete(session)
  })

  return () => {
    if (disposed) return
    disposed = true
    stopEvents()
    stopDisposed()
    for (const work of workBySession.values()) {
      work.controller?.abort(new Error('conversation title automation unloaded'))
    }
    workBySession.clear()
  }
}

/** Consumer hooks for the native optional Settings lifecycle helper. */
export interface PaimindSettingsSectionHooks<T extends object> {
  setSource(current: () => Readonly<T>): void
  onChange(): void
  validate?(value: Readonly<T>): void
}

/**
 * Install one settings section through Harness's scoped optional-consumer seam.
 * This is intentionally distinct from directly calling `settings.register`:
 * the upstream helper owns attach, detach, fallback and watcher lifecycle.
 */
export function installPaimindHostSettings<T extends object>(
  ctx: object,
  namespace: string,
  fields: Readonly<Record<keyof T & string, PaimindSettingsFieldSpec>>,
  entry: T,
  hooks: PaimindSettingsSectionHooks<T>,
): void {
  const shape: Record<string, Schema> = {}
  for (const [field, spec] of Object.entries(fields) as [string, PaimindSettingsFieldSpec][]) {
    const schema = spec.kind === 'boolean'
      ? Schema.boolean().default(spec.default)
      : spec.kind === 'enum'
        ? Schema.union(spec.values.map(value => Schema.const(value)) as [Schema<string>, ...Schema<string>[]]).default(spec.default)
        : Schema.string().max(spec.maxLength).default(spec.default)
    shape[field] = spec.description === undefined ? schema : schema.description(spec.description)
  }
  installSettingsSection(
    ctx as Context,
    settingsNamespace(resolveHarnessSettingsNamespace(namespace)),
    Schema.object(shape),
    entry,
    hooks as never,
  )
}

/** Standard-decorator alias; feature packages never import Typert directly. */
export const PaimindRemote = Remote

/**
 * Register Remote markers without leaking decorator syntax into feature source.
 * This keeps Vitest/older bundlers compatible while preserving Gateway SRC fallback.
 */
export function markPaimindHostRemoteMethods(service: object, methods: readonly string[]): void {
  for (const method of methods) {
    const callable = Reflect.get(service, method)
    if (typeof callable !== 'function') throw new Error(`PAIMind Remote method "${method}" is not callable`)
    let initializer: ((this: object) => void) | undefined
    ;(Remote as unknown as (
      value: (...args: unknown[]) => unknown,
      context: {
        readonly kind: 'method'
        readonly name: string
        readonly static: false
        readonly private: false
        addInitializer(value: (this: object) => void): void
      },
    ) => void)(callable as (...args: unknown[]) => unknown, {
      kind: 'method', name: method, static: false, private: false,
      addInitializer(value) { initializer = value },
    })
    initializer?.call(service)
  }
}

/** Public Cordis Loader entry subset used by the product Feature Pack controller. */
export interface PaimindHostLoaderEntry {
  readonly id: string
  readonly options: {
    readonly id: string
    readonly name: string
    readonly group?: boolean | null
    readonly disabled?: boolean | null
  }
  /** Runtime-only entry transition; unlike Loader.update this does not rewrite the file-backed tree. */
  update?(
    options: { readonly disabled?: boolean | null },
    create?: boolean,
    force?: boolean,
  ): Promise<void>
}

/** Structural public Loader tree; version-specific classes stay behind this boundary. */
export interface PaimindHostLoaderFacility {
  entries(): Iterable<PaimindHostLoaderEntry>
  await(): Promise<void>
  resolve(id: string): PaimindHostLoaderEntry
  update(
    id: string,
    options: { readonly disabled?: boolean | null },
    parent?: string | null,
    position?: number,
  ): Promise<void>
}

export interface PaimindHostLoaderEntryState {
  readonly entryId: string
  readonly installed: boolean
  readonly enabled: boolean
}

/** Resolve a stable product-owned id even when an Include subtree prefixes the runtime id. */
function resolvePaimindHostLoaderEntry(
  loader: PaimindHostLoaderFacility,
  entryId: string,
): PaimindHostLoaderEntry | undefined {
  try {
    return loader.resolve(entryId)
  } catch {
    const matches = [...loader.entries()].filter(entry => entry.options.id === entryId)
    if (matches.length > 1) {
      throw new Error(`PAIMind Loader entry "${entryId}" is ambiguous (${matches.length} matches)`)
    }
    return matches[0]
  }
}

/** Read one exact composition-group row without inferring state from child packages. */
export function describePaimindHostLoaderEntry(
  loader: PaimindHostLoaderFacility,
  entryId: string,
): Readonly<PaimindHostLoaderEntryState> {
  const entry = resolvePaimindHostLoaderEntry(loader, entryId)
  if (entry === undefined) return Object.freeze({ entryId, installed: false, enabled: false })
  return Object.freeze({
    entryId,
    installed: true,
    enabled: entry.options.disabled !== true,
  })
}

/** Toggle an exact public Loader entry and let Cordis own disposal, restore, and persistence. */
export async function setPaimindHostLoaderEntryEnabled(
  loader: PaimindHostLoaderFacility,
  entryId: string,
  enabled: boolean,
): Promise<void> {
  const entry = resolvePaimindHostLoaderEntry(loader, entryId)
  if (entry === undefined) throw new Error(`PAIMind Loader entry "${entryId}" is not installed`)
  if ((entry.options.disabled !== true) === enabled) {
    if (!enabled || entry.update === undefined) return
    // A failed Cordis Group transaction can leave an enabled option flag while
    // one or more child fibers are absent. Force-patching the runtime entry is
    // idempotent for healthy fibers and makes the Group recreate only missing
    // children, so an option flag can never masquerade as successful enablement.
    await entry.update({ disabled: null }, false, true)
    return
  }
  const patch = { disabled: enabled ? null : true }
  // Product switch persistence belongs to Harness Settings. Keep the file-backed
  // Loader tree inert at bootstrap so a physically absent package can still boot
  // when its owning Product Pack is off.
  if (entry.update !== undefined) await entry.update(patch)
  else await loader.update(entry.id, patch)
}

/** Public storage-domain helpers isolated from feature package manifests. */
export function definePaimindStorageDomain(spec: Readonly<Record<string, unknown>>): unknown {
  return defineDomain(spec as never)
}

export function paimindDomainTable(schema: object): unknown {
  return domainTable(schema as never)
}

/** Structural durable table used by PAIMind-owned sidecars. */
export interface PaimindStorageTable<Value> {
  get(key: string): Value | undefined
  entries(): IterableIterator<[string, Value]>
  readonly size: number
  put(key: string, value: Value): Promise<void>
  delete(key: string): Promise<boolean>
  update(key: string, transform: (current: Value) => Value): Promise<Value>
}

export interface PaimindStorageDomainHandle {
  table(name: string): PaimindStorageTable<unknown>
  close(): Promise<void>
}

export interface PaimindStorageDomainFacility {
  open(spec: unknown): Promise<PaimindStorageDomainHandle>
}

export type PaimindJsonPrimitive = string | number | boolean | null
export type PaimindJsonValue = unknown

export interface PaimindContentBlock {
  readonly type: string
  readonly [key: string]: unknown
}

export interface PaimindHostAgent {
  readonly id: string
  readonly session: {
    readonly id: string
    readonly header: { readonly cwd?: string; readonly agentPreset?: string }
  }
}

/** One complete Skill definition projected into a live Agent scope. */
export interface PaimindScopedSkillDefinition {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly content: string
  readonly resourceDirectory?: string
  readonly modelInvocable?: boolean
  readonly userInvocable?: boolean
}

interface PaimindScopedSkillProviderControl {
  readonly signal: AbortSignal
  invalidate(): void
}

interface PaimindScopedSkillCandidate {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: { readonly modelInvocable: boolean; readonly userInvocable: boolean }
  readonly provider: string
  readonly source: 'custom'
  readonly rank: number
  readonly locator: string
  readonly resourceBase?: { readonly kind: 'directory'; readonly path: string }
}

interface PaimindScopedSkillProvider {
  readonly name: string
  list(): Promise<readonly PaimindScopedSkillCandidate[]>
  get(candidate: PaimindScopedSkillCandidate): Promise<Readonly<PaimindScopedSkillCandidate & { readonly content: string }> | undefined>
}

interface PaimindScopedSkillRegistry {
  registerProvider(create: (control: PaimindScopedSkillProviderControl) => PaimindScopedSkillProvider): () => void
}

interface PaimindScopedAgentPresetRegistry {
  /** Native answer for the Preset mounted in this live Agent scope. */
  composedPreset(agentContext: PaimindScopedSkillAgentContext): string | undefined
}

export interface PaimindScopedSkillAgentContext {
  get(name: 'skills'): PaimindScopedSkillRegistry | undefined
  get(name: 'agentPresets'): PaimindScopedAgentPresetRegistry | undefined
}

/** Exact Agent Context seam used to file a provider into the native Agent layer. */
export interface PaimindScopedSkillAgent extends PaimindHostAgent {
  readonly ctx: PaimindScopedSkillAgentContext
}

/**
 * Resolve the Preset that is actually mounted in a live Agent scope.
 *
 * A native Session header records the Preset used when the Session was created
 * and can remain stale after the user selects another Preset before the first
 * turn. Harness' Agent Preset service owns the live composition state, so
 * runtime projections must consult it before falling back to the header.
 */
export function resolvePaimindLiveAgentPreset(agent: PaimindScopedSkillAgent): string | undefined {
  const presets = agent.ctx.get('agentPresets')
  return presets === undefined ? agent.session.header.agentPreset : presets.composedPreset(agent.ctx)
}

/** Mutable handle over one native, Agent-scoped provider registration. */
export interface PaimindScopedSkillProjection {
  readonly providerName: string
  /** Make native reads wait for the latest projection refresh already in flight. */
  setRefreshBarrier(refresh: Promise<void>): void
  replace(definitions: readonly PaimindScopedSkillDefinition[]): void
  snapshot(): readonly Readonly<PaimindScopedSkillDefinition>[]
  dispose(): void
}

const PAIMIND_SCOPED_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function normalizeScopedSkillDefinitions(
  definitions: readonly PaimindScopedSkillDefinition[],
): readonly Readonly<PaimindScopedSkillDefinition>[] {
  if (!Array.isArray(definitions) || definitions.length > 10_000) {
    throw new Error('invalid scoped Skill projection')
  }
  const names = new Set<string>()
  return Object.freeze(definitions.map((definition) => {
    const name = definition.name.trim()
    const description = definition.description.trim()
    if (!PAIMIND_SCOPED_SKILL_NAME.test(name) || names.has(name)) {
      throw new Error(`invalid or duplicate scoped Skill name: ${name}`)
    }
    if (description === '' || description.length > 1_000 || /[\u0000-\u001f\u007f]/.test(description)) {
      throw new Error(`invalid scoped Skill description: ${name}`)
    }
    if (typeof definition.content !== 'string' || definition.content.length > 2_000_000) {
      throw new Error(`invalid scoped Skill content: ${name}`)
    }
    names.add(name)
    return Object.freeze({
      name,
      description,
      ...(definition.whenToUse === undefined ? {} : { whenToUse: definition.whenToUse }),
      content: definition.content,
      ...(definition.resourceDirectory === undefined ? {} : { resourceDirectory: definition.resourceDirectory }),
      modelInvocable: definition.modelInvocable ?? true,
      userInvocable: definition.userInvocable ?? true,
    })
  }))
}

/**
 * Register one replaceable Skill provider in the live Agent's native scope.
 *
 * Harness traceable services bind `agent.ctx.get('skills')` calls to the
 * caller Context, so the provider is Agent-local and unwinds with that Agent.
 * Replacements swap one immutable definition snapshot before invalidating the
 * native catalog; no second runtime registry or invocation path is created.
 */
export function installPaimindScopedSkillProjection(
  agent: PaimindScopedSkillAgent,
  definitions: readonly PaimindScopedSkillDefinition[],
  providerName = 'paimind-session-business-skills',
): PaimindScopedSkillProjection {
  if (!PAIMIND_SCOPED_SKILL_NAME.test(providerName)) throw new Error('invalid scoped Skill provider name')
  const registry = agent.ctx.get('skills')
  if (registry === undefined) throw new Error('Harness scoped Skill registry is unavailable')
  let current = normalizeScopedSkillDefinitions(definitions)
  let refreshBarrier: Promise<void> = Promise.resolve()
  let invalidate: (() => void) | undefined
  let active = true
  const disposeNative = registry.registerProvider((control) => {
    invalidate = control.invalidate
    return {
      name: providerName,
      async list() {
        await refreshBarrier
        if (!active) return Object.freeze([])
        return current.map((definition) => Object.freeze({
          name: definition.name,
          description: definition.description,
          ...(definition.whenToUse === undefined ? {} : { whenToUse: definition.whenToUse }),
          invocation: Object.freeze({
            modelInvocable: definition.modelInvocable ?? true,
            userInvocable: definition.userInvocable ?? true,
          }),
          provider: providerName,
          source: 'custom' as const,
          rank: 100,
          locator: definition.name,
          ...(definition.resourceDirectory === undefined
            ? {}
            : { resourceBase: Object.freeze({ kind: 'directory' as const, path: definition.resourceDirectory }) }),
        }))
      },
      async get(candidate) {
        await refreshBarrier
        if (!active) return undefined
        if (candidate.provider !== providerName || typeof candidate.locator !== 'string') return undefined
        const definition = current.find(row => row.name === candidate.locator)
        if (definition === undefined) return undefined
        return Object.freeze({
          ...candidate,
          content: definition.content,
        })
      },
    }
  })
  const projection: PaimindScopedSkillProjection = {
    providerName,
    setRefreshBarrier(refresh) {
      if (!active) throw new Error('scoped Skill projection is disposed')
      refreshBarrier = refresh
    },
    replace(next) {
      if (!active) throw new Error('scoped Skill projection is disposed')
      const normalized = normalizeScopedSkillDefinitions(next)
      current = normalized
      invalidate?.()
    },
    snapshot() { return current },
    dispose() {
      if (!active) return
      active = false
      disposeNative()
    },
  }
  return Object.freeze(projection)
}

export interface PaimindToolRunContext {
  readonly callId: string
  readonly rootCallId: string
  readonly name: string
  readonly arguments: unknown
  readonly agent?: PaimindHostAgent
  readonly parent?: symbol
  readonly token: symbol
  readonly signal: AbortSignal
}

export interface PaimindToolExecutionSuccess {
  readonly isError: false
  readonly value: PaimindJsonValue
  readonly content: readonly PaimindContentBlock[]
  readonly meta?: PaimindJsonValue
}

export interface PaimindToolExecutionFailure {
  readonly isError: true
  readonly content: readonly PaimindContentBlock[]
  readonly error?: { readonly message?: string }
  readonly meta?: PaimindJsonValue
}

export type PaimindToolExecutionResult = PaimindToolExecutionSuccess | PaimindToolExecutionFailure

export interface PaimindToolResultPresentation {
  readonly content: readonly PaimindContentBlock[]
  readonly isError: boolean
  readonly meta?: PaimindJsonValue
}

export interface PaimindHarnessToolDefinitionOptions {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly output: {
    readonly schema: Readonly<Record<string, unknown>>
    render(args: Record<string, unknown>, value: Record<string, unknown>): PaimindContentBlock[]
    presentationMeta?(args: Record<string, unknown>, value: Record<string, unknown>): PaimindJsonValue
  }
  execute(args: Record<string, unknown>, exec: PaimindToolRunContext): Promise<Record<string, unknown>>
  presentCall?(args: Record<string, unknown>): Readonly<Record<string, unknown>> | undefined
  presentResult?(
    args: Record<string, unknown>,
    result: PaimindToolResultPresentation,
  ): Readonly<Record<string, unknown>> | undefined
  isConcurrencySafe?(args: Record<string, unknown>): boolean
}

/**
 * The only runtime bridge to Harness's version-sensitive Tool Definition helper.
 * Feature packages depend on this stable structural contract instead of importing
 * `@deepseek-ai/dsh-tools` directly.
 */
export function definePaimindHarnessTool(options: PaimindHarnessToolDefinitionOptions): unknown {
  return defineTool(options as never)
}

export interface PaimindNativeJobSnapshot {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  readonly detail?: string
  readonly startedAt: number
  readonly finishedAt?: number
}

export interface PaimindNativeJobRegistry {
  start(spec: {
    readonly kind: string
    readonly label: string
    readonly owner?: PaimindHostAgent
    run(): {
      cancel(reason?: string): void
      done: Promise<{
        readonly status: 'completed' | 'killed' | 'failed'
        readonly detail?: string
        readonly output?: string
      }>
    }
  }): string
  get(id: string, caller?: PaimindHostAgent): PaimindNativeJobSnapshot
  kill(id: string, caller?: PaimindHostAgent, reason?: string): 'requested' | 'already-finished'
}

export interface PaimindHostToolRegistry {
  register(definition: unknown): () => void
  execute(input: {
    readonly callId: string
    readonly rootCallId?: string
    readonly name: string
    readonly arguments: unknown
    readonly agent?: PaimindHostAgent
    readonly parent?: symbol
    readonly signal: AbortSignal
  }): Promise<PaimindToolExecutionResult>
}

export interface PaimindHostSystemPrompt {
  section(input: { readonly name: string; readonly order?: number; readonly text: string }): () => void
  context(input: { readonly name: string; readonly order: number; readonly text: string }): () => void
  variable?(name: string, provider: () => string | undefined): () => void
}

/** The selected native renderer interpolates section templates once, but never
 * rescans variable values. Keep administrator-authored text literal (including
 * {{examples}}), without replacing the native assembler or prompt registry. */
export function registerPaimindHostLiteralPrompt(
  prompt: PaimindHostSystemPrompt,
  input: { readonly name: string; readonly order: number; readonly variable: string; readonly text: () => string },
): () => void {
  if (typeof prompt.variable !== 'function' || !/^paimind_[a-z0-9_]+$/.test(input.variable)
    || !Number.isFinite(input.order)) throw new Error('Native literal prompt registration unavailable')
  const removeVariable = prompt.variable(input.variable, input.text)
  try {
    const removeSection = prompt.section({ name: input.name, order: input.order, text: `{{${input.variable}}}` })
    return () => { removeSection(); removeVariable() }
  } catch (error) { removeVariable(); throw error }
}

export interface PaimindHostFsTarget {
  readonly displayPath: string
}

export interface PaimindHostFileSystem {
  resolve(path: string, options?: { readonly cwd?: string; readonly signal?: AbortSignal }): Promise<PaimindHostFsTarget>
  contains(parent: PaimindHostFsTarget, child: PaimindHostFsTarget): boolean
  stat(target: PaimindHostFsTarget, signal?: AbortSignal): Promise<{
    readonly type: 'file' | 'directory' | 'other'
    readonly size?: number
  } | undefined>
}

export interface PaimindHostWorkspace {
  readonly id: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

export interface PaimindHostWorkspaceRegistry {
  list(): readonly PaimindHostWorkspace[]
}

export interface PaimindSessionEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/** Exact native Session face required by the Schedule v1 read adapter. */
export interface PaimindScheduledHarnessAgent {
  readonly id: string
  readonly session: {
    readonly id: string
    readonly header: { readonly cwd?: string; readonly agentPreset?: string }
    readonly events: readonly PaimindSessionEvent[]
  }
  followup(message: unknown): void
  whenIdle(): Promise<void>
}

export interface PaimindScheduledHarnessAgentHandle {
  readonly agent: PaimindScheduledHarnessAgent
  dispose(): Promise<void>
}

export interface PaimindScheduledHarnessAgentRegistry {
  create(options: {
    readonly sessionId: string
    readonly meta?: { readonly cwd?: string; readonly agentPreset?: string }
    readonly agentOptions?: { readonly provider?: string; readonly model?: string }
    readonly signal?: AbortSignal
    readonly setup?: (agentCtx: object) => void | Promise<void>
  }): Promise<PaimindScheduledHarnessAgentHandle>
}

/** Structural preset face used only while creating an independent scheduled Session. */
export interface PaimindScheduledHarnessPresetRegistry {
  resolve(id?: string): Promise<{ readonly id: string }>
  mount(agentCtx: object, id?: string): Promise<unknown>
}

/** Structural native title service; exact Harness imports stay inside this compatibility boundary. */
export interface PaimindScheduledHarnessTitleService {
  rename(session: PaimindHostAgent['session'], title: string): unknown
}

/** Structural default model route used when creating an autonomous Session outside ApiProxy. */
export interface PaimindHarnessDefaultModelService {
  currentSelection(): { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
}

/**
 * Create a scheduled Agent inside the same preset composition used by normal
 * Harness Sessions. Mounting during the unpublished setup window is required:
 * it makes scoped tools and the native Job controller available before the
 * Agent can run, while keeping rc-specific setup semantics out of the Adapter.
 */
export async function createPaimindScheduledHarnessAgent(
  agents: PaimindScheduledHarnessAgentRegistry,
  presets: PaimindScheduledHarnessPresetRegistry | undefined,
  options: {
    readonly sessionId: string
    readonly cwd?: string
    readonly agentPreset?: string
    readonly provider?: string
    readonly model?: string
    readonly signal?: AbortSignal
  },
): Promise<PaimindScheduledHarnessAgentHandle> {
  if ((options.provider === undefined) !== (options.model === undefined)) {
    throw new Error('scheduled Harness Agent requires provider and model together')
  }
  const modelOptions = options.provider === undefined || options.model === undefined
    ? {}
    : { agentOptions: { provider: options.provider, model: options.model } }
  if (presets === undefined) {
    return await agents.create({
      sessionId: options.sessionId,
      ...(options.cwd === undefined ? {} : { meta: { cwd: options.cwd } }),
      ...modelOptions,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }
  const preset = await presets.resolve(options.agentPreset)
  return await agents.create({
    sessionId: options.sessionId,
    meta: {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      agentPreset: preset.id,
    },
    ...modelOptions,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    setup: async agentCtx => { await presets.mount(agentCtx, preset.id) },
  })
}

/** Create a user-owned scheduled turn so native conversation title/index services can surface it. */
export function createPaimindHarnessScheduledMessage(text: string): unknown {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

export interface PaimindScheduledHarnessResult {
  readonly status: 'succeeded' | 'failed' | 'needs_attention'
  readonly message: string
}

function boundedHarnessResultMessage(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (normalized === '' ? 'Harness Session completed' : normalized).slice(0, 4_096)
}

/** Map the final native Session log into the platform's deliberately small result vocabulary. */
export function readPaimindScheduledHarnessResult(
  agent: PaimindScheduledHarnessAgent,
): Readonly<PaimindScheduledHarnessResult> {
  const assistant = [...agent.session.events].reverse().find(event => event.type === 'assistant/message')
  const failedTool = [...agent.session.events].reverse().find(event => {
    if (event.type !== 'tool/result' || typeof event.data !== 'object' || event.data === null) return false
    return 'error' in event.data && event.data.error !== undefined
  })
  if (assistant === undefined && failedTool !== undefined) {
    const data = failedTool.data as { readonly error?: { readonly code?: string; readonly name?: string } }
    return Object.freeze({
      status: 'failed',
      message: boundedHarnessResultMessage(data.error?.code ?? data.error?.name ?? 'Harness tool execution failed'),
    })
  }
  if (assistant === undefined || typeof assistant.data !== 'object' || assistant.data === null) {
    return Object.freeze({ status: 'failed', message: 'Harness Session finished without an assistant result' })
  }
  const message = (assistant.data as {
    readonly message?: { readonly content?: readonly { readonly type?: string; readonly text?: string }[] }
  }).message
  const text = message?.content
    ?.filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n') ?? ''
  const needsAttention = /PAIMIND_STATUS\s*:\s*NEEDS_ATTENTION/i.test(text)
  const clean = text.replace(/PAIMIND_STATUS\s*:\s*(?:SUCCEEDED|NEEDS_ATTENTION)/ig, '')
  return Object.freeze({
    status: needsAttention ? 'needs_attention' : 'succeeded',
    message: boundedHarnessResultMessage(clean),
  })
}

/** Harness 0.1.1 client-visible Session Projection registration shape. */
export interface PaimindSessionProjectionDefinition<State, View = unknown> {
  readonly key: string
  readonly stateSchema: { parse(value: unknown): State }
  init(): State
  apply(state: State, event: PaimindSessionEvent): State
  readonly wire: {
    readonly viewSchema: { parse(value: unknown): View }
    view(state: State): View
  }
  readonly stateVersion: number
}

export interface PaimindHostSessionProjectionRegistry {
  register<State, View>(definition: PaimindSessionProjectionDefinition<State, View>): () => void
  snapshot(session: PaimindHostAgent['session']): {
    readonly asOfSeq: number
    readonly values: Readonly<Record<string, unknown>>
  }
}

export interface PaimindHostReflectRegistry {
  provide(name: string, service: unknown): () => void | Promise<void>
}

export interface PaimindArtifactRuntimeHostContext {
  readonly jobs: PaimindNativeJobRegistry
  readonly tools: PaimindHostToolRegistry
  readonly fs: PaimindHostFileSystem
  readonly workspaceRegistry: PaimindHostWorkspaceRegistry
  readonly sessionProjections: PaimindHostSessionProjectionRegistry
  readonly reflect: PaimindHostReflectRegistry
  effect(install: () => void | (() => void), label?: string): void
  on(
    event: 'tools/execute',
    listener: (
      exec: PaimindToolRunContext,
      next: () => Promise<PaimindToolExecutionResult>,
    ) => Promise<PaimindToolExecutionResult>,
  ): () => void
}
