import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HarnessAgentPresetApi, PaimindLocaleSource } from '@hansen/harness-compat'
import {
  PaimindAgentBuilderRequestController,
  PaimindProductSurfaceController,
  requestPaimindAgentBuilder,
  resolvePaimindAgentAvatarOverride,
} from '@hansen/harness-compat/client-surface'
import {
  AgentCenterRuntime,
  AgentCenterSection,
  AgentCenterSurface,
  AgentCenterTrigger,
  PAIMIND_USER_SKILL_POLICY_CHANGED_EVENT,
  PaimindAgentAuthoringPolicyController,
  PaimindPolicyAwareAgentBuilderRequestController,
  apply,
  inject,
  installAgentAuthoringSessionNavigation,
  starterPromptForProfile,
} from '../src/client/index.js'
import { AGENT_CENTER_STYLE } from '../src/client/styles.js'
import { authoringProposalFromHistoryEvents } from '../src/client/authoring-session.js'

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

function mutableAuthoringPolicy(initial: boolean) {
  let snapshot = Object.freeze({ status: 'ready' as const, enabled: initial, policyRevision: 1 })
  const listeners = new Set<() => void>()
  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    set(enabled: boolean) {
      snapshot = Object.freeze({ status: 'ready' as const, enabled, policyRevision: snapshot.policyRevision + 1 })
      for (const listener of [...listeners]) listener()
    },
  }
}

it('reads the reviewed Agent proposal only from the scoped Creator Tool result', () => {
  const proposal = authoringProposalFromHistoryEvents([
    { type: 'user/message', seq: 10, data: { source: { kind: 'user' } } },
    { type: 'tool/call', seq: 11, data: { callId: 'other', name: 'ask_user_question' } },
    { type: 'tool/result', seq: 12, data: { message: { source: { callId: 'other' }, content: [{ type: 'text', text: '<!--PAIMIND_AGENT_DRAFT\n{"name":"Ignore"}\n-->' }] } } },
    { type: 'tool/call', seq: 13, data: { callId: 'prepare', name: 'paimind_agent_prepare_create' } },
    { type: 'tool/result', seq: 14, data: { message: { source: { callId: 'prepare' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: '<!--PAIMIND_AGENT_DRAFT\n{"name":"Research Agent","role":"Researcher","goal":"Find facts","behavior":"Cite sources","description":"","instructions":"","preferredSkillNames":["web-research"]}\n-->' }] }] } } },
    { type: 'turn/end', seq: 15, data: { turn: 1 } },
  ], 10, 15)

  expect(proposal).toEqual({
    name: 'Research Agent', role: 'Researcher', goal: 'Find facts', behavior: 'Cite sources',
    description: '', instructions: '', preferredSkillNames: ['web-research'],
  })
})

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
      saveProfile: vi.fn(), setDefault: vi.fn(), removeProfile: vi.fn().mockResolvedValue({ ok: true, value: { presetId: 'mine', removed: true } }), sealAuthoringSession: vi.fn(), prepareAuthoringTurn: vi.fn().mockResolvedValue({ ok: true, value: { sessionId: 'session-authoring', prepared: true } }), bindSession: vi.fn(), listSessionBindings: vi.fn().mockResolvedValue({ ok: true, value: { bindings: [] } }), migrationPlan: vi.fn(), recordMigration: vi.fn(), verifySession: vi.fn(), listAudit: vi.fn(),
    },
    skills: {
      listInstalled: vi.fn().mockResolvedValue({ ok: true, value: { items: [
        { name: 'web-research', description: 'Search official documentation and cite sources' },
        { name: 'spreadsheet-inspector', description: 'Analyze Excel data and anomalies' },
        { name: 'ppt-master', description: 'Build presentations from evidence' },
      ] } }),
      getUserSkillPolicy: vi.fn().mockResolvedValue({ ok: true, value: {
        schema: 'paimind.user-skill-policy/v1', revision: 1,
        enabledOptionalSystemSkillNames: ['paimind-agent-authoring'],
        enabledBusinessSkillNames: [], directBusinessSkillNames: [],
      } }),
    },
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
      prepareAuthoringSession: vi.fn().mockImplementation(async ({ onSessionCreated }: { readonly onSessionCreated?: (sessionId: string) => void }) => {
        onSessionCreated?.('session-authoring')
        return { sessionId: 'session-authoring', cursor: -1 }
      }),
      prepareAuthoringContext: vi.fn().mockResolvedValue(undefined),
      suppressAutomaticMigration: vi.fn(() => vi.fn()),
      watchAuthoringSession: vi.fn((_sessionId, _afterSeq, _skills, callbacks) => {
        authoringWatch = callbacks
        return () => { authoringWatch = null }
      }),
      beginTest: vi.fn().mockResolvedValue('session-test'),
      listTestSessions: vi.fn().mockResolvedValue([]),
      readTestHistory: vi.fn().mockResolvedValue({ ok: true, value: { events: [
        { event: { type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Check the earlier prompt' }] } } },
        { event: { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: 'The earlier reply' }] } } } },
        { event: { type: 'agent/error', seq: 3, data: { error: { message: 'Original test failure' } } } },
      ], hasMore: false } }),
      retireTestSession: vi.fn().mockResolvedValue(undefined),
      test: vi.fn().mockResolvedValue('session-test'),
      sessionState: vi.fn(() => ({ running: true, completed: false, error: null })),
      subscribeSessions: vi.fn(listener => {
        sessionListeners.add(listener)
        return () => { sessionListeners.delete(listener) }
      }),
      detectCompletedAuthoringSession: vi.fn(async (sessionId: string) => sessionId.startsWith('paimind-authoring-')),
      currentAuthoringSessionId: vi.fn(() => currentSessionId?.startsWith('paimind-authoring-') ? currentSessionId : null),
      beginAgentCenterBrowse: vi.fn(),
      suppressNextAuthoringSessionRoute: vi.fn(),
      consumeAuthoringSessionRouteSuppression: vi.fn(() => false),
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
    emitAuthoringRunning() {
      if (authoringWatch === null) throw new Error('Authoring watcher is not connected')
      act(() => { authoringWatch?.onRunning?.() })
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
  document.head.querySelectorAll('style[data-paimind-plugin="@hansen/agent-market"]').forEach(node => { node.remove() })
})

