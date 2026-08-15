import {
  Component,
  useEffect,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type {
  PaimindScheduleCreateInput,
  PaimindScheduleActionCategory,
  PaimindScheduleDefinition,
  PaimindScheduleRule,
  PaimindScheduleRun,
  PaimindScheduleRunAction,
  PaimindScheduleUpdateInput,
} from '@paimind/contracts'
import {
  contributePaimindExtension,
  type HarnessRemoteMountService,
  type HarnessRemoteResult,
  type HarnessSessionService,
  type PaimindClientContext,
  type PaimindLocaleSource,
} from '@paimind/harness-compat'
import type {
  PaimindScheduleArchiveRequest,
  PaimindSchedulerSnapshot,
  PaimindScheduleSetEnabledRequest,
  PaimindScheduleRunNowRequest,
} from '../index.js'
import type { PaimindScheduleMutationResult, PaimindScheduleRunNowResult } from '../core.js'
import TYPERT_REMOTE from '../remote.js'

const BASE_INJECT = ['slots', 'locale', 'remote', 'sessions'] as const
export const inject = [...BASE_INJECT]

interface SchedulerRemoteNamespace {
  list(): Promise<HarnessRemoteResult<PaimindSchedulerSnapshot>>
  create(input: PaimindScheduleCreateInput): Promise<HarnessRemoteResult<Readonly<PaimindScheduleDefinition>>>
  update(input: PaimindScheduleUpdateInput): Promise<HarnessRemoteResult<PaimindScheduleMutationResult>>
  setEnabled(input: PaimindScheduleSetEnabledRequest): Promise<HarnessRemoteResult<PaimindScheduleMutationResult>>
  runNow(input: PaimindScheduleRunNowRequest): Promise<HarnessRemoteResult<PaimindScheduleRunNowResult>>
  archive(input: PaimindScheduleArchiveRequest): Promise<HarnessRemoteResult<PaimindScheduleMutationResult>>
}

interface SchedulerRemote extends HarnessRemoteMountService {
  readonly paimindScheduler?: SchedulerRemoteNamespace
}

export interface SchedulerClientContext extends PaimindClientContext {
  readonly remote: SchedulerRemote
  readonly sessions: HarnessSessionService
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
  ) {}

  getSnapshot(): SchedulerClientSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  open(): void {
    this.publish({ ...this.snapshot, open: true })
    void this.refresh()
    this.pollTimer = window.setInterval(() => { if (!this.snapshot.loading) void this.refresh() }, 5_000)
  }

  close(): void {
    if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer)
    this.pollTimer = undefined
    this.publish({ ...this.snapshot, open: false })
  }

  toggle(): void { this.snapshot.open ? this.close() : this.open() }
  selectView(view: SchedulerClientSnapshot['view']): void { this.publish({ ...this.snapshot, view }) }

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
    return await this.mutate(async () => { remoteValue(await this.remote.create(input)) }, 'Task created')
  }

  async update(input: PaimindScheduleUpdateInput): Promise<boolean> {
    return await this.mutate(async () => {
      const result = remoteValue(await this.remote.update(input))
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

  openAction(action: PaimindScheduleRunAction): void {
    if (action.kind === 'session') this.sessions.open(action.sessionId)
    else window.open(action.url, '_blank', 'noopener,noreferrer')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer)
    this.listeners.clear()
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

  private publish(snapshot: SchedulerClientSnapshot): void {
    if (this.disposed) return
    this.snapshot = Object.freeze(snapshot)
    for (const listener of [...this.listeners]) listener()
  }
}

const STYLE_ID = '@paimind/platform-scheduler'
const STYLE = `
[data-paimind-scheduler-trigger]{width:calc(100% + 8px);min-height:36px;margin:4px -4px;padding:7px 10px;display:flex;align-items:center;gap:9px;border:0;border-radius:14px;color:var(--dsw-alias-label-primary,#172033);background:transparent;font:inherit;font-size:14px;cursor:pointer}
[data-paimind-scheduler-trigger]:hover,[data-paimind-scheduler-trigger]:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(80,100,140,.1))}
[data-paimind-scheduler-trigger][data-wide='false']{width:38px;height:38px;margin:7px 0;padding:0;justify-content:center;border-radius:50%}
[data-paimind-scheduler-compact-label]{font-size:11px;font-weight:750;letter-spacing:-.04em}
[data-paimind-scheduler-settings]{display:grid;gap:16px;padding:24px;color:var(--dsw-alias-label-primary,#172033)}
[data-paimind-scheduler-settings] h2{margin:0;font-size:22px;line-height:30px}
[data-paimind-scheduler-settings] p{margin:0;max-width:680px;color:var(--dsw-alias-label-secondary,#56627a);font-size:13px;line-height:20px}
[data-paimind-scheduler-settings] button{justify-self:start;min-height:40px;padding:8px 16px;border:0;border-radius:12px;color:#fff;background:var(--dsw-alias-state-business-primary,#326af5);font:inherit;font-weight:700;cursor:pointer}
[data-paimind-scheduler-overlay]{position:fixed;inset:0;z-index:2147482990;display:flex;justify-content:flex-end}
[data-paimind-scheduler-mask]{position:absolute;inset:0;border:0;background:rgba(12,20,36,.34);backdrop-filter:blur(3px)}
[data-paimind-scheduler-panel]{position:relative;z-index:1;width:min(980px,100vw);height:100%;box-sizing:border-box;overflow:auto;padding:28px;color:var(--dsw-alias-label-primary,#172033);background:var(--dsw-alias-bg-layer-1,#fff);border-left:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.16));box-shadow:-18px 0 60px rgba(15,24,40,.16)}
[data-paimind-scheduler-header]{display:flex;align-items:center;gap:14px}
[data-paimind-scheduler-header] h2{margin:0;font-size:24px;letter-spacing:-.02em}
[data-paimind-scheduler-header] p{margin:4px 0 0;color:var(--dsw-alias-label-tertiary,#78849a);font-size:13px}
[data-paimind-scheduler-close]{margin-left:auto;width:38px;height:38px;border:0;border-radius:50%;color:inherit;background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.08));font-size:23px;cursor:pointer}
[data-paimind-scheduler-toolbar]{display:flex;align-items:center;gap:10px;margin:22px 0 18px}
[data-paimind-scheduler-tabs]{display:flex;gap:4px;padding:4px;border-radius:16px;background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.08))}
[data-paimind-scheduler-tab]{min-height:36px;padding:7px 15px;border:0;border-radius:12px;color:var(--dsw-alias-label-secondary,#56627a);background:transparent;font:inherit;font-weight:650;cursor:pointer}
[data-paimind-scheduler-tab][aria-selected='true']{color:var(--dsw-alias-state-business-primary,#326af5);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 2px 10px rgba(30,50,90,.09)}
[data-paimind-scheduler-primary]{margin-left:auto;min-height:40px;padding:8px 16px;border:0;border-radius:14px;color:#fff;background:var(--dsw-alias-state-business-primary,#326af5);font:inherit;font-weight:700;cursor:pointer}
[data-paimind-scheduler-primary]:disabled{opacity:.55;cursor:not-allowed}
[data-paimind-scheduler-form]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:0 0 18px;padding:20px;border:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.16));border-radius:22px;background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.045))}
[data-paimind-scheduler-form-note]{grid-column:1/-1;margin:0;padding:11px 13px;border-radius:14px;color:var(--dsw-alias-label-secondary,#56627a);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#326af5) 7%,transparent);font-size:12px;line-height:18px}
[data-paimind-scheduler-form] label{display:grid;gap:6px;color:var(--dsw-alias-label-secondary,#56627a);font-size:12px;font-weight:650}
[data-paimind-scheduler-form] input,[data-paimind-scheduler-form] select{width:100%;min-height:42px;box-sizing:border-box;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(110,125,150,.22));border-radius:13px;color:var(--dsw-alias-label-primary,#172033);background:var(--dsw-alias-bg-layer-1,#fff);font:inherit;font-size:13px}
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
[data-paimind-scheduler-muted]{margin-top:3px;color:var(--dsw-alias-label-tertiary,#78849a);font-size:11px;line-height:17px}
[data-paimind-scheduler-badge]{display:inline-flex;align-items:center;min-height:25px;padding:3px 9px;border-radius:999px;color:var(--dsw-alias-label-secondary,#56627a);background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.09));font-size:11px;font-weight:700}
[data-paimind-scheduler-badge]{white-space:nowrap}
[data-paimind-scheduler-badge][data-status='running']{color:var(--dsw-alias-state-business-primary,#326af5);background:color-mix(in srgb,currentColor 9%,transparent)}
[data-paimind-scheduler-badge][data-status='succeeded'],[data-paimind-scheduler-badge][data-status='enabled']{color:#16835f;background:color-mix(in srgb,currentColor 9%,transparent)}
[data-paimind-scheduler-badge][data-status='failed'],[data-paimind-scheduler-badge][data-status='needs_attention']{color:var(--dsw-alias-state-error-primary,#c83c3c);background:color-mix(in srgb,currentColor 9%,transparent)}
[data-paimind-scheduler-row-actions]{display:flex;gap:7px;flex-wrap:wrap}
[data-paimind-scheduler-empty]{padding:48px 24px;border:1px dashed var(--dsw-alias-border-l2,rgba(110,125,150,.24));border-radius:20px;color:var(--dsw-alias-label-tertiary,#78849a);text-align:center;font-size:13px}
@media(max-width:760px){[data-paimind-scheduler-panel]{padding:18px}[data-paimind-scheduler-form]{grid-template-columns:1fr}[data-paimind-scheduler-table] thead{display:none}[data-paimind-scheduler-table],[data-paimind-scheduler-table] tbody,[data-paimind-scheduler-table] tr,[data-paimind-scheduler-table] td{display:block;width:100%;box-sizing:border-box}[data-paimind-scheduler-table] tr{padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.12))}[data-paimind-scheduler-table] td{padding:7px 14px;border:0}}
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

function actionCategoryLabel(category: PaimindScheduleActionCategory, zh: boolean): string {
  const labels = zh
    ? { ai: 'AI 与 Agent', integration: '业务系统', message: '消息发送', 'health-check': '健康检查' }
    : { ai: 'AI and Agent', integration: 'Business systems', message: 'Messaging', 'health-check': 'Health checks' }
  return labels[category]
}

function ruleLabel(rule: PaimindScheduleRule, zh: boolean): string {
  if (rule.kind === 'once') return new Date(rule.at).toLocaleString(zh ? 'zh-CN' : 'en-US')
  if (rule.kind === 'daily') return `${zh ? '每天' : 'Daily'} ${rule.time}`
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
  if (definition.status === 'enabled') return zh ? '调度中' : 'Scheduled'
  if (definition.rule.kind === 'once' && Date.parse(definition.rule.at) <= Date.now()) {
    return latest === undefined ? (zh ? '已过期' : 'Expired') : (zh ? '已执行' : 'Executed')
  }
  return zh ? '已暂停' : 'Paused'
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
}): React.JSX.Element {
  const zh = useZh(props.locale)
  return <section data-paimind-scheduler-settings aria-label={zh ? '平台定时任务' : 'Platform Scheduler'}>
    <h2>{zh ? '平台定时任务' : 'Platform Scheduler'}</h2>
    <p>{zh ? '配置平台级自动执行任务并查看每次运行结果。业务逻辑由已登记的执行事项负责。' : 'Configure platform-level automatic tasks and inspect every run. Registered actions own the business logic.'}</p>
    <button type="button" onClick={() => { props.controller.open() }}>{zh ? '打开任务列表' : 'Open task list'}</button>
  </section>
}

interface ScheduleFormProps {
  readonly initial?: PaimindScheduleDefinition
  readonly actions: PaimindSchedulerSnapshot['actions']
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
  const [name, setName] = useState(initial?.name ?? '')
  const [actionId, setActionId] = useState(initial?.actionId ?? props.actions.find(action => action.enabled)?.actionId ?? '')
  const [kind, setKind] = useState<PaimindScheduleRule['kind']>(initialRule?.kind ?? 'daily')
  const [time, setTime] = useState(initialRule !== undefined && initialRule.kind !== 'once' ? initialRule.time : '09:00')
  const [onceAt, setOnceAt] = useState(() => {
    const epoch = initialRule?.kind === 'once' ? Date.parse(initialRule.at) : Date.now() + 3_600_000
    return localDateTimeInput(epoch)
  })
  const [weekday, setWeekday] = useState(initialRule?.kind === 'weekly' ? initialRule.weekday : 1)
  const [dayOfMonth, setDayOfMonth] = useState(initialRule?.kind === 'monthly' ? initialRule.dayOfMonth : 1)
  const [timeZone, setTimeZone] = useState(initial?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC')
  const [enabled, setEnabled] = useState(
    initial === undefined || initial.status === 'enabled'
    || (initialRule?.kind === 'once' && Date.parse(initialRule.at) <= Date.now()),
  )
  const actionOptions = props.actions.filter(action => action.enabled || action.actionId === initial?.actionId)
  const actionCategories: readonly PaimindScheduleActionCategory[] = ['ai', 'integration', 'message', 'health-check']
  const onceMinimum = localDateTimeInput(Date.now() + 60_000)
  const submit = (): void => {
    let rule: PaimindScheduleRule
    if (kind === 'once') rule = { kind, at: new Date(onceAt).toISOString() }
    else if (kind === 'daily') rule = { kind, time }
    else if (kind === 'weekly') rule = { kind, weekday, time }
    else rule = { kind, dayOfMonth, time }
    props.onSave({ name, actionId, rule, timeZone, enabled })
  }
  return <form data-paimind-scheduler-form onSubmit={event => { event.preventDefault(); submit() }}>
    <p data-paimind-scheduler-form-note>{props.zh
      ? '定时设置控制未来自动执行；保存后可在任务列表选择“立即运行”，它会真实执行一次，但不会改变下次执行时间。'
      : 'The schedule controls future automatic runs. Run now executes once immediately without changing the next run.'}</p>
    <label>{props.zh ? '任务名称' : 'Task name'}<input required maxLength={160} value={name} onChange={event => { setName(event.target.value) }} /></label>
    <label>{props.zh ? '执行事项' : 'Action'}<select required value={actionId} onChange={event => { setActionId(event.target.value) }}>{actionCategories.map(category => {
      const actions = actionOptions.filter(action => action.category === category)
      return actions.length === 0 ? null : <optgroup key={category} label={actionCategoryLabel(category, props.zh)}>{actions.map(action => <option key={action.actionId} value={action.actionId}>{props.zh ? action.nameZh : action.nameEn}</option>)}</optgroup>
    })}</select></label>
    <label>{props.zh ? '执行周期' : 'Frequency'}<select value={kind} onChange={event => { setKind(event.target.value as PaimindScheduleRule['kind']) }}><option value="once">{props.zh ? '一次' : 'Once'}</option><option value="daily">{props.zh ? '每天' : 'Daily'}</option><option value="weekly">{props.zh ? '每周' : 'Weekly'}</option><option value="monthly">{props.zh ? '每月' : 'Monthly'}</option></select></label>
    {kind === 'once' && <label>{props.zh ? '执行时间' : 'Run at'}<input type="datetime-local" required min={onceMinimum} value={onceAt} onInput={event => { setOnceAt(event.currentTarget.value) }} /></label>}
    {kind === 'weekly' && <label>{props.zh ? '星期' : 'Weekday'}<select value={weekday} onChange={event => { setWeekday(Number(event.target.value) as 1 | 2 | 3 | 4 | 5 | 6 | 7) }}>{[1, 2, 3, 4, 5, 6, 7].map(value => <option key={value} value={value}>{weekdayLabel(value, props.zh)}</option>)}</select></label>}
    {kind === 'monthly' && <label>{props.zh ? '每月日期' : 'Day of month'}<select value={dayOfMonth} onChange={event => { setDayOfMonth(Number(event.target.value)) }}>{Array.from({ length: 28 }, (_, index) => index + 1).map(value => <option key={value} value={value}>{props.zh ? `${value} 日` : `Day ${value}`}</option>)}</select></label>}
    {kind !== 'once' && <label>{props.zh ? '执行时间' : 'Run time'}<input type="time" required value={time} onInput={event => { setTime(event.currentTarget.value) }} /></label>}
    <label>{props.zh ? '时区' : 'Time zone'}<select required value={timeZone} onChange={event => { setTimeZone(event.target.value) }}>{timeZoneOptions(timeZone).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    <label><span>{props.zh ? '定时调度' : 'Scheduled runs'}</span><select value={enabled ? 'enabled' : 'paused'} onChange={event => { setEnabled(event.target.value === 'enabled') }}><option value="enabled">{props.zh ? '启用自动执行' : 'Enable automatic runs'}</option><option value="paused">{props.zh ? '暂不自动执行' : 'Keep automatic runs paused'}</option></select></label>
    <div data-paimind-scheduler-form-actions><button type="button" data-paimind-scheduler-secondary onClick={props.onCancel}>{props.zh ? '取消' : 'Cancel'}</button><button type="submit" data-paimind-scheduler-primary disabled={props.saving || actionId === ''}>{props.saving ? (props.zh ? '保存中…' : 'Saving…') : (props.zh ? '保存' : 'Save')}</button></div>
  </form>
}

function TaskTable(props: {
  readonly snapshot: SchedulerClientSnapshot
  readonly controller: SchedulerController
  readonly zh: boolean
  readonly onEdit: (definition: PaimindScheduleDefinition) => void
}): React.JSX.Element {
  if (props.snapshot.definitions.length === 0) return <div data-paimind-scheduler-empty>{props.zh ? '还没有定时任务。先从已登记的执行事项创建一个。' : 'No scheduled tasks yet. Create one from a registered action.'}</div>
  const actionById = new Map(props.snapshot.actions.map(action => [action.actionId, action]))
  return <table data-paimind-scheduler-table><thead><tr><th>{props.zh ? '任务' : 'Task'}</th><th>{props.zh ? '执行事项' : 'Action'}</th><th>{props.zh ? '时间' : 'Schedule'}</th><th>{props.zh ? '状态' : 'Status'}</th><th>{props.zh ? '下次执行' : 'Next run'}</th><th>{props.zh ? '最近结果' : 'Latest result'}</th><th>{props.zh ? '操作' : 'Actions'}</th></tr></thead><tbody>{props.snapshot.definitions.map(definition => {
    const action = actionById.get(definition.actionId)
    const actionAvailable = action?.enabled === true
    const latest = props.snapshot.runs.find(run => run.scheduleId === definition.scheduleId)
    const active = props.snapshot.runs.some(run => run.scheduleId === definition.scheduleId && (run.status === 'queued' || run.status === 'running'))
    const expiredOnce = definition.rule.kind === 'once' && Date.parse(definition.rule.at) <= Date.now()
    return <tr key={definition.scheduleId}>
      <td><strong>{definition.name}</strong></td>
      <td>{action === undefined ? definition.actionId : (props.zh ? action.nameZh : action.nameEn)}{!actionAvailable && ` ${props.zh ? '（不可用）' : '(unavailable)'}`}</td>
      <td>{ruleLabel(definition.rule, props.zh)}</td>
      <td><span data-paimind-scheduler-badge data-status={definition.status}>{scheduleStatus(definition, latest, props.zh)}</span></td>
      <td>{definition.nextRunAt === undefined ? '—' : new Date(definition.nextRunAt).toLocaleString(props.zh ? 'zh-CN' : 'en-US')}</td>
      <td>{latest === undefined ? '—' : <span data-paimind-scheduler-badge data-status={latest.status}>{runStatus(latest.status, props.zh)}</span>}</td>
      <td><div data-paimind-scheduler-row-actions>
        <button type="button" data-paimind-scheduler-row-action data-emphasis="true" disabled={props.snapshot.saving || active || !actionAvailable} title={!actionAvailable ? (props.zh ? '执行事项当前不可用' : 'Action currently unavailable') : active ? (props.zh ? '已有运行正在执行' : 'A run is already active') : (props.zh ? '立即真实执行一次，不改变原定时间' : 'Execute once now without changing the schedule')} onClick={() => { void props.controller.runNow(definition) }}>{props.zh ? '立即运行' : 'Run now'}</button>
        <button type="button" data-paimind-scheduler-row-action onClick={() => { props.onEdit(definition) }}>{props.zh ? '编辑' : 'Edit'}</button>
        {definition.status === 'enabled'
          ? <button type="button" data-paimind-scheduler-row-action onClick={() => { void props.controller.setEnabled(definition, false) }}>{props.zh ? '暂停' : 'Pause'}</button>
          : expiredOnce
            ? null
            : <button type="button" data-paimind-scheduler-row-action onClick={() => { void props.controller.setEnabled(definition, true) }}>{props.zh ? '启用' : 'Enable'}</button>}
        <button type="button" data-paimind-scheduler-row-action onClick={() => { void props.controller.archive(definition) }}>{props.zh ? '归档' : 'Archive'}</button>
      </div></td>
    </tr>
  })}</tbody></table>
}

function RunTable(props: { readonly runs: readonly PaimindScheduleRun[]; readonly controller: SchedulerController; readonly zh: boolean }): React.JSX.Element {
  if (props.runs.length === 0) return <div data-paimind-scheduler-empty>{props.zh ? '暂无运行记录。定时触发或选择“立即运行”后会生成记录。' : 'No run records yet. Scheduled and manual runs both appear here.'}</div>
  return <table data-paimind-scheduler-table><thead><tr><th>{props.zh ? '触发方式' : 'Trigger'}</th><th>{props.zh ? '触发时间' : 'Triggered at'}</th><th>{props.zh ? '实际开始' : 'Started'}</th><th>{props.zh ? '状态' : 'Status'}</th><th>{props.zh ? '结果说明' : 'Result'}</th><th>{props.zh ? '操作' : 'Action'}</th></tr></thead><tbody>{props.runs.map(run => <tr key={run.runId}><td>{run.trigger === 'manual' ? (props.zh ? '手动触发' : 'Manual run') : (props.zh ? '定时触发' : 'Scheduled run')}</td><td>{new Date(run.scheduledFor).toLocaleString(props.zh ? 'zh-CN' : 'en-US')}</td><td>{run.startedAt === undefined ? '—' : new Date(run.startedAt).toLocaleString(props.zh ? 'zh-CN' : 'en-US')}</td><td><span data-paimind-scheduler-badge data-status={run.status}>{runStatus(run.status, props.zh)}{run.status === 'running' && run.progress !== undefined ? ` · ${Math.round(run.progress)}%` : ''}</span></td><td>{run.message ?? '—'}</td><td>{run.action === undefined ? '—' : <button type="button" data-paimind-scheduler-row-action onClick={() => { props.controller.openAction(run.action!) }}>{run.action.label}</button>}</td></tr>)}</tbody></table>
}

export function SchedulerOverlay(props: {
  readonly controller: SchedulerController
  readonly locale: PaimindLocaleSource
}): React.JSX.Element | null {
  const snapshot = useSyncExternalStore(listener => props.controller.subscribe(listener), () => props.controller.getSnapshot())
  const zh = useZh(props.locale)
  const [editing, setEditing] = useState<PaimindScheduleDefinition | 'new' | null>(null)
  useEffect(() => {
    if (!snapshot.open) { setEditing(null); return }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') props.controller.close() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [snapshot.open, props.controller])
  if (!snapshot.open) return null
  const save = (input: PaimindScheduleCreateInput): void => {
    const done = editing === 'new'
      ? props.controller.create(input)
      : props.controller.update({ ...input, scheduleId: editing!.scheduleId, ifVersion: editing!.version })
    void done.then(ok => { if (ok) setEditing(null) })
  }
  return createPortal(<div data-paimind-scheduler-overlay>
    <button type="button" data-paimind-scheduler-mask aria-label={zh ? '关闭定时任务' : 'Close Scheduled Tasks'} onClick={() => { props.controller.close() }} />
    <section role="dialog" aria-modal="true" aria-label={zh ? '平台定时任务' : 'Platform Scheduler'} data-paimind-scheduler-panel>
      <header data-paimind-scheduler-header><div><h2>{zh ? '平台定时任务' : 'Platform Scheduler'}</h2><p>{zh ? '设置未来自动执行时间，也可以立即运行一次；立即运行不会改变原定时间。' : 'Schedule future automatic runs or run once now without changing the schedule.'}</p></div><button type="button" data-paimind-scheduler-close aria-label={zh ? '关闭平台定时任务' : 'Close Platform Scheduler'} onClick={() => { props.controller.close() }}>×</button></header>
      <div data-paimind-scheduler-toolbar><div role="tablist" data-paimind-scheduler-tabs><button role="tab" type="button" data-paimind-scheduler-tab aria-selected={snapshot.view === 'tasks'} onClick={() => { props.controller.selectView('tasks') }}>{zh ? '任务列表' : 'Task list'}</button><button role="tab" type="button" data-paimind-scheduler-tab aria-selected={snapshot.view === 'runs'} onClick={() => { props.controller.selectView('runs') }}>{zh ? '运行记录' : 'Run records'}</button></div>{snapshot.view === 'tasks' && <button type="button" data-paimind-scheduler-primary onClick={() => { setEditing('new') }}>{zh ? '新建任务' : 'New task'}</button>}</div>
      {editing !== null && <ScheduleForm key={editing === 'new' ? 'new' : editing.version} {...(editing === 'new' ? {} : { initial: editing })} actions={snapshot.actions} saving={snapshot.saving} zh={zh} onCancel={() => { setEditing(null) }} onSave={save} />}
      {(snapshot.loading || snapshot.error !== null) && <div role="status" data-paimind-scheduler-status data-error={snapshot.error !== null}>{snapshot.error ?? (zh ? '正在刷新…' : 'Refreshing…')}</div>}
      {snapshot.view === 'tasks' ? <TaskTable snapshot={snapshot} controller={props.controller} zh={zh} onEdit={setEditing} /> : <RunTable runs={snapshot.runs} controller={props.controller} zh={zh} />}
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
    const controller = new SchedulerController(remote, remoteCtx.sessions)
    contributePaimindExtension(remoteCtx.slots, {
      id: 'paimind:platform-scheduler', packageName: '@paimind/platform-scheduler', category: 'automation',
      nameZh: '平台定时任务', nameEn: 'Platform Scheduler',
      descriptionZh: '在设置中管理平台级时间触发、任务定义与运行记录。',
      descriptionEn: 'Manage platform-level time triggers, task definitions, and run records in Settings.',
      surface: 'settings', maturity: 'available', order: 30,
    })
    remoteCtx.effect(installStyle, 'paimind-scheduler: styles')
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
    remoteCtx.slots.inject('shell.overlay', () => remoteCtx.slots.register({
      name: 'shell.overlay', id: 'paimind-scheduler-overlay', order: 30, inject: injectProps,
    }, (slotProps: { readonly controller: SchedulerController; readonly locale: PaimindLocaleSource }) => <SchedulerBoundary><SchedulerOverlay {...slotProps} /></SchedulerBoundary>))
  })
  try { await mounted } catch (error) { await disposeRemote(); throw error }
  return async () => { await mounted.dispose(); await disposeRemote() }
}
