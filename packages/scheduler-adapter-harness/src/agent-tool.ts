import {
  definePaimindScheduleActionInput,
  definePaimindScheduleRule,
  type PaimindScheduleActionDescriptor,
  type PaimindScheduleCreateInput,
  type PaimindScheduleDefinition,
  type PaimindScheduleRule,
} from '@paimind/contracts'
import {
  definePaimindHarnessTool,
  type PaimindHostSystemPrompt,
  type PaimindHostToolRegistry,
  type PaimindToolRunContext,
  type PaimindScheduledHarnessTitleService,
} from '@paimind/harness-compat/host'
import type { PaimindSchedulerServiceApi } from '@paimind/platform-scheduler'
import { PAIMIND_AGENT_PROMPT_ACTION_ID } from './agent-action.js'

export const name = 'paimind-scheduler-agent-tool'
export const inject = ['paimindScheduler', 'tools', 'systemPrompt', 'sessionTitle']
export const PAIMIND_SCHEDULE_MANAGE_TOOL = 'schedule_manage'

const OPERATIONS = ['capabilities', 'create', 'update', 'list', 'run_now', 'pause', 'resume', 'archive', 'restore'] as const
type ScheduleManageOperation = typeof OPERATIONS[number]

export interface PaimindScheduleAgentToolContext {
  readonly paimindScheduler: PaimindSchedulerServiceApi
  readonly tools: PaimindHostToolRegistry
  readonly systemPrompt: PaimindHostSystemPrompt
  readonly sessionTitle: PaimindScheduledHarnessTitleService
  effect(install: () => void | (() => void), label?: string): void
}

function text(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = args[key]
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${key} must be a non-empty string`)
  return value.trim()
}

function bool(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`)
  return value
}

function actionInput(args: Record<string, unknown>): ReturnType<typeof definePaimindScheduleActionInput> | undefined {
  const value = args.capability_input
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('capability_input must be an object')
  }
  return definePaimindScheduleActionInput(value as Record<string, unknown>)
}

function operation(args: Record<string, unknown>): ScheduleManageOperation {
  const value = text(args, 'operation', true)!
  if (!OPERATIONS.includes(value as ScheduleManageOperation)) throw new Error(`unsupported schedule operation: ${value}`)
  return value as ScheduleManageOperation
}

function rule(args: Record<string, unknown>, required: boolean): PaimindScheduleRule | undefined {
  const value = args.rule
  if (value === undefined && !required) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('rule must be an object')
  return definePaimindScheduleRule(value as PaimindScheduleRule)
}

function timeZone(args: Record<string, unknown>): string {
  const explicit = text(args, 'time_zone')
  if (explicit !== undefined) return explicit
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
}

function conversationActions(actions: readonly Readonly<PaimindScheduleActionDescriptor>[]): readonly Readonly<PaimindScheduleActionDescriptor>[] {
  return actions.filter(action => action.enabled && action.conversationEnabled === true)
}

function findDefinition(
  definitions: readonly Readonly<PaimindScheduleDefinition>[],
  scheduleId: string,
  includeArchived = false,
): Readonly<PaimindScheduleDefinition> {
  const definition = definitions.find(candidate => candidate.scheduleId === scheduleId && (includeArchived || candidate.status !== 'archived'))
  if (definition === undefined) throw new Error('Scheduled task was not found')
  return definition
}

function findAction(
  actions: readonly Readonly<PaimindScheduleActionDescriptor>[],
  capabilityName: string | undefined,
): Readonly<PaimindScheduleActionDescriptor> {
  if (capabilityName === undefined) {
    const fallback = conversationActions(actions).find(candidate => candidate.actionId === PAIMIND_AGENT_PROMPT_ACTION_ID)
    if (fallback === undefined) throw new Error('Requested business capability is unavailable')
    return fallback
  }
  const matches = conversationActions(actions).filter(candidate => (
    candidate.nameZh === capabilityName || candidate.nameEn === capabilityName
  ))
  if (matches.length === 0) throw new Error('Requested business capability is unavailable')
  if (matches.length !== 1) throw new Error('Requested business capability name is ambiguous')
  return matches[0]!
}

function promptActionInput(
  prompt: string,
  exec: PaimindToolRunContext,
) {
  return definePaimindScheduleActionInput({
    kind: 'agent-prompt',
    version: 1,
    prompt,
    ...(exec.agent?.session.header.cwd === undefined ? {} : { cwd: exec.agent.session.header.cwd }),
    ...(exec.agent?.session.header.agentPreset === undefined ? {} : { agentPreset: exec.agent.session.header.agentPreset }),
  })
}

function businessTask(definition: Readonly<PaimindScheduleDefinition>): Record<string, unknown> {
  return {
    scheduleId: definition.scheduleId,
    name: definition.name,
    rule: definition.rule,
    timeZone: definition.timeZone,
    status: definition.status,
    ...(definition.nextRunAt === undefined ? {} : { nextRunAt: definition.nextRunAt }),
  }
}

