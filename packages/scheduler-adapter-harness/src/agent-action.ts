import { PaimindHostService } from '@paimind/harness-compat/host'
import type { PaimindHarnessScheduleAdapter } from './index.js'

export const name = 'paimind-scheduler-agent-action'
export const PAIMIND_AGENT_BRIEF_ACTION_ID = 'paimind:agent-workspace-brief'

export interface PaimindAgentScheduleActionContext {
  readonly paimindHarnessScheduleAdapter: PaimindHarnessScheduleAdapter
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

export function installPaimindAgentScheduleAction(ctx: PaimindAgentScheduleActionContext): void {
  const configuredCwd = process.env.PAIMIND_SCHEDULE_AGENT_CWD?.trim()
  const provider = process.env.PAIMIND_SCHEDULE_AGENT_PROVIDER?.trim() || 'deepseek-official'
  const model = process.env.PAIMIND_SCHEDULE_AGENT_MODEL?.trim() || 'deepseek-v4-flash'
  const ready = ctx.paimindHarnessScheduleAdapter.registerAction({
    actionId: PAIMIND_AGENT_BRIEF_ACTION_ID,
    source: { id: 'paimind.agent', nameZh: 'PAIMind Agent', nameEn: 'PAIMind Agent' },
    nameZh: 'Agent · 新建会话并生成工作区简报',
    nameEn: 'Agent · Create a session and generate a workspace brief',
    descriptionZh: '按时新建独立 Agent 会话，检查工作区并生成进展、风险和下一步简报。',
    descriptionEn: 'Create an independent Agent session on schedule and summarize workspace progress, risks, and next steps.',
    category: 'ai',
    cwd: configuredCwd === undefined || configuredCwd === '' ? process.cwd() : configuredCwd,
    provider,
    model,
    prompt: [
      'Review the current workspace and produce a concise workspace brief.',
      'Cover current progress, material risks, and the next recommended actions.',
      'Do not modify files or call external systems.',
    ].join('\n'),
  })
  ctx.effect(() => async () => { (await ready)() }, 'paimind-scheduler-agent-action: registration')
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
