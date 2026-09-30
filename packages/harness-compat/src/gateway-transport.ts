import { sessionLogQuerySchema } from '@deepseek-ai/dsh-host-apiproxy/api/downloads.schema'
import { encodeNativeTurnSelection, nativeTurnContentDigest, type NativeTurnSelection } from './managed-queue.js'
export type { NativeTurnSelection } from './managed-queue.js'

/** Existing native prompt envelope, with an explicit versioned correlation.
 * This carries no identity authority until the caller's origin owner signs it. */
export function prepareHarnessTurnSubmission(sessionId: string, text: string, commandId: string, expectedVersion: string) {
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200 || /[\u0000-\u001f\u007f/\\]/u.test(sessionId)
    || typeof text !== 'string' || !text.length || text.length > 65536) throw Error('Invalid native turn input')
  const selection: NativeTurnSelection = { commandId, expectedVersion, contentDigest: nativeTurnContentDigest(text) }
  const correlation = encodeNativeTurnSelection(selection)
  return { path: '/api/session.prompt', selection, correlation,
    body(source: string) {
      if (typeof source !== 'string' || source.length > 1536 || !/^paimind-origin-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(source)) throw Error('Invalid native turn source')
      return JSON.stringify({ type: 'client-request', rpcId: source, method: 'session.prompt', payload: { sessionId, mode: 'queue', content: [{ type: 'text', text }] } })
    },
    verify(bytes: string, source: string) {
      const reply = serverResponseSchema.parse(JSON.parse(bytes))
      if (reply.rpcId !== source) throw Error('Uncorrelated native turn response')
      return reply.result.ok && (reply.result.value as { accepted?: unknown })?.accepted === true
    } }
}

/** Native 0.1.1-rc.2 browser carrier, verified against the published
 * dsh-client-connection contract. These are downstream-only event channels;
 * application calls and responses use HTTP, never client WebSocket messages. */
export function isHarnessDownlink(method: string, target: string): boolean {
  return method === 'GET' && (target === '/api/events.host' || target === '/api/events.mux')
}

export { createHarnessModelRead, decodeHarnessModelRead, type HarnessModelSettings, type HarnessModelReadValues } from './model-inspection.js'
export { createHarnessModelConfigurationRead, decodeHarnessModelConfiguration, decodeHarnessModelCredentialState,
  prepareHarnessModelSelectionChange, prepareHarnessModelCredentialChange,
  type HarnessModelConfiguration, type HarnessModelCredentialState, type HarnessModelSelection,
  type HarnessModelChangeOutcome, type HarnessModelChange } from './model-configuration.js'
export { prepareHarnessMemberSettingsRead, type HarnessMemberSettingsRead } from './member-settings.js'
export { createHarnessInstructionRead, decodeHarnessInstructionConfiguration, normalizeHarnessInstructions,
  prepareHarnessInstructionChange, type HarnessInstructionConfiguration, type HarnessInstructionValue } from './instruction-configuration.js'
export { prepareHarnessCommandListRequest, type HarnessCommandListRequest } from './command-list.js'
export { prepareHarnessExportCommandRequest, type HarnessExportCommandRequest } from './command-execution.js'
export { prepareHarnessSessionCreation, prepareHarnessSessionWorkspaceRead, type HarnessSessionCreation } from './session-creation.js'
export { prepareHarnessApprovalResponse, harnessApprovalCorrelation } from './managed-approval.js'

export interface HarnessRpcOperation {
  readonly kind: 'unary' | 'response'
  readonly endpoint: string
  readonly args: Readonly<Record<string, unknown>>
  readonly capability: HarnessOperationCapability | undefined
}

export type HarnessOperationCapability = 'conversation' | 'workspace' | 'agent-selection' | 'skill-catalog'
  | 'goal' | 'model-catalog' | 'host-description' | 'settings-read' | 'settings-write' | 'settings-document' | 'unsupported-settings'

