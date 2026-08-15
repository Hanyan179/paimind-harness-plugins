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
  contributePaimindExtension,
  type HarnessRemoteMountService,
  type HarnessRemoteResult,
  type HarnessSessionService,
  type PaimindClientContext,
  type PaimindLocaleSource,
} from '@paimind/harness-compat'
import type { PaimindNativeScheduleView } from '@paimind/harness-compat/host'
import type {
  PaimindNativeScheduleListRequest,
  PaimindNativeScheduleListValue,
} from '../index.js'
import TYPERT_REMOTE from '../remote.js'

const BASE_INJECT = ['slots', 'locale', 'remote', 'sessions'] as const
export const inject = [...BASE_INJECT]

interface ScheduleRemoteNamespace {
  list(request: PaimindNativeScheduleListRequest): Promise<HarnessRemoteResult<PaimindNativeScheduleListValue>>
}

interface ScheduleRemote extends HarnessRemoteMountService {
  readonly paimindSchedule?: ScheduleRemoteNamespace
}

export interface NativeSchedulerClientContext extends PaimindClientContext {
  readonly remote: ScheduleRemote
  readonly sessions: HarnessSessionService
  inject(
    dependencies: readonly string[],
    install: (ctx: NativeSchedulerClientContext) => void,
  ): PromiseLike<unknown> & { dispose(): Promise<void> }
}

export type NativeScheduleDraft =
  | { readonly kind: 'after'; readonly prompt: string; readonly afterSeconds: number }
  | { readonly kind: 'at'; readonly prompt: string; readonly at: string }
  | { readonly kind: 'every'; readonly prompt: string; readonly everySeconds: number }

/** Stable agent instruction: the model must call Harness's native tool, never simulate a timer. */
export function buildNativeScheduleCreatePrompt(draft: NativeScheduleDraft): string {
  const input = draft.kind === 'after'
    ? { prompt: draft.prompt.trim(), after_seconds: draft.afterSeconds }
    : draft.kind === 'at'
      ? { prompt: draft.prompt.trim(), at: draft.at }
      : { prompt: draft.prompt.trim(), every_seconds: draft.everySeconds }
  return `Call the native schedule_create tool exactly once with this JSON object: ${JSON.stringify(input)}. Do not simulate a timer or create any other schedule.`
}

/** Stable agent instruction for canonical Session-local deletion. */
export function buildNativeScheduleDeletePrompt(id: string): string {
  return `Call the native schedule_delete tool exactly once with this JSON object: ${JSON.stringify({ id })}. Do not delete any other schedule.`
}

export interface NativeSchedulerSnapshot {
  readonly open: boolean
  readonly sessionId: string | null
  readonly items: readonly Readonly<PaimindNativeScheduleView>[]
  readonly loading: boolean
  readonly submitting: boolean
  readonly error: string | null
  readonly notice: string | null
}

const EMPTY: NativeSchedulerSnapshot = Object.freeze({
  open: false,
  sessionId: null,
  items: Object.freeze([]),
  loading: false,
  submitting: false,
  error: null,
  notice: null,
})

