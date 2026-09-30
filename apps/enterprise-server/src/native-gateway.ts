import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { request as httpRequest, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer } from 'ws'
import { classifyHarnessReadRequest, createHarnessSessionReadback, decodeHarnessSessionReadback, harnessDocumentContentPolicy, harnessDocumentWithAuthenticatedManifest, isHarnessDocumentRequest, isHarnessDownlink, prepareHarnessInteractiveRequest, prepareHarnessAgentPresetRequest, readHarnessSessionMutationRequest, prepareHarnessExportCommandRequest } from '@paimind/harness-compat/gateway-transport'
import { PAIMIND_SIDEBAR_DOWNLINK_PATHS, parsePaimindSidebarDownlink, parsePaimindSidebarTreeRequest, projectPaimindSidebarTree,
  parsePaimindSidebarFileRequest, projectPaimindSidebarFile, parsePaimindSidebarFileResource, preparePaimindSidebarPresentationRead } from '@paimind/better-sidebar-adapter'
import { EnterpriseError } from './errors.js'
import { header, sessionToken, validateRequest } from './http-boundary.js'
import { developmentCellOrigin, type RuntimeGrant } from './runtime-bindings.js'
import type { NativeOperationRequest } from './native-operation-policy.js'
import { CellControlRejected, type CellTransport } from './cell-transport.js'
import { validateNativeSessionPresetReference, validateNativeSessionCreationReference, validateNativeSessionTurnState, type NativeSessionTurnState,
  validateNativeSessionEventPage, type NativeSessionEventPage, validateNativeApprovalReference, type NativeApprovalReference,
  validateNativeFileChunk, type NativeFileChunk } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { retainCellTransports, selectCellTransport } from './cell-transport-directory.js'
import { createHarnessServiceReadback, decodeHarnessServiceReadback } from '@paimind/harness-compat/gateway-transport'
import { createHarnessSessionInspection, decodeHarnessSessionInspection, type HarnessSessionInspectionSelection, type HarnessSessionInspectionPage } from '@paimind/harness-compat/gateway-transport'
import { prepareHarnessSessionCreation, prepareHarnessSessionWorkspaceRead, type HarnessSessionCreation } from '@paimind/harness-compat/gateway-transport'
import { prepareHarnessTurnSubmission, type NativeTurnSelection } from '@paimind/harness-compat/gateway-transport'
import { decodeHarnessSessionEventWakeup } from '@paimind/harness-compat/gateway-transport'
import { prepareHarnessApprovalResponse } from '@paimind/harness-compat/gateway-transport'
import { prepareHarnessSessionProducedRead, prepareHarnessSessionArtifactWorkspaceRead } from '@paimind/harness-compat/gateway-transport'
import { projectSessionArtifactRead } from '@paimind/artifacts'
import { serveSessionEvents } from './session-events.js'
import { prepareHarnessMemberSettingsRead, prepareHarnessCommandListRequest } from '@paimind/harness-compat/gateway-transport'
import { readAgentPublicationSnapshot, type AgentPublicationSnapshot } from '@paimind/agent-builder/publication'
import { adoptedPresetId, readAdoptionInput, readAdoptionReceipt, type AgentPublicationAdoptionInput } from '@paimind/agent-builder/adoption'
import type { RuntimeIdentity, InteractiveOriginScope } from './identity.js'
import type { PublicationSelection } from './publications.js'
import { readSkillPublicationSelection, transferSkillPublication, SKILL_PUBLICATION_EXPORT_TTL_MS,
  readSkillPublicationAdoptionInput, readSkillPublicationAdoption, transferSkillPublicationAdoption,
  type SkillPublicationSelection, type SkillPublicationExport, type SkillPublicationAdoptionInput } from '@paimind/skill-market/publication'

interface GatewayOptions {
  publicOrigin: string
  resolve: (token: string | undefined, requestId: string) => Promise<RuntimeGrant>
  authorize: (token: string | undefined, requestId: string, grant: RuntimeGrant, request: NativeOperationRequest,
    verifyResource: () => Promise<void>) => Promise<void>
  sealInteractiveOrigin?: (token: string | undefined, requestId: string, scope: InteractiveOriginScope, clientRpcId: string) => Promise<string>
  /** Current publication governance; absent means preset access fails closed. */
  agentPresetEligibility?: (token: string | undefined, requestId: string, grant: RuntimeGrant, presetIds: readonly string[]) => Promise<readonly string[]>
  revalidateMs?: number
  transports?: ReadonlyMap<string, CellTransport>
  onTransportFailure?: (event: { requestId: string; phase: string; code?: string }) => void
}
const upstreamFailure = () => new EnterpriseError(502, 'native-unavailable', '原生运行环境暂时不可用', true)
const sameGrant = (left: RuntimeGrant, right: RuntimeGrant) => left.cellId === right.cellId && left.tenantId === right.tenantId
  && left.userId === right.userId && left.role === right.role && left.revision === right.revision && left.origin === right.origin
  && left.transport === right.transport
const RESPONSE_HEADERS = ['content-type', 'content-encoding', 'content-length', 'content-range', 'accept-ranges', 'content-disposition']

/** Authenticated native carrier only. Does not own frontend assets, native
 * objects or RPC implementations; never forwards the enterprise cookie or
 * external identity/forwarding headers. Every stream is bound to one grant. */
export class NativeGateway {
  private readonly origin: URL
  private readonly interval: number
  private readonly downlinks = new WebSocketServer({ noServer: true, clientTracking: false, maxPayload: 1024, perMessageDeflate: false })
  private readonly active = new Set<() => void>()
  // Coalesce local creation attempts only; durable identity belongs to the
  // command owner, and cross-process deduplication belongs to native ensureSession.
  private readonly sessionCreations = new Set<string>()
  private readonly eventStreams = new Map<string, number>()
  private readonly transports: ReadonlyMap<string, CellTransport>
  private pending = 0
  private closed = false
  constructor(private readonly options: GatewayOptions) {
    if (typeof options.authorize !== 'function') throw new Error('An authenticated native-operation authorizer is required')
    this.origin = new URL(options.publicOrigin)
    this.transports = retainCellTransports(options.transports)
    for (const [origin, transport] of this.transports) {
      developmentCellOrigin(origin, this.origin.origin)
      if (transport.ingressOrigin !== origin) throw new Error('Private cell transport destination does not match its binding key')
    }
    this.interval = options.revalidateMs ?? 2_000
    if (!Number.isSafeInteger(this.interval) || this.interval < 20 || this.interval > 2_500) throw new Error('Invalid revalidation interval')
    this.downlinks.on('error', () => this.close())
  }

