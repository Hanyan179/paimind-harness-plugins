import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import { EnterpriseError, uuid } from './errors.js'
import type { Identity } from './identity.js'
import { COOKIE, header, sessionToken, validateRequest } from './http-boundary.js'
import type { NativeGateway } from './native-gateway.js'
import { Publications } from './publications.js'
import type { SkillPublications } from './skill-publications.js'
import type { MemberContent } from './member-content.js'
import type { ModelInspection } from './model-inspection.js'
import type { ConnectorInspection } from './connector-inspection.js'
import type { ConnectorManagement } from './connector-management.js'
import type { ModelManagement } from './model-management.js'
import type { InstructionManagement } from './instruction-management.js'
import type { FeatureManagement } from './feature-management.js'
import { RuntimeManagement } from './runtime-management.js'
import { SessionCreation } from './session-creation.js'
import { SessionTurns } from './session-turns.js'
import { SessionApprovals } from './session-approvals.js'
import { enterpriseAuthDocument, enterpriseAuthStyle, enterpriseAuthClientSource } from '@paimind/enterprise-admin/auth-boundary'
import { isHarnessDocumentRequest } from '@paimind/harness-compat/gateway-transport'

interface ServerOptions {
  identity: Identity
  publicOrigin: string
  loopbackDevelopment?: boolean
  tls?: { key: Buffer; cert: Buffer }
  nativeGateway?: NativeGateway
  skillPublications?: SkillPublications
  memberContent?: MemberContent
  modelInspection?: ModelInspection
  connectorInspection?: ConnectorInspection
  connectorManagement?: ConnectorManagement
  modelManagement?: ModelManagement
  instructionManagement?: InstructionManagement
  featureManagement?: FeatureManagement
  /** Optional operator diagnostics: no cookies, query, payload or user ids. */
  onNativeResourceResponse?: (event: { requestId: string; resource: string; status: number; complete: boolean; elapsedMs: number }) => void
}

