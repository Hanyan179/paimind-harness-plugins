import { createHash, randomUUID } from 'node:crypto'
import {
  definePaimindScheduleActionDescriptor,
  definePaimindScheduleDefinition,
  definePaimindScheduleRun,
  definePaimindScheduleRunReport,
  type PaimindScheduleActionDescriptor,
  type PaimindScheduleActionInput,
  type PaimindScheduleAuditRecord,
  type PaimindScheduleCreateInput,
  type PaimindScheduleDefinition,
  type PaimindScheduleRun,
  type PaimindScheduleRunReport,
  type PaimindScheduleTriggerRequest,
  type PaimindScheduleUpdateInput,
} from '@paimind/contracts'
import { latestDueScheduleOccurrence, nextScheduleOccurrence } from './time.js'

export interface PaimindSchedulerTable<Value> {
  get(key: string): Value | undefined
  entries(): IterableIterator<[string, Value]>
  put(key: string, value: Value): Promise<void>
  delete(key: string): Promise<boolean>
}

export interface PaimindSchedulerTables {
  readonly actions: PaimindSchedulerTable<PaimindScheduleActionDescriptor>
  readonly definitions: PaimindSchedulerTable<PaimindScheduleDefinition>
  readonly runs: PaimindSchedulerTable<PaimindScheduleRun>
  readonly audits: PaimindSchedulerTable<PaimindScheduleAuditRecord>
}

export interface PaimindScheduleExecutionAccepted {
  readonly status: 'accepted'
  readonly message?: string
}

export type PaimindScheduleExecutionReceipt = PaimindScheduleExecutionAccepted | PaimindScheduleRunReport
export type PaimindScheduleExecutor = (
  request: Readonly<PaimindScheduleTriggerRequest>,
  signal: AbortSignal,
) => Promise<Readonly<PaimindScheduleExecutionReceipt>>

export type PaimindScheduleActionInputValidator = (
  input: PaimindScheduleActionInput | undefined,
) => PaimindScheduleActionInput | undefined

export interface PaimindScheduleActionRegistrationOptions {
  readonly validateActionInput?: PaimindScheduleActionInputValidator
}

export interface PaimindScheduleDispatchErrorOptions {
  readonly retryable?: boolean
  readonly code?: string
  readonly cause?: unknown
}

/** Lets provider Adapters distinguish transient delivery failures from invalid local configuration. */
export class PaimindScheduleDispatchError extends Error {
  readonly retryable: boolean
  readonly code?: string
  override readonly cause?: unknown

  constructor(message: string, options: PaimindScheduleDispatchErrorOptions = {}) {
    super(message)
    this.name = 'PaimindScheduleDispatchError'
    this.retryable = options.retryable ?? true
    if (options.code !== undefined) this.code = options.code
    if (options.cause !== undefined) this.cause = options.cause
  }
}

export interface PaimindSchedulerClock {
  now(): number
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
  delay(delayMs: number): Promise<void>
}

export interface PaimindSchedulerOptions {
  readonly callbackUrl: string
  readonly maxDispatchAttempts?: number
  readonly dispatchTimeoutMs?: number
  readonly finalResultTimeoutMs?: number
  readonly retryDelayMs?: number
  readonly clock?: PaimindSchedulerClock
}

export type PaimindScheduleMutationResult =
  | { readonly ok: true; readonly value: Readonly<PaimindScheduleDefinition> }
  | { readonly ok: false; readonly code: 'not-found' | 'version-conflict' | 'action-unavailable' | 'invalid-input' | 'no-future-occurrence'; readonly message: string }

export type PaimindScheduleRunNowResult =
  | { readonly ok: true; readonly value: Readonly<PaimindScheduleRun> }
  | { readonly ok: false; readonly code: 'not-found' | 'action-unavailable' | 'run-active'; readonly message: string }

const defaultClock: PaimindSchedulerClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: timer => clearTimeout(timer),
  delay: async delayMs => await new Promise(resolve => setTimeout(resolve, delayMs)),
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString()
}

