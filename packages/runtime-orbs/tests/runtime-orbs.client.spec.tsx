import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessConversationSnapshot, HarnessSessionListSnapshot } from '@paimind/harness-compat'
import { createClientContextFixture } from '@paimind/testkit'
import {
  apply, RuntimeOrbBoundary, RuntimeOrbDock, RuntimeOrbPreview,
} from '../src/client/index.tsx'

vi.mock('thinking-orbs', () => ({
  ThinkingOrb: ({ state, theme, paused }: { state: string; theme: string; paused: boolean }) => (
    <canvas
      data-thinking-orb={state}
      data-thinking-orb-theme={theme}
      data-thinking-orb-paused={String(paused)}
    />
  ),
}))

function snapshot(overrides: Partial<HarnessConversationSnapshot> = {}): HarnessConversationSnapshot {
  return {
    openState: 'open', composerPhase: 'active', running: false,
    runningCalls: [], pending: [], partial: null, ...overrides,
  }
}

function useSnapshot(value: HarnessConversationSnapshot) {
  return <T,>(selector: (source: HarnessConversationSnapshot) => T): T => selector(value)
}

function useSessionList(value: HarnessSessionListSnapshot = {
  current: 'current', byId: { current: { running: true } },
}) {
  return <T,>(selector: (source: HarnessSessionListSnapshot) => T): T => selector(value)
}

