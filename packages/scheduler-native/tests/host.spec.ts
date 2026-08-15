import { describe, expect, it } from 'vitest'
import { listPaimindNativeSchedules } from '@paimind/harness-compat/host'

describe('Harness-native Schedule projection', () => {
  it('folds canonical schedule/change events and preserves Session-local truth', () => {
    const sessions = {
      get: (id: string) => id === 'session-one' ? {
        header: { seedLength: 0 },
        events: [{
          seq: 0,
          time: 1_786_766_400_000,
          type: 'schedule/change',
          data: {
            version: 1,
            operation: 'create',
            schedule: {
              id: 'schedule-1',
              kind: 'every',
              prompt: '检查项目状态',
              everySeconds: 300,
              scheduledAt: '2026-08-15T08:05:00.000Z',
            },
          },
        }],
      } : undefined,
    }

    expect(listPaimindNativeSchedules(sessions, 'session-one', Date.parse('2026-08-15T08:00:00.000Z'))).toEqual([{
      id: 'schedule-1',
      kind: 'every',
      prompt: '检查项目状态',
      everySeconds: 300,
      scheduledAt: '2026-08-15T08:05:00.000Z',
      state: 'scheduled',
      deliveryMode: 'session-local',
    }])
    expect(listPaimindNativeSchedules(sessions, 'missing')).toEqual([])
  })

  it('honors canonical delete events instead of maintaining a shadow list', () => {
    const schedule = {
      id: 'schedule-1', kind: 'after', prompt: '提醒我复盘', afterSeconds: 60,
      scheduledAt: '2026-08-15T08:01:00.000Z',
    }
    const sessions = { get: () => ({ header: {}, events: [
      { seq: 0, time: 1, type: 'schedule/change', data: { version: 1, operation: 'create', schedule } },
      { seq: 1, time: 2, type: 'schedule/change', data: { version: 1, operation: 'delete', id: 'schedule-1' } },
    ] }) }
    expect(listPaimindNativeSchedules(sessions, 'session-one')).toEqual([])
  })
})