// Native wire vocabulary stays at the version boundary. This classification
// neither grants a role permission nor establishes object ownership.
const NATIVE_CAPABILITIES = new Map<string, HarnessOperationCapability>([
  ...['session.list', 'session.search', 'session.create', 'session.history', 'session.models',
    'session.selectModel', 'session.rename', 'session.fork', 'session.prompt', 'session.attachment',
    'session.updateQueue', 'session.cancel', 'subagent.list', 'subagent.history', 'subagent.prompt',
    'subagent.interrupt'].map(endpoint => [endpoint, 'conversation'] as const),
  ...['workspace.list', 'workspace.create', 'workspace.rename', 'workspace.delete',
    'workspace.insertBefore', 'workspace.insertSessionBefore', 'workspace.archiveSession'].map(endpoint => [endpoint, 'workspace'] as const),
  ...['agentPreset.list', 'agentPreset.select', 'agentPreset.read'].map(endpoint => [endpoint, 'agent-selection'] as const),
  ...['goal.create', 'goal.edit', 'goal.pause', 'goal.resume', 'goal.complete', 'goal.clear'].map(endpoint => [endpoint, 'goal'] as const),
  ['skill.list', 'skill-catalog'], ['llm.models', 'model-catalog'], ['host.describe', 'host-description'],
  ['settings.describe', 'settings-read'], ['settings.openDocument', 'settings-document'],
  ...['settings.update', 'settings.replace', 'settings.mutate'].map(endpoint => [endpoint, 'settings-write'] as const),
])

export function classifyHarnessReadRequest(method: string, target: string): 'document' | 'asset' | 'event-downlink' | 'session-export' | undefined {
  if (!['GET', 'HEAD'].includes(method)) return undefined
  if (isHarnessDownlink(method, target)) return 'event-downlink'
  // The published plugin loader uses SSE here, not a static asset or a
  // WebSocket channel. Only its canonical GET has an event-stream lifetime.
  if (method === 'GET' && target === '/plugins/events') return 'event-downlink'
  let url: URL
  try { url = new URL(target, 'http://native.invalid') } catch { return undefined }
  if (url.origin !== 'http://native.invalid' || url.hash) return undefined
  const path = target.split('?')[0]!
  if (url.pathname !== path || path.includes('%') || path.includes('\\')
    || path.split('/').some(part => part === '.' || part === '..')) return undefined
  if (path === '/' || path === '/index.html') return 'document'
  // The original install manifest is a finite read-only asset, not an RPC or
  // public authentication exception. Reject aliases and all query selectors.
  if (target === '/manifest.webmanifest') return 'asset'
  if (path === '/favicon.ico' || ['/assets/', '/plugins/'].some(prefix => path.startsWith(prefix))) return 'asset'
  // The original browser's HEAD preflight and GET download both request the
  // owner's descendant archive. Keep its exact native schema, but reject
  // duplicate or additional selectors before object conversion can hide them.
  if (path !== '/api/session.export' || [...url.searchParams.keys()].some(key => !['sessionId', 'includeDescendants'].includes(key))) return undefined
  const ids = url.searchParams.getAll('sessionId')
  if (ids.length !== 1 || ids[0]!.length > 200 || url.searchParams.getAll('includeDescendants').length > 1) return undefined
  return sessionLogQuerySchema.safeParse(Object.fromEntries(url.searchParams)).success ? 'session-export' : undefined
}

const plainRecord = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype

/** Decode the published HTTP envelope, not a guessed method from user fields.
 * Native schema ownership stays upstream; enterprise role policy stays outside
 * this adapter. The original bytes are still validated by the native receiver. */
export function decodeHarnessRpcOperation(method: string, target: string, contentType: string | undefined,
  body: Uint8Array): HarnessRpcOperation {
  if (method !== 'POST' || !/^\/api\/[A-Za-z][A-Za-z0-9]*(?:[./][A-Za-z][A-Za-z0-9]*)?$/.test(target)
    || contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
    || body.byteLength === 0 || body.byteLength > 8 * 1024 * 1024) throw new Error('Unsupported native RPC carrier')
  const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
  const endpoint = target.slice(5)
  if (endpoint === 'respond') {
    if (!clientResponseSchema.safeParse(decoded).success) throw new Error('Invalid native response envelope')
    return Object.freeze({ kind: 'response', endpoint, args: Object.freeze({}), capability: undefined })
  }
  const envelope = clientRequestSchema.safeParse(decoded)
  if (!envelope.success || envelope.data.method !== endpoint || !plainRecord(envelope.data.payload)) {
    throw new Error('Native envelope and endpoint disagree')
  }
  const payload = envelope.data.payload
  if (endpoint.includes('/')) {
    if (Object.keys(payload).length !== 1 || !plainRecord(payload.args)) throw new Error('Invalid native Remote args')
    return Object.freeze({ kind: 'unary', endpoint, args: payload.args, capability: undefined })
  }
  if (!endpoint.includes('.')) throw new Error('Unknown native endpoint shape')
  return Object.freeze({ kind: 'unary', endpoint, args: payload,
    capability: NATIVE_CAPABILITIES.get(endpoint) ?? (endpoint.startsWith('settings.') ? 'unsupported-settings' : undefined) })
}

