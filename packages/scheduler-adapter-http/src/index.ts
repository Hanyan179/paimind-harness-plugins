import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import {
  definePaimindScheduleActionDescriptor,
  type PaimindNotificationSource,
  type PaimindScheduleActionRegistration,
  type PaimindScheduleRunAction,
} from '@hansen/contracts'
import { PaimindHostService } from '@hansen/harness-compat/host'
import { signPaimindRequest } from '@hansen/platform-sdk'
import type { PaimindScheduleExecutor, PaimindSchedulerServiceApi } from '@hansen/platform-scheduler'

export const name = 'paimind-scheduler-adapter-http'
export const PAIMIND_HTTP_SCHEDULER_ADAPTER_ID = 'adapter:paimind-http'

export interface PaimindCredentialResolver {
  resolve(reference: string): Promise<string>
}

export interface PaimindHttpScheduleActionRegistration {
  readonly registration: PaimindScheduleActionRegistration
  readonly source: PaimindNotificationSource
  readonly credentialRef: string
}

export interface PaimindHttpScheduleAdapter {
  registerAction(input: PaimindHttpScheduleActionRegistration): Promise<() => void>
  validateRunAction(actionId: string, action: PaimindScheduleRunAction | undefined): void
}

export interface PaimindHttpScheduleAdapterContext {
  readonly paimindScheduler: PaimindSchedulerServiceApi
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

export interface PaimindHttpScheduleAdapterOptions {
  readonly credentials?: PaimindCredentialResolver
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => number
  readonly requestId?: () => string
}

export class PaimindEnvironmentCredentialResolver implements PaimindCredentialResolver {
  async resolve(reference: string): Promise<string> {
    const raw = process.env.PAIMIND_SCHEDULER_OUTBOUND_SECRETS_JSON
    if (raw === undefined || raw.trim() === '') throw new Error('HTTP action credential is unavailable')
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { throw new Error('HTTP action credential configuration is invalid') }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('HTTP action credential configuration is invalid')
    }
    const secret = (parsed as Readonly<Record<string, unknown>>)[reference]
    if (typeof secret !== 'string' || secret.length < 32) throw new Error('HTTP action credential is unavailable')
    return secret
  }
}

function privateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false
  const [a = 0, b = 0] = parts
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** Registration-time SSRF fence. Deployment egress policy remains the final network boundary. */
export function definePaimindHttpEndpoint(value: string): URL {
  const url = new URL(value)
  const hostname = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error('HTTP action endpoint must be credential-free HTTPS')
  }
  if (
    hostname === 'localhost' || hostname.endsWith('.localhost')
    || privateIpv4(hostname) || (isIP(hostname) === 6 && (hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:')))
  ) throw new Error('HTTP action endpoint cannot target a private network address')
  return url
}

/** Standard-protocol providers need no provider-specific Scheduler branch. */
export class PaimindHttpScheduleAdapterService
  extends PaimindHostService
  implements PaimindHttpScheduleAdapter {
  static inject = ['paimindScheduler']
  private readonly registrations = new Map<string, PaimindHttpScheduleActionRegistration>()
  private readonly disposers = new Map<string, () => void>()
  private readonly fetcher: typeof globalThis.fetch
  private readonly now: () => number
  private readonly requestId: () => string

  constructor(
    private readonly adapterCtx: PaimindHttpScheduleAdapterContext,
    private readonly options: PaimindHttpScheduleAdapterOptions = {},
  ) {
    super(adapterCtx, 'paimindHttpScheduleAdapter')
    this.fetcher = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
    this.requestId = options.requestId ?? randomUUID
    adapterCtx.effect(() => () => {
      for (const dispose of this.disposers.values()) dispose()
      this.disposers.clear()
      this.registrations.clear()
    }, 'paimind-scheduler-adapter-http: actions')
  }

  async registerAction(input: PaimindHttpScheduleActionRegistration): Promise<() => void> {
    const endpoint = definePaimindHttpEndpoint(input.registration.invokeUrl)
    for (const origin of input.registration.allowedResultOrigins) {
      const url = definePaimindHttpEndpoint(origin)
      if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
        throw new Error('allowedResultOrigins must contain origins only')
      }
    }
    const descriptor = definePaimindScheduleActionDescriptor({
      actionId: input.registration.actionId,
      source: input.source,
      nameZh: input.registration.nameZh,
      nameEn: input.registration.nameEn,
      ...(input.registration.descriptionZh === undefined ? {} : { descriptionZh: input.registration.descriptionZh }),
      ...(input.registration.descriptionEn === undefined ? {} : { descriptionEn: input.registration.descriptionEn }),
      category: input.registration.category,
      adapterId: PAIMIND_HTTP_SCHEDULER_ADAPTER_ID,
      enabled: true,
      version: randomUUID(),
    })
    const executor: PaimindScheduleExecutor = async (request, signal) => {
      const body = JSON.stringify(request)
      const timestamp = String(this.now())
      const requestId = this.requestId()
      const secret = await (this.options.credentials ?? new PaimindEnvironmentCredentialResolver()).resolve(input.credentialRef)
      const signature = signPaimindRequest({
        method: 'POST', path: `${endpoint.pathname}${endpoint.search}`,
        timestamp, requestId, body,
      }, secret)
      const response = await this.fetcher(endpoint, {
        method: 'POST', redirect: 'error', signal, body,
        headers: {
          'content-type': 'application/json', accept: 'application/json',
          'x-paimind-contract-version': '1.0',
          'x-paimind-timestamp': timestamp,
          'x-paimind-request-id': requestId,
          'x-paimind-signature': signature,
        },
      })
      if (response.status !== 202) throw new Error(`HTTP action provider returned ${response.status}; expected 202`)
      return Object.freeze({ status: 'accepted' as const, message: 'External action accepted' })
    }
    const prior = this.disposers.get(descriptor.actionId)
    if (prior !== undefined) throw new Error('HTTP action is already registered')
    const disposeScheduler = await this.adapterCtx.paimindScheduler.registerAction(descriptor, executor)
    this.registrations.set(descriptor.actionId, input)
    const dispose = (): void => {
      if (this.disposers.get(descriptor.actionId) !== dispose) return
      this.disposers.delete(descriptor.actionId)
      this.registrations.delete(descriptor.actionId)
      disposeScheduler()
    }
    this.disposers.set(descriptor.actionId, dispose)
    return dispose
  }

  validateRunAction(actionId: string, action: PaimindScheduleRunAction | undefined): void {
    if (action === undefined || action.kind === 'session') return
    const registration = this.registrations.get(actionId)
    if (registration === undefined) throw new Error('HTTP action is unavailable')
    const origin = new URL(action.url).origin
    const allowed = registration.registration.allowedResultOrigins.some(value => new URL(value).origin === origin)
    if (!allowed) throw new Error('run action URL origin is not allowlisted')
  }
}

export default PaimindHttpScheduleAdapterService
