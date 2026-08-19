import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type {
  PaimindScheduleActionDescriptor,
  PaimindScheduleAuditRecord,
  PaimindScheduleDefinition,
  PaimindScheduleRun,
} from '@paimind/contracts'
import {
  PaimindScheduleDispatchError,
  PaimindSchedulerCore,
  type PaimindSchedulerClock,
  type PaimindSchedulerTable,
  type PaimindSchedulerTables,
} from '../src/core.ts'

class MemoryTable<Value> implements PaimindSchedulerTable<Value> {
  readonly values = new Map<string, Value>()
  get(key: string): Value | undefined { return this.values.get(key) }
  entries(): IterableIterator<[string, Value]> { return this.values.entries() }
  async put(key: string, value: Value): Promise<void> { this.values.set(key, structuredClone(value)) }
  async delete(key: string): Promise<boolean> { return this.values.delete(key) }
}

function tables(): PaimindSchedulerTables {
  return {
    actions: new MemoryTable<PaimindScheduleActionDescriptor>(),
    definitions: new MemoryTable<PaimindScheduleDefinition>(),
    runs: new MemoryTable<PaimindScheduleRun>(),
    audits: new MemoryTable<PaimindScheduleAuditRecord>(),
  }
}

function clock(initial: string): PaimindSchedulerClock & { set(value: string): void } {
  let now = Date.parse(initial)
  return {
    now: () => now,
    set: value => { now = Date.parse(value) },
    setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => {},
    delay: async () => {},
  }
}

function action(): PaimindScheduleActionDescriptor {
  return {
    actionId: 'action:brief',
    source: { id: 'paimind.ai', nameZh: 'PAIMind AI', nameEn: 'PAIMind AI' },
    nameZh: '生成项目简报', nameEn: 'Generate project brief', category: 'ai',
    adapterId: 'adapter:test', enabled: true, version: randomUUID(),
  }
}