export interface HarnessInteractiveRequest {
  readonly nativeSessionId: string
  /** Presentation correlation only; never a login or execution authority. */
  readonly clientRpcId: string
  /** Removal is cleanup, not new execution; retain native queue removal after
   * withdrawal while all new prompt/edit/steer operations require eligibility. */
  readonly requiresPresetEligibility: boolean
  /** Changes only native user-message provenance, never content or native IDs. */
  stamp(source: string): Uint8Array
  /** HTTP correlation is restored; durable native message sources stay intact. */
  restoreResponse(body: Uint8Array, source: string): Uint8Array
}

/** Session-local mutations which do not submit a prompt. Attachment/history
 * reads stay readable after withdrawal; pause/cancel remain stop operations.
 * This only identifies native scope, never supplies enterprise permission. */
export function readHarnessSessionMutationRequest(method: string, target: string, contentType: string | undefined,
  body: Uint8Array): string | undefined {
  const path = new URL(target, 'http://native.invalid').pathname
  const schema = path === '/api/session.rename' ? sessionRenameRequestSchema
    : path === '/api/session.selectModel' ? sessionSelectModelRequestSchema
      : path === '/api/goal.create' ? goalCreateRequestSchema : path === '/api/goal.edit' ? goalEditRequestSchema
        : path === '/api/goal.resume' ? goalResumeRequestSchema : path === '/api/goal.complete' ? goalCompleteRequestSchema
          : path === '/api/goal.clear' ? goalClearRequestSchema : undefined
  if (!schema) return undefined
  if (path !== target) throw Error('Aliased native session mutation')
  const operation = decodeHarnessRpcOperation(method, target, contentType, body)
  const { sessionId } = schema.parse(operation.args)
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200 || /[\u0000-\u001f\u007f]/u.test(sessionId)) throw Error('Invalid native session identity')
  return sessionId
}

export interface HarnessAgentPresetResponse {
  readonly presetIds: readonly string[]
  readonly requiresSelection: boolean
  /** Only removes original list rows. It never creates or changes a preset. */
  project(eligibleIds: readonly string[]): Uint8Array
}
export interface HarnessAgentPresetRequest {
  readonly kind: 'list' | 'read' | 'select' | 'create' | 'fork'
  readonly presetId?: string
  readonly forkSourceSessionId?: string
  readonly createSessionId?: string
  /** Explicitly fix a native-resolved default for a new no-selection request.
   * Leaves all caller identity/workspace fields and original RPC id unchanged. */
  pinCreationPreset(presetId: string): Uint8Array
  decodeResponse(body: Uint8Array): HarnessAgentPresetResponse
}

/** Native wire validation only; the enterprise caller supplies live object
 * eligibility. This is neither a second catalog nor an execution permission.
 * Other operations, including historical session reads, are not projected. */
