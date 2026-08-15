import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaimindLocaleSource } from '@paimind/harness-compat'
import { createClientContextFixture } from '@paimind/testkit'
import {
  apply, LauncherBoundary, LauncherController, LauncherOverlay, LauncherTrigger,
  type LauncherDestination,
} from '../src/client/index.tsx'

function locale(initial = 'en'): PaimindLocaleSource & { set(active: string): void } {
  let active = initial
  const listeners = new Set<() => void>()
  return {
    getLocale: () => ({ active }),
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      active = next
      for (const listener of listeners) listener()
    },
  }
}

function availableDestination(overrides: Partial<LauncherDestination> = {}): LauncherDestination {
  return {
    id: 'test-panel', order: 5, featurePackage: 'FP09', availability: 'available',
    titleZh: '测试面板', titleEn: 'Test panel', descriptionZh: '测试', descriptionEn: 'Test',
    Panel: () => <div>real destination panel</div>,
    ...overrides,
  }
}

describe('FP02 launcher controller', () => {
  it('opens, selects, closes, and publishes stable ordered snapshots', () => {
    const controller = new LauncherController()
    const listener = vi.fn()
    const off = controller.subscribe(listener)
    controller.open(null, 'skills')
    expect(controller.getSnapshot()).toMatchObject({ open: true, activeId: 'skills' })
    expect(controller.getSnapshot().destinations.map(entry => entry.id)).toEqual([
      'agents', 'skills', 'notifications', 'scheduled-tasks', 'personal-settings',
      'administration', 'developer-resources',
    ])
    controller.select('notifications')
    expect(controller.getSnapshot().activeId).toBe('notifications')
    controller.close({ restoreFocus: false })
    expect(controller.getSnapshot().open).toBe(false)
    expect(listener).toHaveBeenCalledTimes(3)
    off()
  })

  it('stacks destination overrides and restores the placeholder on disposal', () => {
    const controller = new LauncherController()
    const dispose = controller.register(availableDestination({ id: 'agents' }))
    expect(controller.getSnapshot().destinations.find(entry => entry.id === 'agents'))
      .toMatchObject({ availability: 'available', titleEn: 'Test panel' })
    dispose()
    expect(controller.getSnapshot().destinations.find(entry => entry.id === 'agents'))
      .toMatchObject({ availability: 'planned', titleEn: 'Agent Center' })
    dispose()
  })
})

describe('FP02 launcher UI', () => {
  beforeEach(() => { document.body.style.overflow = '' })
  afterEach(() => {
    document.head.querySelectorAll('style[data-paimind-plugin]').forEach(node => { node.remove() })
  })

  function renderSurface(options: { wide?: boolean; language?: string } = {}) {
    const controller = new LauncherController()
    const localeSource = locale(options.language ?? 'en')
    const view = render(
      <div data-test-frame>
        <aside data-test-background>
          <LauncherTrigger wide={options.wide ?? true} controller={controller} locale={localeSource} />
        </aside>
        <main data-test-background>native conversation</main>
        <div data-shell-overlay>
          <LauncherOverlay controller={controller} locale={localeSource} />
        </div>
      </div>,
    )
    return { controller, localeSource, view }
  }

  it('opens an honest planned overlay, selects destinations, and restores focus on Escape', async () => {
    renderSurface()
    const trigger = screen.getByRole('button', { name: 'Open PAIMind' })
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'PAIMind Launcher' })
    expect(dialog).toHaveTextContent('Planned')
    expect(dialog).toHaveTextContent('FP09')
    expect(screen.getByText('native conversation').closest('main')).toHaveAttribute('inert')
    expect(screen.getByText('native conversation').closest('main')).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Skill Center/ }))
    expect(dialog).toHaveTextContent('Skill Center')
    expect(dialog).toHaveTextContent('FP11')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
    expect(screen.getByText('native conversation').closest('main')).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('')
  })

  it('supports a rail trigger, live locale switching, backdrop dismissal, and tab containment', async () => {
    const { localeSource } = renderSurface({ wide: false, language: 'en' })
    const trigger = screen.getByRole('button', { name: 'Open PAIMind' })
    expect(trigger).toHaveAttribute('data-wide', 'false')
    fireEvent.click(trigger)
    const close = await screen.findByRole('button', { name: 'Close PAIMind' })
    await waitFor(() => { expect(document.activeElement).toBe(close) })
    const last = screen.getByRole('button', { name: /Developer Resources/ })
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    close.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    act(() => { localeSource.set('zh') })
    expect(screen.getByRole('dialog', { name: 'PAIMind 平台启动器' })).toBeInTheDocument()
    fireEvent.mouseDown(document.querySelector('[data-paimind-launcher-mask]') as Element)
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('renders a later package panel only when it registers as available', async () => {
    const { controller } = renderSurface()
    let dispose = (): void => {}
    act(() => { dispose = controller.register(availableDestination()) })
    const trigger = screen.getByRole('button', { name: 'Open PAIMind' })
    act(() => { controller.open(trigger, 'test-panel') })
    expect(await screen.findByText('real destination panel')).toBeInTheDocument()
    act(() => { dispose() })
    await waitFor(() => { expect(screen.queryByText('real destination panel')).toBeNull() })
  })
})

describe('FP02 launcher registration and isolation', () => {
  it('registers additively, provides one service, and disposes every effect', () => {
    const fixture = createClientContextFixture()
    apply(fixture.context)
    expect(fixture.slots).toHaveLength(2)
    expect(fixture.slots.map(slot => slot.injectedName)).toEqual([
      'sidebar.footer.action', 'shell.overlay',
    ])
    expect(fixture.slots[0]?.options).toMatchObject({
      id: 'paimind-launcher-trigger', order: -10, inject: expect.any(Function),
    })
    expect(fixture.services.get('paimindLauncher')).toBeInstanceOf(LauncherController)
    expect(document.head.querySelector('style[data-paimind-plugin="@paimind/launcher"]')).not.toBeNull()
    fixture.disposeEffects()
    expect(fixture.slots.every(slot => slot.disposed())).toBe(true)
    expect(fixture.services.has('paimindLauncher')).toBe(false)
    expect(document.head.querySelector('style[data-paimind-plugin="@paimind/launcher"]')).toBeNull()
  })

  it('contains a render failure and closes the launcher', () => {
    const controller = new LauncherController()
    controller.open(null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const boundary = new LauncherBoundary({ controller, children: <span>launcher</span> })
    boundary.state = LauncherBoundary.getDerivedStateFromError()
    boundary.componentDidCatch(new Error('panel failed'), { componentStack: 'Panel' })
    expect(boundary.render()).toBeNull()
    expect(controller.getSnapshot().open).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
