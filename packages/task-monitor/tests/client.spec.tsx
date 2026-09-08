import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaimindLocaleSource } from '@hansen/harness-compat'
import { createClientContextFixture } from '@hansen/testkit'
import { apply, inject, TaskMonitorAction, type TaskMonitorActionProps } from '../src/client/index.js'

function locale(initial = 'en'): PaimindLocaleSource & { set(value: string): void } {
  let active = initial
  const listeners = new Set<() => void>()
  return {
    getLocale: () => ({ active }),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(value) { active = value; for (const listener of listeners) listener() },
  }
}

function props(language: PaimindLocaleSource): TaskMonitorActionProps {
  const artifact = {
    id: 'artifact:one', sourceId: 'source:one', sessionId: 'session-1', workspaceId: 'workspace-1',
    path: '/work/report.bento.html', title: 'Quarterly Report', kind: 'bento', state: 'available',
    updatedAt: 200, revision: '2', taskId: 'paimind-artifact-1', previewKind: 'bento-deck',
  }
  const artifactSnapshot = { revision: 1, artifacts: [artifact], diagnostics: [], focusedArtifactId: null }
  const projectSnapshot = { projects: [{ workspaceId: 'workspace-1', title: 'Buyer proposal', sessionIds: ['session-1'] }] }
  const sessionLogSnapshot = { bySession: {} }
  const sessionLogDownload = vi.fn(async () => {})
  const sessionsSnapshot = {
    current: 'session-1',
    byId: {
      'session-1': { id: 'session-1', displayTitle: 'Walmart analysis', running: false, agentPreset: 'Analyst' },
      'child-1': { id: 'child-1', displayTitle: 'Researcher', running: false, agentPreset: 'Research Agent' },
    },
    subagentsByParent: { 'session-1': { parentAvailable: true, entries: [{ kind: 'child' as const, id: 'child-1', activity: 'inactive' as const, hasChildren: false, mode: 'continuable' as const, label: 'Researcher' }] } },
    jobsBySession: { 'session-1': [
      { id: 'bash-1', kind: 'bash', label: 'Read source', status: 'completed' as const, startedAt: 100, finishedAt: 160 },
      { id: 'paimind-artifact-1', kind: 'paimind-artifact', label: 'Quarterly Report', status: 'completed' as const, startedAt: 100, finishedAt: 180 },
    ] },
  }
  const projections: Readonly<Record<string, unknown>> = {
    goal: { goal: { id: 'goal-1', objective: 'Create buyer proposal', phase: 'complete', maxGoalRounds: 8 }, roundsStarted: 3, updatedAt: 200 },
    todos: [{ content: 'Read source', status: 'completed' }, { content: 'Build Bento', status: 'completed' }],
    plan: { active: false, pending: false },
  }
  return {
    sessionId: 'session-1', locale: language,
    sessions: {
      list: { getSnapshot: () => sessionsSnapshot, subscribe: () => () => {} },
      open: vi.fn(), openSubagent: vi.fn(),
      binding: () => ({ session: {
        getSnapshot: () => ({ openState: 'open', composerPhase: 'active', running: false, runningCalls: [], pending: [], partial: null, nodes: [], queue: [] }),
        subscribe: () => () => {},
        projections: { faceOf: (key: string) => ({ getSnapshot: () => projections[key], subscribe: () => () => {} }) },
      } }),
    },
    workspaces: { openPath: vi.fn(async () => {}) } as never,
    artifacts: {
      getSnapshot: () => artifactSnapshot,
      subscribe: () => () => {},
    } as never,
    projects: {
      getSnapshot: () => projectSnapshot,
      subscribe: () => () => {},
    } as never,
    sessionLog: {
      store: { getSnapshot: () => sessionLogSnapshot, subscribe: () => () => {} },
      download: sessionLogDownload,
      dismiss: vi.fn(),
    },
    useSession: selector => selector({
      openState: 'open', composerPhase: 'active', running: false, runningCalls: [], pending: [], partial: null,
      nodes: [{
        kind: 'tool-result', callId: 'read-1', time: 10,
        call: { name: 'read_file', argsRaw: '{}' }, isError: false,
        callView: { card: 'generic', title: 'Read', kind: 'read', locations: [{ path: '/work/input.xlsx', line: 12 }] },
      }], queue: [],
      views: { get: (key: string) => key === 'trajectory' ? { requests: [{ prompt: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, tools: [{ name: 'mcp__unused__search' }] } }] } : undefined },
    }),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.head.querySelectorAll('style[data-paimind-plugin="@hansen/task-monitor"]').forEach(node => { node.remove() })
})