describe('Agent Center business UI', () => {
  it('keeps saved portraits available while the Center is closed and clears them when the plugin surface unmounts', async () => {
    const fixture = services()
    fixture.profiles.listProfiles.mockResolvedValue({ ok: true, value: { profiles: [{ ...profile, presetId: 'native-mine', avatarId: 'research-partner' }] } })
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    const view = render(<AgentCenterSurface controller={controller} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    expect(controller.getSnapshot().open).toBe(false)
    await waitFor(() => expect(resolvePaimindAgentAvatarOverride('native-mine')).toBe('research-partner'))
    expect(resolvePaimindAgentAvatarOverride('mine')).toBe('mine')
    fixture.profiles.listProfiles.mockResolvedValue({ ok: true, value: { profiles: [{ ...profile, presetId: 'native-mine', avatarId: 'finance-planner' }] } })
    fireEvent.focus(window)
    await waitFor(() => expect(resolvePaimindAgentAvatarOverride('native-mine')).toBe('finance-planner'))
    view.unmount()
    expect(resolvePaimindAgentAvatarOverride('native-mine')).toBe('native-mine')
    controller.dispose()
  })

  it('stacks the shared footer actions in expanded and collapsed sidebars', () => {
    expect(AGENT_CENTER_STYLE).toContain("button[data-paimind-product-trigger='agent-center'][data-wide='true'])")
    expect(AGENT_CENTER_STYLE).toContain("button[data-paimind-product-trigger='agent-center'][data-wide='false'])")
    expect(AGENT_CENTER_STYLE).toContain('width: 100% !important;')
    expect(AGENT_CENTER_STYLE).toContain('width: 36px !important;')
    expect(AGENT_CENTER_STYLE).toContain("body[data-paimind-agent-test-session-active] [data-slot='sidebar.workspaces'] [role='treeitem'][aria-selected='true']")
  })

  it('keeps universal Create Agent in Chat until a valid draft completes, then opens the Center once', async () => {
    let current: string | null = 'ordinary-session'
    const byId: Record<string, { running: boolean; agentPreset?: string }> = {
      'ordinary-session': { running: false, agentPreset: 'standard' },
    }
    const completed = new Set<string>()
    let suppressedRoute: string | null = null
    const listeners = new Set<() => void>()
    const runtime = {
      currentSessionId: () => current,
      subscribeSessions: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      detectCompletedAuthoringSession: vi.fn(async (sessionId: string) => (
        byId[sessionId]?.agentPreset === 'standard'
        && (sessionId.startsWith('paimind-authoring-') || completed.has(sessionId))
      )),
      consumeAuthoringSessionRouteSuppression: vi.fn((sessionId: string) => {
        if (suppressedRoute !== sessionId) return false
        suppressedRoute = null
        return true
      }),
    }
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    const dispose = installAgentAuthoringSessionNavigation(runtime as never, controller)
    const authoringSessionId = 'paimind-authoring-123e4567-e89b-42d3-a456-426614174000'

    expect(controller.getSnapshot().open).toBe(false)
    byId[authoringSessionId] = { running: false, agentPreset: 'standard' }
    current = authoringSessionId
    listeners.forEach(listener => { listener() })
    await waitFor(() => expect(controller.getSnapshot().open).toBe(true))

    controller.close(false)
    listeners.forEach(listener => { listener() })
    expect(controller.getSnapshot().open).toBe(false)

    current = 'ordinary-session'
    listeners.forEach(listener => { listener() })
    suppressedRoute = authoringSessionId
    current = authoringSessionId
    listeners.forEach(listener => { listener() })
    await waitFor(() => expect(runtime.consumeAuthoringSessionRouteSuppression).toHaveBeenCalledWith(authoringSessionId))
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
    byId[universalSessionId] = { running: false, agentPreset: 'standard' }
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

  it('refreshes Agent authoring eligibility from the Skill Center policy event', async () => {
    let enabled = false
    let revision = 1
    const getUserSkillPolicy = vi.fn(async () => ({ ok: true as const, value: {
      schema: 'paimind.user-skill-policy/v1' as const,
      revision,
      enabledOptionalSystemSkillNames: enabled ? ['paimind-agent-authoring'] : [],
      enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    } }))
    const policy = new PaimindAgentAuthoringPolicyController({ listInstalled: vi.fn(), getUserSkillPolicy } as never, window)

    await waitFor(() => expect(policy.getSnapshot()).toMatchObject({ status: 'ready', enabled: false, policyRevision: 1 }))
    enabled = true
    revision = 2
    window.dispatchEvent(new CustomEvent(PAIMIND_USER_SKILL_POLICY_CHANGED_EVENT))

    await waitFor(() => expect(policy.getSnapshot()).toMatchObject({ status: 'ready', enabled: true, policyRevision: 2 }))
    expect(getUserSkillPolicy).toHaveBeenCalledTimes(2)
    policy.dispose()
  })

  it('recovers authoring after a transient policy failure using the same policy owner', async () => {
    const getUserSkillPolicy = vi.fn().mockRejectedValueOnce(new Error('not ready')).mockResolvedValue({ ok: true, value: {
      schema: 'paimind.user-skill-policy/v1', revision: 2,
      enabledOptionalSystemSkillNames: ['paimind-agent-authoring'], enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    } })
    const policy = new PaimindAgentAuthoringPolicyController({ listInstalled: vi.fn(), getUserSkillPolicy } as never, window)
    await waitFor(() => expect(policy.getSnapshot().status).toBe('error'))
    await policy.refresh()
    expect(policy.getSnapshot()).toMatchObject({ status: 'ready', enabled: true, policyRevision: 2 })
    policy.dispose()
  })

  it('does not receive creator requests or auto-route stale drafts while Agent authoring is disabled', async () => {
    const authoringPolicy = mutableAuthoringPolicy(false)
    const surface = new PaimindProductSurfaceController('agent-center', window, document)
    const builderRequests = new PaimindPolicyAwareAgentBuilderRequestController(surface, authoringPolicy.source, window)
    requestPaimindAgentBuilder({ productKind: 'personal', brief: 'Create a contract reviewer' }, window)
    // The shared helper may still open the generic Center surface, but the
    // disabled receiver must not retain or start an authoring request.
    expect(surface.getSnapshot().open).toBe(true)
    expect(builderRequests.getSnapshot().revision).toBe(0)
    surface.close(false)

    let current: string | null = 'paimind-authoring-old-session'
    const sessionListeners = new Set<() => void>()
    const runtime = {
      currentSessionId: () => current,
      subscribeSessions: (listener: () => void) => { sessionListeners.add(listener); return () => { sessionListeners.delete(listener) } },
      detectCompletedAuthoringSession: vi.fn().mockResolvedValue(true),
      consumeAuthoringSessionRouteSuppression: vi.fn(() => false),
    }
    const disposeNavigation = installAgentAuthoringSessionNavigation(runtime as never, surface, authoringPolicy.source)
    expect(surface.getSnapshot().open).toBe(false)
    expect(runtime.detectCompletedAuthoringSession).not.toHaveBeenCalled()

    act(() => { authoringPolicy.set(true) })
    expect(surface.getSnapshot().open).toBe(false)
    current = 'ordinary-session'
    sessionListeners.forEach(listener => { listener() })
    current = 'paimind-authoring-old-session'
    sessionListeners.forEach(listener => { listener() })
    await waitFor(() => expect(surface.getSnapshot().open).toBe(true))

    surface.close(false)
    act(() => { authoringPolicy.set(false) })
    requestPaimindAgentBuilder({ productKind: 'business' }, window)
    expect(surface.getSnapshot().open).toBe(true)
    expect(builderRequests.getSnapshot().revision).toBe(0)

    disposeNavigation()
    builderRequests.dispose()
    surface.dispose()
  })

  it('hides new authoring entry points while preserving existing Agent browse and edit', async () => {
    const fixture = services()
    const authoringPolicy = mutableAuthoringPolicy(false)
    const disabledBuilderRequest = Object.freeze({ revision: 1, productKind: 'personal' as const, brief: 'Create a new reviewer' })
    const builderRequests = { getSnapshot: () => disabledBuilderRequest, subscribe: () => () => {} }
    render(<AgentCenterSection
      close={() => {}}
      api={api()}
      profiles={fixture.profiles as never}
      skills={fixture.skills as never}
      runtime={fixture.runtime as never}
      locale={locale()}
      openAdvanced={() => true}
      authoringPolicy={authoringPolicy.source}
      builderRequests={builderRequests}
    />)
    await screen.findByRole('heading', { name: 'Research Agent' })

    expect(screen.queryByRole('button', { name: 'Create Personal Agent' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Start conversation' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Start with one sentence' })).toBeNull()
    expect(fixture.runtime.author).not.toHaveBeenCalled()

    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()

  })

  it('reopens the dual-pane Builder when an existing authoring Session is selected', async () => {
    const fixture = services()
    const close = vi.fn()
    vi.mocked(fixture.runtime.sessionState).mockReturnValue({ running: false, completed: true, error: null })
    render(<AgentCenterSection close={close} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
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
    const readyStatus = (await screen.findByText('Creation assistant is ready')).closest('[role="status"]')
    expect(readyStatus).not.toBeNull()
    expect(readyStatus?.querySelector('small')).toBeNull()
    expect(screen.queryByText(/Harness exclusively owns|native message timeline/)).toBeNull()

    const closeBuilder = within(builder).getByRole('button', { name: 'Close and return to conversation' })
    await waitFor(() => expect(closeBuilder).toBeEnabled())
    fireEvent.click(closeBuilder)
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Create Agent' })).toBeNull())
    expect(close).toHaveBeenCalledTimes(1)
    expect(fixture.runtime.resumeAuthoringSession).toHaveBeenCalledTimes(1)

    act(() => { fixture.runtime.openSession('session-origin') })
    act(() => { fixture.runtime.openSession(authoringSessionId) })
    await screen.findByRole('region', { name: 'Create Agent' })
    expect(fixture.runtime.resumeAuthoringSession).toHaveBeenCalledTimes(2)
  })

  it('reconnects a resumed authoring Session to its saved Profile instead of presenting a new unsaved draft', async () => {
    const fixture = services()
    const presetApi = api()
    const authoringSessionId = 'paimind-authoring-723e4567-e89b-42d3-a456-426614174000'
    const linkedProfile = {
      ...profile,
      authoringSessionId,
      authoringCursor: 13,
      name: 'Requirement Clarifier',
      description: 'Clarify one requirement at a time',
      role: 'Requirement analyst',
      goal: 'Produce an accepted brief',
      behavior: 'Ask one focused question',
    }
    fixture.profiles.listProfiles.mockResolvedValue({ ok: true, value: { profiles: [linkedProfile] } })
    vi.mocked(fixture.runtime.sessionState).mockReturnValue({ running: false, completed: true, error: null })
    fixture.runtime.openSession(authoringSessionId)
    render(<AgentCenterSection close={() => {}} api={presetApi} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await screen.findByRole('tab', { name: 'My Agents' })
    await screen.findByRole('heading', { name: 'Requirement Clarifier' })

    const builder = await screen.findByRole('region', { name: 'Edit Agent' })
    expect(within(builder).getByText('Saved')).toBeInTheDocument()
    expect(within(builder).queryByText('Unsaved draft')).toBeNull()
    expect(fixture.runtime.resumeAuthoringSession).toHaveBeenCalledWith(
      authoringSessionId,
      expect.objectContaining({ name: 'Requirement Clarifier', preferredSkillNames: ['web-research'] }),
      expect.any(Array),
      13,
    )
    expect(fixture.profiles.saveProfile).not.toHaveBeenCalled()
    expect(presetApi.copy).not.toHaveBeenCalled()
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
    await screen.findByText('Creation assistant is ready')
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

  it('shows only Business and My Agents while hiding internal modes, ids, and hashes', async () => {
    const fixture = services()
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Research Agent' })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'My Agents' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText(/preset id|hash|file path|config version/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Platform modes' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Standard' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Personal Agent creation assistant' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Create Personal Agent' })).toHaveLength(1)
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('returns from the Center through a visible conversation action', async () => {
    const fixture = services(); const close = vi.fn()
    render(<AgentCenterSection close={close} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    fireEvent.click(screen.getByRole('button', { name: 'Back to conversation' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('keeps the native creation foundation internal and routes Create into the existing builder', async () => {
    const fixture = services(); const openAdvanced = vi.fn(() => true)
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={openAdvanced} />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    expect(screen.queryByText(/Creator mode/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced configuration' }))
    expect(openAdvanced).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    expect(screen.getByRole('dialog', { name: 'Start with one sentence' })).toBeInTheDocument()
    expect(screen.getByLabelText('What Agent do you want to create?')).toBeInTheDocument()
    const examples = screen.getByRole('group', { name: 'Creation examples' })
    expect(within(examples).getAllByRole('button')).toHaveLength(4)
    fireEvent.click(within(examples).getByRole('button', { name: 'Create an Agent that helps me check delivery risks.' }))
    expect(screen.getByLabelText('What Agent do you want to create?')).toHaveValue('Create an Agent that helps me check delivery risks.')
    expect(screen.getByText(/only after you send it yourself/)).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(center.scrollTop).toBe(0))
    expect(screen.getByRole('region', { name: 'Create Agent' })).toBeInTheDocument()
    await waitFor(() => expect(fixture.runtime.prepareAuthoringSession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ prompt: 'Review a business workflow' })))
    expect(fixture.runtime.author).not.toHaveBeenCalled()
    expect(fixture.profiles.saveProfile).not.toHaveBeenCalled()
  })

  it('exposes canonical avatar seats for managed Agents without platform-mode cards', async () => {
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

    expect(screen.queryByRole('heading', { name: 'Standard' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Minimal' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Creator' })).toBeNull()
  })

  it('delegates a personal Agent launch to the runtime adapter', async () => {
    const fixture = services(); const close = vi.fn()
    render(<AgentCenterSection close={close} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'My Agents' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }))
    await waitFor(() => expect(fixture.runtime.start).toHaveBeenCalledWith('mine', profile))
    expect(close).toHaveBeenCalledWith(false)
  })

  it('creates, names, binds, and opens Test Chat as a native Harness Session', async () => {
    const rows: Record<string, { id: string; blank: boolean; agentPreset: string }> = {
      'session-origin': { id: 'session-origin', blank: true, agentPreset: 'standard' },
    }
    let current = 'session-origin'
    const listeners = new Set<() => void>()
    const sessions = {
      list: {
        getSnapshot: () => ({ current, byId: rows }),
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      open: vi.fn((sessionId: string) => { current = sessionId }),
      binding: () => ({ ctx: {}, session: { getSnapshot: () => ({ running: false }), subscribe: () => () => {} } }),
    }
    const workspaces = {
      list: { getSnapshot: () => ({ items: [], recentWorkspaceId: 'workspace-test' }) },
      archiveSession: vi.fn().mockResolvedValue(undefined),
      startSession: vi.fn(() => {
        rows['session-test-visible'] = { id: 'session-test-visible', blank: true, agentPreset: 'standard' }
        current = 'session-test-visible'
        listeners.forEach(listener => { listener() })
      }),
    }
    let selected = 'standard'
    const seat = {
      getSnapshot: () => ({ current: selected, error: null, busy: false }),
      select: vi.fn(async (presetId: string) => {
        selected = presetId
        rows[current]!.agentPreset = presetId
        listeners.forEach(listener => { listener() })
      }),
    }
    const bindSession = vi.fn().mockResolvedValue({ ok: true, value: {
      sessionId: 'session-test-visible', agentId: 'mine', presetId: 'mine', configVersion: 'v1-a', boundAt: 1,
    } })
    const create = vi.fn(async () => {
      rows['session-test-visible'] = { id: 'session-test-visible', blank: true, agentPreset: 'mine' }
      return { result: { ok: true, value: { sessionId: 'session-test-visible', agentPreset: 'mine' } } }
    })
    const rename = vi.fn().mockResolvedValue({ result: { ok: true, value: { title: 'Test · Research Agent', seq: 1 } } })
    const history = vi.fn().mockResolvedValue({ result: { ok: true, value: { events: [], hasMore: false } } })
    const runtime = new AgentCenterRuntime(
      seat as never,
      {
        bindSession,
        listSessionBindings: vi.fn().mockResolvedValue({ ok: true, value: { bindings: [{
          sessionId: 'session-test-visible', agentId: 'mine', presetId: 'mine', configVersion: 'v1-a', purpose: 'builder-test', boundAt: 1,
        }] } }),
        listAudit: vi.fn().mockResolvedValue({ ok: true, value: { migrations: [], verifications: [] } }),
        migrationPlan: vi.fn().mockResolvedValue({ ok: true, value: null }),
      } as never,
      sessions as never,
      workspaces as never,
      { input: { for: () => ({ setDraft: vi.fn() }) } } as never,
      { create, rename, history } as never,
    )

    await expect(runtime.beginTest('mine', profile)).resolves.toBe('session-test-visible')
    expect(workspaces.startSession).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith({ workspaceId: 'workspace-test', agentPreset: 'mine' }, expect.any(AbortSignal))
    expect(rows['session-test-visible']).toMatchObject({ agentPreset: 'mine' })
    expect(bindSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-test-visible', agentId: 'mine', presetId: 'mine', configVersion: 'v1-a', purpose: 'builder-test',
    }))
    await expect(runtime.listTestSessions('mine')).resolves.toEqual([expect.objectContaining({
      sessionId: 'session-test-visible', title: '新测试', boundAt: 1,
    })])
    expect(rename).not.toHaveBeenCalled()
    expect(sessions.open).toHaveBeenCalledWith('session-test-visible')
    await runtime.retireTestSession('session-test-visible')
    expect(workspaces.archiveSession).toHaveBeenCalledWith('session-test-visible')
    const controller = new AbortController()
    await expect(runtime.readTestHistory('mine', 'session-test-visible', 12, controller.signal)).resolves.toMatchObject({ ok: true })
    expect(history).toHaveBeenCalledWith({ sessionId: 'session-test-visible', maxMessages: 20, beforeSeq: 12 }, controller.signal)
    await expect(runtime.readTestHistory('other-agent', 'session-test-visible')).rejects.toThrow('不属于当前智能体')
    expect(history).toHaveBeenCalledOnce()
    runtime.dispose()
  })

  it('reclaims the current untouched blank Session when Harness deduplicates Test Chat creation', async () => {
    const rows: Record<string, { id: string; blank: boolean; agentPreset: string }> = {
      'session-test-previous': { id: 'session-test-previous', blank: true, agentPreset: 'mine' },
    }
    let current = 'session-test-previous'
    const listeners = new Set<() => void>()
    const notify = (): void => { listeners.forEach(listener => { listener() }) }
    const sessions = {
      list: {
        getSnapshot: () => ({ current, byId: rows }),
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      open: vi.fn((sessionId: string) => { current = sessionId; notify() }),
    }
    const workspaces = {
      startSession: vi.fn(() => {
        notify()
      }),
    }
    let selected = 'standard'
    const runtime = new AgentCenterRuntime(
      {
        getSnapshot: () => ({ current: selected, error: null, busy: false }),
        select: vi.fn(async (presetId: string) => {
          selected = presetId
          rows[current]!.agentPreset = presetId
          notify()
        }),
      } as never,
      {
        bindSession: vi.fn().mockImplementation(async input => ({ ok: true, value: { ...input, boundAt: 1 } })),
        listAudit: vi.fn().mockResolvedValue({ ok: true, value: { migrations: [], verifications: [] } }),
        migrationPlan: vi.fn().mockResolvedValue({ ok: true, value: null }),
      } as never,
      sessions as never,
      workspaces as never,
      { input: { for: () => ({ setDraft: vi.fn() }) } } as never,
    )

    await expect(runtime.beginTest('mine', profile)).resolves.toBe('session-test-previous')
    expect(workspaces.startSession).toHaveBeenCalledOnce()
    expect(rows['session-test-previous']).toMatchObject({ agentPreset: 'mine' })
    expect(sessions.open).toHaveBeenLastCalledWith('session-test-previous')
    runtime.dispose()
  })

  it('never reuses a dedicated Agent authoring Session as a conversation or Builder Test Chat', async () => {
    const authoringId = 'paimind-authoring-123e4567-e89b-42d3-a456-426614174000'
    const rows: Record<string, { id: string; blank: boolean; agentPreset: string }> = {
      [authoringId]: { id: authoringId, blank: true, agentPreset: 'standard' },
    }
    let current = authoringId
    const listeners = new Set<() => void>()
    const notify = (): void => { listeners.forEach(listener => { listener() }) }
    const sessions = {
      list: {
        getSnapshot: () => ({ current, byId: rows }),
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      open: vi.fn((sessionId: string) => { current = sessionId; notify() }),
    }
    const workspaces = {
      startSession: vi.fn(() => {
        rows['session-builder-test'] = { id: 'session-builder-test', blank: true, agentPreset: 'standard' }
        current = 'session-builder-test'
        notify()
      }),
    }
    let selected = 'standard'
    const bindSession = vi.fn().mockImplementation(async input => ({ ok: true, value: { ...input, boundAt: 1 } }))
    const runtime = new AgentCenterRuntime(
      {
        getSnapshot: () => ({ current: selected, error: null, busy: false }),
        select: vi.fn(async (presetId: string) => {
          selected = presetId
          rows[current]!.agentPreset = presetId
          notify()
        }),
      } as never,
      {
        bindSession,
        listAudit: vi.fn().mockResolvedValue({ ok: true, value: { migrations: [], verifications: [] } }),
        migrationPlan: vi.fn().mockResolvedValue({ ok: true, value: null }),
      } as never,
      sessions as never,
      workspaces as never,
      { input: { for: () => ({ setDraft: vi.fn() }) } } as never,
    )

    await expect(runtime.beginTest('mine', profile)).resolves.toBe('session-builder-test')
    expect(bindSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-builder-test', purpose: 'builder-test',
    }))
    expect(rows[authoringId]).toMatchObject({ agentPreset: 'standard', blank: true })
    runtime.dispose()
  })

  it('cancels an in-flight automatic migration when explicit Test Chat preparation takes ownership', async () => {
    let resolveAudit: ((value: unknown) => void) | null = null
    const listAudit = vi.fn(() => new Promise(resolve => { resolveAudit = resolve }))
    const migrationPlan = vi.fn().mockResolvedValue({ ok: true, value: {
      sourceSessionId: 'session-origin', agentId: 'mine', presetId: 'mine',
      fromVersion: 'v1-a', toVersion: 'v2-a', summary: 'migrate',
    } })
    const workspaces = { startSession: vi.fn() }
    const runtime = new AgentCenterRuntime(
      null,
      { listAudit, migrationPlan } as never,
      {
        list: {
          getSnapshot: () => ({ current: 'session-origin', byId: {
            'session-origin': { id: 'session-origin', blank: false, agentPreset: 'mine' },
          } }),
          subscribe: () => () => {},
        },
      } as never,
      workspaces as never,
      { input: { for: () => ({ setDraft: vi.fn() }) } } as never,
    )

    await waitFor(() => expect(listAudit).toHaveBeenCalledOnce())
    const release = runtime.suppressAutomaticMigration()
    resolveAudit?.({ ok: true, value: { migrations: [], verifications: [] } })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(migrationPlan).not.toHaveBeenCalled()
    expect(workspaces.startSession).not.toHaveBeenCalled()
    release()
    runtime.dispose()
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

  it.each(['personal', 'business'] as const)('prepares the %s native composer without submitting a model turn or saving an Agent', async productKind => {
    const prompt = 'Review delivery risks before making a promise'
    const draft = {
      productKind, businessCategory: '', name: '', description: prompt,
      basePresetId: 'standard', role: '', goal: '', behavior: '', instructions: '', preferredSkillNames: [],
    }
    const ctx = {}
    const setDraft = vi.fn()
    const inputFor = vi.fn(() => ({ setDraft }))
    const open = vi.fn()
    const sessionPrompt = vi.fn()
    const fixture = services()
    fixture.profiles.sealAuthoringSession.mockImplementation(async ({ sessionId }) => ({ ok: true, value: { sessionId, agentPreset: 'standard', sealed: true } }))
    fixture.profiles.prepareAuthoringTurn.mockImplementation(async ({ sessionId }) => ({ ok: true, value: { sessionId, prepared: true } }))
    const authoringApi = {
      create: vi.fn().mockImplementation(async ({ sessionId }) => ({ result: { ok: true, value: { sessionId, agentPreset: 'standard' } } })),
      history: vi.fn().mockResolvedValue({ result: { ok: true, value: { events: [], hasMore: false } } }),
      prompt: vi.fn(),
    }
    const runtime = new AgentCenterRuntime(null, fixture.profiles as never, {
      list: { getSnapshot: () => ({ current: undefined, byId: {} }), subscribe: () => () => {} },
      binding: () => open.mock.calls.length === 0 ? undefined : { ctx, session: { prompt: sessionPrompt } },
      open,
    } as never, {
      list: { getSnapshot: () => ({ items: [], recentWorkspaceId: 'workspace-recent' }) },
    } as never, { input: { for: inputFor } } as never, authoringApi as never)

    const prepared = await runtime.prepareAuthoringSession({ draft, prompt, skills: [], locale: 'en' })

    expect(authoringApi.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: prepared.sessionId, agentPreset: 'standard', workspaceId: 'workspace-recent',
    }), expect.any(AbortSignal))
    expect(fixture.profiles.sealAuthoringSession).toHaveBeenCalledWith({ sessionId: prepared.sessionId })
    expect(fixture.profiles.prepareAuthoringTurn).toHaveBeenCalledWith(expect.objectContaining({ sessionId: prepared.sessionId, draft }))
    expect(open).toHaveBeenCalledWith(prepared.sessionId)
    expect(inputFor).toHaveBeenCalledWith(ctx)
    expect(setDraft).toHaveBeenCalledExactlyOnceWith(prompt)
    expect(prepared.cursor).toBe(-1)
    expect(authoringApi.prompt).not.toHaveBeenCalled()
    expect(sessionPrompt).not.toHaveBeenCalled()
    expect(fixture.profiles.saveProfile).not.toHaveBeenCalled()

    // A failed scope check must not expose a second ready-to-send composer.
    fixture.profiles.sealAuthoringSession.mockResolvedValue({ ok: true, value: { sessionId: 'wrong-session', agentPreset: 'standard', sealed: true } })
    await expect(runtime.prepareAuthoringSession({ draft, prompt, skills: [], locale: 'en' })).rejects.toThrow('系统能力隔离')
    expect(setDraft).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledTimes(1)
    expect(authoringApi.prompt).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('adapts configuration turns to the native Standard Session API contract and parses only the model proposal', async () => {
    const events: Array<{ readonly event: { readonly type: string; readonly seq: number; readonly data?: unknown } }> = []
    const sessionListeners = new Set<() => void>()
    let nativeAuthoringSessionId: string | undefined
    let sessionSnapshot: { readonly lastAgentError: string | null; readonly partial: null | { readonly turn: number; readonly blocks: readonly { readonly kind: string; readonly text?: string }[] } } = { lastAgentError: null, partial: null }
    let turn = 0
    const authoringApi = {
      create: vi.fn().mockImplementation(async (payload: { readonly sessionId?: string }) => ({
        result: { ok: true, value: { sessionId: (nativeAuthoringSessionId = payload.sessionId), agentPreset: 'standard' } },
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
      ok: true, value: { sessionId, agentPreset: 'standard', sealed: true },
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
        list: { getSnapshot: () => ({ current: undefined, byId: nativeAuthoringSessionId === undefined ? {} : { [nativeAuthoringSessionId]: { running: false, agentPreset: 'standard' } } }), subscribe: () => () => {} },
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
      sessionId: expect.stringMatching(/^paimind-authoring-/), agentPreset: 'standard', workspaceId: 'workspace-recent',
    }), expect.any(AbortSignal))
    expect(authoringApi.rename).not.toHaveBeenCalled()
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
    })).resolves.toMatchObject({
      sessionId: first.sessionId,
      text: '',
      proposal: { name: '销售助手', role: '销售顾问' },
    })
    expect(authoringApi.prompt).toHaveBeenCalledTimes(3)
    await expect(runtime.resumeAuthoringSession(first.sessionId, draft, [])).resolves.toMatchObject({
      cursor: 33,
      draft: { name: '销售助手', role: '销售顾问' },
    })

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
    await expect(runtime.resumeAuthoringSession(first.sessionId, draft, []))
      .resolves.toMatchObject({ cursor: 42 })
    runtime.dispose()
  })

  it('ignores prompt markers and promotes an ordinary Session only from the real Tool result', async () => {
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
          getSnapshot: () => ({ current: sessionId, byId: { [sessionId]: { running, agentPreset: 'standard' } } }),
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
    expect(await runtime.detectCompletedAuthoringSession(sessionId)).toBe(false)
    expect(runtime.currentAuthoringSessionId()).toBeNull()

    running = false
    events.push(
      { event: { type: 'tool/call', seq: 14, data: { callId: 'call-create', name: 'paimind_agent_prepare_create' } } },
      { event: { type: 'tool/result', seq: 15, data: { message: { source: { callId: 'call-create' }, content: [{ type: 'text', text: '<!--PAIMIND_AGENT_DRAFT\n{"name":"需求澄清助手","description":"澄清需求","role":"需求分析师","goal":"形成明确需求","behavior":"一次只问一个问题","instructions":"","preferredSkillNames":[]}\n-->' }] } } } },
    )
    expect(await runtime.detectCompletedAuthoringSession(sessionId)).toBe(true)
    expect(runtime.currentAuthoringSessionId()).toBe(sessionId)
    runtime.dispose()
  })

  it('serializes one authoring Session while allowing independent Sessions to progress', async () => {
    let releaseFirst: (() => void) | undefined
    const sealAuthoringSession = vi.fn().mockImplementation(async ({ sessionId }: { readonly sessionId: string }) => {
      if (sessionId === 'session-a') await new Promise<void>(resolve => { releaseFirst = resolve })
      return { ok: true, value: { sessionId, agentPreset: 'standard', sealed: true } }
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

  it('opens native advanced configuration and keeps Business Skill selection independent of modes', async () => {
    const fixture = services(); const openAdvanced = vi.fn(() => true)
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={openAdvanced} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Advanced configuration' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Advanced configuration' }))
    expect(openAdvanced).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    expect(screen.getByRole('dialog', { name: 'Start with one sentence' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('What Agent do you want to create?'), { target: { value: 'Help me review short documents' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.queryByLabelText('Base mode')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Business Skills \(optional\)/ }))
    expect(screen.getByText(/stay out of the global catalog/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Agent Business Skills' })).not.toBeDisabled()
  })

  it('shows business Agents without any platform-mode surface', async () => {
    const fixture = services()
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    expect(screen.queryByRole('tab', { name: 'Platform modes' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Standard' })).toBeNull()
    expect(screen.queryByText(/General, PDM, and AIM are business categories/)).toBeNull()
    expect(screen.queryByText(/Category is not mode/)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Business Agents' }))
    expect(screen.getByText('No Business Agents yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy and edit' })).toBeNull()
  })

  it('persists a new Agent from the internal standard foundation and selected Business Skills', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    fireEvent.change(screen.getByLabelText('What Agent do you want to create?'), { target: { value: 'Analyze product decisions' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByRole('button', { name: 'Save Personal Agent' })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Product Analyst' } })
    fireEvent.click(screen.getByRole('button', { name: 'Product partner' }))
    expect(screen.getByRole('button', { name: 'Product partner' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Product analyst' } })
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Deliver validated product analysis' } })
    fireEvent.change(screen.getByLabelText('Behavior'), { target: { value: 'Use evidence and state uncertainty' } })
    expect(screen.queryByRole('searchbox', { name: 'Search Business Skills' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Business Skills \(optional\)/ }))
    expect(screen.getByText(/stay out of the global catalog/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Data 1' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Business Skills' }), { target: { value: 'Excel' } })
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
      avatarId: 'creator',
      productKind: 'personal',
    }))
  })

  it('accepts only one Save action before the busy render commits', async () => {
    const fixture = services()
    const presetApi = api()
    let copiedPresetId = ''
    vi.mocked(presetApi.copy).mockImplementation(async payload => {
      copiedPresetId = payload.agentPreset
      return { result: { ok: true, value: { agentPreset: payload.agentPreset } } }
    })
    vi.mocked(presetApi.list).mockImplementation(async () => ({ result: { ok: true, value: {
      ...roster,
      presets: copiedPresetId === '' ? roster.presets : [...roster.presets, { id: copiedPresetId, trust: 'user' as const, isDefault: false, name: 'One Save Agent' }],
    } } }))
    fixture.profiles.saveProfile.mockImplementation(async input => ({ ok: true, value: {
      ...input, revision: 1, configVersion: 'v1-one-save', updatedAt: 1, health: 'healthy' as const,
    } }))
    render(<AgentCenterSection close={() => {}} api={presetApi} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    fireEvent.change(screen.getByLabelText('What Agent do you want to create?'), { target: { value: 'Save exactly once' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByRole('button', { name: 'Save Personal Agent' })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'One Save Agent' } })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Product analyst' } })
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Save exactly once' } })
    fireEvent.change(screen.getByLabelText('Behavior'), { target: { value: 'Ignore repeated activation' } })
    const saveButton = screen.getByRole('button', { name: 'Save Personal Agent' })

    fireEvent.click(saveButton)
    fireEvent.click(saveButton)

    await waitFor(() => expect(fixture.profiles.saveProfile).toHaveBeenCalledOnce())
    expect(presetApi.copy).toHaveBeenCalledOnce()
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
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByRole('region', { name: 'Create Agent' })).not.toHaveAttribute('aria-modal')
    await screen.findByText('Creation assistant is ready')
    await waitFor(() => expect(fixture.runtime.watchAuthoringSession).toHaveBeenCalledWith(
      'session-authoring', -1, expect.any(Array), expect.any(Object),
    ))
    expect(fixture.runtime.author).not.toHaveBeenCalled()
    expect(fixture.runtime.prepareAuthoringSession).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Maintain product decisions with evidence',
    }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'PDM Assistant' } })
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
    const draftReview = screen.getByRole('region', { name: 'Agent draft updated' })
    expect(within(draftReview).getByText(/applied 3 suggested changes to the same draft/)).toBeInTheDocument()
    expect(within(draftReview).getByLabelText('Updated fields')).toHaveTextContent('RoleGoalBehavior')
    expect(within(draftReview).queryByRole('button', { name: 'Confirm and apply' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Save Business Agent' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save Business Agent' }))

    await waitFor(() => expect(presetApi.copy).toHaveBeenCalledWith(expect.objectContaining({ from: 'standard' })))
    expect(fixture.profiles.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      presetId: copiedPresetId, productKind: 'business', businessCategory: 'Product & PDM', basePresetId: 'standard',
    }))
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled()

    fixture.emitAuthoringTurn({
      sessionId: 'session-authoring',
      turn: 3,
      endSeq: 11,
      text: 'I refined the same Agent without creating another one.',
      proposal: { goal: 'Maintain product decisions and revisions' },
    })
    await waitFor(() => expect(screen.getByLabelText('Goal')).toHaveValue('Maintain product decisions and revisions'))
    expect(screen.queryByRole('button', { name: 'Confirm and apply' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save Business Agent' }))
    await waitFor(() => expect(fixture.profiles.saveProfile).toHaveBeenCalledTimes(2))
    expect(presetApi.copy).toHaveBeenCalledTimes(1)
    expect(fixture.profiles.saveProfile).toHaveBeenLastCalledWith(expect.objectContaining({
      presetId: copiedPresetId,
      expectedVersion: 'v1-business',
      authoringSessionId: 'session-authoring',
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Close and return' }))
    expect(fixture.runtime.beginAgentCenterBrowse).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: 'Close and return' }))
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

  it('auto-saves an edited Agent before Test Chat and passes the same Preset without copying', async () => {
    const fixture = services()
    const presetApi = api()
    const onNativeConversationChange = vi.fn()
    fixture.runtime.listTestSessions.mockResolvedValue([{
      sessionId: 'session-test', title: 'Test · Research Agent', boundAt: 1,
      running: false, completed: true, error: null,
    }])
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
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenCalledWith({
      sessionId: 'session-test', interactive: true, lockedAgentName: 'Research Agent',
    }))
    expect(screen.queryByText('Harness native test conversation connected')).toBeNull()
    expect(screen.queryByText('Standard base inherited')).toBeNull()
    expect(screen.getByRole('region', { name: 'Test Research Agent' })).toBeInTheDocument()
    expect(screen.getByText('Test history')).toBeInTheDocument()
    expect((await screen.findByText('Test · Research Agent')).closest('[aria-current]')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText('Continue on the right; replies come from the saved Agent.')).toBeNull()
    expect(screen.queryByLabelText('Role')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Configuration chat' }))
    expect(screen.getByLabelText('Role')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Senior research reviewer' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Test chat' }))
    await waitFor(() => expect(fixture.profiles.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'mine',
      presetId: 'mine',
      basePresetId: 'standard',
      expectedVersion: 'v1-a',
    })))
    expect(presetApi.copy).not.toHaveBeenCalled()
    await waitFor(() => expect(fixture.runtime.beginTest).toHaveBeenLastCalledWith(
      'mine', expect.objectContaining({ presetId: 'mine', configVersion: 'v2-saved' }),
    ))
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenCalledWith({
      sessionId: 'session-test', interactive: true, lockedAgentName: 'Research Agent',
    }))
    expect(fixture.runtime.test).not.toHaveBeenCalled()
    expect(fixture.runtime.suppressAutomaticMigration).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(fixture.runtime.retireTestSession).toHaveBeenCalledWith('session-test'))
  })

  it('reads archived Test Chat messages without selecting, creating or rebinding a Session', async () => {
    const fixture = services()
    const onNativeConversationChange = vi.fn()
    fixture.runtime.listTestSessions.mockResolvedValue([
      { sessionId: 'session-test', title: 'Current check', boundAt: 2, running: false, completed: true, error: null },
      { sessionId: 'session-old', title: 'Earlier failed check', boundAt: 1, running: false, completed: true, error: 'previous failure' },
    ])
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} onNativeConversationChange={onNativeConversationChange} />)
    await screen.findByRole('tab', { name: 'My Agents' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Test chat' }))
    await waitFor(() => expect(fixture.runtime.beginTest).toHaveBeenCalledOnce())

    const previous = await screen.findByRole('button', { name: /Earlier failed check/ })
    fireEvent.click(previous)
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenLastCalledWith({
      sessionId: null, interactive: false,
    }))
    expect(previous).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByText('The earlier reply')).toBeInTheDocument()
    expect(screen.getByText('Check the earlier prompt')).toBeInTheDocument()
    expect(screen.getByText('Original test failure')).toBeInTheDocument()
    expect(fixture.runtime.readTestHistory).toHaveBeenCalledWith('mine', 'session-old', undefined, expect.any(AbortSignal))
    expect(fixture.runtime.openSession).not.toHaveBeenCalledWith('session-old')

    fireEvent.click(screen.getByRole('button', { name: /Current check/ }))
    await waitFor(() => expect(fixture.runtime.readTestHistory).toHaveBeenLastCalledWith('mine', 'session-test', undefined, expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole('button', { name: 'Return to current test' }))
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenLastCalledWith({
      sessionId: 'session-test', interactive: true, lockedAgentName: 'Research Agent',
    }))
    expect(fixture.runtime.beginTest).toHaveBeenCalledOnce()
    expect(fixture.profiles.bindSession).not.toHaveBeenCalled()
    expect(fixture.profiles.saveProfile).not.toHaveBeenCalled()
  })

  it('retries a failed native Test Chat without returning to the configuration form', async () => {
    const fixture = services()
    vi.mocked(fixture.runtime.beginTest)
      .mockRejectedValueOnce(new Error('native bind failed'))
      .mockResolvedValueOnce('session-test-retry')
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await screen.findByRole('tab', { name: 'My Agents' })
    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Test chat' }))

    expect(await screen.findByText('Test conversation failed')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('native bind failed')
    expect(screen.queryByLabelText('Role')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry Test Chat' }))

    await waitFor(() => expect(fixture.runtime.beginTest).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Test conversation failed')).toBeNull())
    expect(screen.getByText('Test history')).toBeInTheDocument()
    expect(screen.queryByLabelText('Role')).toBeNull()
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

  it('keeps the Agent-bound Session current after Start conversation closes the Center', async () => {
    const fixture = services()
    vi.mocked(fixture.runtime.start).mockImplementation(async () => {
      fixture.runtime.openSession('session-agent-bound')
      return 'session-agent-bound'
    })
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    const center = document.createElement('main')
    const nativeConversation = document.createElement('div')
    nativeConversation.dataset.slot = 'conversation'
    nativeConversation.append(document.createElement('section'))
    center.append(nativeConversation)
    document.body.append(center)
    render(<>
      <AgentCenterTrigger wide controller={controller} locale={locale()} />
      <AgentCenterSurface controller={controller} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />
    </>)

    fireEvent.click(screen.getByRole('button', { name: 'Open Agent Center' }))
    await screen.findByRole('main', { name: 'Agent Center' })
    fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }))

    await waitFor(() => expect(screen.queryByRole('main', { name: 'Agent Center' })).toBeNull())
    expect(fixture.runtime.start).toHaveBeenCalledWith('mine', profile)
    expect(fixture.runtime.currentSessionId()).toBe('session-agent-bound')
    expect(fixture.runtime.openSession).not.toHaveBeenCalledWith('session-origin')
    controller.dispose()
  })

  it('does not restore the previous Session while a native Test Chat is being bound', async () => {
    const fixture = services()
    let finishTest: ((sessionId: string) => void) | null = null
    vi.mocked(fixture.runtime.beginTest).mockImplementation(() => {
      fixture.runtime.openSession('session-blank-for-test')
      return new Promise(resolve => { finishTest = resolve })
    })
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    const center = document.createElement('main')
    const nativeConversation = document.createElement('div')
    nativeConversation.dataset.slot = 'conversation'
    const nativeContent = document.createElement('section')
    const presetSeat = document.createElement('button')
    presetSeat.type = 'button'
    presetSeat.setAttribute('aria-haspopup', 'dialog')
    presetSeat.setAttribute('data-paimind-agent-picker-trigger', 'true')
    presetSeat.textContent = 'Research Agent'
    const presetSeatClick = vi.fn()
    presetSeat.addEventListener('click', presetSeatClick)
    const quickAgents = document.createElement('section')
    quickAgents.setAttribute('data-paimind-quick-agents', '')
    const quickAgent = document.createElement('button')
    quickAgent.type = 'button'
    quickAgent.textContent = 'Another Agent'
    const quickAgentClick = vi.fn()
    quickAgent.addEventListener('click', quickAgentClick)
    quickAgents.append(quickAgent)
    nativeContent.append(presetSeat, quickAgents)
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    vi.mocked(fixture.runtime.openSession).mockClear()
    fireEvent.click(screen.getByRole('tab', { name: 'Test chat' }))

    await waitFor(() => expect(fixture.runtime.beginTest).toHaveBeenCalledOnce())
    expect(fixture.runtime.currentSessionId()).toBe('session-blank-for-test')
    await act(async () => { await Promise.resolve() })
    expect(fixture.runtime.openSession).not.toHaveBeenCalledWith('session-origin')

    await act(async () => { finishTest?.('session-blank-for-test') })
    expect(nativeConversation).not.toHaveAttribute('inert')
    await waitFor(() => expect(nativeConversation).toHaveAttribute('data-paimind-agent-test-locked', 'true'))
    expect(presetSeat).toHaveAttribute('data-paimind-agent-test-seat')
    expect(presetSeat).toHaveAttribute('aria-disabled', 'true')
    expect(presetSeat).toHaveAttribute('title', 'Test Chat is locked to “Research Agent”')
    fireEvent.click(presetSeat)
    fireEvent.click(quickAgent)
    expect(presetSeatClick).not.toHaveBeenCalled()
    expect(quickAgentClick).not.toHaveBeenCalled()
    expect(AGENT_CENTER_STYLE).toContain("[data-paimind-agent-test-locked='true'] [data-paimind-quick-agents]")

    fireEvent.click(screen.getByRole('tab', { name: 'Configuration chat' }))
    await waitFor(() => expect(nativeConversation).not.toHaveAttribute('data-paimind-agent-test-locked'))
    expect(presetSeat).not.toHaveAttribute('data-paimind-agent-test-seat')
    expect(presetSeat).not.toHaveAttribute('aria-disabled')
    controller.dispose()
  })

  it('keeps a selected authoring history Session inside the Center workbench', async () => {
    const fixture = services()
    let browsing = false
    vi.mocked(fixture.runtime.beginAgentCenterBrowse).mockImplementation(() => { browsing = true })
    vi.mocked(fixture.runtime.resumeSelectedAuthoringSession).mockImplementation(() => { browsing = false })
    vi.mocked(fixture.runtime.currentAuthoringSessionId).mockImplementation(() => (
      browsing ? null : fixture.runtime.currentSessionId()
    ))
    fixture.runtime.openSession('paimind-authoring-selected')
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    const center = document.createElement('main')
    const nativeConversation = document.createElement('div')
    nativeConversation.dataset.slot = 'conversation'
    nativeConversation.append(document.createElement('section'))
    center.append(nativeConversation)
    document.body.append(center)
    render(<>
      <div role="treeitem" aria-selected="true">Selected authoring Session</div>
      <AgentCenterTrigger wide controller={controller} locale={locale()} onBrowse={fixture.runtime.beginAgentCenterBrowse} />
      <AgentCenterSurface controller={controller} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />
    </>)

    fireEvent.click(screen.getByRole('button', { name: 'Open Agent Center' }))
    await screen.findByRole('main', { name: 'Agent Center' })
    expect(browsing).toBe(true)
    fireEvent.click(screen.getByRole('treeitem', { name: 'Selected authoring Session' }))
    await waitFor(() => expect(fixture.runtime.resumeSelectedAuthoringSession).toHaveBeenCalledOnce())
    expect(browsing).toBe(false)
    expect(screen.getByRole('main', { name: 'Agent Center' })).toBeInTheDocument()
    controller.dispose()
  })

  it('keeps the native question card interactive while an authoring Turn is waiting', async () => {
    const fixture = services()
    vi.mocked(fixture.runtime.currentAuthoringSessionId).mockImplementation(() => (
      fixture.runtime.currentSessionId() === 'session-authoring' ? 'session-authoring' : null
    ))
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    const center = document.createElement('main')
    const nativeConversation = document.createElement('div')
    nativeConversation.dataset.slot = 'conversation'
    const nativeContent = document.createElement('section')
    const answer = document.createElement('button')
    answer.type = 'button'
    answer.setAttribute('role', 'radio')
    answer.setAttribute('aria-label', 'B2B sales follow-up')
    const choose = vi.fn()
    answer.addEventListener('click', choose)
    nativeContent.append(answer)
    nativeConversation.append(nativeContent)
    center.append(nativeConversation)
    document.body.append(center)
    render(<>
      <AgentCenterTrigger wide controller={controller} locale={locale()} />
      <AgentCenterSurface controller={controller} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />
    </>)

    fireEvent.click(screen.getByRole('button', { name: 'Open Agent Center' }))
    await screen.findByRole('main', { name: 'Agent Center' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    fireEvent.change(screen.getByLabelText('What Agent do you want to create?'), { target: { value: 'Create a customer follow-up Agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await screen.findByText('Creation assistant is ready')
    fixture.emitAuthoringRunning()
    await screen.findByText('Creation assistant is working')
    await waitFor(() => expect(nativeConversation).not.toHaveAttribute('inert'))
    fireEvent.click(screen.getByRole('radio', { name: 'B2B sales follow-up' }))
    expect(choose).toHaveBeenCalledOnce()
    expect(screen.getByRole('main', { name: 'Agent Center' })).toBeInTheDocument()

    await act(async () => {
      fixture.emitAuthoringTurn({ sessionId: 'session-authoring', turn: 1, endSeq: 3, text: 'Draft ready', proposal: null })
    })
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

  it('closes only the starter, but exits the whole product surface from Builder on the first Escape', async () => {
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
    visibleReply.textContent = 'Should this Agent focus on new customers?'
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
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    const builder = screen.getByRole('region', { name: 'Create Agent' })
    expect(builder.closest('[data-paimind-agent-center]')).toHaveAttribute('data-builder-open', 'true')
    await screen.findByText('Creation assistant is ready')
    await waitFor(() => expect(fixture.runtime.openSession).toHaveBeenCalledWith('session-authoring'))
    expect(center).toHaveAttribute('data-paimind-product-center-native-conversation')
    expect(nativeContent).toHaveAttribute('data-paimind-product-center-native-conversation-content')
    await waitFor(() => expect(markdown).toHaveTextContent('Draft synced to the brief. Review it before saving.'))
    expect(contextRow).toHaveAttribute('hidden')
    expect(thinkRow).toHaveAttribute('hidden')
    expect(contextRow.style.getPropertyValue('display')).toBe('none')
    expect(contextRow.style.getPropertyPriority('display')).toBe('important')
    expect(thinkRow.style.getPropertyValue('display')).toBe('none')
    expect(markdown).not.toHaveTextContent('Should this Agent focus on new customers?')
    expect(markdown).toHaveAttribute('data-paimind-agent-draft-question-recovered', 'true')
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
    expect(markdown).toHaveTextContent('Should this Agent focus on new customers?')
    expect(markdown.querySelector('[data-paimind-agent-draft-projection]')).toBeNull()
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
    vi.mocked(fixture.runtime.prepareAuthoringSession).mockImplementation(async ({ onSessionCreated }) => {
      authoringTurn += 1
      const sessionId = authoringTurn === 1 ? 'session-authoring-first' : 'session-authoring-second'
      fixture.runtime.openSession(sessionId)
      onSessionCreated?.(sessionId)
      return {
        sessionId, cursor: -1,
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
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    const firstBuilder = await screen.findByRole('region', { name: 'Create Agent' })
    await waitFor(() => expect(fixture.runtime.currentSessionId()).toBe('session-authoring-first'))
    fireEvent.keyDown(firstBuilder, { key: 'Escape' })
    await waitFor(() => expect(fixture.runtime.currentSessionId()).toBe('session-origin'))
    await waitFor(() => expect(screen.queryByRole('main', { name: 'Agent Center' })).toBeNull())

    act(() => { fixture.runtime.openSession('session-second-origin') })
    act(() => { controller.open() })
    await screen.findByRole('main', { name: 'Agent Center' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    fireEvent.change(screen.getByLabelText('What Agent do you want to create?'), { target: { value: 'Review a second delivery promise' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    const secondBuilder = await screen.findByRole('region', { name: 'Create Agent' })
    await waitFor(() => expect(fixture.runtime.currentSessionId()).toBe('session-authoring-second'))
    const closeAndReturn = within(secondBuilder).getByRole('button', { name: 'Close and return' })
    await waitFor(() => expect(closeAndReturn).toBeEnabled())
    vi.mocked(fixture.runtime.openSession).mockClear()
    vi.mocked(fixture.runtime.beginAgentCenterBrowse).mockClear()
    fireEvent.click(closeAndReturn)
    await waitFor(() => expect(screen.queryByRole('main', { name: 'Agent Center' })).toBeNull())
    expect(fixture.runtime.beginAgentCenterBrowse).toHaveBeenCalledOnce()
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
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    const builder = screen.getByRole('region', { name: 'Create Agent' })
    expect(builder).not.toHaveAttribute('aria-modal')
    await screen.findByText('Creation assistant is ready')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close and return to conversation' })).toHaveFocus())
    expect(builder.querySelector('[data-paimind-agent-conversation-composer]')).toBeNull()
    fireEvent.keyDown(builder, { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('region', { name: 'Create Agent' })).toBeNull()
    expect(starter).not.toBeInTheDocument()
  })

  it('uses tokens and includes responsive and reduced-motion treatments', () => {
    expect(AGENT_CENTER_STYLE).toContain('--paimind-ui-canvas')
    expect(AGENT_CENTER_STYLE).toContain('--paimind-ui-panel')
    expect(AGENT_CENTER_STYLE).toMatch(/\[data-paimind-product-surface='agent-center'\][\s\S]*z-index: 80;/)
    expect(AGENT_CENTER_STYLE).toMatch(/\[data-paimind-product-surface='agent-center'\] \[data-paimind-agent-builder-layer\] \{[\s\S]*overflow: clip;/)
    expect(AGENT_CENTER_STYLE).toContain('grid-template-rows: auto auto auto minmax(0, 1fr) auto;')
    expect(AGENT_CENTER_STYLE).toMatch(/\[data-paimind-product-surface='agent-center'\] \[data-paimind-agent-skills-panel\] \{[\s\S]*height: max-content;[\s\S]*min-height: 76px;[\s\S]*display: grid;[\s\S]*overflow: clip;/)
    expect(AGENT_CENTER_STYLE).toContain('@media(max-width:680px)')
    expect(AGENT_CENTER_STYLE).toContain('--paimind-agent-native-conversation-height: clamp(260px, 44dvh, 420px);')
    expect(AGENT_CENTER_STYLE).toContain('inset: 0 0 var(--paimind-agent-native-conversation-height);')
    expect(AGENT_CENTER_STYLE).toContain('inset: auto 0 0 !important;')
    expect(AGENT_CENTER_STYLE).toContain('height: var(--paimind-agent-native-conversation-height) !important;')
    expect(AGENT_CENTER_STYLE).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));')
    expect(AGENT_CENTER_STYLE).toContain('var(--paimind-motion-loop)')
    expect(AGENT_CENTER_STYLE).toContain('var(--paimind-motion-iterations)')
    expect(AGENT_CENTER_STYLE).toContain('[data-paimind-agent-splitter]')
    expect(AGENT_CENTER_STYLE).toContain('[data-paimind-agent-draft-question-recovered] > :not([data-paimind-agent-draft-projection])')
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
    expect(document.getElementById('@hansen/agent-market')).not.toBeNull()
    await dispose()
    expect(document.getElementById('@hansen/agent-market')).toBeNull()
  })
})
