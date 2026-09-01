import {
  Component,
  useEffect,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  type PaimindScheduleActionCategory,
  type PaimindScheduleActionDescriptor,
  type PaimindScheduleCreateInput,
  type PaimindScheduleDefinition,
  type PaimindScheduleRule,
  type PaimindScheduleRun,
  type PaimindScheduleRunAction,
  type PaimindScheduleUpdateInput,
} from '@paimind/contracts'
import {
  contributePaimindExtension,
  type HarnessRemoteMountService,
  type HarnessRemoteResult,
  type HarnessConversationDraftService,
  type HarnessSessionService,
  type HarnessWorkspaceService,
  type PaimindClientContext,
  type PaimindLocaleSource,
} from '@paimind/harness-compat'
import { installHarnessScheduledSessionMarkers } from '@paimind/harness-compat/client-surface'
import type {
  PaimindScheduleArchiveRequest,
  PaimindSchedulerSnapshot,
  PaimindScheduleSetEnabledRequest,
  PaimindScheduleRunNowRequest,
} from '../index.js'
import type { PaimindScheduleMutationResult, PaimindScheduleRunNowResult } from '../core.js'
import TYPERT_REMOTE from '../remote.js'

const BASE_INJECT = ['slots', 'locale', 'remote', 'sessions', 'workspaces', 'conversation'] as const
export const inject = [...BASE_INJECT]

interface SchedulerRemoteNamespace {
  list(): Promise<HarnessRemoteResult<PaimindSchedulerSnapshot>>
  create(input: PaimindScheduleCreateInput): Promise<HarnessRemoteResult<Readonly<PaimindScheduleDefinition>>>
  update(input: PaimindScheduleUpdateInput): Promise<HarnessRemoteResult<PaimindScheduleMutationResult>>
  setEnabled(input: PaimindScheduleSetEnabledRequest): Promise<HarnessRemoteResult<PaimindScheduleMutationResult>>
  runNow(input: PaimindScheduleRunNowRequest): Promise<HarnessRemoteResult<PaimindScheduleRunNowResult>>
  archive(input: PaimindScheduleArchiveRequest): Promise<HarnessRemoteResult<PaimindScheduleMutationResult>>
  restore(input: PaimindScheduleArchiveRequest): Promise<HarnessRemoteResult<PaimindScheduleMutationResult>>
}

interface SchedulerRemote extends HarnessRemoteMountService {
  readonly paimindScheduler?: SchedulerRemoteNamespace
}

export interface SchedulerClientContext extends PaimindClientContext {
  readonly remote: SchedulerRemote
  readonly sessions: HarnessSessionService
  readonly workspaces: HarnessWorkspaceService
  readonly conversation: HarnessConversationDraftService
  inject(
    dependencies: readonly string[],
    install: (ctx: SchedulerClientContext) => void,
  ): PromiseLike<unknown> & { dispose(): Promise<void> }
}

export interface SchedulerClientSnapshot extends PaimindSchedulerSnapshot {
  readonly open: boolean
  readonly view: 'tasks' | 'runs'
  readonly loading: boolean
  readonly saving: boolean
  readonly error: string | null
  readonly notice: string | null
}

const EMPTY: SchedulerClientSnapshot = Object.freeze({
  open: false,
  view: 'tasks',
  loading: false,
  saving: false,
  actions: Object.freeze([]),
  definitions: Object.freeze([]),
  runs: Object.freeze([]),
  error: null,
  notice: null,
})

const WORKSPACE_BOUND_AGENT_ACTIONS = new Set([
  'paimind:agent-workspace-brief',
  'paimind:agent-prompt',
])

