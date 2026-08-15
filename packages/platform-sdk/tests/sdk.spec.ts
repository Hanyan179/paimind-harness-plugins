import { describe, expect, it, vi } from 'vitest'
import {
  PaimindReplayGuard,
  createPaimindPlatformClient,
  signPaimindRequest,
  verifyPaimindRequestSignature,
} from '../src/index.ts'

const SECRET = 'test-secret-that-is-at-least-thirty-two-characters'

describe('PAIMind Platform SDK', () => {
  it('signs deterministically, verifies in constant-time form and rejects replay', () => {
    const input = { method: 'POST', path: '/callback', timestamp: '1000', requestId: 'request:one', body: '{}' }
    const signature = signPaimindRequest(input, SECRET)
    expect(verifyPaimindRequestSignature(input, signature, SECRET)).toBe(true)
    expect(verifyPaimindRequestSignature({ ...input, body: '{"changed":true}' }, signature, SECRET)).toBe(false)
    const guard = new PaimindReplayGuard(500)
    expect(guard.accept('1000', 'request:one', 1_100)).toBe(true)
    expect(guard.accept('1000', 'request:one', 1_100)).toBe(false)
    expect(guard.accept('1', 'request:old', 1_100)).toBe(false)
  })

  it('sends trusted identity in headers and validates safe public inputs', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 202, headers: { 'content-type': 'application/json' },
    }))
    const client = createPaimindPlatformClient({
      baseUrl: 'https://platform.example.test', serviceId: 'service:billing', secret: SECRET,
      fetch: fetcher as typeof fetch, now: () => 1_000, requestId: () => 'request:one',
    })
    await client.notifications.send({
      recipientIds: ['user:one'], title: 'Invoice ready',
      link: { label: 'Open invoice', url: 'https://billing.example.test/invoices/1' },
      idempotencyKey: 'invoice:1',
    })
    const request = fetcher.mock.calls[0]
    expect(request?.[1]?.headers).toMatchObject({
      authorization: 'Bearer service:billing', 'x-paimind-request-id': 'request:one',
    })
    await expect(client.notifications.send({
      recipientIds: ['user:one'], title: 'Unsafe',
      link: { label: 'Open', url: 'http://billing.example.test' }, idempotencyKey: 'unsafe:1',
    })).rejects.toThrow()
  })
})