export function prepareHarnessAgentPresetRequest(method: string, target: string, contentType: string | undefined,
  body: Uint8Array): HarnessAgentPresetRequest | undefined {
  const path = new URL(target, 'http://native.invalid').pathname
  const kind = path === '/api/agentPreset.list' ? 'list' : path === '/api/agentPreset.read' ? 'read'
    : path === '/api/agentPreset.select' ? 'select' : path === '/api/session.create' ? 'create' : path === '/api/session.fork' ? 'fork' : undefined
  if (!kind) return undefined
  if (path !== target) throw Error('Aliased native preset carrier')
  const operation = decodeHarnessRpcOperation(method, target, contentType, body)
  const payload = kind === 'list' ? agentPresetListRequestSchema.parse(operation.args)
    : kind === 'read' ? agentPresetReadRequestSchema.parse(operation.args) : kind === 'select' ? agentPresetSelectRequestSchema.parse(operation.args)
      : kind === 'create' ? sessionCreateRequestSchema.parse(operation.args) : sessionForkRequestSchema.parse(operation.args)
  const presetId = 'agentPreset' in payload ? payload.agentPreset : undefined
  const validId = (id: string) => id.length > 0 && id.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(id)
  if (presetId !== undefined && !validId(presetId)) throw Error('Invalid native preset identity')
  const originalRequest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)), { rpcId } = originalRequest
  return Object.freeze({ kind, ...(presetId === undefined ? {} : { presetId }),
    ...(kind === 'fork' && 'sessionId' in payload && payload.sessionId !== undefined ? { forkSourceSessionId: payload.sessionId } : {}),
    ...(kind === 'create' && 'sessionId' in payload && payload.sessionId !== undefined ? { createSessionId: payload.sessionId } : {}),
    pinCreationPreset(id: string): Uint8Array {
      if (kind !== 'create' || presetId !== undefined || typeof id !== 'string' || !validId(id)) throw Error('Invalid native default preset binding')
      return Buffer.from(JSON.stringify({ ...originalRequest, payload: { ...originalRequest.payload, agentPreset: id } }))
    },
    decodeResponse(bytes: Uint8Array): HarnessAgentPresetResponse {
      if (!bytes.byteLength || bytes.byteLength > 1024 * 1024) throw Error('Invalid native preset response size')
      const original = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      const response = serverResponseSchema.parse(original)
      if (response.rpcId !== rpcId) throw Error('Uncorrelated native preset response')
      let ids: string[] = []
      const missing = !response.result.ok && response.result.error.code === 'agent-preset-not-found'
      if (response.result.ok) {
        if (kind === 'list') ids = agentPresetListValueSchema.parse(response.result.value).presets.map(row => row.id)
        else if (kind === 'create') {
          const value = sessionCreateValueSchema.parse(response.result.value)
          if (presetId !== undefined) {
            if (value.agentPreset !== presetId) throw Error('Native created preset identity changed')
            ids = [presetId]
          }
          if ('sessionId' in payload && payload.sessionId !== undefined && value.sessionId !== payload.sessionId) throw Error('Native resumed session identity changed')
          // A no-selection create is also the native historical resume path.
          // Returning its original preset metadata does not authorize execution.
        } else if (kind === 'fork') sessionForkValueSchema.parse(response.result.value)
        else {
          const value = kind === 'read' ? agentPresetReadValueSchema.parse(response.result.value) : agentPresetSelectValueSchema.parse(response.result.value)
          if (value.agentPreset !== presetId) throw Error('Native preset response identity changed')
          ids = [value.agentPreset]
        }
      } else if (response.result.error.code === 'agent-preset-not-found') ids = response.result.error.details.available
      if (ids.length > 4096 || ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) throw Error('Invalid native preset roster')
      const requiresSelection = (kind === 'read' || kind === 'select' || kind === 'create' && presetId !== undefined) && response.result.ok
      return Object.freeze({ presetIds: Object.freeze(ids), requiresSelection, project(eligibleIds: readonly string[]): Uint8Array {
        if (!Array.isArray(eligibleIds) || new Set(eligibleIds).size !== eligibleIds.length
          || eligibleIds.some(id => !ids.includes(id))) throw Error('Invalid native preset eligibility projection')
        if (requiresSelection && eligibleIds.length !== ids.length) throw Error('Native preset is not eligible')
        if (missing) return Buffer.from(JSON.stringify({ ...original, result: { ...original.result, error: { ...original.result.error,
          // Native error text may inline the unfiltered available roster.
          message: 'Agent preset not found', details: { ...original.result.error.details, available: ids.filter(id => eligibleIds.includes(id)) } } } }))
        if (kind !== 'list' || !response.result.ok) return Uint8Array.from(bytes)
        const allowed = new Set(eligibleIds)
        return Buffer.from(JSON.stringify({ ...original, result: { ...original.result, value: { ...original.result.value,
          presets: original.result.value.presets.filter((row: { id: string }) => allowed.has(row.id)) } } }))
      } })
    },
  })
}

/** rc.2 copies prompt RPC IDs into UserMessage.source. That field is not a
 * login credential; the enterprise gateway supplies its own signed association.
 * Approval responses, event downlinks and all other native envelopes are untouched. */
