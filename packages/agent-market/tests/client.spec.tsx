import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HarnessAgentPresetApi, PaimindLocaleSource } from '@paimind/harness-compat'
import {
  PaimindAgentBuilderRequestController,
  PaimindProductSurfaceController,
  requestPaimindAgentBuilder,
} from '@paimind/harness-compat/client-surface'
import {
  AgentCenterRuntime,
  AgentCenterSection,
  AgentCenterSurface,
  AgentCenterTrigger,
  apply,
  inject,
  installAgentAuthoringSessionNavigation,
  starterPromptForProfile,
} from '../src/client/index.js'
import { AGENT_CENTER_STYLE } from '../src/client/styles.js'

const roster = {
  presets: [
    { id: 'standard', trust: 'system' as const, isDefault: true, name: 'Standard', description: 'General agent' },
    { id: 'minimal', trust: 'system' as const, isDefault: false, name: 'Minimal', description: 'Small agent' },
    { id: 'cordis', trust: 'system' as const, isDefault: false, name: 'Creator', description: 'Advanced editor' },
    { id: 'mine', trust: 'user' as const, isDefault: false, name: 'Mine native' },
  ], authorable: true, hasDocument: true,
}

function api(): HarnessAgentPresetApi {
  return {
    list: vi.fn().mockResolvedValue({ result: { ok: true, value: roster } }),
    select: vi.fn().mockImplementation(async ({ agentPreset }) => ({ result: { ok: true, value: { agentPreset } } })),
    read: vi.fn(), copy: vi.fn(), openDocument: vi.fn(), remove: vi.fn(),
  }
}
function locale(): PaimindLocaleSource { return { getLocale: () => ({ active: 'en-US' }), subscribe: () => () => {} } }
const profile = {
  agentId: 'mine', presetId: 'mine', name: 'Research Agent', description: 'Find evidence', basePresetId: 'standard',
  role: 'Researcher', goal: 'Find facts', behavior: 'Cite sources', preferredSkillNames: ['web-research'], instructions: '',
  revision: 1, configVersion: 'v1-a', updatedAt: 1, health: 'healthy' as const,
}

function services() {
  const runtimeSnapshot = { notice: null, error: null }
  let currentSessionId: string | null = 'session-origin'
  const sessionListeners = new Set<() => void>()
  let authoringWatch: Readonly<{
    onRunning?: () => void
    onTurn: (result: Readonly<{
      sessionId: string
      turn: number
      endSeq: number
      text: string
      proposal: Readonly<Record<string, unknown>> | null
    }>) => void | Promise<void>
    onIdle: () => void
    onError: (error: Error) => void
  }> | null = null
  return {
    profiles: {
      listProfiles: vi.fn().mockResolvedValue({ ok: true, value: { profiles: [profile] } }),
      saveProfile: vi.fn(), setDefault: vi.fn(), sealAuthoringSession: vi.fn(), prepareAuthoringTurn: vi.fn().mockResolvedValue({ ok: true, value: { sessionId: 'session-authoring', prepared: true } }), bindSession: vi.fn(), migrationPlan: vi.fn(), recordMigration: vi.fn(), verifySession: vi.fn(), listAudit: vi.fn(),
    },
    skills: { listInstalled: vi.fn().mockResolvedValue({ ok: true, value: { items: [
      { name: 'web-research', description: 'Search official documentation and cite sources' },
      { name: 'spreadsheet-inspector', description: 'Analyze Excel data and anomalies' },
      { name: 'ppt-master', description: 'Build presentations from evidence' },
    ] } }) },
    runtime: {
      subscribe: () => () => {},
      getSnapshot: () => runtimeSnapshot,
      start: vi.fn().mockResolvedValue('session-new'),
      author: vi.fn().mockImplementation(async ({ sessionId, onSessionCreated }: { readonly sessionId: string | null; readonly onSessionCreated?: (sessionId: string) => void }) => {
        const resolvedSessionId = sessionId ?? 'session-authoring'
        if (sessionId === null) onSessionCreated?.(resolvedSessionId)
        return {
        sessionId: resolvedSessionId,
        turn: 1,
        endSeq: 3,
        text: 'The real model reviewed the current brief and is ready for the next instruction.',
        proposal: null,
      }}),
      prepareAuthoringContext: vi.fn().mockResolvedValue(undefined),
      watchAuthoringSession: vi.fn((_sessionId, _afterSeq, _skills, callbacks) => {
        authoringWatch = callbacks
        return () => { authoringWatch = null }
      }),
      beginTest: vi.fn().mockResolvedValue('session-test'),
      test: vi.fn().mockResolvedValue('session-test'),
      sessionState: vi.fn(() => ({ running: true, completed: false, error: null })),
      subscribeSessions: vi.fn(listener => {
        sessionListeners.add(listener)
        return () => { sessionListeners.delete(listener) }
      }),
      detectCompletedAuthoringSession: vi.fn(async (sessionId: string) => sessionId.startsWith('paimind-authoring-')),
      currentAuthoringSessionId: vi.fn(() => currentSessionId?.startsWith('paimind-authoring-') ? currentSessionId : null),
      beginAgentCenterBrowse: vi.fn(),
      resumeSelectedAuthoringSession: vi.fn(),
      endAgentCenterBrowse: vi.fn(),
      resumeAuthoringSession: vi.fn().mockImplementation(async (sessionId: string, fallbackDraft) => ({
        sessionId,
        cursor: 13,
        draft: {
          ...fallbackDraft,
          name: 'Requirement Clarifier',
          description: 'Clarify one requirement at a time',
          role: 'Requirement analyst',
          goal: 'Produce an accepted brief',
          behavior: 'Ask one focused question',
        },
      })),
      currentSessionId: vi.fn(() => currentSessionId),
      openSession: vi.fn((sessionId: string) => {
        currentSessionId = sessionId
        for (const listener of sessionListeners) listener()
      }),
    },
    emitAuthoringTurn(result: Readonly<{
      sessionId: string
      turn: number
      endSeq: number
      text: string
      proposal: Readonly<Record<string, unknown>> | null
    }>) {
      const watch = authoringWatch
      if (watch === null) throw new Error('Authoring watcher is not connected')
      act(() => {
        watch.onRunning?.()
        void watch.onTurn(result)
        watch.onIdle()
      })
    },
  }
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  document.body.style.overflow = ''
  document.head.querySelectorAll('style[data-paimind-plugin="@paimind/agent-market"]').forEach(node => { node.remove() })
})