function capability(action: Readonly<PaimindScheduleActionDescriptor>): Record<string, unknown> {
  return {
    name: action.nameZh,
    description: action.descriptionZh ?? action.nameZh,
    usageHint: action.usageHint ?? action.descriptionZh ?? action.nameZh,
  }
}

async function executeManage(
  ctx: PaimindScheduleAgentToolContext,
  args: Record<string, unknown>,
  exec: PaimindToolRunContext,
): Promise<Record<string, unknown>> {
  const op = operation(args)
  const snapshot = await ctx.paimindScheduler.list()
  if (op === 'capabilities') {
    return { operation: op, message: 'Available business capabilities', capabilities: conversationActions(snapshot.actions).map(capability) }
  }
  if (op === 'list') {
    return { operation: op, message: 'Scheduled tasks', tasks: snapshot.definitions.map(businessTask) }
  }
  if (op === 'create') {
    if (exec.agent === undefined) throw new Error('schedule_manage create requires a current Harness Session')
    const selected = findAction(snapshot.actions, text(args, 'capability_name'))
    const prompt = text(args, 'prompt')
    const selectedInput = selected.actionId === PAIMIND_AGENT_PROMPT_ACTION_ID
      ? promptActionInput(prompt ?? (() => { throw new Error('prompt is required for an intelligent task') })(), exec)
      : actionInput(args)
    const input: PaimindScheduleCreateInput = {
      name: text(args, 'name', true)!,
      actionId: selected.actionId,
      ...(selectedInput === undefined ? {} : { actionInput: selectedInput }),
      sourceSessionId: exec.agent.session.id,
      rule: rule(args, true)!,
      timeZone: timeZone(args),
      enabled: bool(args, 'enabled') ?? true,
    }
    const created = await ctx.paimindScheduler.create(input)
    ctx.sessionTitle.rename(exec.agent.session, created.name)
    return { operation: op, message: 'Scheduled task created', task: businessTask(created) }
  }

  const scheduleId = text(args, 'schedule_id', true)!
  const current = findDefinition(snapshot.definitions, scheduleId, op === 'restore')
  if (op === 'restore') {
    const result = await ctx.paimindScheduler.restore({ scheduleId, ifVersion: current.version })
    if (!result.ok) throw new Error(result.message)
    return { operation: op, message: 'Scheduled task restored as paused', task: businessTask(result.value) }
  }
  if (op === 'run_now') {
    const result = await ctx.paimindScheduler.runNow({ scheduleId })
    if (!result.ok) throw new Error(result.message)
    return { operation: op, message: 'Scheduled task run started', task: businessTask(current) }
  }
  if (op === 'pause' || op === 'resume') {
    const result = await ctx.paimindScheduler.setEnabled({
      scheduleId, enabled: op === 'resume', ifVersion: current.version,
    })
    if (!result.ok) throw new Error(result.message)
    return { operation: op, message: op === 'resume' ? 'Scheduled task resumed' : 'Scheduled task paused', task: businessTask(result.value) }
  }
  if (op === 'archive') {
    const result = await ctx.paimindScheduler.archive({ scheduleId, ifVersion: current.version })
    if (!result.ok) throw new Error(result.message)
    return { operation: op, message: 'Scheduled task archived', task: businessTask(result.value) }
  }

  const requestedCapability = text(args, 'capability_name')
  const selected = requestedCapability === undefined
    ? snapshot.actions.find(action => action.actionId === current.actionId)
    : findAction(snapshot.actions, requestedCapability)
  if (selected === undefined) throw new Error('Current business capability is unavailable')
  const nextPrompt = text(args, 'prompt')
  const actionChanged = selected.actionId !== current.actionId
  const nextActionInput = selected.actionId === PAIMIND_AGENT_PROMPT_ACTION_ID
    ? nextPrompt === undefined && !actionChanged
      ? current.actionInput
      : promptActionInput(nextPrompt ?? (() => { throw new Error('prompt is required when changing to an intelligent task') })(), exec)
    : actionInput(args) ?? (actionChanged ? undefined : current.actionInput)
  const result = await ctx.paimindScheduler.update({
    scheduleId,
    ifVersion: current.version,
    name: text(args, 'name') ?? current.name,
    actionId: selected.actionId,
    ...(nextActionInput === undefined ? {} : { actionInput: nextActionInput }),
    ...(current.sourceSessionId === undefined ? {} : { sourceSessionId: current.sourceSessionId }),
    rule: rule(args, false) ?? current.rule,
    timeZone: text(args, 'time_zone') ?? current.timeZone,
    enabled: bool(args, 'enabled') ?? current.status === 'enabled',
  })
  if (!result.ok) throw new Error(result.message)
  return { operation: op, message: 'Scheduled task updated', task: businessTask(result.value) }
}

