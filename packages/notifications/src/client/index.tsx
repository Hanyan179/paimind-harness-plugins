import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  markHarnessClientStyle,
  contributePaimindExtension,
  type HarnessRemoteMountService,
  type HarnessRemoteResult,
  type HarnessSessionService,
  type HarnessWorkspaceService,
  type PaimindClientContext,
  type PaimindLocaleSource,
} from '@hansen/harness-compat'
import type { NotificationRecord } from '@hansen/contracts'
import type { PaimindArtifactService } from '@hansen/artifacts'
import type { PaimindSidebarService } from '@hansen/better-sidebar-adapter'
import { PAIMIND_UI_FOUNDATION_CSS } from '@hansen/ui-foundation'
import type {
  PaimindNotificationListValue,
  PaimindNotificationMarkReadRequest,
  PaimindNotificationMutationResult,
} from '../index.js'
import TYPERT_REMOTE from '../remote.js'

const BASE_INJECT = ['slots', 'locale', 'remote', 'sessions', 'workspaces', 'paimindArtifacts', 'paimindSidebar'] as const
export const inject = [...BASE_INJECT]

interface NotificationRemoteNamespace {
  list(): Promise<HarnessRemoteResult<PaimindNotificationListValue>>
  markRead(request: PaimindNotificationMarkReadRequest): Promise<HarnessRemoteResult<PaimindNotificationMutationResult>>
  markAllRead(): Promise<HarnessRemoteResult<PaimindNotificationListValue>>
}

interface NotificationsRemote extends HarnessRemoteMountService {
  readonly paimindNotifications?: NotificationRemoteNamespace
}

export interface NotificationsClientContext extends PaimindClientContext {
  readonly remote: NotificationsRemote
  readonly sessions: HarnessSessionService
  readonly workspaces: HarnessWorkspaceService
  readonly paimindArtifacts: PaimindArtifactService
  readonly paimindSidebar: PaimindSidebarService
  inject(
    dependencies: readonly string[],
    install: (ctx: NotificationsClientContext) => void,
  ): PromiseLike<unknown> & { dispose(): Promise<void> }
}

export interface NotificationCenterSnapshot {
  readonly open: boolean
  readonly loading: boolean
  readonly items: readonly Readonly<NotificationRecord>[]
  readonly error: string | null
}

const EMPTY_SNAPSHOT: NotificationCenterSnapshot = Object.freeze({
  open: false, loading: false, items: Object.freeze([]), error: null,
})

export class NotificationCenterController {
  private snapshot: NotificationCenterSnapshot = EMPTY_SNAPSHOT
  private readonly listeners = new Set<() => void>()
  private requestEpoch = 0
  private disposed = false
  private refreshTimer: number | undefined
  private readonly offSessions: () => void

  constructor(
    private readonly remote: NotificationRemoteNamespace,
    private readonly sessions: HarnessSessionService,
    private readonly workspaces: HarnessWorkspaceService,
    private readonly artifacts: PaimindArtifactService,
    private readonly sidebar: PaimindSidebarService,
  ) {
    this.offSessions = sessions.list.subscribe(() => { this.scheduleRefresh() })
  }

  getSnapshot(): NotificationCenterSnapshot { return this.snapshot }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  open(): void { this.publish({ ...this.snapshot, open: true }); void this.refresh() }
  close(): void { this.publish({ ...this.snapshot, open: false }) }
  toggle(): void { this.snapshot.open ? this.close() : this.open() }