describe('Agent Center business UI', () => {
  it('stacks the shared footer actions in expanded and collapsed sidebars', () => {
    expect(AGENT_CENTER_STYLE).toContain("button[data-paimind-product-trigger='agent-center'][data-wide='true'])")
    expect(AGENT_CENTER_STYLE).toContain("button[data-paimind-product-trigger='agent-center'][data-wide='false'])")
    expect(AGENT_CENTER_STYLE).toContain('width: 100% !important;')
    expect(AGENT_CENTER_STYLE).toContain('width: 36px !important;')
  })

  it('keeps universal Create Agent in Chat until a valid draft completes, then opens the Center once', async () => {
    let current: string | null = 'ordinary-session'
    const byId: Record<string, { running: boolean; agentPreset?: string }> = {
      'ordinary-session': { running: false, agentPreset: 'standard' },
    }
    const completed = new Set<string>()
    const listeners = new Set<() => void>()
    const runtime = {
      currentSessionId: () => current,
      subscribeSessions: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      detectCompletedAuthoringSession: vi.fn(async (sessionId: string) => (
        byId[sessionId]?.agentPreset === 'cordis'
        && (sessionId.startsWith('paimind-authoring-') || completed.has(sessionId))
      )),
    }
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    const dispose = installAgentAuthoringSessionNavigation(runtime as never, controller)
    const authoringSessionId = 'paimind-authoring-123e4567-e89b-42d3-a456-426614174000'

    expect(controller.getSnapshot().open).toBe(false)
    byId[authoringSessionId] = { running: false, agentPreset: 'cordis' }
    current = authoringSessionId
    listeners.forEach(listener => { listener() })
    await waitFor(() => expect(controller.getSnapshot().open).toBe(true))

    controller.close(false)
    listeners.forEach(listener => { listener() })
    expect(controller.getSnapshot().open).toBe(false)

    current = 'ordinary-session'
    listeners.forEach(listener => { listener() })
    current = authoringSessionId
    listeners.forEach(listener => { listener() })
    await waitFor(() => expect(controller.getSnapshot().open).toBe(true))

    controller.close(false)
    const lookalike = 'paimind-authoring-223e4567-e89b-42d3-a456-426614174000'
    byId[lookalike] = { running: false, agentPreset: 'standard' }
    current = lookalike
    listeners.forEach(listener => { listener() })
    expect(controller.getSnapshot().open).toBe(false)

    const universalSessionId = 'native-cordis-session'
    byId[universalSessionId] = { running: false, agentPreset: 'cordis' }
    current = universalSessionId
    listeners.forEach(listener => { listener() })
    await waitFor(() => expect(runtime.detectCompletedAuthoringSession).toHaveBeenCalledWith(universalSessionId))
    expect(controller.getSnapshot().open).toBe(false)

    completed.add(universalSessionId)
    listeners.forEach(listener => { listener() })
    await waitFor(() => expect(controller.getSnapshot().open).toBe(true))
    dispose()
    controller.dispose()
  })

  it('reopens the dual-pane Builder when an existing authoring Session is selected', async () => {
    const fixture = services()
    vi.mocked(fixture.runtime.sessionState).mockReturnValue({ running: false, completed: true, error: null })
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await screen.findByRole('tab', { name: 'My Agents' })
    const authoringSessionId = 'paimind-authoring-323e4567-e89b-42d3-a456-426614174000'

    act(() => { fixture.runtime.openSession(authoringSessionId) })
    const builder = await screen.findByRole('region', { name: 'Create Agent' })
    expect(fixture.runtime.resumeAuthoringSession).toHaveBeenCalledWith(
      authoringSessionId,
      expect.objectContaining({ productKind: 'personal', basePresetId: 'standard' }),
      expect.arrayContaining([{ name: 'web-research' }]),
    )
    expect(within(builder).getByDisplayValue('Requirement Clarifier')).toBeInTheDocument()
    expect(within(builder).getByDisplayValue('Requirement analyst')).toBeInTheDocument()
    await screen.findByText('Harness native configuration conversation connected')

    fireEvent.click(within(builder).getByRole('button', { name: 'Back to Agent Center' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Create Agent' })).toBeNull())
    expect(fixture.runtime.resumeAuthoringSession).toHaveBeenCalledTimes(1)

    act(() => { fixture.runtime.openSession('session-origin') })
    act(() => { fixture.runtime.openSession(authoringSessionId) })
    await screen.findByRole('region', { name: 'Create Agent' })
    expect(fixture.runtime.resumeAuthoringSession).toHaveBeenCalledTimes(2)
  })

  it('switches the combined Builder to the clicked authoring history and resizes its native conversation pane', async () => {
    const fixture = services()
    const firstSessionId = 'paimind-authoring-423e4567-e89b-42d3-a456-426614174000'
    const secondSessionId = 'paimind-authoring-523e4567-e89b-42d3-a456-426614174000'
    vi.mocked(fixture.runtime.sessionState).mockReturnValue({ running: false, completed: true, error: null })
    vi.mocked(fixture.runtime.resumeAuthoringSession).mockImplementation(async (sessionId, fallbackDraft) => ({
      sessionId,
      cursor: sessionId === firstSessionId ? 13 : 21,
      draft: {
        ...fallbackDraft,
        name: sessionId === firstSessionId ? 'First history Agent' : 'Second history Agent',
        description: sessionId === firstSessionId ? 'First historical draft' : 'Second historical draft',
        role: 'Requirement analyst',
        goal: 'Produce an accepted brief',
        behavior: 'Ask one focused question',
      },
    }))
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    const center = document.createElement('main')
    Object.defineProperty(center, 'getBoundingClientRect', { value: () => ({
      x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}),
    }) })
    const nativeConversation = document.createElement('div')
    nativeConversation.dataset.slot = 'conversation'
    const nativeContent = document.createElement('section')
    Object.defineProperty(nativeContent, 'getBoundingClientRect', { value: () => {
      const width = Number.parseFloat(center.style.getPropertyValue('--paimind-agent-native-conversation-width')) || 520
      return {
        x: 1200 - width, y: 0, top: 0, left: 1200 - width, right: 1200, bottom: 800, width, height: 800, toJSON: () => ({}),
      }
    } })
    nativeConversation.append(nativeContent)
    center.append(nativeConversation)
    document.body.append(center)
    const disposeNavigation = installAgentAuthoringSessionNavigation(fixture.runtime as never, controller)
    render(<>
      <button type="button" onClick={() => { fixture.runtime.openSession(secondSessionId) }}>Second authoring history</button>
      <AgentCenterTrigger wide controller={controller} locale={locale()} />
      <AgentCenterSurface controller={controller} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />
    </>)

    act(() => { fixture.runtime.openSession(firstSessionId) })
    const builder = await screen.findByRole('region', { name: 'Create Agent' })
    await waitFor(() => expect(within(builder).getByDisplayValue('First history Agent')).toBeInTheDocument())
    await screen.findByText('Harness native configuration conversation connected')
    expect(controller.getSnapshot().open).toBe(true)
    expect(nativeConversation).not.toHaveAttribute('inert')

    const splitter = screen.getByRole('separator', { name: 'Resize conversation pane' })
    expect(splitter).toHaveAttribute('aria-valuemin', '320')
    expect(splitter).toHaveAttribute('aria-valuemax', '720')
    fireEvent.keyDown(splitter, { key: 'ArrowLeft' })
    await waitFor(() => expect(center.style.getPropertyValue('--paimind-agent-native-conversation-width')).toBe('544px'))
    expect(splitter).toHaveAttribute('aria-valuenow', '544')
    fireEvent.pointerDown(splitter, { button: 0, clientX: 700 })
    fireEvent.pointerMove(window, { clientX: 660 })
    fireEvent.pointerUp(window, { clientX: 660 })
    await waitFor(() => expect(center.style.getPropertyValue('--paimind-agent-native-conversation-width')).toBe('584px'))
    expect(splitter).toHaveAttribute('aria-valuenow', '584')

    fireEvent.click(nativeContent)
    expect(controller.getSnapshot().open).toBe(true)
    expect(fixture.runtime.currentSessionId()).toBe(firstSessionId)

    vi.mocked(fixture.runtime.openSession).mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Second authoring history' }))
    const secondBuilder = await screen.findByRole('region', { name: 'Create Agent' })
    await waitFor(() => expect(within(secondBuilder).getByDisplayValue('Second history Agent')).toBeInTheDocument())
    expect(controller.getSnapshot().open).toBe(true)
    expect(fixture.runtime.currentSessionId()).toBe(secondSessionId)
    expect(fixture.runtime.openSession).toHaveBeenCalledWith(secondSessionId)
    expect(fixture.runtime.openSession).not.toHaveBeenCalledWith(firstSessionId)

    disposeNavigation()
    controller.dispose()
  })

  it('is the only business entry, splits Platform and My Agents, and hides internal ids and hashes', async () => {
    const fixture = services()
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Research Agent' })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'My Agents' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText(/preset id|hash|file path|config version/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Platform modes' }))
    expect(screen.getByRole('heading', { name: 'Standard' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Personal Agent creation assistant' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Create Personal Agent' })).toHaveLength(2)
    expect(screen.getAllByRole('tab')).toHaveLength(3)
  })

  it('returns from the Center through a visible conversation action', async () => {
    const fixture = services(); const close = vi.fn()
    render(<AgentCenterSection close={close} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    fireEvent.click(screen.getByRole('button', { name: 'Back to conversation' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('presents native cordis as the creation assistant and routes its primary action into the existing builder', async () => {
    const fixture = services(); const openAdvanced = vi.fn(() => true)
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={openAdvanced} />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    fireEvent.click(screen.getByRole('tab', { name: 'Platform modes' }))
    const heading = await screen.findByRole('heading', { name: 'Personal Agent creation assistant' })
    const card = heading.closest('[data-paimind-agent-card]') as HTMLElement
    expect(card).toHaveAttribute('data-paimind-agent-preset-id', 'cordis')
    expect(within(card).getByText('Use the native Harness Creator mode to create and configure a personal Agent.')).toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: 'Manage Presets' }))
    expect(openAdvanced).toHaveBeenCalledTimes(1)

    fireEvent.click(within(card).getByRole('button', { name: 'Create Personal Agent' }))
    expect(screen.getByRole('dialog', { name: 'Start with one sentence' })).toBeInTheDocument()
    expect(screen.getByLabelText('What Agent do you want to create?')).toBeInTheDocument()
    expect(screen.queryByLabelText('Agent name (editable later)')).toBeNull()
    expect(screen.queryByLabelText('Base mode')).toBeNull()
    expect(fixture.runtime.start).not.toHaveBeenCalled()
  })

  it('resets the Center scroll position when the unified Builder opens', async () => {
    const fixture = services()
    const { container } = render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    const center = container.querySelector<HTMLElement>('[data-paimind-agent-center]')!
    center.scrollTop = 240

    fireEvent.click(screen.getAllByRole('button', { name: 'Create Personal Agent' })[0]!)
    fireEvent.change(screen.getByLabelText('What Agent do you want to create?'), { target: { value: 'Review a business workflow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start creating' }))

    await waitFor(() => expect(center.scrollTop).toBe(0))
    expect(screen.getByRole('region', { name: 'Create Agent' })).toBeInTheDocument()
  })

  it('exposes canonical avatar seats for managed Agents while platform modes keep native icons', async () => {
    const fixture = services()
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    const personalHeading = await screen.findByRole('heading', { name: 'Research Agent' })
    const personalCard = personalHeading.closest('[data-paimind-agent-card]')
    expect(personalCard).toHaveAttribute('data-paimind-agent-id', 'mine')
    expect(personalCard).toHaveAttribute('data-product-kind', 'personal')
    const avatarSeat = within(personalCard as HTMLElement).getByRole('img', { name: 'Research Agent avatar' })
    expect(avatarSeat).toHaveAttribute('data-paimind-agent-avatar-seat')
    expect(avatarSeat).toHaveAttribute('data-paimind-agent-id', 'mine')
    expect(avatarSeat).toHaveAttribute('data-paimind-agent-avatar-kind', 'personal')
    expect(avatarSeat.querySelector('[data-paimind-agent-avatar-fallback] svg')).not.toBeNull()
    expect(avatarSeat.querySelector('[data-paimind-agent-avatar]')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Platform modes' }))
    const platformHeading = screen.getByRole('heading', { name: 'Standard' })
    const platformCard = platformHeading.closest('[data-paimind-agent-card]')
    expect(platformCard).not.toBeNull()
    expect(platformCard).not.toHaveAttribute('data-paimind-agent-id')
    expect(platformCard?.querySelector('[data-paimind-agent-avatar-seat]')).toBeNull()
  })

  it('delegates a personal Agent launch to the runtime adapter', async () => {
    const fixture = services(); const close = vi.fn()
    render(<AgentCenterSection close={close} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'My Agents' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }))
    await waitFor(() => expect(fixture.runtime.start).toHaveBeenCalledWith('mine', profile))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('reuses the current blank conversation and keeps the native selector on the chosen Agent', async () => {
    const row = { id: 'session-blank', blank: true, agentPreset: 'ptc' }
    const listeners = new Set<() => void>()
    const sessions = {
      list: {
        getSnapshot: () => ({ current: row.id, byId: { [row.id]: row } }),
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      binding: () => ({ ctx: {}, session: { getSnapshot: () => ({ running: false, chat: null }) } }),
      open: vi.fn(),
    }
    let selected = 'ptc'
    const seat = {
      getSnapshot: () => ({ options: [], current: selected, error: null, busy: false, introduce: false }),
      select: vi.fn(async (presetId: string) => {
        selected = presetId
        row.agentPreset = presetId
        listeners.forEach(listener => { listener() })
      }),
    }
    const workspaces = { startSession: vi.fn() }
    const setDraft = vi.fn()
    const conversation = { input: { for: () => ({ setDraft }) } }
    const remote = {
      listAudit: vi.fn().mockResolvedValue({ ok: true, value: { migrations: [], verifications: [] } }),
      migrationPlan: vi.fn().mockResolvedValue({ ok: true, value: null }),
    }
    const runtime = new AgentCenterRuntime(seat as never, remote as never, sessions as never, workspaces as never, conversation as never)

    await expect(runtime.start('standard')).resolves.toBe(row.id)
    expect(workspaces.startSession).not.toHaveBeenCalled()
    expect(seat.select).toHaveBeenCalledWith('standard')
    expect(row.agentPreset).toBe('standard')
    expect(selected).toBe('standard')
    expect(setDraft).toHaveBeenCalledWith('')
    runtime.dispose()
  })

  it('prefills the explicit saved trigger instead of an unrelated generic example', () => {
    expect(starterPromptForProfile({
      ...profile,
      instructions: 'When the user says “Start a new proposal.”, run the guided intake.',
    })).toBe('Start a new proposal.')
    expect(starterPromptForProfile(profile)).toBe('')
  })

  it('fails clearly without a selector seat and creates no shadow binding', async () => {
    const row = { id: 'session-blank', blank: true, agentPreset: 'ptc' }
    const noteAgentPreset = vi.fn((sessionId: string, presetId: string) => {
      if (sessionId === row.id) row.agentPreset = presetId
    })
    const sessions = {
      list: {
        getSnapshot: () => ({ current: row.id, byId: { [row.id]: row } }),
        subscribe: () => () => {},
      },
      noteAgentPreset,
      binding: () => ({ ctx: {}, session: { getSnapshot: () => ({ running: false, chat: null }) } }),
      open: vi.fn(),
    }
    const presetApi = api()
    const setDraft = vi.fn()
    const bindSession = vi.fn()
    const remote = {
      listAudit: vi.fn().mockResolvedValue({ ok: true, value: { migrations: [], verifications: [] } }),
      migrationPlan: vi.fn().mockResolvedValue({ ok: true, value: null }),
      bindSession,
    }
    const runtime = new AgentCenterRuntime(
      null,
      remote as never,
      sessions as never,
      { startSession: vi.fn() } as never,
      { input: { for: () => ({ setDraft }) } } as never,
    )

    await expect(runtime.start('standard', profile)).rejects.toThrow('当前 Harness 版本未提供可用的智能体选择器')
    expect(presetApi.select).not.toHaveBeenCalled()
    expect(noteAgentPreset).not.toHaveBeenCalled()
    expect(bindSession).not.toHaveBeenCalled()
    expect(row.agentPreset).toBe('ptc')
    expect(setDraft).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('resolves the native selector when it mounts after Agent Center startup', async () => {
    const row = { id: 'session-blank', blank: true, agentPreset: 'ptc' }
    const listeners = new Set<() => void>()
    const sessions = {
      list: {
        getSnapshot: () => ({ current: row.id, byId: { [row.id]: row } }),
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      binding: () => ({ ctx: {}, session: { getSnapshot: () => ({ running: false, chat: null }) } }),
      open: vi.fn(),
    }
    let selected = 'ptc'
    const seat = {
      getSnapshot: () => ({ current: selected, error: null, busy: false }),
      load: vi.fn(async () => {}),
      select: vi.fn(async (presetId: string) => {
        selected = presetId
        row.agentPreset = presetId
        listeners.forEach(listener => { listener() })
      }),
    }
    let mountedSeat: typeof seat | null = null
    const setDraft = vi.fn()
    const runtime = new AgentCenterRuntime(
      () => mountedSeat,
      {
        listAudit: vi.fn().mockResolvedValue({ ok: true, value: { migrations: [], verifications: [] } }),
        migrationPlan: vi.fn().mockResolvedValue({ ok: true, value: null }),
      } as never,
      sessions as never,
      { startSession: vi.fn() } as never,
      { input: { for: () => ({ setDraft }) } } as never,
    )

    mountedSeat = seat
    await expect(runtime.start('standard')).resolves.toBe(row.id)
    expect(seat.select).toHaveBeenCalledWith('standard')
    expect(row.agentPreset).toBe('standard')
    expect(setDraft).toHaveBeenCalled()
    runtime.dispose()
  })

  it('adapts configuration turns to the native cordis Session API contract and parses only the model proposal', async () => {
    const events: Array<{ readonly event: { readonly type: string; readonly seq: number; readonly data?: unknown } }> = []
    const sessionListeners = new Set<() => void>()
    let nativeAuthoringSessionId: string | undefined
    let sessionSnapshot: { readonly lastAgentError: string | null; readonly partial: null | { readonly turn: number; readonly blocks: readonly { readonly kind: string; readonly text?: string }[] } } = { lastAgentError: null, partial: null }
    let turn = 0
    const authoringApi = {
      create: vi.fn().mockImplementation(async (payload: { readonly sessionId?: string }) => ({
        result: { ok: true, value: { sessionId: (nativeAuthoringSessionId = payload.sessionId), agentPreset: 'cordis' } },
      })),
      rename: vi.fn().mockResolvedValue({ result: { ok: true, value: { title: 'Agent authoring', seq: 1 } } }),
      history: vi.fn().mockImplementation(async () => ({ result: { ok: true, value: { events, hasMore: false } } })),
      prompt: vi.fn().mockImplementation(async () => {
        turn += 1
        const rpcId = `rpc-authoring-${turn}`
        sessionSnapshot = { lastAgentError: sessionSnapshot.lastAgentError, partial: { turn, blocks: [
          { kind: 'reasoning', text: 'hidden chain of thought' },
          { kind: 'text', text: '模型正在整理上下文。<paimind_agent_draft>{"secret":true}' },
        ] } }
        sessionListeners.forEach(listener => { listener() })
        const text = turn === 1
          ? '我分析了真实需求，并将重点放在可执行的周末探索上。\n<!--PAIMIND_AGENT_DRAFT\n{"name":"周末探索搭子","role":"根据天气、预算和兴趣规划城市探索的生活方式顾问","goal":"给出可当天执行且有室内备选的路线","behavior":"先确认城市和日期，再核对天气与预算；输出时间线、费用和备选方案。","preferredSkillNames":["web-research","not-installed"]}\n-->'
          : turn === 2
            ? '我保留原有目标，并把 300 元预算作为硬约束。\n<!--PAIMIND_AGENT_DRAFT\n{"instructions":"总预算不超过 300 元，雨天优先室内路线。"}\n-->'
            : '你希望这个助手优先服务新客户开发，还是老客户跟进？\n<!--PAIMIND_AGENT_DRAFT\n{"name":"销售助手","role":"销售顾问"}\n-->'
        events.push(
          { event: { type: 'turn/start', seq: turn * 10, data: { turn } } },
          { event: { type: 'user/message', seq: turn * 10 + 1, data: { id: `message-${turn}`, source: { kind: 'user', rpcId }, content: [{ type: 'text', text: 'authoring prompt' }] } } },
          { event: { type: 'assistant/message', seq: turn * 10 + 2, data: { turn, step: 1, message: { content: [{ type: 'text', text }] } } } },
          { event: { type: 'turn/end', seq: turn * 10 + 3, data: { turn, reason: { kind: 'completed' } } } },
        )
        return { rpcId, result: { ok: true, value: { accepted: true } } }
      }),
      cancel: vi.fn().mockResolvedValue({ result: { ok: true, value: { accepted: true } } }),
    }
    const sealAuthoringSession = vi.fn().mockImplementation(async ({ sessionId }: { readonly sessionId: string }) => ({
      ok: true, value: { sessionId, agentPreset: 'cordis', sealed: true },
    }))
    const runtime = new AgentCenterRuntime(
      null,
      {
        listAudit: vi.fn().mockResolvedValue({ ok: true, value: { migrations: [], verifications: [] } }),
        migrationPlan: vi.fn().mockResolvedValue({ ok: true, value: null }),
        prepareAuthoringTurn: vi.fn().mockImplementation(async ({ sessionId }: { readonly sessionId: string }) => ({
          ok: true, value: { sessionId, prepared: true },
        })),
        sealAuthoringSession,
      } as never,
      {
        list: { getSnapshot: () => ({ current: undefined, byId: nativeAuthoringSessionId === undefined ? {} : { [nativeAuthoringSessionId]: { running: false, agentPreset: 'cordis' } } }), subscribe: () => () => {} },
        binding: () => ({ session: {
          getSnapshot: () => sessionSnapshot,
          subscribe: (listener: () => void) => { sessionListeners.add(listener); return () => { sessionListeners.delete(listener) } },
        } }),
        open: vi.fn(),
      } as never,
      {
        list: { getSnapshot: () => ({ items: [], recentWorkspaceId: 'workspace-recent' }), subscribe: () => () => {} },
        startSession: vi.fn(),
      } as never,
      { input: { for: () => ({ setDraft: vi.fn() }) } } as never,
      authoringApi as never,
    )
    const draft = {
      productKind: 'personal' as const, businessCategory: '', name: '', description: '周末随机探索城市',
      basePresetId: 'standard', role: '', goal: '', behavior: '', instructions: '', preferredSkillNames: [],
    }

    const onSessionCreated = vi.fn()
    const onProgress = vi.fn()
    const first = await runtime.author({ sessionId: null, draft, prompt: '根据天气和预算安排周末玩法', skills: [{ name: 'web-research', description: 'Search current facts' }], locale: 'zh-CN', onSessionCreated, onProgress })
    expect(authoringApi.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: expect.stringMatching(/^paimind-authoring-/), agentPreset: 'cordis', workspaceId: 'workspace-recent',
    }), expect.any(AbortSignal))
    expect(onSessionCreated).toHaveBeenCalledWith(first.sessionId)
    expect(onSessionCreated.mock.invocationCallOrder[0]).toBeLessThan(sealAuthoringSession.mock.invocationCallOrder[0]!)
    expect(onProgress).toHaveBeenCalledWith('模型正在整理上下文。')
    expect(onProgress).not.toHaveBeenCalledWith(expect.stringContaining('hidden chain of thought'))
    expect(onProgress).not.toHaveBeenCalledWith(expect.stringContaining('secret'))
    expect(authoringApi.prompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: first.sessionId, mode: 'queue',
      content: [{ type: 'text', text: '根据天气和预算安排周末玩法' }],
    }), expect.any(AbortSignal))
    expect(first).toMatchObject({
      sessionId: first.sessionId,
      text: '我分析了真实需求，并将重点放在可执行的周末探索上。',
      proposal: {
        name: '周末探索搭子',
        preferredSkillNames: ['web-research'],
      },
    })
    expect(first.proposal).not.toHaveProperty('basePresetId')

    sessionSnapshot = { ...sessionSnapshot, lastAgentError: 'stale failure from a previous turn' }
    const second = await runtime.author({ sessionId: first.sessionId, draft: { ...draft, ...first.proposal }, prompt: '总预算控制在 300 元以内', skills: [{ name: 'web-research', description: 'Search current facts' }], locale: 'zh-CN' })
    expect(authoringApi.create).toHaveBeenCalledTimes(1)
    expect(second).toMatchObject({ sessionId: first.sessionId, proposal: { instructions: '总预算不超过 300 元，雨天优先室内路线。' } })
    expect(authoringApi.prompt).toHaveBeenCalledTimes(2)
    const resumed = await runtime.resumeAuthoringSession(first.sessionId, draft, [{ name: 'web-research' }])
    expect(resumed).toMatchObject({
      sessionId: first.sessionId,
      cursor: 23,
      draft: {
        name: '周末探索搭子',
        instructions: '总预算不超过 300 元，雨天优先室内路线。',
        preferredSkillNames: ['web-research'],
      },
    })

    await expect(runtime.author({
      sessionId: first.sessionId,
      draft: { ...draft, ...first.proposal, ...second.proposal },
      prompt: '创建一个销售助手',
      skills: [],
      locale: 'zh-CN',
    })).rejects.toThrow('Harness 原生提问组件')
    expect(authoringApi.prompt).toHaveBeenCalledTimes(3)

    vi.mocked(authoringApi.prompt).mockImplementationOnce(async () => {
      turn += 1
      const rpcId = `rpc-authoring-${turn}`
      events.push(
        { event: { type: 'turn/start', seq: turn * 10, data: { turn } } },
        { event: { type: 'user/message', seq: turn * 10 + 1, data: { id: `message-${turn}`, source: { kind: 'user', rpcId }, content: [{ type: 'text', text: 'aborted prompt' }] } } },
        { event: { type: 'turn/end', seq: turn * 10 + 2, data: { turn, reason: { kind: 'aborted' } } } },
      )
      return { rpcId, result: { ok: true, value: { accepted: true } } }
    })
    await expect(runtime.author({ sessionId: first.sessionId, draft, prompt: '这轮会被中止', skills: [], locale: 'zh-CN' }))
      .rejects.toThrow('未正常完成：aborted')
    runtime.dispose()
  })

  it('recognizes a universal cordis Session only after its real draft turn completes', async () => {
    const sessionId = 'native-create-agent-session'
    let running = true
    const events = [
      { event: { type: 'turn/start', seq: 10, data: { turn: 1 } } },
      { event: { type: 'user/message', seq: 11, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '创建一个需求澄清助手' }] } } },
      { event: { type: 'assistant/message', seq: 12, data: { turn: 1, message: { content: [{ type: 'text', text: '已形成可编辑说明书。\n<!--PAIMIND_AGENT_DRAFT\n{"name":"需求澄清助手","role":"澄清需求","goal":"形成明确需求","behavior":"每次只问一个问题"}\n-->' }] } } } },
      { event: { type: 'turn/end', seq: 13, data: { turn: 1, reason: { kind: 'completed' } } } },
    ]
    const runtime = new AgentCenterRuntime(
      null,
      {
        listAudit: vi.fn().mockResolvedValue({ ok: true, value: { migrations: [], verifications: [] } }),
        migrationPlan: vi.fn().mockResolvedValue({ ok: true, value: null }),
      } as never,
      {
        list: {
          getSnapshot: () => ({ current: sessionId, byId: { [sessionId]: { running, agentPreset: 'cordis' } } }),
          subscribe: () => () => {},
        },
        open: vi.fn(),
      } as never,
      { list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} }, startSession: vi.fn() } as never,
      { input: { for: () => ({ setDraft: vi.fn() }) } } as never,
      {
        history: vi.fn().mockResolvedValue({ result: { ok: true, value: { events, hasMore: false } } }),
      } as never,
    )
    const fallback = {
      productKind: 'personal' as const, businessCategory: '', name: '', description: '', basePresetId: 'standard',
      role: '', goal: '', behavior: '', instructions: '', preferredSkillNames: [],
    }

    expect(await runtime.detectCompletedAuthoringSession(sessionId)).toBe(false)
    expect(runtime.currentAuthoringSessionId()).toBeNull()

    running = false
    expect(await runtime.detectCompletedAuthoringSession(sessionId)).toBe(true)
    expect(runtime.currentAuthoringSessionId()).toBe(sessionId)
    runtime.beginAgentCenterBrowse()
    expect(runtime.currentAuthoringSessionId()).toBeNull()
    runtime.resumeSelectedAuthoringSession()
    expect(runtime.currentAuthoringSessionId()).toBe(sessionId)
    await expect(runtime.resumeAuthoringSession(sessionId, fallback, [])).resolves.toMatchObject({
      sessionId,
      cursor: 13,
      draft: { name: '需求澄清助手', role: '澄清需求', goal: '形成明确需求', behavior: '每次只问一个问题' },
    })
    runtime.dispose()
  })

  it('serializes one authoring Session while allowing independent Sessions to progress', async () => {
    let releaseFirst: (() => void) | undefined
    const sealAuthoringSession = vi.fn().mockImplementation(async ({ sessionId }: { readonly sessionId: string }) => {
      if (sessionId === 'session-a') await new Promise<void>(resolve => { releaseFirst = resolve })
      return { ok: true, value: { sessionId, agentPreset: 'cordis', sealed: true } }
    })
    const runtime = new AgentCenterRuntime(
      null,
      {
        listAudit: vi.fn().mockResolvedValue({ ok: true, value: { migrations: [], verifications: [] } }),
        migrationPlan: vi.fn().mockResolvedValue({ ok: true, value: null }),
        sealAuthoringSession,
        prepareAuthoringTurn: vi.fn().mockImplementation(async ({ sessionId }: { readonly sessionId: string }) => {
          throw new Error(`stop-${sessionId}`)
        }),
      } as never,
      { list: { getSnapshot: () => ({ current: undefined, byId: {} }), subscribe: () => () => {} } } as never,
      { list: { getSnapshot: () => ({ items: [], recentWorkspaceId: undefined }), subscribe: () => () => {} } } as never,
      { input: { for: () => ({ setDraft: vi.fn() }) } } as never,
      {} as never,
    )
    const draft = {
      productKind: 'personal' as const, businessCategory: '', name: '', description: 'Concurrent authoring',
      basePresetId: 'standard', role: '', goal: '', behavior: '', instructions: '', preferredSkillNames: [],
    }
    const first = runtime.author({ sessionId: 'session-a', draft, prompt: 'first', skills: [], locale: 'en' })
    await expect(runtime.author({ sessionId: 'session-a', draft, prompt: 'duplicate', skills: [], locale: 'en' }))
      .rejects.toThrow('这个会话')
    await expect(runtime.author({ sessionId: 'session-b', draft, prompt: 'second', skills: [], locale: 'en' }))
      .rejects.toThrow('stop-session-b')
    expect(sealAuthoringSession).toHaveBeenCalledWith({ sessionId: 'session-b' })
    releaseFirst?.()
    await expect(first).rejects.toThrow('stop-session-a')
    runtime.dispose()
  })

  it('opens native advanced configuration and prevents Skill selection for Minimal', async () => {
    const fixture = services(); const openAdvanced = vi.fn(() => true)
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={openAdvanced} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Advanced configuration' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Advanced configuration' }))
    expect(openAdvanced).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    expect(screen.getByRole('dialog', { name: 'Start with one sentence' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('What Agent do you want to create?'), { target: { value: 'Help me review short documents' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start creating' }))
    fireEvent.change(screen.getByLabelText('Base mode'), { target: { value: 'minimal' } })
    expect(screen.getByLabelText('Base mode')).toHaveValue('minimal')
    fireEvent.click(screen.getByRole('button', { name: /Session Skills \(optional\)/ }))
    expect(screen.getByText(/Minimal mode does not enable Session Skills/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Session-injected Skills' })).toBeDisabled()
  })

  it('shows platform modes and business Agents without explanatory category copy', async () => {
    const fixture = services()
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    fireEvent.click(screen.getByRole('tab', { name: 'Platform modes' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Standard' })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Platform modes' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Business Agents' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByText(/General, PDM, and AIM are business categories/)).toBeNull()
    expect(screen.queryByText(/Category is not mode/)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Business Agents' }))
    expect(screen.getByText('No Business Agents yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Platform modes' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy and edit' })[0]!)
    expect(screen.getByRole('region', { name: 'Create Agent' })).toBeInTheDocument()
    expect(screen.getByLabelText('Base mode')).toHaveValue('standard')
    expect(screen.getByText(/official original stays unchanged/)).toBeInTheDocument()
  })

  it('persists an edited official copy through the native Preset copy and personal profile services', async () => {
    const fixture = services()
    const presetApi = api()
    let copiedPresetId = ''
    vi.mocked(presetApi.copy).mockImplementation(async payload => {
      copiedPresetId = payload.agentPreset
      return { result: { ok: true, value: { agentPreset: payload.agentPreset } } }
    })
    vi.mocked(presetApi.list).mockImplementation(async () => ({ result: { ok: true, value: {
      ...roster,
      presets: copiedPresetId === '' ? roster.presets : [...roster.presets, { id: copiedPresetId, trust: 'user' as const, isDefault: false, name: 'Standard · My version' }],
    } } }))
    fixture.profiles.saveProfile.mockImplementation(async input => ({ ok: true, value: {
      ...input, revision: 1, configVersion: 'v1-test', updatedAt: 1, health: 'healthy' as const,
    } }))
    render(<AgentCenterSection close={() => {}} api={presetApi} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    fireEvent.click(screen.getByRole('tab', { name: 'Platform modes' }))
    await screen.findByRole('heading', { name: 'Standard' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy and edit' })[0]!)
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Product analyst' } })
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Deliver validated product analysis' } })
    fireEvent.change(screen.getByLabelText('Behavior'), { target: { value: 'Use evidence and state uncertainty' } })
    expect(screen.queryByRole('searchbox', { name: 'Search session Skills' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Session Skills \(optional\)/ }))
    expect(screen.getByText(/Only selected Skills enter new conversations/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Data 1' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search session Skills' }), { target: { value: 'Excel' } })
    expect(screen.getByRole('checkbox', { name: /spreadsheet-inspector/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /web-research/ })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: /spreadsheet-inspector/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Selected 1' }))
    expect(screen.getByRole('checkbox', { name: /spreadsheet-inspector/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Save Personal Agent' }))
    await waitFor(() => expect(presetApi.copy).toHaveBeenCalledWith(expect.objectContaining({ from: 'standard' })))
    expect(fixture.profiles.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      presetId: copiedPresetId,
      basePresetId: 'standard',
      role: 'Product analyst',
      preferredSkillNames: ['spreadsheet-inspector'],
      productKind: 'personal',
    }))
  })

  it('creates a classified Business Agent through the native Preset and Profile services', async () => {
    const fixture = services()
    const presetApi = api()
    let copiedPresetId = ''
    let savedProfile: typeof profile & { productKind: 'business'; businessCategory: string; businessCategoryId: string } | undefined
    vi.mocked(presetApi.copy).mockImplementation(async payload => {
      copiedPresetId = payload.agentPreset
      return { result: { ok: true, value: { agentPreset: payload.agentPreset } } }
    })
    vi.mocked(presetApi.list).mockImplementation(async () => ({ result: { ok: true, value: {
      ...roster,
      presets: copiedPresetId === '' ? roster.presets : [...roster.presets, { id: copiedPresetId, trust: 'user' as const, isDefault: false, name: 'PDM Assistant' }],
    } } }))
    fixture.profiles.listProfiles.mockImplementation(async () => ({ ok: true, value: { profiles: savedProfile === undefined ? [profile] : [profile, savedProfile] } }))
    fixture.profiles.saveProfile.mockImplementation(async input => {
      savedProfile = {
        ...input, productKind: 'business', businessCategory: input.businessCategory ?? '',
        businessCategoryId: input.businessCategoryId ?? 'category-pdm', revision: 1,
        configVersion: 'v1-business', updatedAt: 2, health: 'healthy' as const,
      } as typeof savedProfile
      return { ok: true, value: savedProfile }
    })

    render(<AgentCenterSection close={() => {}} api={presetApi} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    fireEvent.click(screen.getByRole('tab', { name: 'Business Agents' }))
    expect(screen.getAllByRole('button', { name: 'Create Business Agent' })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Create Business Agent' })[1]!)
    expect(screen.getByRole('dialog', { name: 'Start with one sentence' })).toHaveAttribute('aria-modal', 'true')
    fireEvent.change(screen.getByLabelText('What Agent do you want to create?'), { target: { value: 'Maintain product decisions with evidence' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start creating' }))
    expect(screen.getByRole('region', { name: 'Create Agent' })).not.toHaveAttribute('aria-modal')
    await screen.findByText('Harness native configuration conversation connected')
    await waitFor(() => expect(fixture.runtime.watchAuthoringSession).toHaveBeenCalledWith(
      'session-authoring', 3, expect.any(Array), expect.any(Object),
    ))
    expect(fixture.runtime.author).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: null,
      prompt: 'Maintain product decisions with evidence',
    }))
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'PDM Assistant' } })
    fireEvent.change(screen.getByLabelText('Business category'), { target: { value: 'Product & PDM' } })
    fixture.emitAuthoringTurn({
      sessionId: 'session-authoring',
      turn: 2,
      endSeq: 7,
      text: 'I reviewed the business context and proposed a focused PDM brief.',
      proposal: { role: 'PDM analyst', goal: 'Maintain product decisions', behavior: 'Use product evidence' },
    })
    await waitFor(() => expect(screen.getByLabelText('Role')).toHaveValue('PDM analyst'))
    expect(screen.getByLabelText('Goal')).toHaveValue('Maintain product decisions')
    expect(screen.getByLabelText('Behavior')).toHaveValue('Use product evidence')
    const draftReview = screen.getByRole('region', { name: 'Agent draft ready' })
    expect(within(draftReview).getByText(/prefilled 3 suggested changes/)).toBeInTheDocument()
    expect(within(draftReview).getByLabelText('Updated fields')).toHaveTextContent('RoleGoalBehavior')
    expect(screen.getByRole('button', { name: 'Save Business Agent' })).toBeDisabled()
    fireEvent.click(within(draftReview).getByRole('button', { name: 'Confirm and apply' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Business Agent' }))

    await waitFor(() => expect(presetApi.copy).toHaveBeenCalledWith(expect.objectContaining({ from: 'standard' })))
    expect(fixture.profiles.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      presetId: copiedPresetId, productKind: 'business', businessCategory: 'Product & PDM', basePresetId: 'standard',
    }))
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Center' }))
    expect(await screen.findByRole('heading', { name: 'PDM Assistant' })).toBeInTheDocument()
    expect(screen.getByText('Business Agent · Locally managed')).toBeInTheDocument()
    const businessCard = screen.getByRole('heading', { name: 'PDM Assistant' }).closest('[data-paimind-agent-card]')
    expect(businessCard).toHaveAttribute('data-paimind-agent-id', copiedPresetId)
    const businessAvatarSeat = within(businessCard as HTMLElement).getByRole('img', { name: 'PDM Assistant avatar' })
    expect(businessAvatarSeat).toHaveAttribute('data-paimind-agent-id', copiedPresetId)
    expect(businessAvatarSeat).toHaveAttribute('data-paimind-agent-avatar-kind', 'business')
    expect(screen.getByRole('combobox', { name: 'Business category' })).toHaveValue('all')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const builder = screen.getByRole('region', { name: 'Edit Agent' })
    expect(builder).toBeInTheDocument()
    expect(within(builder).getByRole('combobox', { name: 'Business category' })).toHaveValue('Product & PDM')
    fireEvent.click(screen.getByRole('button', { name: 'Back to Center' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }))
    await waitFor(() => expect(fixture.runtime.start).toHaveBeenCalledWith(
      copiedPresetId, expect.objectContaining({ productKind: 'business', businessCategory: 'Product & PDM' }),
    ))
  })

  it('opens the same purpose-first creation flow from a main-conversation creator request', async () => {
    const fixture = services()
    const surface = new PaimindProductSurfaceController('agent-center', window, document)
    const builderRequests = new PaimindAgentBuilderRequestController(surface, window)
    render(<AgentCenterSection
      close={() => {}}
      api={api()}
      profiles={fixture.profiles as never}
      skills={fixture.skills as never}
      runtime={fixture.runtime as never}
      locale={locale()}
      openAdvanced={() => true}
      builderRequests={builderRequests}
    />)
    await screen.findByRole('heading', { name: 'Research Agent' })

    requestPaimindAgentBuilder({ productKind: 'personal', brief: 'Review contracts and list business risks' }, window)

    expect(await screen.findByRole('dialog', { name: 'Start with one sentence' })).toBeInTheDocument()
    expect(screen.getByLabelText('What Agent do you want to create?')).toHaveValue('Review contracts and list business risks')
    expect(screen.getByRole('tab', { name: 'My Agents' })).toHaveAttribute('aria-selected', 'true')
    builderRequests.dispose()
    surface.dispose()
  })

  it('gates Test Chat and passes the same edited Preset to the runtime adapter without copying', async () => {
    const fixture = services()
    const presetApi = api()
    const onNativeConversationChange = vi.fn()
    fixture.profiles.saveProfile.mockImplementation(async input => ({ ok: true, value: {
      ...input,
      revision: 2,
      configVersion: 'v2-saved',
      updatedAt: 2,
      health: 'healthy' as const,
    } }))
    render(<AgentCenterSection close={() => {}} api={presetApi} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} onNativeConversationChange={onNativeConversationChange} />)
    await screen.findByRole('tab', { name: 'My Agents' })
    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    fireEvent.click(screen.getByRole('tab', { name: 'Test chat' }))
    expect(screen.queryByText('Save the Agent configuration first')).toBeNull()
    await waitFor(() => expect(fixture.runtime.beginTest).toHaveBeenCalledWith('mine', profile))
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenCalledWith({ sessionId: 'session-test', interactive: true }))
    expect(screen.getByText('Harness native test conversation connected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Configuration chat' }))
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Senior research reviewer' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Test chat' }))
    expect(screen.getByText('Save the Agent configuration first')).toBeInTheDocument()
    expect(screen.getByText('Test Chat runs the exact saved Agent Preset.')).toBeInTheDocument()
    expect(onNativeConversationChange).toHaveBeenLastCalledWith({ sessionId: null, interactive: false })

    fireEvent.click(screen.getByRole('tab', { name: 'Configuration chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Personal Agent' }))
    await waitFor(() => expect(fixture.profiles.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'mine',
      presetId: 'mine',
      basePresetId: 'standard',
      expectedVersion: 'v1-a',
    })))
    expect(presetApi.copy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('tab', { name: 'Test chat' }))
    await waitFor(() => expect(fixture.runtime.beginTest).toHaveBeenLastCalledWith(
      'mine', expect.objectContaining({ presetId: 'mine', configVersion: 'v2-saved' }),
    ))
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenCalledWith({ sessionId: 'session-test', interactive: true }))
    expect(fixture.runtime.test).not.toHaveBeenCalled()
  })

  it('declares one combined Center surface with Remote, Workspace, and conversation dependencies', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'sessions', 'workspaces', 'conversation'])
  })

  it('mounts inside the native center column, keeps the sidebar interactive, and restores the conversation', async () => {
    const fixture = services()
    const onBrowse = vi.fn()
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    const center = document.createElement('main')
    const nativeConversation = document.createElement('div')
    nativeConversation.dataset.slot = 'conversation'
    nativeConversation.append(document.createElement('section'))
    center.append(nativeConversation)
    document.body.append(center)
    render(<>
      <AgentCenterTrigger wide controller={controller} locale={locale()} onBrowse={onBrowse} />
      <AgentCenterSurface controller={controller} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />
    </>)
    const trigger = screen.getByRole('button', { name: 'Open Agent Center' })
    expect(trigger.querySelector('svg')).not.toBeNull()
    fireEvent.click(trigger)
    expect(onBrowse).toHaveBeenCalledOnce()
    const surface = await screen.findByRole('main', { name: 'Agent Center' })
    expect(center).toContainElement(surface)
    expect(surface.parentElement).toBe(center)
    expect(trigger).toHaveAttribute('aria-current', 'page')
    expect(trigger).not.toHaveAttribute('inert')
    expect(nativeConversation).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(screen.queryByRole('main', { name: 'Agent Center' })).toBeNull()
    expect(nativeConversation).not.toHaveAttribute('inert')
    expect(nativeConversation).not.toHaveAttribute('aria-hidden')
    controller.dispose()
  })

  it('releases the Center surface when native Shell navigation is activated', async () => {
    const fixture = services()
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    const center = document.createElement('main')
    const nativeConversation = document.createElement('div')
    nativeConversation.dataset.slot = 'conversation'
    nativeConversation.append(document.createElement('section'))
    center.append(nativeConversation)
    document.body.append(center)
    const navigate = vi.fn()
    render(<>
      <button type="button" onClick={navigate}>Dollar General workspace</button>
      <AgentCenterTrigger wide controller={controller} locale={locale()} />
      <AgentCenterSurface controller={controller} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />
    </>)

    fireEvent.click(screen.getByRole('button', { name: 'Open Agent Center' }))
    await screen.findByRole('main', { name: 'Agent Center' })
    expect(nativeConversation).toHaveAttribute('inert')

    const workspace = screen.getByRole('button', { name: 'Dollar General workspace' })
    workspace.focus()
    fireEvent.click(workspace)

    await waitFor(() => expect(screen.queryByRole('main', { name: 'Agent Center' })).toBeNull())
    expect(navigate).toHaveBeenCalledOnce()
    expect(workspace).toHaveFocus()
    expect(nativeConversation).not.toHaveAttribute('inert')
    expect(nativeConversation).not.toHaveAttribute('aria-hidden')
    controller.dispose()
  })

  it('releases the Center surface when native Shell navigation is activated', async () => {
    const fixture = services()
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    const center = document.createElement('main')
    const nativeConversation = document.createElement('div')
    nativeConversation.dataset.slot = 'conversation'
    nativeConversation.append(document.createElement('section'))
    center.append(nativeConversation)
    document.body.append(center)
    const navigate = vi.fn()
    render(<>
      <button type="button" onClick={navigate}>Dollar General workspace</button>
      <AgentCenterTrigger wide controller={controller} locale={locale()} />
      <AgentCenterSurface controller={controller} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />
    </>)

    fireEvent.click(screen.getByRole('button', { name: 'Open Agent Center' }))
    await screen.findByRole('main', { name: 'Agent Center' })
    expect(nativeConversation).toHaveAttribute('inert')

    const workspace = screen.getByRole('button', { name: 'Dollar General workspace' })
    workspace.focus()
    fireEvent.click(workspace)

    await waitFor(() => expect(screen.queryByRole('main', { name: 'Agent Center' })).toBeNull())
    expect(navigate).toHaveBeenCalledOnce()
    expect(workspace).toHaveFocus()
    expect(nativeConversation).not.toHaveAttribute('inert')
    expect(nativeConversation).not.toHaveAttribute('aria-hidden')
    controller.dispose()
  })

  it('closes only the starter or Builder on their first Escape inside the combined Center surface', async () => {
    const fixture = services()
    vi.mocked(fixture.runtime.currentAuthoringSessionId).mockImplementation(() => (
      fixture.runtime.currentSessionId() === 'session-authoring' ? 'session-authoring' : null
    ))
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    const center = document.createElement('main')
    const nativeConversation = document.createElement('div')
    nativeConversation.dataset.slot = 'conversation'
    const nativeContent = document.createElement('section')
    const contextRow = document.createElement('div')
    contextRow.dataset.chatFlowKind = 'context'
    contextRow.textContent = 'Context injection · skill-catalog'
    const thinkRow = document.createElement('div')
    thinkRow.dataset.variant = 'think'
    thinkRow.textContent = 'Think · hidden implementation reasoning'
    const assistantRow = document.createElement('div')
    assistantRow.dataset.chatFlowKind = 'assistant-step'
    const markdown = document.createElement('div')
    const visibleReply = document.createElement('p')
    visibleReply.textContent = 'I prepared a focused Agent brief for review.'
    const rawPayload = '\n<!--PAIMIND_AGENT_DRAFT\n{"name":"Internal draft name","goal":"Internal draft goal"}\n-->'
    markdown.append(visibleReply, document.createTextNode(rawPayload))
    assistantRow.append(markdown)
    nativeContent.append(contextRow, thinkRow, assistantRow)
    nativeConversation.append(nativeContent)
    center.append(nativeConversation)
    document.body.append(center)
    render(<>
      <AgentCenterTrigger wide controller={controller} locale={locale()} />
      <AgentCenterSurface controller={controller} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />
    </>)

    fireEvent.click(screen.getByRole('button', { name: 'Open Agent Center' }))
    await screen.findByRole('main', { name: 'Agent Center' })
    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    const starter = screen.getByRole('dialog', { name: 'Start with one sentence' })
    fireEvent.keyDown(starter, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Start with one sentence' })).toBeNull())
    expect(screen.getByRole('main', { name: 'Agent Center' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    fireEvent.change(screen.getByLabelText('What Agent do you want to create?'), { target: { value: 'Review a business workflow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start creating' }))
    const builder = screen.getByRole('region', { name: 'Create Agent' })
    expect(builder.closest('[data-paimind-agent-center]')).toHaveAttribute('data-builder-open', 'true')
    await screen.findByText('Harness native configuration conversation connected')
    await waitFor(() => expect(fixture.runtime.openSession).toHaveBeenCalledWith('session-authoring'))
    expect(center).toHaveAttribute('data-paimind-product-center-native-conversation')
    expect(nativeContent).toHaveAttribute('data-paimind-product-center-native-conversation-content')
    await waitFor(() => expect(markdown).toHaveTextContent('Draft synced to the brief. Review it before saving.'))
    expect(contextRow).toHaveAttribute('hidden')
    expect(thinkRow).toHaveAttribute('hidden')
    expect(contextRow.style.getPropertyValue('display')).toBe('none')
    expect(contextRow.style.getPropertyPriority('display')).toBe('important')
    expect(thinkRow.style.getPropertyValue('display')).toBe('none')
    expect(markdown).toHaveTextContent('I prepared a focused Agent brief for review.')
    expect(markdown).not.toHaveTextContent('PAIMIND_AGENT_DRAFT')
    expect(markdown).not.toHaveTextContent('Internal draft name')
    fireEvent.keyDown(builder, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Create Agent' })).toBeNull())
    await waitFor(() => expect(fixture.runtime.openSession).toHaveBeenCalledWith('session-origin'))
    expect(center).not.toHaveAttribute('data-paimind-product-center-native-conversation')
    expect(contextRow).not.toHaveAttribute('hidden')
    expect(thinkRow).not.toHaveAttribute('hidden')
    expect(contextRow.style.getPropertyValue('display')).toBe('')
    expect(thinkRow.style.getPropertyValue('display')).toBe('')
    expect(markdown).toHaveTextContent('PAIMIND_AGENT_DRAFT')
    expect(markdown.querySelector('[data-paimind-agent-draft-projection]')).toBeNull()
    expect(screen.getByRole('main', { name: 'Agent Center' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('main', { name: 'Agent Center' })).toBeNull())
    controller.dispose()
  })

  it('does not restore a stale authoring Session after the Center is closed and reopened', async () => {
    const fixture = services()
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    const center = document.createElement('main')
    const nativeConversation = document.createElement('div')
    nativeConversation.dataset.slot = 'conversation'
    nativeConversation.append(document.createElement('section'))
    center.append(nativeConversation)
    document.body.append(center)
    let authoringTurn = 0
    vi.mocked(fixture.runtime.author).mockImplementation(async ({ onSessionCreated }) => {
      authoringTurn += 1
      const sessionId = authoringTurn === 1 ? 'session-authoring-first' : 'session-authoring-second'
      fixture.runtime.openSession(sessionId)
      onSessionCreated?.(sessionId)
      return {
        sessionId, turn: 1, endSeq: 3,
        text: 'Draft ready', proposal: null,
      }
    })
    render(<>
      <AgentCenterTrigger wide controller={controller} locale={locale()} />
      <AgentCenterSurface controller={controller} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />
    </>)

    fireEvent.click(screen.getByRole('button', { name: 'Open Agent Center' }))
    await screen.findByRole('main', { name: 'Agent Center' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    fireEvent.change(screen.getByLabelText('What Agent do you want to create?'), { target: { value: 'Review a delivery promise' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start creating' }))
    const firstBuilder = await screen.findByRole('region', { name: 'Create Agent' })
    await waitFor(() => expect(fixture.runtime.currentSessionId()).toBe('session-authoring-first'))
    fireEvent.keyDown(firstBuilder, { key: 'Escape' })
    await waitFor(() => expect(fixture.runtime.currentSessionId()).toBe('session-origin'))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('main', { name: 'Agent Center' })).toBeNull())

    act(() => { fixture.runtime.openSession('session-second-origin') })
    act(() => { controller.open() })
    await screen.findByRole('main', { name: 'Agent Center' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    fireEvent.change(screen.getByLabelText('What Agent do you want to create?'), { target: { value: 'Review a second delivery promise' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start creating' }))
    const secondBuilder = await screen.findByRole('region', { name: 'Create Agent' })
    await waitFor(() => expect(fixture.runtime.currentSessionId()).toBe('session-authoring-second'))
    const backToCenter = within(secondBuilder).getByRole('button', { name: 'Back to Center' })
    await waitFor(() => expect(backToCenter).toBeEnabled())
    vi.mocked(fixture.runtime.openSession).mockClear()
    fireEvent.click(backToCenter)
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Create Agent' })).toBeNull())
    expect(fixture.runtime.currentSessionId()).toBe('session-second-origin')
    expect(fixture.runtime.openSession).not.toHaveBeenCalledWith('session-origin')
    controller.dispose()
  })

  it('keeps the starter modal focused, then makes Builder non-modal and restores the opening control on Escape', async () => {
    const fixture = services()
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await screen.findByRole('tab', { name: 'My Agents' })
    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    const trigger = screen.getByRole('button', { name: 'Create Personal Agent' })
    trigger.focus()
    fireEvent.click(trigger)
    const starter = screen.getByRole('dialog', { name: 'Start with one sentence' })
    await waitFor(() => expect(screen.getByLabelText('What Agent do you want to create?')).toHaveFocus())
    fireEvent.change(screen.getByLabelText('What Agent do you want to create?'), { target: { value: 'Help me focus' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start creating' }))
    const builder = screen.getByRole('region', { name: 'Create Agent' })
    expect(builder).not.toHaveAttribute('aria-modal')
    await screen.findByText('Harness native configuration conversation connected')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to Agent Center' })).toHaveFocus())
    expect(builder.querySelector('[data-paimind-agent-conversation-composer]')).toBeNull()
    fireEvent.keyDown(builder, { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('region', { name: 'Create Agent' })).toBeNull()
    expect(starter).not.toBeInTheDocument()
  })

  it('uses PAIMind tokens and includes responsive and reduced-motion treatments', () => {
    expect(AGENT_CENTER_STYLE).toContain('--paimind-canvas')
    expect(AGENT_CENTER_STYLE).toContain('--paimind-glass-strong')
    expect(AGENT_CENTER_STYLE).toMatch(/\[data-paimind-product-surface='agent-center'\][\s\S]*z-index: 80;/)
    expect(AGENT_CENTER_STYLE).toMatch(/\[data-paimind-product-surface='agent-center'\] \[data-paimind-agent-builder-layer\] \{[\s\S]*overflow: clip;/)
    expect(AGENT_CENTER_STYLE).toContain('grid-template-rows: auto auto auto minmax(0, 1fr) auto;')
    expect(AGENT_CENTER_STYLE).toMatch(/\[data-paimind-product-surface='agent-center'\] \[data-paimind-agent-skills-panel\] \{[\s\S]*height: max-content;[\s\S]*min-height: 76px;[\s\S]*display: grid;[\s\S]*overflow: clip;/)
    expect(AGENT_CENTER_STYLE).toContain('@media(max-width:680px)')
    expect(AGENT_CENTER_STYLE).toContain('@media(prefers-reduced-motion:reduce)')
    expect(AGENT_CENTER_STYLE).toContain('[data-paimind-agent-splitter]')
    expect(AGENT_CENTER_STYLE).toContain('cursor: col-resize;')
    expect(AGENT_CENTER_STYLE).toContain('[data-paimind-agent-avatar-seat]')
    expect(AGENT_CENTER_STYLE).toContain('[data-paimind-agent-avatar]')
  })

  it('registers only the native sidebar and shell overlay product surfaces', async () => {
    const fixture = services()
    const registered: string[] = []
    const disposers: Array<() => void | Promise<void>> = []
    const remote = {
      paimindSkillInstaller: fixture.skills,
      async $mount() { Object.assign(remote, { paimindAgentProfiles: fixture.profiles }); return () => {} },
    }
    const context = {
      remote,
      locale: locale(),
      sessions: { list: { getSnapshot: () => ({ current: undefined, byId: {}, jobsBySession: {} }), subscribe: () => () => {} }, open: () => {} },
      workspaces: { startSession: () => {} },
      conversation: { input: { for: () => ({ setDraft: () => {} }) } },
      get: () => ({ api: {
        agentPresets: api(),
        sessions: {
          create: vi.fn(), history: vi.fn(), prompt: vi.fn(), rename: vi.fn(), cancel: vi.fn(),
        },
      } }),
      reflect: { provide: () => () => {} },
      slots: {
        entries: () => [], subscribe: () => () => {}, getVersion: () => 0,
        inject(name: string, install: () => unknown) { const disposer = install(); registered.push(name); if (typeof disposer === 'function') disposers.push(disposer as () => void) },
        register: () => () => {},
      },
      effect(install: () => void | (() => void)) { const disposer = install(); if (typeof disposer === 'function') disposers.push(disposer) },
      inject(_dependencies: readonly string[], install: (scope: unknown) => void) {
        install(context)
        return Object.assign(Promise.resolve(), { dispose: async () => { for (const dispose of disposers.reverse()) await dispose() } })
      },
    }

    const dispose = await apply(context as never)
    expect(registered).toEqual(['paimind.extension', 'sidebar.footer.action', 'shell.overlay'])
    expect(registered).not.toContain('settings.section')
    expect(document.getElementById('@paimind/agent-market')).not.toBeNull()
    await dispose()
    expect(document.getElementById('@paimind/agent-market')).toBeNull()
  })
})
