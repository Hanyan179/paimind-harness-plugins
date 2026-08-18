import { describe, expect, it } from 'vitest'
import {
  FEATURE_PACKAGE_IDS,
  PAIMIND_SCHEDULE_CAPABILITIES,
  definePaimindScheduleActionInput,
  definePaimindScheduleDefinition,
  definePaimindScheduleRun,
  defineNotificationRecord,
  defineNotificationTarget,
  defineArtifactTraceEnvelope,
} from '../src/index.ts'

describe('migration contracts', () => {
  it('keeps one ordered identifier for every independently verified package', () => {
    expect(FEATURE_PACKAGE_IDS).toHaveLength(16)
    expect(FEATURE_PACKAGE_IDS[0]).toBe('FP01')
    expect(FEATURE_PACKAGE_IDS.at(-1)).toBe('FP16')
    expect(new Set(FEATURE_PACKAGE_IDS).size).toBe(FEATURE_PACKAGE_IDS.length)
  })

  it('accepts canonical notification targets and rejects unsafe external links', () => {
    expect(defineNotificationTarget({
      kind: 'artifact', artifactId: 'artifact:one', sessionId: 'session-1', workspaceId: 'workspace-1',
    })).toMatchObject({ kind: 'artifact', artifactId: 'artifact:one' })
    expect(() => defineNotificationTarget({ kind: 'external', url: 'http://example.test' })).toThrow(/HTTPS/)
    expect(() => defineNotificationTarget({ kind: 'external', url: 'https://u:p@example.test' })).toThrow(/credential-free/)
  })

  it('keeps notification state lightweight and validates Host-owned identity', () => {
    expect(defineNotificationRecord({
      id: 'notification:one',
      source: { id: 'paimind.artifacts', nameZh: '产物生成', nameEn: 'Artifact generation' },
      title: 'Report ready', level: 'success', createdAt: 10, readAt: 12,
      version: 'version:one',
      target: { kind: 'session', sessionId: 'session-1' },
    })).toMatchObject({ title: 'Report ready', readAt: 12, level: 'success' })
    expect(() => defineNotificationRecord({
      id: 'notification:one',
      source: { id: 'paimind.artifacts', nameZh: '产物生成', nameEn: 'Artifact generation' },
      title: 'Report ready', level: 'success', createdAt: 10, readAt: 9,
      version: 'version:one',
    })).toThrow(/readAt/)
  })

  it('defines conversational schedule inputs and weekdays without exposing arbitrary payloads', () => {
    expect(PAIMIND_SCHEDULE_CAPABILITIES).toMatchObject({
      rules: ['once', 'daily', 'weekdays', 'weekly', 'monthly'], runNow: true, cron: false,
      fixedInterval: false, overlappingRuns: false, businessParameters: true,
    })
    expect(definePaimindScheduleDefinition({
      scheduleId: 'schedule:one', name: 'Daily brief', actionId: 'action:brief',
      actionInput: { prompt: 'Create a daily brief.', options: { language: 'zh-CN' } },
      sourceSessionId: 'session:setup',
      rule: { kind: 'weekdays', time: '09:00' }, timeZone: 'Asia/Shanghai', status: 'enabled',
      nextRunAt: '2026-08-16T01:00:00.000Z', createdAt: '2026-08-15T01:00:00.000Z',
      updatedAt: '2026-08-15T01:00:00.000Z', version: 'version:one',
    })).toMatchObject({
      actionId: 'action:brief', sourceSessionId: 'session:setup', status: 'enabled',
      rule: { kind: 'weekdays', time: '09:00' },
    })
    expect(definePaimindScheduleActionInput({ nested: ['safe', 1, true] })).toEqual({ nested: ['safe', 1, true] })
    expect(() => definePaimindScheduleActionInput({ accessToken: 'must-not-persist' })).toThrow(/sensitive field/)
    expect(() => definePaimindScheduleActionInput({ value: Number.NaN })).toThrow(/finite/)
    expect(() => definePaimindScheduleDefinition({
      scheduleId: 'schedule:one', name: 'Broken monthly rule', actionId: 'action:brief',
      rule: { kind: 'monthly', dayOfMonth: 31, time: '09:00' }, timeZone: 'Asia/Shanghai', status: 'enabled',
      createdAt: '2026-08-15T01:00:00.000Z', updatedAt: '2026-08-15T01:00:00.000Z', version: 'version:one',
    })).toThrow(/dayOfMonth/)
  })

  it('requires final run messages and hides progress outside running state', () => {
    const base = {
      runId: 'run:one', idempotencyKey: 'key:one', scheduleId: 'schedule:one', actionId: 'action:brief',
      trigger: 'schedule' as const,
      scheduledFor: '2026-08-15T01:00:00.000Z', attempt: 1,
      createdAt: '2026-08-15T01:00:00.000Z', startedAt: '2026-08-15T01:00:01.000Z', version: 'version:one',
    } as const
    expect(definePaimindScheduleRun({ ...base, status: 'running', progress: 64 })).toMatchObject({ progress: 64 })
    expect(() => definePaimindScheduleRun({
      ...base, status: 'succeeded', finishedAt: '2026-08-15T01:01:00.000Z',
    })).toThrow(/requires message/)
    expect(() => definePaimindScheduleRun({
      ...base, status: 'succeeded', message: 'Done', progress: 100,
      finishedAt: '2026-08-15T01:01:00.000Z',
    })).toThrow(/only while running/)
  })

  it('accepts hashed trace sidecar references while keeping V1 inline compatibility', () => {
    const common = { traceId: 'trace:one', artifactId: 'artifact:one', sessionId: 'session-1', workspaceId: 'workspace-1', producerId: 'producer', taskId: 'job-1', artifactRevision: 1, producedAt: 1 }
    expect(defineArtifactTraceEnvelope({ schema: 'paimind.artifact-trace/v1', ...common, document: { schemaVersion: 'paimind.presentation-trace/v2' } }).schema).toBe('paimind.artifact-trace/v1')
    expect(defineArtifactTraceEnvelope({ schema: 'paimind.artifact-trace/v2', ...common, documentRef: { path: 'deck.trace.json', schema: 'paimind.presentation-trace/v3', sha256: 'a'.repeat(64), bytes: 42 } }).schema).toBe('paimind.artifact-trace/v2')
    expect(() => defineArtifactTraceEnvelope({ schema: 'paimind.artifact-trace/v2', ...common, documentRef: { path: 'deck.trace.json', schema: 'paimind.presentation-trace/v3', sha256: 'wrong', bytes: 42 } })).toThrow(/sha256/)
  })
})
