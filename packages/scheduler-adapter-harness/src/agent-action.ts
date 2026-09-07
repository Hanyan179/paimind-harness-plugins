import { PaimindHostService } from '@paimind/harness-compat/host'
import type { PaimindHarnessScheduleAdapter } from './index.js'

export const name = 'paimind-scheduler-agent-action'
export const PAIMIND_AGENT_BRIEF_ACTION_ID = 'paimind:agent-workspace-brief'
export const PAIMIND_AGENT_PROMPT_ACTION_ID = 'paimind:agent-prompt'

export interface PaimindAgentScheduleActionContext {
  readonly paimindHarnessScheduleAdapter: PaimindHarnessScheduleAdapter
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

export function installPaimindAgentScheduleAction(ctx: PaimindAgentScheduleActionContext): void {
  const configuredCwd = process.env.PAIMIND_SCHEDULE_AGENT_CWD?.trim()
  const provider = process.env.PAIMIND_SCHEDULE_AGENT_PROVIDER?.trim()
  const model = process.env.PAIMIND_SCHEDULE_AGENT_MODEL?.trim()
  const modelRoute = provider === undefined && model === undefined ? {}
    : provider !== undefined && model !== undefined ? { provider, model }
      : (() => { throw new Error('PAIMIND_SCHEDULE_AGENT_PROVIDER and PAIMIND_SCHEDULE_AGENT_MODEL must be configured together') })()
  const briefReady = ctx.paimindHarnessScheduleAdapter.registerAction({
    actionId: PAIMIND_AGENT_BRIEF_ACTION_ID,
    source: { id: 'paimind.agent', nameZh: 'PAIMind 智能任务', nameEn: 'PAIMind Agent' },
    nameZh: '生成工作区简报',
    nameEn: 'Agent · Create a session and generate a workspace brief',
    descriptionZh: '按时新建独立对话，检查工作区并生成进展、风险和下一步简报。',
    descriptionEn: 'Create an independent Agent session on schedule and summarize workspace progress, risks, and next steps.',
    category: 'ai',
    ...(configuredCwd === undefined || configuredCwd === '' ? {} : { cwd: configuredCwd }),
    ...modelRoute,
    prompt: [
      '请审阅当前工作区，用中文生成简短的工作简报。',
      '说明当前进展、需要关注的问题和下一步安排。仅报告有依据的事实，使用业务用户能理解的名称。',
      '不要修改文件或调用外部系统。',
    ].join('\n'),
  })
  const promptReady = ctx.paimindHarnessScheduleAdapter.registerAction({
    actionId: PAIMIND_AGENT_PROMPT_ACTION_ID,
    source: { id: 'paimind.agent', nameZh: 'PAIMind 智能任务', nameEn: 'PAIMind Agent task' },
    nameZh: '智能任务',
    nameEn: 'Agent task',
    descriptionZh: '按业务用户的任务说明，在设定时间创建独立对话并完成工作。',
    descriptionEn: 'Create an independent conversation on schedule and complete the business user request.',
    conversationEnabled: true,
    usageHint: '当用户描述需要 AI 分析、采集、整理、生成、检查或回顾，但没有更具体的已登记业务能力时使用。',
    category: 'ai',
    ...modelRoute,
  })
  ctx.effect(() => async () => {
    const disposers = await Promise.all([briefReady, promptReady])
    for (const dispose of disposers.reverse()) dispose()
  }, 'paimind-scheduler-agent-action: registrations')
}

/** Built-in platform action. Every Run creates one independent Harness Agent Session. */
export class PaimindAgentScheduleActionPlugin extends PaimindHostService {
  static inject = ['paimindHarnessScheduleAdapter']

  constructor(ctx: PaimindAgentScheduleActionContext) {
    super(ctx, 'paimindAgentScheduleAction')
    installPaimindAgentScheduleAction(ctx)
  }
}

export default PaimindAgentScheduleActionPlugin
