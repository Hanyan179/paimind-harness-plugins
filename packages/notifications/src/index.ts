import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  defineNotificationRecord,
  type ArtifactProducedEnvelopeV1,
  type NotificationRecord,
  type PaimindNotificationPublishInput,
  type PaimindNotificationSource,
} from '@paimind/contracts'
import {
  PaimindHostRemoteService,
  definePaimindStorageDomain,
  markPaimindHostRemoteMethods,
  paimindDomainTable,
  type PaimindStorageDomainFacility,
  type PaimindStorageDomainHandle,
  type PaimindStorageTable,
} from '@paimind/harness-compat/host'

export const name = 'paimind-notifications'
export const PAIMIND_NOTIFICATION_DOMAIN = 'paimind_notifications'
export const MAX_NOTIFICATION_RECORDS = 200

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/
const CONTROL = /[\u0000-\u001f\u007f]/
const CONTROL_RUN = /[\u0000-\u001f\u007f]+/g

const sourceSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  nameZh: z.string().min(1).max(80),
  nameEn: z.string().min(1).max(80),
}).readonly()

const targetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('artifact'), artifactId: z.string().regex(ID_PATTERN),
    sessionId: z.string().regex(ID_PATTERN), workspaceId: z.string().regex(ID_PATTERN),
  }).readonly(),
  z.object({ kind: z.literal('session'), sessionId: z.string().regex(ID_PATTERN) }).readonly(),
  z.object({ kind: z.literal('surface'), surfaceId: z.string().regex(/^paimind:[a-z0-9][a-z0-9-]*$/) }).readonly(),
  z.object({ kind: z.literal('external'), url: z.url().startsWith('https://'), label: z.string().min(1).max(80).optional() }).readonly(),
])

export const notificationRecordSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  source: sourceSchema,
  title: z.string().min(1).max(240),
  body: z.string().min(1).max(4_096).optional(),
  level: z.enum(['info', 'success', 'warning', 'error']),
  createdAt: z.number().int().nonnegative(),
  readAt: z.number().int().nonnegative().optional(),
  version: z.string().regex(ID_PATTERN),
  recipientIds: z.array(z.string().regex(ID_PATTERN)).min(1).max(500).readonly().optional(),
  target: targetSchema.optional(),
}).refine(value => value.readAt === undefined || value.readAt >= value.createdAt, {
  path: ['readAt'], message: 'readAt must not precede createdAt',
})

export const notificationDomainSpec = definePaimindStorageDomain({
  name: PAIMIND_NOTIFICATION_DOMAIN,
  version: 0,
  tables: { notifications: paimindDomainTable(notificationRecordSchema) },
})

export interface PaimindNotificationListValue {
  readonly items: readonly Readonly<NotificationRecord>[]
}

export interface PaimindNotificationMarkReadRequest {
  readonly id: string
  readonly ifVersion: string
}

export type PaimindNotificationMutationResult =
  | { readonly ok: true; readonly value: Readonly<NotificationRecord> }
  | {
      readonly ok: false
      readonly error:
        | { readonly code: 'not-found'; readonly id: string }
        | { readonly code: 'version-conflict'; readonly current: Readonly<NotificationRecord> }
    }

export interface PaimindNotificationProducer {
  publish(input: PaimindNotificationPublishInput): Promise<Readonly<NotificationRecord> | undefined>
}

export interface PaimindNotificationService {
  registerProducer(source: PaimindNotificationSource): PaimindNotificationProducer
  list(): Promise<PaimindNotificationListValue>
  markRead(request: PaimindNotificationMarkReadRequest): Promise<PaimindNotificationMutationResult>
  markAllRead(): Promise<PaimindNotificationListValue>
}

export interface PaimindNotificationsHostContext {
  readonly storageDomain: PaimindStorageDomainFacility
  effect(
    install: () => void | (() => void | Promise<void>),
    label?: string,
  ): void
}

function sourceSnapshot(source: PaimindNotificationSource): Readonly<PaimindNotificationSource> {
  if (!ID_PATTERN.test(source.id)) throw new Error('invalid notification producer id')
  for (const [field, value] of [['nameZh', source.nameZh], ['nameEn', source.nameEn]] as const) {
    if (value.trim() === '' || value.length > 80 || CONTROL.test(value)) {
      throw new Error(`invalid notification producer ${field}`)
    }
  }
  return Object.freeze({ id: source.id, nameZh: source.nameZh.trim(), nameEn: source.nameEn.trim() })
}

function notificationId(producerId: string, idempotencyKey: string): string {
  if (idempotencyKey.trim() === '' || idempotencyKey.length > 512 || CONTROL.test(idempotencyKey)) {
    throw new Error('invalid notification idempotency key')
  }
  const digest = createHash('sha256').update(producerId).update('\0').update(idempotencyKey).digest('hex').slice(0, 32)
  return `notification:${digest}`
}