function deterministicRunIdentity(scheduleId: string, scheduledFor: string): {
  readonly runId: string
  readonly idempotencyKey: string
} {
  const digest = createHash('sha256').update(scheduleId).update('\0').update(scheduledFor).digest('hex')
  return { runId: `run:${digest.slice(0, 32)}`, idempotencyKey: `schedule:${digest}` }
}

function sortedValues<Value>(table: PaimindSchedulerTable<Value>): Value[] {
  return [...table.entries()].map(([, value]) => value)
}

/** Single-node durable Scheduler Core. It contains no Harness or provider-specific branch. */
export class PaimindSchedulerCore {
  private readonly clock: PaimindSchedulerClock
  private readonly executors = new Map<string, PaimindScheduleExecutor>()
  private readonly inputValidators = new Map<string, PaimindScheduleActionInputValidator>()
  private readonly maxDispatchAttempts: number
  private readonly dispatchTimeoutMs: number
  private readonly finalResultTimeoutMs: number
  private readonly retryDelayMs: number
  private mutationTail: Promise<void> = Promise.resolve()
  private wakeTimer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  constructor(
    private readonly tables: PaimindSchedulerTables,
    private readonly options: PaimindSchedulerOptions,
  ) {
    this.clock = options.clock ?? defaultClock
    this.maxDispatchAttempts = options.maxDispatchAttempts ?? 3
    this.dispatchTimeoutMs = options.dispatchTimeoutMs ?? 10_000
    this.finalResultTimeoutMs = options.finalResultTimeoutMs ?? 86_400_000
    this.retryDelayMs = options.retryDelayMs ?? 1_000
    if (this.maxDispatchAttempts < 1 || !Number.isSafeInteger(this.maxDispatchAttempts)) {
      throw new Error('maxDispatchAttempts must be a positive integer')
    }
    new URL(options.callbackUrl)
  }

  async start(): Promise<void> {
    this.stopped = false
    await this.recoverRunningTimeouts()
    await this.tick()
  }

  stop(): void {
    this.stopped = true
    if (this.wakeTimer !== undefined) this.clock.clearTimeout(this.wakeTimer)
    this.wakeTimer = undefined
  }

  async registerAction(
    descriptor: PaimindScheduleActionDescriptor,
    executor: PaimindScheduleExecutor,
    options: PaimindScheduleActionRegistrationOptions = {},
  ): Promise<() => void> {
    const trusted = definePaimindScheduleActionDescriptor(descriptor)
    await this.enqueue(async () => { await this.tables.actions.put(trusted.actionId, trusted) })
    this.executors.set(trusted.actionId, executor)
    if (options.validateActionInput !== undefined) {
      this.inputValidators.set(trusted.actionId, options.validateActionInput)
    } else {
      this.inputValidators.delete(trusted.actionId)
    }
    this.armWakeTimer()
    return () => {
      if (this.executors.get(trusted.actionId) === executor) {
        this.executors.delete(trusted.actionId)
        this.inputValidators.delete(trusted.actionId)
        this.armWakeTimer()
      }
    }
  }

  async deactivateAction(actionId: string): Promise<boolean> {
    return await this.enqueue(async () => {
      const current = this.tables.actions.get(actionId)
      if (current === undefined) return false
      const next = definePaimindScheduleActionDescriptor({ ...current, enabled: false, version: randomUUID() })
      await this.tables.actions.put(actionId, next)
      this.executors.delete(actionId)
      this.inputValidators.delete(actionId)
      this.armWakeTimer()
      return true
    })
  }

  listActions(): readonly Readonly<PaimindScheduleActionDescriptor>[] {
    return Object.freeze(sortedValues(this.tables.actions)
      .map(definePaimindScheduleActionDescriptor)
      .map(action => action.enabled && !this.executors.has(action.actionId)
        ? definePaimindScheduleActionDescriptor({ ...action, enabled: false })
        : action)
      .sort((left, right) => Number(right.enabled) - Number(left.enabled)
        || left.nameZh.localeCompare(right.nameZh)
        || left.actionId.localeCompare(right.actionId)))
  }