function renderResult(value: Record<string, unknown>): { readonly type: 'text'; readonly text: string }[] {
  if (Array.isArray(value.capabilities)) {
    const lines = value.capabilities.map(item => {
      const row = item as { readonly name?: string; readonly description?: string }
      return `<capability name="${row.name ?? ''}">${row.description ?? ''}</capability>`
    })
    return [{ type: 'text', text: lines.join('\n') || '当前没有可用于对话创建的业务能力。' }]
  }
  const task = value.task as { readonly name?: string; readonly status?: string; readonly nextRunAt?: string } | undefined
  if (task !== undefined) {
    return [{ type: 'text', text: `${String(value.message)}：${task.name ?? ''}；状态 ${task.status ?? ''}${task.nextRunAt === undefined ? '' : `；下次运行 ${task.nextRunAt}`}` }]
  }
  const tasks = Array.isArray(value.tasks) ? value.tasks as { readonly name?: string; readonly status?: string; readonly nextRunAt?: string }[] : []
  return [{ type: 'text', text: tasks.length === 0 ? '当前没有已安排任务。' : tasks.map(item => `${item.name ?? ''}｜${item.status ?? ''}${item.nextRunAt === undefined ? '' : `｜${item.nextRunAt}`}`).join('\n') }]
}

export function installPaimindScheduleAgentTool(ctx: PaimindScheduleAgentToolContext): () => void {
  const removePrompt = ctx.systemPrompt.section({
    name: 'tool:schedule-manage',
    order: 116,
    text: [
      'Use schedule_manage for every request to create, inspect, update, run, pause, resume, archive, or restore a platform scheduled task.',
      'Explain in business language that the task runs in the background at the chosen time, each run creates a new result conversation, and the task can be managed from 平台定时任务.',
      'Ask only for missing work, destination, or time through an ordinary assistant reply. Never call ask_user_question for this flow.',
      'Never ask the user for actionId, Adapter, RRULE, Cron, canonical rule kind values, or another implementation detail.',
      'Supported business schedules are one-time, every day, business days, one weekday each week, and one calendar day each month. Reject unsupported cadence explicitly; never approximate it silently.',
      'For schedule_manage tool calls only, encode the rule as exactly one of {"kind":"once","at":"ISO-8601 UTC timestamp"}, {"kind":"daily","time":"HH:MM"}, {"kind":"weekdays","time":"HH:MM"}, {"kind":"weekly","weekday":1-7,"time":"HH:MM"}, or {"kind":"monthly","dayOfMonth":1-28,"time":"HH:MM"}. Never repeat these internal encodings in a user-facing reply.',
      'Do not call capabilities for ordinary writing, summarizing, monitoring, research, or other generic intelligent work; omit capability_name and use the intelligent-task fallback directly. Call capabilities only when the user refers to a registered workflow, message, or integration capability by business meaning. If exactly one clearly fits, use its business name as capability_name; if several fit, present only their business names and ask.',
      'Before create, restate the work, schedule, and time zone. Never claim success before the tool succeeds. After success, state the absolute nextRunAt returned by the tool.',
      'Map requests to delete a task to archive. Restore returns an archived task as paused and never schedules it immediately. Do not reveal or reason aloud about scheduleId, capabilityId, actionId, Adapter names, internal rule encodings, or routing in the user-facing conversation.',
    ].join('\n'),
  })
  const removeTool = ctx.tools.register(definePaimindHarnessTool({
    name: PAIMIND_SCHEDULE_MANAGE_TOOL,
    description: 'Manage business-user scheduled tasks through the hidden PAIMind orchestration and Scheduler layers.',
    parameters: {
      operation: { type: 'string', required: true, enum: [...OPERATIONS] },
      schedule_id: { type: 'string' }, capability_name: { type: 'string' }, name: { type: 'string' }, prompt: { type: 'string' },
      capability_input: { type: 'object', additionalProperties: true },
      rule: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: { kind: { type: 'string', enum: ['once'], required: true }, at: { type: 'string', required: true } },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: { kind: { type: 'string', enum: ['daily'], required: true }, time: { type: 'string', required: true } },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: { kind: { type: 'string', enum: ['weekdays'], required: true }, time: { type: 'string', required: true } },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['weekly'], required: true },
              weekday: { type: 'number', enum: [1, 2, 3, 4, 5, 6, 7], required: true },
              time: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['monthly'], required: true },
              dayOfMonth: { type: 'number', enum: Array.from({ length: 28 }, (_, index) => index + 1), required: true },
              time: { type: 'string', required: true },
            },
          },
        ],
      },
      time_zone: { type: 'string' }, enabled: { type: 'boolean' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) { return renderResult(value) },
    },
    async execute(args, exec) { return await executeManage(ctx, args, exec) },
    presentCall(args) { return { card: 'generic', title: operation(args) === 'create' ? '创建平台定时任务' : '管理平台定时任务', kind: 'edit' } },
    isConcurrencySafe(args) { return operation(args) === 'capabilities' || operation(args) === 'list' },
  }))
  return () => { removeTool(); removePrompt() }
}

export function apply(ctx: PaimindScheduleAgentToolContext): void {
  ctx.effect(() => installPaimindScheduleAgentTool(ctx), 'paimind-scheduler-agent-tool: tool and prompt')
}

export default apply