describe('platform Scheduler Core', () => {
  it('validates, persists, and dispatches definition-owned action input and setup context', async () => {
    const store = tables()
    const now = clock('2026-08-15T00:00:00.000Z')
    const executor = vi.fn(async request => ({
      contractVersion: '1.0' as const, runId: request.runId, status: 'succeeded' as const, message: 'Done',
    }))
    const core = new PaimindSchedulerCore(store, {
      callbackUrl: 'https://platform.example.test/callback', clock: now,
    })
    await core.registerAction({ ...action(), conversationEnabled: true }, executor, {
      validateActionInput: input => {
        if (typeof input?.prompt !== 'string') throw new Error('prompt is required')
        return { prompt: input.prompt.trim(), version: 1 }
      },
    })
    const definition = await core.create({
      name: 'Weekly project brief', actionId: 'action:brief',
      actionInput: { prompt: '  Summarize the project.  ' }, sourceSessionId: 'session:setup',
      rule: { kind: 'weekdays', time: '09:00' }, timeZone: 'Asia/Shanghai', enabled: true,
    }, 'user:one')
    expect(definition).toMatchObject({
      actionInput: { prompt: 'Summarize the project.', version: 1 }, sourceSessionId: 'session:setup',
    })
    expect((await core.runNow(definition.scheduleId, 'user:one')).ok).toBe(true)
    await vi.waitFor(() => { expect(executor).toHaveBeenCalledTimes(1) })
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      scheduleName: 'Weekly project brief', actionInput: { prompt: 'Summarize the project.', version: 1 },
      sourceSessionId: 'session:setup',
    }), expect.any(AbortSignal))
    await expect(core.create({
      name: 'Invalid input', actionId: 'action:brief',
      rule: { kind: 'daily', time: '09:00' }, timeZone: 'UTC', enabled: false,
    }, 'user:one')).rejects.toThrow('prompt is required')
  })

  it('rejects definition-owned inputs for fixed actions without a validator', async () => {
    const core = new PaimindSchedulerCore(tables(), {
      callbackUrl: 'https://platform.example.test/callback', clock: clock('2026-08-15T00:00:00.000Z'),
    })
    await core.registerAction(action(), async request => ({
      contractVersion: '1.0', runId: request.runId, status: 'succeeded', message: 'Done',
    }))
    await expect(core.create({
      name: 'Unexpected input', actionId: 'action:brief', actionInput: { prompt: 'Do something else' },
      rule: { kind: 'daily', time: '09:00' }, timeZone: 'UTC', enabled: false,
    }, 'user:one')).rejects.toThrow('does not accept per-task business input')
  })

  it('does not retry non-retryable Adapter configuration failures', async () => {
    const store = tables()
    const now = clock('2026-08-15T00:00:00.000Z')
    const executor = vi.fn(async () => {
      throw new PaimindScheduleDispatchError('Credential is unavailable', {
        retryable: false,
        code: 'credential-unavailable',
      })
    })
    const core = new PaimindSchedulerCore(store, {
      callbackUrl: 'https://platform.example.test/callback', clock: now, maxDispatchAttempts: 3,
    })
    await core.registerAction(action(), executor)
    const definition = await core.create({
      name: 'Credential check', actionId: 'action:brief',
      rule: { kind: 'daily', time: '09:00' }, timeZone: 'Asia/Shanghai', enabled: true,
    }, 'user:one')
    expect((await core.runNow(definition.scheduleId, 'user:one')).ok).toBe(true)
    await vi.waitFor(() => { expect(core.listRuns()[0]?.status).toBe('failed') })
    expect(executor).toHaveBeenCalledTimes(1)
    expect(core.listRuns()[0]).toMatchObject({
      attempt: 1,
      message: 'Dispatch failed after 1 attempt(s): Credential is unavailable',
    })
  })

  it('creates one deterministic run and treats duplicate ticks as idempotent', async () => {
    const store = tables()
    const now = clock('2026-08-15T00:00:00.000Z')
    const executor = vi.fn(async request => ({
      contractVersion: '1.0' as const, runId: request.runId,
      status: 'succeeded' as const, message: 'Brief generated',
    }))
    const core = new PaimindSchedulerCore(store, {
      callbackUrl: 'https://platform.example.test/callback', clock: now,
    })
    await core.registerAction(action(), executor)
    const definition = await core.create({
      name: 'Daily brief', actionId: 'action:brief',
      rule: { kind: 'once', at: '2026-08-15T00:01:00.000Z' },
      timeZone: 'Asia/Shanghai', enabled: true,
    }, 'user:one')
    now.set('2026-08-15T00:01:00.000Z')
    await core.tick()
    await vi.waitFor(() => { expect(core.listRuns()).toHaveLength(1) })
    await vi.waitFor(() => { expect(core.listRuns()[0]?.status).toBe('succeeded') })
    await core.tick()
    expect(core.listRuns()).toHaveLength(1)
    expect(executor).toHaveBeenCalledTimes(1)
    expect(core.listDefinitions()[0]).toMatchObject({ scheduleId: definition.scheduleId, status: 'paused' })
    expect(core.listRuns()[0]).toMatchObject({ trigger: 'schedule' })
    expect(core.listRuns()[0]?.runId).toMatch(/^run:[a-f0-9]{32}$/)
    const resume = await core.setEnabled(definition.scheduleId, true, core.listDefinitions()[0]!.version, 'user:one')
    expect(resume).toMatchObject({ ok: false, code: 'no-future-occurrence' })

    const manualRun = await core.runNow(definition.scheduleId, 'user:one')
    expect(manualRun).toMatchObject({ ok: true, value: { trigger: 'manual' } })
    await vi.waitFor(() => { expect(core.listRuns().filter(run => run.trigger === 'manual')[0]?.status).toBe('succeeded') })
    expect(core.listDefinitions()[0]).toMatchObject({ status: 'paused' })
    expect(core.listDefinitions()[0]).not.toHaveProperty('nextRunAt')
    expect(executor).toHaveBeenLastCalledWith(expect.objectContaining({ trigger: 'manual' }), expect.any(AbortSignal))
  })

  it('keeps due schedules pending while their registered action is unavailable', async () => {
    const store = tables()
    const now = clock('2026-08-15T00:00:00.000Z')
    const executor = vi.fn(async request => ({
      contractVersion: '1.0' as const, runId: request.runId,
      status: 'succeeded' as const, message: 'Dispatched after action recovery',
    }))
    const core = new PaimindSchedulerCore(store, {
      callbackUrl: 'https://platform.example.test/callback', clock: now,
    })
    const dispose = await core.registerAction(action(), executor)
    const definition = await core.create({
      name: 'Pending brief', actionId: 'action:brief',
      rule: { kind: 'once', at: '2026-08-15T00:01:00.000Z' },
      timeZone: 'UTC', enabled: true,
    }, 'user:one')

    dispose()
    expect(core.listActions()[0]).toMatchObject({ actionId: 'action:brief', enabled: false })
    await expect(core.create({
      name: 'Unavailable action', actionId: 'action:brief',
      rule: { kind: 'once', at: '2026-08-15T00:02:00.000Z' },
      timeZone: 'UTC', enabled: true,
    }, 'user:one')).rejects.toThrow('schedule action is unavailable')

    now.set('2026-08-15T00:01:00.000Z')
    await core.tick()
    expect(core.listRuns()).toHaveLength(0)
    expect(core.listDefinitions()[0]).toMatchObject({
      scheduleId: definition.scheduleId,
      status: 'enabled',
      nextRunAt: '2026-08-15T00:01:00.000Z',
    })

    await core.registerAction(action(), executor)
    await core.tick()
    await vi.waitFor(() => { expect(core.listRuns()[0]?.status).toBe('succeeded') })
    expect(core.listRuns()[0]).toMatchObject({ trigger: 'schedule' })
    expect(core.listDefinitions()[0]).toMatchObject({ status: 'paused' })
  })

  it('sorts upcoming tasks by next run before non-active tasks', async () => {
    const store = tables()
    const now = clock('2026-08-15T00:00:00.000Z')
    const core = new PaimindSchedulerCore(store, {
      callbackUrl: 'https://platform.example.test/callback', clock: now,
    })
    await core.registerAction(action(), async request => ({
      contractVersion: '1.0', runId: request.runId, status: 'succeeded', message: 'Done',
    }))
    await core.create({
      name: 'Paused task', actionId: 'action:brief',
      rule: { kind: 'once', at: '2026-08-15T00:03:00.000Z' }, timeZone: 'UTC', enabled: false,
    }, 'user:one')
    await core.create({
      name: 'Later task', actionId: 'action:brief',
      rule: { kind: 'once', at: '2026-08-15T00:02:00.000Z' }, timeZone: 'UTC', enabled: true,
    }, 'user:one')
    await core.create({
      name: 'Next task', actionId: 'action:brief',
      rule: { kind: 'once', at: '2026-08-15T00:01:00.000Z' }, timeZone: 'UTC', enabled: true,
    }, 'user:one')

    expect(core.listDefinitions().map(definition => definition.name)).toEqual([
      'Next task', 'Later task', 'Paused task',
    ])
  })

  it('collapses downtime to the latest missed occurrence and forbids overlap', async () => {
    const store = tables()
    const now = clock('2026-08-15T00:00:00.000Z')
    const executor = vi.fn(async () => ({ status: 'accepted' as const, message: 'Accepted' }))
    const core = new PaimindSchedulerCore(store, {
      callbackUrl: 'https://platform.example.test/callback', clock: now,
    })
    await core.registerAction(action(), executor)
    await core.create({
      name: 'Daily brief', actionId: 'action:brief', rule: { kind: 'daily', time: '09:00' },
      timeZone: 'Asia/Shanghai', enabled: true,
    }, 'user:one')
    now.set('2026-08-19T04:00:00.000Z')
    await core.tick()
    await vi.waitFor(() => { expect(core.listRuns()[0]?.status).toBe('running') })
    expect(core.listRuns()[0]?.scheduledFor).toBe('2026-08-19T01:00:00.000Z')
    now.set('2026-08-20T04:00:00.000Z')
    await core.tick()
    expect(core.listRuns()).toHaveLength(1)
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('archives definitions while retaining runs and recovers timed-out runs after restart', async () => {
    const store = tables()
    const now = clock('2026-08-15T00:00:00.000Z')
    const first = new PaimindSchedulerCore(store, {
      callbackUrl: 'https://platform.example.test/callback', clock: now, finalResultTimeoutMs: 1_000,
    })
    await first.registerAction(action(), async () => ({ status: 'accepted', message: 'Accepted' }))
    const definition = await first.create({
      name: 'One shot', actionId: 'action:brief',
      rule: { kind: 'once', at: '2026-08-15T00:00:01.000Z' },
      timeZone: 'UTC', enabled: true,
    }, 'user:one')
    now.set('2026-08-15T00:00:01.000Z')
    await first.tick()
    await vi.waitFor(() => { expect(first.listRuns()[0]?.status).toBe('running') })
    first.stop()
    now.set('2026-08-15T00:00:03.000Z')
    const restarted = new PaimindSchedulerCore(store, {
      callbackUrl: 'https://platform.example.test/callback', clock: now, finalResultTimeoutMs: 1_000,
    })
    await restarted.start()
    expect(restarted.listRuns()[0]).toMatchObject({
      status: 'failed', message: 'Execution timed out before a final result was reported',
    })
    const current = restarted.listDefinitions()[0]!
    const archived = await restarted.archive(definition.scheduleId, current.version, 'user:one')
    expect(archived.ok).toBe(true)
    expect(restarted.listDefinitions()).toHaveLength(0)
    expect(restarted.listDefinitions({ includeArchived: true })[0]?.status).toBe('archived')
    expect(restarted.listRuns()).toHaveLength(1)
    const archivedDefinition = restarted.listDefinitions({ includeArchived: true })[0]!
    const restored = await restarted.restore(archivedDefinition.scheduleId, archivedDefinition.version, 'user:one')
    expect(restored).toMatchObject({ ok: true, value: { status: 'paused' } })
    expect(restarted.listDefinitions()[0]).not.toHaveProperty('archivedAt')
    expect([...store.audits.entries()].map(([, record]) => record.operation)).toContain('restored')
  })
})