  listDefinitions(options?: { readonly includeArchived?: boolean }): readonly Readonly<PaimindScheduleDefinition>[] {
    return Object.freeze(sortedValues(this.tables.definitions)
      .map(definePaimindScheduleDefinition)
      .filter(value => options?.includeArchived === true || value.status !== 'archived')
      .sort((left, right) => {
        const leftUpcoming = left.status === 'enabled' && left.nextRunAt !== undefined
        const rightUpcoming = right.status === 'enabled' && right.nextRunAt !== undefined
        if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1
        if (leftUpcoming && rightUpcoming) {
          const byNextRun = left.nextRunAt!.localeCompare(right.nextRunAt!)
          if (byNextRun !== 0) return byNextRun
        }
        return right.updatedAt.localeCompare(left.updatedAt) || left.scheduleId.localeCompare(right.scheduleId)
      }))
  }

  listRuns(scheduleId?: string): readonly Readonly<PaimindScheduleRun>[] {
    return Object.freeze(sortedValues(this.tables.runs)
      .map(definePaimindScheduleRun)
      .filter(value => scheduleId === undefined || value.scheduleId === scheduleId)
      .sort((left, right) => right.scheduledFor.localeCompare(left.scheduledFor) || left.runId.localeCompare(right.runId)))
  }

  async create(input: PaimindScheduleCreateInput, actorId: string): Promise<Readonly<PaimindScheduleDefinition>> {
    return await this.enqueue(async () => {
      const action = this.tables.actions.get(input.actionId)
      if (action === undefined || !action.enabled || !this.executors.has(input.actionId)) {
        throw new Error('schedule action is unavailable')
      }
      const actionInput = this.validateActionInput(input.actionId, input.actionInput)
      const now = iso(this.clock.now())
      const nextRunAt = input.enabled ? nextScheduleOccurrence(input.rule, input.timeZone, now) : undefined
      if (input.enabled && nextRunAt === undefined) {
        throw new Error('Execution time has passed. Choose a future time before enabling the schedule.')
      }
      const scheduleId = `schedule:${randomUUID()}`
      const definition = definePaimindScheduleDefinition({
        scheduleId,
        name: input.name,
        actionId: input.actionId,
        ...(actionInput === undefined ? {} : { actionInput }),
        ...(input.sourceSessionId === undefined ? {} : { sourceSessionId: input.sourceSessionId }),
        rule: input.rule,
        timeZone: input.timeZone,
        status: input.enabled ? 'enabled' : 'paused',
        ...(nextRunAt === undefined ? {} : { nextRunAt }),
        createdAt: now,
        updatedAt: now,
        version: randomUUID(),
      })
      await this.tables.definitions.put(scheduleId, definition)
      await this.audit(definition, actorId, 'created', now)
      this.armWakeTimer()
      return definition
    })
  }

