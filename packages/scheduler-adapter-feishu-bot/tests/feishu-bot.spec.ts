import { describe, expect, it, vi } from 'vitest'
import {
  PaimindEnvironmentFeishuBotCredentialResolver,
  PaimindFeishuBotScheduleAdapterService,
  PAIMIND_FEISHU_BOT_WEBHOOKS_ENV,
  definePaimindFeishuBotWebhook,
} from '../src/index.ts'

const request = {
  contractVersion: '1.0' as const,
  runId: 'run:feishu-one',
  scheduleId: 'schedule:feishu-one',
  actionId: 'action:feishu-one',
  trigger: 'schedule' as const,
  scheduledFor: '2026-08-15T08:00:00.000Z',
  idempotencyKey: 'key:feishu-one',
  callbackUrl: 'https://platform.example.test/callback',
}

function serviceFixture(scheduler: object, fetcher: typeof fetch): PaimindFeishuBotScheduleAdapterService {
  const service = Object.create(PaimindFeishuBotScheduleAdapterService.prototype) as PaimindFeishuBotScheduleAdapterService
  Object.assign(service, {
    adapterCtx: { paimindScheduler: scheduler },
    options: { credentials: { resolve: async () => new URL('https://open.feishu.cn/open-apis/bot/v2/hook/example-token') } },
    fetcher,
    disposers: new Map(),
  })
  return service
}

describe('Feishu bot Scheduler Adapter', () => {
  it('marks a missing persistent credential as non-retryable configuration failure', async () => {
    const previous = process.env[PAIMIND_FEISHU_BOT_WEBHOOKS_ENV]
    delete process.env[PAIMIND_FEISHU_BOT_WEBHOOKS_ENV]
    try {
      await expect(new PaimindEnvironmentFeishuBotCredentialResolver().resolve('credential:missing'))
        .rejects.toMatchObject({ retryable: false, code: 'feishu-credential-unavailable' })
    } finally {
      if (previous === undefined) delete process.env[PAIMIND_FEISHU_BOT_WEBHOOKS_ENV]
      else process.env[PAIMIND_FEISHU_BOT_WEBHOOKS_ENV] = previous
    }
  })

  it('accepts only official credential-free custom-bot Webhooks', () => {
    expect(definePaimindFeishuBotWebhook('https://open.feishu.cn/open-apis/bot/v2/hook/example-token').hostname)
      .toBe('open.feishu.cn')
    expect(() => definePaimindFeishuBotWebhook('http://open.feishu.cn/open-apis/bot/v2/hook/example-token'))
      .toThrow(/credential/)
    expect(() => definePaimindFeishuBotWebhook('https://evil.example.test/open-apis/bot/v2/hook/example-token'))
      .toThrow(/credential/)
  })

  it('guarantees the configured keyword and maps success to a final Run report', async () => {
    let executor: ((input: typeof request, signal: AbortSignal) => Promise<unknown>) | undefined
    const scheduler = { registerAction: vi.fn(async (_descriptor, next) => { executor = next; return () => {} }) }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ StatusCode: 0, code: 0 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    const service = serviceFixture(scheduler, fetcher as typeof fetch)
    await service.registerAction({
      actionId: request.actionId,
      source: { id: 'service:feishu', nameZh: '飞书机器人', nameEn: 'Feishu bot' },
      nameZh: '机器人测试', nameEn: 'Bot test', credentialRef: 'credential:feishu',
      keyword: '测试', message: 'Scheduled message\nwithout the configured keyword.',
    })
    expect(await executor!(request, new AbortController().signal)).toMatchObject({
      status: 'succeeded', runId: request.runId,
    })
    const body = JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit | undefined)?.body)) as {
      readonly content: { readonly text: string }
    }
    expect(body.content.text).toContain('测试')
    expect(body.content.text).toContain('\n')
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: 'POST', redirect: 'error' }))
  })

  it('rejects a provider-level error even when HTTP succeeds', async () => {
    let executor: ((input: typeof request, signal: AbortSignal) => Promise<unknown>) | undefined
    const scheduler = { registerAction: vi.fn(async (_descriptor, next) => { executor = next; return () => {} }) }
    const service = serviceFixture(scheduler, vi.fn(async () => new Response(JSON.stringify({ code: 19024 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as typeof fetch)
    await service.registerAction({
      actionId: request.actionId,
      source: { id: 'service:feishu', nameZh: '飞书机器人', nameEn: 'Feishu bot' },
      nameZh: '机器人测试', nameEn: 'Bot test', credentialRef: 'credential:feishu',
      keyword: '测试', message: '测试',
    })
    await expect(executor!(request, new AbortController().signal)).rejects.toThrow(/rejected/)
  })
})
