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
  let current = 'standard'
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
  const skillsList = vi.fn(async () => { throw new Error('PAIMind must delegate to the native Skill source') })
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
})

describe('PAIMind visual experience client', () => {
  it('enables the reversible experience, renders the welcome entry and restores native mode', async () => {
    const { fixture, scope, theme, removeTheme, nativeSelect } = setup()
    await waitFor(() => expect(fixture.slots.filter(entry => entry.injectedName === 'conversation.hero.agentPreset' && !entry.disposed())).toHaveLength(2))
    expect(document.body).toHaveAttribute('data-paimind-experience', 'paimind')
    expect(document.body).toHaveAttribute('data-paimind-density', 'calm')
    expect(document.body).not.toHaveAttribute('data-paimind-composer-overlay')
    expect(document.querySelector('#composer-overlay-anchor')).toHaveAttribute('data-paimind-composer-overlay-anchor')
    expect((document.querySelector('#composer-overlay-anchor') as HTMLElement).style.getPropertyValue('--paimind-composer-overlay-room')).toMatch(/px$/)
    expect(theme.overrideTokens).toHaveBeenCalledWith('@paimind/visual-experience', expect.objectContaining({ '--dsw-alias-bg-base': expect.any(Object) }))
    expect(document.querySelector('style[data-paimind-plugin="@paimind/visual-experience"]')).not.toBeNull()

    const shell = fixture.slots.find(entry => entry.injectedName === 'shell.overlay' && entry.options.id === 'paimind-visual-experience-hero')!
    const Shell = shell.component as ComponentType<{ mode: PaimindExperienceModeController; locale: unknown }>
    const shellView = render(<Shell {...shell.inject?.() as never} />)
    expect(await screen.findByRole('heading', { name: '有什么可以帮你完成？' })).toBeInTheDocument()

    const dock = fixture.slots.find(entry => entry.injectedName === 'conversation.input.dock')!
    const Dock = dock.component as ComponentType
    const dockView = render(<Dock {...dock.inject?.() as never} />)
    expect(await screen.findByRole('button', { name: /Paramont 助手/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Paramont 助手/ }))
    await waitFor(() => expect(nativeSelect).toHaveBeenCalledWith('paimind'))

    const visualSeat = fixture.slots.find(entry => entry.injectedName === 'conversation.hero.agentPreset' && entry.options.id === 'paimind-visual-agent-choice')!
    const Seat = visualSeat.component as ComponentType
    const seatView = render(<Seat {...visualSeat.inject?.() as never} />)
    const trigger = document.querySelector<HTMLButtonElement>('[data-paimind-agent-picker-trigger]')
    if (trigger === null) throw new Error('visual Agent picker trigger is missing')
    fireEvent.click(trigger)
    expect(await screen.findByRole('dialog', { name: '选择 Agent 或平台模式' })).toBeInTheDocument()
    expect(screen.getAllByText('推荐 Agent').length).toBeGreaterThan(0)
    expect(screen.getAllByText('平台模式').length).toBeGreaterThan(0)
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
    expect(screen.queryByRole('heading', { name: '有什么可以帮你完成？' })).toBeNull()
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

  it('routes PAIMind @ to canonical Agent and executable Skill, and migrates native references to + Context', async () => {
    const {
      fixture, scope, nativeSelect, reference, referenceCandidates, nativeSkill,
      nativeSkillCandidates, nativeSkillPick, skillsList, triggerController, triggerSources,
    } = setup()
    await waitFor(() => expect(triggerSources.map(source => source.name)).toEqual([
      'skill', 'reference', 'paimind-agent', 'paimind-skill', 'paimind-context',
    ]))
    await expect(reference.candidates(
      { sessionId: 'session-1' },
      { query: '', position: 'leading', signal: new AbortController().signal },
    )).resolves.toEqual([])

    const agent = triggerSources.find(source => source.name === 'paimind-agent')!
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

    const skill = triggerSources.find(source => source.name === 'paimind-skill')!
    const skills = await skill.candidates(
      { sessionId: 'session-1' },
      { query: 'present', position: 'leading', signal: new AbortController().signal },
    )
    expect(nativeSkillCandidates).toHaveBeenCalledWith(
      { sessionId: 'session-1' },
      expect.objectContaining({ query: 'present' }),
    )
    expect(skillsList).not.toHaveBeenCalled()
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
    contextView.unmount()
    fixture.disposeEffects()
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
    expect(style).toContain('max-height:min(360px,var(--paimind-composer-overlay-room,360px))!important')
    expect(style).toContain("[data-input-backdrop='true']{color:var(--paimind-ink)!important}")
    expect(style).toContain('textarea[data-phase]{background:transparent!important;color:transparent!important')
    expect(style).not.toContain("[data-phase]{background:var(--paimind-canvas)!important}")
    expect(style).toContain("bottom:calc(100% + 8px)!important")
    expect(style).toContain('background:color-mix(in srgb,var(--paimind-canvas) 94%,white 6%)!important')
    expect(style).toContain('[data-paimind-composer-disclosure]')
    expect(style).toContain('grid-template-columns:minmax(250px,42%) minmax(0,1fr)')
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
