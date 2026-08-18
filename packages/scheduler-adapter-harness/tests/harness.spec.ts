import { describe, expect, it, vi } from 'vitest'
import type { PaimindScheduleExecutor } from '@paimind/platform-scheduler'
import { createPaimindHarnessScheduledMessage } from '@paimind/harness-compat/host'
import { PaimindHarnessScheduleAdapterService } from '../src/index.ts'
import {
  installPaimindAgentScheduleAction,
  PAIMIND_AGENT_BRIEF_ACTION_ID,
  PAIMIND_AGENT_PROMPT_ACTION_ID,
} from '../src/agent-action.ts'

describe('Harness Scheduler Adapter', () => {
  it('registers the built-in Agent new-Session action and unloads it cleanly', async () => {
    const dispose = vi.fn()
    const registerAction = vi.fn(async () => dispose)
    let cleanup: undefined | (() => void | Promise<void>)
    installPaimindAgentScheduleAction({
      paimindHarnessScheduleAdapter: { registerAction },
      effect: install => { cleanup = install() || undefined },
    })
    await vi.waitFor(() => { expect(registerAction).toHaveBeenCalledTimes(2) })
    expect(registerAction).toHaveBeenCalledWith(expect.objectContaining({
      actionId: PAIMIND_AGENT_BRIEF_ACTION_ID,
      category: 'ai',
      nameZh: 'Agent · 新建会话并生成工作区简报',
      prompt: expect.stringContaining('Review the current workspace'),
    }))
    expect(registerAction).toHaveBeenCalledWith(expect.objectContaining({
      actionId: PAIMIND_AGENT_PROMPT_ACTION_ID,
      category: 'ai',
      conversationEnabled: true,
      usageHint: expect.stringContaining('AI'),
    }))
    await cleanup?.()
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it('creates a new Session and Native Job for every run and maps the final result', async () => {
    let executor: PaimindScheduleExecutor | undefined
    const scheduler = {
      registerAction: vi.fn(async (_descriptor, next: PaimindScheduleExecutor) => { executor = next; return () => {} }),
      reportRun: vi.fn(async report => report),
    }
    const created: string[] = []
    const routes: object[] = []
    const jobs: object[] = []
    const mounted: string[] = []
    const agentPresets = {
      resolve: vi.fn(async (id?: string) => ({ id: id ?? 'paramont' })),
      mount: vi.fn(async (_agentCtx: object, id?: string) => { mounted.push(id ?? '') }),
    }
    const agents = {
      create: vi.fn(async ({ sessionId, setup, agentOptions }: {
        readonly sessionId: string
        readonly setup?: (agentCtx: object) => void | Promise<void>
        readonly agentOptions?: { readonly provider?: string; readonly model?: string }
      }) => {
        await setup?.({})
        created.push(sessionId)
        routes.push(agentOptions ?? {})
        const events: object[] = []
        const agent = {
          id: sessionId,
          session: { id: sessionId, header: {}, events },
          followup: vi.fn(() => {
            events.push({
              type: 'assistant/message', seq: 1, time: 1,
              data: { message: { content: [{ type: 'text', text: 'Report ready\nPAIMIND_STATUS: SUCCEEDED' }] } },
            })
          }),
          whenIdle: async () => {},
        }
        return { agent, dispose: async () => {} }
      }),
    }
    const nativeJobs = {
      start: vi.fn(spec => { jobs.push(spec); spec.run(); return `paimind-schedule-${jobs.length}` }),
    }
    const sessionTitle = { rename: vi.fn() }
    const agentDefaultModel = { currentSelection: vi.fn(() => ({ provider: 'provider:default', model: 'model:default' })) }
    const publish = vi.fn(async () => undefined)
    const paimindNotifications = { registerProducer: vi.fn(() => ({ publish })) }
    const service = Object.create(PaimindHarnessScheduleAdapterService.prototype) as PaimindHarnessScheduleAdapterService
    Object.assign(service, {
      adapterCtx: { paimindScheduler: scheduler, agentDefaultModel, agents, agentPresets, jobs: nativeJobs, sessionTitle, paimindNotifications },
      notificationProducer: { publish },
      handles: new Map(),
    })
    await service.registerAction({
      actionId: 'action:brief', source: { id: 'paimind.ai', nameZh: 'PAIMind AI', nameEn: 'PAIMind AI' },
      nameZh: '生成简报', nameEn: 'Generate brief', prompt: 'Generate the weekly project brief.',
    })
    const request = (runId: string) => ({
      contractVersion: '1.0' as const, runId, scheduleId: 'schedule:one', scheduleName: 'Weekly project brief',
      actionId: 'action:brief', trigger: 'schedule' as const,
      scheduledFor: '2026-08-15T01:00:00.000Z', idempotencyKey: `key:${runId}`,
      callbackUrl: 'https://platform.example.test/callback',
    })
    const one = await executor!(request('run:one'), new AbortController().signal)
    const two = await executor!(request('run:two'), new AbortController().signal)
    expect(created).toHaveLength(2)
    expect(new Set(created).size).toBe(2)
    expect(routes).toEqual([
      { provider: 'provider:default', model: 'model:default' },
      { provider: 'provider:default', model: 'model:default' },
    ])
    expect(agentDefaultModel.currentSelection).toHaveBeenCalledTimes(2)
    expect(nativeJobs.start).toHaveBeenCalledTimes(2)
    expect(sessionTitle.rename).toHaveBeenCalledTimes(2)
    expect(sessionTitle.rename).toHaveBeenCalledWith(expect.anything(), 'Weekly project brief')
    expect(mounted).toEqual(['paramont', 'paramont'])
    expect(one).toEqual({ status: 'accepted', message: 'Harness Session started' })
    expect(two).toEqual({ status: 'accepted', message: 'Harness Session started' })
    await vi.waitFor(() => { expect(scheduler.reportRun).toHaveBeenCalledTimes(2) })
    await vi.waitFor(() => { expect(publish).toHaveBeenCalledTimes(2) })
    expect(publish).toHaveBeenNthCalledWith(1, expect.objectContaining({
      idempotencyKey: 'schedule-run:run:one', title: 'Weekly project brief 已完成',
      target: { kind: 'session', sessionId: created[0] },
    }))
    expect(scheduler.reportRun).toHaveBeenNthCalledWith(1, expect.objectContaining({
      status: 'succeeded', message: 'Report ready',
      action: { kind: 'session', label: '打开对话', sessionId: created[0] },
    }))
    expect(scheduler.reportRun).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: expect.objectContaining({ sessionId: created[1] }),
    }))
  })

  it('submits scheduled work as a user-owned turn so Harness titles the new conversation', () => {
    const message = createPaimindHarnessScheduledMessage('定时任务 · Agent 工作区简报') as {
      readonly role: string
      readonly source: { readonly kind: string }
    }
    expect(message.role).toBe('user')
    expect(message.source).toEqual({ kind: 'user' })
  })

  it('rejects a half-configured Harness model route', async () => {
    const service = Object.create(PaimindHarnessScheduleAdapterService.prototype) as PaimindHarnessScheduleAdapterService
    Object.assign(service, { adapterCtx: {}, handles: new Map() })
    await expect(service.registerAction({
      actionId: 'action:invalid', source: { id: 'test', nameZh: '测试', nameEn: 'Test' },
      nameZh: '测试', nameEn: 'Test', prompt: 'Test.', provider: 'provider:test',
    })).rejects.toThrow('provider and model together')
  })
})
