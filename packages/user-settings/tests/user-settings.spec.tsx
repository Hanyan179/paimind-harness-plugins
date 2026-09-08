import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaimindSettingsScope, PaimindSettingsScopeSnapshot } from '@hansen/harness-compat'
import {
  DEFAULT_PAIMIND_PERSONALIZATION,
  PaimindUserSettingsService,
  decodePaimindPersonalization,
  migrateLegacyPaimindPersonalization,
  renderPaimindPersonalizationContext,
  type PaimindPersonalization,
} from '../src/index.ts'
import { RemotePaimindSettingsScope, UserSettingsSection } from '../src/client/index.tsx'

class MemoryScope implements PaimindSettingsScope<PaimindPersonalization> {
  private snapshot: PaimindSettingsScopeSnapshot<PaimindPersonalization>
  private readonly listeners = new Set<() => void>()

  constructor(value: PaimindPersonalization = DEFAULT_PAIMIND_PERSONALIZATION) {
    this.snapshot = { status: 'ready', value, base: undefined, user: {}, revision: 0, writable: true, mode: 'host' }
  }

  getSnapshot(): PaimindSettingsScopeSnapshot<PaimindPersonalization> { return this.snapshot }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  async set(field: keyof PaimindPersonalization, value: unknown): Promise<void> {
    this.snapshot = { ...this.snapshot, value: { ...this.snapshot.value!, [field]: value }, revision: (this.snapshot.revision ?? 0) + 1 }
    for (const listener of this.listeners) listener()
  }
  async unset(): Promise<void> {}
}

