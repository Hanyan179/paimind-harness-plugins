import { z } from 'zod'

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
const common = {
  id,
  prompt: z.string(),
  scheduledAt: z.iso.datetime({ offset: true }),
  state: z.enum(['scheduled', 'overdue']),
  deliveryMode: z.literal('session-local'),
}
const schedule = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('after'), afterSeconds: z.number().int().positive() }).readonly(),
  z.object({ ...common, kind: z.literal('at') }).readonly(),
  z.object({ ...common, kind: z.literal('every'), everySeconds: z.number().int().min(300) }).readonly(),
])

export const PAIMIND_SCHEDULE_REMOTE_DESCRIPTORS = Object.freeze([{
  id: '@paimind/scheduler#paimindSchedule/list',
  service: 'paimindSchedule', namespace: 'paimindSchedule', method: 'list',
  invocation: { kind: 'direct' as const },
  parameters: [{
    name: 'request', wire: 'request', source: 'json' as const,
    codec: {
      mode: 'strict' as const,
      typeSymbol: '@paimind/scheduler#PaimindNativeScheduleListRequest',
      schema: z.object({ sessionId: id }).readonly(),
    },
  }],
  result: {
    mode: 'strict' as const,
    typeSymbol: '@paimind/scheduler#PaimindNativeScheduleListValue',
    schema: z.object({ sessionId: id, items: z.array(schedule).readonly() }).readonly(),
  },
  sourceLocation: { file: 'packages/scheduler-native/src/index.ts', line: 35, column: 3 },
}])

export const TYPERT_REMOTE = Object.freeze({
  package: '@paimind/scheduler',
  descriptors: PAIMIND_SCHEDULE_REMOTE_DESCRIPTORS,
})

export default TYPERT_REMOTE