  async update(input: PaimindScheduleUpdateInput, actorId: string): Promise<PaimindScheduleMutationResult> {
    return await this.enqueue(async () => {
      const current = this.tables.definitions.get(input.scheduleId)
      if (current === undefined || current.status === 'archived') {
        return { ok: false, code: 'not-found', message: 'Schedule not found' }
      }
      if (current.version !== input.ifVersion) {
        return { ok: false, code: 'version-conflict', message: 'Schedule was changed by another user' }
      }
      const action = this.tables.actions.get(input.actionId)
      if (action === undefined || !action.enabled || !this.executors.has(input.actionId)) {
        return { ok: false, code: 'action-unavailable', message: 'Action is unavailable' }
      }
      let actionInput: PaimindScheduleActionInput | undefined
      try {
        actionInput = this.validateActionInput(input.actionId, input.actionInput)
      } catch (error) {
        return { ok: false, code: 'invalid-input', message: error instanceof Error ? error.message : String(error) }
      }
      const now = iso(this.clock.now())
      const nextRunAt = input.enabled ? nextScheduleOccurrence(input.rule, input.timeZone, now) : undefined
      if (input.enabled && nextRunAt === undefined) {
        return {
          ok: false,
          code: 'no-future-occurrence',
          message: 'Execution time has passed. Edit the task and choose a future time.',
        }
      }
      const {
        nextRunAt: _previousNextRunAt,
        actionInput: _previousActionInput,
        sourceSessionId: _previousSourceSessionId,
        ...currentWithoutNextRunAt
      } = current
      const next = definePaimindScheduleDefinition({
        ...currentWithoutNextRunAt,
        name: input.name,
        actionId: input.actionId,
        ...(actionInput === undefined ? {} : { actionInput }),
        ...(input.sourceSessionId === undefined ? {} : { sourceSessionId: input.sourceSessionId }),
        rule: input.rule,
        timeZone: input.timeZone,
        status: input.enabled ? 'enabled' : 'paused',
        ...(nextRunAt === undefined ? {} : { nextRunAt }),
        updatedAt: now,
        version: randomUUID(),
      })
      await this.tables.definitions.put(next.scheduleId, next)
      await this.audit(next, actorId, input.enabled ? 'updated' : 'paused', now)
      this.armWakeTimer()
      return { ok: true, value: next }
    })
  }

  async setEnabled(
    scheduleId: string,
    enabled: boolean,
    ifVersion: string,
    actorId: string,
  ): Promise<PaimindScheduleMutationResult> {
    const current = this.tables.definitions.get(scheduleId)
    if (current === undefined) return { ok: false, code: 'not-found', message: 'Schedule not found' }
    return await this.update({
      scheduleId,
      ifVersion,
      name: current.name,
      actionId: current.actionId,
      rule: current.rule,
      timeZone: current.timeZone,
      enabled,
      ...(current.actionInput === undefined ? {} : { actionInput: current.actionInput }),
      ...(current.sourceSessionId === undefined ? {} : { sourceSessionId: current.sourceSessionId }),
    }, actorId)
  }

  /** Execute the registered action now without changing status, rule or nextRunAt. */
  async runNow(scheduleId: string, actorId: string): Promise<PaimindScheduleRunNowResult> {
    const result = await this.enqueue(async (): Promise<PaimindScheduleRunNowResult> => {
      const definition = this.tables.definitions.get(scheduleId)
      if (definition === undefined || definition.status === 'archived') {
        return { ok: false, code: 'not-found', message: 'Schedule not found' }
      }
      const action = this.tables.actions.get(definition.actionId)
      const executor = this.executors.get(definition.actionId)
      if (action === undefined || !action.enabled || executor === undefined) {
        return { ok: false, code: 'action-unavailable', message: 'Action is unavailable' }
      }
      const active = sortedValues(this.tables.runs).some(run =>
        run.scheduleId === scheduleId && (run.status === 'queued' || run.status === 'running'))
      if (active) {
        return { ok: false, code: 'run-active', message: 'A run is already active for this task' }
      }
      const now = iso(this.clock.now())
      const nonce = randomUUID()
      const run = definePaimindScheduleRun({
        runId: `run:${nonce}`,
        idempotencyKey: `test:${scheduleId}:${nonce}`,
        scheduleId,
        actionId: definition.actionId,
        trigger: 'manual',
        scheduledFor: now,
        status: 'queued',
        attempt: 0,
        createdAt: now,
        version: randomUUID(),
      })
      await this.tables.runs.put(run.runId, run)
      await this.audit(definition, actorId, 'manual_dispatched', now)
      return { ok: true, value: run }
    })
    if (result.ok) void this.dispatch(result.value)
    return result
  }