/** @deprecated Kept for public API compatibility; Artifact execution no longer publishes Notifications automatically. */
export function artifactNotificationFailureBody(message: string | undefined): string {
  const normalized = (message ?? '').replace(CONTROL_RUN, ' ').replace(/\s+/g, ' ').trim()
  return normalized === '' ? 'Artifact generation failed' : normalized.slice(0, 4_096)
}

/** @deprecated Kept for public API compatibility; explicit producers now own all publication decisions. */
export function shouldPublishArtifactNotification(
  artifact: Pick<ArtifactProducedEnvelopeV1, 'kind' | 'previewKind'>,
): boolean {
  return artifact.kind !== 'bento' && artifact.previewKind !== 'bento-deck'
}

/** Durable message/read-state sidecar. It never mutates linked Harness objects. */
export class PaimindNotificationsService
  extends PaimindHostRemoteService
  implements PaimindNotificationService {
  static inject = ['storageDomain']
  private readonly ready: Promise<PaimindStorageDomainHandle>
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(notificationCtx: PaimindNotificationsHostContext) {
    super(notificationCtx, 'paimindNotifications')
    markPaimindHostRemoteMethods(this, ['list', 'markRead', 'markAllRead'])
    this.ready = notificationCtx.storageDomain.open(notificationDomainSpec)
    notificationCtx.effect(() => async () => { await (await this.ready).close() }, 'paimind-notifications: domain')
  }

  registerProducer(source: PaimindNotificationSource): PaimindNotificationProducer {
    const trusted = sourceSnapshot(source)
    return Object.freeze({
      publish: async (input: PaimindNotificationPublishInput) => await this.publishTrusted(trusted, input),
    })
  }

  async list(): Promise<PaimindNotificationListValue> {
    return { items: await this.readItems() }
  }

  async markRead(request: PaimindNotificationMarkReadRequest): Promise<PaimindNotificationMutationResult> {
    if (!ID_PATTERN.test(request.id) || !ID_PATTERN.test(request.ifVersion)) {
      return { ok: false, error: { code: 'not-found', id: request.id } }
    }
    const result: PaimindNotificationMutationResult = await this.enqueue(async table => {
      const current = table.get(request.id)
      if (current === undefined) return { ok: false, error: { code: 'not-found', id: request.id } }
      if (current.version !== request.ifVersion) {
        return { ok: false, error: { code: 'version-conflict', current: defineNotificationRecord(current) } }
      }
      if (current.readAt !== undefined) return { ok: true, value: defineNotificationRecord(current) }
      const next = defineNotificationRecord({ ...current, readAt: Date.now(), version: randomUUID() })
      await table.put(request.id, next)
      return { ok: true, value: next }
    })
    return result
  }

  async markAllRead(): Promise<PaimindNotificationListValue> {
    return await this.enqueue(async table => {
      const now = Date.now()
      for (const [id, current] of table.entries()) {
        if (current.readAt !== undefined) continue
        await table.put(id, defineNotificationRecord({ ...current, readAt: now, version: randomUUID() }))
      }
      return { items: this.snapshotTable(table) }
    })
  }

  private async publishTrusted(
    source: Readonly<PaimindNotificationSource>,
    input: PaimindNotificationPublishInput,
  ): Promise<Readonly<NotificationRecord> | undefined> {
    const id = notificationId(source.id, input.idempotencyKey)
    return await this.enqueue(async table => {
      const current = table.get(id)
      if (current !== undefined) return defineNotificationRecord(current)
      const record = defineNotificationRecord({
        id, source, title: input.title, level: input.level,
        ...(input.recipientIds === undefined ? {} : { recipientIds: input.recipientIds }),
        ...(input.body === undefined ? {} : { body: input.body }),
        createdAt: Date.now(), version: randomUUID(),
        ...(input.target === undefined ? {} : { target: input.target }),
      })
      await table.put(id, record)
      const rows = this.snapshotTable(table)
      for (const expired of rows.slice(MAX_NOTIFICATION_RECORDS)) await table.delete(expired.id)
      return record
    })
  }

  private async readItems(): Promise<readonly Readonly<NotificationRecord>[]> {
    return this.snapshotTable(await this.table())
  }

  private snapshotTable(table: PaimindStorageTable<NotificationRecord>): readonly Readonly<NotificationRecord>[] {
    return Object.freeze([...table.entries()]
      .map(([, item]) => defineNotificationRecord(item))
      .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id)))
  }

  private async table(): Promise<PaimindStorageTable<NotificationRecord>> {
    return (await this.ready).table('notifications') as PaimindStorageTable<NotificationRecord>
  }

  private async enqueue<Result>(
    operation: (table: PaimindStorageTable<NotificationRecord>) => Promise<Result>,
  ): Promise<Result> {
    const prior = this.mutationTail
    let release = (): void => {}
    this.mutationTail = new Promise<void>(resolve => { release = resolve })
    await prior
    try { return await operation(await this.table()) } finally { release() }
  }
}

export default PaimindNotificationsService
