import { z } from 'zod'

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
const source = z.object({ id, nameZh: z.string(), nameEn: z.string() }).readonly()
const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('artifact'), artifactId: id, sessionId: id, workspaceId: id }).readonly(),
  z.object({ kind: z.literal('session'), sessionId: id }).readonly(),
  z.object({ kind: z.literal('surface'), surfaceId: z.string().regex(/^paimind:[a-z0-9][a-z0-9-]*$/) }).readonly(),
  z.object({ kind: z.literal('external'), url: z.url().startsWith('https://'), label: z.string().min(1).max(80).optional() }).readonly(),
])
const record = z.object({
  id, source, title: z.string(), body: z.string().optional(),
  level: z.enum(['info', 'success', 'warning', 'error']),
  createdAt: z.number().int().nonnegative(), readAt: z.number().int().nonnegative().optional(),
  recipientIds: z.array(id).min(1).max(500).readonly().optional(),
  version: id, target: target.optional(),
}).readonly()
const listValue = z.object({ items: z.array(record).readonly() }).readonly()
const mutationResult = z.union([
  z.object({ ok: z.literal(true), value: record }).readonly(),
  z.object({
    ok: z.literal(false),
    error: z.union([
      z.object({ code: z.literal('not-found'), id }).readonly(),
      z.object({ code: z.literal('version-conflict'), current: record }).readonly(),
    ]),
  }).readonly(),
])

export const PAIMIND_NOTIFICATION_REMOTE_DESCRIPTORS = Object.freeze([
  {
    id: '@hansen/notifications#paimindNotifications/list',
    service: 'paimindNotifications', namespace: 'paimindNotifications', method: 'list',
    invocation: { kind: 'direct' as const }, parameters: [],
    result: {
      mode: 'strict' as const, typeSymbol: '@hansen/notifications#PaimindNotificationListValue', schema: listValue,
    },
    sourceLocation: { file: 'packages/notifications/src/index.ts', line: 162, column: 3 },
  },
  {
    id: '@hansen/notifications#paimindNotifications/markRead',
    service: 'paimindNotifications', namespace: 'paimindNotifications', method: 'markRead',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'request', wire: 'request', source: 'json' as const,
      codec: {
        mode: 'strict' as const, typeSymbol: '@hansen/notifications#PaimindNotificationMarkReadRequest',
        schema: z.object({ id, ifVersion: id }).readonly(),
      },
    }],
    result: {
      mode: 'strict' as const, typeSymbol: '@hansen/notifications#PaimindNotificationMutationResult', schema: mutationResult,
    },
    sourceLocation: { file: 'packages/notifications/src/index.ts', line: 167, column: 3 },
  },
  {
    id: '@hansen/notifications#paimindNotifications/markAllRead',
    service: 'paimindNotifications', namespace: 'paimindNotifications', method: 'markAllRead',
    invocation: { kind: 'direct' as const }, parameters: [],
    result: {
      mode: 'strict' as const, typeSymbol: '@hansen/notifications#PaimindNotificationListValue', schema: listValue,
    },
    sourceLocation: { file: 'packages/notifications/src/index.ts', line: 187, column: 3 },
  },
])

export const TYPERT_REMOTE = Object.freeze({
  package: '@hansen/notifications',
  descriptors: PAIMIND_NOTIFICATION_REMOTE_DESCRIPTORS,
})

export default TYPERT_REMOTE
