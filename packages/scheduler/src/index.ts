import {
  type PaimindScheduleActionDescriptor,
  type PaimindScheduleAuditRecord,
  type PaimindScheduleCreateInput,
  type PaimindScheduleDefinition,
  type PaimindScheduleRun,
  type PaimindScheduleRunReport,
  type PaimindScheduleUpdateInput,
} from '@paimind/contracts'
import {
  PaimindHostRemoteService,
  definePaimindStorageDomain,
  markPaimindHostRemoteMethods,
  paimindDomainTable,
  type PaimindStorageDomainFacility,
  type PaimindStorageDomainHandle,
  type PaimindStorageTable,
} from '@paimind/harness-compat/host'
import {
  PaimindSchedulerCore,
  type PaimindScheduleExecutor,
  type PaimindScheduleActionRegistrationOptions,
  type PaimindScheduleMutationResult,
  type PaimindScheduleRunNowResult,
  type PaimindSchedulerOptions,
  type PaimindSchedulerTables,
} from './core.js'
import {
  schedulerActionSchema,
  schedulerAuditSchema,
  schedulerDefinitionSchema,
  schedulerRunSchema,
} from './schemas.js'

export * from './core.js'
export * from './schemas.js'
export * from './time.js'

export const name = 'paimind-platform-scheduler'
export const PAIMIND_SCHEDULER_DOMAIN = 'paimind_scheduler'
export const PAIMIND_SCHEDULER_SCHEMA_VERSION = 2

export const schedulerDomainSpec = definePaimindStorageDomain({
  name: PAIMIND_SCHEDULER_DOMAIN,
  version: PAIMIND_SCHEDULER_SCHEMA_VERSION,
  tables: {
    actions: paimindDomainTable(schedulerActionSchema),
    definitions: paimindDomainTable(schedulerDefinitionSchema),
    runs: paimindDomainTable(schedulerRunSchema),
    audits: paimindDomainTable(schedulerAuditSchema),
  },
})

export interface PaimindSchedulerSnapshot {
  readonly actions: readonly Readonly<PaimindScheduleActionDescriptor>[]
  readonly definitions: readonly Readonly<PaimindScheduleDefinition>[]
  readonly runs: readonly Readonly<PaimindScheduleRun>[]
}

export interface PaimindScheduleSetEnabledRequest {
  readonly scheduleId: string
  readonly enabled: boolean
  readonly ifVersion: string
}

export interface PaimindScheduleArchiveRequest {
  readonly scheduleId: string
  readonly ifVersion: string
}

export type PaimindScheduleRestoreRequest = PaimindScheduleArchiveRequest

export interface PaimindScheduleRunNowRequest {
  readonly scheduleId: string
}

export interface PaimindSchedulerServiceApi {
  registerAction(
    descriptor: PaimindScheduleActionDescriptor,
    executor: PaimindScheduleExecutor,
    options?: PaimindScheduleActionRegistrationOptions,
  ): Promise<() => void>
  deactivateAction(actionId: string): Promise<boolean>
  reportRun(report: PaimindScheduleRunReport): Promise<Readonly<PaimindScheduleRun>>
  list(): Promise<PaimindSchedulerSnapshot>
  create(input: PaimindScheduleCreateInput): Promise<Readonly<PaimindScheduleDefinition>>
  update(input: PaimindScheduleUpdateInput): Promise<PaimindScheduleMutationResult>
  setEnabled(input: PaimindScheduleSetEnabledRequest): Promise<PaimindScheduleMutationResult>
  runNow(input: PaimindScheduleRunNowRequest): Promise<PaimindScheduleRunNowResult>
  archive(input: PaimindScheduleArchiveRequest): Promise<PaimindScheduleMutationResult>
  restore(input: PaimindScheduleRestoreRequest): Promise<PaimindScheduleMutationResult>
}