  async archive(scheduleId: string, ifVersion: string, actorId: string): Promise<PaimindScheduleMutationResult> {
    return await this.enqueue(async () => {
      const current = this.tables.definitions.get(scheduleId)
      if (current === undefined || current.status === 'archived') {
        return { ok: false, code: 'not-found', message: 'Schedule not found' }
      }
      if (current.version !== ifVersion) {
        return { ok: false, code: 'version-conflict', message: 'Schedule was changed by another user' }
      }
      const now = iso(this.clock.now())
      const { nextRunAt: _nextRunAt, ...currentWithoutNextRunAt } = current
      const next = definePaimindScheduleDefinition({
        ...currentWithoutNextRunAt,
        status: 'archived',
        archivedAt: now,
        updatedAt: now,
        version: randomUUID(),
      })
      await this.tables.definitions.put(scheduleId, next)
      await this.audit(next, actorId, 'archived', now)
      this.armWakeTimer()
      return { ok: true, value: next }
    })
  }

  /** Restore an archived definition as paused so recovery never triggers an unexpected run. */
  async restore(scheduleId: string, ifVersion: string, actorId: string): Promise<PaimindScheduleMutationResult> {
    return await this.enqueue(async () => {
      const current = this.tables.definitions.get(scheduleId)
      if (current === undefined || current.status !== 'archived') {
        return { ok: false, code: 'not-found', message: 'Archived schedule not found' }
      }
      if (current.version !== ifVersion) {
        return { ok: false, code: 'version-conflict', message: 'Schedule was changed by another user' }
      }
      const now = iso(this.clock.now())
      const { archivedAt: _archivedAt, nextRunAt: _nextRunAt, ...currentWithoutArchive } = current
      const next = definePaimindScheduleDefinition({
        ...currentWithoutArchive,
        status: 'paused',
        updatedAt: now,
        version: randomUUID(),
      })
      await this.tables.definitions.put(scheduleId, next)
      await this.audit(next, actorId, 'restored', now)
      this.armWakeTimer()
      return { ok: true, value: next }
    })
  }

  async report(input: PaimindScheduleRunReport): Promise<Readonly<PaimindScheduleRun>> {
    const report = definePaimindScheduleRunReport(input)
    return await this.enqueue(async () => {
      const current = this.tables.runs.get(report.runId)
      if (current === undefined) throw new Error('schedule run not found')
      const currentFinal = ['succeeded', 'failed', 'needs_attention'].includes(current.status)
      if (currentFinal) {
        if (current.status === report.status && current.message === report.message) return definePaimindScheduleRun(current)
        throw new Error('schedule run is already final')
      }
      if (current.status !== 'running') throw new Error('schedule run has not started')
      const final = report.status !== 'running'
      const now = iso(this.clock.now())
      const {
        message: _message, progress: _progress, action: _action,
        finishedAt: _finishedAt, ...currentWithoutResult
      } = current
      const message = report.message ?? current.message
      const action = report.action ?? current.action
      const next = definePaimindScheduleRun({
        ...currentWithoutResult,
        status: report.status,
        ...(message === undefined ? {} : { message }),
        ...(!final && report.progress !== undefined ? { progress: report.progress } : {}),
        ...(action === undefined ? {} : { action }),
        ...(final ? { finishedAt: now } : {}),
        version: randomUUID(),
      })
      await this.tables.runs.put(next.runId, next)
      return next
    })
  }

