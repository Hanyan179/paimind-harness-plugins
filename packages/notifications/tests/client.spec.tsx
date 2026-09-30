import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationRecord } from '@paimind/contracts'
import type { PaimindLocaleSource } from '@paimind/harness-compat'
import {
  NotificationCenterController,
  NotificationOverlay,
  NotificationTrigger,
  apply,
  type NotificationsClientContext,
} from '../src/client/index.tsx'

function locale(active = 'en'): PaimindLocaleSource {
  return { getLocale: () => ({ active }), subscribe: () => () => {} }
}

function record(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'notification:one',
    source: { id: 'paimind.artifacts', nameZh: '产物生成', nameEn: 'Artifact generation' },
    title: 'Quarterly report', body: '<img src=x onerror=alert(1)>', level: 'success',
    createdAt: Date.now(), version: 'version:one',
    target: { kind: 'artifact', artifactId: 'artifact:one', sessionId: 'session-1', workspaceId: 'workspace-1' },
    ...overrides,
  }
}

function fixture(items: NotificationRecord[] = [record()]) {
  const list = vi.fn(async () => ({ ok: true as const, value: { items } }))
  const markRead = vi.fn(async ({ id }: { readonly id: string }) => ({
    ok: true as const,
    value: { ok: true as const, value: { ...items.find(item => item.id === id)!, readAt: Date.now(), version: 'version:read' } },
  }))
  const markAllRead = vi.fn(async () => ({
    ok: true as const,
    value: { items: items.map(item => ({ ...item, readAt: Date.now(), version: `${item.version}:read` })) },
  }))
  const listeners = new Set<() => void>()
  let current = 'session-1'
  const sessions = {
    list: { getSnapshot: () => ({ current, byId: {} }), subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
    open: vi.fn(),
    setCurrent(value: string) { current = value; for (const listener of listeners) listener() },
  }
  const artifacts = {
    getSnapshot: vi.fn(() => ({ revision: 0, artifacts: [{ id: 'artifact:one', path: '/workspace/report.bento.html' }], diagnostics: [] })),
    subscribe: vi.fn(() => () => {}), registerSource: vi.fn(), registerAction: vi.fn(),
    actionsFor: vi.fn(() => []), runAction: vi.fn(), focus: vi.fn(() => true), dispose: vi.fn(),
  }
  const sidebar = {
    getStatus: vi.fn(), subscribe: vi.fn(() => () => {}), registerTab: vi.fn(), registerFileViewer: vi.fn(),
    openTab: vi.fn(() => true), closeTab: vi.fn(() => true), getFileCapability: vi.fn(),
    openFile: vi.fn(() => ({ state: 'opened' as const, viewerId: 'paimind:test' })), dispose: vi.fn(),
  }
  const workspaces = { openPath: vi.fn(async () => {}) }
  const controller = new NotificationCenterController({ list, markRead, markAllRead }, sessions as never, workspaces as never, artifacts as never, sidebar as never)
  return { controller, list, markRead, markAllRead, sessions, workspaces, artifacts, sidebar }
}

// jsdom does not implement native modality. These stubs verify component
// lifecycle only; real focus trapping/inertness require browser evidence.
const modalDescriptors = Object.fromEntries(['showModal', 'close'].map(key => [key, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key)]))
beforeEach(() => {
  const previous = new WeakMap<HTMLDialogElement, HTMLElement>()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) {
    if (document.activeElement instanceof HTMLElement) previous.set(this, document.activeElement)
    this.open = true
  } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) {
    this.open = false
    const target = previous.get(this)
    if (target?.isConnected) target.focus()
  } })
})
afterEach(() => {
  cleanup()
  for (const [key, descriptor] of Object.entries(modalDescriptors)) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key)
  }
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.head.querySelectorAll('style[data-paimind-plugin]').forEach(node => { node.remove() })
})

