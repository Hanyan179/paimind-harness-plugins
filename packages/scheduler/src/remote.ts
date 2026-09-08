import { z } from 'zod'
import {
  schedulerActionSchema,
  schedulerDefinitionSchema,
  schedulerRunSchema,
} from './schemas.js'

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
const rule = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.iso.datetime({ offset: false }) }).readonly(),
  z.object({ kind: z.literal('daily'), time }).readonly(),
  z.object({ kind: z.literal('weekdays'), time }).readonly(),
  z.object({ kind: z.literal('weekly'), weekday: z.number().int().min(1).max(7), time }).readonly(),
  z.object({ kind: z.literal('monthly'), dayOfMonth: z.number().int().min(1).max(28), time }).readonly(),
])
const createInputBase = z.object({
  name: z.string().min(1).max(160), actionId: id, rule,
  actionInput: z.record(z.string(), z.json()).optional(),
  sourceSessionId: z.string().min(1).max(240).optional(),
  timeZone: z.string().min(1).max(120), enabled: z.boolean(),
})
const createInput = createInputBase.readonly()
const updateInput = createInputBase.extend({ scheduleId: id, ifVersion: id }).readonly()
const mutation = z.union([
  z.object({ ok: z.literal(true), value: schedulerDefinitionSchema }).readonly(),
  z.object({
    ok: z.literal(false),
    code: z.enum(['not-found', 'version-conflict', 'action-unavailable', 'invalid-input', 'no-future-occurrence']),
    message: z.string(),
  }).readonly(),
])
const runNowResult = z.union([
  z.object({ ok: z.literal(true), value: schedulerRunSchema }).readonly(),
  z.object({
    ok: z.literal(false),
    code: z.enum(['not-found', 'action-unavailable', 'run-active']),
    message: z.string(),
  }).readonly(),
])

export const PAIMIND_SCHEDULER_REMOTE_DESCRIPTORS = Object.freeze([
  {
    id: '@hansen/platform-scheduler#paimindScheduler/list',
    service: 'paimindScheduler', namespace: 'paimindScheduler', method: 'list',
    invocation: { kind: 'direct' as const }, parameters: [],
    result: {
      mode: 'strict' as const, typeSymbol: '@hansen/platform-scheduler#PaimindSchedulerSnapshot',
      schema: z.object({
        actions: z.array(schedulerActionSchema).readonly(),
        definitions: z.array(schedulerDefinitionSchema).readonly(),
        runs: z.array(schedulerRunSchema).readonly(),
      }).readonly(),
    },
    sourceLocation: { file: 'packages/scheduler/src/index.ts', line: 194, column: 3 },
  },
  {
    id: '@hansen/platform-scheduler#paimindScheduler/create',
    service: 'paimindScheduler', namespace: 'paimindScheduler', method: 'create',
    invocation: { kind: 'direct' as const },
    parameters: [{ name: 'input', wire: 'input', source: 'json' as const, codec: {
      mode: 'strict' as const, typeSymbol: '@hansen/contracts#PaimindScheduleCreateInput', schema: createInput,
    } }],
    result: { mode: 'strict' as const, typeSymbol: '@hansen/contracts#PaimindScheduleDefinition', schema: schedulerDefinitionSchema },
    sourceLocation: { file: 'packages/scheduler/src/index.ts', line: 199, column: 3 },
  },
  {
    id: '@hansen/platform-scheduler#paimindScheduler/update',
    service: 'paimindScheduler', namespace: 'paimindScheduler', method: 'update',
    invocation: { kind: 'direct' as const },
    parameters: [{ name: 'input', wire: 'input', source: 'json' as const, codec: {
      mode: 'strict' as const, typeSymbol: '@hansen/contracts#PaimindScheduleUpdateInput', schema: updateInput,
    } }],
    result: { mode: 'strict' as const, typeSymbol: '@hansen/platform-scheduler#PaimindScheduleMutationResult', schema: mutation },
    sourceLocation: { file: 'packages/scheduler/src/index.ts', line: 203, column: 3 },
  },
  {
    id: '@hansen/platform-scheduler#paimindScheduler/setEnabled',
    service: 'paimindScheduler', namespace: 'paimindScheduler', method: 'setEnabled',
    invocation: { kind: 'direct' as const },
    parameters: [{ name: 'input', wire: 'input', source: 'json' as const, codec: {
      mode: 'strict' as const, typeSymbol: '@hansen/platform-scheduler#PaimindScheduleSetEnabledRequest',
      schema: z.object({ scheduleId: id, enabled: z.boolean(), ifVersion: id }).readonly(),
    } }],
    result: { mode: 'strict' as const, typeSymbol: '@hansen/platform-scheduler#PaimindScheduleMutationResult', schema: mutation },
    sourceLocation: { file: 'packages/scheduler/src/index.ts', line: 207, column: 3 },
  },
  {
    id: '@hansen/platform-scheduler#paimindScheduler/archive',
    service: 'paimindScheduler', namespace: 'paimindScheduler', method: 'archive',
    invocation: { kind: 'direct' as const },
    parameters: [{ name: 'input', wire: 'input', source: 'json' as const, codec: {
      mode: 'strict' as const, typeSymbol: '@hansen/platform-scheduler#PaimindScheduleArchiveRequest',
      schema: z.object({ scheduleId: id, ifVersion: id }).readonly(),
    } }],
    result: { mode: 'strict' as const, typeSymbol: '@hansen/platform-scheduler#PaimindScheduleMutationResult', schema: mutation },
    sourceLocation: { file: 'packages/scheduler/src/index.ts', line: 213, column: 3 },
  },
  {
    id: '@hansen/platform-scheduler#paimindScheduler/runNow',
    service: 'paimindScheduler', namespace: 'paimindScheduler', method: 'runNow',
    invocation: { kind: 'direct' as const },
    parameters: [{ name: 'input', wire: 'input', source: 'json' as const, codec: {
      mode: 'strict' as const, typeSymbol: '@hansen/platform-scheduler#PaimindScheduleRunNowRequest',
      schema: z.object({ scheduleId: id }).readonly(),
    } }],
    result: { mode: 'strict' as const, typeSymbol: '@hansen/platform-scheduler#PaimindScheduleRunNowResult', schema: runNowResult },
    sourceLocation: { file: 'packages/scheduler/src/index.ts', line: 217, column: 3 },
  },
  {
    id: '@hansen/platform-scheduler#paimindScheduler/restore',
    service: 'paimindScheduler', namespace: 'paimindScheduler', method: 'restore',
    invocation: { kind: 'direct' as const },
    parameters: [{ name: 'input', wire: 'input', source: 'json' as const, codec: {
      mode: 'strict' as const, typeSymbol: '@hansen/platform-scheduler#PaimindScheduleRestoreRequest',
      schema: z.object({ scheduleId: id, ifVersion: id }).readonly(),
    } }],
    result: { mode: 'strict' as const, typeSymbol: '@hansen/platform-scheduler#PaimindScheduleMutationResult', schema: mutation },
    sourceLocation: { file: 'packages/scheduler/src/index.ts', line: 222, column: 3 },
  },
])

export const TYPERT_REMOTE = Object.freeze({
  package: '@hansen/platform-scheduler',
  descriptors: PAIMIND_SCHEDULER_REMOTE_DESCRIPTORS,
})

export default TYPERT_REMOTE