  async refresh(): Promise<void> {
    if (this.disposed) return
    const epoch = ++this.requestEpoch
    this.publish({ ...this.snapshot, loading: true, error: null })
    try {
      const result = await this.remote.list()
      if (this.disposed || epoch !== this.requestEpoch) return
      if (!result.ok) throw new Error(result.error.message)
      this.publish({ ...this.snapshot, loading: false, items: Object.freeze([...result.value.items]), error: null })
    } catch (error) {
      if (this.disposed || epoch !== this.requestEpoch) return
      this.publish({ ...this.snapshot, loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  async markRead(item: Readonly<NotificationRecord>): Promise<boolean> {
    if (item.readAt !== undefined || this.disposed) return true
    try {
      const result = await this.remote.markRead({ id: item.id, ifVersion: item.version })
      if (!result.ok) { this.publish({ ...this.snapshot, error: result.error.message }); return false }
      if (!result.value.ok) {
        if (result.value.error.code === 'version-conflict') this.replace(result.value.error.current)
        else await this.refresh()
        return false
      }
      this.replace(result.value.value)
      return true
    } catch (error) {
      this.publish({ ...this.snapshot, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  async markAllRead(): Promise<void> {
    if (this.disposed) return
    try {
      const result = await this.remote.markAllRead()
      if (!result.ok) { this.publish({ ...this.snapshot, error: result.error.message }); return }
      this.publish({ ...this.snapshot, items: Object.freeze([...result.value.items]), error: null })
    } catch (error) {
      this.publish({ ...this.snapshot, error: error instanceof Error ? error.message : String(error) })
    }
  }

  async follow(item: Readonly<NotificationRecord>): Promise<void> {
    if (!await this.markRead(item)) return
    const target = item.target
    if (target === undefined) return
    if (target.kind === 'session') {
      this.sessions.open(target.sessionId)
    } else if (target.kind === 'artifact') {
      this.sessions.open(target.sessionId)
      if (!await this.focusArtifact(target.artifactId, target.sessionId)) {
        this.publish({
          ...this.snapshot,
          error: 'The notification target is no longer available in the selected Session.',
        })
        return
      }
    } else if (target.kind === 'surface') {
      this.sidebar.openTab(target.surfaceId)
    } else {
      const opened = window.open(target.url, '_blank', 'noopener,noreferrer')
      if (opened !== null) opened.opener = null
    }
    this.close()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.offSessions()
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer)
    this.listeners.clear()
  }

  private focusArtifact(artifactId: string, sessionId: string): Promise<boolean> {
    return new Promise(resolve => {
      let offArtifacts = (): void => {}
      let offSessions = (): void => {}
      let timeout: number | undefined
      let openTimer: number | undefined
      let finished = false
      const finish = (opened: boolean): void => {
        if (finished) return
        finished = true
        offArtifacts()
        offSessions()
        if (timeout !== undefined) window.clearTimeout(timeout)
        if (openTimer !== undefined) window.clearTimeout(openTimer)
        resolve(opened)
      }
      const open = (): void => {
        openTimer = undefined
        if (this.sessions.list.getSnapshot().current !== sessionId) return
        const artifact = this.artifacts.getSnapshot().artifacts.find(candidate => candidate.id === artifactId)
        if (artifact === undefined || !this.artifacts.focus(artifactId)) {
          settle()
          return
        }
        const opened = this.sidebar.openFile({ path: artifact.path, refresh: true })
        if (opened.state !== 'opened') void this.workspaces.openPath(artifact.path)
        finish(true)
      }
      const settle = (): void => {
        if (this.sessions.list.getSnapshot().current !== sessionId || openTimer !== undefined) return
        // Native Session selection publishes before React commits the matching
        // Better Sidebar scope. Defer one short task so openFile targets the new
        // Session instead of whichever editor tab was active previously.
        openTimer = window.setTimeout(open, 50)
      }
      offArtifacts = this.artifacts.subscribe(settle)
      offSessions = this.sessions.list.subscribe(settle)
      settle()
      timeout = window.setTimeout(() => { finish(false) }, 3_000)
    })
  }

  private replace(item: Readonly<NotificationRecord>): void {
    this.publish({
      ...this.snapshot,
      items: Object.freeze(this.snapshot.items.map(current => current.id === item.id ? item : current)),
      error: null,
    })
  }

  private scheduleRefresh(): void {
    if (this.disposed) return
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer)
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined
      void this.refresh()
    }, 120)
  }

  private publish(snapshot: NotificationCenterSnapshot): void {
    if (this.disposed) return
    this.snapshot = Object.freeze(snapshot)
    for (const listener of [...this.listeners]) listener()
  }
}

const STYLE_ID = '@hansen/notifications'
const STYLE = `${PAIMIND_UI_FOUNDATION_CSS}
[data-paimind-notification-trigger] {
  position: relative; box-sizing: border-box; width: calc(100% + 8px); min-height: 34px; margin: 4px -4px;
  padding: 6px 8px 6px 10px; display: flex; align-items: center; gap: 8px; border: 0; border-radius: 12px;
  color: var(--dsw-alias-label-primary, #202124); background: transparent; font: inherit; font-size: 14px; cursor: pointer;
}
[data-paimind-notification-trigger]:hover, [data-paimind-notification-trigger]:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12));
}
[data-paimind-notification-trigger][data-wide='false'] { width: 36px; height: 36px; margin: 8px 0; padding: 0; justify-content: center; border-radius: 50%; }
[data-paimind-notification-trigger-label] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-paimind-notification-badge] {
  min-width: 18px; height: 18px; padding: 0 5px; display: grid; place-items: center; border-radius: 999px;
  color: #fff; background: var(--dsw-alias-state-error-primary, #d04444); font-size: 9px; line-height: 1; font-weight: 700;
}
[data-paimind-notification-trigger][data-wide='false'] [data-paimind-notification-badge] { position: absolute; top: -2px; right: -3px; }
[data-paimind-notification-overlay] { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: flex-start; justify-content: flex-end; padding: 16px; pointer-events: auto; }
[data-paimind-notification-mask] { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1, rgba(15,24,40,.18)); backdrop-filter: blur(2px); }
[data-paimind-notification-panel] {
  position: relative; z-index: 1; width: min(460px, calc(100vw - 32px)); height: min(760px, calc(100vh - 32px)); box-sizing: border-box; display: grid; overflow: hidden;
  grid-template-rows: auto auto minmax(0,1fr); color: var(--paimind-ui-text);
  background: var(--paimind-ui-panel); border: 1px solid var(--paimind-ui-border); border-radius: 22px;
  box-shadow: 0 24px 70px rgba(18,31,55,.22), 0 3px 12px rgba(18,31,55,.08);
}
[data-paimind-notification-header] { display: flex; align-items: flex-start; gap: 12px; padding: 20px 20px 14px; }
[data-paimind-notification-heading] { min-width: 0; flex: 1; }
[data-paimind-notification-heading] h2 { margin: 0; font-size: 18px; line-height: 25px; font-weight: 650; letter-spacing: -.01em; }
[data-paimind-notification-heading] p { margin: 4px 0 0; color: var(--paimind-ui-muted); font-size: 12px; line-height: 18px; }
[data-paimind-notification-close], [data-paimind-notification-mark-all] { border: 0; color: inherit; background: transparent; font: inherit; cursor: pointer; }
[data-paimind-notification-close] { width: 34px; height: 34px; padding: 0; border-radius: 50%; font-size: 22px; }
[data-paimind-notification-close]:hover, [data-paimind-notification-mark-all]:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1)); }
[data-paimind-notification-toolbar] { display: flex; align-items: center; gap: 5px; padding: 0 20px 12px; border-bottom: 1px solid var(--paimind-ui-border); }
[data-paimind-notification-filter] { min-height: 32px; padding: 5px 11px; border: 0; border-radius: var(--paimind-ui-radius-sm); color: var(--paimind-ui-muted); background: transparent; font: inherit; font-size: 12px; cursor: pointer; }
[data-paimind-notification-filter][aria-pressed='true'] { color: var(--paimind-ui-text); background: var(--paimind-ui-subtle); }
[data-paimind-notification-mark-all] { margin-left: auto; min-height: 32px; padding: 5px 8px; border-radius: var(--paimind-ui-radius-sm); color: var(--paimind-ui-accent); font-size: 11px; }
[data-paimind-notification-body] { overflow: auto; padding: 14px 14px 28px; }
[data-paimind-notification-group]{display:grid;gap:8px;margin-bottom:18px}
[data-paimind-notification-group]>h3{margin:0 4px;color:var(--paimind-ui-faint);font-size:10px;line-height:16px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
[data-paimind-notification-list] { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
[data-paimind-notification-row] { position: relative; overflow:hidden; padding: 13px 13px 11px 16px; border:1px solid var(--paimind-ui-border); border-radius:15px; background: var(--paimind-ui-panel); }
[data-paimind-notification-row][data-unread='true'] { background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4f7ff8) 5%, var(--paimind-ui-panel)); }
[data-paimind-notification-row][data-unread='true']::before { content: ''; position: absolute; inset:0 auto 0 0; width: 3px; background: var(--dsw-alias-state-business-primary, #4f7ff8); }
[data-paimind-notification-row-head] { display: flex; align-items: center; gap: 7px; color: var(--paimind-ui-faint); font-size: 11px; line-height: 16px; }
[data-paimind-notification-source] { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-paimind-notification-level='success'] { color: var(--paimind-ui-success); }
[data-paimind-notification-level='error'] { color: var(--paimind-ui-danger); }
[data-paimind-notification-level='warning'] { color: var(--paimind-ui-warning); }
[data-paimind-notification-title] { margin: 6px 0 0; font-size: 13px; line-height: 19px; font-weight: 680; overflow-wrap: anywhere; }
[data-paimind-notification-summary] { display: -webkit-box; margin: 4px 0 0; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
[data-paimind-notification-details] { max-height: 320px; margin: 9px 0 0; padding: 10px; overflow: auto; border-radius: var(--paimind-ui-radius-sm); color: var(--paimind-ui-muted); background: var(--paimind-ui-subtle); font-size: 13px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
[data-paimind-notification-actions] { display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin-top: 9px; padding-top:8px; border-top:1px solid color-mix(in srgb,var(--paimind-ui-border) 70%,transparent); }
[data-paimind-notification-action] { min-height: 30px; padding: 4px 8px; border-color: transparent; color: var(--paimind-ui-accent); background: transparent; font-size: 11px; }
[data-paimind-notification-action]:hover { background: color-mix(in srgb, var(--paimind-ui-accent) 9%, transparent); }
[data-paimind-notification-empty], [data-paimind-notification-error] { padding: 28px 12px; color: var(--paimind-ui-faint); font-size: 12px; line-height: 19px; text-align: center; }
[data-paimind-notification-error] { color: var(--paimind-ui-danger); }
@media (max-width: 640px) { [data-paimind-notification-overlay]{padding:0}[data-paimind-notification-panel] { width: 100vw; height:100vh; border-radius:0; } }
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = '@hansen/notifications'; markHarnessClientStyle(style, '@hansen/notifications')
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}

function BellIcon(): React.JSX.Element {
  return <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><path d="M4.8 8.4a5.2 5.2 0 0 1 10.4 0v3.1l1.2 2H3.6l1.2-2V8.4Z" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round"/><path d="M8.3 15.4c.3.9.9 1.4 1.7 1.4s1.4-.5 1.7-1.4" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round"/></svg>
}

export function NotificationTrigger(props: {
  readonly wide: boolean
  readonly controller: NotificationCenterController
  readonly locale: PaimindLocaleSource
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(props.controller.subscribe.bind(props.controller), props.controller.getSnapshot.bind(props.controller))
  const locale = useSyncExternalStore(props.locale.subscribe.bind(props.locale), () => props.locale.getLocale().active)
  const zh = locale.startsWith('zh')
  const unread = snapshot.items.filter(item => item.readAt === undefined).length
  return <button type="button" data-paimind-notification-trigger data-wide={props.wide} aria-expanded={snapshot.open} aria-haspopup="dialog" aria-label={zh ? '打开通知中心' : 'Open Notification Center'} onClick={() => { props.controller.toggle() }}>
    <BellIcon />
    {props.wide && <span data-paimind-notification-trigger-label>{zh ? '通知' : 'Notifications'}</span>}
    {unread > 0 && <span data-paimind-notification-badge>{unread > 99 ? '99+' : unread}</span>}
  </button>
}

function relativeTime(timestamp: number, zh: boolean): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000))
  if (seconds < 60) return zh ? '刚刚' : 'Now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return zh ? `${minutes} 分钟前` : `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return zh ? `${hours} 小时前` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return zh ? `${days} 天前` : `${days}d ago`
  return new Date(timestamp).toLocaleDateString(zh ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })
}

type NotificationGroup = 'recent' | 'week' | 'history'

function notificationGroup(timestamp: number): NotificationGroup {
  const age = Math.max(0, Date.now() - timestamp)
  if (age < 24 * 60 * 60 * 1_000) return 'recent'
  if (age < 7 * 24 * 60 * 60 * 1_000) return 'week'
  return 'history'
}

function groupCopy(group: NotificationGroup, zh: boolean): string {
  if (group === 'recent') return zh ? '最近 24 小时' : 'Last 24 hours'
  if (group === 'week') return zh ? '最近 7 天' : 'Last 7 days'
  return zh ? '更早' : 'Earlier'
}

function actionCopy(item: Readonly<NotificationRecord>, zh: boolean): string {
  if (item.target?.kind === 'external' && item.target.label !== undefined) return item.target.label
  if (item.target?.kind === 'artifact') return zh ? '查看产物' : 'View artifact'
  if (item.target?.kind === 'session') return zh ? '打开会话' : 'Open Session'
  if (item.target?.kind === 'external') return zh ? '查看详情' : 'View details'
  return zh ? '打开' : 'Open'
}

function levelCopy(level: NotificationRecord['level'], zh: boolean): string {
  const copy = {
    info: { zh: '提醒', en: 'Notice' },
    success: { zh: '已完成', en: 'Completed' },
    warning: { zh: '需关注', en: 'Attention' },
    error: { zh: '失败', en: 'Failed' },
  } as const
  return copy[level][zh ? 'zh' : 'en']
}

function notificationSummary(body: string, zh: boolean): string {
  const localPath = /(?:\/[\w .@+~-]+){3,}|[A-Za-z]:\\(?:[^\\\s]+\\){2,}[^\s]*/g
  const normalized = body
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '' && !/^at\s+\S+/i.test(line) && !/^```/.test(line))
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#]+/g, '')
    .replace(localPath, zh ? '本地路径' : 'local path')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized === '') return zh ? '打开详情查看完整信息。' : 'Open details for the complete message.'
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177).trimEnd()}…`
}

export function NotificationOverlay(props: {
  readonly controller: NotificationCenterController
  readonly locale: PaimindLocaleSource
}): ReactNode {
  const snapshot = useSyncExternalStore(props.controller.subscribe.bind(props.controller), props.controller.getSnapshot.bind(props.controller))
  const locale = useSyncExternalStore(props.locale.subscribe.bind(props.locale), () => props.locale.getLocale().active)
  const zh = locale.startsWith('zh')
  const [filter, setFilter] = useState<'all' | 'unread' | 'attention'>('all')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const close = useRef<HTMLButtonElement>(null)
  const rows = useMemo(() => filter === 'all'
    ? snapshot.items
    : filter === 'unread'
      ? snapshot.items.filter(item => item.readAt === undefined)
      : snapshot.items.filter(item => item.level === 'warning' || item.level === 'error'), [filter, snapshot.items])
  const groups = useMemo(() => (['recent', 'week', 'history'] as const).map(group => ({
    group,
    rows: rows.filter(item => notificationGroup(item.createdAt) === group),
  })).filter(entry => entry.rows.length > 0), [rows])
  const unread = snapshot.items.filter(item => item.readAt === undefined).length

  useEffect(() => {
    if (!snapshot.open) return
    close.current?.focus()
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') props.controller.close() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [props.controller, snapshot.open])

  if (!snapshot.open) return null
  return createPortal(<div data-paimind-notification-overlay data-paimind-ui-scope>
    <div data-paimind-notification-mask onMouseDown={() => { props.controller.close() }} />
    <section role="dialog" aria-modal="true" aria-label={zh ? '通知中心' : 'Notification Center'} data-paimind-notification-panel data-paimind-ui-panel>
      <header data-paimind-notification-header>
        <div data-paimind-notification-heading><h2>{zh ? '通知中心' : 'Notification Center'}</h2><p aria-live="polite">{unread > 0 ? (zh ? `${unread} 条未读 · 共 ${snapshot.items.length} 条消息` : `${unread} unread · ${snapshot.items.length} messages`) : (zh ? `没有未读消息 · 共 ${snapshot.items.length} 条历史消息` : `No unread messages · ${snapshot.items.length} in history`)}</p></div>
        <button ref={close} type="button" data-paimind-notification-close data-paimind-ui-button data-variant="quiet" aria-label={zh ? '关闭通知中心' : 'Close Notification Center'} onClick={() => { props.controller.close() }}>×</button>
      </header>
      <div data-paimind-notification-toolbar>
        <button type="button" data-paimind-notification-filter aria-pressed={filter === 'all'} onClick={() => { setFilter('all') }}>{zh ? '全部' : 'All'}</button>
        <button type="button" data-paimind-notification-filter aria-pressed={filter === 'unread'} onClick={() => { setFilter('unread') }}>{zh ? '未读' : 'Unread'}</button>
        <button type="button" data-paimind-notification-filter aria-pressed={filter === 'attention'} onClick={() => { setFilter('attention') }}>{zh ? '需处理' : 'Needs action'}</button>
        <button type="button" data-paimind-notification-mark-all disabled={unread === 0} onClick={() => { void props.controller.markAllRead() }}>{zh ? '全部已读' : 'Mark all read'}</button>
      </div>
      <div data-paimind-notification-body>
        {snapshot.error !== null && <div role="alert" data-paimind-notification-error>{snapshot.error}</div>}
        {snapshot.loading && snapshot.items.length === 0 ? <div data-paimind-notification-empty>{zh ? '正在加载…' : 'Loading…'}</div>
          : rows.length === 0 ? <div data-paimind-notification-empty>{zh ? '这里暂时没有通知。' : 'No notifications here yet.'}</div>
            : <>{groups.map(group => <section key={group.group} data-paimind-notification-group aria-label={groupCopy(group.group, zh)}><h3>{groupCopy(group.group, zh)}</h3><ul data-paimind-notification-list>{group.rows.map(item => {
              const detailOpen = expanded.has(item.id)
              const detailId = `paimind-notification-detail-${item.id.replace(/[^a-z0-9_-]/gi, '-')}`
              return <li key={item.id} data-paimind-notification-row data-paimind-ui-card data-unread={item.readAt === undefined}>
              <div data-paimind-notification-row-head><span data-paimind-notification-source>{zh ? item.source.nameZh : item.source.nameEn}</span><span data-paimind-notification-level={item.level}>{levelCopy(item.level, zh)}</span><time dateTime={new Date(item.createdAt).toISOString()}>{relativeTime(item.createdAt, zh)}</time></div>
              <h3 data-paimind-notification-title>{item.title}</h3>
              {item.body !== undefined && <p data-paimind-notification-summary data-paimind-ui-summary>{notificationSummary(item.body, zh)}</p>}
              {item.body !== undefined && detailOpen && <div id={detailId} data-paimind-notification-details>{item.body}</div>}
              <div data-paimind-notification-actions>
                {item.body !== undefined && <button type="button" data-paimind-notification-action data-paimind-ui-button data-variant="quiet" aria-expanded={detailOpen} aria-controls={detailId} onClick={() => { setExpanded(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next }) }}>{detailOpen ? (zh ? '收起消息' : 'Collapse message') : (zh ? '展开消息' : 'Expand message')}</button>}
                {item.readAt === undefined && <button type="button" data-paimind-notification-action data-paimind-ui-button data-variant="quiet" onClick={() => { void props.controller.markRead(item) }}>{zh ? '标为已读' : 'Mark read'}</button>}
                {item.target !== undefined && <button type="button" data-paimind-notification-action data-paimind-ui-button data-variant="quiet" onClick={() => { void props.controller.follow(item) }}>{actionCopy(item, zh)}</button>}
              </div>
            </li>})}</ul></section>)}</>}
      </div>
    </section>
  </div>, document.body)
}

class NotificationBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.warn('[paimind-notifications] render failed', error, info.componentStack) }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

export async function apply(ctx: NotificationsClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const mounted = ctx.inject([...BASE_INJECT, 'remote.paimindNotifications'], (remoteCtx) => {
    const remote = remoteCtx.remote.paimindNotifications
    if (remote === undefined) throw new Error('Notification Remote did not mount')
    const controller = new NotificationCenterController(
      remote, remoteCtx.sessions, remoteCtx.workspaces, remoteCtx.paimindArtifacts, remoteCtx.paimindSidebar,
    )
    contributePaimindExtension(remoteCtx.slots, {
      id: 'paimind:notifications', packageName: '@hansen/notifications', category: 'automation',
      nameZh: '通知中心', nameEn: 'Notification Center',
      descriptionZh: '统一接收各业务应用消息，并提供安全的相关操作入口。',
      descriptionEn: 'Receives messages from business applications with safe related-action links.',
      surface: 'header-button', maturity: 'available', order: 20,
    })
    remoteCtx.effect(installStyle, 'paimind-notifications: styles')
    remoteCtx.effect(() => {
      const disposeService = remoteCtx.reflect.provide('paimindNotificationCenter', controller)
      return () => { controller.dispose(); void disposeService() }
    }, 'paimind-notifications: controller')
    const injectProps = (): { readonly controller: NotificationCenterController; readonly locale: PaimindLocaleSource } => ({ controller, locale: remoteCtx.locale })
    remoteCtx.slots.inject('sidebar.footer.action', () => remoteCtx.slots.register({
      name: 'sidebar.footer.action', id: 'paimind-notification-trigger', order: -5, inject: injectProps,
    }, (props: { readonly wide: boolean; readonly controller: NotificationCenterController; readonly locale: PaimindLocaleSource }) => <NotificationBoundary><NotificationTrigger {...props} /></NotificationBoundary>))
    remoteCtx.slots.inject('shell.overlay', () => remoteCtx.slots.register({
      name: 'shell.overlay', id: 'paimind-notification-overlay', order: 20, inject: injectProps,
    }, (props: { readonly controller: NotificationCenterController; readonly locale: PaimindLocaleSource }) => <NotificationBoundary><NotificationOverlay {...props} /></NotificationBoundary>))
    void controller.refresh()
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