describe('FP01 runtime orbs', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    document.documentElement.lang = 'zh-CN'
    document.body.removeAttribute('data-ds-dark-theme')
  })

  afterEach(() => {
    window.history.replaceState({}, '', '/')
    document.head.querySelectorAll('style[data-paimind-plugin]').forEach(node => { node.remove() })
    delete document.documentElement.dataset.paimindMotion
  })

  it('renders every locked FP01 animation in the explicit QA preview', () => {
    render(<RuntimeOrbPreview />)
    expect(screen.getByRole('complementary', { name: 'PAIMind Runtime Orb Preview' }))
      .toBeInTheDocument()
    expect(screen.getAllByTestId('runtime-orb-preview-state')).toHaveLength(9)
    expect(document.querySelectorAll('[data-paimind-runtime-orb-preview] canvas')).toHaveLength(1)
    expect(screen.getByTestId('runtime-orb-preview-current').querySelector('canvas'))
      .toHaveAttribute('data-thinking-orb', 'solving')
    fireEvent.click(screen.getByRole('button', { name: 'shaping' }))
    expect(screen.getByTestId('runtime-orb-preview-current').querySelector('canvas'))
      .toHaveAttribute('data-thinking-orb', 'shaping')
  })

  it('renders a true reasoning phase as the solving orb', () => {
    render(<RuntimeOrbDock
      useSession={useSnapshot(snapshot({
        running: true,
        partial: { blocks: [{ kind: 'reasoning' }] },
      }))}
      useSessions={useSessionList()}
    />)
    expect(screen.getByRole('status', { name: '正在思考…' }))
      .toHaveAttribute('data-orb-state', 'solving')
  })

  it('renders exact tool and pending phases without reading display prose', () => {
    const { rerender } = render(<RuntimeOrbDock
      useSession={useSnapshot(snapshot({
        running: true,
        runningCalls: [{ name: 'generate_pdf' }],
      }))}
      useSessions={useSessionList()}
    />)
    expect(screen.getByRole('status', { name: '正在生成文件…' }))
      .toHaveAttribute('data-orb-state', 'shaping')

    rerender(<RuntimeOrbDock
      useSession={useSnapshot(snapshot({
        running: true,
        pending: [{ kind: 'question' }],
      }))}
      useSessions={useSessionList()}
    />)
    expect(screen.getByRole('status', { name: '等待你的选择' }))
      .toHaveAttribute('data-orb-state', 'breathing')
  })

  it('subscribes to the Harness locale instead of guessing from the document language', () => {
    let active = 'zh'
    const listeners = new Set<() => void>()
    const locale = {
      getLocale: () => ({ active }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    render(<RuntimeOrbDock
      useSession={useSnapshot(snapshot({ running: true, runningCalls: [{ name: 'grep' }] }))}
      useSessions={useSessionList()}
      locale={locale}
    />)
    expect(screen.getByRole('status', { name: '正在搜索…' })).toBeInTheDocument()
    act(() => {
      active = 'en'
      for (const listener of listeners) listener()
    })
    expect(screen.getByRole('status', { name: 'Searching…' }))
      .toHaveAttribute('data-orb-state', 'searching')
  })

  it('stays absent while the native conversation is idle', () => {
    const { container } = render(
      <RuntimeOrbDock useSession={useSnapshot(snapshot())} useSessions={useSessionList({ current: 'current', byId: { current: { running: false } } })} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('plays exactly one current activity orb while keeping the status label orb-free', async () => {
    const native = document.createElement('div')
    native.innerHTML = `
      <div role="treeitem" aria-selected="false"><span data-idle><span data-state="done"></span></span></div>
      <div role="treeitem" aria-selected="true"><span data-active-slot><svg data-state="ongoing"></svg></span></div>
      <div data-chat-flow>
        <div data-variant="think" data-state="running"><div data-disclosure-row><span data-think-native><i></i></span></div></div>
        <div role="status">Deep diving...</div>
      </div>
    `
    document.body.append(native)

    const view = render(<RuntimeOrbDock
      useSession={useSnapshot(snapshot({
        running: true,
        partial: { blocks: [{ kind: 'reasoning' }] },
      }))}
      useSessions={useSessionList()}
    />)
    await waitFor(() => {
      expect(native.querySelectorAll('[data-paimind-runtime-orb]')).toHaveLength(2)
    })
    expect(native.querySelector('[data-active-slot] [data-orb-state="solving"]')).not.toBeNull()
    expect(native.querySelector('[data-chat-flow] > [role="status"] [data-runtime-phase="thinking"]'))
      .toHaveTextContent('正在思考…')
    expect(native.querySelector('[data-chat-flow] > [role="status"] [data-runtime-phase="thinking"]'))
      .toHaveAttribute('data-orb-visible', 'false')
    expect(native.querySelector('[data-chat-flow] > [role="status"] [data-paimind-runtime-orb]'))
      .toBeNull()
    expect(native.querySelector('[data-think-native] [data-orb-state="solving"] canvas'))
      .toHaveAttribute('data-thinking-orb-paused', 'false')

    view.unmount()
    expect(native.querySelector('[data-active-slot]')).not.toHaveAttribute('data-paimind-runtime-sidebar-host')
    expect(native.querySelector('[data-chat-flow] > [role="status"]'))
      .not.toHaveAttribute('data-paimind-runtime-turn-status-host')
    native.remove()
  })

  it('restores native icons for every settled or failed history row', () => {
    const native = document.createElement('div')
    native.innerHTML = `
      <div data-chat-flow>
        <div data-variant="think" data-state="ok"><div data-disclosure-row><span data-think><i></i></span></div></div>
        <div data-variant="tool" data-tool="read" data-state="ok"><div data-disclosure-row><span data-read><i></i></span></div></div>
        <div data-variant="tool" data-tool="bash" data-state="error"><div data-disclosure-row><span data-error><i></i></span></div></div>
        <div data-sample="bash" data-variant="bash" data-state="ok"><span data-bash><i></i></span><span>Bash</span></div>
      </div>
    `
    document.body.append(native)
    const view = render(<RuntimeOrbDock
      useSession={useSnapshot(snapshot())}
      useSessions={useSessionList({ current: 'current', byId: { current: { running: false } } })}
    />)
    expect(native.querySelector('[data-think] [data-paimind-runtime-orb]')).toBeNull()
    expect(native.querySelector('[data-read] [data-paimind-runtime-orb]')).toBeNull()
    expect(native.querySelector('[data-bash] [data-paimind-runtime-orb]')).toBeNull()
    expect(native.querySelector('[data-error] [data-paimind-runtime-orb]')).toBeNull()
    view.unmount()
    native.remove()
  })

  it('animates every parallel running row without adding a status orb', async () => {
    const native = document.createElement('div')
    native.innerHTML = `
      <div data-chat-flow>
        <div data-variant="think" data-state="running"><div data-disclosure-row><span data-first><i></i></span></div></div>
        <div data-variant="tool" data-tool="grep" data-state="running"><div data-disclosure-row><span data-latest><i></i></span></div></div>
        <div role="status">Deep diving...</div>
      </div>
    `
    document.body.append(native)
    const view = render(<RuntimeOrbDock
      useSession={useSnapshot(snapshot({ running: true, runningCalls: [{ name: 'grep' }] }))}
      useSessions={useSessionList()}
    />)
    await waitFor(() => {
      expect(native.querySelectorAll('[data-placement="history"]')).toHaveLength(2)
    })
    expect(native.querySelector('[data-first] [data-orb-state="solving"]')).not.toBeNull()
    expect(native.querySelector('[data-latest] [data-orb-state="searching"]')).not.toBeNull()
    expect(native.querySelector('[role="status"] [data-paimind-runtime-orb]')).toBeNull()
    view.unmount()
    native.remove()
  })

  it('keeps an entire parallel search batch animated until the final search settles', async () => {
    const native = document.createElement('div')
    native.innerHTML = `
      <div data-chat-flow>
        <div data-chat-flow-kind="tool-call"><div data-variant="search" data-tool="web_search" data-state="ok"><div data-disclosure-row><span data-first-search><i></i></span></div></div></div>
        <div data-chat-flow-kind="tool-call"><div data-variant="search" data-tool="web_search" data-state="ok"><div data-disclosure-row><span data-second-search><i></i></span></div></div></div>
        <div data-chat-flow-kind="tool-call"><div data-variant="search" data-tool="web_search" data-state="running"><div data-disclosure-row><span data-third-search><i></i></span></div></div></div>
        <div role="status"><span>Deep diving...</span><span aria-hidden="true">31s</span></div>
      </div>
    `
    document.body.append(native)
    const view = render(<RuntimeOrbDock
      useSession={useSnapshot(snapshot({ running: true, runningCalls: [{ name: 'web_search' }] }))}
      useSessions={useSessionList()}
      locale={{ getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} }}
    />)
    await waitFor(() => {
      expect(native.querySelectorAll('[data-paimind-runtime-orb][data-placement="history"]')).toHaveLength(3)
    })
    expect(native.querySelector('[data-first-search] [data-orb-state="searching"]')).not.toBeNull()
    expect(native.querySelector('[data-second-search] [data-orb-state="searching"]')).not.toBeNull()
    expect(native.querySelector('[data-third-search] [data-orb-state="searching"]')).not.toBeNull()
    expect(native.querySelector('[role="status"] [data-paimind-runtime-status]'))
      .toHaveTextContent('正在搜索…')
    expect(native.querySelector('[role="status"] [data-paimind-runtime-orb]')).toBeNull()
    expect(native.querySelector('[role="status"] [aria-hidden="true"]')).toHaveTextContent('31s')
    view.unmount()
    native.remove()
  })

  it('renders multiple sidebar orbs only for sessions that Harness marks active', () => {
    const native = document.createElement('div')
    native.innerHTML = `
      <div role="treeitem" aria-selected="true"><span><svg data-state="ongoing"></svg></span></div>
      <div role="treeitem" aria-selected="false"><span><svg data-state="ongoing"></svg></span></div>
      <div role="treeitem" aria-selected="false"><span><span data-state="done"></span></span></div>
    `
    document.body.append(native)
    const view = render(<RuntimeOrbDock
      useSession={useSnapshot(snapshot({ running: true, runningCalls: [{ name: 'grep' }] }))}
      useSessions={useSessionList({
        current: 'current', byId: { current: { running: true }, background: { running: true }, idle: { running: false } },
      })}
    />)
    const sidebarOrbs = native.querySelectorAll('[data-paimind-runtime-orb][data-placement="sidebar"]')
    expect(sidebarOrbs).toHaveLength(2)
    expect(sidebarOrbs[0]).toHaveAttribute('data-orb-state', 'searching')
    expect(sidebarOrbs[1]).toHaveAttribute('data-orb-state', 'working')
    view.unmount()
    native.remove()
  })

  it('follows Harness dark mode and the operating-system reduced-motion preference', () => {
    document.body.setAttribute('data-ds-dark-theme', '')
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)
    const { container } = render(
      <RuntimeOrbDock useSession={useSnapshot(snapshot({ running: true }))} useSessions={useSessionList()} />,
    )
    const canvas = container.querySelector('canvas')
    expect(canvas).toHaveAttribute('data-thinking-orb-theme', 'dark')
    expect(canvas).toHaveAttribute('data-thinking-orb-paused', 'true')
  })

  it('also pauses for the PAIMind reduce preference without changing the visible state', async () => {
    const { container } = render(
      <RuntimeOrbDock useSession={useSnapshot(snapshot({ running: true }))} useSessions={useSessionList()} />,
    )
    const canvas = container.querySelector('canvas')
    expect(canvas).toHaveAttribute('data-thinking-orb-paused', 'false')
    document.documentElement.dataset.paimindMotion = 'reduce'
    await waitFor(() => { expect(canvas).toHaveAttribute('data-thinking-orb-paused', 'true') })
    expect(container.querySelector('[data-orb-state="solving"]')).not.toBeNull()
  })

  it('registers additively and disposes both slot and style effects', () => {
    const fixture = createClientContextFixture()
    apply(fixture.context)
    const dock = fixture.slots.find(slot => slot.injectedName === 'conversation.input.dock')
    const descriptor = fixture.slots.find(slot => slot.injectedName === 'paimind.extension')
    expect(dock?.options).toMatchObject({
      id: 'paimind-runtime-orbs', order: -20, inject: expect.any(Function),
    })
    expect(descriptor?.options).toMatchObject({ id: 'paimind:runtime-orbs' })
    expect(descriptor?.inject?.()).toMatchObject({ descriptor: { category: 'experience' } })
    expect(document.head.querySelector('style[data-paimind-plugin="@paimind/runtime-orbs"]')).not.toBeNull()
    fixture.disposeEffects()
    expect(fixture.slots.every(slot => slot.disposed())).toBe(true)
    expect(document.head.querySelector('style[data-paimind-plugin="@paimind/runtime-orbs"]')).toBeNull()
  })

  it('registers the QA overlay only when the explicit preview query is present', () => {
    window.history.replaceState({}, '', '/?paimindOrbPreview=1')
    const fixture = createClientContextFixture()
    apply(fixture.context)
    const overlay = fixture.slots.find(slot => slot.injectedName === 'shell.overlay')
    expect(overlay?.options).toMatchObject({ id: 'paimind-runtime-orbs-preview' })
    fixture.disposeEffects()
    expect(fixture.slots.every(slot => slot.disposed())).toBe(true)
  })

  it('contains an animation renderer failure instead of replacing the conversation', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const boundary = new RuntimeOrbBoundary({ children: <span>native conversation sibling</span> })
    boundary.state = RuntimeOrbBoundary.getDerivedStateFromError()
    boundary.componentDidCatch(new Error('canvas failed'), { componentStack: 'ThinkingOrb' })
    expect(boundary.render()).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