function remoteValue<Value>(result: HarnessRemoteResult<Value>): Value {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

export class NativeSchedulerController {
  private snapshot: NativeSchedulerSnapshot = EMPTY
  private readonly listeners = new Set<() => void>()
  private readonly offSessions: () => void
  private requestEpoch = 0
  private refreshTimer: number | undefined
  private disposed = false

  constructor(
    private readonly remote: ScheduleRemoteNamespace,
    private readonly sessions: HarnessSessionService,
  ) {
    this.snapshot = Object.freeze({ ...EMPTY, sessionId: this.currentSessionId() })
    this.offSessions = sessions.list.subscribe(() => {
      const sessionId = this.currentSessionId()
      if (sessionId === this.snapshot.sessionId) return
      this.publish({ ...this.snapshot, sessionId, items: Object.freeze([]), error: null, notice: null })
      if (this.snapshot.open) void this.refresh()
    })
  }

  getSnapshot(): NativeSchedulerSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  open(): void { this.publish({ ...this.snapshot, open: true }); void this.refresh() }
  close(): void { this.publish({ ...this.snapshot, open: false }) }
  toggle(): void { this.snapshot.open ? this.close() : this.open() }

  async refresh(): Promise<void> {
    const sessionId = this.currentSessionId()
    const epoch = ++this.requestEpoch
    if (sessionId === null) {
      this.publish({ ...this.snapshot, sessionId, items: Object.freeze([]), loading: false, error: null })
      return
    }
    this.publish({ ...this.snapshot, sessionId, loading: true, error: null })
    try {
      const value = remoteValue(await this.remote.list({ sessionId }))
      if (this.disposed || epoch !== this.requestEpoch) return
      this.publish({ ...this.snapshot, sessionId: value.sessionId, items: value.items, loading: false })
    } catch (error) {
      if (this.disposed || epoch !== this.requestEpoch) return
      this.publish({
        ...this.snapshot,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async create(draft: NativeScheduleDraft): Promise<boolean> {
    return await this.submit(buildNativeScheduleCreatePrompt(draft), '已提交到当前 Harness 会话；完成后会从原生事件日志刷新。')
  }

  async remove(id: string): Promise<boolean> {
    return await this.submit(buildNativeScheduleDeletePrompt(id), '删除请求已提交到当前 Harness 会话。')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.offSessions()
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer)
    this.listeners.clear()
  }

  private currentSessionId(): string | null {
    return this.sessions.list.getSnapshot().current ?? null
  }

  private async submit(text: string, notice: string): Promise<boolean> {
    const sessionId = this.currentSessionId()
    const session = sessionId === null ? undefined : this.sessions.binding?.(sessionId)?.session
    if (sessionId === null || session?.prompt === undefined) {
      this.publish({ ...this.snapshot, error: '当前 Harness 会话不支持原生 Prompt Action。', notice: null })
      return false
    }
    this.publish({ ...this.snapshot, submitting: true, error: null, notice: null })
    try {
      const result = await session.prompt([{ type: 'text', text }], 'queue')
      if (!result.ok) throw new Error(result.error.message)
      this.publish({ ...this.snapshot, submitting: false, notice })
      if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer)
      this.refreshTimer = window.setTimeout(() => { this.refreshTimer = undefined; void this.refresh() }, 1_500)
      return true
    } catch (error) {
      this.publish({
        ...this.snapshot,
        submitting: false,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  private publish(snapshot: NativeSchedulerSnapshot): void {
    if (this.disposed) return
    this.snapshot = Object.freeze(snapshot)
    for (const listener of [...this.listeners]) listener()
  }
}

const STYLE_ID = '@paimind/scheduler'
const STYLE = `
[data-paimind-schedule-trigger]{width:calc(100% + 8px);min-height:36px;margin:4px -4px;padding:7px 10px;display:flex;align-items:center;gap:9px;border:0;border-radius:14px;color:var(--dsw-alias-label-primary,#172033);background:transparent;font:inherit;font-size:14px;cursor:pointer}
[data-paimind-schedule-trigger]:hover,[data-paimind-schedule-trigger]:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(80,100,140,.1))}
[data-paimind-schedule-trigger][data-wide='false']{width:38px;height:38px;margin:7px 0;padding:0;justify-content:center;border-radius:50%}
[data-paimind-schedule-overlay]{position:fixed;inset:0;z-index:2147482992;display:flex;justify-content:flex-end}
[data-paimind-schedule-mask]{position:absolute;inset:0;border:0;background:rgba(12,20,36,.34);backdrop-filter:blur(3px)}
[data-paimind-schedule-panel]{position:relative;z-index:1;width:min(620px,100vw);height:100%;box-sizing:border-box;overflow:auto;padding:26px;color:var(--dsw-alias-label-primary,#172033);background:var(--dsw-alias-bg-layer-1,#fff);border-left:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.16));box-shadow:-18px 0 60px rgba(15,24,40,.16)}
[data-paimind-schedule-header]{display:flex;align-items:flex-start;gap:14px}
[data-paimind-schedule-header] h2{margin:0;font-size:23px}
[data-paimind-schedule-header] p{margin:6px 0 0;color:var(--dsw-alias-label-tertiary,#78849a);font-size:12px;line-height:18px}
[data-paimind-schedule-close]{margin-left:auto;width:38px;height:38px;border:0;border-radius:50%;color:inherit;background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.08));font-size:22px;cursor:pointer}
[data-paimind-schedule-session]{margin:20px 0 14px;padding:10px 13px;border-radius:13px;color:var(--dsw-alias-label-secondary,#56627a);background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.08));font-size:12px}
[data-paimind-schedule-form]{display:grid;grid-template-columns:1fr 160px;gap:10px;padding:16px;border:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.16));border-radius:18px;background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.045))}
[data-paimind-schedule-form] label{display:grid;gap:5px;color:var(--dsw-alias-label-secondary,#56627a);font-size:11px;font-weight:650}
[data-paimind-schedule-form] label:first-child{grid-column:1/-1}
[data-paimind-schedule-form] input,[data-paimind-schedule-form] select{min-height:40px;box-sizing:border-box;padding:8px 11px;border:1px solid var(--dsw-alias-border-l2,rgba(110,125,150,.24));border-radius:12px;color:inherit;background:var(--dsw-alias-bg-layer-1,#fff);font:inherit;font-size:13px}
[data-paimind-schedule-primary]{grid-column:1/-1;justify-self:end;min-height:38px;padding:8px 15px;border:0;border-radius:12px;color:#fff;background:var(--dsw-alias-state-business-primary,#326af5);font:inherit;font-weight:700;cursor:pointer}
[data-paimind-schedule-primary]:disabled{opacity:.5;cursor:not-allowed}
[data-paimind-schedule-status]{margin:14px 0 0;padding:10px 12px;border-radius:12px;color:var(--dsw-alias-label-secondary,#56627a);background:var(--dsw-alias-bg-layer-2,rgba(100,115,140,.07));font-size:12px}
[data-paimind-schedule-status][data-error='true']{color:var(--dsw-alias-state-error-primary,#c83c3c)}
[data-paimind-schedule-list]{list-style:none;margin:18px 0 0;padding:0;display:grid;gap:10px}
[data-paimind-schedule-row]{padding:14px;border:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.15));border-radius:17px;background:var(--dsw-alias-bg-layer-1,#fff)}
[data-paimind-schedule-row-head]{display:flex;align-items:center;gap:8px}
[data-paimind-schedule-row-head] strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-schedule-badge]{padding:3px 8px;border-radius:999px;color:var(--dsw-alias-state-business-primary,#326af5);background:rgba(50,106,245,.1);font-size:10px;font-weight:700}
[data-paimind-schedule-row] p{margin:8px 0;color:var(--dsw-alias-label-secondary,#56627a);font-size:13px;line-height:19px}
[data-paimind-schedule-meta]{display:flex;align-items:center;gap:10px;color:var(--dsw-alias-label-tertiary,#78849a);font-size:11px}
[data-paimind-schedule-delete]{margin-left:auto;border:0;color:var(--dsw-alias-state-error-primary,#c83c3c);background:transparent;font:inherit;font-size:11px;cursor:pointer}
[data-paimind-schedule-empty]{margin:18px 0;padding:30px;border:1px dashed var(--dsw-alias-border-l2,rgba(110,125,150,.24));border-radius:18px;text-align:center;color:var(--dsw-alias-label-tertiary,#78849a);font-size:13px}
@media(max-width:640px){[data-paimind-schedule-panel]{width:100%;padding:20px}[data-paimind-schedule-form]{grid-template-columns:1fr}[data-paimind-schedule-form] label:first-child,[data-paimind-schedule-primary]{grid-column:1}}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = '@paimind/scheduler'
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}

function useChinese(locale: PaimindLocaleSource): boolean {
  return useSyncExternalStore(
    locale.subscribe.bind(locale),
    () => locale.getLocale().active.startsWith('zh'),
    () => locale.getLocale().active.startsWith('zh'),
  )
}

export function NativeScheduleTrigger(props: {
  readonly wide: boolean
  readonly controller: NativeSchedulerController
  readonly locale: PaimindLocaleSource
}): ReactNode {
  const zh = useChinese(props.locale)
  return <button type="button" data-paimind-schedule-trigger data-wide={props.wide} aria-label={zh ? '打开定时任务' : 'Open Scheduled Tasks'} onClick={() => { props.controller.toggle() }}>
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>
    {props.wide && <span>{zh ? '定时任务' : 'Scheduled Tasks'}</span>}
  </button>
}

function formatWhen(item: Readonly<PaimindNativeScheduleView>, zh: boolean): string {
  const date = new Date(item.scheduledAt).toLocaleString(zh ? 'zh-CN' : 'en-US')
  if (item.kind === 'after') return `${date} · ${item.afterSeconds}s`
  if (item.kind === 'every') return `${date} · ${zh ? `每 ${item.everySeconds}s` : `every ${item.everySeconds}s`}`
  return date
}

export function NativeScheduleOverlay(props: {
  readonly controller: NativeSchedulerController
  readonly locale: PaimindLocaleSource
}): ReactNode {
  const snapshot = useSyncExternalStore(props.controller.subscribe.bind(props.controller), props.controller.getSnapshot.bind(props.controller))
  const zh = useChinese(props.locale)
  const [kind, setKind] = useState<NativeScheduleDraft['kind']>('after')
  const [prompt, setPrompt] = useState('')
  const [value, setValue] = useState('300')

  useEffect(() => { if (!snapshot.open) { setPrompt(''); setValue('300'); setKind('after') } }, [snapshot.open])
  if (!snapshot.open) return null

  const submit = async (): Promise<void> => {
    if (prompt.trim().length === 0) return
    let draft: NativeScheduleDraft
    if (kind === 'at') {
      const instant = new Date(value)
      if (!Number.isFinite(instant.getTime())) return
      draft = { kind, prompt, at: instant.toISOString() }
    } else {
      const seconds = Number(value)
      if (!Number.isSafeInteger(seconds) || seconds <= 0 || (kind === 'every' && seconds < 300)) return
      draft = kind === 'after' ? { kind, prompt, afterSeconds: seconds } : { kind, prompt, everySeconds: seconds }
    }
    if (await props.controller.create(draft)) setPrompt('')
  }

  return createPortal(<div data-paimind-schedule-overlay>
    <button type="button" data-paimind-schedule-mask aria-label={zh ? '关闭定时任务' : 'Close Scheduled Tasks'} onClick={() => { props.controller.close() }}/>
    <section role="dialog" aria-modal="true" aria-label={zh ? '定时任务' : 'Scheduled Tasks'} data-paimind-schedule-panel>
      <header data-paimind-schedule-header>
        <div><h2>{zh ? '定时任务' : 'Scheduled Tasks'}</h2><p>{zh ? '直接管理当前会话的 Harness 原生 Schedule；不建立第二套任务存储。' : 'Manages native Harness Schedules for the current Session without a second task store.'}</p></div>
        <button type="button" data-paimind-schedule-close aria-label={zh ? '关闭' : 'Close'} onClick={() => { props.controller.close() }}>×</button>
      </header>
      <div data-paimind-schedule-session>{snapshot.sessionId === null
        ? (zh ? '请先打开一个 Harness 会话。' : 'Open a Harness Session first.')
        : `${zh ? '当前会话' : 'Current Session'} · ${snapshot.sessionId} · session-local`}</div>
      <form data-paimind-schedule-form onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <label>{zh ? '提醒内容' : 'Reminder'}<input aria-label={zh ? '提醒内容' : 'Reminder'} value={prompt} maxLength={500} onChange={event => { setPrompt(event.currentTarget.value) }}/></label>
        <label>{zh ? '类型' : 'Type'}<select aria-label={zh ? '类型' : 'Type'} value={kind} onChange={event => { const next = event.currentTarget.value as NativeScheduleDraft['kind']; setKind(next); setValue(next === 'at' ? '' : next === 'every' ? '300' : '300') }}><option value="after">after</option><option value="at">at</option><option value="every">every</option></select></label>
        <label>{kind === 'at' ? (zh ? '执行时间' : 'Date and time') : (zh ? '秒数' : 'Seconds')}<input aria-label={kind === 'at' ? (zh ? '执行时间' : 'Date and time') : (zh ? '秒数' : 'Seconds')} type={kind === 'at' ? 'datetime-local' : 'number'} min={kind === 'every' ? 300 : 1} value={value} onChange={event => { setValue(event.currentTarget.value) }}/></label>
        <button type="submit" data-paimind-schedule-primary disabled={snapshot.sessionId === null || snapshot.submitting || prompt.trim().length === 0}>{snapshot.submitting ? (zh ? '正在提交…' : 'Submitting…') : (zh ? '交给原生会话创建' : 'Create in native Session')}</button>
      </form>
      {snapshot.error !== null && <div role="alert" data-paimind-schedule-status data-error="true">{snapshot.error}</div>}
      {snapshot.notice !== null && <div role="status" data-paimind-schedule-status>{zh ? snapshot.notice : 'Submitted to the current Harness Session; native events will refresh this list.'}</div>}
      {snapshot.loading && snapshot.items.length === 0 ? <div data-paimind-schedule-empty>{zh ? '正在读取原生事件日志…' : 'Reading the native event log…'}</div>
        : snapshot.items.length === 0 ? <div data-paimind-schedule-empty>{zh ? '当前会话没有有效的原生定时任务。' : 'No active native schedules in this Session.'}</div>
          : <ul data-paimind-schedule-list>{snapshot.items.map(item => <li key={item.id} data-paimind-schedule-row>
            <div data-paimind-schedule-row-head><strong>{item.id}</strong><span data-paimind-schedule-badge>{item.kind} · {item.state}</span></div>
            <p>{item.prompt}</p>
            <div data-paimind-schedule-meta><span>{formatWhen(item, zh)}</span><span>{item.deliveryMode}</span><button type="button" data-paimind-schedule-delete disabled={snapshot.submitting} onClick={() => { void props.controller.remove(item.id) }}>{zh ? '删除' : 'Delete'}</button></div>
          </li>)}</ul>}
    </section>
  </div>, document.body)
}

class NativeScheduleBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.warn('[paimind-scheduler] render failed', error, info.componentStack) }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

export async function apply(ctx: NativeSchedulerClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const mounted = ctx.inject([...BASE_INJECT, 'remote.paimindSchedule'], (remoteCtx) => {
    const remote = remoteCtx.remote.paimindSchedule
    if (remote === undefined) throw new Error('PAIMind native Schedule Remote did not mount')
    const controller = new NativeSchedulerController(remote, remoteCtx.sessions)
    contributePaimindExtension(remoteCtx.slots, {
      id: 'paimind:scheduler', packageName: '@paimind/scheduler', category: 'automation',
      nameZh: '定时任务', nameEn: 'Scheduled Tasks',
      descriptionZh: 'Harness 原生 Session-local Schedule 的管理界面，不创建第二套运行时对象。',
      descriptionEn: 'Management surface for native Session-local Harness Schedules with no second runtime object.',
      surface: 'header-button', maturity: 'available', order: 30,
    })
    remoteCtx.effect(installStyle, 'paimind-scheduler: styles')
    remoteCtx.effect(() => {
      const disposeService = remoteCtx.reflect.provide('paimindNativeScheduler', controller)
      return () => { controller.dispose(); void disposeService() }
    }, 'paimind-scheduler: controller')
    const injectProps = (): { readonly controller: NativeSchedulerController; readonly locale: PaimindLocaleSource } => ({ controller, locale: remoteCtx.locale })
    remoteCtx.slots.inject('sidebar.footer.action', () => remoteCtx.slots.register({
      name: 'sidebar.footer.action', id: 'paimind-schedule-trigger', order: -4, inject: injectProps,
    }, (props: { readonly wide: boolean; readonly controller: NativeSchedulerController; readonly locale: PaimindLocaleSource }) => <NativeScheduleBoundary><NativeScheduleTrigger {...props}/></NativeScheduleBoundary>))
    remoteCtx.slots.inject('shell.overlay', () => remoteCtx.slots.register({
      name: 'shell.overlay', id: 'paimind-schedule-overlay', order: 30, inject: injectProps,
    }, (props: { readonly controller: NativeSchedulerController; readonly locale: PaimindLocaleSource }) => <NativeScheduleBoundary><NativeScheduleOverlay {...props}/></NativeScheduleBoundary>))
  })
  try {
    await mounted
  } catch (error) {
    await disposeRemote()
    throw error
  }
  return async () => {
    await mounted.dispose()
    await disposeRemote()
  }
}
