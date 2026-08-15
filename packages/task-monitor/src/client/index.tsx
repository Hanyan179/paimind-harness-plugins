import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  contributePaimindExtension,
  type PaimindClientContext,
  type PaimindLocaleSource,
  type PaimindSessionHeaderActionProps,
} from '@paimind/harness-compat'
import {
  artifactsFromProjection,
  isLivePaimindJob,
  projectPaimindArtifactJobs,
  type PaimindArtifactJobView,
} from '../index.js'

export const inject = ['slots', 'locale']

const STYLE_ID = '@paimind/task-monitor'
const STYLE = `
[data-paimind-task-action] { position: relative; display: inline-flex; color: inherit; font: inherit; }
[data-paimind-task-trigger] {
  min-height: 28px; display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px;
  border: 0; border-radius: 8px; color: var(--dsw-alias-label-secondary, #626872);
  background: transparent; font: inherit; font-size: 12px; cursor: pointer;
}
[data-paimind-task-trigger]:hover,
[data-paimind-task-trigger][aria-expanded='true'] {
  color: var(--dsw-alias-label-primary, #202124);
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.09));
}
[data-paimind-task-trigger] svg { flex: none; }
[data-paimind-task-live] {
  width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-business-primary, #4f7ff8);
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 12%, transparent);
}
[data-paimind-task-panel] {
  position: absolute; z-index: 110; top: calc(100% + 8px); right: 0; width: min(380px, calc(100vw - 32px));
  max-height: min(460px, calc(100vh - 140px)); overflow: auto; box-sizing: border-box; padding: 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2)); border-radius: 14px;
  color: var(--dsw-alias-label-primary, #202124); background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: 0 16px 44px rgba(0,0,0,.18);
}
[data-paimind-task-panel] header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
[data-paimind-task-panel] h2 { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; }
[data-paimind-task-panel] header p { margin: 3px 0 0; color: var(--dsw-alias-label-tertiary, #7a808a); font-size: 10px; line-height: 16px; }
[data-paimind-task-count] { color: var(--dsw-alias-label-tertiary, #7a808a); font-size: 11px; }
[data-paimind-task-list] { display: grid; gap: 7px; margin: 12px 0 0; padding: 0; list-style: none; }
[data-paimind-task-row] { padding: 10px; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.15)); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.04)); }
[data-paimind-task-row-head] { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 8px; }
[data-paimind-task-state] { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-label-tertiary, #8a9099); }
[data-paimind-task-state][data-status='running'] { background: var(--dsw-alias-state-business-primary, #4f7ff8); }
[data-paimind-task-state][data-status='completed'] { background: var(--dsw-alias-state-success-primary, #2b8a57); }
[data-paimind-task-state][data-status='failed'] { background: var(--dsw-alias-state-error-primary, #d04444); }
[data-paimind-task-state][data-status='stopping'], [data-paimind-task-state][data-status='killed'] { background: var(--dsw-alias-state-warning-primary, #b7791f); }
[data-paimind-task-title] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; }
[data-paimind-task-status] { color: var(--dsw-alias-label-tertiary, #7a808a); font-size: 10px; }
[data-paimind-task-meta] { display: flex; flex-wrap: wrap; gap: 4px 8px; margin: 5px 0 0 15px; color: var(--dsw-alias-label-tertiary, #7a808a); font-size: 10px; }
[data-paimind-task-artifact] { margin: 7px 0 0 15px; color: var(--dsw-alias-state-business-primary, #4f7ff8); font-size: 10px; overflow-wrap: anywhere; }
[data-paimind-task-empty] { margin-top: 12px; padding: 16px 10px; border: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,.24)); border-radius: 10px; color: var(--dsw-alias-label-tertiary, #7a808a); font-size: 11px; text-align: center; }
[data-paimind-task-note] { margin: 10px 0 0; color: var(--dsw-alias-label-tertiary, #7a808a); font-size: 9px; line-height: 14px; }
[data-paimind-task-error] { padding: 8px; color: var(--dsw-alias-state-error-primary, #d04444); font-size: 11px; }
@media (max-width: 640px) {
  [data-paimind-task-panel] { position: fixed; top: auto; right: 12px; bottom: 12px; left: 12px; width: auto; max-height: min(70vh, 520px); }
  [data-paimind-task-trigger-label] { display: none; }
}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = '@paimind/task-monitor'
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}

function TaskIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M4 4.3h10M4 9h10M4 13.7h6.5" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <circle cx="2.25" cy="4.3" r=".8" fill="currentColor" />
      <circle cx="2.25" cy="9" r=".8" fill="currentColor" />
      <circle cx="2.25" cy="13.7" r=".8" fill="currentColor" />
    </svg>
  )
}

const STATUS_COPY = {
  running: ['进行中', 'Running'], stopping: ['正在停止', 'Stopping'], completed: ['已完成', 'Completed'],
  killed: ['已取消', 'Cancelled'], failed: ['失败', 'Failed'],
} as const

function duration(job: PaimindArtifactJobView, now: number): string {
  const end = isLivePaimindJob(job) ? now : job.finishedAt ?? job.startedAt
  const seconds = Math.max(0, Math.floor((end - job.startedAt) / 1_000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export interface TaskMonitorActionProps extends PaimindSessionHeaderActionProps {
  readonly locale: PaimindLocaleSource
}

export function TaskMonitorAction({ sessionId, useSessions, useProjection, locale }: TaskMonitorActionProps): React.JSX.Element {
  const jobs = useSessions(snapshot => snapshot.jobsBySession?.[sessionId] ?? [])
  const projection = useProjection('paimind.artifacts')
  const activeLocale = useSyncExternalStore(
    locale.subscribe.bind(locale),
    () => locale.getLocale().active,
    () => locale.getLocale().active,
  )
  const zh = activeLocale.startsWith('zh')
  const rows = useMemo(
    () => projectPaimindArtifactJobs(jobs, artifactsFromProjection(projection)),
    [jobs, projection],
  )
  const liveCount = rows.filter(isLivePaimindJob).length
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [open])

  useEffect(() => {
    if (!open || liveCount === 0) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [open, liveCount])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    trigger.current?.focus()
  }

  const label = zh ? `PAIMind 任务（${rows.length}）` : `PAIMind Tasks (${rows.length})`
  return (
    <div ref={root} data-paimind-task-action onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        data-paimind-task-trigger
        aria-label={label}
        aria-expanded={open}
        onClick={() => { setNow(Date.now()); setOpen(value => !value) }}
      >
        {liveCount > 0 && <i data-paimind-task-live aria-hidden="true" />}
        <TaskIcon />
        <span data-paimind-task-trigger-label>{zh ? '任务' : 'Tasks'}</span>
        {rows.length > 0 && <span>{rows.length}</span>}
      </button>
      {open && (
        <section data-paimind-task-panel aria-label={zh ? 'PAIMind 任务监控' : 'PAIMind Task Monitor'}>
          <header>
            <div>
              <h2>{zh ? '任务监控' : 'Task Monitor'}</h2>
              <p>{zh ? '只显示 PAIMind 生成器创建的 Harness 原生任务' : 'Native Harness Jobs created by PAIMind generators only'}</p>
            </div>
            <span data-paimind-task-count>{rows.length}</span>
          </header>
          {rows.length === 0 ? (
            <div data-paimind-task-empty>{zh ? '当前会话还没有产物生成任务。' : 'No artifact generation Jobs in this Session yet.'}</div>
          ) : (
            <ul data-paimind-task-list>
              {rows.map(job => (
                <li key={job.id} data-paimind-task-row data-status={job.status}>
                  <div data-paimind-task-row-head>
                    <i data-paimind-task-state data-status={job.status} aria-hidden="true" />
                    <span data-paimind-task-title>{job.label}</span>
                    <span data-paimind-task-status>{STATUS_COPY[job.status][zh ? 0 : 1]}</span>
                  </div>
                  <div data-paimind-task-meta>
                    <span>{job.id}</span><span>{duration(job, now)}</span>{job.detail !== undefined && <span>{job.detail}</span>}
                  </div>
                  {job.artifact !== undefined && (
                    <div data-paimind-task-artifact>
                      {job.artifact.state === 'available'
                        ? `${zh ? '产物' : 'Artifact'} · ${job.artifact.title} · r${job.artifact.revision}`
                        : `${zh ? '产物失败' : 'Artifact failed'} · ${job.artifact.error?.message ?? job.artifact.state}`}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p data-paimind-task-note>
            {zh
              ? '任务状态来自当前 Harness 进程；产物结果来自可持久化的 Session 投影。Harness 重启后任务历史会清空，但产物仍可恢复。'
              : 'Job state is process-local Harness truth; artifact results are durable Session projections. Jobs reset on restart while artifacts recover.'}
          </p>
        </section>
      )}
    </div>
  )
}

interface BoundaryProps extends TaskMonitorActionProps {}
interface BoundaryState { readonly failed: boolean }

class TaskMonitorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false }
  static getDerivedStateFromError(): BoundaryState { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn('[paimind-task-monitor] render failed', error, info.componentStack)
  }
  render(): ReactNode {
    if (this.state.failed) return <span role="alert" data-paimind-task-error>Task Monitor unavailable</span>
    return <TaskMonitorAction {...this.props} />
  }
}

export function apply(ctx: PaimindClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:task-monitor',
    packageName: '@paimind/task-monitor',
    category: 'automation',
    nameZh: '任务监控',
    nameEn: 'Task Monitor',
    descriptionZh: '独立入口，直接投影 PAIMind 生成器创建的 Harness 原生 Job。',
    descriptionEn: 'Independent entry projecting native Harness Jobs created by PAIMind generators.',
    surface: 'header-button',
    maturity: 'technical-preview',
    order: 10,
  })
  ctx.effect(installStyle, 'paimind-task-monitor: styles')
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'paimind-task-monitor',
    order: 24,
  }, (props: PaimindSessionHeaderActionProps) => <TaskMonitorBoundary {...props} locale={ctx.locale} />))
}
