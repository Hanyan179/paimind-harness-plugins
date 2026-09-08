import { describe, expect, it } from 'vitest'
import type { NotificationRecord } from '@hansen/contracts'
import type { PaimindStorageTable } from '@hansen/harness-compat/host'
import {
  PaimindNotificationsService,
  artifactNotificationFailureBody,
  shouldPublishArtifactNotification,
} from '../src/index.ts'

class MemoryTable implements PaimindStorageTable<NotificationRecord> {
  readonly records = new Map<string, NotificationRecord>()
  get(key: string): NotificationRecord | undefined { return this.records.get(key) }
  entries(): IterableIterator<[string, NotificationRecord]> { return new Map(this.records).entries() }
  get size(): number { return this.records.size }
  async put(key: string, value: NotificationRecord): Promise<void> { this.records.set(key, value) }
  async delete(key: string): Promise<boolean> { return this.records.delete(key) }
  async update(key: string, transform: (current: NotificationRecord) => NotificationRecord): Promise<NotificationRecord> {
    const current = this.records.get(key)
    if (current === undefined) throw new Error('missing')
    const next = transform(current)
    this.records.set(key, next)
    return next
  }
}

function serviceFixture(): { readonly service: PaimindNotificationsService; readonly table: MemoryTable } {
  const table = new MemoryTable()
  const service = Object.create(PaimindNotificationsService.prototype) as PaimindNotificationsService
  Object.assign(service, {
    ready: Promise.resolve({ table: () => table, close: async () => {} }),
    mutationTail: Promise.resolve(),
    notificationCtx: {},
  })
  return { service, table }
}

describe('FP12 durable notification domain', () => {
  it('keeps legacy artifact helpers stable without using them as publication policy', () => {
    expect(shouldPublishArtifactNotification({ kind: 'bento', previewKind: 'bento-deck' })).toBe(false)
    expect(shouldPublishArtifactNotification({ kind: 'html', previewKind: 'bento-deck' })).toBe(false)
    expect(shouldPublishArtifactNotification({ kind: 'html', previewKind: 'html-document' })).toBe(true)
    expect(shouldPublishArtifactNotification({ kind: 'pptx', previewKind: 'presentation' })).toBe(true)
  })

  it('normalizes real tool failures into the single-line bounded body contract', () => {
    expect(artifactNotificationFailureBody('Error: denied\n    at secret-path\u0000tail'))
      .toBe('Error: denied at secret-path tail')
    expect(artifactNotificationFailureBody('')).toBe('Artifact generation failed')
    expect(artifactNotificationFailureBody('x'.repeat(5_000))).toHaveLength(4_096)
  })

  it('assigns trusted producer identity and de-duplicates by producer/key', async () => {
    expect(PaimindNotificationsService.inject).toEqual(['storageDomain'])
    const { service, table } = serviceFixture()
    expect(table.size).toBe(0)
    const producer = service.registerProducer({ id: 'paimind.test', nameZh: '测试源', nameEn: 'Test source' })
    const first = await producer.publish({
      idempotencyKey: 'job:one', title: 'Report ready', level: 'success',
      target: { kind: 'session', sessionId: 'session-1' },
    })
    const repeated = await producer.publish({
      idempotencyKey: 'job:one', title: 'Spoofed retry', level: 'error',
    })
    expect(first).toBeDefined()
    if (first === undefined) throw new Error('notification unexpectedly suppressed')
    expect(repeated).toEqual(first)
    expect(table.size).toBe(1)
    expect(first.source).toEqual({ id: 'paimind.test', nameZh: '测试源', nameEn: 'Test source' })
  })

  it('marks one item with compare-and-set and marks all without copying linked state', async () => {
    const { service } = serviceFixture()
    const producer = service.registerProducer({ id: 'paimind.test', nameZh: '测试源', nameEn: 'Test source' })
    const one = await producer.publish({ idempotencyKey: 'one', title: 'One', level: 'info' })
    const two = await producer.publish({ idempotencyKey: 'two', title: 'Two', level: 'warning' })
    if (one === undefined || two === undefined) throw new Error('notification unexpectedly suppressed')
    const marked = await service.markRead({ id: one.id, ifVersion: one.version })
    expect(marked).toMatchObject({ ok: true, value: { id: one.id, readAt: expect.any(Number) } })
    expect(await service.markRead({ id: one.id, ifVersion: one.version })).toMatchObject({
      ok: false, error: { code: 'version-conflict', current: { id: one.id } },
    })
    const all = await service.markAllRead()
    expect(all.items).toHaveLength(2)
    expect(all.items.every(item => item.readAt !== undefined)).toBe(true)
    expect(all.items.find(item => item.id === two.id)?.target).toBeUndefined()
  })

})
