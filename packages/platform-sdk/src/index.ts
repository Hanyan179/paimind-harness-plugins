import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  definePaimindScheduleRunReport,
  type PaimindNotificationLevel,
  type PaimindScheduleActionRegistration,
  type PaimindScheduleRunReport,
} from '@paimind/contracts'

export const PAIMIND_PLATFORM_CONTRACT_VERSION = '1.0' as const

export interface PaimindNotificationSendInput {
  readonly recipientIds: readonly string[]
  readonly title: string
  readonly body?: string
  readonly level?: PaimindNotificationLevel
  readonly link?: { readonly label: string; readonly url: string }
  readonly idempotencyKey: string
}

export interface PaimindPlatformClientOptions {
  readonly baseUrl: string
  readonly serviceId: string
  readonly secret: string
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => number
  readonly requestId?: () => string
}

export interface PaimindSignedRequest {
  readonly timestamp: string
  readonly requestId: string
  readonly signature: string
}

export interface PaimindSignatureInput {
  readonly method: string
  readonly path: string
  readonly timestamp: string
  readonly requestId: string
  readonly body: string
}

export const paimindPlatformIdentifierSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
export const paimindPlatformSafeUrlSchema = z.url().startsWith('https://').refine(value => {
  const url = new URL(value)
  return url.username === '' && url.password === ''
}, 'URL must not contain credentials')
export const paimindPlatformNotificationSchema = z.object({
  recipientIds: z.array(paimindPlatformIdentifierSchema).min(1).max(500).readonly(),
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(4_096).optional(),
  level: z.enum(['info', 'success', 'warning', 'error']).optional(),
  link: z.object({ label: z.string().trim().min(1).max(80), url: paimindPlatformSafeUrlSchema }).readonly().optional(),
  idempotencyKey: z.string().trim().min(1).max(512),
}).readonly()
export const paimindScheduleActionRegistrationSchema = z.object({
  actionId: paimindPlatformIdentifierSchema,
  nameZh: z.string().trim().min(1).max(120), nameEn: z.string().trim().min(1).max(120),
  descriptionZh: z.string().trim().min(1).max(500).optional(),
  descriptionEn: z.string().trim().min(1).max(500).optional(),
  category: z.enum(['ai', 'workflow', 'message', 'integration', 'health-check']),
  invokeUrl: paimindPlatformSafeUrlSchema,
  allowedResultOrigins: z.array(paimindPlatformSafeUrlSchema).max(20).readonly(),
}).readonly()

function canonicalSignatureInput(input: PaimindSignatureInput): string {
  return [input.method.toUpperCase(), input.path, input.timestamp, input.requestId, input.body].join('\n')
}

export function signPaimindRequest(input: PaimindSignatureInput, secret: string): string {
  if (secret.length < 32) throw new Error('PAIMind signing secret must contain at least 32 characters')
  return createHmac('sha256', secret).update(canonicalSignatureInput(input)).digest('base64url')
}

export function verifyPaimindRequestSignature(
  input: PaimindSignatureInput,
  signature: string,
  secret: string,
): boolean {
  let expected: Buffer
  let received: Buffer
  try {
    expected = Buffer.from(signPaimindRequest(input, secret), 'base64url')
    received = Buffer.from(signature, 'base64url')
  } catch { return false }
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export class PaimindReplayGuard {
  private readonly seen = new Map<string, number>()
  constructor(private readonly maxSkewMs = 300_000) {}

  accept(timestamp: string, requestId: string, now = Date.now()): boolean {
    const sentAt = Number(timestamp)
    if (!Number.isSafeInteger(sentAt) || Math.abs(now - sentAt) > this.maxSkewMs || !paimindPlatformIdentifierSchema.safeParse(requestId).success) {
      return false
    }
    for (const [id, expiresAt] of this.seen) if (expiresAt < now) this.seen.delete(id)
    if (this.seen.has(requestId)) return false
    this.seen.set(requestId, now + this.maxSkewMs)
    return true
  }
}

export class PaimindPlatformApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) { super(message) }
}

export interface PaimindPlatformClient {
  readonly notifications: {
    send(input: PaimindNotificationSendInput): Promise<unknown>
  }
  readonly schedules: {
    registerAction(input: PaimindScheduleActionRegistration): Promise<unknown>
    deactivateAction(actionId: string): Promise<unknown>
    reportRun(input: PaimindScheduleRunReport): Promise<unknown>
  }
}

export function createPaimindPlatformClient(options: PaimindPlatformClientOptions): PaimindPlatformClient {
  const base = new URL(options.baseUrl)
  if (base.protocol !== 'https:' || base.username !== '' || base.password !== '') {
    throw new Error('PAIMind Platform baseUrl must be credential-free HTTPS')
  }
  if (!paimindPlatformIdentifierSchema.safeParse(options.serviceId).success) throw new Error('invalid PAIMind serviceId')
  if (options.secret.length < 32) throw new Error('PAIMind signing secret must contain at least 32 characters')
  const fetcher = options.fetch ?? globalThis.fetch
  if (fetcher === undefined) throw new Error('fetch is unavailable')
  const now = options.now ?? Date.now
  const requestId = options.requestId ?? randomUUID

  const call = async (method: string, path: string, value?: unknown): Promise<unknown> => {
    const body = value === undefined ? '' : JSON.stringify(value)
    const timestamp = String(now())
    const id = requestId()
    const signature = signPaimindRequest({ method, path, timestamp, requestId: id, body }, options.secret)
    const response = await fetcher(new URL(path, base), {
      method,
      headers: {
        accept: 'application/json',
        ...(body === '' ? {} : { 'content-type': 'application/json' }),
        authorization: `Bearer ${options.serviceId}`,
        'x-paimind-contract-version': PAIMIND_PLATFORM_CONTRACT_VERSION,
        'x-paimind-timestamp': timestamp,
        'x-paimind-request-id': id,
        'x-paimind-signature': signature,
      },
      ...(body === '' ? {} : { body }),
    })
    const responseBody = await response.json().catch(() => undefined) as {
      readonly error?: { readonly code?: string; readonly message?: string }
      readonly requestId?: string
    } | undefined
    if (!response.ok) {
      throw new PaimindPlatformApiError(
        response.status,
        responseBody?.error?.code ?? 'platform_error',
        responseBody?.error?.message ?? `PAIMind Platform request failed (${response.status})`,
        responseBody?.requestId,
      )
    }
    return responseBody
  }

  return Object.freeze({
    notifications: Object.freeze({
      send: async (input: PaimindNotificationSendInput) => await call(
        'POST', '/paimind/platform/v1/notifications', paimindPlatformNotificationSchema.parse(input),
      ),
    }),
    schedules: Object.freeze({
      registerAction: async (input: PaimindScheduleActionRegistration) => await call(
        'PUT', `/paimind/platform/v1/schedules/actions/${encodeURIComponent(input.actionId)}`,
        paimindScheduleActionRegistrationSchema.parse(input),
      ),
      deactivateAction: async (actionId: string) => {
        paimindPlatformIdentifierSchema.parse(actionId)
        return await call('DELETE', `/paimind/platform/v1/schedules/actions/${encodeURIComponent(actionId)}`)
      },
      reportRun: async (input: PaimindScheduleRunReport) => await call(
        'POST', `/paimind/platform/v1/schedules/runs/${encodeURIComponent(input.runId)}`,
        definePaimindScheduleRunReport(input),
      ),
    }),
  })
}
