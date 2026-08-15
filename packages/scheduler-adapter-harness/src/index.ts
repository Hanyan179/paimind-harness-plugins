import { createHash, randomUUID } from 'node:crypto'
import type {
  PaimindScheduleActionCategory,
  PaimindScheduleActionDescriptor,
  PaimindNotificationSource,
  PaimindScheduleRunReport,
  PaimindScheduleTriggerRequest,
} from '@paimind/contracts'
import {
  PaimindHostService,
  createPaimindScheduledHarnessAgent,
  createPaimindHarnessScheduledMessage,
  readPaimindScheduledHarnessResult,
  type PaimindNativeJobRegistry,
  type PaimindScheduledHarnessAgentHandle,
  type PaimindScheduledHarnessAgentRegistry,
  type PaimindScheduledHarnessPresetRegistry,
} from '@paimind/harness-compat/host'
import type {
  PaimindScheduleExecutionReceipt,
  PaimindScheduleExecutor,
  PaimindSchedulerServiceApi,
} from '@paimind/platform-scheduler'

export const name = 'paimind-scheduler-adapter-harness'
export const PAIMIND_HARNESS_SCHEDULER_ADAPTER_ID = 'adapter:paimind-harness'

export interface PaimindHarnessScheduleActionRegistration {
  readonly actionId: string
  readonly source: PaimindNotificationSource
  readonly nameZh: string
  readonly nameEn: string
  readonly descriptionZh?: string
  readonly descriptionEn?: string
  readonly category?: PaimindScheduleActionCategory
  readonly prompt: string
  readonly cwd?: string
  readonly agentPreset?: string
  readonly provider?: string
  readonly model?: string
}

export interface PaimindHarnessScheduleAdapter {
  registerAction(input: PaimindHarnessScheduleActionRegistration): Promise<() => void>
}

