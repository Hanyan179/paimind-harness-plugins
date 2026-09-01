import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { PaimindReplayGuard, signPaimindRequest } from '@paimind/platform-sdk'
import { PaimindPlatformApiService } from '../src/index.ts'

const SECRET = 'platform-api-test-secret-with-more-than-32-characters'

function request(path: string, value: unknown, requestId = 'request:one', method = 'POST') {
  const body = JSON.stringify(value)
  const timestamp = '1000'
  const stream = Readable.from([body])
  Object.assign(stream, {
    method, url: path,
    headers: {
      authorization: 'Bearer service:billing',
      'x-paimind-timestamp': timestamp,
      'x-paimind-request-id': requestId,
      'x-paimind-signature': signPaimindRequest({ method, path, timestamp, requestId, body }, SECRET),
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

  it('returns a stable conflict instead of an internal error for a duplicate action', async () => {
    const actionId = 'action:billing'
    const registration = {
      actionId,
      nameZh: '生成账单',
      nameEn: 'Generate invoice',
      category: 'integration',
      invokeUrl: 'https://billing.example.test/scheduled-actions',
      allowedResultOrigins: ['https://billing.example.test/'],
    }
    const registerAction = vi.fn()
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
        paimindNotifications: {},
        paimindScheduler: { list: async () => ({ actions: [{ actionId, enabled: true }], definitions: [], runs: [] }) },
        paimindHttpScheduleAdapter: { registerAction },
      },
    })
    const path = `/paimind/platform/v1/schedules/actions/${encodeURIComponent(actionId)}`
    const result = response()
    await service.handle(request(path, registration, 'request:duplicate', 'PUT') as never, result.target as never)
    expect(result.state.status).toBe(409)
    expect(result.state.value).toMatchObject({ error: { code: 'action_already_exists' } })
    expect(registerAction).not.toHaveBeenCalled()
  })

  it('returns a stable client error when a run action violates the provider allowlist', async () => {
    const runId = 'run:one'
    const path = `/paimind/platform/v1/schedules/runs/${encodeURIComponent(runId)}`
    const value = {
      contractVersion: '1.0' as const,
      runId,
      status: 'succeeded' as const,
      message: 'Invoice ready',
      action: { kind: 'external' as const, label: 'Open result', url: 'https://blocked.example.test/result' },
    }
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
        paimindNotifications: {},
        paimindScheduler: { list: async () => ({
          actions: [], definitions: [], runs: [{ runId, actionId: 'action:billing' }],
        }) },
        paimindHttpScheduleAdapter: {
          validateRunAction: () => { throw new Error('run action URL origin is not allowlisted') },
        },
      },
    })
    const result = response()
    await service.handle(request(path, value, 'request:invalid-run-action') as never, result.target as never)
    expect(result.state.status).toBe(400)
    expect(result.state.value).toMatchObject({
      error: { code: 'invalid_run_action', message: 'run action URL origin is not allowlisted' },
    })
  })
})