  async tick(at = this.clock.now()): Promise<void> {
    const dispatch: PaimindScheduleRun[] = []
    await this.enqueue(async () => {
      const now = iso(at)
      const definitions = sortedValues(this.tables.definitions)
      for (const current of definitions) {
        if (current.status !== 'enabled' || current.nextRunAt === undefined || current.nextRunAt > now) continue
        const action = this.tables.actions.get(current.actionId)
        if (action === undefined || !action.enabled || !this.executors.has(current.actionId)) continue
        const active = sortedValues(this.tables.runs).some(run =>
          run.scheduleId === current.scheduleId && (run.status === 'queued' || run.status === 'running'))
        const scheduledFor = latestDueScheduleOccurrence(current.rule, current.timeZone, current.nextRunAt, now)
        const following = nextScheduleOccurrence(current.rule, current.timeZone, now)
        const { nextRunAt: _nextRunAt, ...currentWithoutNextRunAt } = current
        const nextDefinition = definePaimindScheduleDefinition({
          ...currentWithoutNextRunAt,
          status: following === undefined ? 'paused' : 'enabled',
          ...(following === undefined ? {} : { nextRunAt: following }),
          updatedAt: now,
          version: randomUUID(),
        })
        await this.tables.definitions.put(current.scheduleId, nextDefinition)
        if (active) continue
        const identity = deterministicRunIdentity(current.scheduleId, scheduledFor)
        const existing = this.tables.runs.get(identity.runId)
        if (existing !== undefined) continue
        const run = definePaimindScheduleRun({
          ...identity,
          scheduleId: current.scheduleId,
          actionId: current.actionId,
          trigger: 'schedule',
          scheduledFor,
          status: 'queued',
          attempt: 0,
          createdAt: now,
          version: randomUUID(),
        })
        await this.tables.runs.put(run.runId, run)
        await this.audit(nextDefinition, 'paimind.scheduler', 'dispatched', now)
        dispatch.push(run)
      }
      this.armWakeTimer()
    })
    for (const run of dispatch) void this.dispatch(run)
  }

  private async dispatch(initial: PaimindScheduleRun): Promise<void> {
    let lastError = 'Action dispatch failed'
    let attemptsUsed = 0
    for (let attempt = 1; attempt <= this.maxDispatchAttempts; attempt += 1) {
      attemptsUsed = attempt
      const executor = this.executors.get(initial.actionId)
      const action = this.tables.actions.get(initial.actionId)
      if (executor === undefined || action === undefined || !action.enabled) {
        lastError = 'Execution action is unavailable'
        break
      }
      const started = await this.enqueue(async () => {
        const current = this.tables.runs.get(initial.runId)
        if (current === undefined || !['queued', 'running'].includes(current.status)) return undefined
        const now = iso(this.clock.now())
        const { progress: _progress, ...currentWithoutProgress } = current
        const next = definePaimindScheduleRun({
          ...currentWithoutProgress,
          status: 'running',
          attempt,
          startedAt: current.startedAt ?? now,
          message: attempt === 1 ? 'Action accepted for dispatch' : `Retrying dispatch (${attempt}/${this.maxDispatchAttempts})`,
          version: randomUUID(),
        })
        await this.tables.runs.put(next.runId, next)
        return next
      })
      if (started === undefined) return
      const controller = new AbortController()
      const timeout = this.clock.setTimeout(() => controller.abort(), this.dispatchTimeoutMs)
      try {
        const definition = this.tables.definitions.get(started.scheduleId)
        if (definition === undefined) throw new Error('Schedule definition is unavailable')
        const receipt = await executor(Object.freeze({
          contractVersion: '1.0',
          runId: started.runId,
          scheduleId: started.scheduleId,
          scheduleName: definition.name,
          actionId: started.actionId,
          ...(definition.actionInput === undefined ? {} : { actionInput: definition.actionInput }),
          ...(definition.sourceSessionId === undefined ? {} : { sourceSessionId: definition.sourceSessionId }),
          trigger: started.trigger,
          scheduledFor: started.scheduledFor,
          idempotencyKey: started.idempotencyKey,
          callbackUrl: this.options.callbackUrl,
        }), controller.signal)
        this.clock.clearTimeout(timeout)
        if (receipt.status === 'accepted') {
          if (receipt.message !== undefined) {
            await this.report({ contractVersion: '1.0', runId: started.runId, status: 'running', message: receipt.message })
          }
          this.armRunTimeout(started.runId)
        } else {
          await this.report(receipt)
        }
        return
      } catch (error) {
        this.clock.clearTimeout(timeout)
        lastError = error instanceof Error ? error.message : String(error)
        if (error instanceof PaimindScheduleDispatchError && !error.retryable) break
        if (attempt < this.maxDispatchAttempts) await this.clock.delay(this.retryDelayMs * attempt)
      }
    }
    await this.failRun(initial.runId, `Dispatch failed after ${attemptsUsed} attempt(s): ${lastError}`)
  }