export interface PaimindHarnessScheduleAdapterContext {
  readonly paimindScheduler: PaimindSchedulerServiceApi
  readonly agents: PaimindScheduledHarnessAgentRegistry
  readonly agentPresets: PaimindScheduledHarnessPresetRegistry
  readonly jobs: PaimindNativeJobRegistry
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

function sessionIdForRun(runId: string): string {
  const digest = createHash('sha256').update(runId).digest('hex').slice(0, 24)
  return `paimind-scheduled-${digest}`
}

function scheduledPrompt(input: PaimindHarnessScheduleActionRegistration, request: PaimindScheduleTriggerRequest): string {
  const prompt = input.prompt.trim()
  if (prompt === '' || prompt.length > 16_000) throw new Error('invalid Harness scheduled action prompt')
  return [
    `定时任务 · ${input.nameZh}`,
    '',
    prompt,
    '',
    `Scheduled run: ${request.runId}`,
    `Scheduled for: ${request.scheduledFor}`,
    'Complete the requested action in this independent Session.',
    'If a human decision is required, include exactly "PAIMIND_STATUS: NEEDS_ATTENTION" in the final response.',
    'Otherwise include exactly "PAIMIND_STATUS: SUCCEEDED" in the final response.',
  ].join('\n')
}

/** Each invocation owns one new Harness Session and one Native Job. */
export class PaimindHarnessScheduleAdapterService
  extends PaimindHostService
  implements PaimindHarnessScheduleAdapter {
  static inject = ['paimindScheduler', 'agents', 'agentPresets', 'jobs']
  private readonly handles = new Map<string, PaimindScheduledHarnessAgentHandle>()

  constructor(private readonly adapterCtx: PaimindHarnessScheduleAdapterContext) {
    super(adapterCtx, 'paimindHarnessScheduleAdapter')
    adapterCtx.effect(() => async () => {
      const handles = [...this.handles.values()]
      this.handles.clear()
      await Promise.allSettled(handles.map(async handle => { await handle.dispose() }))
    }, 'paimind-scheduler-adapter-harness: sessions')
  }

  async registerAction(input: PaimindHarnessScheduleActionRegistration): Promise<() => void> {
    if ((input.provider === undefined) !== (input.model === undefined)) {
      throw new Error('Harness scheduled action must register provider and model together')
    }
    const descriptor: PaimindScheduleActionDescriptor = {
      actionId: input.actionId,
      source: input.source,
      nameZh: input.nameZh,
      nameEn: input.nameEn,
      ...(input.descriptionZh === undefined ? {} : { descriptionZh: input.descriptionZh }),
      ...(input.descriptionEn === undefined ? {} : { descriptionEn: input.descriptionEn }),
      category: input.category ?? 'ai',
      adapterId: PAIMIND_HARNESS_SCHEDULER_ADAPTER_ID,
      enabled: true,
      version: randomUUID(),
    }
    const executor: PaimindScheduleExecutor = async (request, signal) => await this.execute(input, request, signal)
    return await this.adapterCtx.paimindScheduler.registerAction(descriptor, executor)
  }

  private async execute(
    input: PaimindHarnessScheduleActionRegistration,
    request: Readonly<PaimindScheduleTriggerRequest>,
    signal: AbortSignal,
  ): Promise<Readonly<PaimindScheduleExecutionReceipt>> {
    const sessionId = sessionIdForRun(request.runId)
    if (this.handles.has(sessionId)) throw new Error('Harness Session already exists for this run')
    const handle = await createPaimindScheduledHarnessAgent(
      this.adapterCtx.agents,
      this.adapterCtx.agentPresets,
      {
        sessionId,
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(input.agentPreset === undefined ? {} : { agentPreset: input.agentPreset }),
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.model === undefined ? {} : { model: input.model }),
        signal,
      },
    )
    this.handles.set(sessionId, handle)
    let cancelled = false
    const abort = (): void => {
      cancelled = true
      this.handles.delete(sessionId)
      void handle.dispose()
    }
    signal.addEventListener('abort', abort, { once: true })
    let done: Promise<{ readonly status: 'completed' | 'killed' | 'failed'; readonly detail?: string; readonly output?: string }>
    try {
      done = (async () => {
        try {
          handle.agent.followup(createPaimindHarnessScheduledMessage(scheduledPrompt(input, request)))
          await handle.agent.whenIdle()
          if (cancelled) return { status: 'killed' as const, detail: 'scheduler dispatch aborted' }
          const result = readPaimindScheduledHarnessResult(handle.agent)
          return result.status === 'failed'
            ? { status: 'failed' as const, detail: result.message, output: result.message }
            : { status: 'completed' as const, detail: result.message, output: result.message }
        } catch (error) {
          return {
            status: 'failed' as const,
            detail: error instanceof Error ? error.message : String(error),
          }
        }
      })()
      this.adapterCtx.jobs.start({
        kind: 'paimind-schedule',
        label: `Scheduled action · ${input.nameEn}`,
        owner: handle.agent,
        run: () => ({ cancel: abort, done }),
      })
    } catch (error) {
      signal.removeEventListener('abort', abort)
      this.handles.delete(sessionId)
      await handle.dispose()
      throw error
    }
    void done.then(async outcome => {
      signal.removeEventListener('abort', abort)
      const result = readPaimindScheduledHarnessResult(handle.agent)
      const status = outcome.status === 'failed' || outcome.status === 'killed' ? 'failed' : result.status
      const report: PaimindScheduleRunReport = Object.freeze({
        contractVersion: '1.0',
        runId: request.runId,
        status,
        message: outcome.detail ?? result.message,
        action: { kind: 'session' as const, label: '打开对话', sessionId },
      })
      await this.adapterCtx.paimindScheduler.reportRun(report)
    }).catch(error => {
      console.warn('[paimind-scheduler-adapter-harness] final report failed', error)
    })
    return Object.freeze({ status: 'accepted', message: 'Harness Session started' })
  }
}

export default PaimindHarnessScheduleAdapterService