async function body(request: IncomingMessage, limit = 16_384): Promise<unknown> {
  if (header(request, 'content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new EnterpriseError(415, 'json-required', '请求须使用 JSON 格式')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > limit) throw new EnterpriseError(413, 'body-too-large', '请求内容过大')
    chunks.push(bytes)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown } catch {
    throw new EnterpriseError(400, 'invalid-json', '请求格式无效')
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

export function createEnterpriseServer(options: ServerOptions) {
  const runtimeManagement = new RuntimeManagement(options.identity)
  const sessionCreation = options.nativeGateway ? new SessionCreation(options.identity, options.nativeGateway) : undefined
  const sessionTurns = options.nativeGateway ? new SessionTurns(options.identity, options.nativeGateway) : undefined
  const sessionApprovals = options.nativeGateway ? new SessionApprovals(options.identity, options.nativeGateway) : undefined
  const publications = new Publications(options.identity, (token, requestId, principal, selection) => {
    if (!options.nativeGateway) throw new EnterpriseError(503, 'publication-source-unavailable', '原生资源来源尚未接入', true)
    return options.nativeGateway.readAgentPublication(token, requestId, principal, selection)
  }, (token, requestId, principal, input, mode, skillPublications) => {
    if (!options.nativeGateway) throw new EnterpriseError(503, 'publication-adoption-unavailable', '原生采用尚未接入', true)
    return options.nativeGateway.adoptAgentPublication(token, requestId, principal, input, mode, skillPublications)
  })
  const origin = new URL(options.publicOrigin)
  if (origin.origin !== options.publicOrigin || origin.username || origin.password || !origin.port || origin.port === '3080') {
    throw new Error('An explicit isolated public origin is required')
  }
  const local = options.loopbackDevelopment === true && ['127.0.0.1', '[::1]'].includes(origin.hostname)
  if ((!options.tls && !(local && origin.protocol === 'http:')) || (options.tls && origin.protocol !== 'https:')) {
    throw new Error('HTTPS is required except for explicit loopback development')
  }
  const cookie = (token: string, maxAge: number) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${options.tls ? '; Secure' : ''}`
  let active = 0
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    const requestId = randomUUID()
    const resource = (request.url ?? '').split('?', 1)[0]!
    if (options.onNativeResourceResponse && request.method === 'GET'
      && /^(?:\/|\/index\.html|\/assets\/[A-Za-z0-9_.-]+|\/plugins\/(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+\/client\.js)$/.test(resource)) {
      const started = performance.now()
      let reported = false
      const report = () => {
        if (reported) return
        reported = true
        try { options.onNativeResourceResponse!({ requestId, resource, status: response.statusCode,
          complete: response.writableFinished, elapsedMs: Math.round(performance.now() - started) }) } catch { /* Diagnostics cannot grant or deny access. */ }
      }
      response.once('finish', report); response.once('close', report)
    }
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Frame-Options', 'DENY')
    // Unknown documents and user artifacts do not inherit application origin
    // privileges. The two explicit application documents override this policy.
    response.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; sandbox")
    response.setHeader('X-Request-ID', requestId)
    active += 1
    let validated = false
    try {
      if (active > 128) throw new EnterpriseError(503, 'gateway-busy', '服务繁忙，请稍后重试', true)
      const url = validateRequest(request, origin)
      validated = true
      const path = url.pathname
      const method = request.method ?? ''
      const sessionRead = method === 'GET' ? /^\/haas\/v1\/sessions\/([^/]+)$/u.exec(path) : null
      const sessionTurn = method === 'POST' ? /^\/haas\/v1\/sessions\/([^/]+)\/turns$/u.exec(path) : null
      const sessionApproval = method === 'POST' ? /^\/haas\/v1\/sessions\/([^/]+)\/approvals\/([^/]+)$/u.exec(path) : null
      const sessionEvents = method === 'GET' ? /^\/haas\/v1\/sessions\/([^/]+)\/events$/u.exec(path) : null
      const sessionFiles = method === 'GET' ? /^\/haas\/v1\/sessions\/([^/]+)\/files$/u.exec(path) : null
      const sessionArtifacts = method === 'GET' ? /^\/haas\/v1\/sessions\/([^/]+)\/artifacts$/u.exec(path) : null
      let beforeSeq: number | undefined
      let directoryPath: string | undefined
      if (url.search && path.startsWith('/haas/')) {
        if (sessionFiles) {
          const selected = url.searchParams.get('path')
          if ([...url.searchParams.keys()].length !== 1 || !selected || !selected.startsWith('/') || selected.length > 4096
            || /[\u0000-\u001f\u007f]/u.test(selected) || selected.split('/').some(part => part === '.' || part === '..')) {
            throw new EnterpriseError(400, 'unsupported-query', '此接口的目录参数无效')
          }
          directoryPath = selected
        } else {
          const cursor = url.searchParams.get('beforeSeq')
          if (!sessionRead || [...url.searchParams.keys()].length !== 1 || !cursor || !/^[1-9][0-9]{0,15}$/u.test(cursor)
            || !Number.isSafeInteger(Number(cursor))) throw new EnterpriseError(400, 'unsupported-query', '此接口的查询参数无效')
          beforeSeq = Number(cursor)
        }
      }
      if (method === 'GET' && path === '/health') {
        await options.identity.bootstrapState()
        json(response, 200, { status: 'ready', requestId }); return
      }
      if (options.nativeGateway && method === 'GET') {
        if (path === '/haas/login' || path === '/haas/recover') {
          // Recovery must remain renderable when the identity database is
          // unavailable. It contains no identity or application content.
          const recovering = path === '/haas/recover'
          const configured = recovering || (await options.identity.bootstrapState()).configured
          response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          response.end(enterpriseAuthDocument(configured, recovering ? 'recover' : 'authenticate')); return
        }
        if (path === '/haas/auth.css' || path === '/haas/auth.js') {
          const css = path.endsWith('.css')
          response.writeHead(200, { 'Content-Type': css ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' })
          response.end(css ? enterpriseAuthStyle : enterpriseAuthClientSource); return
        }
      }
      if (options.nativeGateway && !path.startsWith('/haas/') && path !== '/health') {
        await options.nativeGateway.http(request, response, requestId); return
      }
      const token = sessionToken(request)
      const skills = () => {
        if (!options.skillPublications) throw new EnterpriseError(503, 'skill-publication-unavailable', '企业技能发布尚未接入', true)
        return options.skillPublications
      }
      if (method === 'GET') {
        if (sessionArtifacts) {
          if (!options.nativeGateway) { await options.identity.me(token, requestId); throw new EnterpriseError(503, 'native-unavailable', '原生运行环境尚未接入', true) }
          let sessionId: string
          try { sessionId = decodeURIComponent(sessionArtifacts[1]!) } catch { throw new EnterpriseError(400, 'invalid-session-selection', '会话编号无效') }
          const controller = new AbortController(), disconnect = () => controller.abort()
          response.once('close', disconnect)
          if (response.destroyed) disconnect()
          try {
            const data = await options.nativeGateway.readSessionArtifacts(token, requestId, sessionId, controller.signal)
            if (!response.destroyed) json(response, 200, { data, requestId })
          } finally { response.off('close', disconnect) }
          return
        }
        if (sessionFiles) {
          if (!options.nativeGateway) { await options.identity.me(token, requestId); throw new EnterpriseError(503, 'native-unavailable', '原生运行环境尚未接入', true) }
          let sessionId: string
          try { sessionId = decodeURIComponent(sessionFiles[1]!) } catch { throw new EnterpriseError(400, 'invalid-session-selection', '会话编号无效') }
          if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(sessionId)) throw new EnterpriseError(400, 'invalid-session-selection', '会话编号无效')
          const controller = new AbortController(), disconnect = () => controller.abort()
          response.once('close', disconnect)
          if (response.destroyed) disconnect()
          try {
            const listing = await options.nativeGateway.readSessionFiles(token, requestId, sessionId, directoryPath, controller.signal)
            if (!response.destroyed) json(response, 200, { data: { kind: 'files', sessionId, ...listing }, requestId })
          } finally { response.off('close', disconnect) }
          return
        }
        if (sessionEvents) {
          if (!options.nativeGateway) { await options.identity.me(token, requestId); throw new EnterpriseError(503, 'native-unavailable', '原生运行环境尚未接入', true) }
          let sessionId: string
          try { sessionId = decodeURIComponent(sessionEvents[1]!) } catch { throw new EnterpriseError(400, 'invalid-session-selection', '会话编号无效') }
          if (!sessionId || sessionId.length > 200 || /[\u0000-\u001f\u007f/\\]/u.test(sessionId)) throw new EnterpriseError(400, 'invalid-session-selection', '会话编号无效')
          const cursor = header(request, 'last-event-id')
          const controller = new AbortController(), disconnect = () => controller.abort()
          response.once('close', disconnect)
          if (response.destroyed) disconnect()
          try { await options.nativeGateway.sessionEvents(token, requestId, sessionId, cursor, response, controller.signal) }
          finally { response.off('close', disconnect) }
          return
        }
        if (path === '/haas/v1/sessions' || sessionRead) {
          if (!options.nativeGateway) {
            await options.identity.me(token, requestId)
            throw new EnterpriseError(503, 'native-unavailable', '原生运行环境尚未接入', true)
          }
          let sessionId: string | undefined
          if (sessionRead) {
            try { sessionId = decodeURIComponent(sessionRead[1]!) } catch { throw new EnterpriseError(400, 'invalid-session-selection', '会话编号无效') }
            if (!sessionId || sessionId.length > 200 || /[\u0000-\u001f\u007f/\\]/u.test(sessionId)) {
              throw new EnterpriseError(400, 'invalid-session-selection', '会话编号无效')
            }
          }
          const controller = new AbortController()
          const disconnected = () => { if (!response.writableFinished) controller.abort() }
          response.once('close', disconnected)
          if (response.destroyed) disconnected()
          try {
            const selection = sessionId === undefined ? { kind: 'sessions' as const }
              : { kind: 'history' as const, sessionId, ...(beforeSeq === undefined ? {} : { beforeSeq }) }
            const version = sessionId === undefined ? undefined
              : await options.nativeGateway.sessionTurnState(token, requestId, sessionId, controller.signal)
            const data = await options.nativeGateway.readSessions(token, requestId, selection, controller.signal)
            const current = sessionId === undefined ? undefined
              : await options.nativeGateway.sessionTurnState(token, requestId, sessionId, controller.signal, undefined, false, version!.grant)
            if (version && current?.state.version !== version.state.version) throw new EnterpriseError(409, 'session-version-conflict', '读取期间会话已变化，请重新读取')
            if (!response.destroyed) json(response, 200, { data: version ? { ...data, version: version.state.version } : data, requestId })
          } finally { response.off('close', disconnected) }
          return
        }
        const runtimeRecovery = /^\/haas\/v1\/admin\/runtime-recovery-requests\/([^/]+)$/u.exec(path)
        if (runtimeRecovery) {
          json(response, 200, {data:await runtimeManagement.recoveryReceipt(token,runtimeRecovery[1]!,requestId),requestId});return
        }
        const connectorActivationCommand = /^\/haas\/v1\/admin\/connector-activation-commands\/([^/]+)$/u.exec(path)
        if (method === 'GET' && connectorActivationCommand) {
          if (!options.connectorManagement) throw new EnterpriseError(503, 'connector-management-unavailable', '连接器管理尚未接入', true)
          json(response, 200, { data: await options.connectorManagement.readActivation(token, connectorActivationCommand[1]!, requestId), requestId }); return
        }
        const connectorCommand = /^\/haas\/v1\/admin\/connector-commands\/([^/]+)$/u.exec(path)
        if (connectorCommand) {
          if (!options.connectorManagement) throw new EnterpriseError(503, 'connector-management-unavailable', '连接器管理尚未接入', true)
          json(response, 200, { data: await options.connectorManagement.read(token, connectorCommand[1]!, requestId), requestId }); return
        }
        const instructionCommand = /^\/haas\/v1\/admin\/instruction-commands\/([^/]+)$/u.exec(path)
        if (instructionCommand) {
          if (!options.instructionManagement) throw new EnterpriseError(503, 'instruction-management-unavailable', '成员指令管理尚未接入', true)
          json(response, 200, { data: await options.instructionManagement.read(token, instructionCommand[1]!, requestId), requestId }); return
        }
        const modelCommand = /^\/haas\/v1\/admin\/model-commands\/([^/]+)$/u.exec(path)
        if (modelCommand) {
          if (!options.modelManagement) throw new EnterpriseError(503, 'model-management-unavailable', '模型管理尚未接入', true)
          json(response, 200, { data: await options.modelManagement.read(token, modelCommand[1]!, requestId), requestId }); return
        }
        const featureCommand = /^\/haas\/v1\/admin\/feature-commands\/([^/]+)$/u.exec(path)
        if (featureCommand) {
          if (!options.featureManagement) throw new EnterpriseError(503, 'feature-management-unavailable', '功能包管理尚未接入', true)
          json(response, 200, { data: await options.featureManagement.read(token, featureCommand[1]!, requestId), requestId }); return
        }
        const skillContent = /^\/haas\/v1\/(admin\/skill-publications|catalog\/skills)\/([^/]+)\/content\/([1-9][0-9]{0,9})\/([a-f0-9]{64})\/(?:entries\/(0|[1-9][0-9]{0,4})|files\/(0|[1-9][0-9]{0,4})\/(0|[1-9][0-9]{0,8}))$/u.exec(path)
        if (skillContent) {
          const controller = new AbortController()
          const disconnected = () => { if (!response.writableFinished) controller.abort(new Error('Skill content client disconnected')) }
          response.once('close', disconnected); if (response.destroyed) disconnected()
          try {
            const selected = skillContent[5] !== undefined ? { kind: 'entries' as const, cursor: Number(skillContent[5]) }
              : { kind: 'file' as const, index: Number(skillContent[6]), offset: Number(skillContent[7]) }
            const data = await skills().content(token, skillContent[2]!, Number(skillContent[3]), `sha256:${skillContent[4]}`,
              selected, requestId, skillContent[1] === 'admin/skill-publications', controller.signal)
            json(response, 200, { data, requestId })
          } finally { response.off('close', disconnected) }
          return
        }
        if (path === '/haas/v1/admin/skill-publications') { json(response, 200, { data: await skills().list(token, requestId), requestId }); return }
        if (path === '/haas/v1/catalog/skills') { json(response, 200, { data: await skills().available(token, requestId), requestId }); return }
        const skillAssignments = /^\/haas\/v1\/admin\/skill-publications\/([^/]+)\/assignments$/u.exec(path)
        if (skillAssignments) { json(response, 200, { data: await skills().assignments(token, skillAssignments[1]!, requestId), requestId }); return }
        const skill = /^\/haas\/v1\/(admin\/skill-publications|catalog\/skills)\/([^/]+)$/u.exec(path)
        if (skill) { json(response, 200, { data: await skills().read(token, skill[2]!, requestId, skill[1] === 'admin/skill-publications'), requestId }); return }
        if (path === '/haas/v1/publications') { json(response, 200, { data: await publications.list(token, requestId, false), requestId }); return }
        if (path === '/haas/v1/admin/publications') { json(response, 200, { data: await publications.list(token, requestId, true), requestId }); return }
        if (path === '/haas/v1/catalog/agents') { json(response, 200, { data: await publications.available(token, requestId), requestId }); return }
        const assigned = /^\/haas\/v1\/catalog\/agents\/([^/]+)$/u.exec(path)
        if (assigned) { json(response, 200, { data: await publications.readAssigned(token, assigned[1]!, requestId), requestId }); return }
        const assignments = /^\/haas\/v1\/admin\/publications\/([^/]+)\/assignments$/u.exec(path)
        if (assignments) { json(response, 200, { data: await publications.assignments(token, assignments[1]!, requestId), requestId }); return }
        const publication = /^\/haas\/v1\/publications\/([^/]+)$/u.exec(path)
        if (publication) { json(response, 200, { data: await publications.read(token, publication[1]!, requestId), requestId }); return }
        if (path === '/haas/v1/bootstrap') { json(response, 200, { data: await options.identity.bootstrapState(), requestId }); return }
        if (path === '/haas/v1/auth/me') { json(response, 200, { data: await options.identity.me(token, requestId), requestId }); return }
        if (path === '/haas/v1/admin/members') { json(response, 200, { data: await options.identity.listMembers(token, requestId), requestId }); return }
        if (path === '/haas/v1/admin/groups') { json(response, 200, { data: await options.identity.listGroups(token, requestId), requestId }); return }
        if (path === '/haas/v1/admin/audit') { json(response, 200, { data: await options.identity.listAudit(token, requestId), requestId }); return }
      }
      if (method === 'POST' || method === 'PATCH') {
        const context = { key: uuid(header(request, 'idempotency-key')), requestId }
        // A complete 500-member UUID selection needs about 20 KiB. Keep this
        // larger bound exclusive to the reviewed full group edit route.
        const groupMembershipEdit = method === 'PATCH' && /^\/haas\/v1\/admin\/groups\/[a-fA-F0-9-]+$/u.test(path)
        // Full escaped JSON for 65536 UTF-16 text units stays below 400 KiB.
        // Other routes retain their existing smaller request limits.
        const input = await body(request, sessionTurn ? 409_600 : path === '/haas/v1/admin/instruction-commands' ? 65_536 : groupMembershipEdit ? 32_768 : 16_384)
        if (sessionApproval) {
          if (!sessionApprovals) {
            await options.identity.me(token, requestId)
            throw new EnterpriseError(503, 'session-approval-unavailable', '原生审批尚未接入', true)
          }
          let sessionId: string, approvalId: string
          try { sessionId = decodeURIComponent(sessionApproval[1]!); approvalId = decodeURIComponent(sessionApproval[2]!) }
          catch { throw new EnterpriseError(400, 'invalid-approval-input', '会话或审批编号无效') }
          const controller = new AbortController(), disconnected = () => { if (!response.writableFinished) controller.abort() }
          response.once('close', disconnected); if (response.destroyed) disconnected()
          try {
            const result = await sessionApprovals.decide(token, sessionId, approvalId, input, context, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]))
            if (!response.destroyed) json(response, result.data.carrierAccepted ? 200 : 202, { ...result, requestId })
          } finally { response.off('close', disconnected) }
          return
        }
        if (sessionTurn) {
          if (!sessionTurns) {
            await options.identity.me(token, requestId)
            throw new EnterpriseError(503, 'session-turn-unavailable', '原生轮次提交尚未接入', true)
          }
          let sessionId: string
          try { sessionId = decodeURIComponent(sessionTurn[1]!) } catch { throw new EnterpriseError(400, 'invalid-turn-input', '会话编号无效') }
          const controller = new AbortController()
          const disconnected = () => { if (!response.writableFinished) controller.abort() }
          response.once('close', disconnected)
          if (response.destroyed) disconnected()
          try {
            const result = await sessionTurns.submit(token, sessionId, input, context, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]))
            if (!response.destroyed) json(response, 202, { ...result, requestId })
          } finally { response.off('close', disconnected) }
          return
        }
        if (method === 'POST' && path === '/haas/v1/sessions') {
          if (!sessionCreation) {
            await options.identity.me(token, requestId)
            throw new EnterpriseError(503, 'session-creation-unavailable', '原生创建尚未接入', true)
          }
          const controller = new AbortController()
          const disconnected = () => { if (!response.writableFinished) controller.abort() }
          response.once('close', disconnected)
          if (response.destroyed) disconnected()
          try {
            const result = await sessionCreation.create(token, input, context, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]))
            if (!response.destroyed) json(response, result.data.outcome === 'created' ? 201 : 202, { ...result, requestId })
          } finally { response.off('close', disconnected) }
          return
        }
        if (method === 'POST' && path === '/haas/v1/admin/runtime-recovery-requests') {
          json(response, 202, {...await runtimeManagement.requestRecovery(token,input,context),requestId});return
        }
        if (method === 'POST' && path === '/haas/v1/admin/runtime-recovery-state') {
          json(response, 200, {data:await runtimeManagement.recoveryState(token,input,requestId),requestId});return
        }
        if (method === 'POST' && path === '/haas/v1/admin/runtime-state') {
          json(response, 200, { data: await runtimeManagement.read(token, input, requestId), requestId }); return
        }
        if (method === 'POST' && path === '/haas/v1/admin/runtime-resource-policy') {
          json(response, 200, { ...await runtimeManagement.configure(token, input, context), requestId }); return
        }
        if (method === 'POST' && path === '/haas/v1/admin/connector-command-state') {
          if (!options.connectorManagement) throw new EnterpriseError(503, 'connector-management-unavailable', '连接器管理尚未接入', true)
          json(response, 200, { data: await options.connectorManagement.state(token, input, requestId), requestId }); return
        }
        if (method === 'POST' && path === '/haas/v1/admin/connector-approval-state') {
          if (!options.connectorManagement) throw new EnterpriseError(503, 'connector-management-unavailable', '连接器管理尚未接入', true)
          json(response, 200, { data: await options.connectorManagement.approvalState(token, input, requestId), requestId }); return
        }
        if (method === 'POST' && path === '/haas/v1/admin/connector-activation-command-state') {
          if (!options.connectorManagement) throw new EnterpriseError(503, 'connector-management-unavailable', '连接器管理尚未接入', true)
          json(response, 200, { data: await options.connectorManagement.activationCommandState(token, input, requestId), requestId }); return
        }
        const activationResolve = /^\/haas\/v1\/admin\/connector-activation-commands\/([^/]+)\/resolve$/u.exec(path)
        if (method === 'POST' && (path === '/haas/v1/admin/connector-activation-commands' || activationResolve)) {
          const connectors = options.connectorManagement
          if (!connectors) throw new EnterpriseError(503, 'connector-management-unavailable', '连接器管理尚未接入', true)
          const controller = new AbortController(), disconnected = () => { if (!response.writableFinished) controller.abort() }
          response.once('close', disconnected); if (response.destroyed) disconnected()
          try {
            const data = activationResolve ? await connectors.resolveActivation(token, activationResolve[1]!, input, requestId, controller.signal)
              : await connectors.createActivation(token, input, context, controller.signal)
            json(response, data.outcome === 'unconfirmed' ? 202 : 200, { data, requestId })
          } finally { response.off('close', disconnected) }
          return
        }
        const connectorResolve = /^\/haas\/v1\/admin\/connector-commands\/([^/]+)\/resolve$/u.exec(path)
        if (method === 'POST' && (path === '/haas/v1/admin/connector-configuration' || path === '/haas/v1/admin/connector-activation-state' || path === '/haas/v1/admin/connector-commands' || path === '/haas/v1/admin/connector-approvals' || connectorResolve)) {
          const connectors = options.connectorManagement
          if (!connectors) throw new EnterpriseError(503, 'connector-management-unavailable', '连接器管理尚未接入', true)
          const controller = new AbortController(), disconnected = () => { if (!response.writableFinished) controller.abort() }
          response.once('close', disconnected); if (response.destroyed) disconnected()
          try {
            if (path === '/haas/v1/admin/connector-configuration') {
              json(response, 200, { data: await connectors.inspect(token, input, requestId, controller.signal), requestId })
            } else if (path === '/haas/v1/admin/connector-activation-state') {
              json(response, 200, { data: await connectors.inspectActivation(token, input, requestId, controller.signal), requestId })
            } else if (path === '/haas/v1/admin/connector-approvals') {
              json(response, 200, { ...await connectors.decideApproval(token, input, context, controller.signal), requestId })
            } else {
              const data = connectorResolve ? await connectors.resolve(token, connectorResolve[1]!, input, requestId, controller.signal)
                : await connectors.create(token, input, context, controller.signal)
              json(response, data.outcome === 'unconfirmed' ? 202 : 200, { data, requestId })
            }
          } finally { response.off('close', disconnected) }
          return
        }
        if (method === 'POST' && path === '/haas/v1/admin/instruction-command-state') {
          if (!options.instructionManagement) throw new EnterpriseError(503, 'instruction-management-unavailable', '成员指令管理尚未接入', true)
          json(response, 200, { data: await options.instructionManagement.state(token, input, requestId), requestId }); return
        }
        const instructionResolve = /^\/haas\/v1\/admin\/instruction-commands\/([^/]+)\/resolve$/u.exec(path)
        if (method === 'POST' && (path === '/haas/v1/admin/instruction-configuration' || path === '/haas/v1/admin/instruction-commands' || instructionResolve)) {
          const instructions = options.instructionManagement
          if (!instructions) throw new EnterpriseError(503, 'instruction-management-unavailable', '成员指令管理尚未接入', true)
          const controller = new AbortController(), disconnected = () => { if (!response.writableFinished) controller.abort() }
          response.once('close', disconnected); if (response.destroyed) disconnected()
          try {
            if (path === '/haas/v1/admin/instruction-configuration') {
              json(response, 200, { data: await instructions.inspect(token, input, requestId, controller.signal), requestId })
            } else {
              const data = instructionResolve ? await instructions.resolve(token, instructionResolve[1]!, input, requestId, controller.signal)
                : await instructions.create(token, input, context, controller.signal)
              json(response, data.outcome === 'unconfirmed' ? 202 : 200, { data, requestId })
            }
          } finally { response.off('close', disconnected) }
          return
        }
        if (method === 'POST' && path === '/haas/v1/admin/model-command-state') {
          if (!options.modelManagement) throw new EnterpriseError(503, 'model-management-unavailable', '模型管理尚未接入', true)
          json(response, 200, { data: await options.modelManagement.state(token, input, requestId), requestId }); return
        }
        const modelResolve = /^\/haas\/v1\/admin\/model-commands\/([^/]+)\/resolve$/u.exec(path)
        if (method === 'POST' && (path === '/haas/v1/admin/model-commands' || modelResolve)) {
          const models = options.modelManagement
          if (!models) throw new EnterpriseError(503, 'model-management-unavailable', '模型管理尚未接入', true)
          const controller = new AbortController(), disconnected = () => { if (!response.writableFinished) controller.abort() }
          response.once('close', disconnected); if (response.destroyed) disconnected()
          try {
            const data = modelResolve ? await models.resolve(token, modelResolve[1]!, input, requestId, controller.signal)
              : await models.create(token, input, context, controller.signal)
            json(response, data.outcome === 'unconfirmed' ? 202 : 200, { data, requestId })
          } finally { response.off('close', disconnected) }
          return
        }
        const featureAction = /^\/haas\/v1\/admin\/feature-packs\/(state|preview|approvals|commands)$/u.exec(path)
        const featureResume = /^\/haas\/v1\/admin\/feature-commands\/([^/]+)\/resume$/u.exec(path)
        if (method === 'POST' && (featureAction || featureResume)) {
          const features = options.featureManagement
          if (!features) throw new EnterpriseError(503, 'feature-management-unavailable', '功能包管理尚未接入', true)
          const controller = new AbortController(), disconnected = () => { if (!response.writableFinished) controller.abort() }
          response.once('close', disconnected); if (response.destroyed) disconnected()
          try {
            if (featureAction?.[1] === 'approvals') json(response, 200, { ...await features.approve(token, input, context), requestId })
            else {
              const data = featureResume ? await features.resume(token, featureResume[1]!, input, requestId, controller.signal)
                : featureAction?.[1] === 'state' ? await features.state(token, input, requestId, controller.signal)
                : featureAction?.[1] === 'preview' ? await features.preview(token, input, requestId, controller.signal)
                  : await features.create(token, input, context, controller.signal)
              json(response, 'outcome' in data && data.outcome === 'unconfirmed' ? 202 : 200, { data, requestId })
            }
          } finally { response.off('close', disconnected) }
          return
        }
        if (method === 'POST' && ['/haas/v1/admin/member-content', '/haas/v1/admin/model-state', '/haas/v1/admin/connector-state'].includes(path)) {
          const kind = path === '/haas/v1/admin/model-state' ? 'model-state' : path === '/haas/v1/admin/connector-state' ? 'connector-state' : 'member-content'
          const reader = kind === 'model-state' ? options.modelInspection : kind === 'connector-state' ? options.connectorInspection : options.memberContent
          if (!reader) throw new EnterpriseError(503, `${kind}-unavailable`, '成员只读查看尚未接通', true)
          const controller = new AbortController()
          const disconnected = () => { if (!response.writableFinished) controller.abort() }
          response.once('close', disconnected); if (response.destroyed) disconnected()
          try {
            // This is an audited fresh read, not a cached command replay. Every
            // page/retry gets new authorization and an independent access record.
            const data = await reader.read(token, input, requestId, controller.signal)
            json(response, 200, { data, requestId })
          } finally { response.off('close', disconnected) }
          return
        }
        const skillAdoption = /^\/haas\/v1\/catalog\/skills\/([^/]+)\/adoption$/u.exec(path)
        if (method === 'POST' && skillAdoption) {
          const controller = new AbortController()
          const disconnected = () => { if (!response.writableFinished) controller.abort(new Error('Skill adoption client disconnected')) }
          response.once('close', disconnected); if (response.destroyed) disconnected()
          try { json(response, 200, { ...await skills().adopt(token, skillAdoption[1]!, input, context, controller.signal), requestId }) }
          finally { response.off('close', disconnected) }
          return
        }
        if (method === 'POST' && path === '/haas/v1/admin/skill-publications') {
          const controller = new AbortController()
          const disconnected = () => { if (!response.writableFinished) controller.abort(new Error('Skill submission client disconnected')) }
          response.once('close', disconnected)
          if (response.destroyed) disconnected()
          try { json(response, 201, { ...await skills().submit(token, input, context, controller.signal), requestId }) }
          finally { response.off('close', disconnected) }
          return
        }
        const skillCommand = /^\/haas\/v1\/admin\/skill-publications\/([^/]+)\/(review|assignments)$/u.exec(path)
        if (method === 'POST' && skillCommand) {
          const result = skillCommand[2] === 'review'
            ? await skills().review(token, skillCommand[1]!, input, context) : await skills().assign(token, skillCommand[1]!, input, context)
          json(response, 200, { ...result, requestId }); return
        }
        if (method === 'POST' && path === '/haas/v1/publications') {
          json(response, 201, { ...await publications.submit(token, input, context), requestId }); return
        }
        const adoption = /^\/haas\/v1\/catalog\/agents\/([^/]+)\/adoption$/u.exec(path)
        if (method === 'POST' && adoption) {
          json(response, 200, { ...await publications.adopt(token, adoption[1]!, input, context), requestId }); return
        }
        const publication = /^\/haas\/v1\/admin\/publications\/([^/]+)\/(review|assignments)$/u.exec(path)
        if (method === 'POST' && publication) {
          const result = publication[2] === 'review'
            ? await publications.review(token, publication[1]!, input, context)
            : await publications.assign(token, publication[1]!, input, context)
          json(response, 200, { ...result, requestId }); return
        }
        if (method === 'POST' && path === '/haas/v1/bootstrap') {
          json(response, 201, { ...await options.identity.bootstrap(input, context), requestId }); return
        }
        if (method === 'POST' && path === '/haas/v1/auth/login') {
          const { token: newToken, ...result } = await options.identity.login(input, context, token)
          response.setHeader('Set-Cookie', cookie(newToken, 28_800))
          json(response, 200, { ...result, requestId }); return
        }
        if (method === 'POST' && path === '/haas/v1/auth/logout') {
          const result = await options.identity.logout(token, input, context)
          response.setHeader('Set-Cookie', cookie('', 0))
          json(response, 200, { ...result, requestId }); return
        }
        if (method === 'POST' && path === '/haas/v1/admin/members') {
          json(response, 201, { ...await options.identity.createMember(token, input, context), requestId }); return
        }
        if (method === 'POST' && path === '/haas/v1/admin/groups') {
          json(response, 201, { ...await options.identity.createGroup(token, input, context), requestId }); return
        }
        const groupTarget = /^\/haas\/v1\/admin\/groups\/([^/]+)(\/status)?$/u.exec(path)
        if (method === 'PATCH' && groupTarget) {
          const result = groupTarget[2]
            ? await options.identity.setGroupStatus(token, groupTarget[1]!, input, context)
            : await options.identity.updateGroup(token, groupTarget[1]!, input, context)
          json(response, 200, { ...result, requestId }); return
        }
        const nameTarget = /^\/haas\/v1\/admin\/members\/([^/]+)\/name$/u.exec(path)
        if (method === 'PATCH' && nameTarget) {
          json(response, 200, { ...await options.identity.renameMember(token, nameTarget[1]!, input, context), requestId }); return
        }
        const target = /^\/haas\/v1\/admin\/members\/([^/]+)\/status$/u.exec(path)
        if (method === 'PATCH' && target) {
          json(response, 200, { ...await options.identity.setMemberStatus(token, target[1]!, input, context), requestId }); return
        }
      }
      throw new EnterpriseError(404, 'not-found', '页面或接口不存在')
    } catch (error) {
      if (response.headersSent || response.destroyed) { response.destroy(); return }
      const failure = error instanceof EnterpriseError ? error : new EnterpriseError(503, 'service-unavailable', '服务暂时不可用，请稍后重试', true)
      // Only actual document navigation gets a recovery page. Fetches, native
      // RPC/assets and rejected request boundaries retain their real status.
      // In particular the recovery controller's fetch must never redirect back
      // to itself or mistake an authentication page for a healthy native root.
      const documentNavigation = validated && options.nativeGateway
        && isHarnessDocumentRequest(request.method ?? '', request.url ?? '')
        && request.headers.accept?.includes('text/html')
        && [undefined, 'document'].includes(request.headers['sec-fetch-dest'] as string | undefined)
      if (documentNavigation) {
        if (failure.status === 401) {
          response.writeHead(303, { Location: '/haas/login' }); response.end(); return
        }
        if ([403, 502, 503].includes(failure.status)) {
          response.writeHead(303, { Location: '/haas/recover' }); response.end(); return
        }
      }
      if (failure.status === 429 || failure.retryable) response.setHeader('Retry-After', failure.status === 429 ? '60' : '2')
      response.writeHead(failure.status, { 'Content-Type': 'application/problem+json; charset=utf-8' })
      response.end(JSON.stringify({ type: 'about:blank', title: failure.message, status: failure.status,
        code: failure.code, requestId, retryable: failure.retryable }))
    } finally { active -= 1 }
  }
  const server = options.tls ? createSecureServer(options.tls, handler) : createServer(handler)
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000
  server.maxHeadersCount = 48
  server.maxConnections = 256
  options.nativeGateway?.attach(server)
  server.once('close', () => options.memberContent?.close())
  server.once('close', () => options.modelInspection?.close())
  server.once('close', () => options.connectorInspection?.close())
  server.once('close', () => options.connectorManagement?.close())
  server.once('close', () => options.modelManagement?.close())
  server.once('close', () => options.instructionManagement?.close())
  return server
}