function remoteValue<Value>(result: HarnessRemoteResult<Value>): Value {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

export class SchedulerController {
  private snapshot: SchedulerClientSnapshot = EMPTY
  private readonly listeners = new Set<() => void>()
  private pollTimer: number | undefined
  private requestEpoch = 0
  private disposed = false

  constructor(
    private readonly remote: SchedulerRemoteNamespace,
    private readonly sessions: HarnessSessionService,
    private readonly workspaces: HarnessWorkspaceService,
    private readonly conversation: HarnessConversationDraftService,
  ) {}

  getSnapshot(): SchedulerClientSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  open(): void {
    this.publish({ ...this.snapshot, open: true, error: null, notice: null })
    this.activate()
  }

  close(): void {
    this.publish({ ...this.snapshot, open: false })
  }

  activate(): void {
    if (this.pollTimer === undefined) {
      this.pollTimer = window.setInterval(() => { if (!this.snapshot.loading) void this.refresh() }, 5_000)
    }
    if (!this.snapshot.loading) void this.refresh()
  }

  toggle(): void { this.snapshot.open ? this.close() : this.open() }
  selectView(view: SchedulerClientSnapshot['view']): void { this.publish({ ...this.snapshot, view }) }
  clearFeedback(): void {
    if (this.snapshot.error === null && this.snapshot.notice === null) return
    this.publish({ ...this.snapshot, error: null, notice: null })
  }

  async refresh(): Promise<void> {
    const epoch = ++this.requestEpoch
    this.publish({ ...this.snapshot, loading: true, error: null })
    try {
      const value = remoteValue(await this.remote.list())
      if (this.disposed || epoch !== this.requestEpoch) return
      this.publish({ ...this.snapshot, ...value, loading: false })
    } catch (error) {
      if (this.disposed || epoch !== this.requestEpoch) return
      this.publish({ ...this.snapshot, loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  async create(input: PaimindScheduleCreateInput): Promise<boolean> {
    return await this.mutate(async () => {
      remoteValue(await this.remote.create(this.bindCurrentWorkspace(input)))
    }, 'Task created')
  }

  async startConversation(): Promise<boolean> {
    this.publish({ ...this.snapshot, saving: true, error: null, notice: null })
    try {
      const sessionId = await this.resolveBlankConversation()
      const binding = this.sessions.binding?.(sessionId)
      if (binding?.ctx === undefined) throw new Error('新对话尚未准备好接收任务说明')
      this.conversation.input.for(binding.ctx).setDraft(SCHEDULE_STARTER_PROMPT)
      this.sessions.open(sessionId)
      this.publish({ ...this.snapshot, saving: false, notice: '默认指引已填入对话，可修改后发送' })
      return true
    } catch (error) {
      this.publish({ ...this.snapshot, saving: false, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  scheduledSessionIds(): ReadonlySet<string> {
    const ids = new Set<string>()
    for (const definition of this.snapshot.definitions) {
      if (definition.sourceSessionId !== undefined) ids.add(definition.sourceSessionId)
    }
    for (const run of this.snapshot.runs) {
      if (run.action?.kind === 'session') ids.add(run.action.sessionId)
    }
    return ids
  }

  async update(input: PaimindScheduleUpdateInput): Promise<boolean> {
    return await this.mutate(async () => {
      const result = remoteValue(await this.remote.update(this.bindCurrentWorkspace(input)))
      if (!result.ok) throw new Error(result.message)
    }, 'Task updated')
  }

  async setEnabled(definition: PaimindScheduleDefinition, enabled: boolean): Promise<boolean> {
    return await this.mutate(async () => {
      const result = remoteValue(await this.remote.setEnabled({
        scheduleId: definition.scheduleId, ifVersion: definition.version, enabled,
      }))
      if (!result.ok) throw new Error(result.message)
    }, enabled ? 'Scheduled runs enabled' : 'Scheduled runs paused')
  }

  async runNow(definition: PaimindScheduleDefinition): Promise<boolean> {
    const ok = await this.mutate(async () => {
      const result = remoteValue(await this.remote.runNow({ scheduleId: definition.scheduleId }))
      if (!result.ok) throw new Error(result.message)
    }, 'Run started; the schedule is unchanged')
    if (ok) this.selectView('runs')
    return ok
  }

  async archive(definition: PaimindScheduleDefinition): Promise<boolean> {
    return await this.mutate(async () => {
      const result = remoteValue(await this.remote.archive({
        scheduleId: definition.scheduleId, ifVersion: definition.version,
      }))
      if (!result.ok) throw new Error(result.message)
    }, 'Task archived; run history is retained')
  }

  async restore(definition: PaimindScheduleDefinition): Promise<boolean> {
    return await this.mutate(async () => {
      const result = remoteValue(await this.remote.restore({
        scheduleId: definition.scheduleId, ifVersion: definition.version,
      }))
      if (!result.ok) throw new Error(result.message)
    }, 'Task restored as paused')
  }

  openAction(action: PaimindScheduleRunAction): void {
    if (action.kind === 'session') this.sessions.open(action.sessionId)
    else window.open(action.url, '_blank', 'noopener,noreferrer')
  }

  openSession(sessionId: string): void { this.sessions.open(sessionId) }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer)
    this.listeners.clear()
  }

  private async resolveBlankConversation(timeoutMs = 10_000): Promise<string> {
    const before = this.sessions.list.getSnapshot()
    if (before.current !== undefined && before.byId[before.current]?.blank === true) return before.current
    const previous = before.current
    return await new Promise<string>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      const inspect = (): void => {
        if (settled) return
        const snapshot = this.sessions.list.getSnapshot()
        const current = snapshot.current
        if (current === undefined || current === previous || snapshot.byId[current]?.blank !== true) return
        settled = true
        clearTimeout(timer)
        unsubscribe()
        resolve(current)
      }
      const unsubscribe = this.sessions.list.subscribe(inspect)
      timer = setTimeout(() => { settled = true; unsubscribe(); reject(new Error('创建任务配置对话超时')) }, timeoutMs)
      this.workspaces.startSession()
      inspect()
    })
  }

  private async mutate(operation: () => Promise<void>, notice: string): Promise<boolean> {
    this.publish({ ...this.snapshot, saving: true, error: null, notice: null })
    try {
      await operation()
      this.publish({ ...this.snapshot, saving: false, notice })
      await this.refresh()
      return true
    } catch (error) {
      this.publish({
        ...this.snapshot, saving: false,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  private bindCurrentWorkspace<Input extends PaimindScheduleCreateInput>(input: Input): Input {
    if (!WORKSPACE_BOUND_AGENT_ACTIONS.has(input.actionId)) return input
    const existingCwd = input.actionInput?.cwd
    const existingPreset = input.actionInput?.agentPreset
    const sessionSnapshot = this.sessions.list.getSnapshot()
    const current = sessionSnapshot.current
    const currentRow = current === undefined ? undefined : sessionSnapshot.byId[current]
    const hasExistingCwd = typeof existingCwd === 'string' && existingCwd.trim() !== ''
    const cwd = hasExistingCwd
      ? existingCwd.trim()
      : currentRow?.cwd?.trim()
    if (cwd === undefined || cwd === '') {
      throw new Error('当前会话尚未绑定 Harness Workspace，无法创建定时任务')
    }
    const agentPreset = typeof existingPreset === 'string' && existingPreset.trim() !== ''
      ? existingPreset.trim()
      : hasExistingCwd ? undefined : currentRow?.agentPreset?.trim()
    const actionInput = input.actionId === 'paimind:agent-workspace-brief'
      ? {
          kind: 'workspace-context', version: 1, cwd,
          ...(agentPreset === undefined || agentPreset === '' ? {} : { agentPreset }),
        }
      : {
          ...input.actionInput, kind: 'agent-prompt', version: 1, cwd,
          ...(agentPreset === undefined || agentPreset === '' ? {} : { agentPreset }),
        }
    return Object.freeze({ ...input, actionInput })
  }

  private publish(snapshot: SchedulerClientSnapshot): void {
    if (this.disposed) return
    this.snapshot = Object.freeze(snapshot)
    for (const listener of [...this.listeners]) listener()
  }
}

export const SCHEDULE_STARTER_PROMPT = '我们一起来设置一个已安排任务吧。首先，说明已安排任务在 PAIMind 中的工作方式。然后询问我需要安排什么，以及应该在什么时候运行。'

const STYLE_ID = '@paimind/platform-scheduler'
const STYLE = `
[data-paimind-scheduler-trigger]{width:calc(100% + 8px);min-height:36px;margin:4px -4px;padding:7px 10px;display:flex;align-items:center;gap:9px;border:0;border-radius:14px;color:var(--dsw-alias-label-primary,#172033);background:transparent;font:inherit;font-size:14px;cursor:pointer}
[data-paimind-scheduler-trigger]:hover,[data-paimind-scheduler-trigger]:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(80,100,140,.1))}
[data-paimind-scheduler-trigger][data-wide='false']{width:38px;height:38px;margin:7px 0;padding:0;justify-content:center;border-radius:50%}
[data-paimind-scheduler-compact-label]{font-size:11px;font-weight:750;letter-spacing:-.04em}
[data-paimind-scheduler-settings]{display:grid;gap:18px;min-width:0;padding:24px;color:var(--dsw-alias-label-primary,#172033);container-type:inline-size}
[data-paimind-scheduler-settings] h2{margin:0;font-size:22px;line-height:30px}
[data-paimind-scheduler-content]{display:grid;gap:14px;min-width:0}
[data-paimind-scheduler-settings] [data-paimind-scheduler-toolbar]{margin:0}
[data-paimind-scheduler-overlay]{position:fixed;inset:0;z-index:2147482990;display:flex;justify-content:flex-end}
[data-paimind-scheduler-mask]{position:absolute;inset:0;border:0;background:rgba(12,20,36,.34);backdrop-filter:blur(3px)}
[data-paimind-scheduler-panel]{position:relative;z-index:1;width:min(980px,100vw);height:100%;box-sizing:border-box;overflow:auto;padding:28px;color:var(--dsw-alias-label-primary,#172033);background:var(--dsw-alias-bg-layer-1,#fff);border-left:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.16));box-shadow:-18px 0 60px rgba(15,24,40,.16)}
[data-paimind-scheduler-header]{display:flex;align-items:center;gap:14px}
[data-paimind-scheduler-header] h2{margin:0;font-size:24px;letter-spacing:-.02em}
[data-paimind-scheduler-close]{margin-left:auto;width:38px;height:38px;border:0;border-radius:50%;color:inherit;background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.08));font-size:23px;cursor:pointer}
[data-paimind-scheduler-toolbar]{display:flex;align-items:center;gap:10px;margin:22px 0 18px}
[data-paimind-scheduler-search]{flex:1;min-width:160px}
[data-paimind-scheduler-search] input{width:100%;min-height:42px;box-sizing:border-box;padding:9px 14px;border:1px solid var(--dsw-alias-border-l2,rgba(110,125,150,.22));border-radius:999px;color:var(--dsw-alias-label-primary,#172033);background:var(--dsw-alias-bg-layer-1,#fff);font:inherit}
[data-paimind-scheduler-filters]{display:flex;gap:6px}
[data-paimind-scheduler-filters] button{min-height:34px;padding:6px 13px;border:0;border-radius:999px;color:var(--dsw-alias-label-secondary,#56627a);background:transparent;font:inherit;font-size:13px;font-weight:650;cursor:pointer}
[data-paimind-scheduler-filters] button[aria-selected='true']{color:var(--dsw-alias-label-primary,#172033);background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.09))}
[data-paimind-scheduler-tabs]{display:flex;gap:4px;padding:4px;border-radius:16px;background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.08))}
[data-paimind-scheduler-tab]{min-height:36px;padding:7px 15px;border:0;border-radius:12px;color:var(--dsw-alias-label-secondary,#56627a);background:transparent;font:inherit;font-weight:650;cursor:pointer}
[data-paimind-scheduler-tab][aria-selected='true']{color:var(--dsw-alias-state-business-primary,#326af5);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 2px 10px rgba(30,50,90,.09)}
[data-paimind-scheduler-primary]{margin-left:auto;min-height:40px;padding:8px 16px;border:0;border-radius:14px;color:#fff;background:var(--dsw-alias-state-business-primary,#326af5);font:inherit;font-weight:700;cursor:pointer}
[data-paimind-scheduler-primary]:disabled{opacity:.55;cursor:not-allowed}
[data-paimind-scheduler-type-section]{display:grid;gap:8px}
[data-paimind-scheduler-type-label]{color:var(--dsw-alias-label-secondary,#56627a);font-size:12px;font-weight:700}
[data-paimind-scheduler-task-types]{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
[data-paimind-scheduler-task-type]{min-height:44px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(110,125,150,.22));border-radius:13px;color:var(--dsw-alias-label-secondary,#56627a);background:var(--dsw-alias-bg-layer-1,#fff);font:inherit;font-size:13px;font-weight:650;cursor:pointer}
[data-paimind-scheduler-task-type][aria-checked='true']{border-color:var(--dsw-alias-state-business-primary,#326af5);color:var(--dsw-alias-state-business-primary,#326af5);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#326af5) 8%,transparent);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#326af5) 10%,transparent)}
[data-paimind-scheduler-capability-empty]{padding:28px 18px;border:1px dashed var(--dsw-alias-border-l2,rgba(110,125,150,.24));border-radius:18px;color:var(--dsw-alias-label-tertiary,#78849a);text-align:center;font-size:13px}
[data-paimind-scheduler-editor]{display:grid;gap:16px}
[data-paimind-scheduler-editor-header]{display:flex;align-items:flex-start;gap:12px}
[data-paimind-scheduler-editor-header] h3{margin:0;font-size:18px}
[data-paimind-scheduler-form]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:0 0 18px;padding:20px;border:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.16));border-radius:22px;background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.045))}
[data-paimind-scheduler-form] label{display:grid;gap:6px;color:var(--dsw-alias-label-secondary,#56627a);font-size:12px;font-weight:650}
[data-paimind-scheduler-form] input,[data-paimind-scheduler-form] select,[data-paimind-scheduler-form] textarea{width:100%;min-height:42px;box-sizing:border-box;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(110,125,150,.22));border-radius:13px;color:var(--dsw-alias-label-primary,#172033);background:var(--dsw-alias-bg-layer-1,#fff);font:inherit;font-size:13px}
[data-paimind-scheduler-form] textarea{min-height:112px;resize:vertical;line-height:19px}
[data-paimind-scheduler-form] [data-wide='true']{grid-column:1/-1}
[data-paimind-scheduler-form] [data-paimind-scheduler-check]{display:flex;align-items:center;gap:9px;min-height:42px;padding:0 2px;color:var(--dsw-alias-label-primary,#172033);font-size:13px}
[data-paimind-scheduler-form] [data-paimind-scheduler-check] input{width:18px;min-height:18px;margin:0}
[data-paimind-scheduler-combobox]{position:relative;min-width:0}
[data-paimind-scheduler-combobox]:after{content:'⌄';position:absolute;right:13px;top:9px;color:var(--dsw-alias-label-tertiary,#78849a);font-size:18px;line-height:20px;pointer-events:none}
[data-paimind-scheduler-combobox] input{padding-right:38px}
[data-paimind-scheduler-combobox] input[aria-expanded='true']{border-color:var(--dsw-alias-state-business-primary,#326af5);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#326af5) 12%,transparent);outline:0}
[data-paimind-scheduler-combobox-menu]{position:absolute;z-index:20;top:calc(100% + 6px);left:0;right:0;max-height:240px;overflow:auto;padding:5px;border:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.18));border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 16px 38px rgba(15,24,40,.16)}
[data-paimind-scheduler-combobox-option]{display:block;width:100%;min-height:38px;padding:9px 10px;border:0;border-radius:10px;color:var(--dsw-alias-label-primary,#172033);background:transparent;font:inherit;font-size:13px;text-align:left;cursor:pointer}
[data-paimind-scheduler-combobox-option]:hover,[data-paimind-scheduler-combobox-option][data-active='true']{color:var(--dsw-alias-state-business-primary,#326af5);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#326af5) 9%,transparent)}
[data-paimind-scheduler-combobox-option][aria-selected='true']{font-weight:700}
[data-paimind-scheduler-combobox-empty]{padding:14px 10px;color:var(--dsw-alias-label-tertiary,#78849a);font-size:12px;font-weight:500;text-align:center}
[data-paimind-scheduler-form-actions]{grid-column:1/-1;display:flex;justify-content:flex-end;gap:9px}
[data-paimind-scheduler-secondary],[data-paimind-scheduler-row-action]{min-height:36px;padding:7px 12px;border:0;border-radius:12px;color:var(--dsw-alias-label-secondary,#56627a);background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.09));font:inherit;font-weight:650;cursor:pointer}
[data-paimind-scheduler-row-action][data-emphasis='true']{color:var(--dsw-alias-state-business-primary,#326af5);background:color-mix(in srgb,currentColor 9%,transparent)}
[data-paimind-scheduler-row-action]:disabled{opacity:.45;cursor:not-allowed}
[data-paimind-scheduler-status]{margin:0 0 14px;padding:10px 13px;border-radius:14px;color:var(--dsw-alias-label-secondary,#56627a);background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.08));font-size:12px}
[data-paimind-scheduler-status][data-error='true']{color:var(--dsw-alias-state-error-primary,#c83c3c)}
[data-paimind-scheduler-table]{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.15));border-radius:20px;background:var(--dsw-alias-bg-layer-1,#fff)}
[data-paimind-scheduler-table] th{padding:13px 14px;text-align:left;color:var(--dsw-alias-label-tertiary,#78849a);background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.045));font-size:11px;font-weight:700}
[data-paimind-scheduler-table] td{padding:15px 14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.12));vertical-align:top;font-size:13px}
[data-paimind-scheduler-table] strong{display:block;line-height:20px}
[data-paimind-scheduler-task-link]{padding:0;border:0;color:inherit;background:transparent;font:inherit;text-align:left;cursor:pointer}
[data-paimind-scheduler-task-link]:hover{color:var(--dsw-alias-state-business-primary,#326af5)}
[data-paimind-scheduler-muted]{margin-top:3px;color:var(--dsw-alias-label-tertiary,#78849a);font-size:11px;line-height:17px}
[data-paimind-scheduler-badge]{display:inline-flex;align-items:center;min-height:25px;padding:3px 9px;border-radius:999px;color:var(--dsw-alias-label-secondary,#56627a);background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.09));font-size:11px;font-weight:700}
[data-paimind-scheduler-badge]{white-space:nowrap}
[data-paimind-scheduler-badge][data-status='running']{color:var(--dsw-alias-state-business-primary,#326af5);background:color-mix(in srgb,currentColor 9%,transparent)}
[data-paimind-scheduler-badge][data-status='succeeded'],[data-paimind-scheduler-badge][data-status='enabled']{color:#16835f;background:color-mix(in srgb,currentColor 9%,transparent)}
[data-paimind-scheduler-badge][data-status='failed'],[data-paimind-scheduler-badge][data-status='needs_attention']{color:var(--dsw-alias-state-error-primary,#c83c3c);background:color-mix(in srgb,currentColor 9%,transparent)}
[data-paimind-scheduler-badge][data-status='archived']{color:var(--dsw-alias-label-tertiary,#78849a);background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.09))}
[data-paimind-scheduler-capability]{display:grid;gap:3px}
[data-paimind-scheduler-capability] small{color:var(--dsw-alias-label-tertiary,#78849a);font-size:10px}
[data-paimind-scheduler-row-actions]{display:flex;gap:7px;flex-wrap:wrap}
[data-paimind-scheduler-empty]{padding:48px 24px;border:1px dashed var(--dsw-alias-border-l2,rgba(110,125,150,.24));border-radius:20px;color:var(--dsw-alias-label-tertiary,#78849a);text-align:center;font-size:13px}
[data-paimind-scheduler-detail]{display:grid;gap:18px}
[data-paimind-scheduler-detail-header]{display:flex;align-items:flex-start;gap:14px}
[data-paimind-scheduler-detail-header] h3,[data-paimind-scheduler-detail-runs] h3{margin:0;font-size:18px}
[data-paimind-scheduler-detail-header] p{margin:4px 0 0;color:var(--dsw-alias-label-tertiary,#78849a);font-size:12px}
[data-paimind-scheduler-detail-summary]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
[data-paimind-scheduler-detail-summary]>div,[data-paimind-scheduler-instruction]{display:grid;gap:6px;padding:14px;border:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.15));border-radius:16px;background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.045))}
[data-paimind-scheduler-detail-summary] span,[data-paimind-scheduler-instruction]>span{color:var(--dsw-alias-label-tertiary,#78849a);font-size:11px;font-weight:700}
[data-paimind-scheduler-instruction] p{margin:0;white-space:pre-wrap;color:var(--dsw-alias-label-secondary,#56627a);font-size:13px;line-height:20px}
[data-paimind-scheduler-detail-runs]{display:grid;gap:10px;margin-top:8px}
@container(max-width:760px){[data-paimind-scheduler-settings] [data-paimind-scheduler-form]{grid-template-columns:1fr}[data-paimind-scheduler-settings] [data-paimind-scheduler-form] [data-wide='true']{grid-column:auto}[data-paimind-scheduler-settings] [data-paimind-scheduler-task-types]{grid-template-columns:repeat(3,minmax(0,1fr))}[data-paimind-scheduler-settings] [data-paimind-scheduler-table] thead{display:none}[data-paimind-scheduler-settings] [data-paimind-scheduler-table],[data-paimind-scheduler-settings] [data-paimind-scheduler-table] tbody,[data-paimind-scheduler-settings] [data-paimind-scheduler-table] tr,[data-paimind-scheduler-settings] [data-paimind-scheduler-table] td{display:block;width:100%;box-sizing:border-box}[data-paimind-scheduler-settings] [data-paimind-scheduler-table]{border:0;background:transparent}[data-paimind-scheduler-settings] [data-paimind-scheduler-table] tr{display:grid;gap:8px;margin-bottom:12px;padding:14px;border:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.15));border-radius:16px;background:var(--dsw-alias-bg-layer-1,#fff)}[data-paimind-scheduler-settings] [data-paimind-scheduler-table] td{display:grid;grid-template-columns:88px minmax(0,1fr);gap:10px;align-items:start;padding:0;border:0;line-height:20px}[data-paimind-scheduler-settings] [data-paimind-scheduler-table] td:before{content:attr(data-label);color:var(--dsw-alias-label-tertiary,#78849a);font-size:11px;font-weight:700}[data-paimind-scheduler-settings] [data-paimind-scheduler-row-actions]{margin-top:2px}}
@container(max-width:480px){[data-paimind-scheduler-settings]{gap:14px;padding:16px}[data-paimind-scheduler-settings] [data-paimind-scheduler-toolbar]{flex-direction:column;align-items:stretch}[data-paimind-scheduler-settings] [data-paimind-scheduler-search]{width:100%;min-width:0}[data-paimind-scheduler-settings] [data-paimind-scheduler-primary]{width:100%;margin-left:0;white-space:nowrap}[data-paimind-scheduler-settings] [data-paimind-scheduler-task-types]{grid-template-columns:repeat(2,minmax(0,1fr))}[data-paimind-scheduler-settings] [data-paimind-scheduler-filters]{flex-wrap:wrap}[data-paimind-scheduler-settings] [data-paimind-scheduler-detail-header]{flex-direction:column}[data-paimind-scheduler-settings] [data-paimind-scheduler-detail-summary]{grid-template-columns:1fr}}
@media(max-width:600px){[role='dialog'][aria-modal='true']:has([data-paimind-scheduler-settings]){flex-direction:column!important}[role='dialog'][aria-modal='true']:has([data-paimind-scheduler-settings])>nav{width:100%!important;max-width:none!important;max-height:96px;box-sizing:border-box;padding:10px 12px!important;border-right:0!important;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.16));overflow:hidden}[role='dialog'][aria-modal='true']:has([data-paimind-scheduler-settings])>nav>:first-child{display:none!important}[role='dialog'][aria-modal='true']:has([data-paimind-scheduler-settings])>nav>:last-child{display:flex!important;flex-direction:row!important;gap:6px;overflow-x:auto;overscroll-behavior-inline:contain;scrollbar-width:thin}[role='dialog'][aria-modal='true']:has([data-paimind-scheduler-settings])>nav>:last-child>*{flex:0 0 auto}[role='dialog'][aria-modal='true']:has([data-paimind-scheduler-settings])>nav+*{width:100%!important;min-width:0!important;flex:1 1 auto!important}}
@media(max-width:760px){[data-paimind-scheduler-panel]{padding:18px}[data-paimind-scheduler-task-types]{grid-template-columns:repeat(3,minmax(0,1fr))}[data-paimind-scheduler-form]{grid-template-columns:1fr}[data-paimind-scheduler-table] thead{display:none}[data-paimind-scheduler-table],[data-paimind-scheduler-table] tbody,[data-paimind-scheduler-table] tr,[data-paimind-scheduler-table] td{display:block;width:100%;box-sizing:border-box}[data-paimind-scheduler-table] tr{padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.12))}[data-paimind-scheduler-table] td{padding:7px 14px;border:0}}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = '@paimind/platform-scheduler'
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}

function useZh(locale: PaimindLocaleSource): boolean {
  return useSyncExternalStore(
    listener => locale.subscribe(listener),
    () => locale.getLocale().active.toLowerCase().startsWith('zh'),
    () => false,
  )
}

function ClockIcon(): React.JSX.Element {
  return <svg viewBox="0 0 18 18" width="17" height="17" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="6.4" stroke="currentColor" strokeWidth="1.4"/><path d="M9 5.3v4l2.7 1.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

const COMMON_TIME_ZONES = Object.freeze([
  'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Tokyo',
  'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'Australia/Sydney', 'UTC',
])

function timeZoneOptions(current: string): readonly string[] {
  const supported = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : []
  return Object.freeze([...new Set([current, ...COMMON_TIME_ZONES, ...supported])])
}

function weekdayLabel(weekday: number, zh: boolean): string {
  const labels = zh
    ? ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  return labels[weekday - 1] ?? String(weekday)
}

function ruleLabel(rule: PaimindScheduleRule, zh: boolean): string {
  if (rule.kind === 'once') return new Date(rule.at).toLocaleString(zh ? 'zh-CN' : 'en-US')
  if (rule.kind === 'daily') return `${zh ? '每天' : 'Daily'} ${rule.time}`
  if (rule.kind === 'weekdays') return `${zh ? '工作日' : 'Weekdays'} ${rule.time}`
  if (rule.kind === 'weekly') return `${zh ? '每周' : 'Weekly'} ${weekdayLabel(rule.weekday, zh)} · ${rule.time}`
  return `${zh ? '每月' : 'Monthly'} ${zh ? `${rule.dayOfMonth} 日` : `day ${rule.dayOfMonth}`} · ${rule.time}`
}

function runStatus(status: PaimindScheduleRun['status'], zh: boolean): string {
  const labels = zh
    ? { queued: '等待执行', running: '执行中', succeeded: '成功', failed: '失败', needs_attention: '待处理' }
    : { queued: 'Queued', running: 'Running', succeeded: 'Succeeded', failed: 'Failed', needs_attention: 'Needs attention' }
  return labels[status]
}

function scheduleStatus(
  definition: PaimindScheduleDefinition,
  latest: PaimindScheduleRun | undefined,
  zh: boolean,
): string {
  if (definition.status === 'archived') return zh ? '已归档' : 'Archived'
  if (definition.status === 'enabled') return zh ? '已启用' : 'Enabled'
  if (definition.rule.kind === 'once' && Date.parse(definition.rule.at) <= Date.now()) {
    return latest === undefined ? (zh ? '已过期' : 'Expired') : (zh ? '已执行' : 'Executed')
  }
  return zh ? '已暂停' : 'Paused'
}

function actionTypeLabel(category: PaimindScheduleActionCategory, zh: boolean): string {
  const labels = zh
    ? { ai: '智能任务', workflow: '工作流', message: '消息任务', integration: '集成任务', 'health-check': '监测任务' }
    : { ai: 'Smart task', workflow: 'Workflow', message: 'Message task', integration: 'Integration', 'health-check': 'Monitor' }
  return labels[category]
}

function noticeLabel(notice: string, zh: boolean): string {
  const labels: Readonly<Record<string, readonly [string, string]>> = {
    'Task created': ['任务已创建', 'Task created'],
    'Task updated': ['任务已更新', 'Task updated'],
    'Scheduled runs enabled': ['已恢复自动执行', 'Scheduled runs enabled'],
    'Scheduled runs paused': ['已暂停自动执行', 'Scheduled runs paused'],
    'Run started; the schedule is unchanged': ['已开始运行，原计划保持不变', 'Run started; the schedule is unchanged'],
    'Task archived; run history is retained': ['任务已归档，运行历史仍保留', 'Task archived; run history is retained'],
    'Task restored as paused': ['任务已恢复，并保持暂停', 'Task restored as paused'],
    '默认指引已填入对话，可修改后发送': ['默认指引已填入对话，可修改后发送', 'Editable guidance was added to the conversation draft'],
  }
  const label = labels[notice]
  return label === undefined ? notice : label[zh ? 0 : 1]
}

export function SchedulerTrigger(props: {
  readonly wide: boolean
  readonly controller: SchedulerController
  readonly locale: PaimindLocaleSource
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(listener => props.controller.subscribe(listener), () => props.controller.getSnapshot())
  const zh = useZh(props.locale)
  const label = zh ? '平台定时任务' : 'Platform Scheduler'
  return <button type="button" data-paimind-scheduler-trigger data-wide={props.wide} aria-label={zh ? '打开平台定时任务' : 'Open Platform Scheduler'} title={label} aria-expanded={snapshot.open} onClick={() => { props.controller.toggle() }}>{props.wide ? <><ClockIcon /><span>{label}</span></> : <span data-paimind-scheduler-compact-label>{zh ? '定时' : 'Timer'}</span>}</button>
}

export function SchedulerSettingsEntry(props: {
  readonly controller: SchedulerController
  readonly locale: PaimindLocaleSource
  readonly close?: () => void
}): React.JSX.Element {
  const zh = useZh(props.locale)
  useEffect(() => {
    props.controller.open()
    return () => { props.controller.close() }
  }, [props.controller])
  return <section data-paimind-scheduler-settings aria-label={zh ? '平台定时任务' : 'Platform Scheduler'}>
    <h2>{zh ? '平台定时任务' : 'Platform Scheduler'}</h2>
    <SchedulerWorkspace controller={props.controller} zh={zh} {...(props.close === undefined ? {} : { onLeave: props.close })} />
  </section>
}

interface ScheduleFormProps {
  readonly initial?: PaimindScheduleDefinition
  readonly category?: PaimindScheduleActionCategory
  readonly actions: readonly Readonly<PaimindScheduleActionDescriptor>[]
  readonly saving: boolean
  readonly zh: boolean
  readonly onCancel: () => void
  readonly onSave: (input: PaimindScheduleCreateInput) => void
}

function localDateTimeInput(epoch: number): string {
  const value = new Date(epoch)
  return new Date(epoch - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function ScheduleForm(props: ScheduleFormProps): React.JSX.Element {
  const initial = props.initial
  const initialRule = initial?.rule
  const availableActions = props.actions.filter(action => (
    action.enabled && (props.category === undefined || action.category === props.category)
  ))
  const [actionId, setActionId] = useState(initial?.actionId ?? availableActions[0]?.actionId ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const initialPrompt = initial?.actionInput?.prompt
  const [prompt, setPrompt] = useState(typeof initialPrompt === 'string' ? initialPrompt : '')
  const [kind, setKind] = useState<PaimindScheduleRule['kind']>(initialRule?.kind ?? 'daily')
  const [time, setTime] = useState(initialRule !== undefined && initialRule.kind !== 'once' ? initialRule.time : '09:00')
  const [onceAt, setOnceAt] = useState(() => {
    const epoch = initialRule?.kind === 'once' ? Date.parse(initialRule.at) : Date.now() + 3_600_000
    return localDateTimeInput(epoch)
  })
  const [weekday, setWeekday] = useState(initialRule?.kind === 'weekly' ? initialRule.weekday : 1)
  const [dayOfMonth, setDayOfMonth] = useState(initialRule?.kind === 'monthly' ? initialRule.dayOfMonth : 1)
  const [timeZone, setTimeZone] = useState(initial?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Asia/Shanghai')
  const [enabled, setEnabled] = useState(
    initial === undefined || initial.status === 'enabled'
    || (initialRule?.kind === 'once' && Date.parse(initialRule.at) <= Date.now()),
  )
  const selectedAction = props.actions.find(action => action.actionId === actionId)
  const isGenericPrompt = actionId === 'paimind:agent-prompt'
  const onceMinimum = localDateTimeInput(Date.now() + 60_000)
  const submit = (): void => {
    if (selectedAction === undefined) return
    let rule: PaimindScheduleRule
    if (kind === 'once') rule = { kind, at: new Date(onceAt).toISOString() }
    else if (kind === 'daily' || kind === 'weekdays') rule = { kind, time }
    else if (kind === 'weekly') rule = { kind, weekday, time }
    else rule = { kind, dayOfMonth, time }
    const actionInput = isGenericPrompt
      ? { ...(initial?.actionInput ?? {}), kind: 'agent-prompt', version: 1, prompt: prompt.trim() }
      : initial?.actionInput
    props.onSave({
      name: name.trim(), actionId,
      ...(actionInput === undefined ? {} : { actionInput }),
      ...(initial?.sourceSessionId === undefined ? {} : { sourceSessionId: initial.sourceSessionId }),
      rule, timeZone, enabled,
    })
  }
  return <form data-paimind-scheduler-form onSubmit={event => { event.preventDefault(); submit() }}>
    {initial === undefined
      ? <label data-wide="true">{props.zh ? '具体工作' : 'Specific work'}<select required aria-label={props.zh ? '具体工作' : 'Specific work'} value={actionId} onChange={event => { setActionId(event.target.value) }}><option value="" disabled>{props.zh ? '选择具体工作' : 'Choose specific work'}</option>{availableActions.map(action => <option key={action.actionId} value={action.actionId}>{props.zh ? action.nameZh : action.nameEn}</option>)}</select></label>
      : <><label>{props.zh ? '工作类型' : 'Task type'}<input value={actionTypeLabel(selectedAction?.category ?? 'ai', props.zh)} disabled /></label><label>{props.zh ? '具体工作' : 'Specific work'}<input value={selectedAction === undefined ? (props.zh ? '当前工作不可用' : 'Current work unavailable') : props.zh ? selectedAction.nameZh : selectedAction.nameEn} disabled /></label></>}
    <label>{props.zh ? '任务名称' : 'Task name'}<input required maxLength={160} value={name} onChange={event => { setName(event.target.value) }} /></label>
    <label>{props.zh ? '执行周期' : 'Frequency'}<select value={kind} onChange={event => { setKind(event.target.value as PaimindScheduleRule['kind']) }}><option value="once">{props.zh ? '一次' : 'Once'}</option><option value="daily">{props.zh ? '每天' : 'Daily'}</option><option value="weekdays">{props.zh ? '工作日' : 'Weekdays'}</option><option value="weekly">{props.zh ? '每周' : 'Weekly'}</option><option value="monthly">{props.zh ? '每月' : 'Monthly'}</option></select></label>
    {kind === 'once' && <label>{props.zh ? '执行时间' : 'Run at'}<input type="datetime-local" required min={onceMinimum} value={onceAt} onInput={event => { setOnceAt(event.currentTarget.value) }} /></label>}
    {kind === 'weekly' && <label>{props.zh ? '星期' : 'Weekday'}<select value={weekday} onChange={event => { setWeekday(Number(event.target.value) as 1 | 2 | 3 | 4 | 5 | 6 | 7) }}>{[1, 2, 3, 4, 5, 6, 7].map(value => <option key={value} value={value}>{weekdayLabel(value, props.zh)}</option>)}</select></label>}
    {kind === 'monthly' && <label>{props.zh ? '每月日期' : 'Day of month'}<select value={dayOfMonth} onChange={event => { setDayOfMonth(Number(event.target.value)) }}>{Array.from({ length: 28 }, (_, index) => index + 1).map(value => <option key={value} value={value}>{props.zh ? `${value} 日` : `Day ${value}`}</option>)}</select></label>}
    {kind !== 'once' && <label>{props.zh ? '执行时间' : 'Run time'}<input type="time" required value={time} onInput={event => { setTime(event.currentTarget.value) }} /></label>}
    <label>{props.zh ? '时区' : 'Time zone'}<input list="paimind-scheduler-timezones" required value={timeZone} onChange={event => { setTimeZone(event.target.value) }} /><datalist id="paimind-scheduler-timezones">{timeZoneOptions(timeZone).map(value => <option key={value} value={value} />)}</datalist></label>
    {isGenericPrompt && <label data-wide="true">{props.zh ? '任务说明' : 'Task instructions'}<textarea required maxLength={16_000} value={prompt} placeholder={props.zh ? '说明任务要做什么、使用哪些信息，以及希望得到什么结果。' : 'Describe the work, available information, and expected result.'} onChange={event => { setPrompt(event.target.value) }} /></label>}
    <label data-paimind-scheduler-check><input type="checkbox" checked={enabled} onChange={event => { setEnabled(event.currentTarget.checked) }} /><span>{props.zh ? '保存后启用自动执行' : 'Enable automatic runs after saving'}</span></label>
    <div data-paimind-scheduler-form-actions><button type="button" data-paimind-scheduler-secondary onClick={props.onCancel}>{props.zh ? '取消' : 'Cancel'}</button><button type="submit" data-paimind-scheduler-primary disabled={props.saving || selectedAction === undefined}>{props.saving ? (props.zh ? '保存中…' : 'Saving…') : (props.zh ? '保存' : 'Save')}</button></div>
  </form>
}

function TaskTable(props: {
  readonly snapshot: SchedulerClientSnapshot
  readonly definitions: readonly PaimindScheduleDefinition[]
  readonly controller: SchedulerController
  readonly zh: boolean
  readonly onOpen: (definition: PaimindScheduleDefinition) => void
  readonly onEdit: (definition: PaimindScheduleDefinition) => void
}): React.JSX.Element {
  if (props.definitions.length === 0) return <div data-paimind-scheduler-empty>{props.zh ? '没有符合当前条件的平台定时任务。' : 'No platform scheduled tasks match the current filters.'}</div>
  const actionById = new Map(props.snapshot.actions.map(action => [action.actionId, action]))
  return <table data-paimind-scheduler-table><thead><tr><th>{props.zh ? '任务' : 'Task'}</th><th>{props.zh ? '类型与能力' : 'Type and capability'}</th><th>{props.zh ? '时间' : 'Schedule'}</th><th>{props.zh ? '状态' : 'Status'}</th><th>{props.zh ? '下次执行' : 'Next run'}</th><th>{props.zh ? '最近结果' : 'Latest result'}</th><th>{props.zh ? '操作' : 'Actions'}</th></tr></thead><tbody>{props.definitions.map(definition => {
    const action = actionById.get(definition.actionId)
    const actionAvailable = action?.enabled === true
    const latest = props.snapshot.runs.find(run => run.scheduleId === definition.scheduleId)
    const active = props.snapshot.runs.some(run => run.scheduleId === definition.scheduleId && (run.status === 'queued' || run.status === 'running'))
    const expiredOnce = definition.rule.kind === 'once' && Date.parse(definition.rule.at) <= Date.now()
    const archived = definition.status === 'archived'
    return <tr key={definition.scheduleId} data-disabled={!actionAvailable || expiredOnce}>
      <td data-label={props.zh ? '任务' : 'Task'}><button type="button" data-paimind-scheduler-task-link onClick={() => { props.onOpen(definition) }}><strong>{definition.name}</strong></button></td>
      <td data-label={props.zh ? '类型与能力' : 'Type and capability'}><span data-paimind-scheduler-capability><strong>{action === undefined ? (props.zh ? '能力不可用' : 'Unavailable') : actionTypeLabel(action.category, props.zh)}</strong><small>{action === undefined ? '—' : props.zh ? action.nameZh : action.nameEn}</small></span></td>
      <td data-label={props.zh ? '时间' : 'Schedule'}>{ruleLabel(definition.rule, props.zh)}</td>
      <td data-label={props.zh ? '状态' : 'Status'}><span data-paimind-scheduler-badge data-status={definition.status}>{scheduleStatus(definition, latest, props.zh)}</span></td>
      <td data-label={props.zh ? '下次执行' : 'Next run'}>{definition.nextRunAt === undefined ? '—' : new Date(definition.nextRunAt).toLocaleString(props.zh ? 'zh-CN' : 'en-US')}</td>
      <td data-label={props.zh ? '最近结果' : 'Latest result'}>{active ? <span data-paimind-scheduler-badge data-status="running">{props.zh ? '执行中' : 'Running'}</span> : latest === undefined ? '—' : <span data-paimind-scheduler-badge data-status={latest.status}>{runStatus(latest.status, props.zh)}</span>}</td>
      <td data-label={props.zh ? '操作' : 'Actions'}><div data-paimind-scheduler-row-actions>{archived
        ? <button type="button" data-paimind-scheduler-row-action data-emphasis="true" disabled={props.snapshot.saving} onClick={() => { void props.controller.restore(definition) }}>{props.zh ? '恢复任务' : 'Restore'}</button>
        : <><button type="button" data-paimind-scheduler-row-action data-emphasis="true" disabled={props.snapshot.saving || active || !actionAvailable} onClick={() => { void props.controller.runNow(definition) }}>{props.zh ? '立即运行' : 'Run now'}</button><button type="button" data-paimind-scheduler-row-action disabled={props.snapshot.saving} onClick={() => { props.onEdit(definition) }}>{props.zh ? '编辑' : 'Edit'}</button>{definition.status === 'enabled'
          ? <button type="button" data-paimind-scheduler-row-action disabled={props.snapshot.saving} onClick={() => { void props.controller.setEnabled(definition, false) }}>{props.zh ? '暂停' : 'Pause'}</button>
          : expiredOnce ? null : <button type="button" data-paimind-scheduler-row-action disabled={props.snapshot.saving} onClick={() => { void props.controller.setEnabled(definition, true) }}>{props.zh ? '恢复运行' : 'Resume'}</button>}<button type="button" data-paimind-scheduler-row-action disabled={props.snapshot.saving} onClick={() => { void props.controller.archive(definition) }}>{props.zh ? '归档' : 'Archive'}</button></>}</div></td>
    </tr>
  })}</tbody></table>
}

function taskPrompt(definition: PaimindScheduleDefinition): string | undefined {
  const value = definition.actionInput?.prompt
  return typeof value === 'string' ? value : undefined
}

function TaskDetail(props: {
  readonly definition: PaimindScheduleDefinition
  readonly snapshot: SchedulerClientSnapshot
  readonly controller: SchedulerController
  readonly zh: boolean
  readonly onBack: () => void
  readonly onEdit: () => void
}): React.JSX.Element {
  const definition = props.definition
  const runs = props.snapshot.runs.filter(run => run.scheduleId === definition.scheduleId)
  const action = props.snapshot.actions.find(candidate => candidate.actionId === definition.actionId)
  const actionAvailable = action?.enabled === true
  const active = runs.some(run => run.status === 'queued' || run.status === 'running')
  const expiredOnce = definition.rule.kind === 'once' && Date.parse(definition.rule.at) <= Date.now()
  const archived = definition.status === 'archived'
  const prompt = taskPrompt(definition)
  return <section data-paimind-scheduler-detail>
    <header data-paimind-scheduler-detail-header><button type="button" data-paimind-scheduler-secondary onClick={props.onBack}>{props.zh ? '返回任务列表' : 'Back to tasks'}</button><div><h3>{definition.name}</h3><p>{ruleLabel(definition.rule, props.zh)} · {definition.timeZone}</p></div></header>
    <div data-paimind-scheduler-detail-summary>
      <div><span>{props.zh ? '类型与能力' : 'Type and capability'}</span><strong>{action === undefined ? '—' : `${actionTypeLabel(action.category, props.zh)} · ${props.zh ? action.nameZh : action.nameEn}`}</strong></div>
      <div><span>{props.zh ? '状态' : 'Status'}</span><strong>{scheduleStatus(definition, runs[0], props.zh)}</strong></div>
      <div><span>{props.zh ? '下次执行' : 'Next run'}</span><strong>{definition.nextRunAt === undefined ? '—' : new Date(definition.nextRunAt).toLocaleString(props.zh ? 'zh-CN' : 'en-US')}</strong></div>
    </div>
    {prompt !== undefined && <div data-paimind-scheduler-instruction><span>{props.zh ? '任务说明' : 'Task instructions'}</span><p>{prompt}</p></div>}
    <div data-paimind-scheduler-row-actions>
      {definition.sourceSessionId !== undefined && <button type="button" data-paimind-scheduler-row-action onClick={() => { props.controller.openSession(definition.sourceSessionId!) }}>{props.zh ? '打开配置对话' : 'Open setup conversation'}</button>}
      {archived
        ? <button type="button" data-paimind-scheduler-row-action data-emphasis="true" disabled={props.snapshot.saving} onClick={() => { void props.controller.restore(definition).then(ok => { if (ok) props.onBack() }) }}>{props.zh ? '恢复任务' : 'Restore task'}</button>
        : <><button type="button" data-paimind-scheduler-row-action data-emphasis="true" disabled={props.snapshot.saving || active || !actionAvailable} onClick={() => { void props.controller.runNow(definition) }}>{props.zh ? '立即运行' : 'Run now'}</button>
      <button type="button" data-paimind-scheduler-row-action onClick={props.onEdit}>{props.zh ? '编辑任务' : 'Edit task'}</button>
      {definition.status === 'enabled'
        ? <button type="button" data-paimind-scheduler-row-action onClick={() => { void props.controller.setEnabled(definition, false) }}>{props.zh ? '暂停' : 'Pause'}</button>
        : expiredOnce ? null : <button type="button" data-paimind-scheduler-row-action onClick={() => { void props.controller.setEnabled(definition, true) }}>{props.zh ? '恢复' : 'Resume'}</button>}
      <button type="button" data-paimind-scheduler-row-action onClick={() => { void props.controller.archive(definition).then(ok => { if (ok) props.onBack() }) }}>{props.zh ? '归档' : 'Archive'}</button></>}
    </div>
    <div data-paimind-scheduler-detail-runs><h3>{props.zh ? '运行历史' : 'Run history'}</h3><RunTable runs={runs} controller={props.controller} zh={props.zh} /></div>
  </section>
}

function RunTable(props: { readonly runs: readonly PaimindScheduleRun[]; readonly controller: SchedulerController; readonly zh: boolean }): React.JSX.Element {
  if (props.runs.length === 0) return <div data-paimind-scheduler-empty>{props.zh ? '暂无运行记录。定时触发或选择“立即运行”后会生成记录。' : 'No run records yet. Scheduled and manual runs both appear here.'}</div>
  return <table data-paimind-scheduler-table><thead><tr><th>{props.zh ? '触发方式' : 'Trigger'}</th><th>{props.zh ? '触发时间' : 'Triggered at'}</th><th>{props.zh ? '实际开始' : 'Started'}</th><th>{props.zh ? '状态' : 'Status'}</th><th>{props.zh ? '结果说明' : 'Result'}</th><th>{props.zh ? '操作' : 'Action'}</th></tr></thead><tbody>{props.runs.map(run => <tr key={run.runId}><td data-label={props.zh ? '触发方式' : 'Trigger'}>{run.trigger === 'manual' ? (props.zh ? '手动触发' : 'Manual run') : (props.zh ? '定时触发' : 'Scheduled run')}</td><td data-label={props.zh ? '触发时间' : 'Triggered at'}>{new Date(run.scheduledFor).toLocaleString(props.zh ? 'zh-CN' : 'en-US')}</td><td data-label={props.zh ? '实际开始' : 'Started'}>{run.startedAt === undefined ? '—' : new Date(run.startedAt).toLocaleString(props.zh ? 'zh-CN' : 'en-US')}</td><td data-label={props.zh ? '状态' : 'Status'}><span data-paimind-scheduler-badge data-status={run.status}>{runStatus(run.status, props.zh)}{run.status === 'running' && run.progress !== undefined ? ` · ${Math.round(run.progress)}%` : ''}</span></td><td data-label={props.zh ? '结果说明' : 'Result'}>{run.message ?? '—'}</td><td data-label={props.zh ? '操作' : 'Action'}>{run.action === undefined ? '—' : <button type="button" data-paimind-scheduler-row-action onClick={() => { props.controller.openAction(run.action!) }}>{run.action.label}</button>}</td></tr>)}</tbody></table>
}

type NewTaskType = Extract<PaimindScheduleActionCategory, 'ai' | 'workflow' | 'message'>

const NEW_TASK_TYPES: readonly NewTaskType[] = Object.freeze(['ai', 'workflow', 'message'])

function NewTaskEditor(props: {
  readonly controller: SchedulerController
  readonly actions: readonly Readonly<PaimindScheduleActionDescriptor>[]
  readonly saving: boolean
  readonly zh: boolean
  readonly onCancel: () => void
  readonly onSave: (input: PaimindScheduleCreateInput) => void
  readonly onLeave?: () => void
}): React.JSX.Element {
  const [taskType, setTaskType] = useState<NewTaskType>('ai')
  const available = props.actions.filter(action => action.enabled && action.category === taskType)
  return <section data-paimind-scheduler-editor>
    <header data-paimind-scheduler-editor-header><button type="button" data-paimind-scheduler-secondary onClick={props.onCancel}>{props.zh ? '返回任务列表' : 'Back to tasks'}</button><h3>{props.zh ? '新建任务' : 'New task'}</h3><button type="button" data-paimind-scheduler-primary disabled={props.saving} onClick={() => { void props.controller.startConversation().then(ok => { if (ok) props.onLeave?.() }) }}>{props.saving ? (props.zh ? '正在准备…' : 'Preparing…') : (props.zh ? '用 AI 帮我创建' : 'Create with AI')}</button></header>
    <div data-paimind-scheduler-type-section>
      <span data-paimind-scheduler-type-label>{props.zh ? '工作类型' : 'Task type'}</span>
      <div role="radiogroup" aria-label={props.zh ? '工作类型' : 'Task type'} data-paimind-scheduler-task-types>
        {NEW_TASK_TYPES.map(type => <button key={type} type="button" role="radio" aria-checked={taskType === type} data-paimind-scheduler-task-type onClick={() => { setTaskType(type) }}>{actionTypeLabel(type, props.zh)}</button>)}
      </div>
    </div>
    {available.length === 0
      ? <div data-paimind-scheduler-capability-empty>{props.zh ? `暂无已接入的${actionTypeLabel(taskType, true)}` : `No ${actionTypeLabel(taskType, false).toLowerCase()} work is connected yet.`}</div>
      : <ScheduleForm key={taskType} category={taskType} actions={props.actions} saving={props.saving} zh={props.zh} onCancel={props.onCancel} onSave={props.onSave} />}
  </section>
}

function SchedulerWorkspace(props: {
  readonly controller: SchedulerController
  readonly zh: boolean
  readonly onLeave?: () => void
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(listener => props.controller.subscribe(listener), () => props.controller.getSnapshot())
  const [editing, setEditing] = useState<PaimindScheduleDefinition | null>(null)
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'enabled' | 'paused' | 'archived'>('all')
  const selected = selectedId === null ? undefined : snapshot.definitions.find(item => item.scheduleId === selectedId)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const definitions = snapshot.definitions.filter(definition => {
    if (filter === 'all' ? definition.status === 'archived' : definition.status !== filter) return false
    return normalizedQuery === '' || definition.name.toLocaleLowerCase().includes(normalizedQuery)
  })
  const saveEdit = (input: PaimindScheduleCreateInput): void => {
    const done = props.controller.update({ ...input, scheduleId: editing!.scheduleId, ifVersion: editing!.version })
    void done.then(ok => { if (ok) setEditing(null) })
  }
  const saveCreate = (input: PaimindScheduleCreateInput): void => {
    void props.controller.create(input).then(ok => { if (ok) setCreating(false) })
  }
  return <div data-paimind-scheduler-content>
    {(snapshot.loading || snapshot.error !== null || snapshot.notice !== null) && <div role="status" data-paimind-scheduler-status data-error={snapshot.error !== null}>{snapshot.error ?? (snapshot.loading ? (props.zh ? '正在刷新…' : 'Refreshing…') : noticeLabel(snapshot.notice!, props.zh))}</div>}
    {creating && <NewTaskEditor controller={props.controller} actions={snapshot.actions} saving={snapshot.saving} zh={props.zh} onCancel={() => { setCreating(false) }} onSave={saveCreate} {...(props.onLeave === undefined ? {} : { onLeave: props.onLeave })} />}
    {editing !== null && <section data-paimind-scheduler-editor><header data-paimind-scheduler-editor-header><button type="button" data-paimind-scheduler-secondary onClick={() => { setEditing(null) }}>{props.zh ? '返回' : 'Back'}</button><h3>{props.zh ? '编辑任务' : 'Edit task'}</h3></header><ScheduleForm key={editing.version} initial={editing} actions={snapshot.actions} saving={snapshot.saving} zh={props.zh} onCancel={() => { setEditing(null) }} onSave={saveEdit} /></section>}
    {!creating && editing === null && selected === undefined && <><div data-paimind-scheduler-toolbar><div data-paimind-scheduler-search><input aria-label={props.zh ? '搜索平台定时任务' : 'Search platform scheduled tasks'} placeholder={props.zh ? '搜索平台定时任务' : 'Search platform scheduled tasks'} value={query} onChange={event => { setQuery(event.target.value) }} /></div><button type="button" data-paimind-scheduler-primary disabled={snapshot.saving} onClick={() => { props.controller.clearFeedback(); setCreating(true) }}>{props.zh ? '新建任务' : 'New task'}</button></div>
    <div role="tablist" aria-label={props.zh ? '任务状态筛选' : 'Task status filters'} data-paimind-scheduler-filters>{(['all', 'enabled', 'paused', 'archived'] as const).map(value => <button key={value} role="tab" type="button" aria-selected={filter === value} onClick={() => { setFilter(value) }}>{value === 'all' ? (props.zh ? '全部' : 'All') : value === 'enabled' ? (props.zh ? '已启用' : 'Enabled') : value === 'paused' ? (props.zh ? '已暂停' : 'Paused') : (props.zh ? '已归档' : 'Archived')}</button>)}</div>
    <TaskTable definitions={definitions} snapshot={snapshot} controller={props.controller} zh={props.zh} onOpen={definition => { props.controller.clearFeedback(); setSelectedId(definition.scheduleId) }} onEdit={definition => { props.controller.clearFeedback(); setEditing(definition) }} /></>}
    {!creating && editing === null && selected !== undefined && <TaskDetail definition={selected} snapshot={snapshot} controller={props.controller} zh={props.zh} onBack={() => { setSelectedId(null); setEditing(null) }} onEdit={() => { props.controller.clearFeedback(); setEditing(selected) }} />}
  </div>
}

export function SchedulerOverlay(props: {
  readonly controller: SchedulerController
  readonly locale: PaimindLocaleSource
}): React.JSX.Element | null {
  const snapshot = useSyncExternalStore(listener => props.controller.subscribe(listener), () => props.controller.getSnapshot())
  const zh = useZh(props.locale)
  useEffect(() => {
    if (!snapshot.open) return
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') props.controller.close() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [snapshot.open, props.controller])
  if (!snapshot.open) return null
  return createPortal(<div data-paimind-scheduler-overlay>
    <button type="button" data-paimind-scheduler-mask aria-label={zh ? '关闭平台定时任务' : 'Close Platform Scheduler'} onClick={() => { props.controller.close() }} />
    <section role="dialog" aria-modal="true" aria-label={zh ? '平台定时任务' : 'Platform Scheduler'} data-paimind-scheduler-panel>
      <header data-paimind-scheduler-header><h2>{zh ? '平台定时任务' : 'Platform Scheduler'}</h2><button type="button" data-paimind-scheduler-close aria-label={zh ? '关闭平台定时任务' : 'Close Platform Scheduler'} onClick={() => { props.controller.close() }}>×</button></header>
      <SchedulerWorkspace controller={props.controller} zh={zh} onLeave={() => { props.controller.close() }} />
    </section>
  </div>, document.body)
}

class SchedulerBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.warn('[paimind-scheduler] render failed', error, info.componentStack) }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

export async function apply(ctx: SchedulerClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const mounted = ctx.inject([...BASE_INJECT, 'remote.paimindScheduler'], remoteCtx => {
    const remote = remoteCtx.remote.paimindScheduler
    if (remote === undefined) throw new Error('PAIMind Scheduler Remote did not mount')
    const controller = new SchedulerController(remote, remoteCtx.sessions, remoteCtx.workspaces, remoteCtx.conversation)
    controller.activate()
    contributePaimindExtension(remoteCtx.slots, {
      id: 'paimind:platform-scheduler', packageName: '@paimind/platform-scheduler', category: 'automation',
      nameZh: '平台定时任务', nameEn: 'Platform Scheduler',
      descriptionZh: '直接配置或通过 AI 辅助创建多类型任务，并管理计划和运行结果。',
      descriptionEn: 'Configure multiple task types directly or with AI assistance, then manage schedules and results.',
      surface: 'settings', maturity: 'available', order: 30,
    })
    remoteCtx.effect(installStyle, 'paimind-scheduler: styles')
    remoteCtx.effect(() => installHarnessScheduledSessionMarkers({
      getSessionSnapshot: () => remoteCtx.sessions.list.getSnapshot(),
      getScheduledSessionIds: () => controller.scheduledSessionIds(),
      subscribe(listener) {
        const offScheduler = controller.subscribe(listener)
        const offSessions = remoteCtx.sessions.list.subscribe(listener)
        return () => { offSessions(); offScheduler() }
      },
    }), 'paimind-scheduler: native Session markers')
    remoteCtx.effect(() => {
      const disposeService = remoteCtx.reflect.provide('paimindSchedulerCenter', controller)
      return () => { controller.dispose(); void disposeService() }
    }, 'paimind-scheduler: controller')
    const injectProps = (): { readonly controller: SchedulerController; readonly locale: PaimindLocaleSource } => ({ controller, locale: remoteCtx.locale })
    remoteCtx.slots.inject('settings.section', () => remoteCtx.slots.register({
      name: 'settings.section', id: 'paimind-platform-scheduler', order: 17.5,
      label: () => remoteCtx.locale.getLocale().active.startsWith('zh') ? '平台定时任务' : 'Platform Scheduler',
      inject: injectProps,
    }, (slotProps: { readonly controller: SchedulerController; readonly locale: PaimindLocaleSource }) => <SchedulerBoundary><SchedulerSettingsEntry {...slotProps} /></SchedulerBoundary>))
  })
  try { await mounted } catch (error) { await disposeRemote(); throw error }
  return async () => { await mounted.dispose(); await disposeRemote() }
}
