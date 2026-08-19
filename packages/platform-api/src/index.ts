import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import {
  definePaimindScheduleRunReport,
  type PaimindNotificationSource,
  type PaimindScheduleActionRegistration,
} from '@paimind/contracts'
import { PaimindHostService, type PaimindStorageDomainFacility } from '@paimind/harness-compat/host'
import type { PaimindHostWebServer } from '@paimind/harness-compat'
import type { PaimindNotificationProducer, PaimindNotificationService } from '@paimind/notifications'
import { PaimindReplayGuard, verifyPaimindRequestSignature } from '@paimind/platform-sdk'
import type { PaimindSchedulerServiceApi } from '@paimind/platform-scheduler'
import type { PaimindHttpScheduleAdapter } from '@paimind/scheduler-adapter-http'

export const name = 'paimind-platform-api'
export const PAIMIND_PLATFORM_API_PREFIX = '/paimind/platform/v1'
export const PAIMIND_PLATFORM_MAX_BODY_BYTES = 256 * 1024

export interface PaimindServiceCredential {
  readonly serviceId: string
  readonly secret: string
  readonly credentialRef: string
  readonly source: PaimindNotificationSource
}

export interface PaimindServiceCredentialProvider {
  resolve(serviceId: string): Promise<Readonly<PaimindServiceCredential> | undefined>
}

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
const safeUrl = z.url().startsWith('https://').refine(value => {
  const url = new URL(value)
  return url.username === '' && url.password === ''
}, 'URL must not contain credentials')
const notificationSchema = z.object({
  recipientIds: z.array(identifier).min(1).max(500).readonly(),
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(4_096).optional(),
  level: z.enum(['info', 'success', 'warning', 'error']).optional(),
  link: z.object({ label: z.string().trim().min(1).max(80), url: safeUrl }).readonly().optional(),
  idempotencyKey: z.string().trim().min(1).max(512),
}).readonly()
const registrationSchema = z.object({
  actionId: identifier,
  nameZh: z.string().trim().min(1).max(120), nameEn: z.string().trim().min(1).max(120),
  descriptionZh: z.string().trim().min(1).max(500).optional(), descriptionEn: z.string().trim().min(1).max(500).optional(),
  category: z.enum(['ai', 'workflow', 'message', 'integration', 'health-check']),
  invokeUrl: safeUrl,
  allowedResultOrigins: z.array(safeUrl).max(20).readonly(),
}).readonly()

export class PaimindEnvironmentCredentialProvider implements PaimindServiceCredentialProvider {
  async resolve(serviceId: string): Promise<Readonly<PaimindServiceCredential> | undefined> {
    const raw = process.env.PAIMIND_PLATFORM_SERVICE_CREDENTIALS_JSON
    if (raw === undefined || raw.trim() === '') return undefined
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { throw new Error('PAIMIND platform credential configuration is invalid') }
    const row = z.record(identifier, z.object({
      secret: z.string().min(32), credentialRef: identifier,
      source: z.object({ id: identifier, nameZh: z.string().min(1).max(80), nameEn: z.string().min(1).max(80) }).readonly(),
    }).readonly()).parse(parsed)[serviceId]
    return row === undefined ? undefined : Object.freeze({ serviceId, ...row })
  }
}

export interface PaimindPlatformApiContext {
  readonly webServer: PaimindHostWebServer
  readonly storageDomain: PaimindStorageDomainFacility
  readonly paimindNotifications: PaimindNotificationService
  readonly paimindScheduler: PaimindSchedulerServiceApi
  readonly paimindHttpScheduleAdapter: PaimindHttpScheduleAdapter
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

export interface PaimindPlatformApiOptions {
  readonly credentials?: PaimindServiceCredentialProvider
  readonly now?: () => number
  readonly replayWindowMs?: number
}

class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

function header(request: IncomingMessage, name: string): string {
  const value = request.headers[name]
  if (typeof value !== 'string' || value === '') throw new ApiFailure(401, 'invalid_authentication', `Missing ${name}`)
  return value
}

async function body(request: IncomingMessage): Promise<string> {
  let total = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += value.length
    if (total > PAIMIND_PLATFORM_MAX_BODY_BYTES) throw new ApiFailure(413, 'body_too_large', 'Request body is too large')
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}

/** Authenticated Platform API. TLS termination and egress policy are deployment responsibilities. */
export class PaimindPlatformApiService extends PaimindHostService {
  static inject = ['webServer', 'paimindNotifications', 'paimindScheduler', 'paimindHttpScheduleAdapter']
  private readonly credentials: PaimindServiceCredentialProvider
  private readonly now: () => number
  private readonly replay: PaimindReplayGuard
  private readonly producers = new Map<string, PaimindNotificationProducer>()