  private armRunTimeout(runId: string): void {
    this.clock.setTimeout(() => { void this.timeoutRun(runId) }, this.finalResultTimeoutMs)
  }

  private async recoverRunningTimeouts(): Promise<void> {
    const now = this.clock.now()
    for (const run of sortedValues(this.tables.runs)) {
      if (run.status !== 'running' || run.startedAt === undefined) continue
      const remaining = Date.parse(run.startedAt) + this.finalResultTimeoutMs - now
      if (remaining <= 0) await this.timeoutRun(run.runId)
      else this.clock.setTimeout(() => { void this.timeoutRun(run.runId) }, remaining)
    }
  }

  private async timeoutRun(runId: string): Promise<void> {
    await this.enqueue(async () => {
      const current = this.tables.runs.get(runId)
      if (current === undefined || current.status !== 'running') return
      const { progress: _progress, finishedAt: _finishedAt, ...currentWithoutFinal } = current
      const next = definePaimindScheduleRun({
        ...currentWithoutFinal,
        status: 'failed',
        message: 'Execution timed out before a final result was reported',
        finishedAt: iso(this.clock.now()),
        version: randomUUID(),
      })
      await this.tables.runs.put(runId, next)
    })
  }

  private async failRun(runId: string, message: string): Promise<void> {
    await this.enqueue(async () => {
      const current = this.tables.runs.get(runId)
      if (current === undefined || ['succeeded', 'failed', 'needs_attention'].includes(current.status)) return
      const { progress: _progress, finishedAt: _finishedAt, ...currentWithoutFinal } = current
      const next = definePaimindScheduleRun({
        ...currentWithoutFinal,
        status: 'failed',
        message,
        finishedAt: iso(this.clock.now()),
        version: randomUUID(),
      })
      await this.tables.runs.put(runId, next)
    })
  }

  private armWakeTimer(): void {
    if (this.stopped) return
    if (this.wakeTimer !== undefined) this.clock.clearTimeout(this.wakeTimer)
    const next = sortedValues(this.tables.definitions)
      .filter(definition => {
        if (definition.status !== 'enabled' || definition.nextRunAt === undefined) return false
        const action = this.tables.actions.get(definition.actionId)
        return action?.enabled === true && this.executors.has(definition.actionId)
      })
      .map(definition => Date.parse(definition.nextRunAt!))
      .sort((left, right) => left - right)[0]
    if (next === undefined) { this.wakeTimer = undefined; return }
    const delay = Math.max(0, Math.min(next - this.clock.now(), 2_147_483_647))
    this.wakeTimer = this.clock.setTimeout(() => { void this.tick() }, delay)
  }

  private async audit(
    definition: PaimindScheduleDefinition,
    actorId: string,
    operation: PaimindScheduleAuditRecord['operation'],
    occurredAt: string,
  ): Promise<void> {
    const record: PaimindScheduleAuditRecord = Object.freeze({
      auditId: `audit:${randomUUID()}`,
      scheduleId: definition.scheduleId,
      actorId,
      operation,
      occurredAt,
      version: randomUUID(),
    })
    await this.tables.audits.put(record.auditId, record)
  }

  private validateActionInput(
    actionId: string,
    input: PaimindScheduleActionInput | undefined,
  ): PaimindScheduleActionInput | undefined {
    const validator = this.inputValidators.get(actionId)
    if (validator !== undefined) return validator(input)
    if (input !== undefined) throw new Error('Selected action does not accept per-task business input')
    return undefined
  }

  private async enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const prior = this.mutationTail
    let release = (): void => {}
    this.mutationTail = new Promise<void>(resolve => { release = resolve })
    await prior
    try { return await operation() } finally { release() }
  }
}
