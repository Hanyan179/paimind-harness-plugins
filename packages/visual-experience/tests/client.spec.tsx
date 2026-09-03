import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import { createClientContextFixture } from '@paimind/testkit'
import type {
  HarnessAgentPresetApi,
  HarnessInputTriggerSource,
  PaimindSettingsScope,
  PaimindSettingsScopeSnapshot,
} from '@paimind/harness-compat'
import {
  apply,
  PaimindComposerOverlayPresenter,
  type PaimindExperienceModeController,
} from '../src/client/index.js'
import {
  PAIMIND_AGENT_AVATAR_ICON_PREFIX,
  resolvePaimindAgentAvatar,
} from '../src/client/agent-avatars.js'
import type { PaimindVisualExperienceSettings } from '../src/settings.js'

class FakeModeScope implements PaimindSettingsScope<PaimindVisualExperienceSettings> {
  private snapshot: PaimindSettingsScopeSnapshot<PaimindVisualExperienceSettings>
  private readonly listeners = new Set<() => void>()

  constructor(mode: 'paimind' | 'native' = 'paimind') {
    this.snapshot = Object.freeze({
      status: 'ready', value: Object.freeze({ mode }), base: {}, user: {}, revision: 1,
      writable: true, mode: 'host',
    })
  }

  getSnapshot(): PaimindSettingsScopeSnapshot<PaimindVisualExperienceSettings> { return this.snapshot }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  async set(_field: 'mode', value: unknown): Promise<void> { this.push(value === 'native' ? 'native' : 'paimind') }
  async unset(): Promise<void> { this.push('paimind') }
  push(mode: 'paimind' | 'native'): void {
    this.snapshot = Object.freeze({ ...this.snapshot, value: Object.freeze({ mode }), revision: (this.snapshot.revision ?? 0) + 1 })
    for (const listener of [...this.listeners]) listener()
  }
}

function successfulApi(): HarnessAgentPresetApi {
  return {
    list: vi.fn(async () => ({ result: { ok: true as const, value: {
      authorable: true,
      hasDocument: true,
      presets: [
        { id: 'standard', trust: 'system' as const, isDefault: true, name: '标准模式', description: '完整的编码 Agent。' },
        { id: 'cordis', trust: 'system' as const, isDefault: false, name: 'Creator', description: 'Advanced preset editor.' },
        { id: 'paimind', trust: 'system' as const, isDefault: false, name: 'Paramont 助手', description: '面向业务材料与协作。' },
        { id: 'personal', trust: 'user' as const, isDefault: false, name: '我的 Agent', description: '个人智能体。' },
      ],
    } } })),
    select: vi.fn(), read: vi.fn(), copy: vi.fn(), openDocument: vi.fn(), remove: vi.fn(),
  } as unknown as HarnessAgentPresetApi
}

function setup(api: HarnessAgentPresetApi = successfulApi(), mode: 'paimind' | 'native' = 'paimind') {
  document.body.innerHTML = `
    <main data-phase="hero"><div data-paimind-hero-brand-seat><span data-paimind-paramont-hero-headline>共攀高山之巅</span><span data-paimind-native-hero-preview>预览版</span></div><div data-composer-card><div id="composer-overlay-anchor"><div data-slot="conversation.input.overlay"></div></div></div></main>
    <button data-paimind-product-trigger="agent-center">Agent Center</button>
  `
  const fixture = createClientContextFixture()
  let current = 'paimind'
  const nativeSelect = vi.fn(async (id: string) => { current = id })
  fixture.context.slots.inject('conversation.hero.agentPreset', () => fixture.context.slots.register({
    name: 'conversation.hero.agentPreset',
    inject: () => ({
      hooks: { agentPresetSeat: { getSnapshot: () => ({ current, busy: false, error: null }), subscribe: () => () => {} } },
      load: async () => {},
      select: nativeSelect,
    }),
  }, () => null))
  const scope = new FakeModeScope(mode)
  const removeTheme = vi.fn()
  const theme = { overrideTokens: vi.fn(() => removeTheme) }
  const referenceCandidates = vi.fn(async () => [{ name: 'brief.md', section: 'Files & folders', value: '/brief.md' }])
  const reference: HarnessInputTriggerSource = {
    trigger: '@', name: 'reference', showGroupTitle: false,
    candidates: referenceCandidates,
    onPick: ({ candidate }) => ({ insert: {
      source: 'reference', ref: candidate.value ?? candidate.name, label: candidate.name,
      appearance: 'file', clipboardText: `@${candidate.name}`,
    } }),
    codec: {},
  }
  const nativeSkillCandidates = vi.fn(async () => [
    { name: 'presentation', description: '生成演示文稿。' },
  ])
  const nativeSkillPick = vi.fn(({ candidate }: Parameters<HarnessInputTriggerSource['onPick']>[0]) => ({
    text: `/${candidate.name} `,
  }))
  const nativeSkill: HarnessInputTriggerSource = {
    trigger: '/', name: 'skill', order: 2,
    candidates: nativeSkillCandidates,
    onPick: nativeSkillPick,
  }
  const triggerSources: HarnessInputTriggerSource[] = [nativeSkill, reference]
  const triggerController = {
    launcher: { getSnapshot: () => null },
    menu: { getSnapshot: () => ({ open: false }) },
    dismiss: vi.fn(),
    toggleSource: vi.fn(),
  }
  const inputTriggers = {
    live: { sources: triggerSources, controllers: new Map([['session-1', triggerController]]) },
    registerSource(source: HarnessInputTriggerSource) {
      triggerSources.push(source)
      return () => { const index = triggerSources.indexOf(source); if (index >= 0) triggerSources.splice(index, 1) }
    },
    sessionOf: () => triggerController,
  }
  const sessions = {
    scope: () => ({}),
    binding: () => ({ session: { getSnapshot: () => ({ blank: true }) } }),
  }
  const skillsList = vi.fn(async () => ({ result: { ok: true as const, value: { skills: [
    { name: 'presentation', description: '生成演示文稿。', modelInvocable: true },
  ] } } }))
  const context = Object.assign({}, fixture.context, {
    slots: fixture.context.slots,
    settingsScope: { bind: () => scope },
    theme,
    get: (name: string) => name === 'connection'
      ? { api: { agentPresets: api, skills: { list: skillsList } } }
      : name === 'inputTriggers' ? inputTriggers : name === 'sessions' ? sessions : undefined,
  })
  apply(context as never)
  return {
    fixture, scope, theme, removeTheme, nativeSelect, inputTriggers,
    reference, referenceCandidates, nativeSkill, nativeSkillCandidates, nativeSkillPick,
    skillsList, triggerController, triggerSources,
  }
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  document.documentElement.removeAttribute('lang')
})

