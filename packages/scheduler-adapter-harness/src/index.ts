import { createHash, randomUUID } from 'node:crypto'
import type {
  PaimindScheduleActionCategory,
  PaimindScheduleActionDescriptor,
  PaimindScheduleActionInput,
  PaimindNotificationPublishInput,
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
  type PaimindHarnessDefaultModelService,
  type PaimindScheduledHarnessAgentHandle,
  type PaimindScheduledHarnessAgentRegistry,
  type PaimindScheduledHarnessPresetRegistry,
  type PaimindScheduledHarnessTitleService,
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
  readonly conversationEnabled?: boolean
  readonly usageHint?: string
  readonly category?: PaimindScheduleActionCategory
  /** Omit only for the generic definition-owned Agent prompt action. */
  readonly prompt?: string
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
  readonly agentDefaultModel: PaimindHarnessDefaultModelService
  readonly agents: PaimindScheduledHarnessAgentRegistry
  readonly agentPresets: PaimindScheduledHarnessPresetRegistry
  readonly jobs: PaimindNativeJobRegistry
  readonly sessionTitle: PaimindScheduledHarnessTitleService
  readonly paimindNotifications: {
    registerProducer(source: PaimindNotificationSource): {
      publish(input: PaimindNotificationPublishInput): Promise<unknown>
    }
  }
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

function sessionIdForRun(runId: string): string {
  const digest = createHash('sha256').update(runId).digest('hex').slice(0, 24)
  return `paimind-scheduled-${digest}`
}

interface DefinitionAgentPromptInput extends PaimindScheduleActionInput {
  readonly kind: 'agent-prompt'
  readonly version: 1
  readonly prompt: string
  readonly cwd?: string
  readonly agentPreset?: string
}

interface DefinitionWorkspaceContextInput extends PaimindScheduleActionInput {
  readonly kind: 'workspace-context'
  readonly version: 1
  readonly cwd: string
  readonly agentPreset?: string
}

function definitionWorkspaceContextInput(
  input: PaimindScheduleActionInput | undefined,
): DefinitionWorkspaceContextInput {
  if (input?.kind !== 'workspace-context' || input.version !== 1) {
    throw new Error('Workspace scheduled task requires workspace-context actionInput version 1')
  }
  const cwd = input.cwd
  const agentPreset = input.agentPreset
  if (typeof cwd !== 'string' || cwd.trim() === '' || cwd.length > 2_000) {
    throw new Error('Workspace scheduled task cwd is invalid')
  }
  if (agentPreset !== undefined && (typeof agentPreset !== 'string' || agentPreset.trim() === '' || agentPreset.length > 160)) {
    throw new Error('Workspace scheduled task Agent Preset is invalid')
  }
  return Object.freeze({
    kind: 'workspace-context', version: 1, cwd: cwd.trim(),
    ...(agentPreset === undefined ? {} : { agentPreset: agentPreset.trim() }),
  })
}

function definitionAgentPromptInput(input: PaimindScheduleActionInput | undefined): DefinitionAgentPromptInput {
  if (input?.kind !== 'agent-prompt' || input.version !== 1 || typeof input.prompt !== 'string') {
    throw new Error('Personal scheduled task requires agent-prompt actionInput version 1')
  }
  const prompt = input.prompt.trim()
  if (prompt === '' || prompt.length > 16_000) throw new Error('Personal scheduled task prompt must contain 1-16000 characters')
  const cwd = input.cwd
  const agentPreset = input.agentPreset
  if (cwd !== undefined && (typeof cwd !== 'string' || cwd.trim() === '' || cwd.length > 2_000)) {
    throw new Error('Personal scheduled task cwd is invalid')
  }
  if (agentPreset !== undefined && (typeof agentPreset !== 'string' || agentPreset.trim() === '' || agentPreset.length > 160)) {
    throw new Error('Personal scheduled task Agent Preset is invalid')
  }
  return Object.freeze({
    kind: 'agent-prompt', version: 1, prompt,
    ...(cwd === undefined ? {} : { cwd: cwd.trim() }),
    ...(agentPreset === undefined ? {} : { agentPreset: agentPreset.trim() }),
  })
}

function executionInput(
  input: PaimindHarnessScheduleActionRegistration,
  request: PaimindScheduleTriggerRequest,
): { readonly prompt: string; readonly cwd?: string; readonly agentPreset?: string } {
  if (input.prompt !== undefined) {
    const context = request.actionInput === undefined
      ? undefined
      : definitionWorkspaceContextInput(request.actionInput)
    const cwd = input.cwd ?? context?.cwd
    if (cwd === undefined) {
      throw new Error('Workspace scheduled task is not bound to a Harness Workspace')
    }
    const agentPreset = input.agentPreset ?? context?.agentPreset
    return {
      prompt: input.prompt, cwd,
      ...(agentPreset === undefined ? {} : { agentPreset }),
    }
  }
  return definitionAgentPromptInput(request.actionInput)
}

function scheduledPrompt(input: PaimindHarnessScheduleActionRegistration, request: PaimindScheduleTriggerRequest): string {
  const prompt = executionInput(input, request).prompt.trim()
  if (prompt === '' || prompt.length > 16_000) throw new Error('invalid Harness scheduled action prompt')
  return [
    `定时任务 · ${request.scheduleName}`,
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
  static inject = ['paimindScheduler', 'agentDefaultModel', 'agents', 'agentPresets', 'jobs', 'sessionTitle', 'paimindNotifications']
  private readonly handles = new Map<string, PaimindScheduledHarnessAgentHandle>()
  private readonly notificationProducer

  constructor(private readonly adapterCtx: PaimindHarnessScheduleAdapterContext) {
    super(adapterCtx, 'paimindHarnessScheduleAdapter')
    this.notificationProducer = adapterCtx.paimindNotifications.registerProducer({
      id: 'paimind.scheduler', nameZh: '平台定时任务', nameEn: 'Platform Scheduler',
    })
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
      ...(input.conversationEnabled === undefined ? {} : { conversationEnabled: input.conversationEnabled }),
      ...(input.usageHint === undefined ? {} : { usageHint: input.usageHint }),
      category: input.category ?? 'ai',
      adapterId: PAIMIND_HARNESS_SCHEDULER_ADAPTER_ID,
      enabled: true,
      version: randomUUID(),
    }
    const executor: PaimindScheduleExecutor = async (request, signal) => await this.execute(input, request, signal)
    return await this.adapterCtx.paimindScheduler.registerAction(
      descriptor,
      executor,
      input.prompt === undefined
        ? { validateActionInput: definitionAgentPromptInput }
        : {
            validateActionInput: actionInput => (
              actionInput === undefined && input.cwd !== undefined
                ? undefined
                : definitionWorkspaceContextInput(actionInput)
            ),
          },
    )
  }

  private async execute(
    input: PaimindHarnessScheduleActionRegistration,
    request: Readonly<PaimindScheduleTriggerRequest>,
    signal: AbortSignal,
  ): Promise<Readonly<PaimindScheduleExecutionReceipt>> {
    const sessionId = sessionIdForRun(request.runId)
    if (this.handles.has(sessionId)) throw new Error('Harness Session already exists for this run')
    const resolved = executionInput(input, request)
    const route = input.provider === undefined || input.model === undefined
      ? this.adapterCtx.agentDefaultModel.currentSelection()
      : { provider: input.provider, model: input.model }
    const handle = await createPaimindScheduledHarnessAgent(
      this.adapterCtx.agents,
      this.adapterCtx.agentPresets,
      {
        sessionId,
        ...(resolved.cwd === undefined ? {} : { cwd: resolved.cwd }),
        ...(resolved.agentPreset === undefined ? {} : { agentPreset: resolved.agentPreset }),
        provider: route.provider,
        model: route.model,
        signal,
      },
    )
    this.adapterCtx.sessionTitle.rename(handle.agent.session, request.scheduleName)
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
      await this.notificationProducer.publish({
        idempotencyKey: `schedule-run:${request.runId}`,
        title: status === 'succeeded' ? `${request.scheduleName} 已完成` : `${request.scheduleName} 需要处理`,
        ...(report.message === undefined ? {} : { body: report.message }),
        level: status === 'succeeded' ? 'success' : status === 'needs_attention' ? 'warning' : 'error',
        target: { kind: 'session', sessionId },
      })
    }).catch(error => {
      console.warn('[paimind-scheduler-adapter-harness] final report failed', error)
    })
    return Object.freeze({ status: 'accepted', message: 'Harness Session started' })
  }
}

export default PaimindHarnessScheduleAdapterService
