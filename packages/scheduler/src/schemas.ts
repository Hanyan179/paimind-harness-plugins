import { z } from 'zod'

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
const instant = z.iso.datetime({ offset: false })
const sourceSchema = z.object({
  id,
  nameZh: z.string().min(1).max(80),
  nameEn: z.string().min(1).max(80),
}).readonly()

export const schedulerRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: instant }).readonly(),
  z.object({ kind: z.literal('daily'), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/) }).readonly(),
  z.object({
    kind: z.literal('weekly'),
    weekday: z.number().int().min(1).max(7),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  }).readonly(),
  z.object({
    kind: z.literal('monthly'),
    dayOfMonth: z.number().int().min(1).max(28),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  }).readonly(),
])

export const schedulerRunActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), label: z.string().min(1).max(80), sessionId: id }).readonly(),
  z.object({ kind: z.literal('external'), label: z.string().min(1).max(80), url: z.url().startsWith('https://') }).readonly(),
])

export const schedulerActionSchema = z.object({
  actionId: id,
  source: sourceSchema,
  nameZh: z.string().min(1).max(120),
  nameEn: z.string().min(1).max(120),
  descriptionZh: z.string().min(1).max(500).optional(),
  descriptionEn: z.string().min(1).max(500).optional(),
  category: z.enum(['ai', 'integration', 'message', 'health-check']),
  adapterId: id,
  enabled: z.boolean(),
  version: id,
}).readonly()

export const schedulerDefinitionSchema = z.object({
  scheduleId: id,
  name: z.string().min(1).max(160),
  actionId: id,
  rule: schedulerRuleSchema,
  timeZone: z.string().min(1).max(120),
  status: z.enum(['enabled', 'paused', 'archived']),
  nextRunAt: instant.optional(),
  createdAt: instant,
  updatedAt: instant,
  archivedAt: instant.optional(),
  version: id,
}).readonly()

export const schedulerRunSchema = z.object({
  runId: id,
  idempotencyKey: id,
  scheduleId: id,
  actionId: id,
  trigger: z.enum(['schedule', 'manual']).default('schedule'),
  scheduledFor: instant,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'needs_attention']),
  attempt: z.number().int().nonnegative(),
  createdAt: instant,
  startedAt: instant.optional(),
  finishedAt: instant.optional(),
  message: z.string().min(1).max(4_096).optional(),
  progress: z.number().min(0).max(100).optional(),
  action: schedulerRunActionSchema.optional(),
  version: id,
}).readonly()

export const schedulerAuditSchema = z.object({
  auditId: id,
  scheduleId: id,
  actorId: id,
  operation: z.enum(['created', 'updated', 'paused', 'resumed', 'archived', 'dispatched', 'manual_dispatched']),
  occurredAt: instant,
  version: id,
}).readonly()
