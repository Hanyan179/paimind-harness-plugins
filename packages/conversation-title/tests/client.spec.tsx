// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaimindSettingsScope, PaimindSettingsScopeSnapshot } from '@hansen/harness-compat'
import { ConversationTitleModelService } from '../src/client/index.js'
import type { PaimindConversationTitleSettings } from '../src/settings.js'

function scope(): PaimindSettingsScope<PaimindConversationTitleSettings> {
  let snapshot: PaimindSettingsScopeSnapshot<PaimindConversationTitleSettings> = {
    status: 'ready', value: { enabled: true, modelRoute: '' }, base: undefined, user: undefined,
    revision: 1, writable: true, mode: 'host',
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async set(field, value) {
      snapshot = { ...snapshot, value: { ...snapshot.value!, [field]: value } }
      for (const listener of listeners) listener()
    },
    async unset() {},
  }
}

describe('Model services settings', () => {
  it('renders one concise conversation naming service with a working model selector', async () => {
    const settings = scope()
    const models = vi.fn(async () => ({ result: { ok: true as const, value: { groups: [{
      id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }],
    }] } } }))
    const { container } = render(<ConversationTitleModelService scope={settings} api={{ llm: { models } }} zh />)
    expect(screen.getByRole('heading', { name: '模型服务' })).toBeInTheDocument()
    expect(screen.getByText('对话自动命名')).toBeInTheDocument()
    expect(container.textContent).not.toContain('助理')
    await waitFor(() => { expect(screen.getByRole('option', { name: 'DeepSeek V4 Flash · DeepSeek' })).toBeInTheDocument() })
    fireEvent.change(screen.getByLabelText('对话自动命名模型'), { target: { value: '["deepseek-official","deepseek-v4-flash"]' } })
    await waitFor(() => { expect(settings.getSnapshot().value?.modelRoute).toBe('["deepseek-official","deepseek-v4-flash"]') })
    fireEvent.click(screen.getByRole('switch', { name: '启用对话自动命名' }))
    await waitFor(() => { expect(settings.getSnapshot().value?.enabled).toBe(false) })
  })
})