  private async admit(token: string | undefined, requestId: string): Promise<RuntimeGrant> {
    if (this.closed || this.active.size + this.pending >= 128) throw new EnterpriseError(503, 'gateway-busy', '运行连接已达上限', true)
    this.pending += 1
    const started = performance.now()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const grant = await Promise.race([this.options.resolve(token, requestId), new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(upstreamFailure()), 5_000); timeout.unref()
      })])
      if (this.closed) throw upstreamFailure()
      developmentCellOrigin(grant.origin, this.origin.origin)
      if ((grant.transport === 'private-cell') !== this.transports.has(grant.origin)) throw upstreamFailure()
      if (!['admin', 'member'].includes(grant.role)) throw upstreamFailure()
      const validForMs = Math.floor(grant.validForMs - (performance.now() - started))
      if (!Number.isFinite(validForMs) || validForMs <= 0) throw upstreamFailure()
      return { ...grant, validForMs }
    } finally { clearTimeout(timeout); this.pending -= 1 }
  }

  private async authorize(token: string | undefined, requestId: string, grant: RuntimeGrant,
    request: NativeOperationRequest, verifyOperationResource?: () => Promise<void>): Promise<RuntimeGrant> {
    const started = performance.now()
    const resource = parsePaimindSidebarDownlink(request.method, request.target)
    let checked = resource === undefined && verifyOperationResource === undefined
    let resourceCheck: Promise<void> | undefined
    const verifyResource = () => resourceCheck ??= (async () => {
      if (resource) await this.assertOwnedSession(grant, resource.sessionId)
      await verifyOperationResource?.()
      checked = true
    })()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const current = await Promise.race([(async () => {
        await this.options.authorize(token, requestId, grant, request, verifyResource)
        if (!checked) throw upstreamFailure() // A caller cannot silently omit the audited resource gate.
        // Operation authorization may wait on audit/policy IO. A maintenance
        // suspension or binding replacement during that wait invalidates the
        // original selection before any upstream request or handshake begins.
        return this.admit(token, requestId)
      })(), new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(upstreamFailure()), Math.min(5_000, grant.validForMs)); timeout.unref()
      })])
      const validForMs = Math.floor(Math.min(current.validForMs, grant.validForMs - (performance.now() - started)))
      if (this.closed || !sameGrant(grant, current) || validForMs <= 0) throw upstreamFailure()
      return { ...grant, validForMs }
    } finally { clearTimeout(timeout) }
  }

  private async eligiblePresets(token: string | undefined, requestId: string, grant: RuntimeGrant,
    presetIds: readonly string[]): Promise<readonly string[]> {
    const read = this.options.agentPresetEligibility
    if (!read) throw new EnterpriseError(503, 'preset-eligibility-unavailable', '智能体当前分配校验尚未就绪', true)
    const selected = Object.freeze([...presetIds]), started = performance.now()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([(async () => {
        const eligible = await read(token, requestId, { ...grant }, selected)
        if (!Array.isArray(eligible) || new Set(eligible).size !== eligible.length || eligible.some(id => !selected.includes(id))) throw upstreamFailure()
        const current = await this.admit(token, requestId)
        if (this.closed || !sameGrant(grant, current) || performance.now() - started >= grant.validForMs) throw upstreamFailure()
        return Object.freeze([...eligible])
      })(), new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(upstreamFailure()), Math.min(5000, grant.validForMs)); timeout.unref()
      })])
    } catch (error) { throw error instanceof EnterpriseError ? error : upstreamFailure() }
    finally { clearTimeout(timeout) }
  }

  private async sourceSessionPreset(grant: RuntimeGrant, sessionId: string, operation: 'fork' | 'write' | 'commands'): Promise<string | undefined> {
    const transport = selectCellTransport(this.transports, grant)
    if (!transport || grant.transport !== 'private-cell') throw new EnterpriseError(503, `${operation}-source-inspection-unavailable`, '原生会话来源检查尚未就绪', true)
    let value: unknown
    try { value = await transport.requestControl('session.preset', { sessionId }, undefined, Math.min(4000, grant.validForMs)) }
    catch (error) {
      if (error instanceof CellControlRejected) throw new EnterpriseError(403, `${operation}-source-unavailable`, '当前会话不存在或无法确认其来源')
      throw upstreamFailure()
    }
    try { validateNativeSessionPresetReference(value, sessionId) } catch { throw upstreamFailure() }
    const reference = value
    // Preset selection is native-locked after a turn has ended. Do not admit a
    // still-blank source which can change composition during governance IO.
    if (operation === 'fork' && !reference.hasForkBoundary) throw new EnterpriseError(409, 'fork-source-not-ready', '此会话尚无可分叉的已结束轮次，请稍后重试')
    if (operation !== 'fork' && reference.agentPreset === null) throw new EnterpriseError(409, 'session-preset-unresolved', '无法确认此会话的当前智能体，请重新选择后重试')
    return reference.agentPreset ?? undefined
  }

  /** Prove the session exists in the admitted cell using its canonical owner.
   * Bounded response bytes stay private; no cookie, identity or transport key
   * enters the native body. A valid cell grant alone does not prove ownership. */
  private async readApproval(transport: CellTransport, sessionId: string, approvalId: string, signal: AbortSignal): Promise<NativeApprovalReference> {
    try {
      const value = await transport.requestControl('session.approval', { sessionId, approvalId }, signal, 4000)
      validateNativeApprovalReference(value, sessionId, approvalId)
      return value
    } catch (error) {
      if (error instanceof CellControlRejected) throw new EnterpriseError(403, 'approval-unavailable', '当前会话审批不存在或无法读取')
      throw error instanceof EnterpriseError ? error : upstreamFailure()
    }
  }

  private async assertOwnedSession(grant: RuntimeGrant, sessionId: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw upstreamFailure()
    if (this.closed || this.active.size + this.pending >= 128) throw new EnterpriseError(503, 'gateway-busy', '运行连接已达上限', true)
    const selected = developmentCellOrigin(grant.origin, this.origin.origin)
    const transport = selectCellTransport(this.transports, grant)
    const target = transport ? new URL(transport.nativeOrigin) : selected
    const rpcId = randomUUID(), body = createHarnessSessionReadback(sessionId, rpcId)
    this.pending += 1
    try { return await new Promise<void>((resolve, reject) => {
      let settled = false
      let incoming: IncomingMessage | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (error?: EnterpriseError) => {
        if (settled) return
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abandoned)
        if (error) { incoming?.destroy(); outbound.destroy(); reject(error) }
        else resolve()
      }
      const outbound = httpRequest({ hostname: target.hostname, port: target.port, method: 'POST', path: '/api/session.history',
        agent: transport ?? false, headers: { host: target.host, origin: target.origin, connection: 'close',
          'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), 'accept-encoding': 'identity' } }, received => {
        incoming = received
        if (received.statusCode !== 200 || received.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
          || received.headers['content-encoding'] && received.headers['content-encoding'] !== 'identity') { finish(upstreamFailure()); return }
        let size = 0
        const chunks: Buffer[] = []
        received.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 1024 * 1024) { finish(upstreamFailure()); return }
          if (!settled) chunks.push(chunk)
        })
        received.once('error', () => finish(upstreamFailure()))
        received.once('end', () => {
          if (settled) return
          try {
            const state = decodeHarnessSessionReadback(Buffer.concat(chunks).toString('utf8'), rpcId, sessionId)
            finish(state === 'missing' ? new EnterpriseError(403, 'native-session-denied', '当前账户无法访问该会话') : undefined)
          } catch { finish(upstreamFailure()) }
        })
      })
      const abandoned = () => finish(upstreamFailure())
      signal?.addEventListener('abort', abandoned, { once: true })
      outbound.once('error', () => finish(upstreamFailure()))
      timer = setTimeout(() => finish(upstreamFailure()), Math.min(4_000, grant.validForMs)); timer.unref()
      if (signal?.aborted) abandoned()
      else outbound.end(body)
    }) } finally { this.pending -= 1 }
  }

  /** Internal command-target selection; not an externally transferable grant. */
  async sessionCreationTarget(token: string | undefined, requestId: string): Promise<RuntimeGrant> {
    const grant = await this.admit(token, requestId)
    if (grant.transport !== 'private-cell') throw new EnterpriseError(503, 'session-creation-unavailable', '会话创建需要准确的独立运行单元', true)
    return grant
  }

  /** Used only by the durable creation command owner, with a server-reserved
   * native ID. Recovery is specific to the native idempotent create/attach
   * contract; never apply this policy to prompts or other native mutations. */
  async sessionCreation(token: string | undefined, requestId: string, targetGrant: RuntimeGrant,
    input: HarnessSessionCreation, write: boolean, cancellation: AbortSignal): Promise<{ workspaceExists: boolean; created: boolean; dispatched: boolean }> {
    const first = await this.sessionCreationTarget(token, requestId)
    if (!sameGrant(first, targetGrant)) throw new EnterpriseError(409, 'session-runtime-changed', '会话运行单元已变化，旧创建请求不会转发到另一单元')
    const wire = prepareHarnessSessionCreation(input, randomUUID())
    const grant = await this.authorize(token, requestId, first, { method: 'POST', target: wire.path,
      contentType: 'application/json', body: Buffer.from(wire.body) }, async () => {
      if (!(await this.eligiblePresets(token, requestId, first, [input.presetId])).includes(input.presetId)) {
        throw new EnterpriseError(403, 'session-preset-denied', '智能体当前未获分配或已撤回')
      }
    })
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, cancellation, AbortSignal.timeout(15000)])
    const stop = this.watch(token, grant, () => controller.abort())
    try {
      signal.throwIfAborted()
      const transport = selectCellTransport(this.transports, grant)
      if (!transport) throw upstreamFailure()
      const request = async (carrier: { path: string; body: string }): Promise<string> => {
        signal.throwIfAborted()
        const target = new URL(transport.nativeOrigin)
        return new Promise((resolve, reject) => {
          const outbound = httpRequest({ hostname: target.hostname, port: target.port, method: 'POST', path: carrier.path, agent: transport, signal,
            headers: { host: target.host, origin: target.origin, 'content-type': 'application/json',
              'content-length': Buffer.byteLength(carrier.body), 'accept-encoding': 'identity' } }, async response => {
            try {
              if (response.statusCode !== 200 || response.headers['content-type']?.split(';')[0]?.trim() !== 'application/json'
                || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw upstreamFailure()
              const chunks: Buffer[] = []; let size = 0
              for await (const part of response) {
                const bytes = Buffer.from(part); size += bytes.length; signal.throwIfAborted()
                if (size > 2 * 1024 * 1024) throw upstreamFailure()
                chunks.push(bytes)
              }
              resolve(Buffer.concat(chunks).toString('utf8'))
            } catch { response.destroy(); outbound.destroy(); reject(upstreamFailure()) }
          })
          outbound.once('error', () => reject(upstreamFailure()))
          outbound.setTimeout(8000, () => outbound.destroy(upstreamFailure()))
          outbound.end(carrier.body)
        })
      }
      const workspaceWire = prepareHarnessSessionWorkspaceRead(input.workspaceId, input.sessionId, randomUUID())
      let workspace = workspaceWire.decode(await request(workspaceWire))
      if (!workspace.exists) {
        const latest = await this.admit(token, requestId)
        signal.throwIfAborted()
        if (!sameGrant(grant, latest)) throw upstreamFailure()
        return { workspaceExists: false, created: false, dispatched: false }
      }
      const referenceRead = async () => {
        const reference = await transport.requestControl('session.creation', { sessionId: input.sessionId }, signal, 4000)
        validateNativeSessionCreationReference(reference, input.sessionId)
        return reference
      }
      let reference = await referenceRead()
      let dispatched = false
      const complete = () => reference.kind === 'existing' && reference.agentPreset === input.presetId && workspace.attached
      const creationKey = `${grant.cellId}/${grant.revision}/${input.sessionId}`
      if (write && !complete() && !this.sessionCreations.has(creationKey)) {
        // An existing different preset is a conflict, not a partially created
        // object we may repair. Native ensureSession additionally checks cwd.
        if (reference.kind === 'existing' && reference.agentPreset !== input.presetId) {
          throw new EnterpriseError(409, 'session-native-conflict', '原生会话预设已变化，不能恢复原创建请求')
        }
        this.sessionCreations.add(creationKey)
        dispatched = true
        // Even a negative/unreadable reply can follow partial native effects.
        // Fixed-ID native ensureSession joins concurrent work, preserves an
        // existing identity, and original workspace attachment is a no-op when
        // already present. This single explicit attempt is not a retry loop.
        try { wire.verify(await request(wire)) } catch { /* Retain uncertainty until the owner confirms. */ }
        finally { this.sessionCreations.delete(creationKey) }
        workspace = workspaceWire.decode(await request(workspaceWire))
        reference = await referenceRead()
      }
      const latest = await this.admit(token, requestId)
      signal.throwIfAborted()
      if (!sameGrant(grant, latest)) throw upstreamFailure()
      return { workspaceExists: workspace.exists, created: complete(), dispatched }
    } catch (error) { throw error instanceof EnterpriseError ? error : upstreamFailure() }
    finally { stop() }
  }

  /** Private, read-only original version and insertion evidence. In-memory
   * insertion alone is not a durable acknowledgement or execution success. */
  async sessionTurnState(token: string | undefined, requestId: string, sessionId: string, cancellation: AbortSignal,
    selection?: NativeTurnSelection, execution = false, target?: RuntimeGrant): Promise<{ grant: RuntimeGrant; state: NativeSessionTurnState }> {
    const first = await this.sessionCreationTarget(token, requestId)
    if (target && !sameGrant(first, target)) throw new EnterpriseError(409, 'session-runtime-changed', '轮次所选运行单元已变化')
    const controller = new AbortController(), signal = AbortSignal.any([cancellation, controller.signal, AbortSignal.timeout(8000)])
    const stop = this.watch(token, first, () => controller.abort())
    try {
      const carrier = createHarnessSessionInspection({ kind: 'history', sessionId }, randomUUID())
      const transport = selectCellTransport(this.transports, first)
      if (!transport) throw upstreamFailure()
      let state: NativeSessionTurnState | undefined
      const grant = await this.authorize(token, requestId, first, { method: 'POST', target: carrier.path,
        contentType: 'application/json', body: Buffer.from(carrier.body) }, async () => {
        await this.assertOwnedSession(first, sessionId, signal)
        const value = await transport.requestControl('session.turn-state', { sessionId, ...(selection ? { selection } : {}) }, signal, 4000)
        validateNativeSessionTurnState(value, sessionId); state = value
        if (execution && (!value.presetId || !(await this.eligiblePresets(token, requestId, first, [value.presetId])).includes(value.presetId))) {
          throw new EnterpriseError(403, 'preset-not-eligible', '此智能体已撤回或当前未分配，历史仍可查看，但不能继续执行')
        }
      })
      signal.throwIfAborted()
      return { grant, state: state! }
    } catch (error) { throw error instanceof EnterpriseError ? error : upstreamFailure() }
    finally { stop() }
  }

  /** Read the owned native approval with fresh actor and preset authority.
   * Observed state is neither a durable decision nor an execution grant. */
  async sessionApprovalState(token: string | undefined, requestId: string, sessionId: string, approvalId: string,
    cancellation: AbortSignal, execution: boolean, target?: RuntimeGrant): Promise<{ grant: RuntimeGrant; state: NativeApprovalReference; presetId: string }> {
    const first = await this.sessionCreationTarget(token, requestId)
    if (target && !sameGrant(first, target)) throw new EnterpriseError(409, 'session-runtime-changed', '审批所选运行单元已变化')
    const controller = new AbortController(), signal = AbortSignal.any([cancellation, controller.signal, AbortSignal.timeout(8000)])
    const stop = this.watch(token, first, () => controller.abort())
    try {
      const transport = selectCellTransport(this.transports, first); if (!transport) throw upstreamFailure()
      const carrier = createHarnessSessionInspection({ kind: 'history', sessionId }, randomUUID())
      let state: NativeApprovalReference | undefined, presetId: string | undefined
      const grant = await this.authorize(token, requestId, first, { method: 'POST', target: carrier.path,
        contentType: 'application/json', body: Buffer.from(carrier.body) }, async () => {
        await this.assertOwnedSession(first, sessionId, signal)
        state = await this.readApproval(transport, sessionId, approvalId, signal)
        presetId = await this.sourceSessionPreset(first, sessionId, 'write')
        if (!presetId) throw upstreamFailure()
        if (execution && !(await this.eligiblePresets(token, requestId, first, [presetId])).includes(presetId)) {
          throw new EnterpriseError(403, 'preset-not-eligible', '此智能体当前不可执行，不能批准或重放批准；仍可拒绝原请求')
        }
        if (await this.sourceSessionPreset(first, sessionId, 'write') !== presetId) throw new EnterpriseError(409, 'session-preset-changed', '会话智能体已变化')
      })
      signal.throwIfAborted(); return { grant, state: state!, presetId: presetId! }
    } catch (error) { throw error instanceof EnterpriseError ? error : upstreamFailure() }
    finally { stop() }
  }

  /** One explicit attempt through the existing native consumer. The caller
   * reserves the original rpcId; no replay can select a new pending request. */
  async submitSessionApproval(token: string | undefined, requestId: string, target: RuntimeGrant,
    input: { sessionId: string; approvalId: string; expectedVersion: string; rpcId: string; outcome: 'allowed-once' | 'rejected' }, cancellation: AbortSignal): Promise<boolean> {
    const before = await this.sessionApprovalState(token, requestId, input.sessionId, input.approvalId, cancellation, input.outcome === 'allowed-once', target)
    if (!before.state.answerable) return false
    if (before.state.version !== input.expectedVersion || before.state.rpcId !== input.rpcId) throw new EnterpriseError(409, 'approval-state-changed', '审批已变化，不能改用另一待处理请求')
    const wire = prepareHarnessApprovalResponse('POST', '/api/respond', 'application/json', Buffer.from(JSON.stringify({ type: 'client-response', rpcId: input.rpcId,
      result: { ok: true, value: { sessionId: input.sessionId, approvalId: input.approvalId, outcome: input.outcome } } })))!
    const seal = this.options.sealInteractiveOrigin
    if (!seal) throw new EnterpriseError(503, 'approval-origin-unavailable', '审批登录来源校验尚未就绪', true)
    const controller = new AbortController(), signal = AbortSignal.any([cancellation, controller.signal, AbortSignal.timeout(8000)])
    const stop = this.watch(token, before.grant, () => controller.abort())
    try {
      const source = await new Promise<string>((resolve, reject) => {
        const abort = () => reject(upstreamFailure()); signal.addEventListener('abort', abort, { once: true })
        Promise.resolve().then(() => {
          signal.throwIfAborted()
          return seal(token, requestId, { tenantId: target.tenantId, userId: target.userId, role: target.role,
            cellId: target.cellId, nativeSessionId: input.sessionId }, wire.correlation(input.expectedVersion))
        }).then(value => { if (signal.aborted) reject(upstreamFailure()); else resolve(value) }, reject)
          .finally(() => signal.removeEventListener('abort', abort))
      })
      const bytes = wire.stamp(source, input.expectedVersion)
      let noPending = false
      const grant = await this.authorize(token, requestId, before.grant, { method: 'POST', target: '/api/respond', contentType: 'application/json', body: bytes }, async () => {
        const transport = selectCellTransport(this.transports, before.grant); if (!transport) throw upstreamFailure()
        const current = await this.readApproval(transport, input.sessionId, input.approvalId, signal)
        if (!current.answerable) { noPending = true; return }
        if (current.version !== input.expectedVersion || current.rpcId !== input.rpcId
          || await this.sourceSessionPreset(before.grant, input.sessionId, 'write') !== before.presetId) throw new EnterpriseError(409, 'approval-state-changed', '审批已变化，请回读原命令')
        if (input.outcome === 'allowed-once' && !(await this.eligiblePresets(token, requestId, before.grant, [before.presetId])).includes(before.presetId)) {
          throw new EnterpriseError(403, 'preset-not-eligible', '审批期间智能体资格已撤回')
        }
      })
      signal.throwIfAborted()
      if (noPending) return false
      const transport = selectCellTransport(this.transports, grant); if (!transport) throw upstreamFailure()
      const destination = new URL(transport.nativeOrigin)
      const accepted = await new Promise<boolean>((resolve, reject) => {
        const outbound = httpRequest({ hostname: destination.hostname, port: destination.port, method: 'POST', path: '/api/respond',
          agent: transport, signal, headers: { host: destination.host, origin: destination.origin, 'content-type': 'application/json',
            'content-length': bytes.byteLength, 'accept-encoding': 'identity' } }, async response => {
          try {
            if (response.statusCode !== 200 || response.headers['content-type']?.split(';')[0]?.trim() !== 'application/json'
              || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity' || response.headers['content-disposition']) throw upstreamFailure()
            const chunks: Buffer[] = []; let length = 0
            for await (const bytes of response) { length += bytes.length; signal.throwIfAborted(); if (length > 4096) throw upstreamFailure(); chunks.push(Buffer.from(bytes)) }
            resolve(wire.receipt(Buffer.concat(chunks)).accepted)
          } catch { response.destroy(); outbound.destroy(); reject(upstreamFailure()) }
        })
        outbound.once('error', () => reject(upstreamFailure())); outbound.setTimeout(8000, () => outbound.destroy(upstreamFailure())); outbound.end(bytes)
      })
      const current = await this.admit(token, requestId); signal.throwIfAborted()
      if (!sameGrant(grant, current)) throw upstreamFailure()
      return accepted
    } finally { stop() }
  }

  /** Versioned downstream-only log projection. Original mux frames only wake
   * bounded reads; no private frame/body is relayed or retained as history. */
  async sessionEvents(token: string | undefined, requestId: string, sessionId: string, cursor: string | undefined,
    response: ServerResponse, cancellation: AbortSignal): Promise<void> {
    const first = await this.sessionCreationTarget(token, requestId)
    const key = first.tenantId + '/' + first.userId
    if ((this.eventStreams.get(key) ?? 0) >= 2 || [...this.eventStreams.values()].reduce((a, b) => a + b, 0) >= 64) {
      throw new EnterpriseError(503, 'event-stream-capacity', '事件连接已达上限，请保留原游标', true)
    }
    this.eventStreams.set(key, (this.eventStreams.get(key) ?? 0) + 1)
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, cancellation])
    const stop = this.watch(token, first, () => controller.abort())
    const deadline = setTimeout(() => controller.abort(), 30000); deadline.unref()
    try {
      const carrier = createHarnessSessionInspection({ kind: 'history', sessionId }, randomUUID())
      const transport = selectCellTransport(this.transports, first)
      if (!transport) throw upstreamFailure()
      const current = async () => {
        signal.throwIfAborted()
        const latest = await this.admit(token, requestId)
        signal.throwIfAborted(); if (!sameGrant(first, latest)) throw upstreamFailure()
      }
      const read = async (selection: { afterSeq: number; afterDigest?: string }) => {
        signal.throwIfAborted()
        let value: NativeSessionEventPage | undefined
        await this.authorize(token, requestId, first, { method: 'POST', target: carrier.path,
          contentType: 'application/json', body: Buffer.from(carrier.body) }, async () => {
          await this.assertOwnedSession(first, sessionId, signal)
          const page = await transport.requestControl('session.events', { sessionId, ...selection }, signal, 4000)
          validateNativeSessionEventPage(page, sessionId, selection.afterSeq); value = page
        })
        signal.throwIfAborted(); return value!
      }
      await serveSessionEvents({ response, grant: first, sessionId, ...(cursor === undefined ? {} : { cursor }), signal, read, current,
        open: async notify => {
          await this.authorize(token, requestId, first, { method: 'GET', target: '/api/events.mux',
            contentType: undefined, body: new Uint8Array() }, () => this.assertOwnedSession(first, sessionId, signal))
          signal.throwIfAborted()
          return new Promise<() => void>((resolve, reject) => {
            let connected = false, stopped = false
            const target = new URL('/api/events.mux', transport.nativeOrigin)
            target.protocol = 'ws:'
            const carrier = new WebSocket(target, { headers: { origin: transport.nativeOrigin }, agent: transport, handshakeTimeout: 5000,
              maxPayload: 512 * 1024, perMessageDeflate: false, followRedirects: false })
            const close = () => {
              if (stopped) return; stopped = true; signal.removeEventListener('abort', aborted); carrier.terminate()
            }
            const fail = (phase: string) => {
              if (!stopped) { try { this.options.onTransportFailure?.({ requestId, phase }) } catch { /* Diagnostic only. */ } }
              close(); controller.abort(); if (!connected) reject(upstreamFailure())
            }
            const aborted = () => { close(); if (!connected) reject(upstreamFailure()) }
            carrier.once('open', () => { if (signal.aborted) { aborted(); return }; connected = true; resolve(close) })
            carrier.on('message', (bytes, binary) => {
              if (stopped) return
              try {
                if (binary) throw Error('Native event must be text')
                const data = Array.isArray(bytes) ? Buffer.concat(bytes) : Buffer.from(bytes as ArrayBuffer)
                if (decodeHarnessSessionEventWakeup(sessionId, data)) notify()
              } catch { fail('events-upstream-frame') }
            })
            carrier.once('error', () => fail('events-upstream-connect'))
            carrier.once('unexpected-response', (_request, response) => { response.destroy(); fail('events-upstream-headers') })
            carrier.once('close', () => fail('events-upstream-ended'))
            signal.addEventListener('abort', aborted, { once: true }); if (signal.aborted) aborted()
          })
        } })
    } finally {
      controller.abort(); stop(); clearTimeout(deadline)
      const count = this.eventStreams.get(key)! - 1
      if (count) this.eventStreams.set(key, count); else this.eventStreams.delete(key)
    }
  }

  /** Uses the original signed prompt route and its synchronous admission
   * guard. The durable command owner selects the fixed correlation, never a
   * different native message on retry. No database lock spans native I/O. */
  async submitSessionTurn(token: string | undefined, requestId: string, target: RuntimeGrant,
    input: { sessionId: string; text: string; commandId: string; expectedVersion: string }, cancellation: AbortSignal): Promise<boolean> {
    const wire = prepareHarnessTurnSubmission(input.sessionId, input.text, input.commandId, input.expectedVersion)
    const before = await this.sessionTurnState(token, requestId, input.sessionId, cancellation, wire.selection, true, target)
    if (!before.state.accepted && before.state.version !== input.expectedVersion) throw new EnterpriseError(409, 'session-version-conflict', '会话已变化，请回读当前版本')
    const seal = this.options.sealInteractiveOrigin
    if (!seal) throw new EnterpriseError(503, 'interactive-origin-unavailable', '消息登录来源校验尚未就绪', true)
    const first = before.grant
    const sealSignal = AbortSignal.any([cancellation, AbortSignal.timeout(Math.min(4000, first.validForMs))])
    const source = await new Promise<string>((resolve, reject) => {
      const abort = () => reject(upstreamFailure())
      sealSignal.addEventListener('abort', abort, { once: true })
      Promise.resolve().then(() => {
        sealSignal.throwIfAborted()
        return seal(token, requestId, { tenantId: first.tenantId, userId: first.userId, role: first.role,
          cellId: first.cellId, nativeSessionId: input.sessionId }, wire.correlation)
      }).then(value => { if (sealSignal.aborted) reject(upstreamFailure()); else resolve(value) }, reject)
        .finally(() => sealSignal.removeEventListener('abort', abort))
    })
    const body = wire.body(source)
    const grant = await this.authorize(token, requestId, first, { method: 'POST', target: wire.path, contentType: 'application/json', body: Buffer.from(body) }, async () => {
      const preset = await this.sourceSessionPreset(first, input.sessionId, 'write')
      if (preset !== before.state.presetId || !preset || !(await this.eligiblePresets(token, requestId, first, [preset])).includes(preset)) {
        throw new EnterpriseError(403, 'preset-not-eligible', '当前智能体资格已变化，不能提交轮次')
      }
    })
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, cancellation, AbortSignal.timeout(10000)])
    const stop = this.watch(token, grant, () => controller.abort())
    try {
      const transport = selectCellTransport(this.transports, grant)
      if (!transport) throw upstreamFailure()
      const destination = new URL(transport.nativeOrigin)
      const accepted = await new Promise<boolean>((resolve, reject) => {
        const outbound = httpRequest({ hostname: destination.hostname, port: destination.port, method: 'POST', path: wire.path,
          agent: transport, signal, headers: { host: destination.host, origin: destination.origin, 'content-type': 'application/json',
            'content-length': Buffer.byteLength(body), 'accept-encoding': 'identity' } }, async received => {
          try {
            if (received.statusCode !== 200 || received.headers['content-type']?.split(';')[0]?.trim() !== 'application/json'
              || received.headers['content-encoding'] && received.headers['content-encoding'] !== 'identity') throw upstreamFailure()
            const chunks: Buffer[] = []; let size = 0
            for await (const bytes of received) { size += bytes.length; signal.throwIfAborted(); if (size > 256 * 1024) throw upstreamFailure(); chunks.push(Buffer.from(bytes)) }
            resolve(wire.verify(Buffer.concat(chunks).toString('utf8'), source))
          } catch { received.destroy(); outbound.destroy(); reject(upstreamFailure()) }
        })
        outbound.once('error', () => reject(upstreamFailure())); outbound.setTimeout(8000, () => outbound.destroy(upstreamFailure()))
        outbound.end(body)
      })
      const latest = await this.admit(token, requestId)
      signal.throwIfAborted(); if (!sameGrant(grant, latest)) throw upstreamFailure()
      return accepted
    } finally { stop() }
  }

  /** Same managed native directory owner as the original sidebar. Metadata
   * only, never a second file index, content reader or filesystem authority. */
  async readSessionFiles(token: string | undefined, requestId: string, sessionId: string, path: string | undefined,
    cancellation: AbortSignal): Promise<ReturnType<typeof projectPaimindSidebarTree>['value']> {
    const operation = { method: 'POST', target: '/sidebar/api/fs.tree', contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ sessionId, ...(path === undefined ? {} : { path }) })) }
    let directory: ReturnType<typeof parsePaimindSidebarTreeRequest>
    try { directory = parsePaimindSidebarTreeRequest(operation.method, operation.target, operation.contentType, operation.body) }
    catch { throw new EnterpriseError(400, 'invalid-session-selection', '会话目录读取参数无效') }
    if (!directory) throw new EnterpriseError(400, 'invalid-session-selection', '会话目录读取参数无效')
    if (this.closed || this.active.size + this.pending >= 128) throw new EnterpriseError(503, 'gateway-busy', '运行连接已达上限', true)
    const controller = new AbortController(), abort = () => controller.abort()
    const signal = AbortSignal.any([controller.signal, cancellation])
    const deadline = setTimeout(abort, 15_000); deadline.unref()
    this.active.add(abort)
    let stop = () => {}
    try {
      signal.throwIfAborted()
      const first = await this.admit(token, requestId)
      signal.throwIfAborted()
      stop = this.watch(token, first, abort)
      let projected: ReturnType<typeof projectPaimindSidebarTree> | undefined
      await this.authorize(token, requestId, first, operation, async () => {
        signal.throwIfAborted()
        const transport = selectCellTransport(this.transports, first)
        if (!transport || first.transport !== 'private-cell') throw new EnterpriseError(503, 'directory-reader-unavailable', '受管文件树读取尚未就绪', true)
        let view: unknown
        try { view = await transport.requestControl('session.directory', directory!, signal, Math.min(4000, first.validForMs)) }
        catch (error) {
          if (error instanceof CellControlRejected) throw new EnterpriseError(403, 'native-directory-denied', '当前账户无法读取此会话目录；符号链接不能作为目录入口')
          throw upstreamFailure()
        }
        signal.throwIfAborted()
        try { projected = projectPaimindSidebarTree(view) } catch { throw upstreamFailure() }
        if (path !== undefined && projected.value.path !== path) throw upstreamFailure()
      })
      // authorize() verifies the exact binding again after resource/audit IO.
      // The native owner separately rechecks the original Session cwd, including
      // cold history, without activating an Agent or granting execution.
      signal.throwIfAborted()
      if (!projected) throw upstreamFailure()
      return projected.value
    } catch (error) { throw error instanceof EnterpriseError ? error : upstreamFailure() }
    finally { clearTimeout(deadline); stop(); this.active.delete(abort) }
  }

  /** Original sidebar preview, assembled only from same-version authorized
   * chunks. No result or partial content is released after a failed gate. */
  async readSessionFilePreview(token: string | undefined, requestId: string, sessionId: string, path: string,
    cancellation: AbortSignal): Promise<ReturnType<typeof projectPaimindSidebarFile>> {
    const operation = { method: 'POST', target: '/sidebar/api/fs.read', contentType: 'application/json', body: Buffer.from(JSON.stringify({ sessionId, path })) }
    try { if (!parsePaimindSidebarFileRequest(operation.method, operation.target, operation.contentType, operation.body)) throw Error() }
    catch { throw new EnterpriseError(400, 'invalid-session-selection', '会话文件读取参数无效') }
    if (this.closed || this.active.size + this.pending >= 128) throw new EnterpriseError(503, 'gateway-busy', '运行连接已达上限', true)
    const controller = new AbortController(), abort = () => controller.abort(), signal = AbortSignal.any([controller.signal, cancellation])
    const deadline = setTimeout(abort, 15_000); deadline.unref(); this.active.add(abort)
    let stop = () => {}
    try {
      signal.throwIfAborted()
      const grant = await this.admit(token, requestId)
      stop = this.watch(token, grant, abort)
      const transport = selectCellTransport(this.transports, grant)
      if (!transport || grant.transport !== 'private-cell') throw new EnterpriseError(503, 'file-reader-unavailable', '受管文件读取尚未就绪', true)
      let first: NativeFileChunk | undefined, offset = 0
      const chunks: Buffer[] = []
      do {
        let chunk: NativeFileChunk | undefined
        await this.authorize(token, requestId, grant, operation, async () => {
          signal.throwIfAborted()
          let value: unknown
          try { value = await transport.requestControl('session.file', { sessionId, path, offset,
            ...(first ? { version: first.version } : {}) }, signal, Math.min(4000, grant.validForMs)) }
          catch (error) {
            if (error instanceof CellControlRejected) throw new EnterpriseError(403, 'native-file-denied', '文件不存在、已变化或当前账户无法读取，请刷新后重试')
            throw upstreamFailure()
          }
          signal.throwIfAborted()
          try { validateNativeFileChunk(value) } catch { throw upstreamFailure() }
          if (value.offset !== offset || first && (value.version !== first.version || value.path !== first.path || value.size !== first.size)
            || path.startsWith('/') && value.path !== path) throw upstreamFailure()
          chunk = value
        })
        signal.throwIfAborted()
        if (!chunk) throw upstreamFailure()
        first ??= chunk
        const bytes = Buffer.from(chunk.data, 'base64'); chunks.push(bytes); offset += bytes.length
        if (chunk.nextOffset === null) break
      } while (offset < 524288)
      if (!first) throw upstreamFailure()
      return projectPaimindSidebarFile(Buffer.concat(chunks), first.size)
    } catch (error) { throw error instanceof EnterpriseError ? error : upstreamFailure() }
    finally { clearTimeout(deadline); stop(); this.active.delete(abort) }
  }

  /** Stream the original file resource with native-sized bounded chunks.
   * Already released bytes were authorized; a later failure destroys the
   * response, so its exact Content-Length cannot certify a truncated success. */
  private async serveSessionFile(token: string | undefined, requestId: string, operation: NativeOperationRequest,
    selected: NonNullable<ReturnType<typeof parsePaimindSidebarFileResource>>, response: ServerResponse): Promise<void> {
    if (this.closed || this.active.size + this.pending >= 128) throw new EnterpriseError(503, 'gateway-busy', '运行连接已达上限', true)
    const controller = new AbortController(), signal = controller.signal, abort = () => controller.abort()
    const deadline = setTimeout(abort, 120_000); deadline.unref()
    this.active.add(abort); response.once('close', abort)
    let stop = () => {}
    try {
      if (response.destroyed) abort()
      signal.throwIfAborted()
      const grant = await this.admit(token, requestId)
      stop = this.watch(token, grant, abort)
      const transport = selectCellTransport(this.transports, grant)
      if (!transport || grant.transport !== 'private-cell') throw new EnterpriseError(503, 'file-reader-unavailable', '受管文件读取尚未就绪', true)
      let first: NativeFileChunk | undefined, offset = 0
      do {
        let chunk: NativeFileChunk | undefined
        await this.authorize(token, requestId, grant, operation, async () => {
          signal.throwIfAborted()
          let value: unknown
          try { value = await transport.requestControl('session.file', { sessionId: selected.sessionId, path: selected.path, offset,
            ...(first ? { version: first.version } : {}) }, signal, Math.min(4000, grant.validForMs)) }
          catch (error) {
            if (error instanceof CellControlRejected) throw new EnterpriseError(403, 'native-file-denied', '文件不存在、已变化或当前账户无法读取')
            throw upstreamFailure()
          }
          signal.throwIfAborted()
          try { validateNativeFileChunk(value) } catch { throw upstreamFailure() }
          if (value.offset !== offset || first && (value.version !== first.version || value.path !== first.path || value.size !== first.size)
            || selected.path.startsWith('/') && value.path !== selected.path) throw upstreamFailure()
          if (value.size > selected.maximumBytes) throw new EnterpriseError(413, 'file-too-large', '文件超过原侧栏20 MiB读取上限，未下载或截断')
          chunk = value
        })
        signal.throwIfAborted()
        if (!chunk || response.destroyed) throw upstreamFailure()
        if (!first) {
          first = chunk
          const filename = encodeURIComponent(chunk.path.split('/').at(-1)!).replace(/['()*]/g, value => '%' + value.charCodeAt(0).toString(16).toUpperCase())
          response.writeHead(200, { 'content-type': selected.contentType, 'content-length': String(first.size), 'cache-control': 'no-store',
            'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'x-request-id': requestId,
            'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; sandbox",
            ...(selected.download ? { 'content-disposition': `attachment; filename*=UTF-8''${filename}` } : {}) })
        }
        const bytes = Buffer.from(chunk.data, 'base64'); offset += bytes.length
        if (bytes.length && !response.write(bytes)) await once(response, 'drain', { signal })
        if (chunk.nextOffset === null) break
      } while (offset < first!.size)
      signal.throwIfAborted()
      if (!first || offset !== first.size) throw upstreamFailure()
      response.end()
    } catch (error) {
      if (response.headersSent || response.destroyed) response.destroy()
      else throw error instanceof EnterpriseError ? error : upstreamFailure()
    } finally { clearTimeout(deadline); stop(); response.off('close', abort); this.active.delete(abort) }
  }

  /** Versioned owner-only projection; no session registry or history copy. */
  /** Read one current member's original artifact cut. Authorization is checked
   * around every owner read; there is no enterprise artifact table/cache. */
  async readSessionArtifacts(token: string | undefined, requestId: string, sessionId: string, cancellation: AbortSignal) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(sessionId)) throw new EnterpriseError(400, 'invalid-session-selection', '会话编号无效')
    if (this.closed || this.active.size + this.pending >= 128) throw new EnterpriseError(503, 'gateway-busy', '运行连接已达上限', true)
    const controller = new AbortController(), abort = () => controller.abort(), signal = controller.signal
    cancellation.addEventListener('abort', abort, { once: true }); this.active.add(abort)
    const deadline = setTimeout(abort, 15_000); deadline.unref()
    let stop = () => {}
    try {
      if (cancellation.aborted) abort()
      if (signal.aborted) throw upstreamFailure()
      const first = await this.admit(token, requestId)
      stop = this.watch(token, first, abort)
      const read = async <T>(wire: { path: string; body: string; decode(text: string): T }): Promise<T> => {
        if (signal.aborted) throw upstreamFailure()
        const grant = await this.authorize(token, requestId, first, { method: 'POST', target: wire.path,
          contentType: 'application/json', body: Buffer.from(wire.body) }, () => this.assertOwnedSession(first, sessionId, signal))
        if (signal.aborted) throw upstreamFailure()
        const transport = selectCellTransport(this.transports, grant)
        const target = transport ? new URL(transport.nativeOrigin) : developmentCellOrigin(grant.origin, this.origin.origin)
        const value = await new Promise<T>((resolve, reject) => {
          let settled = false, incoming: IncomingMessage | undefined
          let timer: ReturnType<typeof setTimeout> | undefined
          const abandon = () => finish(upstreamFailure())
          const finish = (error?: Error, result?: T) => {
            if (settled) return
            settled = true; clearTimeout(timer); signal.removeEventListener('abort', abandon)
            if (error) { incoming?.destroy(); outbound.destroy(); reject(error) } else resolve(result!)
          }
          const outbound = httpRequest({ hostname: target.hostname, port: target.port, method: 'POST', path: wire.path,
            agent: transport ?? false, headers: { host: target.host, origin: target.origin, connection: 'close',
              'content-type': 'application/json', 'content-length': String(Buffer.byteLength(wire.body)), 'accept-encoding': 'identity' } }, received => {
            incoming = received
            if (received.statusCode !== 200 || received.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
              || received.headers['content-encoding'] && received.headers['content-encoding'] !== 'identity') { finish(upstreamFailure()); return }
            let size = 0
            const chunks: Buffer[] = []
            received.on('data', (chunk: Buffer) => {
              size += chunk.length
              if (size > 2 * 1024 * 1024) { finish(upstreamFailure()); return }
              if (!settled) chunks.push(chunk)
            })
            received.once('error', () => finish(upstreamFailure()))
            received.once('end', () => {
              if (settled) return
              try { finish(undefined, wire.decode(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))) }
              catch { finish(upstreamFailure()) }
            })
          })
          outbound.once('error', () => finish(upstreamFailure()))
          signal.addEventListener('abort', abandon, { once: true })
          timer = setTimeout(abandon, Math.min(8000, grant.validForMs)); timer.unref()
          if (signal.aborted) abandon(); else outbound.end(wire.body)
        })
        const latest = await this.admit(token, requestId)
        if (signal.aborted || !sameGrant(first, latest)) throw upstreamFailure()
        return value
      }
      const workspace = await read(prepareHarnessSessionArtifactWorkspaceRead(sessionId, randomUUID()))
      const facts = await read(prepareHarnessSessionProducedRead(sessionId, 'paimind.artifacts', randomUUID()))
      const currentWorkspace = await read(prepareHarnessSessionArtifactWorkspaceRead(sessionId, randomUUID()))
      if (workspace.workspaceId !== currentWorkspace.workspaceId || workspace.path !== currentWorkspace.path) throw upstreamFailure()
      let artifacts: ReturnType<typeof projectSessionArtifactRead>
      try { artifacts = projectSessionArtifactRead({ sessionId, workspaceId: workspace.workspaceId, cwd: workspace.path,
        produced: facts.produced, projection: facts.projection }) } catch { throw upstreamFailure() }
      // Current authorization can change during transport/decoding. Keep the
      // final ownership and audit gate before releasing any artifact metadata.
      const wire = prepareHarnessSessionProducedRead(sessionId, 'paimind.artifacts', randomUUID())
      await this.authorize(token, requestId, first, { method: 'POST', target: wire.path, contentType: 'application/json',
        body: Buffer.from(wire.body) }, () => this.assertOwnedSession(first, sessionId, signal))
      if (signal.aborted) throw upstreamFailure()
      return Object.freeze({ kind: 'artifacts' as const, sessionId, workspaceId: workspace.workspaceId, asOfSeq: facts.asOfSeq,
        ...artifacts, fileExistence: 'not-checked' as const })
    } finally {
      stop(); clearTimeout(deadline); cancellation.removeEventListener('abort', abort); this.active.delete(abort)
    }
  }

  async readSessions(token: string | undefined, requestId: string, selection: HarnessSessionInspectionSelection,
    cancellation: AbortSignal): Promise<HarnessSessionInspectionPage> {
    const rpcId = randomUUID()
    let wire: ReturnType<typeof createHarnessSessionInspection>
    try { wire = createHarnessSessionInspection(selection, rpcId) }
    catch { throw new EnterpriseError(400, 'invalid-session-selection', '会话读取参数无效') }
    if (this.closed || this.active.size + this.pending >= 128) throw new EnterpriseError(503, 'gateway-busy', '运行连接已达上限', true)
    const controller = new AbortController(), abort = () => controller.abort()
    const signal = controller.signal
    cancellation.addEventListener('abort', abort, { once: true })
    this.active.add(abort)
    const deadline = setTimeout(abort, 15_000); deadline.unref()
    let stop = () => {}
    try {
      if (cancellation.aborted) abort()
      if (signal.aborted) throw upstreamFailure()
      const first = await this.admit(token, requestId)
      if (signal.aborted) throw upstreamFailure()
      const grant = await this.authorize(token, requestId, first, { method: 'POST', target: wire.path,
        contentType: 'application/json', body: Buffer.from(wire.body) }, async () => {
        if (signal.aborted) throw upstreamFailure()
        if (selection.kind === 'history') await this.assertOwnedSession(first, selection.sessionId, signal)
      })
      if (signal.aborted) throw upstreamFailure()
      stop = this.watch(token, grant, abort)
      const transport = selectCellTransport(this.transports, grant)
      const target = transport ? new URL(transport.nativeOrigin) : developmentCellOrigin(grant.origin, this.origin.origin)
      const page = await new Promise<HarnessSessionInspectionPage>((resolve, reject) => {
        let settled = false, incoming: IncomingMessage | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        const abandoned = () => finish(upstreamFailure())
        const finish = (error?: Error, value?: HarnessSessionInspectionPage) => {
          if (settled) return
          settled = true; clearTimeout(timer); signal.removeEventListener('abort', abandoned)
          if (error) { incoming?.destroy(); outbound.destroy(); reject(error) }
          else resolve(value!)
        }
        const outbound = httpRequest({ hostname: target.hostname, port: target.port, method: 'POST', path: wire.path,
          agent: transport ?? false, headers: { host: target.host, origin: target.origin, connection: 'close',
            'content-type': 'application/json', 'content-length': String(Buffer.byteLength(wire.body)), 'accept-encoding': 'identity' } }, received => {
          incoming = received
          if (received.statusCode !== 200 || received.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
            || received.headers['content-encoding'] && received.headers['content-encoding'] !== 'identity') { finish(upstreamFailure()); return }
          let size = 0
          const chunks: Buffer[] = []
          received.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > 2 * 1024 * 1024) { finish(upstreamFailure()); return }
            if (!settled) chunks.push(chunk)
          })
          received.once('error', () => finish(upstreamFailure()))
          received.once('end', () => {
            if (settled) return
            try { finish(undefined, decodeHarnessSessionInspection(Buffer.concat(chunks).toString('utf8'), rpcId, selection)) }
            catch { finish(upstreamFailure()) }
          })
        })
        outbound.once('error', () => finish(upstreamFailure()))
        signal.addEventListener('abort', abandoned, { once: true })
        timer = setTimeout(abandoned, Math.min(8000, grant.validForMs)); timer.unref()
        if (signal.aborted) abandoned()
        else outbound.end(wire.body)
      })
      // A successful native reply cannot release content after logout, binding
      // replacement, expired authority or a disconnected versioned caller.
      const latest = await this.admit(token, requestId)
      if (signal.aborted || !sameGrant(grant, latest)) throw upstreamFailure()
      return page
    } finally {
      stop(); clearTimeout(deadline); cancellation.removeEventListener('abort', abort); this.active.delete(abort)
    }
  }

  /** Admin source capture into caller-owned private staging, not approval,
   * installation or execution permission. No HTTP route or native RPC exposes
   * the transfer handles. Large capture must run outside the identity DB lock;
   * the eventual governance commit must independently reauthorize. */
  async exportSkillPublication(token: string | undefined, requestId: string, principal: RuntimeIdentity,
    selection: SkillPublicationSelection, sink: (bytes: Buffer, offset: number, signal: AbortSignal) => Promise<void>,
    signal: AbortSignal): Promise<Readonly<SkillPublicationExport>> {
    const selected = readSkillPublicationSelection(selection), first = await this.admit(token, requestId)
    if (first.tenantId !== principal.account.tenantId || first.userId !== principal.account.userId
      || first.role !== principal.account.role || first.role !== 'admin') {
      throw new EnterpriseError(403, 'skill-publication-source-denied', '只有当前管理员可以提交技能来源')
    }
    const endpoint = 'paimindSkillInstaller/getSkillPackage'
    const body = createHarnessServiceReadback(endpoint, { input: { skillId: selected.skillId } }, randomUUID())
    const grant = await this.authorize(token, requestId, first, { method: 'POST', target: '/api/' + endpoint,
      contentType: 'application/json', body: Buffer.from(body) })
    const transport = selectCellTransport(this.transports, grant)
    if (!transport || grant.transport !== 'private-cell') throw new EnterpriseError(503, 'skill-publication-source-unavailable', '技能发布需要受管隔离运行单元', true)
    const abort = new AbortController(), combined = AbortSignal.any([signal, abort.signal, AbortSignal.timeout(SKILL_PUBLICATION_EXPORT_TTL_MS)])
    const stop = this.watch(token, grant, () => abort.abort())
    try {
      const descriptor = await transferSkillPublication(selected, {
        begin: (input, controlSignal) => transport.requestControl('skill.export.begin', input, controlSignal),
        read: (input, controlSignal) => transport.requestControl('skill.export.read', input, controlSignal),
        release: (input, controlSignal) => transport.requestControl('skill.export.release', input, controlSignal),
      }, sink, combined)
      combined.throwIfAborted()
      if (!sameGrant(grant, await this.admit(token, requestId))) throw upstreamFailure()
      combined.throwIfAborted()
      return descriptor
    } finally { stop() }
  }

  /** Trusted governance command, invoked only after the control-plane's
   * current-assignment transaction. No public native RPC or development-cell
   * fallback; the cookie and cell key never reach the native owner. */
  async adoptSkillPublication(token: string | undefined, requestId: string, principal: RuntimeIdentity,
    input: SkillPublicationAdoptionInput, readChunk: (offset: number, signal: AbortSignal) => Promise<Buffer>,
    mode: 'adopt' | 'verify', signal: AbortSignal) {
    const selected = readSkillPublicationAdoptionInput(input), grant = await this.admit(token, requestId)
    if (grant.tenantId !== principal.account.tenantId || grant.userId !== principal.account.userId
      || grant.role !== principal.account.role || selected.tenantId !== principal.account.tenantId) {
      throw new EnterpriseError(403, 'runtime-principal-changed', '技能采用账户已变化')
    }
    const transport = selectCellTransport(this.transports, grant)
    if (!transport || grant.transport !== 'private-cell') throw new EnterpriseError(503, 'skill-adoption-unavailable', '技能采用需要受管隔离运行单元', true)
    if (mode !== 'adopt' && mode !== 'verify') throw new Error('Invalid Skill adoption mode')
    const abort = new AbortController(), stop = this.watch(token, grant, () => abort.abort())
    const combined = AbortSignal.any([signal, abort.signal, AbortSignal.timeout(SKILL_PUBLICATION_EXPORT_TTL_MS)])
    try {
      const receipt = mode === 'verify'
        ? readSkillPublicationAdoption(await transport.requestControl('skill.adopt.receipt', selected, combined))
        : await transferSkillPublicationAdoption(selected, {
          begin: (input, controlSignal) => transport.requestControl('skill.adopt.begin', input, controlSignal),
          write: (input, controlSignal) => transport.requestControl('skill.adopt.write', input, controlSignal),
          commit: (input, controlSignal) => transport.requestControl('skill.adopt.commit', input, controlSignal),
          release: (input, controlSignal) => transport.requestControl('skill.adopt.release', input, controlSignal),
        }, readChunk, combined)
      const { schema: _schema, adoptedAt: _time, ...origin } = receipt
      if (JSON.stringify(origin) !== JSON.stringify(selected) || !sameGrant(grant, await this.admit(token, requestId))) throw upstreamFailure()
      combined.throwIfAborted(); return receipt
    } finally { stop() }
  }

  async adoptAgentPublication(token: string | undefined, requestId: string, principal: RuntimeIdentity,
    input: AgentPublicationAdoptionInput, mode: 'adopt' | 'verify', skillPublications: readonly SkillPublicationAdoptionInput[] = []) {
    const selected = readAdoptionInput(input)
    if (!Array.isArray(skillPublications) || skillPublications.length > 40) throw new Error('Invalid Agent Skill dependencies')
    const required = Object.freeze(skillPublications.map(readSkillPublicationAdoptionInput))
    if (required.length !== selected.snapshot.content.dependencies.length
      || new Set(required.map(row => row.publicationId)).size !== required.length
      || new Set(required.map(row => row.name)).size !== required.length
      || required.some(row => row.tenantId !== selected.tenantId || !selected.snapshot.content.dependencies.some(
        dependency => dependency.name === row.name && dependency.digest === row.packageDigest))) {
      throw new EnterpriseError(409, 'skill-publication-required', '智能体采用缺少准确的企业技能版本')
    }
    const grant = await this.admit(token, requestId)
    if (grant.tenantId !== principal.account.tenantId || grant.userId !== principal.account.userId
      || grant.role !== principal.account.role || selected.tenantId !== principal.account.tenantId) {
      throw new EnterpriseError(403, 'runtime-principal-changed', '资源采用账户已变化')
    }
    const transport = selectCellTransport(this.transports, grant)
    if (!transport || grant.transport !== 'private-cell') throw new EnterpriseError(503, 'publication-adoption-unavailable', '原生采用需要受管隔离运行单元', true)
    if (mode !== 'adopt' && mode !== 'verify') throw new Error('Invalid adoption operation')
    const abort = new AbortController(), stop = this.watch(token, grant, () => abort.abort())
    const verifySkills = async () => {
      for (const reference of required) {
        abort.signal.throwIfAborted()
        const receipt = readSkillPublicationAdoption(await transport.requestControl('skill.adopt.receipt', reference,
          abort.signal, Math.min(4000, Math.floor(grant.validForMs))))
        const { schema: _schema, adoptedAt: _time, ...actual } = receipt
        if (JSON.stringify(actual) !== JSON.stringify(reference)) throw upstreamFailure()
      }
    }
    try {
      await verifySkills()
      const value = mode === 'adopt'
        ? await transport.requestControl('publication.adopt', selected, abort.signal, Math.min(4000, Math.floor(grant.validForMs)))
        : await transport.requestControl('publication.receipt', { presetId: adoptedPresetId(selected.publicationId) }, abort.signal, Math.min(4000, Math.floor(grant.validForMs)))
      const receipt = readAdoptionReceipt(value)
      await verifySkills()
      if (receipt.tenantId !== selected.tenantId || receipt.publicationId !== selected.publicationId
        || receipt.sourceUserId !== selected.sourceUserId || receipt.snapshot.digest !== selected.snapshot.digest
        || abort.signal.aborted || !sameGrant(grant, await this.admit(token, requestId))) throw upstreamFailure()
      return receipt
    } catch (error) {
      if (error instanceof CellControlRejected) throw new EnterpriseError(409, 'publication-adoption-rejected', '原生采用被拒绝；原资源已保留，请刷新并检查准确版本')
      // The native owner may have completed an atomic write before a transport
      // or DB failure. Never report that no files changed or attempt rollback.
      throw new EnterpriseError(503, 'publication-adoption-unconfirmed', '采用结果尚未确认；保留原资源，请使用同一请求重试', true)
    } finally { stop() }
  }

  /** An internal owner read, never a caller-selected origin or browser content
   * upload. All native cookies and transport secrets remain out of its payload. */
  async readAgentPublication(token: string | undefined, requestId: string, principal: RuntimeIdentity,
    selection: PublicationSelection): Promise<Readonly<AgentPublicationSnapshot>> {
    const first = await this.admit(token, requestId)
    if (first.tenantId !== principal.account.tenantId || first.userId !== principal.account.userId || first.role !== principal.account.role) {
      throw new EnterpriseError(403, 'runtime-principal-changed', '资源来源账户已变化')
    }
    const rpcId = randomUUID(), endpoint = 'paimindAgentProfiles/getPublicationSnapshot'
    // Structural TypeScript compatibility does not remove extra caller fields.
    // Only the native owner's exact selection belongs on this wire boundary.
    const body = createHarnessServiceReadback(endpoint, { input: { presetId: selection.presetId, expectedVersion: selection.expectedVersion } }, rpcId)
    const grant = await this.authorize(token, requestId, first, { method: 'POST', target: '/api/' + endpoint,
      contentType: 'application/json', body: Buffer.from(body) })
    const selected = developmentCellOrigin(grant.origin, this.origin.origin)
    const transport = selectCellTransport(this.transports, grant)
    if (transport) {
      const abort = new AbortController()
      const stop = this.watch(token, grant, () => abort.abort())
      try {
        const input = { presetId: selection.presetId, expectedVersion: selection.expectedVersion }
        const value = readAgentPublicationSnapshot(await transport.requestControl('publication.snapshot', input, abort.signal, Math.min(4000, Math.floor(grant.validForMs))))
        if (value.content.presetId !== input.presetId || value.content.configVersion !== input.expectedVersion
          || abort.signal.aborted || !sameGrant(grant, await this.admit(token, requestId))) throw upstreamFailure()
        return value
      } catch (error) {
        if (error instanceof CellControlRejected) throw new EnterpriseError(409, 'publication-source-unavailable', '无法读取选定的已保存版本，请刷新并检查来源')
        throw upstreamFailure()
      } finally { stop() }
    }
    const target = selected
    const snapshot = await new Promise<Readonly<AgentPublicationSnapshot>>((resolve, reject) => {
      let settled = false, stop = () => {}
      let incoming: IncomingMessage | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (error?: Error, value?: Readonly<AgentPublicationSnapshot>) => {
        if (settled) return
        settled = true; clearTimeout(timer); stop()
        if (error) { incoming?.destroy(); outbound.destroy(); reject(error) }
        else resolve(value!)
      }
      const outbound = httpRequest({ hostname: target.hostname, port: target.port, method: 'POST', path: '/api/' + endpoint,
        agent: transport ?? false, headers: { host: target.host, origin: target.origin, connection: 'close',
          'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), 'accept-encoding': 'identity' } }, received => {
        incoming = received
        if (received.statusCode !== 200 || received.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
          || received.headers['content-encoding'] && received.headers['content-encoding'] !== 'identity') { finish(upstreamFailure()); return }
        const chunks: Buffer[] = []; let size = 0
        received.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 131072) { finish(upstreamFailure()); return }
          if (!settled) chunks.push(chunk)
        })
        received.once('error', () => finish(upstreamFailure()))
        received.once('end', () => {
          if (settled) return
          try {
            const result = decodeHarnessServiceReadback(Buffer.concat(chunks).toString('utf8'), rpcId)
            if (!result.ok) { finish(new EnterpriseError(409, 'publication-source-unavailable', '无法读取选定的已保存版本，请刷新并检查来源')); return }
            const value = readAgentPublicationSnapshot(result.value)
            if (value.content.presetId !== selection.presetId || value.content.configVersion !== selection.expectedVersion) throw new Error('Source mismatch')
            finish(undefined, value)
          } catch { finish(upstreamFailure()) }
        })
      })
      outbound.once('error', () => finish(upstreamFailure()))
      timer = setTimeout(() => finish(upstreamFailure()), Math.min(4000, grant.validForMs)); timer.unref()
      stop = this.watch(token, grant, () => finish(upstreamFailure()))
      outbound.end(body)
    })
    const current = await this.admit(token, requestId)
    if (!sameGrant(grant, current)) throw upstreamFailure()
    return snapshot
  }

  /** Serial checks, hard deadline while an authorization provider is stalled,
   * and an independent expiry timer. Never allow the last good check forever. */
  private watch(token: string | undefined, grant: RuntimeGrant, terminate: () => void): () => void {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    let expiry: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      if (stopped) return
      stopped = true; clearTimeout(timer); clearTimeout(deadline); clearTimeout(expiry); this.active.delete(terminate)
    }
    const fail = () => { stop(); terminate() }
    const armExpiry = (ms: number) => { clearTimeout(expiry); expiry = setTimeout(fail, Math.min(ms, 86_400_000)); expiry.unref() }
    const tick = async () => {
      if (stopped) return
      deadline = setTimeout(fail, this.interval); deadline.unref()
      const started = performance.now()
      try {
        const current = await this.options.resolve(token, randomUUID())
        if (stopped) return
        const validForMs = Math.floor(current.validForMs - (performance.now() - started))
        if (!sameGrant(grant, current) || validForMs <= 0) { fail(); return }
        armExpiry(validForMs)
      } catch { fail() } finally {
        clearTimeout(deadline)
        if (!stopped) { timer = setTimeout(() => { void tick() }, this.interval); timer.unref() }
      }
    }
    this.active.add(terminate); armExpiry(grant.validForMs)
    timer = setTimeout(() => { void tick() }, this.interval); timer.unref()
    return stop
  }

  async http(request: IncomingMessage, response: ServerResponse, requestId: string): Promise<void> {
    validateRequest(request, this.origin)
    const token = sessionToken(request)
    // Authenticate before spending memory on a body, then re-read admission
    // after buffering so a revoked session cannot finish a delayed upload.
    await this.admit(token, requestId)
    if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method ?? '')) {
      throw new EnterpriseError(405, 'method-not-allowed', '此请求方法不可用')
    }
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > 8 * 1024 * 1024) throw new EnterpriseError(413, 'body-too-large', '当前运行请求内容过大')
      chunks.push(Buffer.from(chunk))
    }
    if (['GET', 'HEAD'].includes(request.method ?? '') && size !== 0) throw new EnterpriseError(400, 'unexpected-body', '此请求不接受正文')
    let body = Buffer.concat(chunks)
    const operation: NativeOperationRequest = { method: request.method ?? '', target: request.url ?? '',
      contentType: header(request, 'content-type'), body }
    let grant = await this.authorize(token, requestId, await this.admit(token, requestId), operation)
    const resource = parsePaimindSidebarFileResource(operation.method, operation.target)
    if (resource) { await this.serveSessionFile(token, requestId, operation, resource, response); return }
    const file = parsePaimindSidebarFileRequest(operation.method, operation.target, operation.contentType, body)
    if (file) {
      const controller = new AbortController(), disconnect = () => controller.abort()
      response.once('close', disconnect)
      if (response.destroyed) disconnect()
      try {
        const projected = await this.readSessionFilePreview(token, requestId, file.sessionId, file.path, controller.signal)
        if (response.destroyed) throw upstreamFailure()
        const payload = JSON.stringify(projected)
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
          'content-length': String(Buffer.byteLength(payload)), 'x-request-id': requestId })
        response.end(payload)
      } finally { response.off('close', disconnect) }
      return
    }
    const directory = parsePaimindSidebarTreeRequest(operation.method, operation.target, operation.contentType, body)
    if (directory) {
      const controller = new AbortController(), disconnected = () => controller.abort()
      response.once('close', disconnected)
      if (response.destroyed) disconnected()
      let value: Awaited<ReturnType<NativeGateway['readSessionFiles']>>
      try { value = await this.readSessionFiles(token, requestId, directory.sessionId, directory.path, controller.signal) }
      finally { response.off('close', disconnected) }
      if (response.destroyed) throw upstreamFailure()
      const payload = JSON.stringify({ ok: true, value })
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        'content-length': String(Buffer.byteLength(payload)), 'x-request-id': requestId })
      response.end(payload)
      return
    }
    let interactive, sessionMutation
    let approval: ReturnType<typeof prepareHarnessApprovalResponse>
    let memberSettings: ReturnType<typeof prepareHarnessMemberSettingsRead>
    let sidebarPresentation: ReturnType<typeof preparePaimindSidebarPresentationRead>
    let commandList: ReturnType<typeof prepareHarnessCommandListRequest>
    let exportCommand: ReturnType<typeof prepareHarnessExportCommandRequest>
    let agentPreset: ReturnType<typeof prepareHarnessAgentPresetRequest>
    try {
      exportCommand = prepareHarnessExportCommandRequest(operation.method, operation.target, operation.contentType, body)
      interactive = exportCommand ?? prepareHarnessInteractiveRequest(request.method ?? '', request.url ?? '', header(request, 'content-type'), body)
      agentPreset = prepareHarnessAgentPresetRequest(request.method ?? '', request.url ?? '', header(request, 'content-type'), body)
      sessionMutation = readHarnessSessionMutationRequest(request.method ?? '', request.url ?? '', header(request, 'content-type'), body)
      approval = prepareHarnessApprovalResponse(operation.method, operation.target, operation.contentType, body)
      commandList = prepareHarnessCommandListRequest(operation.method, operation.target, operation.contentType, body)
      if (grant.role === 'member') memberSettings = prepareHarnessMemberSettingsRead(operation.method, operation.target, operation.contentType, body)
      if (grant.role === 'member') sidebarPresentation = preparePaimindSidebarPresentationRead(operation.method, operation.target, operation.contentType, body)
    }
    catch { throw new EnterpriseError(400, 'invalid-native-operation', '原生消息请求格式无效') }
    if (exportCommand && grant.transport !== 'private-cell') {
      throw new EnterpriseError(503, 'command-origin-unavailable', '导出命令需要已就绪的受管运行单元', true)
    }
    let commandPreset: string | undefined
    const verifyCommandPreset = async (selected: RuntimeGrant): Promise<void> => {
      if (!commandList) throw upstreamFailure()
      // Preserve the explicit non-enterprise administrator development carrier.
      // Real enterprise members/admins use the private cell and original owner.
      if (selected.transport !== 'private-cell') {
        if (selected.role === 'member') throw new EnterpriseError(503, 'command-source-inspection-unavailable', '命令目录需要受管运行单元', true)
        return
      }
      const preset = await this.sourceSessionPreset(selected, commandList.sessionId, 'commands')
      if (!preset || !(await this.eligiblePresets(token, requestId, selected, [preset])).includes(preset)) {
        throw new EnterpriseError(403, 'preset-not-eligible', '此智能体已撤回或当前未分配，历史仍可查看，但命令不可用')
      }
      if (commandPreset !== undefined && commandPreset !== preset
        || await this.sourceSessionPreset(selected, commandList.sessionId, 'commands') !== preset) {
        throw new EnterpriseError(409, 'session-preset-changed', '会话智能体已变化，请重新读取命令目录')
      }
      commandPreset = preset
    }
    if (commandList) {
      const selected = grant
      grant = await this.authorize(token, requestId, selected, operation, () => verifyCommandPreset(selected))
    }
    let scopedPresetId = agentPreset?.presetId
    if (agentPreset) {
      const selectedGrant = grant, selectedRequest = agentPreset
      // Known-id and source checks are part of the original audited resource
      // authorization, not an unaudited rejection after role authorization.
      grant = await this.authorize(token, requestId, selectedGrant, operation, async () => {
        if (!this.options.agentPresetEligibility) throw new EnterpriseError(503, 'preset-eligibility-unavailable', '智能体当前分配校验尚未就绪', true)
        if (selectedRequest.kind === 'create' && selectedRequest.presetId === undefined && selectedGrant.transport === 'private-cell') {
          const transport = selectCellTransport(this.transports, selectedGrant)
          if (!transport) throw upstreamFailure()
          const sessionId = selectedRequest.createSessionId
          let reference: unknown
          try {
            reference = await transport.requestControl('session.creation', sessionId === undefined ? {} : { sessionId }, undefined, Math.min(4000, selectedGrant.validForMs))
            validateNativeSessionCreationReference(reference, sessionId)
          } catch { throw new EnterpriseError(503, 'session-creation-inspection-unavailable', '无法确认原生会话创建或恢复状态，请稍后重试', true) }
          if (reference.kind === 'new') {
            if (reference.agentPreset === null) throw upstreamFailure()
            scopedPresetId = reference.agentPreset
            // Pin only the original owner's resolved default. Subsequent native
            // default changes cannot borrow a previously checked eligibility;
            // concurrent occupied IDs still go through native conflict checks.
            body = Buffer.from(selectedRequest.pinCreationPreset(scopedPresetId))
            agentPreset = prepareHarnessAgentPresetRequest(operation.method, operation.target, operation.contentType, body)
            if (!agentPreset || agentPreset.presetId !== scopedPresetId) throw upstreamFailure()
          }
          // An existing no-selection request remains byte-identical. Its
          // original historical composition is not a new execution grant.
        }
        if (selectedRequest.forkSourceSessionId !== undefined) scopedPresetId = await this.sourceSessionPreset(selectedGrant, selectedRequest.forkSourceSessionId, 'fork')
        if (scopedPresetId !== undefined && !(await this.eligiblePresets(token, requestId, selectedGrant, [scopedPresetId])).includes(scopedPresetId)) {
          throw new EnterpriseError(403, 'preset-not-eligible', '此智能体已撤回或当前未分配，请重新选择')
        }
      })
    }
    if (approval) {
      const selected = grant, command = approval
      const transport = selectCellTransport(this.transports, selected), seal = this.options.sealInteractiveOrigin
      if (!transport || selected.transport !== 'private-cell' || !seal) {
        throw new EnterpriseError(503, 'approval-origin-unavailable', '审批需要已就绪的受管运行单元和当前登录验证', true)
      }
      const signal = AbortSignal.timeout(Math.min(4000, selected.validForMs))
      grant = await this.authorize(token, requestId, selected, operation, async () => {
        await this.assertOwnedSession(selected, command.sessionId, signal)
        const state = await this.readApproval(transport, command.sessionId, command.approvalId, signal)
        if (!state.answerable || state.rpcId !== command.rpcId) throw new EnterpriseError(409, 'approval-not-pending', '此审批已结束或当前不能答复，请重新读取')
        const preset = await this.sourceSessionPreset(selected, command.sessionId, 'write')
        if (command.outcome === 'allowed-once' && (!preset || !(await this.eligiblePresets(token, requestId, selected, [preset])).includes(preset))) {
          throw new EnterpriseError(403, 'preset-not-eligible', '此智能体当前不可执行，不能批准；仍可拒绝原请求')
        }
        const proof = await seal(token, requestId, { tenantId: selected.tenantId, userId: selected.userId, role: selected.role,
          cellId: selected.cellId, nativeSessionId: command.sessionId }, command.correlation(state.version))
        const current = await this.readApproval(transport, command.sessionId, command.approvalId, signal)
        signal.throwIfAborted()
        if (current.version !== state.version || !current.answerable || current.rpcId !== command.rpcId
          || await this.sourceSessionPreset(selected, command.sessionId, 'write') !== preset) {
          throw new EnterpriseError(409, 'approval-state-changed', '审批或会话已变化，请重新读取')
        }
        if (command.outcome === 'allowed-once' && (!preset || !(await this.eligiblePresets(token, requestId, selected, [preset])).includes(preset))) {
          throw new EnterpriseError(403, 'preset-not-eligible', '此智能体当前不可执行，不能批准；仍可拒绝原请求')
        }
        signal.throwIfAborted()
        // The native consumer checks the signed actor again immediately before
        // resolving its original promise. Keep that original correlation ID.
        body = Buffer.from(command.stamp(proof, state.version))
      })
    }
    let source: string | undefined
    let exportPreset: string | undefined
    if (interactive) {
      const seal = this.options.sealInteractiveOrigin
      if (!seal) throw new EnterpriseError(503, 'interactive-origin-unavailable', '消息登录来源校验尚未就绪', true)
      const previous = grant, started = performance.now()
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const sealed = await Promise.race([(async () => {
          const value = await seal(token, requestId, { tenantId: previous.tenantId, userId: previous.userId,
            role: previous.role, cellId: previous.cellId, nativeSessionId: interactive.nativeSessionId }, interactive.clientRpcId)
          // Signing itself is not authorization. Recheck logout/binding changes
          // during signer IO before creating any upstream connection.
          return { value, current: await this.admit(token, requestId) }
        })(), new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(upstreamFailure()), Math.min(4000, previous.validForMs)); timeout.unref()
        })])
        const validForMs = Math.floor(Math.min(sealed.current.validForMs, previous.validForMs - (performance.now() - started)))
        if (this.closed || !sameGrant(previous, sealed.current) || validForMs <= 0) throw upstreamFailure()
        source = sealed.value; body = Buffer.from(interactive.stamp(source)); grant = { ...previous, validForMs }
      } finally { clearTimeout(timeout) }
    }
    const writeSessionId = interactive?.requiresPresetEligibility ? interactive.nativeSessionId : sessionMutation
    if (writeSessionId !== undefined && grant.transport === 'private-cell') {
      // Managed members and administrators share this gate. The development
      // administrator carrier has no private cell and remains explicitly a
      // non-enterprise path; RuntimeBindings already excludes members there.
      // The original owner, not the request or a cached binding, supplies the
      // selected preset. Reject before forwarding any message/inbox mutation.
      const sessionId = writeSessionId, selectedGrant = grant
      // Reuse the original audited resource seam. A denied metadata/policy
      // check is recorded by Identity, including audit-failure fail-closed;
      // the gateway does not maintain a second audit sink.
      grant = await this.authorize(token, requestId, selectedGrant, operation, async () => {
        const presetId = await this.sourceSessionPreset(selectedGrant, sessionId, 'write')
        if (presetId === undefined || !(await this.eligiblePresets(token, requestId, selectedGrant, [presetId])).includes(presetId)) {
          throw new EnterpriseError(403, 'preset-not-eligible', '此智能体已撤回或当前未分配，历史仍可查看，但不能修改或继续执行')
        }
        // Blank sessions can still change their original selection. Re-read
        // after policy IO and refuse a changed composition, rather than allowing
        // a new preset to borrow the previous preset's eligibility.
        if (await this.sourceSessionPreset(selectedGrant, sessionId, 'write') !== presetId) {
          throw new EnterpriseError(409, 'session-preset-changed', '会话智能体已变化，请重新读取后再提交')
        }
        if (exportCommand) exportPreset = presetId
      })
    }
    if (response.destroyed || request.aborted) return
    const selected = developmentCellOrigin(grant.origin, this.origin.origin)
    const transport = selectCellTransport(this.transports, grant)
    const target = transport ? new URL(transport.nativeOrigin) : selected
    const headers: Record<string, string> = { host: target.host, origin: target.origin, connection: 'close',
      'content-length': String(body.length), 'accept-encoding': 'identity' }
    for (const name of ['accept', 'content-type', 'range', 'if-range']) {
      const value = header(request, name); if (value !== undefined) headers[name] = value
    }
    if (exportCommand && source) Object.assign(headers, exportCommand.privateHeaders(source))
    await new Promise<void>((resolve, reject) => {
      let settled = false
      let unwatch = () => {}
      let incoming: IncomingMessage | undefined
      const outbound = httpRequest({ hostname: target.hostname, port: target.port, method: request.method,
        path: request.url, headers, agent: transport ?? false }, received => {
        incoming = received
        // Do not allow native cookies, redirects, cache policy or CSP to replace
        // the gateway's authority. Native HTML bytes themselves stay untouched.
        if (received.statusCode && received.statusCode >= 300 && received.statusCode < 400) { received.destroy(); fail('redirect'); return }
        const copyHeaders = () => {
          for (const name of RESPONSE_HEADERS) if (received.headers[name] !== undefined) response.setHeader(name, received.headers[name]!)
          response.statusCode = received.statusCode ?? 502
        }
        received.once('error', error => fail('response', error))
        if (agentPreset) {
          const selectedRequest = agentPreset
          void (async () => {
            if (received.statusCode !== 200 || received.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
              || received.headers['content-encoding'] && received.headers['content-encoding'] !== 'identity'
              || received.headers['content-disposition']) throw upstreamFailure()
            const chunks: Buffer[] = []; let length = 0
            for await (const bytes of received) {
              length += bytes.length
              if (length > 1024 * 1024) throw upstreamFailure()
              chunks.push(Buffer.from(bytes))
            }
            if (settled || response.destroyed) return
            const decoded = selectedRequest.decodeResponse(Buffer.concat(chunks))
            const ids = [...new Set([...decoded.presetIds, ...(scopedPresetId === undefined ? [] : [scopedPresetId])])]
            let eligible: readonly string[] = []
            const selectedGrant = grant
            // A withdrawal during native IO must also be attributed by the
            // same audit owner before any original content reaches the caller.
            grant = await this.authorize(token, requestId, selectedGrant, operation, async () => {
              eligible = await this.eligiblePresets(token, requestId, selectedGrant, ids)
              if (scopedPresetId !== undefined && !eligible.includes(scopedPresetId)
                || decoded.requiresSelection && decoded.presetIds.some(id => !eligible.includes(id))) {
                throw new EnterpriseError(403, 'preset-not-eligible', '此智能体已撤回或当前未分配，请重新选择')
              }
            })
            if (settled || response.destroyed) return
            const bytes = decoded.project(eligible.filter(id => decoded.presetIds.includes(id)))
            copyHeaders(); response.setHeader('Content-Length', bytes.byteLength); response.end(bytes)
          })().catch(error => { if (!settled) diagnostic('preset-response', error); finish(error instanceof EnterpriseError ? error : upstreamFailure()) })
        } else if (commandList) {
          const selectedRead = commandList
          void (async () => {
            if (received.statusCode !== 200 || received.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
              || received.headers['content-encoding'] && received.headers['content-encoding'] !== 'identity'
              || received.headers['content-disposition']) throw upstreamFailure()
            const chunks: Buffer[] = []; let length = 0
            for await (const bytes of received) {
              length += bytes.length
              if (length > 256 * 1024) throw upstreamFailure()
              chunks.push(Buffer.from(bytes))
            }
            if (settled || response.destroyed) return
            const bytes = Buffer.concat(chunks); selectedRead.assertResponse(bytes)
            const selected = grant
            grant = await this.authorize(token, requestId, selected, operation, () => verifyCommandPreset(selected))
            if (settled || response.destroyed) return
            copyHeaders(); response.setHeader('Content-Length', bytes.byteLength); response.end(bytes)
          })().catch(error => { if (!settled) diagnostic('command-list-response', error); finish(error instanceof EnterpriseError ? error : upstreamFailure()) })
        } else if (memberSettings || sidebarPresentation) {
          const selectedRead = (memberSettings ?? sidebarPresentation)!
          void (async () => {
            if (received.statusCode !== 200 || received.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
              || received.headers['content-encoding'] && received.headers['content-encoding'] !== 'identity'
              || received.headers['content-disposition']) throw upstreamFailure()
            const chunks: Buffer[] = []; let length = 0
            for await (const bytes of received) {
              length += bytes.length
              if (length > 2 * 1024 * 1024) throw upstreamFailure()
              chunks.push(Buffer.from(bytes))
            }
            if (settled || response.destroyed) return
            const projected = selectedRead.projectResponse(Buffer.concat(chunks))
            grant = await this.authorize(token, requestId, grant, operation)
            if (settled || response.destroyed) return
            copyHeaders(); response.setHeader('Content-Length', projected.byteLength); response.end(projected)
          })().catch(error => { if (!settled) diagnostic(sidebarPresentation ? 'sidebar-presentation-response' : 'member-settings-response', error); finish(error instanceof EnterpriseError ? error : upstreamFailure()) })
        } else if (approval) {
          const command = approval
          void (async () => {
            if (received.statusCode !== 200 || received.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
              || received.headers['content-encoding'] && received.headers['content-encoding'] !== 'identity'
              || received.headers['content-disposition']) throw upstreamFailure()
            const chunks: Buffer[] = []; let length = 0
            for await (const bytes of received) {
              length += bytes.length; if (length > 4096) throw upstreamFailure()
              chunks.push(Buffer.from(bytes))
            }
            const receipt = command.receipt(Buffer.concat(chunks)), current = await this.admit(token, requestId)
            if (settled || response.destroyed) return
            if (!sameGrant(grant, current)) throw upstreamFailure()
            // A carrier acknowledgement is not durable approval history or
            // tool completion. Preserve its original small receipt only.
            const bytes = Buffer.from(JSON.stringify(receipt))
            copyHeaders(); response.setHeader('Content-Length', bytes.byteLength); response.end(bytes)
          })().catch(error => fail('approval-response', error))
        } else if (interactive && source) {
          const selectedRequest = interactive, selectedSource = source
          void (async () => {
            if (received.statusCode !== 200 || received.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
              || received.headers['content-encoding'] && received.headers['content-encoding'] !== 'identity'
              || received.headers['content-disposition']) throw upstreamFailure()
            const chunks: Buffer[] = []; let length = 0
            for await (const bytes of received) {
              length += bytes.length
              if (length > 256 * 1024) throw upstreamFailure()
              chunks.push(Buffer.from(bytes))
            }
            if (settled || response.destroyed) return
            const bytes = selectedRequest.restoreResponse(Buffer.concat(chunks), selectedSource)
            const current = await this.admit(token, requestId)
            if (settled || response.destroyed) return
            if (!sameGrant(grant, current)) throw upstreamFailure()
            if (exportCommand) {
              const selected = grant
              grant = await this.authorize(token, requestId, selected, operation, async () => {
                if (!exportPreset || await this.sourceSessionPreset(selected, exportCommand.nativeSessionId, 'write') !== exportPreset
                  || !(await this.eligiblePresets(token, requestId, selected, [exportPreset])).includes(exportPreset)
                  || await this.sourceSessionPreset(selected, exportCommand.nativeSessionId, 'write') !== exportPreset) {
                  throw new EnterpriseError(403, 'preset-not-eligible', '此智能体已撤回或发生变化，导出请求未交付')
                }
              })
            }
            copyHeaders(); response.setHeader('Content-Length', bytes.byteLength); response.end(bytes)
          })().catch(error => fail('interactive-response', error))
        } else if (isHarnessDocumentRequest(request.method ?? '', request.url ?? '') && received.statusCode === 200
          && received.headers['content-type']?.split(';')[0]?.trim().toLowerCase() === 'text/html') {
          // Buffer only the small, trusted host bootstrap to compute CSP hashes.
          // All other responses remain streamed under the sandboxed base policy.
          void (async () => {
            if (received.headers['content-encoding'] && received.headers['content-encoding'] !== 'identity'
              || received.headers['content-disposition']) throw upstreamFailure()
            const document: Buffer[] = []; let length = 0
            for await (const bytes of received) {
              length += bytes.length
              if (length > 256 * 1024) throw upstreamFailure()
              document.push(Buffer.from(bytes))
            }
            if (settled || response.destroyed) return
            const original = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(document))
            const text = harnessDocumentWithAuthenticatedManifest(original)
            const bytes = Buffer.from(text)
            const policy = harnessDocumentContentPolicy(text, this.origin.origin, PAIMIND_SIDEBAR_DOWNLINK_PATHS)
            const current = await this.admit(token, requestId)
            if (settled || response.destroyed) return
            if (!sameGrant(grant, current)) throw upstreamFailure()
            copyHeaders(); response.setHeader('Content-Security-Policy', policy)
            response.setHeader('Content-Length', bytes.length); response.end(bytes)
          })().catch(error => fail('document', error))
        } else {
          // Keep the finite upstream handshake deadline. Once the exact native
          // event carrier has established SSE, its lifetime belongs to the
          // continuous identity/binding/expiry watcher, not an asset timeout.
          if (classifyHarnessReadRequest(request.method ?? '', request.url ?? '') === 'event-downlink'
            && received.statusCode === 200
            && received.headers['content-type']?.split(';')[0]?.trim().toLowerCase() === 'text/event-stream'
            && (!received.headers['content-encoding'] || received.headers['content-encoding'] === 'identity')
            && !received.headers['content-disposition']) clearTimeout(timeout)
          copyHeaders(); received.pipe(response)
        }
      })
      const finish = (failure?: Error) => {
        if (settled) return
        settled = true; unwatch(); clearTimeout(timeout)
        response.off('finish', completed); response.off('close', abandoned); request.off('aborted', abandoned)
        if (failure) { outbound.destroy(); incoming?.destroy(); reject(failure) } else resolve()
      }
      const diagnostic = (phase: string, error?: unknown) => {
        const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          && /^[A-Z0-9_]{1,50}$/.test(error.code) ? error.code : undefined
        try { this.options.onTransportFailure?.({ requestId, phase, ...(code ? { code } : {}) }) } catch { /* Not authority. */ }
      }
      const fail = (phase: string, error?: unknown) => { if (!settled) diagnostic(phase, error); finish(upstreamFailure()) }
      const completed = () => finish()
      const abandoned = () => { if (!settled) diagnostic('client-closed'); outbound.destroy(); incoming?.destroy(); finish() }
      const timeout = setTimeout(() => fail('deadline'), 60_000); timeout.unref()
      unwatch = this.watch(token, grant, () => { response.destroy(); fail('lease') })
      outbound.once('error', error => fail('request', error))
      response.once('finish', completed); response.once('close', abandoned); request.once('aborted', abandoned)
      outbound.end(body)
    })
  }

  attach(server: Server): void {
    const listener = (request: IncomingMessage, socket: Duplex, head: Buffer) => { void this.upgrade(request, socket, head) }
    server.on('upgrade', listener)
    server.once('close', () => { server.off('upgrade', listener); this.close() })
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const terminate of [...this.active]) terminate()
    this.active.clear(); this.downlinks.close()
    for (const transport of this.transports.values()) transport.destroy()
  }
  private async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    let upgraded = false
    let upstream: WebSocket | undefined
    const timeout = setTimeout(() => socket.destroy(), 10_000); timeout.unref()
    socket.on('error', () => socket.destroy())
    try {
      validateRequest(request, this.origin, true)
      const sidebar = parsePaimindSidebarDownlink(request.method ?? '', request.url ?? '')
      if ((!isHarnessDownlink(request.method ?? '', request.url ?? '') && !sidebar) || head.length !== 0
        || header(request, 'sec-websocket-protocol') !== undefined) throw new EnterpriseError(403, 'downlink-required', '此通道仅用于原生事件下行')
      const token = sessionToken(request)
      const requestId = randomUUID()
      const grant = await this.authorize(token, requestId, await this.admit(token, requestId), { method: 'GET', target: request.url!, contentType: undefined,
        body: new Uint8Array() })
      if (socket.destroyed) return
      const selected = developmentCellOrigin(grant.origin, this.origin.origin)
      const transport = selectCellTransport(this.transports, grant)
      const target = transport ? new URL(transport.nativeOrigin) : selected
      const nativeOrigin = target.origin
      const route = new URL(request.url!, nativeOrigin)
      target.protocol = 'ws:'; target.pathname = route.pathname; target.search = route.search
      const carrier = upstream = new WebSocket(target, { headers: { origin: nativeOrigin }, agent: transport, handshakeTimeout: 5_000,
        maxPayload: 16 * 1024 * 1024, perMessageDeflate: false, followRedirects: false })
      carrier.on('error', () => {})
      socket.once('close', () => carrier.terminate())
      await new Promise<void>((resolve, reject) => {
        carrier.once('open', () => { carrier.pause(); resolve() })
        carrier.once('error', reject)
        carrier.once('unexpected-response', (_request, response) => { response.destroy(); reject(upstreamFailure()) })
      })
      // A successful browser handshake must represent a real connected native
      // downlink, not merely our own acceptor. Recheck authorization after dial.
      const latest = await this.admit(token, randomUUID())
      const current = sidebar ? await this.authorize(token, randomUUID(), latest, { method: 'GET', target: request.url!,
        contentType: undefined, body: new Uint8Array() }) : latest
      if (socket.destroyed || !sameGrant(grant, current)) throw upstreamFailure()
      this.downlinks.handleUpgrade(request, socket, head, client => {
        upgraded = true; clearTimeout(timeout)
        let stopped = false
        let unwatch = () => {}
        const terminate = () => { if (stopped) return; stopped = true; unwatch(); client.terminate(); carrier.terminate() }
        unwatch = this.watch(token, current, terminate)
        client.on('message', terminate) // Control frames handled by ws; never relay application frames.
        client.on('close', terminate); client.on('error', terminate)
        carrier.on('close', terminate); carrier.on('error', terminate)
        carrier.on('message', (data, binary) => {
          if (stopped) return
          if (binary || client.readyState !== WebSocket.OPEN || client.bufferedAmount > 4 * 1024 * 1024) { terminate(); return }
          client.send(data, { binary: false }, error => { if (error) terminate() })
        })
        carrier.resume()
      })
    } catch (error) {
      if (!socket.destroyed && !upgraded) {
        const status = error instanceof EnterpriseError ? error.status : 503
        socket.end(`HTTP/1.1 ${status} Request Rejected\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n`)
      } else socket.destroy()
    } finally {
      clearTimeout(timeout)
      if (!upgraded) upstream?.terminate()
    }
  }
}