describe('PAIMind visual experience client', () => {
  it('coalesces resize delivery without reconnecting the same composer or rewriting its room', () => {
    document.body.innerHTML = '<div data-composer-card><div id="anchor"><div data-slot="conversation.input.overlay"></div></div></div>'
    let resizeCallback: ResizeObserverCallback | undefined
    let resizeObserver: ResizeObserver | undefined
    const observe = vi.fn()
    const disconnect = vi.fn()
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
        resizeObserver = this as unknown as ResizeObserver
      }

      observe = observe
      disconnect = disconnect
      unobserve = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const frames: FrameRequestCallback[] = []
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const anchor = document.querySelector<HTMLElement>('#anchor')!
    const setProperty = vi.spyOn(anchor.style, 'setProperty')
    const presenter = new PaimindComposerOverlayPresenter(document, window)

    try {
      presenter.setMode('paimind')
      expect(observe).toHaveBeenCalledOnce()
      const disconnectCount = disconnect.mock.calls.length
      const roomWriteCount = setProperty.mock.calls.filter(([name]) => name === '--paimind-composer-overlay-room').length

      resizeCallback?.([], resizeObserver!)
      resizeCallback?.([], resizeObserver!)
      expect(requestAnimationFrame).toHaveBeenCalledOnce()
      expect(frames).toHaveLength(1)
      frames.shift()?.(performance.now())

      expect(observe).toHaveBeenCalledOnce()
      expect(disconnect).toHaveBeenCalledTimes(disconnectCount)
      expect(setProperty.mock.calls.filter(([name]) => name === '--paimind-composer-overlay-room')).toHaveLength(roomWriteCount)
    } finally {
      presenter.dispose()
      expect(cancelAnimationFrame).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })

  it.each([
    ['@', 'dsh-slash-option-paimind-agent'],
    ['/', 'dsh-slash-option-command'],
  ])('keeps the %s menu disclosure synchronized with native keyboard selection', async (_trigger, idPrefix) => {
    document.documentElement.lang = 'zh-CN'
    document.body.innerHTML = `
      <div data-composer-card>
        <div id="anchor"><div data-slot="conversation.input.overlay">
          <div role="listbox" aria-activedescendant="${idPrefix}-0"><div>
            <div role="presentation">候选项</div>
            <button id="${idPrefix}-0" role="option" aria-selected="true">
              <span class="fixture_itemName">第一项</span><span class="fixture_itemDescription">第一项说明</span>
            </button>
            <button id="${idPrefix}-1" role="option" aria-selected="false">
              <span class="fixture_itemName">第二项</span><span class="fixture_itemDescription">第二项说明</span>
            </button>
          </div></div>
        </div></div>
      </div>`
    const presenter = new PaimindComposerOverlayPresenter(document, window)

    try {
      presenter.setMode('paimind')
      const list = document.querySelector<HTMLElement>('[role="listbox"]')!
      const first = document.querySelector<HTMLElement>(`#${idPrefix}-0`)!
      const second = document.querySelector<HTMLElement>(`#${idPrefix}-1`)!
      const disclosure = () => document.querySelector<HTMLElement>('[data-paimind-composer-disclosure]')

      expect(disclosure()).toHaveTextContent('第一项')
      fireEvent.keyDown(document, { key: 'ArrowDown' })
      list.setAttribute('aria-activedescendant', second.id)
      first.setAttribute('aria-selected', 'false')
      second.setAttribute('aria-selected', 'true')

      await waitFor(() => expect(disclosure()).toHaveTextContent('第二项'))
      expect(disclosure()).toHaveTextContent('第二项说明')
    } finally {
      presenter.dispose()
    }
  })

  it('presents popup model choices in the same wide two-column disclosure shell', async () => {
    document.documentElement.lang = 'zh-CN'
    document.body.innerHTML = `
      <div data-composer-card><div id="anchor"><div data-slot="conversation.input.overlay">
        <div aria-label="/model 选项">
          <input type="text" aria-label="筛选选项" />
          <div role="listbox" aria-label="/model 匹配项" aria-activedescendant="model-0">
            <div id="model-0" role="option" aria-selected="true"><span>DeepSeek-V4-Flash</span><span>DeepSeek</span></div>
            <div id="model-1" role="option" aria-selected="false"><span>DeepSeek-V4-Pro</span><span>DeepSeek</span></div>
          </div>
        </div>
      </div></div></div>`
    const presenter = new PaimindComposerOverlayPresenter(document, window)

    try {
      presenter.setMode('paimind')
      const shell = document.querySelector<HTMLElement>('[aria-label="/model 选项"]')!
      await waitFor(() => expect(shell).toHaveAttribute('data-paimind-popup-select'))
      expect(shell.querySelector(':scope > [data-paimind-composer-disclosure]')).toHaveTextContent('对话模型')
      expect(shell.querySelector(':scope > [data-paimind-composer-disclosure]')).toHaveTextContent('由 DeepSeek 提供，选择后用于当前会话。')
      expect(shell.querySelector('[role="listbox"] > [data-paimind-composer-disclosure]')).toBeNull()
    } finally {
      presenter.dispose()
    }
    expect(document.querySelector('[data-paimind-popup-select]')).toBeNull()
  })

  it('uses the disclosure space for truthful Agent Skills and command guidance', async () => {
    document.documentElement.lang = 'zh-CN'
    document.body.innerHTML = `
      <button data-paimind-agent-picker-trigger><span>Paramont 助手</span></button>
      <div data-composer-card><div id="anchor"><div data-slot="conversation.input.overlay">
        <div role="listbox" aria-activedescendant="dsh-slash-option-paimind-agent-0"><div>
          <div role="presentation">推荐 Agent</div>
          <button id="dsh-slash-option-paimind-agent-0" role="option" aria-selected="true"><span class="fixture_itemName">Paramont 助手</span><span class="fixture_itemDescription">产品与协作智能体。</span></button>
          <div role="presentation">Skill（技能）</div>
          <button id="dsh-slash-option-paimind-skill-0" role="option" aria-selected="false"><span class="fixture_itemName">openai-docs</span><span class="fixture_itemDescription">查询官方文档。</span></button>
        </div></div>
      </div></div></div>`
    const presenter = new PaimindComposerOverlayPresenter(document, window)

    try {
      presenter.setMode('paimind')
      const list = document.querySelector<HTMLElement>('[role="listbox"]')!
      const disclosure = () => document.querySelector<HTMLElement>('[data-paimind-composer-disclosure]')
      expect(disclosure()).toHaveTextContent('已挂载 Skill')
      expect(disclosure()).toHaveTextContent('openai-docs')

      list.setAttribute('aria-activedescendant', 'dsh-slash-option-paimind-skill-0')
      fireEvent.keyDown(document, { key: 'ArrowDown' })
      await waitFor(() => expect(disclosure()).toHaveTextContent('/openai-docs'))
      expect(disclosure()).toHaveTextContent('当前 Agent')

      list.innerHTML = '<div><div role="presentation">命令</div><button id="dsh-slash-option-command-0" role="option" aria-selected="true"><span class="fixture_itemName">goal</span><span class="fixture_itemDescription">set or view the goal</span></button></div>'
      list.setAttribute('aria-activedescendant', 'dsh-slash-option-command-0')
      await waitFor(() => expect(disclosure()).toHaveTextContent('管理长期目标'))
      expect(disclosure()).toHaveTextContent('/goal pause')
    } finally {
      presenter.dispose()
    }
  })

  it('labels a compact native Settings trigger and reverses the label on unload', async () => {
    document.documentElement.lang = 'zh-CN'
    const { fixture } = setup()
    const trigger = document.createElement('button')
    trigger.innerHTML = '<span data-slot="settings.trigger"></span>'
    document.body.append(trigger)

    await waitFor(() => expect(trigger).toHaveAttribute('aria-label', '设置'))
    expect(trigger).toHaveAttribute('data-paimind-settings-trigger-label', '设置')

    fixture.disposeEffects()
    expect(trigger).not.toHaveAttribute('aria-label')
    expect(trigger).not.toHaveAttribute('data-paimind-settings-trigger-label')
  })

  it('enables the reversible experience, renders the welcome entry and restores native mode', async () => {
    const { fixture, scope, theme, removeTheme, nativeSelect } = setup()
    await waitFor(() => expect(fixture.slots.filter(entry => entry.injectedName === 'conversation.hero.agentPreset' && !entry.disposed())).toHaveLength(2))
    expect(document.body).toHaveAttribute('data-paimind-experience', 'paimind')
    expect(document.body).toHaveAttribute('data-paimind-density', 'calm')
    expect(document.body).not.toHaveAttribute('data-paimind-composer-overlay')
    expect(document.querySelector('#composer-overlay-anchor')).toHaveAttribute('data-paimind-composer-overlay-anchor')
    expect((document.querySelector('#composer-overlay-anchor') as HTMLElement).style.getPropertyValue('--paimind-composer-overlay-room')).toMatch(/px$/)
    expect(theme.overrideTokens).toHaveBeenCalledWith('@paimind/visual-experience', expect.objectContaining({
      '--dsw-alias-bg-base': expect.any(Object),
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#141d2d' },
      '--dsw-alias-bg-layer-2': { light: '#eff3f9', dark: '#1d283b' },
      '--dsw-alias-bg-overlay': { light: '#fcfcfb', dark: '#111927' },
    }))
    expect(document.querySelector('style[data-paimind-plugin="@paimind/visual-experience"]')).not.toBeNull()

    const shell = fixture.slots.find(entry => entry.injectedName === 'shell.overlay' && entry.options.id === 'paimind-visual-experience-hero')!
    const Shell = shell.component as ComponentType<{ mode: PaimindExperienceModeController; locale: unknown }>
    const shellView = render(<Shell {...shell.inject?.() as never} />)
    expect(await screen.findByRole('heading', { name: '今天想完成什么？' })).toBeInTheDocument()
    expect(screen.queryByText(/用 @ 选择 Agent/)).toBeNull()

    const dock = fixture.slots.find(entry => entry.injectedName === 'conversation.input.dock')!
    const Dock = dock.component as ComponentType
    const dockView = render(<Dock {...dock.inject?.() as never} />)
    expect(await screen.findByRole('button', { name: /Paramont 助手/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全部智能体' })).toBeInTheDocument()
    const style = document.querySelector<HTMLStyleElement>('style[data-paimind-plugin="@paimind/visual-experience"]')?.textContent ?? ''
    expect(style).toContain('[data-paimind-quick-agents]{display:grid;gap:8px;width:calc(100% - 32px);margin-inline:16px')
    expect(style).toContain("[role='dialog'][aria-modal='true']:has(>nav button[data-paimind-settings-navigation-icon]){width:min(1480px,calc(100vw - 48px))!important")
    expect(style).toContain("@media(max-width:600px){body[data-paimind-experience='paimind'] [role='dialog'][aria-modal='true']:has(>nav button[data-paimind-settings-navigation-icon]){width:calc(100vw - 16px)!important")
    fireEvent.click(screen.getByRole('button', { name: /Paramont 助手/ }))
    await waitFor(() => expect(nativeSelect).toHaveBeenCalledWith('paimind'))

    const visualSeat = fixture.slots.find(entry => entry.injectedName === 'conversation.hero.agentPreset' && entry.options.id === 'paimind-visual-agent-choice')!
    const Seat = visualSeat.component as ComponentType
    const seatView = render(<Seat {...visualSeat.inject?.() as never} />)
    const trigger = document.querySelector<HTMLButtonElement>('[data-paimind-agent-picker-trigger]')
    if (trigger === null) throw new Error('visual Agent picker trigger is missing')
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: '选择 Agent' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getAllByText('推荐 Agent').length).toBeGreaterThan(0)
    expect(screen.queryByText('平台模式')).toBeNull()
    expect(dialog).toHaveTextContent('方向键浏览 · Enter 选择 · Esc 返回')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const overlay = document.querySelector<HTMLElement>("[data-slot='conversation.input.overlay']")
    if (overlay === null) throw new Error('composer overlay fixture is missing')
    overlay.innerHTML = '<div role="listbox" aria-activedescendant="candidate-1"><div><div role="presentation">Skill（技能）</div><button id="candidate-1" role="option" aria-selected="true"><span class="fixture_itemName">完整技能名称</span><span class="fixture_itemDescription">用于验证渐进式披露的完整说明。</span></button></div></div>'
    await waitFor(() => expect(document.body).toHaveAttribute('data-paimind-composer-overlay', 'open'))
    await waitFor(() => expect(overlay.querySelector('[data-paimind-composer-disclosure]')).toHaveTextContent('完整技能名称'))
    expect(overlay.querySelector('[data-paimind-composer-disclosure]')).toHaveTextContent('用于验证渐进式披露的完整说明。')
    expect(overlay.querySelector('[data-paimind-candidate-description]')).toHaveTextContent('用于验证渐进式披露的完整说明。')

    await act(async () => { scope.push('native') })
    await waitFor(() => expect(document.body).toHaveAttribute('data-paimind-experience', 'native'))
    expect(removeTheme).toHaveBeenCalledOnce()
    expect(fixture.slots.find(entry => entry.options.id === 'paimind-visual-agent-choice')?.disposed()).toBe(true)
    expect(screen.queryByRole('heading', { name: '今天想完成什么？' })).toBeNull()
    expect(document.body).not.toHaveAttribute('data-paimind-composer-overlay')
    expect(document.querySelector('#composer-overlay-anchor')).not.toHaveAttribute('data-paimind-composer-overlay-anchor')

    seatView.unmount(); dockView.unmount(); shellView.unmount()
    fixture.disposeEffects()
    expect(document.body).not.toHaveAttribute('data-paimind-experience')
    expect(document.body).not.toHaveAttribute('data-paimind-composer-overlay')
    expect(document.querySelector('style[data-paimind-plugin="@paimind/visual-experience"]')).toBeNull()
    for (const id of [
      'paimind-visual-experience-hero',
      'paimind-visual-experience',
      'paimind-quick-agents',
      'paimind-visual-agent-choice',
      'paimind-add-context',
    ]) expect(fixture.slots.find(entry => entry.options.id === id)?.disposed()).toBe(true)
  })

  it('keeps only the Settings entry in native mode and can be disposed then reinstalled', async () => {
    const first = setup(successfulApi(), 'native')
    await waitFor(() => expect(first.theme.overrideTokens).not.toHaveBeenCalled())
    expect(document.body).toHaveAttribute('data-paimind-experience', 'native')
    expect(first.fixture.slots.find(entry => entry.options.id === 'paimind-visual-experience')?.disposed()).toBe(false)
    expect(first.fixture.slots.some(entry => entry.options.id === 'paimind-quick-agents')).toBe(false)
    expect(first.fixture.slots.some(entry => entry.options.id === 'paimind-visual-agent-choice')).toBe(false)

    first.scope.push('paimind')
    await waitFor(() => expect(first.theme.overrideTokens).toHaveBeenCalledOnce())
    await waitFor(() => expect(first.fixture.slots.find(entry => entry.options.id === 'paimind-visual-agent-choice')?.disposed()).toBe(false))
    first.fixture.disposeEffects()
    expect(first.removeTheme).toHaveBeenCalledOnce()
    expect(document.body).not.toHaveAttribute('data-paimind-experience')
    expect(document.querySelector('style[data-paimind-plugin="@paimind/visual-experience"]')).toBeNull()

    const second = setup(successfulApi(), 'paimind')
    await waitFor(() => expect(second.theme.overrideTokens).toHaveBeenCalledOnce())
    expect(document.body).toHaveAttribute('data-paimind-experience', 'paimind')
    expect(document.querySelector('style[data-paimind-plugin="@paimind/visual-experience"]')).not.toBeNull()
    second.fixture.disposeEffects()
  })

  it('scrolls the Agent picker with a mouse wheel from either desktop column', async () => {
    const { fixture } = setup()
    await waitFor(() => expect(fixture.slots.some(entry => entry.options.id === 'paimind-visual-agent-choice')).toBe(true))
    const visualSeat = fixture.slots.find(entry => entry.options.id === 'paimind-visual-agent-choice')!
    const Seat = visualSeat.component as ComponentType
    const view = render(<Seat {...visualSeat.inject?.() as never} />)
    const trigger = await screen.findByRole('button', { name: /Paramont 助手/ })
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: '选择 Agent' })
    const list = dialog.querySelector<HTMLElement>('[data-paimind-agent-picker-list]')
    const detail = dialog.querySelector<HTMLElement>('[data-paimind-agent-picker-detail]')
    if (list === null || detail === null) throw new Error('Agent picker columns are missing')
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 720 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 320 })

    const detailWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 96 })
    detail.dispatchEvent(detailWheel)
    expect(detailWheel.defaultPrevented).toBe(true)
    expect(list.scrollTop).toBe(96)

    const listWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 48 })
    list.dispatchEvent(listWheel)
    expect(listWheel.defaultPrevented).toBe(false)
    expect(list.scrollTop).toBe(96)

    const style = document.querySelector<HTMLStyleElement>('style[data-paimind-plugin="@paimind/visual-experience"]')?.textContent ?? ''
    expect(style).toContain('grid-template-rows:minmax(0,1fr) auto;height:min(360px,calc(100vh - 24px))')
    expect(style).toContain('min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable')

    view.unmount()
    fixture.disposeEffects()
  })

  it('presents native Context candidates with the shared picker density and restores their exact labels', async () => {
    document.documentElement.lang = 'zh-CN'
    const { fixture, scope } = setup()
    const overlay = document.querySelector<HTMLElement>("[data-slot='conversation.input.overlay']")
    if (overlay === null) throw new Error('composer overlay fixture is missing')
    overlay.innerHTML = `<div role="listbox" aria-activedescendant="dsh-slash-option-paimind-context-0"><div><div role="presentation">Files & folders</div><button id="dsh-slash-option-paimind-context-0" role="option" aria-selected="true"><span class="fixture_itemName">Folder · artifacts/</span><span class="fixture_itemDescription">artifacts</span></button></div></div>`

    await waitFor(() => expect(overlay.querySelector('[data-paimind-candidate-name]')).toHaveTextContent('artifacts/'))
    expect(overlay.querySelector('[data-paimind-context-kind-label]')).toHaveTextContent('文件夹')
    expect(overlay.querySelector('[data-paimind-composer-disclosure]')).toHaveTextContent('将这个文件夹“artifacts/”添加到当前对话上下文。')
    expect(overlay.querySelector('[data-paimind-composer-disclosure]')).toHaveTextContent('方向键浏览 · Enter 选择 · Esc 返回')

    const style = document.querySelector<HTMLStyleElement>('style[data-paimind-plugin="@paimind/visual-experience"]')?.textContent ?? ''
    expect(style).toContain('width:min(820px,100%)!important')
    expect(style).toContain('height:min(400px,var(--paimind-composer-overlay-room,400px))!important')
    expect(style).toContain('grid-template-columns:minmax(250px,36%) minmax(360px,1fr)')
    expect(style).toContain('min-height:36px;padding:7px 8px;border-radius:10px')

    await act(async () => { scope.push('native') })
    await waitFor(() => expect(overlay.querySelector('[data-paimind-composer-disclosure]')).toBeNull())
    expect(overlay.querySelector('.fixture_itemName')).toHaveTextContent('Folder · artifacts/')
    expect(overlay.querySelector('[data-paimind-context-kind-label]')).toBeNull()
    fixture.disposeEffects()
  })

  it('commits direct Settings radio clicks and reverses PAIMind semantics in both directions', async () => {
    const current = setup(successfulApi(), 'paimind')
    await waitFor(() => expect(current.triggerSources.some(source => source.name === 'paimind-agent')).toBe(true))
    const setting = current.fixture.slots.find(entry => entry.options.id === 'paimind-visual-experience')!
    const Setting = setting.component as ComponentType
    const view = render(<Setting {...setting.inject?.() as never} />)
    const native = document.querySelector<HTMLInputElement>(
      'input[name="paimind-visual-experience-mode"][value="native"]',
    )
    const paimind = document.querySelector<HTMLInputElement>(
      'input[name="paimind-visual-experience-mode"][value="paimind"]',
    )
    if (native === null || paimind === null) throw new Error('visual experience radios are missing')

    fireEvent.click(native)
    await waitFor(() => expect(native.checked).toBe(true))
    expect(current.scope.getSnapshot().value?.mode).toBe('native')
    expect(document.body).toHaveAttribute('data-paimind-experience', 'native')
    expect(current.triggerSources).toEqual([current.nativeSkill, current.reference])
    expect(current.fixture.slots.find(entry => entry.options.id === 'paimind-quick-agents')?.disposed()).toBe(true)

    fireEvent.click(paimind)
    await waitFor(() => expect(paimind.checked).toBe(true))
    expect(current.scope.getSnapshot().value?.mode).toBe('paimind')
    await waitFor(() => expect(current.triggerSources.some(source => source.name === 'paimind-skill')).toBe(true))
    expect(document.body).toHaveAttribute('data-paimind-experience', 'paimind')

    view.unmount()
    current.fixture.disposeEffects()
  })

  it('routes the hero picker and PAIMind @ through one canonical Agent Preset seat', async () => {
    const {
      fixture, scope, nativeSelect, reference, referenceCandidates, nativeSkill,
      nativeSkillCandidates, nativeSkillPick, skillsList, triggerController, triggerSources,
    } = setup()
    await waitFor(() => expect(triggerSources.map(source => source.name)).toEqual([
      'skill', 'reference', 'paimind-agent', 'paimind-skill', 'paimind-context',
    ]))

    const visualSeat = fixture.slots.find(entry => entry.options.id === 'paimind-visual-agent-choice')!
    const Seat = visualSeat.component as ComponentType
    const seatView = render(<Seat {...visualSeat.inject?.() as never} />)
    fireEvent.click(await screen.findByRole('button', { name: /Paramont 助手/ }))
    const picker = await screen.findByRole('dialog', { name: '选择 Agent' })
    const currentChoice = picker.querySelector<HTMLButtonElement>("[data-paimind-agent-choice][aria-selected='true']")
    if (currentChoice === null) throw new Error('current Paramont Agent choice is missing')
    fireEvent.click(currentChoice)
    await waitFor(() => expect(nativeSelect).toHaveBeenLastCalledWith('paimind'))
    nativeSelect.mockClear()

    await expect(reference.candidates(
      { sessionId: 'session-1' },
      { query: '', position: 'leading', signal: new AbortController().signal },
    )).resolves.toEqual([])

    const agent = triggerSources.find(source => source.name === 'paimind-agent')!
    const allAgents = await agent.candidates(
      { sessionId: 'session-1' },
      { query: '', position: 'leading', signal: new AbortController().signal },
    )
    expect(allAgents[0]?.section).toBe('推荐 Agent')
    expect(allAgents.find(candidate => candidate.value === 'standard')).toBeUndefined()
    expect(allAgents.find(candidate => candidate.value === 'paimind')?.section).toBe('推荐 Agent')
    const agents = await agent.candidates(
      { sessionId: 'session-1' },
      { query: 'Paramont', position: 'leading', signal: new AbortController().signal },
    )
    expect(agents).toEqual([expect.objectContaining({ name: 'Paramont 助手', value: 'paimind' })])
    expect(agent.onPick({
      candidate: agents[0]!, session: { sessionId: 'session-1' }, position: 'leading', via: 'menu',
      span: { start: 0, end: 1, draftRev: 2 },
    })).toEqual({ text: '' })
    await waitFor(() => expect(nativeSelect).toHaveBeenCalledWith('paimind'))

    const builderRequest = vi.fn()
    window.addEventListener('paimind:agent-builder:request', builderRequest, { once: true })
    const creators = await agent.candidates(
      { sessionId: 'session-1' },
      { query: '创建助手', position: 'leading', signal: new AbortController().signal },
    )
    expect(creators).toEqual([])
    expect(builderRequest).not.toHaveBeenCalled()

    const skill = triggerSources.find(source => source.name === 'paimind-skill')!
    const skills = await skill.candidates(
      { sessionId: 'session-1' },
      { query: 'present', position: 'leading', signal: new AbortController().signal },
    )
    expect(skillsList).toHaveBeenCalledWith(
      { sessionId: 'session-1' },
      expect.any(AbortSignal),
    )
    expect(nativeSkillCandidates).not.toHaveBeenCalled()
    expect(skill.onPick({
      candidate: skills[0]!, session: { sessionId: 'session-1' }, position: 'leading', via: 'menu',
      span: { start: 0, end: 1, draftRev: 3 },
    })).toEqual({ text: '/presentation ' })
    expect(nativeSkillPick).toHaveBeenCalledWith(expect.objectContaining({
      candidate: expect.objectContaining({ name: 'presentation' }),
    }))

    const contextEntry = fixture.slots.find(entry => entry.options.id === 'paimind-add-context')!
    const Context = contextEntry.component as ComponentType
    const contextView = render(<Context
      {...contextEntry.inject?.() as never}
      session={{ sessionId: 'session-1' }}
      input={{ draft: 'hello', draftRev: 9, phase: 'plain' }}
    />)
    fireEvent.click(screen.getByRole('button', { name: '添加上下文' }))
    expect(triggerController.toggleSource).toHaveBeenCalledWith('paimind-context', expect.objectContaining({
      span: { start: 5, end: 5, draftRev: 9 },
    }))

    await act(async () => { scope.push('native') })
    await waitFor(() => expect(triggerSources).toEqual([nativeSkill, reference]))
    expect(reference.candidates).toBe(referenceCandidates)
    contextView.unmount(); seatView.unmount()
    fixture.disposeEffects()
  })

  it('shows a newly selected Session Skill on the next @ query without reload or a prior turn', async () => {
    const current = setup()
    await waitFor(() => expect(current.triggerSources.some(source => source.name === 'paimind-skill')).toBe(true))
    const request = { query: '', position: 'leading' as const, signal: new AbortController().signal }
    await current.nativeSkillCandidates({ sessionId: 'session-1' }, request)
    current.skillsList
      .mockResolvedValueOnce({ result: { ok: true, value: { skills: [
        { name: 'genui', description: '系统界面能力。', modelInvocable: true },
      ] } } })
      .mockResolvedValueOnce({ result: { ok: true, value: { skills: [
        { name: 'genui', description: '系统界面能力。', modelInvocable: true },
        { name: 'selected-business-skill', description: '刚刚选择的业务技能。', modelInvocable: true },
      ] } } })
    const skill = current.triggerSources.find(source => source.name === 'paimind-skill')!

    await expect(skill.candidates({ sessionId: 'session-1' }, request)).resolves.toEqual([
      expect.objectContaining({ name: 'genui' }),
    ])
    await expect(skill.candidates({ sessionId: 'session-1' }, request)).resolves.toEqual([
      expect.objectContaining({ name: 'genui' }),
      expect.objectContaining({ name: 'selected-business-skill', section: 'Skill（技能）' }),
    ])
    expect(current.skillsList).toHaveBeenCalledTimes(2)

    current.fixture.disposeEffects()
  })

  it('keeps one canonical avatar identity across @, Quick Agents and Preset surfaces, with reversible fallback presentation', async () => {
    const mapped = resolvePaimindAgentAvatar({ id: 'standard' })
    const projected = Array.from({ length: 8 }, (_, index) => resolvePaimindAgentAvatar({ id: `unknown-preset-${index + 1}` }))
    const projectedA = projected[0]!
    const projectedAAgain = resolvePaimindAgentAvatar({ id: 'unknown-preset-1' })
    const fallback = resolvePaimindAgentAvatar({ id: '' })
    expect(mapped).toMatchObject({ assetKey: 'technical-expert-agent', fallback: false, projected: false })
    expect(projectedA).toEqual(projectedAAgain)
    expect(projected.every(item => !item.fallback && item.projected)).toBe(true)
    expect(new Set(projected.map(item => item.assetKey)).size).toBeGreaterThan(1)
    expect(fallback).toMatchObject({ assetKey: 'paramont-brand-fallback', fallback: true, projected: false })

    const { fixture, scope, triggerSources } = setup()
    await waitFor(() => expect(triggerSources.some(source => source.name === 'paimind-agent')).toBe(true))

    const agentCenter = document.createElement('section')
    for (const id of ['managed-personal-alpha', 'managed-business-beta', 'managed-personal-gamma']) {
      const seat = document.createElement('span')
      seat.dataset.paimindAgentAvatarSeat = ''
      seat.dataset.paimindAgentId = id
      seat.innerHTML = '<span data-paimind-agent-avatar-fallback><svg aria-hidden="true"></svg></span>'
      agentCenter.append(seat)
    }
    const nativeAvatarSeat = document.createElement('span')
    nativeAvatarSeat.dataset.paimindAgentAvatarSeat = ''
    nativeAvatarSeat.dataset.paimindAgentId = 'managed-native-avatar'
    nativeAvatarSeat.innerHTML = '<span data-paimind-agent-avatar-fallback></span><img data-native-avatar src="native-avatar.png" alt="">'
    agentCenter.append(nativeAvatarSeat)
    document.body.append(agentCenter)
    await waitFor(() => expect(agentCenter.querySelectorAll(
      'img[data-paimind-agent-avatar-owner="@paimind/visual-experience"]',
    )).toHaveLength(3))
    const centerKeys = [...agentCenter.querySelectorAll<HTMLElement>('[data-paimind-agent-avatar-owner]')]
      .map(element => element.dataset.paimindAgentAvatarKey)
    expect(new Set(centerKeys).size).toBeGreaterThan(1)
    expect(nativeAvatarSeat.querySelector('[data-paimind-agent-avatar-owner]')).toBeNull()

    const dock = fixture.slots.find(entry => entry.options.id === 'paimind-quick-agents')!
    const Dock = dock.component as ComponentType
    const dockView = render(<Dock {...dock.inject?.() as never} />)
    const quickParamont = document.querySelector<HTMLImageElement>(
      '[data-paimind-quick-agent] [data-paimind-agent-avatar-id="paimind"]',
    )
    expect(quickParamont).toHaveAttribute('data-paimind-agent-avatar-key', 'paramont-brand-fallback')
    expect(quickParamont).not.toHaveAttribute('data-paimind-agent-avatar-fallback')
    const quickKeys = [...document.querySelectorAll<HTMLElement>('[data-paimind-quick-agent] [data-paimind-agent-avatar-key]')]
      .map(element => element.dataset.paimindAgentAvatarKey)
    expect(new Set(quickKeys).size).toBeGreaterThan(1)

    const visualSeat = fixture.slots.find(entry => entry.options.id === 'paimind-visual-agent-choice')!
    const Seat = visualSeat.component as ComponentType
    const seatView = render(<Seat {...visualSeat.inject?.() as never} />)
    const quickParamontButton = quickParamont?.closest('button')
    if (!(quickParamontButton instanceof HTMLButtonElement)) throw new Error('Paramont Quick Agent is missing')
    fireEvent.click(quickParamontButton)
    await waitFor(() => expect(document.querySelector(
      '[data-paimind-agent-picker-trigger] [data-paimind-agent-avatar-id="paimind"]',
    )).not.toBeNull())

    const agent = triggerSources.find(source => source.name === 'paimind-agent')!
    const candidates = await agent.candidates(
      { sessionId: 'session-1' },
      { query: 'Paramont', position: 'leading', signal: new AbortController().signal },
    )
    const token = candidates[0]?.icon
    expect(token).toBe(`${PAIMIND_AGENT_AVATAR_ICON_PREFIX}paimind`)
    const overlay = document.querySelector<HTMLElement>("[data-slot='conversation.input.overlay']")!
    overlay.innerHTML = `<div role="listbox"><button id="dsh-slash-option-paimind-agent-0" role="option"><span aria-hidden="true">${token}</span><span>Paramont 助手</span></button></div>`
    await waitFor(() => expect(overlay.querySelector(
      '[data-paimind-agent-avatar-id="paimind"][data-paimind-agent-avatar-key="paramont-brand-fallback"]',
    )).not.toBeNull())
    const menuAvatar = overlay.querySelector<HTMLImageElement>('img[data-paimind-agent-avatar-id="paimind"]')
    await waitFor(() => expect(menuAvatar?.src).toBe(quickParamont?.src))
    await waitFor(() => expect(overlay.querySelector('[data-paimind-composer-disclosure-avatar]')).not.toBeNull())

    await act(async () => { scope.push('native') })
    await waitFor(() => expect(overlay.querySelector('[data-paimind-agent-avatar]')).toBeNull())
    expect(agentCenter.querySelector('[data-paimind-agent-avatar-owner]')).toBeNull()
    expect(agentCenter.querySelectorAll('[data-paimind-agent-avatar-fallback]')).toHaveLength(4)
    expect(overlay.querySelector('[aria-hidden="true"]')?.textContent).toBe(token)
    expect(overlay.querySelector('[data-paimind-agent-avatar-host]')).toBeNull()

    seatView.unmount(); dockView.unmount(); fixture.disposeEffects()
  })

  it('limits Focus Density to collapsed semantic rows and honors reduced motion', () => {
    const { fixture } = setup(successfulApi(), 'paimind')
    const style = document.querySelector<HTMLStyleElement>('style[data-paimind-plugin="@paimind/visual-experience"]')?.textContent ?? ''
    expect(style).toContain("[data-variant][aria-expanded='false']")
    expect(style).toContain("[data-disclosure-row][aria-expanded='false']")
    expect(style).toContain('min-height:24px!important')
    expect(style).not.toContain('min-height:30px')
    expect(style).toContain("[data-slot='conversation.hero.agentPreset']) > button{min-width:0;overflow:hidden}")
    expect(style).toContain('[data-paimind-agent-picker-trigger]{min-width:0;max-width:45%}')
    expect(style).toContain('[data-paimind-composer-overlay-anchor]')
    expect(style).toContain("[role='listbox']")
    expect(style).toContain('max-height:min(400px,var(--paimind-composer-overlay-room,400px))!important')
    expect(style).toContain("[data-input-backdrop='true']{color:var(--paimind-ink)!important}")
    expect(style).toContain('textarea[data-phase]{background:transparent!important;color:transparent!important')
    expect(style).not.toContain("[data-phase]{background:var(--paimind-canvas)!important}")
    expect(style).toContain("bottom:calc(100% + 8px)!important")
    expect(style).toContain('background:var(--paimind-glass-strong)!important')
    expect(style).not.toContain("body[data-paimind-experience='paimind'] [data-paimind-agent-center]")
    expect(style).toContain("body[data-paimind-experience='paimind'] [data-paimind-skill-center]")
    expect(style).toContain('[data-paimind-composer-disclosure]')
    expect(style).toContain('grid-template-columns:minmax(250px,36%) minmax(360px,1fr)')
    expect(style).toContain('[data-paimind-candidate-description]{display:none!important}')
    expect(style).toContain('[data-paimind-agent-avatar]{display:block')
    expect(style).toContain('@media(prefers-reduced-motion:reduce)')
    fixture.disposeEffects()
  })

  it('keeps the native Preset selector when roster loading fails', async () => {
    const api = successfulApi()
    vi.mocked(api.list).mockRejectedValueOnce(new Error('offline'))
    const { fixture } = setup(api)
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fixture.slots.filter(entry => entry.injectedName === 'conversation.hero.agentPreset' && !entry.disposed())).toHaveLength(1)
    fixture.disposeEffects()
  })
})
