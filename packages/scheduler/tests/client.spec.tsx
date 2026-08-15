import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaimindLocaleSource } from '@paimind/harness-compat'
import { SchedulerController, SchedulerOverlay, SchedulerSettingsEntry, SchedulerTrigger } from '../src/client/index.tsx'

function locale(active = 'en'): PaimindLocaleSource {
  return { getLocale: () => ({ active }), subscribe: () => () => {} }
}

function fixture(runState: 'running' | 'succeeded' = 'running', expiredOnce = false) {
  const run = runState === 'running'
    ? {
        runId: 'run:one', idempotencyKey: 'key:one', scheduleId: 'schedule:one', actionId: 'action:brief',
        trigger: 'schedule' as const, scheduledFor: '2026-08-15T01:00:00.000Z', status: 'running' as const, attempt: 1,
        createdAt: '2026-08-15T01:00:00.000Z', startedAt: '2026-08-15T01:00:01.000Z',
        message: 'Generating brief', progress: 64, version: 'version:run',
      }
    : {
        runId: 'run:one', idempotencyKey: 'key:one', scheduleId: 'schedule:one', actionId: 'action:brief',
        trigger: 'schedule' as const, scheduledFor: '2026-08-15T01:00:00.000Z', status: 'succeeded' as const, attempt: 1,
        createdAt: '2026-08-15T01:00:00.000Z', startedAt: '2026-08-15T01:00:01.000Z',
        finishedAt: '2026-08-15T01:01:00.000Z', message: 'Brief generated', version: 'version:run',
      }
  const list = vi.fn(async () => ({
    ok: true as const,
    value: {
      actions: [
        {
          actionId: 'action:brief', source: { id: 'paimind.ai', nameZh: 'PAIMind AI', nameEn: 'PAIMind AI' },
          nameZh: '生成项目简报', nameEn: 'Generate project brief', category: 'ai' as const,
          adapterId: 'adapter:harness', enabled: true, version: 'version:action',
        },
        {
          actionId: 'action:message', source: { id: 'service.message', nameZh: '消息服务', nameEn: 'Message service' },
          nameZh: '发送消息', nameEn: 'Send message', category: 'message' as const,
          adapterId: 'adapter:message', enabled: true, version: 'version:message-action',
        },
      ],
      definitions: [{
        scheduleId: 'schedule:one', name: 'Weekly project brief', actionId: 'action:brief',
        rule: expiredOnce
          ? { kind: 'once' as const, at: '2026-08-14T01:00:00.000Z' }
          : { kind: 'weekly' as const, weekday: 1 as const, time: '09:00' },
        timeZone: 'Asia/Shanghai',
        status: expiredOnce ? 'paused' as const : 'enabled' as const,
        ...(expiredOnce ? {} : { nextRunAt: '2026-08-17T01:00:00.000Z' }),
        createdAt: '2026-08-15T01:00:00.000Z', updatedAt: '2026-08-15T01:00:00.000Z', version: 'version:schedule',
      }],
      runs: [run],
    },
  }))
  const create = vi.fn(async () => ({ ok: true as const, value: (await list()).value.definitions[0]! }))
  const mutation = vi.fn(async () => ({
    ok: true as const,
    value: { ok: true as const, value: (await list()).value.definitions[0]! },
  }))
  const runNow = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: run } }))
  const sessions = { open: vi.fn() }
  const controller = new SchedulerController({ list, create, update: mutation, setEnabled: mutation, runNow, archive: mutation }, sessions as never)
  return { controller, list, create, mutation, runNow, sessions }
}

describe('platform Scheduled Tasks client', () => {
  it('renders exactly task list and run records without session reminder or business fields', async () => {
    const f = fixture()
    render(<><SchedulerTrigger wide controller={f.controller} locale={locale()} /><SchedulerOverlay controller={f.controller} locale={locale()} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Open Platform Scheduler' }))
    expect(await screen.findByRole('dialog', { name: 'Platform Scheduler' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Task list', 'Run records'])
    expect(await screen.findByText('Weekly project brief')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.queryByText('schedule:one')).toBeNull()
    expect(screen.queryByText('Asia/Shanghai')).toBeNull()
    expect(screen.queryByText('Generating brief')).toBeNull()
    expect(screen.queryByText(/schedule_create|Session-local|Run Now|Cron/)).toBeNull()
    expect(screen.queryByText(/Owner|Deadline|Matching mode/)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Run records' }))
    expect(screen.getByText('Running · 64%')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
    f.controller.dispose()
  })

  it('creates from business-only fields and archives without deleting run history', async () => {
    const f = fixture()
    render(<><SchedulerTrigger wide controller={f.controller} locale={locale()} /><SchedulerOverlay controller={f.controller} locale={locale()} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Open Platform Scheduler' }))
    await screen.findByText('Weekly project brief')
    fireEvent.click(screen.getByRole('button', { name: 'New task' }))
    expect(screen.getByRole('group', { name: 'AI and Agent' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Messaging' })).toBeInTheDocument()
    expect(screen.getByLabelText('Time zone').tagName).toBe('SELECT')
    expect(screen.getByLabelText('Scheduled runs')).toBeInTheDocument()
    const name = screen.getByLabelText('Task name')
    fireEvent.change(name, { target: { value: 'Daily focus' } })
    fireEvent.input(screen.getByLabelText('Run time'), { target: { value: '17:45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(f.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Daily focus', actionId: 'action:brief', enabled: true,
      rule: { kind: 'daily', time: '17:45' },
    })) })
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await waitFor(() => { expect(f.mutation).toHaveBeenCalled() })
    f.controller.dispose()
  })

  it('runs once now without changing the scheduled-run control', async () => {
    const f = fixture('succeeded')
    render(<><SchedulerTrigger wide controller={f.controller} locale={locale()} /><SchedulerOverlay controller={f.controller} locale={locale()} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Open Platform Scheduler' }))
    await screen.findByText('Weekly project brief')
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))
    await waitFor(() => { expect(f.runNow).toHaveBeenCalledWith({ scheduleId: 'schedule:one' }) })
    expect(screen.getByRole('tab', { name: 'Run records' })).toHaveAttribute('aria-selected', 'true')
    expect(f.mutation).not.toHaveBeenCalled()
    f.controller.dispose()
  })

  it('reuses Edit for an expired one-time task without a duplicate Reschedule action', async () => {
    const f = fixture('succeeded', true)
    render(<><SchedulerTrigger wide controller={f.controller} locale={locale()} /><SchedulerOverlay controller={f.controller} locale={locale()} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Open Platform Scheduler' }))
    await screen.findByText('Weekly project brief')
    expect(screen.getByRole('button', { name: 'Run now' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull()
    f.controller.dispose()
  })

  it('exposes a named settings entry that opens the same platform task list', () => {
    const f = fixture('succeeded')
    render(<SchedulerSettingsEntry controller={f.controller} locale={locale()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open task list' }))
    expect(f.controller.getSnapshot().open).toBe(true)
    f.controller.dispose()
  })
})