export function prepareHarnessInteractiveRequest(method: string, target: string, contentType: string | undefined,
  body: Uint8Array): HarnessInteractiveRequest | undefined {
  const path = new URL(target, 'http://native.invalid').pathname
  if (!['/api/session.prompt', '/api/subagent.prompt', '/api/session.updateQueue'].includes(path)) return undefined
  // Native's URL parser ignores query strings and normalizes dot segments.
  // Do not let those alternate carriers silently bypass source stamping.
  if (target !== path) throw new Error('Aliased native interactive carrier')
  const operation = decodeHarnessRpcOperation(method, target, contentType, body)
  const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
  const payload = operation.endpoint === 'session.prompt' ? sessionPromptRequestSchema.parse(operation.args)
    : operation.endpoint === 'session.updateQueue' ? sessionUpdateQueueRequestSchema.parse(operation.args)
      : subagentPromptRequestSchema.parse(operation.args)
  const nativeSessionId = 'sessionId' in payload ? payload.sessionId : payload.childSessionId
  if (!nativeSessionId || nativeSessionId.length > 200 || typeof decoded.rpcId !== 'string'
    || decoded.rpcId.length === 0 || decoded.rpcId.length > 200 || decoded.rpcId !== decoded.rpcId.trim()
    || /[\u0000-\u001f\u007f]/u.test(decoded.rpcId)) throw new Error('Invalid native interactive identity')
  const clientRpcId: string = decoded.rpcId
  const sourceValid = (source: string) => {
    if (typeof source !== 'string' || source.length === 0 || source.length > 1536) throw new Error('Invalid native interactive source')
  }
  const requiresPresetEligibility = operation.endpoint !== 'session.updateQueue'
    || !('action' in payload) || payload.action.kind !== 'remove'
  return Object.freeze({ nativeSessionId, clientRpcId, requiresPresetEligibility,
    stamp(source: string): Uint8Array {
      sourceValid(source)
      // Use the original decoded object, not Zod's stripped/defaulted output.
      return Buffer.from(JSON.stringify({ ...decoded, rpcId: source }))
    },
    restoreResponse(bytes: Uint8Array, source: string): Uint8Array {
      sourceValid(source)
      if (bytes.byteLength === 0 || bytes.byteLength > 256 * 1024) throw new Error('Invalid native interactive response size')
      const original = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      const parsed = serverResponseSchema.safeParse(original)
      if (!parsed.success || parsed.data.rpcId !== source) throw new Error('Uncorrelated native interactive response')
      return Buffer.from(JSON.stringify({ ...original, rpcId: clientRpcId }))
    },
  })
}

/** Read only the selected cell's canonical history owner at the empty sequence
 * boundary. Never create a session or maintain a second existence registry. */
export function createHarnessSessionReadback(sessionId: string, rpcId: string): string {
  if (!sessionId || sessionId.length > 200 || !rpcId || rpcId.length > 200) throw new Error('Invalid native session readback')
  return JSON.stringify({ type: 'client-request', rpcId, method: 'session.history', payload: { sessionId, beforeSeq: 0, maxMessages: 1 } })
}

/** Fixed original API liveness call. It reads no HTML, session content,
 * credentials or files and does not prove UI, model or member admission. */
export function createHarnessHostHealthReadback(rpcId: string): Readonly<{ path: string; body: string }> {
  if (typeof rpcId !== 'string' || rpcId.length === 0 || rpcId.length > 200) throw Error('Invalid native health correlation')
  return { path: '/api/host.describe', body: JSON.stringify({ type: 'client-request', rpcId, method: 'host.describe', payload: {} }) }
}

export function verifyHarnessHostHealthReadback(text: string, rpcId: string): void {
  try {
    createHarnessHostHealthReadback(rpcId)
    if (text.length > 64 * 1024) throw Error()
    const response = serverResponseSchema.parse(JSON.parse(text))
    if (response.rpcId !== rpcId || !response.result.ok) throw Error()
    hostDescribeValueSchema.parse(response.result.value)
  } catch { throw Error('Native host health unavailable') }
}

/** Fixed readonly inspection vocabulary. Identity, reason and audit are owned
 * by the enterprise caller; this codec cannot authorize a target cell. */
