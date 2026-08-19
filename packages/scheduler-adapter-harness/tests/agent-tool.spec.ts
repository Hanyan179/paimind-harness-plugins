import { describe, expect, it, vi } from 'vitest'
import type { PaimindToolRunContext } from '@paimind/harness-compat/host'
import { PAIMIND_AGENT_PROMPT_ACTION_ID } from '../src/agent-action.ts'
import {
  installPaimindScheduleAgentTool,
  PAIMIND_SCHEDULE_MANAGE_TOOL,
} from '../src/agent-tool.ts'

interface CapturedTool {
  readonly name: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    render(args: Record<string, unknown>, value: Record<string, unknown>): readonly { readonly type: string; readonly text: string }[]
  }
  execute(args: Record<string, unknown>, exec: PaimindToolRunContext): Promise<Record<string, unknown>>
}

function fixture() {
  let tool: CapturedTool | undefined
  let prompt = ''
  const created = {
    scheduleId: 'schedule:one', name: '每日项目简报', actionId: PAIMIND_AGENT_PROMPT_ACTION_ID,
    actionInput: { kind: 'agent-prompt', version: 1, prompt: '总结项目进度' }, sourceSessionId: 'session:setup',
    rule: { kind: 'weekdays' as const, time: '09:00' }, timeZone: 'Asia/Shanghai', status: 'enabled' as const,
    nextRunAt: '2026-08-18T01:00:00.000Z', createdAt: '2026-08-17T08:00:00.000Z',
    updatedAt: '2026-08-17T08:00:00.000Z', version: 'version:one',
  }
  const scheduler = {
    list: vi.fn(async () => ({
      actions: [
        {
          actionId: PAIMIND_AGENT_PROMPT_ACTION_ID,
          source: { id: 'paimind.agent', nameZh: 'PAIMind 智能任务', nameEn: 'PAIMind Agent task' },
          nameZh: '智能任务', nameEn: 'Agent task', descriptionZh: '完成通用智能任务',
          conversationEnabled: true, usageHint: '没有更具体能力时使用', category: 'ai',
          adapterId: 'adapter:harness', enabled: true, version: 'version:agent',
        },
        {
          actionId: 'internal:maintenance',
          source: { id: 'internal', nameZh: '内部', nameEn: 'Internal' },
          nameZh: '内部维护', nameEn: 'Internal maintenance', category: 'system',
          adapterId: 'adapter:internal', enabled: true, version: 'version:internal',
        },
      ],
      definitions: [], runs: [],
    })),
    create: vi.fn(async () => created),
    update: vi.fn(), setEnabled: vi.fn(), runNow: vi.fn(), archive: vi.fn(), restore: vi.fn(),
  }
  const removeTool = vi.fn()
  const removePrompt = vi.fn()
  const rename = vi.fn()
  const dispose = installPaimindScheduleAgentTool({
    paimindScheduler: scheduler as never,
    tools: {
      register: vi.fn(definition => { tool = definition as CapturedTool; return removeTool }),
      execute: vi.fn(),
    },
    systemPrompt: {
      section: vi.fn(section => { prompt = section.text; return removePrompt }),
      context: vi.fn(),
    },
    sessionTitle: { rename },
    effect: vi.fn(),
  })
  const exec: PaimindToolRunContext = {
    callId: 'call:one', rootCallId: 'root:one', name: PAIMIND_SCHEDULE_MANAGE_TOOL, arguments: {},
    agent: { id: 'session:setup', session: { id: 'session:setup', header: { cwd: '/workspace', agentPreset: 'paramont' } } },
    token: Symbol('tool'), signal: new AbortController().signal,
  }
  if (tool === undefined) throw new Error('schedule_manage was not registered')
  return { tool, prompt, scheduler, created, dispose, removeTool, removePrompt, rename, exec }
}

describe('schedule_manage Agent Tool', () => {
  it('discovers only explicitly conversation-enabled business capabilities', async () => {
    const f = fixture()
    const value = await f.tool.execute({ operation: 'capabilities' }, f.exec)
    expect(value.capabilities).toEqual([expect.objectContaining({ name: '智能任务' })])
    expect(JSON.stringify(value)).not.toContain('internal:maintenance')
    expect(JSON.stringify(value)).not.toContain(PAIMIND_AGENT_PROMPT_ACTION_ID)
    expect(f.prompt).toContain('Never ask the user for actionId, Adapter, RRULE, Cron')
    expect(f.prompt).toContain('Never call ask_user_question')
    expect(f.prompt).toContain('each run creates a new result conversation')
    expect(f.prompt).toContain('Never repeat these internal encodings in a user-facing reply')
    expect(f.prompt).not.toContain('Supported schedules are once, daily, weekdays, weekly, and monthly')
    const compiled = f.tool.parameters as { readonly properties?: Readonly<Record<string, { readonly oneOf?: readonly unknown[] }>> }
    expect(compiled.properties?.rule?.oneOf).toHaveLength(5)
    f.dispose()
    expect(f.removeTool).toHaveBeenCalledTimes(1)
    expect(f.removePrompt).toHaveBeenCalledTimes(1)
  })

  it('creates the generic fallback with validated prompt and current Session snapshot', async () => {
    const f = fixture()
    const args = {
      operation: 'create', name: '每日项目简报', prompt: '  总结项目进度  ',
      rule: { kind: 'weekdays', time: '09:00' }, time_zone: 'Asia/Shanghai',
    }
    const value = await f.tool.execute(args, f.exec)
    expect(f.scheduler.create).toHaveBeenCalledWith({
      name: '每日项目简报', actionId: PAIMIND_AGENT_PROMPT_ACTION_ID,
      actionInput: {
        kind: 'agent-prompt', version: 1, prompt: '总结项目进度', cwd: '/workspace', agentPreset: 'paramont',
      },
      sourceSessionId: 'session:setup', rule: { kind: 'weekdays', time: '09:00' },
      timeZone: 'Asia/Shanghai', enabled: true,
    })
    expect(value).toMatchObject({ operation: 'create', task: { name: '每日项目简报', nextRunAt: '2026-08-18T01:00:00.000Z' } })
    expect(f.rename).toHaveBeenCalledWith(f.exec.agent?.session, '每日项目简报')
    const rendered = f.tool.output.render(args, value)
    expect(rendered[0]?.text).toContain('每日项目简报')
    expect(rendered[0]?.text).toContain('2026-08-18T01:00:00.000Z')
    expect(rendered[0]?.text).not.toMatch(/schedule:one|paimind:agent-prompt|adapter/i)
  })

  it('rejects unsupported cadences instead of silently approximating them', async () => {
    const f = fixture()
    await expect(f.tool.execute({
      operation: 'create', name: '每两小时采集', prompt: '采集信息',
      rule: { kind: 'interval', hours: 2 }, time_zone: 'Asia/Shanghai',
    }, f.exec)).rejects.toThrow(/must match exactly one oneOf branch/)
    expect(f.scheduler.create).not.toHaveBeenCalled()
  })
})
