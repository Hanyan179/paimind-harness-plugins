import { describe, expect, it } from 'vitest'
import { latestDueScheduleOccurrence, nextScheduleOccurrence } from '../src/time.ts'

describe('Scheduler calendar rules', () => {
  it('handles daily DST gaps with Temporal compatible disambiguation', () => {
    expect(nextScheduleOccurrence(
      { kind: 'daily', time: '02:30' },
      'America/New_York',
      '2026-03-08T06:00:00Z',
    )).toBe('2026-03-08T07:30:00.000Z')
  })

  it('calculates weekly/monthly rules and latest-only catch-up', () => {
    expect(nextScheduleOccurrence(
      { kind: 'weekly', weekday: 1, time: '09:00' }, 'Asia/Shanghai', '2026-08-15T00:00:00Z',
    )).toBe('2026-08-17T01:00:00.000Z')
    expect(nextScheduleOccurrence(
      { kind: 'monthly', dayOfMonth: 20, time: '10:00' }, 'Asia/Shanghai', '2026-08-20T03:00:00Z',
    )).toBe('2026-09-20T02:00:00.000Z')
    expect(latestDueScheduleOccurrence(
      { kind: 'daily', time: '09:00' }, 'Asia/Shanghai',
      '2026-08-16T01:00:00Z', '2026-08-19T04:00:00Z',
    )).toBe('2026-08-19T01:00:00.000Z')
  })

  it('runs weekdays Monday through Friday and skips the weekend', () => {
    expect(nextScheduleOccurrence(
      { kind: 'weekdays', time: '09:00' }, 'Asia/Shanghai', '2026-08-14T02:00:00Z',
    )).toBe('2026-08-17T01:00:00.000Z')
    expect(nextScheduleOccurrence(
      { kind: 'weekdays', time: '09:00' }, 'Asia/Shanghai', '2026-08-17T00:00:00Z',
    )).toBe('2026-08-17T01:00:00.000Z')
  })
})