export type HarnessSessionInspectionSelection = Readonly<{ kind: 'sessions' }>
  | Readonly<{ kind: 'history'; sessionId: string; beforeSeq?: number }>
export type HarnessSessionInspectionPage = Readonly<{ kind: 'sessions'; items: readonly {
  sessionId: string; title: string | null; updatedAt: number; running: boolean; blank: boolean; presetId?: string; parentSessionId?: string
}[] }> | Readonly<{ kind: 'history'; sessionId: string; nextBeforeSeq: number | null; messages: readonly {
  seq: number; time: number; role: 'user' | 'assistant'; text: string; omittedBlocks: number
}[] }>

export function createHarnessSessionInspection(selection: HarnessSessionInspectionSelection, rpcId: string): Readonly<{ path: string; body: string }> {
  if (!rpcId || rpcId.length > 200 || !selection || typeof selection !== 'object') throw new Error('Invalid native inspection')
  let method: string, payload: object
  if (selection.kind === 'sessions' && Object.keys(selection).length === 1) { method = 'session.list'; payload = {} }
  else if (selection.kind === 'history' && Object.keys(selection).every(key => ['kind', 'sessionId', 'beforeSeq'].includes(key))
    && typeof selection.sessionId === 'string' && selection.sessionId.length > 0 && selection.sessionId.length <= 200
    && !/[\u0000-\u001f\u007f]/u.test(selection.sessionId)
    && (selection.beforeSeq === undefined || Number.isSafeInteger(selection.beforeSeq) && selection.beforeSeq > 0)) {
    method = 'session.history'; payload = { sessionId: selection.sessionId, maxMessages: 20,
      ...(selection.beforeSeq === undefined ? {} : { beforeSeq: selection.beforeSeq }) }
  } else throw new Error('Invalid native inspection selection')
  return Object.freeze({ path: '/api/' + method, body: JSON.stringify({ type: 'client-request', rpcId, method, payload }) })
}

export function decodeHarnessSessionInspection(text: string, rpcId: string, selection: HarnessSessionInspectionSelection): HarnessSessionInspectionPage {
  createHarnessSessionInspection(selection, rpcId)
  const response = serverResponseSchema.parse(JSON.parse(text))
  if (response.rpcId !== rpcId || !response.result.ok) throw new Error('Native inspection read failed')
  if (selection.kind === 'sessions') {
    // The selected native release's generated schema declaration widens branded
    // string outputs to deep-partial shapes. Its runtime schema above remains
    // authoritative; narrow only the fields this readonly projection consumes.
    const value = sessionListValueSchema.parse(response.result.value) as unknown as { items: Array<{
      sessionId: string; updatedAt: number; running: boolean; blank: boolean; agentPreset?: string; parentSessionId?: string;
      projections?: { values: Record<string, unknown> }
    }> }
    if (value.items.length > 500 || new Set(value.items.map(row => row.sessionId)).size !== value.items.length) throw new Error('Native inspection list exceeds its bound')
    return Object.freeze({ kind: 'sessions', items: Object.freeze(value.items.map(row => {
      const title = row.projections?.values.title ?? null
      if (row.sessionId.length > 200 || !Number.isFinite(row.updatedAt) || title !== null && (typeof title !== 'string' || title.length > 2000)
        || row.agentPreset !== undefined && row.agentPreset.length > 200 || row.parentSessionId !== undefined && row.parentSessionId.length > 200) throw new Error('Invalid native inspection row')
      return Object.freeze({ sessionId: row.sessionId, title, updatedAt: row.updatedAt, running: row.running, blank: row.blank,
        ...(row.agentPreset === undefined ? {} : { presetId: row.agentPreset }),
        ...(row.parentSessionId === undefined ? {} : { parentSessionId: row.parentSessionId }) })
    })) })
  }
  const value = sessionHistoryValueSchema.parse(response.result.value) as unknown as {
    events: Array<{ event: { type: string; seq: number; time: number; data: unknown } }>; hasMore: boolean
  }
  if (value.events.length > 10000) throw new Error('Native inspection history exceeds its bound')
  const messages: Array<{ seq: number; time: number; role: 'user' | 'assistant'; text: string; omittedBlocks: number }> = []
  let previous = -1
  for (const { event } of value.events) {
    if (!Number.isSafeInteger(event.seq) || event.seq <= previous || !Number.isFinite(event.time)
      || selection.beforeSeq !== undefined && event.seq >= selection.beforeSeq) throw new Error('Invalid native history page order')
    previous = event.seq
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    const data = event.data as { content?: unknown; message?: { content?: unknown } } | null
    const blocks = event.type === 'user/message' ? data?.content : data?.message?.content
    if (!Array.isArray(blocks)) throw new Error('Invalid native visible message')
    const visible: string[] = []; let omittedBlocks = 0
    for (const block of blocks) {
      if (block && block.type === 'text' && typeof block.text === 'string') visible.push(block.text)
      else omittedBlocks += 1
    }
    messages.push({ seq: event.seq, time: event.time, role: event.type === 'user/message' ? 'user' : 'assistant', text: visible.join('\n'), omittedBlocks })
  }
  const first = value.events[0]?.event.seq
  if (value.hasMore && (first === undefined || first <= 0)) throw new Error('Invalid native history continuation')
  return Object.freeze({ kind: 'history', sessionId: selection.sessionId, nextBeforeSeq: value.hasMore ? first! : null,
    messages: Object.freeze(messages.map(row => Object.freeze(row))) })
}

