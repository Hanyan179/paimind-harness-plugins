import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaimindLocaleSource } from '@hansen/harness-compat'
import {
  SCHEDULE_STARTER_PROMPT,
  SchedulerController,
  SchedulerOverlay,
  SchedulerSettingsEntry,
  SchedulerTrigger,
} from '../src/client/index.tsx'

function locale(active = 'en'): PaimindLocaleSource {
  return { getLocale: () => ({ active }), subscribe: () => () => {} }
}

function fixture(options: { readonly includeWorkflow?: boolean } = {}) {
  const definitions = [
    {
      scheduleId: 'schedule:weekly', name: 'Weekly project brief', actionId: 'paimind:agent-prompt',
      actionInput: { prompt: 'Summarize the project and list the three next actions.', cwd: '/workspace' },
      sourceSessionId: 'session-setup',
      rule: { kind: 'weekly' as const, weekday: 1 as const, time: '09:00' }, timeZone: 'Asia/Shanghai',
      status: 'enabled' as const, nextRunAt: '2026-08-17T01:00:00.000Z',
      createdAt: '2026-08-15T01:00:00.000Z', updatedAt: '2026-08-15T01:00:00.000Z', version: 'version:weekly',
    },
    {
      scheduleId: 'schedule:paused', name: 'Daily competitor watch', actionId: 'paimind:agent-prompt',
      actionInput: { prompt: 'Watch competitor updates.' }, sourceSessionId: 'session-paused',
      rule: { kind: 'daily' as const, time: '17:00' }, timeZone: 'Asia/Shanghai', status: 'paused' as const,
      createdAt: '2026-08-15T01:00:00.000Z', updatedAt: '2026-08-15T01:00:00.000Z', version: 'version:paused',
    },
    {
      scheduleId: 'schedule:archived', name: 'Archived reminder', actionId: 'paimind:agent-prompt',
      actionInput: { kind: 'agent-prompt', version: 1, prompt: 'Archived work.' },
      rule: { kind: 'daily' as const, time: '12:00' }, timeZone: 'Asia/Shanghai', status: 'archived' as const,
      createdAt: '2026-08-14T01:00:00.000Z', updatedAt: '2026-08-15T01:00:00.000Z', archivedAt: '2026-08-15T01:00:00.000Z', version: 'version:archived',
    },
  ]
  const runs = [{
    runId: 'run:one', idempotencyKey: 'key:one', scheduleId: 'schedule:weekly', actionId: 'paimind:agent-prompt',
    trigger: 'schedule' as const, scheduledFor: '2026-08-15T01:00:00.000Z', status: 'succeeded' as const, attempt: 1,
    createdAt: '2026-08-15T01:00:00.000Z', startedAt: '2026-08-15T01:00:01.000Z',
    finishedAt: '2026-08-15T01:01:00.000Z', message: 'Brief generated',
    action: { kind: 'session' as const, label: 'Open conversation', sessionId: 'session-result' }, version: 'version:run',
  }]
  const list = vi.fn(async () => ({
    ok: true as const,
    value: {
      actions: [
        {
          actionId: 'paimind:agent-prompt', source: { id: 'paimind.ai', nameZh: 'AI', nameEn: 'AI' },
          nameZh: '智能任务', nameEn: 'AI task', category: 'ai' as const, adapterId: 'adapter:harness',
          conversationEnabled: true, enabled: true, version: 'version:action',
        },
        ...(options.includeWorkflow === false ? [] : [{
          actionId: 'paimind:workflow-project-review', source: { id: 'paimind.workflow', nameZh: '工作流', nameEn: 'Workflow' },
          nameZh: '项目复盘流程', nameEn: 'Project review workflow', category: 'workflow' as const, adapterId: 'adapter:workflow',
          enabled: true, version: 'version:workflow',
        }]),
        {
          actionId: 'paimind:message-digest', source: { id: 'paimind.message', nameZh: '消息', nameEn: 'Message' },
          nameZh: '消息摘要', nameEn: 'Message digest', category: 'message' as const, adapterId: 'adapter:message',
          enabled: true, version: 'version:message',
        },
      ],
      definitions,
      runs,
    },
  }))
  const update = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: definitions[0]! } }))
  const runNow = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: runs[0]! } }))
  const sessionsState = {
    current: 'session-existing',
    byId: {
      'session-existing': {
        id: 'session-existing', title: 'Existing', blank: false,
        cwd: '/workspace/current', agentPreset: 'paramont',
      },
    },
  }
  const listeners = new Set<() => void>()
  const setDraft = vi.fn()
  const sessionContext = {}
  const sessions = {
    list: {
      getSnapshot: () => sessionsState,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    open: vi.fn(),
    binding: vi.fn((sessionId: string) => sessionId === 'session-new' ? { ctx: sessionContext } : undefined),
  }
  const workspaces = {
    startSession: vi.fn(() => {
      sessionsState.current = 'session-new'
      Object.assign(sessionsState.byId, { 'session-new': { id: 'session-new', title: '', blank: true } })
      for (const listener of listeners) listener()
    }),
  }
  const create = vi.fn(async () => ({ ok: true as const, value: definitions[0]! }))
  const restore = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: definitions[2]! } }))
  const remote = { list, create, update, setEnabled: update, runNow, archive: update, restore }
  const conversation = { input: { for: () => ({ setDraft }) } }
  const controller = new SchedulerController(remote as never, sessions as never, workspaces as never, conversation as never)
  return { controller, list, create, update, restore, runNow, sessions, workspaces, setDraft }
}