describe('Task Monitor client', () => {
  it('uses an icon trigger, orders the summary, loads exact resources, navigates outputs, and restores focus', async () => {
    const language = locale('en')
    const history = vi.fn(async () => ({ result: { ok: true as const, value: { hasMore: false, events: [
        { event: { type: 'user/message', seq: 41, data: { source: { kind: 'skill-invocation', name: 'bento-ppt' } } } },
        { event: { type: 'tool/call', seq: 42, data: { callId: 'mcp', name: 'mcp__feishu__read', arguments: '{}' } } },
        { event: { type: 'todo/write', seq: 43, data: { todos: [{ content: 'Prepare brief', status: 'completed' }] } } },
        { event: { type: 'todo/write', seq: 44, data: { todos: [{ content: 'Read source', status: 'completed' }, { content: 'Build Bento', status: 'completed' }] } } },
      ] } } }))
    const value: TaskMonitorActionProps = { ...props(language), sessionHistory: { history } }
    render(<TaskMonitorAction {...value} />)
    const trigger = screen.getByRole('button', { name: 'Task Monitor' })
    expect(trigger).toHaveTextContent('')
    expect(trigger.querySelector('[data-paimind-task-badge]')).toBeNull()
    expect(screen.getByRole('tooltip', { name: 'Task Monitor' })).toBeInTheDocument()
    await waitFor(() => { expect(history).toHaveBeenCalledTimes(1) })
    fireEvent.click(trigger)
    const panel = screen.getByRole('region', { name: 'Task Monitor' })
    expect(panel).toBeInTheDocument()
    expect(screen.queryByText(/Refresh preserves process-local Jobs/)).toBeNull()
    expect(screen.getByRole('heading', { name: 'Task Summary' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 3 }).map(node => node.textContent)).toEqual([
      'Task Progress', 'Agent, Skill & MCP', 'Input Files', 'Outputs & Artifacts',
    ])
    const subagentSummary = screen.getByRole('button', { name: 'View 1 Subagents' })
    expect(subagentSummary).toHaveTextContent('1Subagents')
    expect(subagentSummary.querySelector('svg')).not.toBeNull()
    const agentGroup = document.querySelector('[data-paimind-task-agent-group]')
    const subagentAnchor = agentGroup?.querySelector('[data-paimind-task-agent-children]')
    const panelHeader = panel.querySelector<HTMLElement>('[data-paimind-task-panel-header]')
    const scrollTo = vi.fn()
    Object.defineProperty(panel, 'scrollTop', { configurable: true, value: 24 })
    Object.defineProperty(panel, 'scrollTo', { configurable: true, value: scrollTo })
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect)
    vi.spyOn(panelHeader!, 'getBoundingClientRect').mockReturnValue({ height: 50 } as DOMRect)
    vi.spyOn(subagentAnchor!, 'getBoundingClientRect').mockReturnValue({ top: 500 } as DOMRect)
    fireEvent.click(subagentSummary)
    expect(scrollTo).toHaveBeenCalledWith({ top: 362, behavior: 'smooth' })
    expect(subagentAnchor).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Task Progress' }).parentElement?.querySelector('[data-paimind-task-subagent]')).toBeNull()
    expect(agentGroup?.querySelector('[data-paimind-task-subagent]')).not.toBeNull()
    await waitFor(() => {
      expect(screen.getByText('bento-ppt').closest('[data-paimind-task-capability-row]')).toHaveAttribute('data-kind', 'skill')
      expect(screen.getByText('feishu').closest('[data-paimind-task-capability-row]')).toHaveAttribute('data-kind', 'mcp')
    })
    expect(history).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('unused')).toBeNull()
    expect(screen.queryByText(/bento-ppt · Used/)).toBeNull()
    expect(screen.getByText('Current checklist')).toBeInTheDocument()
    expect(screen.getByText('Previous checklist 1 · 1/1')).toBeInTheDocument()
    expect(screen.getAllByText('Read source')).toHaveLength(2)
    expect(screen.getAllByText('Quarterly Report').length).toBeGreaterThan(0)
    expect(screen.getByText('input.xlsx')).toBeInTheDocument()
    expect(screen.queryByText('Generated artifact')).toBeNull()
    expect(screen.queryByText('Deliverable')).toBeNull()
    expect(screen.queryByText('Input file')).toBeNull()
    expect(screen.queryByText('available')).toBeNull()
    expect(screen.queryByText('r2')).toBeNull()
    expect(screen.getByRole('button', { name: 'Quarterly Report' }).querySelector('[data-paimind-task-row-icon]')).toBeNull()
    const mainAgent = document.querySelector('[data-paimind-task-main-agent]')
    expect(mainAgent).toHaveTextContent('Main AgentAnalystLead')
    expect(mainAgent?.querySelector('svg')).not.toBeNull()
    expect(document.querySelector('[data-paimind-task-chip]')).toBeNull()
    expect(mainAgent?.querySelector('[data-paimind-task-model-tooltip]')).toBeNull()
    expect(mainAgent).not.toHaveAttribute('tabindex')
    const details = screen.getByText('Details & Log').closest('details')
    expect(details).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Details & Log'))
    expect(details).toHaveAttribute('open')
    expect(screen.getByText('Provider').nextElementSibling).toHaveTextContent('deepseek-official')
    expect(screen.getByText('Model').nextElementSibling).toHaveTextContent('deepseek-v4-flash')
    fireEvent.click(screen.getByRole('button', { name: 'Download Session Log' }))
    expect(value.sessionLog?.download).toHaveBeenCalledWith('session-1')
    fireEvent.click(screen.getByRole('button', { name: 'Quarterly Report' }))
    expect(value.workspaces.openPath).toHaveBeenCalledWith('/work/report.bento.html')
    expect(screen.queryByText('/work/report.bento.html')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Task Monitor' })).toBeNull()
    fireEvent.click(trigger)
    const subagent = screen.getByRole('button', { name: 'Open Subagent: Researcher' })
    expect(subagent).toHaveAttribute('data-paimind-task-subagent')
    expect(subagent.querySelector('[data-paimind-task-agent-tooltip]')).toHaveTextContent('Researcher')
    expect(subagent.querySelector('[data-paimind-task-agent-avatar]')).toHaveAttribute('data-variant', 'browse')
    expect(subagent).toHaveTextContent('Research Agent')
    fireEvent.click(subagent)
    expect(value.sessions.openSubagent).toHaveBeenCalledWith({ parentSessionId: 'session-1', childSessionId: 'child-1', mode: 'continuable' })
    expect(screen.queryByRole('region', { name: 'Task Monitor' })).toBeNull()
    fireEvent.click(trigger)
    act(() => { language.set('zh') })
    expect(screen.getByRole('region', { name: '任务监控' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: '任务监控' })).toBeNull()
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('region', { name: '任务监控' })).toBeNull()
  })

  it('omits empty sections and zero-value summary placeholders', () => {
    const language = locale('en')
    const value = props(language)
    const snapshot = value.sessions.list.getSnapshot()
    const sparseSnapshot = {
      ...snapshot,
      current: 'sparse-session',
      byId: { 'sparse-session': { ...snapshot.byId['session-1'], id: 'sparse-session', agentPreset: undefined } },
      subagentsByParent: {},
      jobsBySession: {},
    }
    const sparseArtifactSnapshot = { revision: 1, artifacts: [], diagnostics: [], focusedArtifactId: null }
    const sparseProjectSnapshot = { projects: [] }
    const sparse: TaskMonitorActionProps = {
      ...value,
      sessionId: 'sparse-session',
      sessions: {
        ...value.sessions,
        binding: undefined,
        list: {
          getSnapshot: () => sparseSnapshot,
          subscribe: () => () => {},
        },
      },
      artifacts: { getSnapshot: () => sparseArtifactSnapshot, subscribe: () => () => {} } as never,
      projects: { getSnapshot: () => sparseProjectSnapshot, subscribe: () => () => {} } as never,
      sessionLog: undefined,
      useSession: selector => selector({
        openState: 'open', composerPhase: 'active', running: false, runningCalls: [], pending: [], partial: null,
        nodes: [], queue: [],
      }),
    }
    render(<TaskMonitorAction {...sparse} />)
    fireEvent.click(screen.getByRole('button', { name: 'Task Monitor' }))
    expect(screen.queryByRole('heading', { name: 'Agent, Skill & MCP' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Outputs & Artifacts' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Input Files' })).toBeNull()
    expect(screen.queryByText('No Project')).toBeNull()
    expect(screen.queryByText('Plan mode')).toBeNull()
    expect(document.querySelector('[data-paimind-task-summary-stat="subagents"]')).toBeNull()
    expect(document.querySelector('[data-paimind-task-summary-stat="outputs"]')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('No task content yet')
    expect(screen.getByText('Details').closest('details')).not.toHaveAttribute('open')
  })

  it('shows four Subagent rows first and folds the remaining rows behind an explicit disclosure', () => {
    const language = locale('en')
    const value = props(language)
    const snapshot = value.sessions.list.getSnapshot()
    const children = Array.from({ length: 6 }, (_, index) => ({
      kind: 'child' as const,
      id: `child-${index + 1}`,
      activity: index === 5 ? 'running' as const : 'inactive' as const,
      hasChildren: false,
      mode: 'continuable' as const,
      label: `Researcher ${index + 1}`,
    }))
    const denseSnapshot = { ...snapshot, subagentsByParent: { 'session-1': { parentAvailable: true, entries: children } } }
    const dense: TaskMonitorActionProps = {
      ...value,
      sessions: {
        ...value.sessions,
        list: {
          getSnapshot: () => denseSnapshot,
          subscribe: () => () => {},
        },
      },
    }
    render(<TaskMonitorAction {...dense} />)
    fireEvent.click(screen.getByRole('button', { name: 'Task Monitor' }))
    const buttons = screen.getAllByRole('button', { name: /Open Subagent:/ })
    expect(buttons).toHaveLength(6)
    expect(buttons.filter(button => button.closest('details') === null)).toHaveLength(4)
    const avatars = [...document.querySelectorAll<HTMLElement>('[data-paimind-task-agent-avatar]')]
    expect(avatars).toHaveLength(6)
    expect(new Set(avatars.slice(0, 5).map(avatar => avatar.dataset.variant)).size).toBe(5)
    expect(avatars[1]?.querySelector('[data-paimind-task-agent-tooltip]')).toHaveTextContent('Researcher 1')
    const disclosure = screen.getByText('2 more Subagents').closest('details')
    expect(disclosure).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('2 more Subagents'))
    expect(disclosure).toHaveAttribute('open')
  })

  it('keeps the summary trigger state-agnostic even when the Session needs attention', () => {
    const language = locale('en')
    const value = props(language)
    const blocked: TaskMonitorActionProps = {
      ...value,
      useSession: selector => selector({
        openState: 'open', composerPhase: 'active', running: false, runningCalls: [], pending: [], partial: null,
        nodes: [], queue: [], lastAgentError: 'Agent failed',
      }),
    }
    const { container } = render(<TaskMonitorAction {...blocked} />)
    const trigger = screen.getByRole('button', { name: 'Task Monitor' })
    expect(trigger).not.toHaveAttribute('data-status')
    expect(container.querySelector('[data-paimind-task-trigger-dot]')).toBeNull()
    expect(container.querySelector('[data-paimind-task-badge]')).toBeNull()
    fireEvent.click(trigger)
    expect(container.ownerDocument.querySelector('[data-paimind-task-status-pill]')).toHaveAttribute('data-status', 'blocked')
  })

  it('consolidates the native Agent, Subagent, Job, and Session Log seats with reversible priority overrides', () => {
    const fixture = createClientContextFixture()
    apply(fixture.context)
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'workspaces', 'paimindArtifacts', 'paimindWorkspaceProject'])
    expect(fixture.services.size).toBe(0)
    const header = fixture.slots.filter(entry => entry.injectedName === 'conversation.session.header.actions')
    expect(header.map(entry => entry.options)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agent-preset', order: -10, priority: -10 }),
      expect.objectContaining({ id: 'subagent-catalog', order: 10, priority: -10 }),
      expect.objectContaining({ id: 'job-list', order: 20, priority: -10 }),
    ]))
    const utilities = fixture.slots.filter(entry => entry.injectedName === 'conversation.session.header.utilities')
    expect(utilities.map(entry => entry.options)).toEqual([
      expect.objectContaining({ id: 'session-log-download', order: 0, priority: -10 }),
    ])
    const extension = fixture.slots.find(entry => entry.injectedName === 'paimind.extension')
    expect(extension?.inject?.()).toMatchObject({ descriptor: {
      surface: 'header-button', maturity: 'technical-preview', category: 'automation',
    } })
    fixture.disposeEffects()
    expect(header.every(entry => entry.disposed())).toBe(true)
    expect(utilities.every(entry => entry.disposed())).toBe(true)
    expect(document.head.querySelector('style[data-paimind-plugin="@hansen/task-monitor"]')).toBeNull()
  })

  it('aligns the collapsed-sidebar summary trigger with the fixed rail controls', () => {
    const fixture = createClientContextFixture()
    apply(fixture.context)
    const style = document.head.querySelector<HTMLStyleElement>('style[data-paimind-plugin="@hansen/task-monitor"]')
    expect(style?.textContent).toContain(
      'body[data-dsh-sidebar-collapsed] [data-paimind-task-action] { transform:translateY(-11px); }',
    )
    fixture.disposeEffects()
  })
})
