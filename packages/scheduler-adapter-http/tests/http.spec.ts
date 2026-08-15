import { describe, expect, it, vi } from 'vitest'
import { PaimindHttpScheduleAdapterService, definePaimindHttpEndpoint } from '../src/index.ts'

const registration = {
  actionId: 'action:billing', nameZh: '生成账单', nameEn: 'Generate invoice', category: 'integration' as const,
  invokeUrl: 'https://billing.example.test/scheduled-actions',
  allowedResultOrigins: ['https://billing.example.test/'],
}

function serviceFixture(scheduler: object, fetcher: typeof fetch): PaimindHttpScheduleAdapterService {
  const service = Object.create(PaimindHttpScheduleAdapterService.prototype) as PaimindHttpScheduleAdapterService
  Object.assign(service, {
    adapterCtx: { paimindScheduler: scheduler },
    options: { credentials: { resolve: async () => 'secret-that-is-longer-than-thirty-two-characters' } },
    fetcher,
    now: () => 1_000,
    requestId: () => 'request:one',
    registrations: new Map(),
    disposers: new Map(),
  })
  return service
}

describe('HTTP Scheduler Adapter', () => {
  it('rejects unsafe endpoints and non-origin result allowlists', () => {
    expect(() => definePaimindHttpEndpoint('http://billing.example.test/run')).toThrow(/HTTPS/)
    expect(() => definePaimindHttpEndpoint('https://127.0.0.1/run')).toThrow(/private network/)
  })

  it('sends one signed request and accepts only 202', async () => {
    let executor: ((request: never, signal: AbortSignal) => Promise<unknown>) | undefined
    const scheduler = {
      registerAction: vi.fn(async (_descriptor, next) => { executor = next; return () => {} }),
    }
    const fetcher = vi.fn(async () => new Response(null, { status: 202 }))
    const service = serviceFixture(scheduler, fetcher as typeof fetch)
    await service.registerAction({
      registration, credentialRef: 'credential:billing',
      source: { id: 'service:billing', nameZh: '账单系统', nameEn: 'Billing' },
    })
    const result = await executor!({
      contractVersion: '1.0', runId: 'run:one', scheduleId: 'schedule:one', actionId: 'action:billing', trigger: 'schedule',
      scheduledFor: '2026-08-15T00:00:00.000Z', idempotencyKey: 'key:one',
      callbackUrl: 'https://platform.example.test/callback',
    } as never, new AbortController().signal)
    expect(result).toMatchObject({ status: 'accepted' })
    expect(fetcher).toHaveBeenCalledWith(new URL(registration.invokeUrl), expect.objectContaining({
      method: 'POST', redirect: 'error', headers: expect.objectContaining({ 'x-paimind-signature': expect.any(String) }),
    }))
  })

  it('enforces the registered result-link origin', async () => {
    const service = serviceFixture({ registerAction: async () => () => {} }, vi.fn() as never)
    await service.registerAction({
      registration, credentialRef: 'credential:billing',
      source: { id: 'service:billing', nameZh: '账单系统', nameEn: 'Billing' },
    })
    expect(() => service.validateRunAction('action:billing', {
      kind: 'external', label: 'Open', url: 'https://billing.example.test/invoices/1',
    })).not.toThrow()
    expect(() => service.validateRunAction('action:billing', {
      kind: 'external', label: 'Open', url: 'https://evil.example.test/invoices/1',
    })).toThrow(/allowlisted/)
  })
})