function renderOverlay(f: ReturnType<typeof fixture>): void {
  render(<><SchedulerTrigger wide controller={f.controller} locale={locale()} /><SchedulerOverlay controller={f.controller} locale={locale()} /></>)
  fireEvent.click(screen.getByRole('button', { name: 'Open Platform Scheduler' }))
}

describe('conversational Scheduled Tasks client', () => {
  it('creates one native setup conversation and leaves the exact starter prompt editable', async () => {
    const f = fixture()
    renderOverlay(f)
    expect(await screen.findByRole('dialog', { name: 'Platform Scheduler' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New task' }))
    expect(screen.getByRole('radiogroup', { name: 'Task type' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Smart task' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Workflow' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Message task' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Create with AI' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Integration' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Monitor' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create with AI' }))
    await waitFor(() => { expect(f.setDraft).toHaveBeenCalledWith(SCHEDULE_STARTER_PROMPT) })
    expect(f.workspaces.startSession).toHaveBeenCalledTimes(1)
    expect(f.sessions.open).toHaveBeenCalledWith('session-new')
    expect(screen.queryByText(/actionId|Adapter/)).toBeNull()
    f.controller.dispose()
  })

  it('filters and searches by business-facing task state without exposing action identifiers', async () => {
    const f = fixture()
    renderOverlay(f)
    expect(await screen.findByText('Weekly project brief')).toBeInTheDocument()
    expect(screen.getByText('Daily competitor watch')).toBeInTheDocument()
    expect(screen.queryByText('Archived reminder')).toBeNull()
    expect(screen.queryByText('paimind:agent-prompt')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Run now' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Pause' }).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: 'Paused' }))
    expect(screen.queryByText('Weekly project brief')).toBeNull()
    expect(screen.getByText('Daily competitor watch')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'All' }))
    fireEvent.change(screen.getByLabelText('Search platform scheduled tasks'), { target: { value: 'project' } })
    expect(screen.getByText('Weekly project brief')).toBeInTheDocument()
    expect(screen.queryByText('Daily competitor watch')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search platform scheduled tasks'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Archived' }))
    expect(screen.getByText('Archived reminder')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => { expect(f.restore).toHaveBeenCalledWith({ scheduleId: 'schedule:archived', ifVersion: 'version:archived' }) })
    f.controller.dispose()
  })

  it('shows instructions, run history, setup conversation, and an independent result conversation', async () => {
    const f = fixture()
    renderOverlay(f)
    fireEvent.click(await screen.findByRole('button', { name: 'Weekly project brief' }))
    expect(screen.getByText('Summarize the project and list the three next actions.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Run history' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open setup conversation' }))
    expect(f.sessions.open).toHaveBeenCalledWith('session-setup')
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
    expect(f.sessions.open).toHaveBeenCalledWith('session-result')
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))
    await waitFor(() => { expect(f.runNow).toHaveBeenCalledWith({ scheduleId: 'schedule:weekly' }) })
    f.controller.dispose()
  })

  it('edits only the business schedule while preserving hidden routing and setup context', async () => {
    const f = fixture()
    renderOverlay(f)
    fireEvent.click(await screen.findByRole('button', { name: 'Weekly project brief' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit task' }))
    expect(screen.queryByLabelText('Action')).toBeNull()
    fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'weekdays' } })
    fireEvent.input(screen.getByLabelText('Run time'), { target: { value: '08:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(f.update).toHaveBeenCalledWith(expect.objectContaining({
      scheduleId: 'schedule:weekly', ifVersion: 'version:weekly', actionId: 'paimind:agent-prompt',
      sourceSessionId: 'session-setup',
      actionInput: { kind: 'agent-prompt', version: 1, prompt: 'Summarize the project and list the three next actions.', cwd: '/workspace' },
      rule: { kind: 'weekdays', time: '08:30' },
    })) })
    f.controller.dispose()
  })

  it('renders the same searchable task workspace directly in Settings', async () => {
    const f = fixture()
    const close = vi.fn()
    render(<SchedulerSettingsEntry controller={f.controller} locale={locale()} close={close} />)
    expect(await screen.findByRole('heading', { name: 'Platform Scheduler' })).toBeInTheDocument()
    expect(screen.getByLabelText('Search platform scheduled tasks')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['All', 'Enabled', 'Paused', 'Archived'])
    expect(screen.queryByRole('tab', { name: 'Run records' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New task' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create with AI' }))
    await waitFor(() => { expect(close).toHaveBeenCalledTimes(1) })
    f.controller.dispose()
  })

  it('creates a platform task through direct configuration without opening a conversation', async () => {
    const f = fixture()
    render(<SchedulerSettingsEntry controller={f.controller} locale={locale()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New task' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Smart task' }))
    expect(screen.getByLabelText('Specific work')).toHaveValue('paimind:agent-prompt')
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Direct daily brief' } })
    fireEvent.change(screen.getByLabelText('Task instructions'), { target: { value: 'Create a concise daily brief.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(f.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Direct daily brief', actionId: 'paimind:agent-prompt',
      actionInput: {
        kind: 'agent-prompt', version: 1, prompt: 'Create a concise daily brief.',
        cwd: '/workspace/current', agentPreset: 'paramont',
      },
    })) })
    expect(f.workspaces.startSession).not.toHaveBeenCalled()
    f.controller.dispose()
  })

  it('separates schedule enablement from run execution state in Chinese', async () => {
    const f = fixture()
    render(<SchedulerSettingsEntry controller={f.controller} locale={locale('zh-CN')} />)
    const task = await screen.findByRole('button', { name: 'Weekly project brief' })
    const row = task.closest('[data-paimind-scheduler-task-card]')
    expect(row).not.toBeNull()
    expect(row).toHaveTextContent('已启用')
    expect(row).not.toHaveTextContent('调度中')
    expect(screen.getByRole('tab', { name: '已启用' })).toBeInTheDocument()
    f.controller.dispose()
  })

  it('keeps the three business work types separate from specific work', async () => {
    const f = fixture()
    render(<SchedulerSettingsEntry controller={f.controller} locale={locale()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New task' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Workflow' }))
    expect(screen.getByLabelText('Specific work')).toHaveValue('paimind:workflow-project-review')
    expect(screen.queryByRole('option', { name: 'Smart task' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Integration' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Monitor' })).toBeNull()
    f.controller.dispose()
  })

  it('shows an honest empty state when a visible business work type has no registered provider', async () => {
    const f = fixture({ includeWorkflow: false })
    render(<SchedulerSettingsEntry controller={f.controller} locale={locale()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New task' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Workflow' }))
    expect(screen.getByText('No workflow work is connected yet.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Specific work')).toBeNull()
    f.controller.dispose()
  })
})
