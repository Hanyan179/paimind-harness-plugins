import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  const sessions = {
    list: { getSnapshot: () => ({ current: 'session-1', byId: {} }), subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
    open: vi.fn(),
  }
  const artifacts = {
    getSnapshot: vi.fn(() => ({ revision: 0, artifacts: [{ id: 'artifact:one', path: '/workspace/report.bento.html' }], diagnostics: [] })),
    subscribe: vi.fn(() => () => {}), registerSource: vi.fn(), registerAction: vi.fn(),
    actionsFor: vi.fn(() => []), runAction: vi.fn(), focus: vi.fn(() => true), dispose: vi.fn(),
  }
  const sidebar = {
    getStatus: vi.fn(), subscribe: vi.fn(() => () => {}), registerTab: vi.fn(), registerFileViewer: vi.fn(),
    openTab: vi.fn(() => true), closeTab: vi.fn(() => true), getFileCapability: vi.fn(), openFile: vi.fn(), dispose: vi.fn(),
  }
  const workspaces = { openPath: vi.fn(async () => {}) }
  const controller = new NotificationCenterController({ list, markRead, markAllRead }, sessions as never, workspaces as never, artifacts as never, sidebar as never)
  return { controller, list, markRead, markAllRead, sessions, workspaces, artifacts, sidebar }
}

afterEach(() => { document.head.querySelectorAll('style[data-paimind-plugin]').forEach(node => { node.remove() }) })

describe('FP12 Notification Center client', () => {
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
    expect(f.artifacts.focus).toHaveBeenCalledWith('artifact:one')
    expect(f.workspaces.openPath).toHaveBeenCalledWith('/workspace/report.bento.html')
    expect(f.sidebar.openTab).not.toHaveBeenCalled()
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
    expect(await screen.findByText('1 条未读；详情按需展开。')).toBeInTheDocument()
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