  constructor(private readonly apiCtx: PaimindPlatformApiContext, options: PaimindPlatformApiOptions = {}) {
    super(apiCtx, 'paimindPlatformApi')
    this.credentials = options.credentials ?? new PaimindEnvironmentCredentialProvider()
    this.now = options.now ?? Date.now
    this.replay = new PaimindReplayGuard(options.replayWindowMs ?? 300_000)
    apiCtx.effect(() => apiCtx.webServer.register({
      kind: 'prefix', path: PAIMIND_PLATFORM_API_PREFIX,
      handler: async (request, response) => { await this.handle(request, response) },
    }), 'paimind-platform-api: routes')
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let requestId: string | undefined
    try {
      const url = new URL(request.url ?? '/', 'http://paimind-platform.invalid')
      const method = request.method ?? 'GET'
      const raw = await body(request)
      requestId = header(request, 'x-paimind-request-id')
      const credential = await this.authenticate(request, method, `${url.pathname}${url.search}`, raw, requestId)
      const relative = url.pathname.slice(PAIMIND_PLATFORM_API_PREFIX.length)
      if (method === 'POST' && relative === '/notifications') {
        const input = notificationSchema.parse(JSON.parse(raw))
        let producer = this.producers.get(credential.serviceId)
        if (producer === undefined) {
          producer = this.apiCtx.paimindNotifications.registerProducer(credential.source)
          this.producers.set(credential.serviceId, producer)
        }
        const record = await producer.publish({
          idempotencyKey: input.idempotencyKey,
          recipientIds: input.recipientIds,
          title: input.title,
          level: input.level ?? 'info',
          ...(input.body === undefined ? {} : { body: input.body }),
          ...(input.link === undefined ? {} : {
            target: { kind: 'external' as const, label: input.link.label, url: input.link.url },
          }),
        })
        json(response, 202, { id: record?.id, requestId })
        return
      }
      const actionMatch = relative.match(/^\/schedules\/actions\/([^/]+)$/)
      if (actionMatch !== null && method === 'PUT') {
        const actionId = decodeURIComponent(actionMatch[1]!)
        const registration = registrationSchema.parse(JSON.parse(raw)) as PaimindScheduleActionRegistration
        if (registration.actionId !== actionId) throw new ApiFailure(400, 'action_id_mismatch', 'Path and body actionId do not match')
        await this.apiCtx.paimindHttpScheduleAdapter.registerAction({
          registration, source: credential.source, credentialRef: credential.credentialRef,
        })
        json(response, 201, { actionId, requestId })
        return
      }
      if (actionMatch !== null && method === 'DELETE') {
        const actionId = decodeURIComponent(actionMatch[1]!)
        const changed = await this.apiCtx.paimindScheduler.deactivateAction(actionId)
        if (!changed) throw new ApiFailure(404, 'action_not_found', 'Action not found')
        response.writeHead(204, { 'cache-control': 'no-store' }); response.end(); return
      }
      const runMatch = relative.match(/^\/schedules\/runs\/([^/]+)$/)
      if (runMatch !== null && method === 'POST') {
        const runId = decodeURIComponent(runMatch[1]!)
        const report = definePaimindScheduleRunReport(JSON.parse(raw))
        if (report.runId !== runId) throw new ApiFailure(400, 'run_id_mismatch', 'Path and body runId do not match')
        const snapshot = await this.apiCtx.paimindScheduler.list()
        const run = snapshot.runs.find(candidate => candidate.runId === runId)
        if (run === undefined) throw new ApiFailure(404, 'run_not_found', 'Run not found')
        this.apiCtx.paimindHttpScheduleAdapter.validateRunAction(run.actionId, report.action)
        const next = await this.apiCtx.paimindScheduler.reportRun(report)
        json(response, 200, { run: next, requestId })
        return
      }
      throw new ApiFailure(404, 'not_found', 'Platform API route not found')
    } catch (error) {
      const failure = error instanceof ApiFailure
        ? error
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? new ApiFailure(400, 'invalid_request', 'Request body does not match the public contract')
          : new ApiFailure(500, 'internal_error', 'Platform API request failed')
      json(response, failure.status, { error: { code: failure.code, message: failure.message }, requestId })
    }
  }

  private async authenticate(
    request: IncomingMessage,
    method: string,
    path: string,
    rawBody: string,
    requestId: string,
  ): Promise<Readonly<PaimindServiceCredential>> {
    const authorization = header(request, 'authorization')
    if (!authorization.startsWith('Bearer ')) throw new ApiFailure(401, 'invalid_authentication', 'Invalid authorization scheme')
    const serviceId = authorization.slice('Bearer '.length)
    if (!identifier.safeParse(serviceId).success) throw new ApiFailure(401, 'invalid_authentication', 'Invalid service identity')
    const credential = await this.credentials.resolve(serviceId)
    if (credential === undefined) throw new ApiFailure(401, 'invalid_authentication', 'Unknown service identity')
    const timestamp = header(request, 'x-paimind-timestamp')
    const signature = header(request, 'x-paimind-signature')
    const valid = verifyPaimindRequestSignature({ method, path, timestamp, requestId, body: rawBody }, signature, credential.secret)
    if (!valid) throw new ApiFailure(401, 'invalid_signature', 'Request signature is invalid')
    if (!this.replay.accept(timestamp, requestId, this.now())) throw new ApiFailure(409, 'replay_rejected', 'Request is expired or was already received')
    return credential
  }
}

export default PaimindPlatformApiService
