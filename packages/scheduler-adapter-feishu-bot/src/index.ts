import { randomUUID } from 'node:crypto'
import {
  definePaimindScheduleActionDescriptor,
  type PaimindNotificationSource,
  type PaimindScheduleRunReport,
  type PaimindScheduleTriggerRequest,
} from '@paimind/contracts'
import { PaimindHostService } from '@paimind/harness-compat/host'
import {
  PaimindScheduleDispatchError,
  type PaimindScheduleExecutor,
  type PaimindSchedulerServiceApi,
} from '@paimind/platform-scheduler'

export const name = 'paimind-scheduler-adapter-feishu-bot'
export const PAIMIND_FEISHU_BOT_SCHEDULER_ADAPTER_ID = 'adapter:paimind-feishu-bot'
export const PAIMIND_FEISHU_BOT_WEBHOOKS_ENV = 'PAIMIND_FEISHU_BOT_WEBHOOKS_JSON'

export interface PaimindFeishuBotCredentialResolver {
  resolve(reference: string): Promise<URL>
}

export interface PaimindFeishuBotScheduleActionRegistration {
  readonly actionId: string
  readonly source: PaimindNotificationSource
  readonly nameZh: string
  readonly nameEn: string
  readonly descriptionZh?: string
  readonly descriptionEn?: string
  readonly credentialRef: string
  readonly keyword: string
  readonly message: string | ((request: Readonly<PaimindScheduleTriggerRequest>) => string)
}

export interface PaimindFeishuBotScheduleAdapter {
  registerAction(input: PaimindFeishuBotScheduleActionRegistration): Promise<() => void>
}

export interface PaimindFeishuBotScheduleAdapterContext {
  readonly paimindScheduler: PaimindSchedulerServiceApi
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

export interface PaimindFeishuBotScheduleAdapterOptions {
  readonly credentials?: PaimindFeishuBotCredentialResolver
  readonly fetch?: typeof globalThis.fetch
}

function boundedKeyword(value: string): string {
  const normalized = value.trim()
  if (normalized === '' || normalized.length > 40 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error('invalid Feishu bot keyword')
  }
  return normalized
}

function boundedMessage(value: string): string {
  const normalized = value.trim()
  if (
    normalized === '' || normalized.length > 3_800
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)
  ) throw new Error('invalid Feishu bot message')
  return normalized
}

/** The Webhook URL is a credential. Only the official Feishu/Lark bot endpoint is accepted. */
export function definePaimindFeishuBotWebhook(value: string): URL {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || !['open.feishu.cn', 'open.larksuite.com'].includes(host)
    || !/^\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9-]+$/.test(url.pathname)
    || url.search !== '' || url.hash !== ''
  ) throw new Error('invalid Feishu custom-bot Webhook credential')
  return url
}

export class PaimindEnvironmentFeishuBotCredentialResolver implements PaimindFeishuBotCredentialResolver {
  async resolve(reference: string): Promise<URL> {
    const raw = process.env[PAIMIND_FEISHU_BOT_WEBHOOKS_ENV]
    if (raw === undefined || raw.trim() === '') throw new PaimindScheduleDispatchError(
      'Feishu bot Webhook credential is unavailable. Configure it in DSH Home .env and restart Harness',
      { retryable: false, code: 'feishu-credential-unavailable' },
    )
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { throw new PaimindScheduleDispatchError(
      'Feishu bot credential configuration is invalid',
      { retryable: false, code: 'feishu-credential-invalid' },
    ) }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new PaimindScheduleDispatchError('Feishu bot credential configuration is invalid', {
        retryable: false, code: 'feishu-credential-invalid',
      })
    }
    const value = (parsed as Readonly<Record<string, unknown>>)[reference]
    if (typeof value !== 'string') throw new PaimindScheduleDispatchError(
      'Feishu bot Webhook credential is unavailable. Configure the referenced credential in DSH Home .env',
      { retryable: false, code: 'feishu-credential-unavailable' },
    )
    try { return definePaimindFeishuBotWebhook(value) } catch (cause) {
      throw new PaimindScheduleDispatchError('Feishu bot Webhook credential is invalid', {
        retryable: false, code: 'feishu-credential-invalid', cause,
      })
    }
  }
}

function successCode(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const result = value as { readonly code?: unknown; readonly StatusCode?: unknown }
  return result.code === 0 || result.StatusCode === 0
}

/** Provider-specific translation stays in this Adapter; Scheduler Core remains unaware of Feishu. */
export class PaimindFeishuBotScheduleAdapterService
  extends PaimindHostService
  implements PaimindFeishuBotScheduleAdapter {
  static inject = ['paimindScheduler']
  private readonly fetcher: typeof globalThis.fetch
  private readonly disposers = new Map<string, () => void>()

  constructor(
    private readonly adapterCtx: PaimindFeishuBotScheduleAdapterContext,
    private readonly options: PaimindFeishuBotScheduleAdapterOptions = {},
  ) {
    super(adapterCtx, 'paimindFeishuBotScheduleAdapter')
    this.fetcher = options.fetch ?? globalThis.fetch
    adapterCtx.effect(() => () => {
      for (const dispose of this.disposers.values()) dispose()
      this.disposers.clear()
    }, 'paimind-scheduler-adapter-feishu-bot: actions')
  }

  async registerAction(input: PaimindFeishuBotScheduleActionRegistration): Promise<() => void> {
    const keyword = boundedKeyword(input.keyword)
    if (typeof input.message === 'string') boundedMessage(input.message)
    if (this.disposers.has(input.actionId)) throw new Error('Feishu bot action is already registered')
    const descriptor = definePaimindScheduleActionDescriptor({
      actionId: input.actionId,
      source: input.source,
      nameZh: input.nameZh,
      nameEn: input.nameEn,
      ...(input.descriptionZh === undefined ? {} : { descriptionZh: input.descriptionZh }),
      ...(input.descriptionEn === undefined ? {} : { descriptionEn: input.descriptionEn }),
      category: 'message',
      adapterId: PAIMIND_FEISHU_BOT_SCHEDULER_ADAPTER_ID,
      enabled: true,
      version: randomUUID(),
    })
    const executor: PaimindScheduleExecutor = async (request, signal) => {
      const webhook = await (this.options.credentials ?? new PaimindEnvironmentFeishuBotCredentialResolver()).resolve(input.credentialRef)
      const configured = boundedMessage(typeof input.message === 'function' ? input.message(request) : input.message)
      const text = configured.includes(keyword) ? configured : `${keyword}\n${configured}`
      const response = await this.fetcher(webhook, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text } }),
      })
      if (response.status !== 200) throw new Error(`Feishu bot returned HTTP ${response.status}`)
      let payload: unknown
      try { payload = await response.json() } catch { throw new Error('Feishu bot returned an invalid response') }
      if (!successCode(payload)) throw new Error('Feishu bot rejected the message')
      const report: PaimindScheduleRunReport = Object.freeze({
        contractVersion: '1.0',
        runId: request.runId,
        status: 'succeeded',
        message: `Feishu bot accepted the scheduled message; keyword "${keyword}" included`,
      })
      return report
    }
    const disposeScheduler = await this.adapterCtx.paimindScheduler.registerAction(descriptor, executor)
    const dispose = (): void => {
      if (this.disposers.get(descriptor.actionId) !== dispose) return
      this.disposers.delete(descriptor.actionId)
      disposeScheduler()
    }
    this.disposers.set(descriptor.actionId, dispose)
    return dispose
  }
}

export default PaimindFeishuBotScheduleAdapterService