/** Wire adapter for a registered PAIMind direct service method. Domain and
 * role authorization remain caller/owner responsibilities, not this codec. */
export function createHarnessServiceReadback(method: string, args: Readonly<Record<string, unknown>>, rpcId: string): string {
  if (!/^paimind[A-Za-z0-9]+\/[A-Za-z][A-Za-z0-9]+$/.test(method) || !rpcId) throw new Error('Invalid native service readback')
  return JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } })
}

export function decodeHarnessServiceReadback(text: string, rpcId: string): { ok: true; value: unknown } | { ok: false } {
  const response = serverResponseSchema.safeParse(JSON.parse(text))
  if (!response.success || response.data.rpcId !== rpcId) {
    throw new Error('Invalid native service readback response')
  }
  const result = response.data.result
  return result.ok ? { ok: true, value: result.value } : { ok: false }
}

export function decodeHarnessSessionReadback(text: string, rpcId: string, sessionId: string): 'present' | 'missing' {
  const response = serverResponseSchema.safeParse(JSON.parse(text))
  if (!response.success || response.data.rpcId !== rpcId) throw new Error('Invalid native session readback response')
  const result = response.data.result
  if (result.ok) {
    const value = sessionHistoryValueSchema.safeParse(result.value)
    if (!value.success || value.data.events?.length !== 0) throw new Error('Unexpected native session readback content')
    return 'present'
  }
  if (result.error.code === 'session-not-found' && result.error.details.sessionId === sessionId) return 'missing'
  throw new Error('Native session readback failed')
}

/** Only the host document receives the native execution policy. Files,
 * artifacts, API responses and unknown SPA-looking paths are never promoted. */
export function isHarnessDocumentRequest(method: string, target: string): boolean {
  return method === 'GET' && ['/', '/index.html'].includes(target.split('?')[0]!) && !target.includes('#')
}

/** Add credentials only to the exact published same-origin native manifest
 * link, before HTML parsing can launch an anonymous request. The admitted
 * document and its inline bootstrap still undergo the original CSP checks. */
