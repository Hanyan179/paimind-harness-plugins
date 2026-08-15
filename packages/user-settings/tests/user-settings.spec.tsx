import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaimindSettingsScope, PaimindSettingsScopeSnapshot } from '@paimind/harness-compat'
import {
  DEFAULT_PAIMIND_USER_PREFERENCES,
  PaimindUserSettingsService,
  decodePaimindUserPreferences,
  renderPaimindUserPreferencePrompt,
  type PaimindUserPreferences,
} from '../src/index.ts'
import { RemotePaimindSettingsScope, UserSettingsSection, projectMotion } from '../src/client/index.tsx'

class MemoryScope implements PaimindSettingsScope<PaimindUserPreferences> {
  private snapshot: PaimindSettingsScopeSnapshot<PaimindUserPreferences>
  private readonly listeners = new Set<() => void>()

  constructor(value: PaimindUserPreferences = DEFAULT_PAIMIND_USER_PREFERENCES) {
    this.snapshot = { status: 'ready', value, base: undefined, user: {}, revision: 0, writable: true, mode: 'host' }
  }

  getSnapshot(): PaimindSettingsScopeSnapshot<PaimindUserPreferences> { return this.snapshot }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  async set(field: keyof PaimindUserPreferences, value: unknown): Promise<void> {
    this.snapshot = { ...this.snapshot, value: { ...this.snapshot.value!, [field]: value }, revision: (this.snapshot.revision ?? 0) + 1 }
    for (const listener of this.listeners) listener()
  }
  async unset(): Promise<void> {}
}

describe('FP14 PAIMind user settings', () => {
  it('decodes exact values and renders only real prompt deviations', () => {
    expect(renderPaimindUserPreferencePrompt(DEFAULT_PAIMIND_USER_PREFERENCES)).toBe('')
    const custom = decodePaimindUserPreferences({
      ...DEFAULT_PAIMIND_USER_PREFERENCES,
      responseLength: 'concise',
      personalInstructions: 'End every answer with TOKEN-14.',
    })
    expect(custom).toBeDefined()
    expect(renderPaimindUserPreferencePrompt(custom!)).toContain('TOKEN-14')
    expect(decodePaimindUserPreferences({ ...DEFAULT_PAIMIND_USER_PREFERENCES, motion: 'force' })).toBeUndefined()
  })

  it('evaluates all, attention and off without owning notification state', () => {
    const service = Object.create(PaimindUserSettingsService.prototype) as PaimindUserSettingsService
    const current = { ...DEFAULT_PAIMIND_USER_PREFERENCES }
    Object.assign(service, { source: () => current })
    expect(service.shouldPublishNotification('info')).toBe(true)
    current.notifications = 'attention'
    expect(service.shouldPublishNotification('info')).toBe(false)
    expect(service.shouldPublishNotification('error')).toBe(true)
    current.notifications = 'off'
    expect(service.shouldPublishNotification('error')).toBe(false)
  })

  it('reads and mutates the canonical Host namespace through the narrow PAIMind remote', async () => {
    const mutate = vi.fn(async () => {})
    const settings = {
      writable: true,
      register: vi.fn(),
      describe: () => [{ ns: 'paimind-user-settings', value: DEFAULT_PAIMIND_USER_PREFERENCES, revision: 7 }],
      mutate,
    }
    const service = Object.create(PaimindUserSettingsService.prototype) as PaimindUserSettingsService
    Object.assign(service, { settingsCtx: { get: () => settings } })
    await expect(service.describe()).resolves.toMatchObject({ status: 'ready', revision: 7, writable: true })
    await service.mutate({ field: 'motion', value: 'reduce', expectedRevision: 7 })
    expect(mutate).toHaveBeenCalledWith(
      expect.anything(),
      [{ op: 'set', path: ['motion'], value: 'reduce' }],
      7,
    )
  })

  it('keeps native revision/CAS semantics across the PAIMind client remote', async () => {
    let value = DEFAULT_PAIMIND_USER_PREFERENCES
    let revision = 11
    const mutate = vi.fn(async (request: { field: keyof PaimindUserPreferences; value: unknown; expectedRevision: number }) => {
      expect(request.expectedRevision).toBe(revision)
      value = Object.freeze({ ...value, [request.field]: request.value })
      revision += 1
      return { ok: true as const, value: { status: 'ready' as const, value, revision, writable: true } }
    })
    const scope = new RemotePaimindSettingsScope({
      describe: async () => ({ ok: true, value: { status: 'ready', value, revision, writable: true } }),
      mutate,
    })
    await waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    await scope.set('responseLength', 'concise')
    expect(mutate).toHaveBeenCalledOnce()
    expect(scope.getSnapshot()).toMatchObject({
      status: 'ready', revision: 12, value: { responseLength: 'concise' }, mode: 'host',
    })
    scope.dispose()
  })

  it('writes through the native scope and exposes no duplicate Harness controls', async () => {
    const scope = new MemoryScope()
    render(<UserSettingsSection scope={scope} zh />)
    expect(screen.getByRole('heading', { name: 'PAIMind 偏好' })).toBeInTheDocument()
    expect(screen.queryByText('Theme')).not.toBeInTheDocument()
    const instructions = screen.getByRole('textbox', { name: '个人指令' })
    fireEvent.change(instructions, { target: { value: 'Always include TOKEN-14.' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存个人指令' })) })
    await waitFor(() => { expect(scope.getSnapshot().value?.personalInstructions).toBe('Always include TOKEN-14.') })
    expect(screen.getByRole('status')).toHaveTextContent('已保存到 Harness 设置')
  })

  it('presents notification preferences in business language and persists the selected range', async () => {
    const scope = new MemoryScope()
    render(<UserSettingsSection scope={scope} zh />)
    expect(screen.getByRole('heading', { name: '通知设置' })).toBeInTheDocument()
    const receive = screen.getByRole('combobox', { name: '接收范围' })
    expect(screen.getByRole('option', { name: '接收全部通知' })).toHaveValue('all')
    expect(screen.getByRole('option', { name: '仅接收重要通知' })).toHaveValue('attention')
    expect(screen.getByRole('option', { name: '暂停接收通知' })).toHaveValue('off')
    await act(async () => { fireEvent.change(receive, { target: { value: 'attention' } }) })
    await waitFor(() => { expect(scope.getSnapshot().value?.notifications).toBe('attention') })
  })

  it('projects reduce to a PAIMind-only root attribute and removes it on cleanup', async () => {
    const scope = new MemoryScope()
    const dispose = projectMotion(scope)
    expect(document.documentElement).not.toHaveAttribute('data-paimind-motion')
    await act(async () => { await scope.set('motion', 'reduce') })
    expect(document.documentElement).toHaveAttribute('data-paimind-motion', 'reduce')
    dispose()
    expect(document.documentElement).not.toHaveAttribute('data-paimind-motion')
  })

  it('shows explicit unavailable state instead of browser persistence', () => {
    const scope = new MemoryScope() as MemoryScope & { snapshot: PaimindSettingsScopeSnapshot<PaimindUserPreferences> }
    scope.snapshot = { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'memory' }
    render(<UserSettingsSection scope={scope} zh={false} />)
    expect(screen.getByText(/No persistence is simulated/)).toBeInTheDocument()
    expect(vi.spyOn(Storage.prototype, 'setItem')).not.toHaveBeenCalled()
  })
})
