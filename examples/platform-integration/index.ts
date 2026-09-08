import type { PaimindScheduleTriggerRequest } from '@hansen/contracts'
import {
  PaimindReplayGuard,
  verifyPaimindRequestSignature,
  type PaimindPlatformClient,
  type PaimindSignatureInput,
} from '@hansen/platform-sdk'
import type { PaimindScheduleExecutor } from '@hansen/platform-scheduler'
import type { PaimindHarnessScheduleAdapter } from '@hansen/scheduler-adapter-harness'

/** Business plugin code: register one Harness action, with no business field added to Scheduler. */
export async function registerExampleHarnessAction(
  adapter: PaimindHarnessScheduleAdapter,
  execution: {
    readonly cwd?: string
    readonly provider?: string
    readonly model?: string
  } = {},
): Promise<() => void> {
  return await adapter.registerAction({
    actionId: 'example:weekly-project-brief',
    source: { id: 'example.project', nameZh: '项目系统', nameEn: 'Project system' },
    nameZh: '生成每周项目简报',
    nameEn: 'Generate weekly project brief',
    category: 'ai',
    cwd: execution.cwd ?? process.cwd(),
    provider: execution.provider ?? 'deepseek-official',
    model: execution.model ?? 'deepseek-v4-flash',
    prompt: 'Review the current project workspace and generate a concise weekly project brief.',
  })
}

export interface StandardHttpActionInput {
  readonly signature: PaimindSignatureInput
  readonly receivedSignature: string
  readonly secret: string
  readonly request: PaimindScheduleTriggerRequest
  readonly client: PaimindPlatformClient
  readonly replay: PaimindReplayGuard
  readonly now?: number
}

/** Provider handler: verify, return 202 immediately, then report running and the final result. */
export function acceptExampleHttpAction(input: StandardHttpActionInput): {
  readonly status: 202
  readonly completion: Promise<void>
} {
  if (!verifyPaimindRequestSignature(input.signature, input.receivedSignature, input.secret)) {
    throw new Error('invalid PAIMind signature')
  }
  if (!input.replay.accept(input.signature.timestamp, input.signature.requestId, input.now ?? Date.now())) {
    throw new Error('replayed PAIMind request')
  }
  const completion = (async () => {
    await input.client.schedules.reportRun({
      contractVersion: '1.0', runId: input.request.runId,
      status: 'running', message: 'Business execution started', progress: 10,
    })
    await input.client.schedules.reportRun({
      contractVersion: '1.0', runId: input.request.runId,
      status: 'succeeded', message: 'Business execution completed',
      action: { kind: 'external', label: 'Open result', url: 'https://business.example.test/results/one' },
    })
  })()
  return { status: 202, completion }
}

export interface ThirdPartyTaskApi {
  createTask(input: { readonly title: string; readonly idempotencyKey: string }, signal: AbortSignal): Promise<{ readonly url: string }>
}

/** Custom Adapter example: only this layer understands the third-party API vocabulary. */
export function createExampleCustomAdapter(api: ThirdPartyTaskApi): PaimindScheduleExecutor {
  return async (request, signal) => {
    const result = await api.createTask({
      title: `Scheduled action ${request.actionId}`,
      idempotencyKey: request.idempotencyKey,
    }, signal)
    return {
      contractVersion: '1.0', runId: request.runId, status: 'succeeded',
      message: 'Third-party task created',
      action: { kind: 'external', label: 'Open task', url: result.url },
    }
  }
}

export async function sendExampleNotification(client: PaimindPlatformClient): Promise<unknown> {
  return await client.notifications.send({
    recipientIds: ['user:example'],
    title: 'Weekly project brief is ready',
    body: 'Open the generated brief to review the result.',
    level: 'success',
    link: { label: 'Open brief', url: 'https://business.example.test/briefs/one' },
    idempotencyKey: 'example:weekly-brief:one',
  })
}