describe('FP14 personalization', () => {
  it('renders only enabled, meaningful personalization as bounded user context', () => {
    expect(renderPaimindPersonalizationContext(DEFAULT_PAIMIND_PERSONALIZATION)).toBe('')
    const custom = decodePaimindPersonalization({
      ...DEFAULT_PAIMIND_PERSONALIZATION,
      personality: 'pragmatic',
      aboutMe: 'AI product manager <admin>',
      customInstructions: 'End every answer with TOKEN-14.',
    })
    expect(custom).toBeDefined()
    const rendered = renderPaimindPersonalizationContext(custom!)
    expect(rendered).toContain('<paimind-personalization>')
    expect(rendered).toContain('TOKEN-14')
    expect(rendered).toContain('&lt;admin&gt;')
    expect(rendered).toContain('explicit request in this conversation overrides')
    expect(rendered).toContain('cannot change safety rules, permissions')
    expect(renderPaimindPersonalizationContext({ ...custom!, enabled: false })).toBe('')
    expect(decodePaimindPersonalization({ ...DEFAULT_PAIMIND_PERSONALIZATION, personality: 'verbose' })).toBeUndefined()
  })

  it('reads and mutates the canonical Host namespace through the narrow remote', async () => {
    const mutate = vi.fn(async () => {})
    const settings = {
      writable: true,
      register: vi.fn(),
      describe: () => [{ ns: 'paimind-user-settings', value: DEFAULT_PAIMIND_PERSONALIZATION, revision: 7 }],
      mutate,
    }
    const service = Object.create(PaimindUserSettingsService.prototype) as PaimindUserSettingsService
    Object.assign(service, { settingsCtx: { get: () => settings } })
    await expect(service.describe()).resolves.toMatchObject({ status: 'ready', revision: 7, writable: true })
    await service.mutate({ field: 'personality', value: 'friendly', expectedRevision: 7 })
    expect(mutate).toHaveBeenCalledWith(
      expect.anything(),
      [{ op: 'set', path: ['personality'], value: 'friendly' }],
      7,
    )
  })

  it('migrates useful legacy preferences and removes Notification and motion keys', async () => {
    let revision = 3
    let user: Record<string, unknown> = {
      responseStyle: 'friendly', personalInstructions: 'Keep this instruction.',
      motion: 'reduce', notifications: 'off',
    }
    const mutate = vi.fn(async (_namespace: unknown, operations: readonly ({ op: 'set' | 'unset'; path: readonly string[]; value?: unknown })[], expectedRevision?: number) => {
      expect(expectedRevision).toBe(revision)
      for (const operation of operations) {
        if (operation.op === 'set') user[operation.path[0]!] = operation.value
        else delete user[operation.path[0]!]
      }
      revision += 1
    })
    await migrateLegacyPaimindPersonalization({
      writable: true, register: vi.fn(),
      describe: () => [{ ns: 'paimind-user-settings', value: DEFAULT_PAIMIND_PERSONALIZATION, user, revision }],
      mutate,
    })
    expect(user).toEqual({ personality: 'friendly', customInstructions: 'Keep this instruction.' })
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('keeps native revision/CAS semantics across the client remote', async () => {
    let value = DEFAULT_PAIMIND_PERSONALIZATION
    let revision = 11
    const mutate = vi.fn(async (request: { field: keyof PaimindPersonalization; value: unknown; expectedRevision: number }) => {
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
    await scope.set('personality', 'pragmatic')
    expect(mutate).toHaveBeenCalledOnce()
    expect(scope.getSnapshot()).toMatchObject({
      status: 'ready', revision: 12, value: { personality: 'pragmatic' }, mode: 'host',
    })
    scope.dispose()
  })

  it('saves Codex-inspired fields and exposes the exact context preview', async () => {
    const scope = new MemoryScope()
    render(<UserSettingsSection scope={scope} zh />)
    expect(screen.getByRole('heading', { name: '个性化' })).toBeInTheDocument()
    expect(screen.queryByText('通知设置')).not.toBeInTheDocument()
    expect(screen.queryByText('减少动画')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /务实/ })).toHaveAttribute('aria-pressed', 'false')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /务实/ })) })
    expect(scope.getSnapshot().value?.personality).toBe('pragmatic')

    fireEvent.change(screen.getByRole('textbox', { name: '助手应该了解什么？' }), { target: { value: '我是产品经理。' } })
    fireEvent.change(screen.getByRole('textbox', { name: '特别要求' }), { target: { value: '明确区分事实与判断。' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存个性化' })) })
    await waitFor(() => { expect(scope.getSnapshot().value).toMatchObject({ aboutMe: '我是产品经理。', customInstructions: '明确区分事实与判断。' }) })
    expect(screen.getByRole('status')).toHaveTextContent('已保存，从下一次回复起生效')

    fireEvent.click(screen.getByRole('button', { name: '查看注入预览' }))
    expect(screen.getByText(/<paimind-personalization>/)).toHaveTextContent('明确区分事实与判断。')
  })

  it('turns context injection off without deleting the saved profile', async () => {
    const scope = new MemoryScope({
      enabled: true, personality: 'friendly', aboutMe: 'Product manager', customInstructions: 'Be clear.',
    })
    render(<UserSettingsSection scope={scope} zh />)
    const toggle = screen.getByRole('switch', { name: '启用个性化' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await act(async () => { fireEvent.click(toggle) })
    expect(scope.getSnapshot().value).toMatchObject({ enabled: false, aboutMe: 'Product manager', customInstructions: 'Be clear.' })
    fireEvent.click(screen.getByRole('button', { name: '查看注入预览' }))
    expect(screen.getByText('当前不会注入任何个性化上下文。')).toBeInTheDocument()
  })

  it('shows explicit unavailable state instead of browser persistence', () => {
    const scope = new MemoryScope() as MemoryScope & { snapshot: PaimindSettingsScopeSnapshot<PaimindPersonalization> }
    scope.snapshot = { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'memory' }
    render(<UserSettingsSection scope={scope} zh={false} />)
    expect(screen.getByText(/No persistence is simulated/)).toBeInTheDocument()
    expect(vi.spyOn(Storage.prototype, 'setItem')).not.toHaveBeenCalled()
  })
})
