import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { releasePersonalizationEditor } from '../src/client/editor.ts'
import type { PaimindSettingsScope, PaimindSettingsScopeSnapshot } from '@paimind/harness-compat'
import {
  DEFAULT_PAIMIND_PERSONALIZATION,
  PaimindUserSettingsService,
  decodePaimindPersonalization,
  migrateLegacyPaimindPersonalization,
  renderPaimindPersonalizationContext,
  type PaimindPersonalization,
} from '../src/index.ts'
import { RemotePaimindSettingsScope, UserSettingsSection } from '../src/client/index.tsx'

const testScopes: MemoryScope[] = []
afterEach(() => { for (const scope of testScopes.splice(0)) releasePersonalizationEditor(scope) })

class MemoryScope implements PaimindSettingsScope<PaimindPersonalization> {
  private snapshot: PaimindSettingsScopeSnapshot<PaimindPersonalization>
  private readonly listeners = new Set<() => void>()

  constructor(value: PaimindPersonalization = DEFAULT_PAIMIND_PERSONALIZATION) {
    testScopes.push(this)
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

describe('FP14 PAIMind personalization', () => {
  it('keeps the source-owned appearance group available when collaboration settings are unavailable', () => {
    const scope = new MemoryScope()
    vi.spyOn(scope, 'getSnapshot').mockReturnValue({ value: undefined, base: undefined, user: undefined, revision: undefined, status: 'unavailable', writable: false, mode: 'host' })
    render(<UserSettingsSection scope={scope} zh appearance={<button>界面偏好来源</button>} />)
    expect(screen.getByRole('button', { name: '界面偏好来源' })).toBeEnabled()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

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

  it('reads and mutates the canonical Host namespace through the narrow PAIMind remote', async () => {
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

  it('keeps native revision/CAS semantics across the PAIMind client remote', async () => {
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

  it('saves work preferences and shows committed business fields without internal context markup', async () => {
    const scope = new MemoryScope()
    render(<UserSettingsSection scope={scope} zh />)
    expect(screen.getByRole('heading', { name: '个性化' })).toBeInTheDocument()
    expect(screen.queryByText('通知设置')).not.toBeInTheDocument()
    expect(screen.queryByText('减少动画')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /务实/ })).not.toBeChecked()

    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /务实/ })) })
    expect(scope.getSnapshot().value?.personality).toBe('pragmatic')

    fireEvent.change(screen.getByRole('textbox', { name: '岗位与职责' }), { target: { value: '我是产品经理。' } })
    fireEvent.change(screen.getByRole('textbox', { name: '内容与格式要求' }), { target: { value: '明确区分事实与判断。' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存修改' })) })
    await waitFor(() => { expect(scope.getSnapshot().value).toMatchObject({ aboutMe: '我是产品经理。', customInstructions: '明确区分事实与判断。' }) })
    expect(screen.getByRole('status')).toHaveTextContent('已保存，从下一次回复起生效')

    fireEvent.click(screen.getByRole('button', { name: '查看已保存内容' }))
    expect(screen.getByRole('heading', { name: '已保存的助手偏好' }).parentElement).toHaveTextContent('明确区分事实与判断。')
    expect(screen.queryByText(/<paimind-personalization>/)).not.toBeInTheDocument()
  })

  it('turns context injection off without deleting the saved profile', async () => {
    const scope = new MemoryScope({
      enabled: true, personality: 'friendly', aboutMe: 'Product manager', customInstructions: 'Be clear.',
    })
    render(<UserSettingsSection scope={scope} zh />)
    const toggle = screen.getByRole('switch', { name: '使用助手偏好' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await act(async () => { fireEvent.click(toggle) })
    expect(scope.getSnapshot().value).toMatchObject({ enabled: false, aboutMe: 'Product manager', customInstructions: 'Be clear.' })
    fireEvent.click(screen.getByRole('button', { name: '查看已保存内容' }))
    expect(screen.getByText('助手偏好已关闭，以下内容暂不用于回复。')).toBeInTheDocument()
  })

  it('shows explicit unavailable state instead of browser persistence', () => {
    const scope = new MemoryScope() as MemoryScope & { snapshot: PaimindSettingsScopeSnapshot<PaimindPersonalization> }
    scope.snapshot = { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'memory' }
    render(<UserSettingsSection scope={scope} zh={false} />)
    expect(screen.getByText(/Check the connection and retry/)).toBeInTheDocument()
    expect(vi.spyOn(Storage.prototype, 'setItem')).not.toHaveBeenCalled()
  })
})


describe('personalization editing and recovery', () => {
  it('retains unsaved text across settings navigation, keeps it out of saved preview, and can discard it', () => {
    const scope = new MemoryScope({ ...DEFAULT_PAIMIND_PERSONALIZATION, aboutMe: 'Saved role' })
    const view = render(<UserSettingsSection scope={scope} zh />)
    fireEvent.change(screen.getByRole('textbox', { name: '岗位与职责' }), { target: { value: 'Unsaved role' } })
    fireEvent.click(screen.getByRole('button', { name: '查看已保存内容' }))
    expect(screen.getByText('Saved role')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '已保存的助手偏好' }).parentElement).not.toHaveTextContent('Unsaved role')
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    view.unmount()
    render(<UserSettingsSection scope={scope} zh />)
    expect(screen.getByRole('textbox', { name: '岗位与职责' })).toHaveValue('Unsaved role')
    fireEvent.click(screen.getByRole('button', { name: '撤销未保存内容' }))
    expect(screen.getByRole('textbox', { name: '岗位与职责' })).toHaveValue('Saved role')
    const cleanUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanUnload)
    expect(cleanUnload.defaultPrevented).toBe(false)
  })

  it('preserves both text fields and releases the saving state after a rejected write', async () => {
    const scope = new MemoryScope()
    const save = vi.spyOn(scope, 'set').mockRejectedValue(new Error('offline'))
    render(<UserSettingsSection scope={scope} zh />)
    fireEvent.change(screen.getByRole('textbox', { name: '岗位与职责' }), { target: { value: 'Keep my draft' } })
    fireEvent.change(screen.getByRole('textbox', { name: '内容与格式要求' }), { target: { value: 'Keep this too' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('你的输入已保留'))
    expect(save).toHaveBeenCalledOnce()
    expect(screen.getByRole('textbox', { name: '岗位与职责' })).toHaveValue('Keep my draft')
    expect(screen.getByRole('textbox', { name: '内容与格式要求' })).toHaveValue('Keep this too')
    expect(screen.getByRole('button', { name: '保存修改' })).toBeEnabled()
    expect(scope.getSnapshot().value).toEqual(DEFAULT_PAIMIND_PERSONALIZATION)
  })

  it('locks concurrent writes while saving and reports disabled preferences accurately', async () => {
    const scope = new MemoryScope({ ...DEFAULT_PAIMIND_PERSONALIZATION, enabled: false })
    const originalSet = scope.set.bind(scope)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const set = vi.spyOn(scope, 'set').mockImplementation(async (field, value) => { await gate; await originalSet(field, value) })
    render(<UserSettingsSection scope={scope} zh />)
    fireEvent.change(screen.getByRole('textbox', { name: '内容与格式要求' }), { target: { value: 'Prepared while off' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('radio', { name: /务实/ })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('textbox', { name: '内容与格式要求' })).toHaveAttribute('readonly')
    await act(async () => { release(); await gate })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('助手偏好当前关闭'))
    expect(set).toHaveBeenCalledOnce()
  })

  it('does not overwrite dirty text after an external update or share it with another plugin scope', async () => {
    const scope = new MemoryScope({ ...DEFAULT_PAIMIND_PERSONALIZATION, aboutMe: 'Original' })
    const view = render(<UserSettingsSection scope={scope} zh />)
    fireEvent.change(screen.getByRole('textbox', { name: '岗位与职责' }), { target: { value: 'My draft' } })
    await act(async () => { await scope.set('aboutMe', 'Saved elsewhere') })
    expect(screen.getByRole('textbox', { name: '岗位与职责' })).toHaveValue('My draft')
    expect(screen.getByRole('alert')).toHaveTextContent('其他位置更新')
    view.unmount()
    render(<UserSettingsSection scope={new MemoryScope()} zh />)
    expect(screen.getByRole('textbox', { name: '岗位与职责' })).toHaveValue('')
  })

  it('submits two text fields as one bounded native CAS operation and rejects invalid direct calls', async () => {
    const mutate = vi.fn(async () => {})
    const settings = { writable: true, register: vi.fn(), describe: () => [{ ns: 'paimind-user-settings', value: DEFAULT_PAIMIND_PERSONALIZATION, revision: 7 }], mutate }
    const service = Object.create(PaimindUserSettingsService.prototype) as PaimindUserSettingsService
    Object.assign(service, { settingsCtx: { get: () => settings } })
    await service.saveText({ aboutMe: 'Role', customInstructions: 'Be clear', expectedRevision: 7 })
    expect(mutate).toHaveBeenCalledExactlyOnceWith(expect.anything(), [
      { op: 'set', path: ['aboutMe'], value: 'Role' },
      { op: 'set', path: ['customInstructions'], value: 'Be clear' },
    ], 7)
    await expect(service.saveText({ aboutMe: 'x'.repeat(2001), customInstructions: '', expectedRevision: 7 })).rejects.toThrow('Invalid')
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('uses atomic live remote saves and recovers to read-only unavailable state after connection failure', async () => {
    let value = DEFAULT_PAIMIND_PERSONALIZATION
    let available = true
    const describe = vi.fn(async () => {
      if (!available) throw new Error('offline')
      return { ok: true as const, value: { status: 'ready' as const, value, revision: 8, writable: true } }
    })
    const saveText = vi.fn(async (request: { aboutMe: string; customInstructions: string; expectedRevision: number }) => {
      expect(request.expectedRevision).toBe(8)
      value = { ...value, aboutMe: request.aboutMe, customInstructions: request.customInstructions }
      return await describe()
    })
    const scope = new RemotePaimindSettingsScope({ describe, mutate: vi.fn(), saveText })
    await waitFor(() => expect(scope.getSnapshot().status).toBe('ready'))
    await scope.saveText({ aboutMe: 'Together', customInstructions: 'One revision' })
    expect(saveText).toHaveBeenCalledOnce()
    expect(scope.getSnapshot().value).toMatchObject({ aboutMe: 'Together', customInstructions: 'One revision' })
    available = false
    await scope.load()
    expect(scope.getSnapshot()).toMatchObject({ status: 'unavailable', writable: false })
    available = true
    await scope.load()
    expect(scope.getSnapshot().status).toBe('ready')
    scope.dispose()
  })
})