describe('FP12 Notification Center client', () => {
  it('opens an actual dialog element, cancels back to the trigger and releases modality on unmount', async () => {
    const f = fixture([])
    const view = render(<><NotificationTrigger wide controller={f.controller} locale={locale()} /><NotificationOverlay controller={f.controller} locale={locale()} /></>)
    const trigger = screen.getByRole('button', { name: 'Open Notification Center' })
    fireEvent.click(trigger)
    const modal = await screen.findByRole('dialog', { name: 'Notification Center' })
    expect(modal).toBeInstanceOf(HTMLDialogElement)
    expect(modal).toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Close Notification Center' })).toHaveFocus()
    fireEvent(modal, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    const reopened = screen.getByRole('dialog') as HTMLDialogElement
    view.unmount()
    expect(reopened.open).toBe(false)
    f.controller.dispose()
  })
  it('releases the modal before following a target and does not reclaim destination focus', async () => {
    const f = fixture([record({ readAt: 1, target: { kind: 'surface', surfaceId: 'owned-surface' } })])
    render(<><button>Destination</button><NotificationTrigger wide controller={f.controller} locale={locale()} /><NotificationOverlay controller={f.controller} locale={locale()} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Open Notification Center' }))
    await screen.findByText('Quarterly report')
    const modal = screen.getByRole('dialog') as HTMLDialogElement
    f.sidebar.openTab.mockImplementation(() => {
      expect(modal.open).toBe(false)
      screen.getByRole('button', { name: 'Destination' }).focus()
      return true
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open', exact: true })) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Destination' })).toHaveFocus()
    f.controller.dispose()
  })
  it.each(['zh', 'en'])('distinguishes a failed list from an empty inbox and supports a focused retry (%s)', async language => {
    const f = fixture([])
    f.list.mockRejectedValueOnce(new Error('HTTP 403'))
    render(<><NotificationTrigger wide controller={f.controller} locale={locale(language)} /><NotificationOverlay controller={f.controller} locale={locale(language)} /></>)
    fireEvent.click(screen.getByRole('button', { name: language === 'zh' ? '打开通知中心' : 'Open Notification Center' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 403')
    expect(screen.queryByText(/这里暂时没有通知|No notifications here yet/)).toBeNull()
    expect(screen.queryByText(/没有未读消息|No unread messages/)).toBeNull()
    const retry = screen.getByRole('button', { name: language === 'zh' ? '重新加载通知' : 'Retry notifications' })
    retry.focus()
    expect(retry).toHaveFocus()
    fireEvent.click(retry)
    await screen.findByText(language === 'zh' ? '这里暂时没有通知。' : 'No notifications here yet.')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: language === 'zh' ? '关闭通知中心' : 'Close Notification Center' })).toHaveFocus()
    expect(f.list).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: language === 'zh' ? '全部已读' : 'Mark all read' })).toBeDisabled()
    f.controller.dispose()
  })
  it('renders plain text, filters unread, and follows an exact Artifact target', async () => {
    const f = fixture([record(), record({ id: 'notification:read', version: 'version:read', title: 'Already read', body: 'Read body', readAt: Date.now() })])
    render(<><NotificationTrigger wide controller={f.controller} locale={locale()} /><NotificationOverlay controller={f.controller} locale={locale()} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Open Notification Center' }))
    expect(await screen.findByRole('dialog', { name: 'Notification Center' })).toBeInTheDocument()
    expect(document.querySelector('[data-paimind-notification-overlay]')?.parentElement).toBe(document.body)
    await waitFor(() => { expect(screen.getByText('Quarterly report')).toBeInTheDocument() })
    expect(screen.queryByText('<img src=x onerror=alert(1)>')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Expand message' })[0]!)
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(document.querySelector('[data-paimind-notification-details] img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Unread' }))
    expect(screen.queryByText('Already read')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View artifact' }))
    await waitFor(() => { expect(f.sessions.open).toHaveBeenCalledWith('session-1') })
    await waitFor(() => { expect(f.sidebar.openFile).toHaveBeenCalledWith({ path: '/workspace/report.bento.html', refresh: true }) })
    expect(f.artifacts.focus).toHaveBeenCalledWith('artifact:one')
    expect(f.workspaces.openPath).not.toHaveBeenCalled()
    expect(f.sidebar.openTab).not.toHaveBeenCalled()
    f.controller.dispose()
  })

  it('waits for the target Session before opening a cross-Session Artifact', async () => {
    const target = record({
      target: { kind: 'artifact', artifactId: 'artifact:one', sessionId: 'session-2', workspaceId: 'workspace-2' },
    })
    const f = fixture([target])
    const follow = f.controller.follow(target)
    await waitFor(() => { expect(f.sessions.open).toHaveBeenCalledWith('session-2') })
    expect(f.artifacts.focus).not.toHaveBeenCalled()
    expect(f.workspaces.openPath).not.toHaveBeenCalled()

    f.sessions.setCurrent('session-2')
    await follow
    await waitFor(() => { expect(f.sidebar.openFile).toHaveBeenCalledWith({ path: '/workspace/report.bento.html', refresh: true }) })
    expect(f.artifacts.focus).toHaveBeenCalledWith('artifact:one')
    expect(f.workspaces.openPath).not.toHaveBeenCalled()
    f.controller.dispose()
  })

  it('keeps the panel open and reports a stale Artifact target', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.artifacts.getSnapshot.mockReturnValue({ revision: 1, artifacts: [], diagnostics: [] })
    f.controller.open()
    const follow = f.controller.follow(record())
    await vi.advanceTimersByTimeAsync(3_100)
    await follow
    expect(f.controller.getSnapshot()).toMatchObject({
      open: true,
      error: 'The notification target is no longer available in the selected Session.',
    })
    expect(f.sidebar.openFile).not.toHaveBeenCalled()
    f.controller.dispose()
  })

  it('falls back to the Host opener when no in-app Artifact viewer is available', async () => {
    const f = fixture()
    f.sidebar.openFile.mockReturnValueOnce({ state: 'viewer-unavailable', viewerId: null })
    await f.controller.follow(record())
    await waitFor(() => { expect(f.sidebar.openFile).toHaveBeenCalledWith({ path: '/workspace/report.bento.html', refresh: true }) })
    await waitFor(() => { expect(f.workspaces.openPath).toHaveBeenCalledWith('/workspace/report.bento.html') })
    f.controller.dispose()
  })

  it('marks all messages read and keeps an honest empty unread state', async () => {
    const f = fixture()
    render(<><NotificationTrigger wide={false} controller={f.controller} locale={locale('zh')} /><NotificationOverlay controller={f.controller} locale={locale('zh')} /></>)
    fireEvent.click(screen.getByRole('button', { name: '打开通知中心' }))
    await screen.findByText('Quarterly report')
    fireEvent.click(screen.getByRole('button', { name: '全部已读' }))
    await waitFor(() => { expect(f.markAllRead).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByRole('button', { name: '未读' }))
    expect(await screen.findByText('这里暂时没有通知。')).toBeInTheDocument()
    f.controller.dispose()
  })

  it('uses business-facing labels and opens an external link in an isolated tab', async () => {
    const external = record({
      source: { id: 'service:billing', nameZh: '账单系统', nameEn: 'Billing' },
      title: '发票已生成', body: '请查看并确认本次发票。',
      target: { kind: 'external', url: 'https://billing.example.test/invoices/one' },
    })
    const f = fixture([external])
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<><NotificationTrigger wide controller={f.controller} locale={locale('zh')} /><NotificationOverlay controller={f.controller} locale={locale('zh')} /></>)
    fireEvent.click(screen.getByRole('button', { name: '打开通知中心' }))
    expect(await screen.findByText('1 条未读 · 共 1 条消息')).toBeInTheDocument()
    expect(screen.getByText('账单系统')).toBeInTheDocument()
    expect(screen.getByText('已完成')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
    await waitFor(() => {
      expect(open).toHaveBeenCalledWith('https://billing.example.test/invoices/one', '_blank', 'noopener,noreferrer')
    })
    expect(f.markRead).toHaveBeenCalledWith(expect.objectContaining({ id: 'notification:one' }))
    f.controller.dispose()
    open.mockRestore()
  })

  it('isolates a rejected read mutation and does not follow the target', async () => {
    const f = fixture()
    f.markRead.mockRejectedValueOnce(new Error('notification remote unavailable'))
    f.controller.open()
    await waitFor(() => { expect(f.list).toHaveBeenCalledTimes(1) })
    await f.controller.follow(record())
    expect(f.controller.getSnapshot().error).toBe('notification remote unavailable')
    expect(f.sessions.open).not.toHaveBeenCalled()
    expect(f.artifacts.focus).not.toHaveBeenCalled()
    expect(f.sidebar.openTab).not.toHaveBeenCalled()
    f.controller.dispose()
  })

  it('mounts its own Remote and registers independent bell/overlay slots', async () => {
    const f = fixture([])
    const captures: Array<{ readonly name: string; readonly options: Record<string, unknown> }> = []
    const effects: Array<() => void | Promise<void>> = []
    const injections: readonly string[][] = []
    const services = new Map<string, unknown>()
    const remote = {
      async $mount() { (remote as { paimindNotifications?: unknown }).paimindNotifications = { list: f.list, markRead: f.markRead, markAllRead: f.markAllRead }; return () => {} },
    }
    const context: NotificationsClientContext = {
      remote,
      inject(dependencies, install) {
        ;(injections as string[][]).push([...dependencies])
        install(context)
        return {
          then(resolve) { return Promise.resolve(resolve?.(undefined)) },
          async dispose() { for (const dispose of effects.reverse()) await dispose() },
        }
      },
      sessions: f.sessions as never,
      workspaces: f.workspaces as never,
      paimindArtifacts: f.artifacts as never,
      paimindSidebar: f.sidebar as never,
      locale: locale(),
      reflect: { provide(name, service) { services.set(name, service); return () => { services.delete(name) } } },
      slots: {
        inject(name, install) { let disposer = (): void => {}; const prior = captures.length; const registered = install(); disposer = registered; effects.push(disposer); expect(captures.length).toBeGreaterThan(prior) },
        register(options) { captures.push({ name: String(options.name), options: options as Record<string, unknown> }); return () => {} },
      },
      effect(install) { const disposer = install(); if (typeof disposer === 'function') effects.push(disposer) },
    }
    const dispose = await apply(context)
    expect(captures.map(entry => entry.name)).toEqual(['paimind.extension', 'sidebar.footer.action', 'shell.overlay'])
    expect(captures[1]?.options).toMatchObject({ id: 'paimind-notification-trigger', order: -5 })
    expect(injections).toContainEqual(expect.arrayContaining(['remote', 'remote.paimindNotifications']))
    expect(services.get('paimindNotificationCenter')).toBeInstanceOf(NotificationCenterController)
    await dispose()
  })
})