export function harnessDocumentWithAuthenticatedManifest(html: string): string {
  if (Buffer.byteLength(html) > 256 * 1024) throw new Error('Unsupported native document size')
  const links = [...html.matchAll(/<link\b[^>]*>/giu)].filter(match => /\brel\s*=\s*(["'])manifest\1/iu.test(match[0]))
  if (links.length === 0) return html
  const native = '<link rel="manifest" href="/manifest.webmanifest" />'
  const authenticated = '<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />'
  if (links.length !== 1 || ![native, authenticated].includes(links[0]![0])) {
    throw new Error('Unsupported native manifest link')
  }
  return html.replace(native, authenticated)
}

/** 0.1.1-rc.2 ships an inline module queue, graph and theme bootstrap. Its
 * published frontend also instantiates Cordis's expression evaluator with
 * new Function at module scope. Preserve upstream HTML and hash its exact
 * trusted inline blocks; do not grant arbitrary inline scripts or file URLs.
 * This is NOT an HTML sanitizer and must only consume the admitted host root. */
export function harnessDocumentContentPolicy(html: string, publicOrigin: string, additionalDownlinkPaths: readonly string[] = []): string {
  const origin = new URL(publicOrigin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== publicOrigin
    || origin.username || origin.password) throw new Error('Invalid native document origin')
  if (Buffer.byteLength(html) > 256 * 1024 || !html.includes('window.__ModuleLoader__=')
    || !html.includes('globalThis["__DSH_BOOT__"] = ') || !html.includes('<div id="root"></div>')) {
    throw new Error('Unsupported native document bootstrap')
  }
  const hashes: string[] = []
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
    if (/\bsrc\s*=/iu.test(script[1]!)) continue
    if (script[1]!.trim() !== '') throw new Error('Unsupported inline script attributes')
    // HTML input preprocessing normalizes CRLF/CR before script hashing.
    hashes.push(`'sha256-${createHash('sha256').update(script[2]!.replace(/\r\n?/gu, '\n')).digest('base64')}'`)
  }
  if (hashes.length < 2 || hashes.length > 8) throw new Error('Unsupported native inline script count')
  if (additionalDownlinkPaths.length > 16 || new Set(additionalDownlinkPaths).size !== additionalDownlinkPaths.length
    || additionalDownlinkPaths.some(path => !/^\/[a-z][a-z0-9/-]{1,199}$/u.test(path)
      || path.endsWith('/') || path.includes('//'))) throw new Error('Invalid additional downlink path')
  const events = new URL(origin); events.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:'
  const downlinks = ['/api/events.host', '/api/events.mux', ...additionalDownlinkPaths].map(path => events.origin + path)
  return ["default-src 'none'", `script-src ${origin.origin}/assets/ ${origin.origin}/plugins/ 'unsafe-eval' ${hashes.join(' ')}`,
    "script-src-attr 'none'", "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${downlinks.join(' ')}`,
    "img-src 'self' data: blob:", "font-src 'self' data:", "manifest-src 'self'",
    "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'"].join('; ')
}
import { createHash } from 'node:crypto'
import { clientRequestSchema, clientResponseSchema, serverResponseSchema, serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { sessionHistoryValueSchema, sessionListValueSchema, sessionPromptRequestSchema, sessionUpdateQueueRequestSchema,
  sessionCreateRequestSchema, sessionCreateValueSchema, sessionForkRequestSchema, sessionForkValueSchema,
  sessionRenameRequestSchema, sessionSelectModelRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/sessions.schema'
import { goalCreateRequestSchema, goalEditRequestSchema, goalResumeRequestSchema, goalCompleteRequestSchema,
  goalClearRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/goals.schema'
import { subagentPromptRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/subagents.schema'
import { hostDescribeValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/host.schema'

/** Selected native mux is a wakeup signal only. Bodies never leave this
 * compatibility decoder; ordered/replayable content comes from its owner log.
 * Buffers are bounded and malformed/failed streams fail rather than skip. */
export function decodeHarnessSessionEventWakeup(sessionId: string, bytes: Uint8Array): boolean {
  if (!sessionId || sessionId.length > 200) throw Error('Invalid native event selection')
  if (bytes.byteLength > 512 * 1024) throw Error('Native event frame exceeds bound')
  const value = serverRequestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  const payload = value.payload as { type?: unknown; sessionId?: unknown; event?: { seq?: unknown } } | undefined
  if (!payload || payload.type !== value.method || value.method === 'stream/error') throw Error('Native event stream failed')
  if (payload.sessionId !== sessionId) return false
  if (value.method === 'session/event' && (!Number.isSafeInteger(payload.event?.seq) || (payload.event!.seq as number) < 0)) throw Error('Invalid native event sequence')
  return ['session/event', 'session/subscribed'].includes(value.method)
}
import { agentPresetListRequestSchema, agentPresetListValueSchema, agentPresetReadRequestSchema, agentPresetReadValueSchema,
  agentPresetSelectRequestSchema, agentPresetSelectValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/agent-presets.schema'
export { prepareHarnessSessionProducedRead, prepareHarnessSessionArtifactWorkspaceRead,
  type HarnessProducedFileFact, type HarnessSessionProducedRead } from './session-artifacts.js'
