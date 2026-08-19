import { Temporal } from '@js-temporal/polyfill'
import { definePaimindScheduleRule, type PaimindScheduleRule } from '@paimind/contracts'

function localTime(rule: Exclude<PaimindScheduleRule, { readonly kind: 'once' }>): Temporal.PlainTime {
  return Temporal.PlainTime.from(rule.time)
}

function zoned(
  date: Temporal.PlainDate,
  time: Temporal.PlainTime,
  timeZone: string,
): Temporal.ZonedDateTime {
  return Temporal.ZonedDateTime.from({
    timeZone,
    year: date.year,
    month: date.month,
    day: date.day,
    hour: time.hour,
    minute: time.minute,
  }, { disambiguation: 'compatible' })
}

function instantString(value: Temporal.Instant): string {
  return new Date(value.epochMilliseconds).toISOString()
}

/** Return the first occurrence strictly after one UTC instant. */
export function nextScheduleOccurrence(
  input: PaimindScheduleRule,
  timeZone: string,
  after: string,
): string | undefined {
  const rule = definePaimindScheduleRule(input)
  const boundary = Temporal.Instant.from(after)
  if (rule.kind === 'once') {
    const candidate = Temporal.Instant.from(rule.at)
    return Temporal.Instant.compare(candidate, boundary) > 0 ? instantString(candidate) : undefined
  }

  const localBoundary = boundary.toZonedDateTimeISO(timeZone)
  const time = localTime(rule)
  let date = localBoundary.toPlainDate()
  if (rule.kind === 'weekdays') {
    if (date.dayOfWeek > 5) date = date.add({ days: 8 - date.dayOfWeek })
  } else if (rule.kind === 'weekly') {
    date = date.add({ days: (rule.weekday - date.dayOfWeek + 7) % 7 })
  } else if (rule.kind === 'monthly') {
    date = Temporal.PlainDate.from({ year: date.year, month: date.month, day: rule.dayOfMonth })
  }

  let candidate = zoned(date, time, timeZone)
  if (Temporal.Instant.compare(candidate.toInstant(), boundary) <= 0) {
    if (rule.kind === 'daily') date = date.add({ days: 1 })
    else if (rule.kind === 'weekdays') {
      date = date.add({ days: date.dayOfWeek === 5 ? 3 : 1 })
    }
    else if (rule.kind === 'weekly') date = date.add({ days: 7 })
    else date = Temporal.PlainDate.from(date.add({ months: 1 }).with({ day: rule.dayOfMonth }))
    candidate = zoned(date, time, timeZone)
  }
  return instantString(candidate.toInstant())
}

/** Collapse any downtime window to the latest missed occurrence. */
export function latestDueScheduleOccurrence(
  rule: PaimindScheduleRule,
  timeZone: string,
  firstDueAt: string,
  now: string,
): string {
  if (Temporal.Instant.compare(Temporal.Instant.from(firstDueAt), Temporal.Instant.from(now)) > 0) {
    throw new Error('first occurrence is not due')
  }
  let latest = firstDueAt
  for (let index = 0; index < 100_000; index += 1) {
    const next = nextScheduleOccurrence(rule, timeZone, latest)
    if (next === undefined || Temporal.Instant.compare(Temporal.Instant.from(next), Temporal.Instant.from(now)) > 0) {
      return latest
    }
    latest = next
  }
  throw new Error('schedule catch-up window exceeds safety limit')
}
