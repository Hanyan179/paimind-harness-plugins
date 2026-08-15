import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { PaimindReplayGuard, signPaimindRequest } from '@paimind/platform-sdk'
import { PaimindPlatformApiService } from '../src/index.ts'

const SECRET = 'platform-api-test-secret-with-more-than-32-characters'

function request(path: string, value: unknown, requestId = 'request:one') {
  const body = JSON.stringify(value)
  const timestamp = '1000'
  const stream = Readable.from([body])
  Object.assign(stream, {
    method: 'POST', url: path,
    headers: {
      authorization: 'Bearer service:billing',
      'x-paimind-timestamp': timestamp,
      'x-paimind-request-id': requestId,
      'x-paimind-signature': signPaimindRequest({ method: 'POST', path, timestamp, requestId, body }, SECRET),
    },
  })
  return stream
}

function response() {
  const state: { status?: number; value?: unknown } = {}
  const target = {
    writeHead(status: number) { state.status = status; return target },
    end(body?: string) { state.value = body === undefined || body === '' ? undefined : JSON.parse(body) },
  }
  return { target, state }
}

describe('PAIMind Platform API', () => {
  it('authenticates the caller, assigns its trusted source and rejects replay', async () => {
    const publish = vi.fn(async input => ({ id: 'notification:one', ...input }))
    const service = Object.create(PaimindPlatformApiService.prototype) as PaimindPlatformApiService
    Object.assign(service, {
      credentials: { resolve: async () => ({
        serviceId: 'service:billing', secret: SECRET, credentialRef: 'credential:billing',
        source: { id: 'service:billing', nameZh: '账单系统', nameEn: 'Billing' },
      }) },
      now: () => 1_000,
      replay: new PaimindReplayGuard(500),
      producers: new Map(),
      apiCtx: {
        paimindNotifications: { registerProducer: vi.fn(() => ({ publish })) },
        paimindScheduler: {}, paimindHttpScheduleAdapter: {},
      },
    })
    const path = '/paimind/platform/v1/notifications'
    const value = {
      recipientIds: ['user:one'], title: 'Invoice ready', idempotencyKey: 'invoice:one',
      link: { label: 'Open invoice', url: 'https://billing.example.test/invoices/one' },
    }
    const first = response()
    await service.handle(request(path, value) as never, first.target as never)
    expect(first.state.status).toBe(202)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      recipientIds: ['user:one'], title: 'Invoice ready', level: 'info',
      target: { kind: 'external', label: 'Open invoice', url: 'https://billing.example.test/invoices/one' },
    }))
    const repeated = response()
    await service.handle(request(path, value) as never, repeated.target as never)
    expect(repeated.state.status).toBe(409)
    expect(repeated.state.value).toMatchObject({ error: { code: 'replay_rejected' } })
  })
})