export interface PaimindSchedulerHostContext {
  readonly storageDomain: PaimindStorageDomainFacility
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

function schedulerTables(domain: PaimindStorageDomainHandle): PaimindSchedulerTables {
  return {
    actions: domain.table('actions') as PaimindStorageTable<PaimindScheduleActionDescriptor>,
    definitions: domain.table('definitions') as PaimindStorageTable<PaimindScheduleDefinition>,
    runs: domain.table('runs') as PaimindStorageTable<PaimindScheduleRun>,
    audits: domain.table('audits') as PaimindStorageTable<PaimindScheduleAuditRecord>,
  }
}

/** Host service for the platform scheduler. Provider execution is delegated only through registered actions. */
export class PaimindSchedulerService extends PaimindHostRemoteService implements PaimindSchedulerServiceApi {
  static inject = ['storageDomain']
  private readonly domain: Promise<PaimindStorageDomainHandle>
  private readonly core: Promise<PaimindSchedulerCore>

  constructor(ctx: PaimindSchedulerHostContext, options?: Partial<PaimindSchedulerOptions>) {
    super(ctx, 'paimindScheduler')
    markPaimindHostRemoteMethods(this, ['list', 'create', 'update', 'setEnabled', 'runNow', 'archive', 'restore'])
    this.domain = ctx.storageDomain.open(schedulerDomainSpec)
    this.core = this.domain.then(async domain => {
      const core = new PaimindSchedulerCore(schedulerTables(domain), {
        callbackUrl: options?.callbackUrl
          ?? process.env.PAIMIND_SCHEDULER_CALLBACK_URL
          ?? 'https://localhost/paimind/platform/v1/schedules/runs',
        ...(options?.maxDispatchAttempts === undefined ? {} : { maxDispatchAttempts: options.maxDispatchAttempts }),
        ...(options?.dispatchTimeoutMs === undefined ? {} : { dispatchTimeoutMs: options.dispatchTimeoutMs }),
        ...(options?.finalResultTimeoutMs === undefined ? {} : { finalResultTimeoutMs: options.finalResultTimeoutMs }),
        ...(options?.retryDelayMs === undefined ? {} : { retryDelayMs: options.retryDelayMs }),
        ...(options?.clock === undefined ? {} : { clock: options.clock }),
      })
      await core.start()
      return core
    })
    ctx.effect(() => async () => {
      const core = await this.core
      core.stop()
      await (await this.domain).close()
    }, 'paimind-scheduler: domain')
  }

  async registerAction(
    descriptor: PaimindScheduleActionDescriptor,
    executor: PaimindScheduleExecutor,
    options?: PaimindScheduleActionRegistrationOptions,
  ): Promise<() => void> {
    return await (await this.core).registerAction(descriptor, executor, options)
  }

  async deactivateAction(actionId: string): Promise<boolean> {
    return await (await this.core).deactivateAction(actionId)
  }

  async reportRun(report: PaimindScheduleRunReport): Promise<Readonly<PaimindScheduleRun>> {
    return await (await this.core).report(report)
  }

  async list(): Promise<PaimindSchedulerSnapshot> {
    const core = await this.core
    return Object.freeze({ actions: core.listActions(), definitions: core.listDefinitions({ includeArchived: true }), runs: core.listRuns() })
  }

  async create(input: PaimindScheduleCreateInput): Promise<Readonly<PaimindScheduleDefinition>> {
    return await (await this.core).create(input, 'paimind.local-user')
  }

  async update(input: PaimindScheduleUpdateInput): Promise<PaimindScheduleMutationResult> {
    return await (await this.core).update(input, 'paimind.local-user')
  }

  async setEnabled(input: PaimindScheduleSetEnabledRequest): Promise<PaimindScheduleMutationResult> {
    return await (await this.core).setEnabled(
      input.scheduleId, input.enabled, input.ifVersion, 'paimind.local-user',
    )
  }

  async runNow(input: PaimindScheduleRunNowRequest): Promise<PaimindScheduleRunNowResult> {
    return await (await this.core).runNow(input.scheduleId, 'paimind.local-user')
  }

  async archive(input: PaimindScheduleArchiveRequest): Promise<PaimindScheduleMutationResult> {
    return await (await this.core).archive(input.scheduleId, input.ifVersion, 'paimind.local-user')
  }

  async restore(input: PaimindScheduleRestoreRequest): Promise<PaimindScheduleMutationResult> {
    return await (await this.core).restore(input.scheduleId, input.ifVersion, 'paimind.local-user')
  }
}

export default PaimindSchedulerService
