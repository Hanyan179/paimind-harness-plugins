import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { clientResponseSchema, rpcReceiptSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { approvalResponsePayloadSchema } from '@deepseek-ai/dsh-host-apiproxy/api/approvals.schema'
import { readPaimindNativeApprovalReference } from './host.js'
import { readHarnessPromptCorrelation } from './prompt-correlation.js'
import { executionScope } from './managed-origins.js'
import type { ManagedHarnessQueueCheck } from './managed-queue.js'

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const canonicalId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
  && value.trim() === value && !/[\u0000-\u001f\u007f/\\]/u.test(value)
const version = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value)
  && Buffer.from(value, 'base64url').toString('base64url') === value
const invalid = () => Error('原生审批答复无法验证')
type Answer = { sessionId: string; approvalId: string; outcome: 'allowed-once' | 'rejected' }
function answer(value: unknown) {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'approvalId,outcome,sessionId') throw invalid()
  const input = approvalResponsePayloadSchema.parse(value)
  if (!canonicalId(input.sessionId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(input.approvalId)) throw invalid()
  return input
}
export function harnessApprovalCorrelation(rpcId: string, input: Answer, expectedVersion: string): string {
  if (!canonicalId(rpcId) || !version(expectedVersion)) throw invalid()
  const selected = answer(input)
  return 'haas-approval-v1.' + createHash('sha256').update(JSON.stringify([rpcId, selected.sessionId, selected.approvalId, selected.outcome, expectedVersion])).digest('base64url')
}

/** Original browser carrier stays unchanged except private provenance. The
 * original pending rpcId is never replaced with the login signature. */
export function prepareHarnessApprovalResponse(method: string, target: string, contentType: string | undefined, bytes: Uint8Array):
  (Answer & { rpcId: string; correlation(expectedVersion: string): string; stamp(source: string, expectedVersion: string): Uint8Array;
    receipt(bytes: Uint8Array): { accepted: true } | { accepted: false; reason: 'not-pending' | 'bad-response' } }) | undefined {
  if (new URL(target, 'http://native.invalid').pathname !== '/api/respond') return undefined
  if (target !== '/api/respond' || method !== 'POST' || contentType?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
    || bytes.byteLength > 16384) throw invalid()
  const message = clientResponseSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  if (!message.result.ok || !record(message.result.value) || !Object.hasOwn(message.result.value, 'approvalId')) return undefined
  const input = answer(message.result.value)
  if (!canonicalId(message.rpcId)) throw invalid()
  return { ...input, rpcId: message.rpcId,
    receipt(bytes: Uint8Array) {
      if (bytes.byteLength > 4096) throw invalid()
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      const parsed = rpcReceiptSchema.parse(value)
      if (Object.keys(value).sort().join(',') !== (parsed.accepted ? 'accepted' : 'accepted,reason')) throw invalid()
      return parsed
    },
    correlation(expectedVersion: string) { return harnessApprovalCorrelation(message.rpcId, input, expectedVersion) },
    stamp(source: string, expectedVersion: string) {
      if (typeof source !== 'string' || source.length > 8192 || !/^paimind-origin-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(source)
        || readHarnessPromptCorrelation({ kind: 'user', rpcId: source }, input.sessionId) !== harnessApprovalCorrelation(message.rpcId, input, expectedVersion)) throw invalid()
      return Buffer.from(JSON.stringify({ ...message, result: { ok: true, value: { ...input, paimindApproval: { source, expectedVersion } } } }))
    } }
}

/** Version/current identity fences around the original same-process pending
 * consumer. No alternate approval registry, event writer or scheduler. */
export function guardManagedHarnessApprovalApi(context: Context, respond: ApiProxy['respond'], check: ManagedHarnessQueueCheck): ApiProxy['respond'] {
  const lifetime = new AbortController(); context.effect(() => () => lifetime.abort())
  return async message => {
    const value = message.result.ok ? message.result.value : undefined
    if (!record(value) || !Object.hasOwn(value, 'approvalId')) return respond(message)
    try {
      if (Object.keys(value).sort().join(',') !== 'approvalId,outcome,paimindApproval,sessionId' || !record(value.paimindApproval)
        || Object.keys(value.paimindApproval).sort().join(',') !== 'expectedVersion,source') throw invalid()
      const { paimindApproval, ...raw } = value, input = answer(raw)
      const source = paimindApproval.source, expectedVersion = paimindApproval.expectedVersion
      if (typeof source !== 'string' || source.length > 8192 || !/^paimind-origin-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(source)
        || !version(expectedVersion) || readHarnessPromptCorrelation({ kind: 'user', rpcId: source }, input.sessionId) !== harnessApprovalCorrelation(message.rpcId, input, expectedVersion)) throw invalid()
      const agent = context.agents.get(input.sessionId)
      if (!agent) return { accepted: false, reason: 'not-pending' }
      const scope = executionScope(agent), signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(4000)])
      if (!scope.presetId || scope.sessionId !== input.sessionId) throw invalid()
      const authorize = () => new Promise<void>((resolve, reject) => {
        const abort = () => reject(invalid())
        signal.addEventListener('abort', abort, { once: true })
        Promise.resolve().then(() => {
          signal.throwIfAborted()
          return check(Object.freeze({ nativeSessionId: input.sessionId, presetId: scope.presetId!, sources: Object.freeze([source]),
            action: input.outcome === 'allowed-once' ? 'approval-approve' : 'approval-reject' }), signal)
        }).then(() => { if (signal.aborted) reject(invalid()); else resolve() }, () => reject(invalid()))
          .finally(() => signal.removeEventListener('abort', abort))
      })
      await authorize()
      signal.throwIfAborted()
      const state = await readPaimindNativeApprovalReference(context as never, input.sessionId, input.approvalId, signal)
      // Original observation is asynchronous. Revalidate its signed actor at
      // consumption, not just before observing the native pending snapshot.
      await authorize()
      signal.throwIfAborted()
      if (context.agents.get(input.sessionId) !== agent || executionScope(agent).presetId !== scope.presetId
        || state.version !== expectedVersion || !state.answerable || state.rpcId !== message.rpcId) return { accepted: false, reason: 'not-pending' }
      // Native respond consumes/removes its pending entry synchronously. No
      // await separates the final check from that sole original mutation.
      return respond({ ...message, result: { ok: true, value: input } })
    } catch { return { accepted: false, reason: 'bad-response' } }
  }
}
