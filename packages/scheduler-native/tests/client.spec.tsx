import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaimindLocaleSource } from '@paimind/harness-compat'
import {
  NativeScheduleOverlay,
  NativeScheduleTrigger,
  NativeSchedulerController,
  buildNativeScheduleCreatePrompt,
  buildNativeScheduleDeletePrompt,
} from '../src/client/index.tsx'

const locale: PaimindLocaleSource = {
  getLocale: () => ({ active: 'zh-CN' }),
  subscribe: () => () => {},
}

function fixture() {
  const list = vi.fn(async () => ({ ok: true as const, value: {
    sessionId: 'session-one',
    items: [{
      id: 'schedule-1', kind: 'every' as const, prompt: '检查项目状态', everySeconds: 300,
      scheduledAt: '2026-08-15T08:05:00.000Z', state: 'scheduled' as const, deliveryMode: 'session-local' as const,
    }],
  } }))
  const prompt = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
  const snapshot = { current: 'session-one', byId: { 'session-one': { running: false } } }
  const sessions = {
    list: { getSnapshot: () => snapshot, subscribe: () => () => {} },
    binding: () => ({ session: { prompt } }),
  }
  return { list, prompt, controller: new NativeSchedulerController({ list }, sessions as never) }
}

describe('Harness-native Scheduled Tasks client', () => {
  it('renders native Session-local records and submits exact native tool actions', async () => {
    const f = fixture()
    render(<><NativeScheduleTrigger wide controller={f.controller} locale={locale}/><NativeScheduleOverlay controller={f.controller} locale={locale}/></>)
    fireEvent.click(screen.getByRole('button', { name: '打开定时任务' }))
    expect(await screen.findByRole('dialog', { name: '定时任务' })).toBeInTheDocument()
    expect(await screen.findByText('schedule-1')).toBeInTheDocument()
    expect(screen.getByText('session-local')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('提醒内容'), { target: { value: '准备周报' } })
    fireEvent.click(screen.getByRole('button', { name: '交给原生会话创建' }))
    await waitFor(() => { expect(f.prompt).toHaveBeenCalledWith([{
      type: 'text',
      text: 'Call the native schedule_create tool exactly once with this JSON object: {"prompt":"准备周报","after_seconds":300}. Do not simulate a timer or create any other schedule.',
    }], 'queue') })

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => { expect(f.prompt).toHaveBeenLastCalledWith([{
      type: 'text',
      text: 'Call the native schedule_delete tool exactly once with this JSON object: {"id":"schedule-1"}. Do not delete any other schedule.',
    }], 'queue') })
    f.controller.dispose()
  })

  it('keeps the tool prompt builders narrow and deterministic', () => {
    expect(buildNativeScheduleCreatePrompt({ kind: 'every', prompt: ' ping ', everySeconds: 300 }))
      .toContain('{"prompt":"ping","every_seconds":300}')
    expect(buildNativeScheduleDeletePrompt('schedule-9')).toContain('{"id":"schedule-9"}')
  })
})
