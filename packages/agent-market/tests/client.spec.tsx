import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement, type ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HarnessAgentPresetApi, PaimindLocaleSource } from '@paimind/harness-compat'
import { AGENT_AUTHORING_PROPOSAL_TOOL } from '@paimind/agent-builder/client-contract'
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

type AuthoringWatchResult = Readonly<{
  sessionId: string
  turn: number
  endSeq: number
  text: string
  proposal: Readonly<Record<string, unknown>> | null
}>

type AuthoringWatchHandlers = Readonly<{
  onRunning: () => void
  onTurn: (result: AuthoringWatchResult) => void
  onIdle: () => void
  onError: (error: Error) => void
}>

function services() {
  const runtimeSnapshot = { notice: null, error: null }
  let authoringWatch: AuthoringWatchHandlers | null = null
  return {
    profiles: {
      listProfiles: vi.fn().mockResolvedValue({ ok: true, value: { profiles: [profile] } }),
      saveProfile: vi.fn(), setDefault: vi.fn(), sealAuthoringSession: vi.fn(), bindSession: vi.fn(), migrationPlan: vi.fn(), recordMigration: vi.fn(), verifySession: vi.fn(), listAudit: vi.fn(),
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
      author: vi.fn().mockImplementation(async ({ sessionId }: { readonly sessionId: string | null }) => ({
        sessionId: sessionId ?? 'session-authoring',
        turn: 1,
        endSeq: 3,
        text: 'Native authoring turn completed.',
        proposal: null,
      })),
      beginAuthoring: vi.fn().mockResolvedValue({ sessionId: 'session-authoring', endSeq: -1 }),
      prepareAuthoringContext: vi.fn().mockResolvedValue(undefined),
      watchAuthoringSession: vi.fn((
        _sessionId: string,
        _cursor: number,
        _skills: readonly Readonly<{ name: string }>[],
        handlers: AuthoringWatchHandlers,
      ) => {
        authoringWatch = handlers
        return () => { if (authoringWatch === handlers) authoringWatch = null }
      }),
      beginTest: vi.fn().mockResolvedValue('session-test'),
      test: vi.fn().mockResolvedValue('session-test'),
      sessionState: vi.fn(() => ({ running: true, completed: false, error: null })),
      subscribeSessions: vi.fn(() => () => {}),
      currentSessionId: vi.fn(() => 'session-original'),
      openSession: vi.fn(() => () => {}),
    },
    emitAuthoringTurn(result: AuthoringWatchResult): void {
      if (authoringWatch === null) throw new Error('Native authoring watcher is not ready')
      authoringWatch.onRunning()
      authoringWatch.onTurn(result)
      authoringWatch.onIdle()
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

  it('uses a compact task-first library instead of repeated dashboard cards', async () => {
    const fixture = services()
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)

    const heading = await screen.findByRole('heading', { name: 'Research Agent' })
    const card = heading.closest('[data-paimind-agent-card]') as HTMLElement
    expect(screen.getByRole('heading', { name: 'My Agents' })).toHaveAttribute('data-paimind-agent-visually-hidden')
    expect(within(card).queryByText('Personal', { selector: '[data-paimind-agent-badge]' })).not.toBeInTheDocument()
    expect(within(card).queryByText('Native Harness Preset')).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Set Research Agent as default' })).toHaveAttribute('data-icon-only', 'true')
    expect(AGENT_CENTER_STYLE).toContain("container: paimind-agent-center / inline-size")
    expect(AGENT_CENTER_STYLE).toContain("grid-template-areas:\n    'identity badges actions'\n    'description context actions'")
    expect(AGENT_CENTER_STYLE).toContain('@container paimind-agent-center (max-width:620px)')
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
    expect(screen.getByRole('dialog', { name: 'What should your Agent do?' })).toBeInTheDocument()
    expect(fixture.runtime.start).not.toHaveBeenCalled()
  })

  it('resets the Center scroll position when the unified Builder opens', async () => {
    const fixture = services()
    const { container } = render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    const center = container.querySelector<HTMLElement>('[data-paimind-agent-center]')!
    center.scrollTop = 240

    fireEvent.click(screen.getAllByRole('button', { name: 'Create Personal Agent' })[0]!)
    fireEvent.change(screen.getByLabelText('Describe what it should accomplish'), { target: { value: 'Review a business workflow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate Agent brief' }))

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
    expect(close).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledWith(false)
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

  it('creates the native Test Session inside the current authoring workspace', async () => {
    const rows: Record<string, { id: string; blank: boolean; agentPreset: string }> = {
      'session-authoring': { id: 'session-authoring', blank: false, agentPreset: 'cordis' },
    }
    let current = 'session-authoring'
    const listeners = new Set<() => void>()
    const sessions = {
      list: {
        getSnapshot: () => ({ current, byId: rows }),
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      create: vi.fn(async (opts: { readonly workspaceId?: string }) => {
        expect(opts).toEqual({ workspaceId: 'workspace-authoring' })
        rows['session-test'] = { id: 'session-test', blank: true, agentPreset: 'standard' }
        current = 'session-test'
        listeners.forEach(listener => { listener() })
        return 'session-test'
      }),
      binding: (sessionId: string) => sessionId === 'session-test' ? {
        ctx: {},
        session: {
          getSnapshot: () => ({ running: false, chat: { timeline: { turnOrder: [] } } }),
          subscribe: () => () => {},
        },
      } : undefined,
      open: vi.fn(),
    }
    let selected = 'cordis'
    const seat = {
      getSnapshot: () => ({ options: [], current: selected, error: null, busy: false, introduce: false }),
      select: vi.fn(async (presetId: string) => {
        selected = presetId
        rows['session-test']!.agentPreset = presetId
        listeners.forEach(listener => { listener() })
      }),
    }
    const startSession = vi.fn()
    const workspaces = {
      list: { getSnapshot: () => ({
        items: [{ workspaceId: 'workspace-authoring', path: '/tmp/project', title: 'Project', sessionIds: ['session-authoring'] }],
        recentWorkspaceId: 'workspace-recent',
      }) },
      startSession,
    }
    const bindSession = vi.fn().mockResolvedValue({ ok: true, value: {
      sessionId: 'session-test', agentId: profile.agentId, presetId: profile.presetId,
      configVersion: profile.configVersion, boundAt: 1,
    } })
    const remote = {
      bindSession,
      listAudit: vi.fn().mockResolvedValue({ ok: true, value: { migrations: [], verifications: [] } }),
      migrationPlan: vi.fn().mockResolvedValue({ ok: true, value: null }),
    }
    const runtime = new AgentCenterRuntime(
      seat as never,
      remote as never,
      sessions as never,
      workspaces as never,
      { input: { for: () => ({ setDraft: vi.fn() }) } } as never,
    )

    await expect(runtime.beginTest('mine', profile)).resolves.toBe('session-test')
    expect(sessions.create).toHaveBeenCalledWith({ workspaceId: 'workspace-authoring' })
    expect(startSession).not.toHaveBeenCalled()
    expect(seat.select).toHaveBeenCalledWith('mine')
    expect(bindSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-test', presetId: 'mine', configVersion: profile.configVersion,
    }))
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
    let sessionSnapshot: { readonly lastAgentError: string | null; readonly partial: null | { readonly turn: number; readonly blocks: readonly { readonly kind: string; readonly text?: string }[] } } = { lastAgentError: null, partial: null }
    let turn = 0
    const authoringApi = {
      create: vi.fn().mockImplementation(async (payload: { readonly sessionId?: string }) => ({
        result: { ok: true, value: { sessionId: payload.sessionId, agentPreset: 'cordis' } },
      })),
      rename: vi.fn().mockResolvedValue({ result: { ok: true, value: { title: 'Agent authoring', seq: 1 } } }),
      history: vi.fn().mockImplementation(async () => ({ result: { ok: true, value: { events, hasMore: false } } })),
      prompt: vi.fn().mockImplementation(async () => {
        turn += 1
        const rpcId = `rpc-authoring-${turn}`
        sessionSnapshot = { lastAgentError: sessionSnapshot.lastAgentError, partial: { turn, blocks: [
          { kind: 'reasoning', text: 'hidden chain of thought' },
          { kind: 'text', text: '模型正在整理上下文。' },
        ] } }
        sessionListeners.forEach(listener => { listener() })
        const text = turn === 1
          ? '我分析了真实需求，并将重点放在可执行的周末探索上。'
          : '我保留原有目标，并把 300 元预算作为硬约束。'
        const proposal = turn === 1
          ? { name: '周末探索搭子', role: '根据天气、预算和兴趣规划城市探索的生活方式顾问', goal: '给出可当天执行且有室内备选的路线', behavior: '先确认城市和日期，再核对天气与预算；输出时间线、费用和备选方案。', preferredSkillNames: ['web-research'] }
          : { instructions: '总预算不超过 300 元，雨天优先室内路线。' }
        const callId = `proposal-${turn}`
        events.push(
          { event: { type: 'turn/start', seq: turn * 10, data: { turn } } },
          { event: { type: 'user/message', seq: turn * 10 + 1, data: { id: `message-${turn}`, source: { kind: 'user', rpcId }, content: [{ type: 'text', text: 'authoring prompt' }] } } },
          { event: { type: 'tool/call', seq: turn * 10 + 2, data: { turn, step: 1, callId, name: AGENT_AUTHORING_PROPOSAL_TOOL, arguments: JSON.stringify(proposal) } } },
          { event: { type: 'tool/result', seq: turn * 10 + 3, data: { turn, step: 1, message: {
            source: { kind: 'tool', callId },
            content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: 'Proposal accepted.' }], isError: false }],
          } } } },
          { event: { type: 'assistant/message', seq: turn * 10 + 4, data: { turn, step: 2, message: { content: [{ type: 'text', text }] } } } },
          { event: { type: 'turn/end', seq: turn * 10 + 5, data: { turn, reason: { kind: 'completed' } } } },
        )
        return { rpcId, result: { ok: true, value: { accepted: true } } }
      }),
      cancel: vi.fn().mockResolvedValue({ result: { ok: true, value: { accepted: true } } }),
    }
    let releaseFirstSeal!: () => void
    let firstSealPending = true
    const firstSealGate = new Promise<void>(resolve => { releaseFirstSeal = resolve })
    const runtime = new AgentCenterRuntime(
      null,
      {
        listAudit: vi.fn().mockResolvedValue({ ok: true, value: { migrations: [], verifications: [] } }),
        migrationPlan: vi.fn().mockResolvedValue({ ok: true, value: null }),
        sealAuthoringSession: vi.fn().mockImplementation(async ({ sessionId }: { readonly sessionId: string }) => {
          if (firstSealPending) {
            firstSealPending = false
            await firstSealGate
          }
          return { ok: true, value: { sessionId, agentPreset: 'cordis', sealed: true } }
        }),
        prepareAuthoringTurn: vi.fn().mockImplementation(async ({ sessionId }: { readonly sessionId: string }) => ({
          ok: true, value: { sessionId, prepared: true },
        })),
      } as never,
      {
        list: { getSnapshot: () => ({ current: undefined, byId: {} }), subscribe: () => () => {} },
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
    const firstTurn = runtime.author({ sessionId: null, draft, prompt: '根据天气和预算安排周末玩法', skills: [{ name: 'web-research', description: 'Search current facts' }], locale: 'zh-CN', onSessionCreated, onProgress })
    await waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith(expect.stringMatching(/^paimind-authoring-/)))
    expect(authoringApi.prompt).not.toHaveBeenCalled()
    releaseFirstSeal()
    const first = await firstTurn
    expect(authoringApi.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: expect.stringMatching(/^paimind-authoring-/), agentPreset: 'cordis', workspaceId: 'workspace-recent',
    }), expect.any(AbortSignal))
    expect(onSessionCreated).toHaveBeenCalledWith(first.sessionId)
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
    expect(first.text).not.toContain('PAIMIND_AGENT_DRAFT')
    expect(first.text).not.toContain('{"name"')
    expect(first.proposal).not.toHaveProperty('basePresetId')

    sessionSnapshot = { ...sessionSnapshot, lastAgentError: 'stale failure from a previous turn' }
    const second = await runtime.author({ sessionId: first.sessionId, draft: { ...draft, ...first.proposal }, prompt: '总预算控制在 300 元以内', skills: [{ name: 'web-research', description: 'Search current facts' }], locale: 'zh-CN' })
    expect(authoringApi.create).toHaveBeenCalledTimes(1)
    expect(second).toMatchObject({ sessionId: first.sessionId, proposal: { instructions: '总预算不超过 300 元，雨天优先室内路线。' } })
    expect(authoringApi.prompt).toHaveBeenCalledTimes(2)

    vi.mocked(authoringApi.prompt).mockImplementationOnce(async () => {
      turn += 1
      const rpcId = `rpc-authoring-${turn}`
      const callId = `proposal-${turn}`
      events.push(
        { event: { type: 'turn/start', seq: turn * 10, data: { turn } } },
        { event: { type: 'user/message', seq: turn * 10 + 1, data: { id: `message-${turn}`, source: { kind: 'user', rpcId }, content: [{ type: 'text', text: 'invalid proposal' }] } } },
        { event: { type: 'tool/call', seq: turn * 10 + 2, data: { turn, step: 1, callId, name: AGENT_AUTHORING_PROPOSAL_TOOL, arguments: '{"basePresetId":"minimal"}' } } },
        { event: { type: 'tool/result', seq: turn * 10 + 3, data: { turn, step: 1, error: { name: 'ToolArgsError', code: 'INVALID_TOOL_ARGS' }, message: {
          source: { kind: 'tool', callId },
          content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: 'Error: rejected' }], isError: true }],
        } } } },
        { event: { type: 'assistant/message', seq: turn * 10 + 4, data: { turn, step: 2, message: { content: [{ type: 'text', text: 'This must not be applied.' }] } } } },
        { event: { type: 'turn/end', seq: turn * 10 + 5, data: { turn, reason: { kind: 'completed' } } } },
      )
      return { rpcId, result: { ok: true, value: { accepted: true } } }
    })
    await expect(runtime.author({ sessionId: first.sessionId, draft, prompt: '尝试修改基础模式', skills: [], locale: 'zh-CN' }))
      .rejects.toThrow('原生说明书提案未被 Host 接受')

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

  it('serializes only the same authoring Session while allowing different Harness Sessions to run concurrently', async () => {
    const promptReleases = new Map<string, (value: unknown) => void>()
    const authoringApi = {
      history: vi.fn().mockResolvedValue({ result: { ok: true, value: { events: [], hasMore: false } } }),
      prompt: vi.fn().mockImplementation(async ({ sessionId }: { readonly sessionId: string }) => (
        await new Promise(resolve => { promptReleases.set(sessionId, resolve) })
      )),
      cancel: vi.fn().mockResolvedValue({ result: { ok: true, value: { accepted: true } } }),
      rename: vi.fn(),
    }
    const remote = {
      listAudit: vi.fn().mockResolvedValue({ ok: true, value: { migrations: [], verifications: [] } }),
      migrationPlan: vi.fn().mockResolvedValue({ ok: true, value: null }),
      sealAuthoringSession: vi.fn().mockImplementation(async ({ sessionId }: { readonly sessionId: string }) => ({
        ok: true, value: { sessionId, agentPreset: 'cordis', sealed: true },
      })),
      prepareAuthoringTurn: vi.fn().mockImplementation(async ({ sessionId }: { readonly sessionId: string }) => ({
        ok: true, value: { sessionId, prepared: true },
      })),
    }
    const runtime = new AgentCenterRuntime(
      null,
      remote as never,
      { list: { getSnapshot: () => ({ current: undefined, byId: {} }), subscribe: () => () => {} } } as never,
      { list: { getSnapshot: () => ({ items: [], recentWorkspaceId: undefined }), subscribe: () => () => {} }, startSession: vi.fn() } as never,
      { input: { for: () => ({ setDraft: vi.fn() }) } } as never,
      authoringApi as never,
    )
    const draft = {
      productKind: 'personal' as const, businessCategory: '', name: 'Concurrent Agent', description: 'Prove Session concurrency',
      basePresetId: 'standard', role: '', goal: '', behavior: '', instructions: '', preferredSkillNames: [],
    }
    const first = runtime.author({ sessionId: 'session-authoring-a', draft, prompt: 'first', skills: [], locale: 'en-US' })
    await waitFor(() => expect(authoringApi.prompt).toHaveBeenCalledTimes(1))
    await expect(runtime.author({ sessionId: 'session-authoring-a', draft, prompt: 'duplicate', skills: [], locale: 'en-US' }))
      .rejects.toThrow('这个 Harness cordis 创建会话仍在处理上一条消息')

    const second = runtime.author({ sessionId: 'session-authoring-b', draft, prompt: 'second', skills: [], locale: 'en-US' })
    await waitFor(() => expect(authoringApi.prompt).toHaveBeenCalledTimes(2))
    expect(authoringApi.prompt).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-authoring-a' }), expect.any(AbortSignal))
    expect(authoringApi.prompt).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-authoring-b' }), expect.any(AbortSignal))

    promptReleases.get('session-authoring-a')?.({ rpcId: 'rpc-a', result: { ok: true, value: { accepted: false } } })
    promptReleases.get('session-authoring-b')?.({ rpcId: 'rpc-b', result: { ok: true, value: { accepted: false } } })
    await expect(first).rejects.toThrow('真实创建会话未接受配置消息')
    await expect(second).rejects.toThrow('真实创建会话未接受配置消息')
    expect(authoringApi.cancel).toHaveBeenCalledTimes(2)
    runtime.dispose()
  })

  it('prepares edit Sessions without leaking UI callbacks into the strict authoring wire input', async () => {
    const sessionListeners = new Set<() => void>()
    let currentSessionId: string | undefined
    let selectedPreset: string | null = null
    const rows: Record<string, { readonly id: string; agentPreset?: string; blank: boolean }> = {}
    const prepareAuthoringTurn = vi.fn().mockImplementation(async (input: Readonly<Record<string, unknown>>) => {
      expect(Object.keys(input).sort()).toEqual(['draft', 'locale', 'sessionId', 'skills'])
      return { ok: true, value: { sessionId: input.sessionId, prepared: true } }
    })
    const runtime = new AgentCenterRuntime(
      () => ({
        getSnapshot: () => ({ status: 'ready', current: selectedPreset, busy: false, error: null, choices: [] }),
        select: vi.fn().mockImplementation(async (presetId: string) => {
          selectedPreset = presetId
          if (currentSessionId !== undefined) rows[currentSessionId]!.agentPreset = presetId
          sessionListeners.forEach(listener => { listener() })
        }),
      }),
      {
        listAudit: vi.fn().mockResolvedValue({ ok: true, value: { migrations: [], verifications: [] } }),
        migrationPlan: vi.fn().mockResolvedValue({ ok: true, value: null }),
        sealAuthoringSession: vi.fn().mockImplementation(async ({ sessionId }: { readonly sessionId: string }) => ({
          ok: true, value: { sessionId, agentPreset: 'cordis', sealed: true },
        })),
        prepareAuthoringTurn,
      } as never,
      {
        list: {
          getSnapshot: () => ({ current: currentSessionId, byId: rows }),
          subscribe: (listener: () => void) => { sessionListeners.add(listener); return () => { sessionListeners.delete(listener) } },
        },
        create: vi.fn().mockImplementation(async ({ sessionId }: { readonly sessionId: string }) => {
          rows[sessionId] = { id: sessionId, blank: true }
          currentSessionId = sessionId
          sessionListeners.forEach(listener => { listener() })
          return sessionId
        }),
        open: vi.fn().mockImplementation((sessionId: string) => { currentSessionId = sessionId }),
      } as never,
      { list: { getSnapshot: () => ({ items: [], recentWorkspaceId: undefined }), subscribe: () => () => {} }, startSession: vi.fn() } as never,
      { input: { for: () => ({ setDraft: vi.fn() }) } } as never,
      {
        rename: vi.fn().mockResolvedValue({ result: { ok: true, value: { title: 'Agent authoring', seq: 1 } } }),
        history: vi.fn().mockResolvedValue({ result: { ok: true, value: { events: [], hasMore: false } } }),
      } as never,
    )
    const result = await runtime.beginAuthoring({
      draft: {
        productKind: 'personal', businessCategory: '', name: 'Editable Agent', description: 'Edit with a native Session',
        basePresetId: 'standard', role: '', goal: '', behavior: '', instructions: '', preferredSkillNames: [],
      },
      skills: [],
      locale: 'en-US',
    })
    expect(result.sessionId).toMatch(/^paimind-authoring-/)
    expect(currentSessionId).toBe(result.sessionId)
    expect(prepareAuthoringTurn).toHaveBeenCalledOnce()
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
    expect(screen.getByRole('dialog', { name: 'What should your Agent do?' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Describe what it should accomplish'), { target: { value: 'Help me review short documents' } })
    fireEvent.change(screen.getByLabelText('Agent name (editable later)'), { target: { value: 'Minimal helper' } })
    fireEvent.change(screen.getByLabelText('Base mode'), { target: { value: 'minimal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate Agent brief' }))
    expect(screen.getByLabelText('Base mode')).toHaveValue('minimal')
    fireEvent.click(screen.getByRole('button', { name: /Session Skills \(optional\)/ }))
    expect(screen.getByText(/Minimal mode does not enable Session Skills/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Session-injected Skills' })).toBeDisabled()
  })

  it('projects the native authoring Session into the joined Builder workbench before the first turn finishes', async () => {
    const fixture = services()
    const onNativeConversationChange = vi.fn()
    let finishAuthoring!: (result: AuthoringWatchResult) => void
    fixture.runtime.author.mockImplementation((input: { readonly onSessionCreated?: (sessionId: string) => void }) => {
      input.onSessionCreated?.('session-authoring-live')
      return new Promise(resolve => { finishAuthoring = resolve })
    })
    render(<AgentCenterSection
      close={() => {}}
      api={api()}
      profiles={fixture.profiles as never}
      skills={fixture.skills as never}
      runtime={fixture.runtime as never}
      locale={locale()}
      openAdvanced={() => true}
      onNativeConversationChange={onNativeConversationChange}
    />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    fireEvent.change(screen.getByLabelText('Describe what it should accomplish'), { target: { value: 'Review launch readiness' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate Agent brief' }))

    expect(screen.getByRole('region', { name: 'Create Agent' })).toBeInTheDocument()
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenCalledWith({
      sessionId: 'session-authoring-live', interactive: false,
    }))
    expect(screen.getByText('Connecting the native Harness configuration conversation')).toBeInTheDocument()

    await act(async () => {
      finishAuthoring({
        sessionId: 'session-authoring-live', turn: 1, endSeq: 5,
        text: 'The native configuration turn completed.', proposal: null,
      })
    })
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenCalledWith({
      sessionId: 'session-authoring-live', interactive: true,
    }))
    expect(screen.getByText('Harness native configuration conversation is on the right')).toBeInTheDocument()
  })

  it('keeps edit-session initialization alive after projecting the native Session early', async () => {
    const fixture = services()
    const onNativeConversationChange = vi.fn()
    let finishInitialization!: (result: { readonly sessionId: string; readonly endSeq: number }) => void
    let currentSessionId = 'session-original'
    let sessionListener: (() => void) | null = null
    fixture.runtime.currentSessionId.mockImplementation(() => currentSessionId)
    fixture.runtime.subscribeSessions.mockImplementation(listener => {
      sessionListener = listener
      return () => { if (sessionListener === listener) sessionListener = null }
    })
    fixture.runtime.beginAuthoring.mockImplementation(() => {
      currentSessionId = 'paimind-authoring-edit-live'
      sessionListener?.()
      return new Promise(resolve => { finishInitialization = resolve })
    })
    render(<AgentCenterSection
      close={() => {}}
      api={api()}
      profiles={fixture.profiles as never}
      skills={fixture.skills as never}
      runtime={fixture.runtime as never}
      locale={locale()}
      openAdvanced={() => true}
      onNativeConversationChange={onNativeConversationChange}
    />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenCalledWith({
      sessionId: 'paimind-authoring-edit-live', interactive: false,
    }))

    await act(async () => { finishInitialization({ sessionId: 'paimind-authoring-edit-live', endSeq: -1 }) })
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenCalledWith({
      sessionId: 'paimind-authoring-edit-live', interactive: true,
    }))
    expect(screen.getByText('Harness native configuration conversation is on the right')).toBeInTheDocument()
  })

  it('keeps the projected native Session visible when the opening authoring turn fails', async () => {
    const fixture = services()
    const onNativeConversationChange = vi.fn()
    fixture.runtime.author.mockImplementation(async (input: { readonly onSessionCreated?: (sessionId: string) => void }) => {
      input.onSessionCreated?.('session-authoring-recovery')
      throw new Error('simulated native turn failure')
    })
    render(<AgentCenterSection
      close={() => {}}
      api={api()}
      profiles={fixture.profiles as never}
      skills={fixture.skills as never}
      runtime={fixture.runtime as never}
      locale={locale()}
      openAdvanced={() => true}
      onNativeConversationChange={onNativeConversationChange}
    />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    fireEvent.change(screen.getByLabelText('Describe what it should accomplish'), { target: { value: 'Recover a failed opening turn' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate Agent brief' }))

    const alerts = await screen.findAllByRole('alert')
    expect(alerts).not.toHaveLength(0)
    expect(alerts.every(alert => alert.textContent?.includes('The created Harness Session remains visible on the right and the draft is preserved.'))).toBe(true)
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenLastCalledWith({
      sessionId: 'session-authoring-recovery', interactive: false,
    }))
    expect(screen.getByRole('region', { name: 'Create Agent' })).toBeInTheDocument()
    expect(screen.getByText('Native configuration conversation failed')).toBeInTheDocument()
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
    const onNativeConversationChange = vi.fn()
    let copiedPresetId = ''
    vi.mocked(presetApi.copy).mockImplementation(async payload => {
      copiedPresetId = payload.agentPreset
      return { result: { ok: true, value: { agentPreset: payload.agentPreset } } }
    })
    vi.mocked(presetApi.list).mockImplementation(async () => ({ result: { ok: true, value: {
      ...roster,
      presets: copiedPresetId === '' ? roster.presets : [...roster.presets, { id: copiedPresetId, trust: 'user' as const, isDefault: false, name: 'Standard · My version' }],
    } } }))
    let releaseSave!: () => void
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve })
    fixture.profiles.saveProfile.mockImplementation(async input => { await saveGate; return { ok: true, value: {
      ...input, revision: 1, configVersion: 'v1-test', updatedAt: 1, health: 'healthy' as const,
    } } })
    render(<AgentCenterSection
      close={() => {}}
      api={presetApi}
      profiles={fixture.profiles as never}
      skills={fixture.skills as never}
      runtime={fixture.runtime as never}
      locale={locale()}
      openAdvanced={() => true}
      onNativeConversationChange={onNativeConversationChange}
    />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    fireEvent.click(screen.getByRole('tab', { name: 'Platform modes' }))
    await screen.findByRole('heading', { name: 'Standard' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy and edit' })[0]!)
    await waitFor(() => expect(fixture.runtime.beginAuthoring).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenCalledWith({
      sessionId: 'session-authoring', interactive: true,
    }))
    expect(screen.getByText('Harness native configuration conversation is on the right')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Configuration chat' })).toHaveAttribute('aria-selected', 'true')
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
    const saveButton = await screen.findByRole('button', { name: 'Save Personal Agent' })
    expect(saveButton).toBeEnabled()
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)
    await waitFor(() => expect(fixture.profiles.saveProfile).toHaveBeenCalledOnce())
    expect(presetApi.copy).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Role')).toBeDisabled()
    expect(onNativeConversationChange).toHaveBeenLastCalledWith({
      sessionId: 'session-authoring', interactive: false,
    })
    releaseSave()
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
    const onNativeConversationChange = vi.fn()
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

    render(<AgentCenterSection
      close={() => {}}
      api={presetApi}
      profiles={fixture.profiles as never}
      skills={fixture.skills as never}
      runtime={fixture.runtime as never}
      locale={locale()}
      openAdvanced={() => true}
      onNativeConversationChange={onNativeConversationChange}
    />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    fireEvent.click(screen.getByRole('tab', { name: 'Business Agents' }))
    expect(screen.getAllByRole('button', { name: 'Create Business Agent' })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Create Business Agent' })[1]!)
    expect(screen.getByRole('dialog', { name: 'What should your Agent do?' })).toHaveAttribute('aria-modal', 'true')
    fireEvent.change(screen.getByLabelText('Describe what it should accomplish'), { target: { value: 'Maintain product decisions with evidence' } })
    fireEvent.change(screen.getByLabelText('Agent name (editable later)'), { target: { value: 'PDM Assistant' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate Agent brief' }))
    expect(screen.getByRole('region', { name: 'Create Agent' })).not.toHaveAttribute('aria-modal')
    await waitFor(() => expect(fixture.runtime.author).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: null,
      prompt: 'Maintain product decisions with evidence',
    })))
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenCalledWith({
      sessionId: 'session-authoring', interactive: true,
    }))
    expect(screen.getByText('Harness native configuration conversation is on the right')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Business category'), { target: { value: 'Product & PDM' } })
    await waitFor(() => expect(fixture.runtime.watchAuthoringSession).toHaveBeenCalled())
    await act(async () => {
      fixture.emitAuthoringTurn({
        sessionId: 'session-authoring',
        turn: 2,
        endSeq: 8,
        text: 'I reviewed the business context and proposed a focused PDM brief.',
        proposal: { role: 'PDM analyst', goal: 'Maintain product decisions', behavior: 'Use product evidence' },
      })
    })
    await waitFor(() => expect(screen.getByLabelText('Role')).toHaveValue('PDM analyst'))
    expect(screen.getByLabelText('Goal')).toHaveValue('Maintain product decisions')
    expect(screen.getByLabelText('Behavior')).toHaveValue('Use product evidence')
    expect(fixture.runtime.author).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Creation assistant updated: Role, Goal, Behavior/)).toBeInTheDocument()
    expect(screen.getByText('Confirm this proposal first')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Business Agent' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep changes' }))
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
    const backToCenter = screen.getByRole('button', { name: 'Back to Center' })
    await waitFor(() => expect(backToCenter).toBeEnabled())
    fireEvent.click(backToCenter)
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Edit Agent' })).toBeNull())
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

    expect(await screen.findByRole('dialog', { name: 'What should your Agent do?' })).toBeInTheDocument()
    expect(screen.getByLabelText('Describe what it should accomplish')).toHaveValue('Review contracts and list business risks')
    expect(screen.getByRole('tab', { name: 'My Agents' })).toHaveAttribute('aria-selected', 'true')
    builderRequests.dispose()
    surface.dispose()
  })

  it('invalidates a v1 native Test Session after saving v2 and creates a fresh Session for the saved revision', async () => {
    const fixture = services()
    const presetApi = api()
    const onNativeConversationChange = vi.fn()
    fixture.runtime.beginTest
      .mockResolvedValueOnce('session-test-v1')
      .mockResolvedValueOnce('session-test-v2')
    fixture.profiles.saveProfile.mockImplementation(async input => ({ ok: true, value: {
      ...input,
      revision: 2,
      configVersion: 'v2-saved',
      updatedAt: 2,
      health: 'healthy' as const,
    } }))
    render(<AgentCenterSection
      close={() => {}}
      api={presetApi}
      profiles={fixture.profiles as never}
      skills={fixture.skills as never}
      runtime={fixture.runtime as never}
      locale={locale()}
      openAdvanced={() => true}
      onNativeConversationChange={onNativeConversationChange}
    />)
    await screen.findByRole('tab', { name: 'My Agents' })
    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(fixture.runtime.beginAuthoring).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenCalledWith({
      sessionId: 'session-authoring', interactive: true,
    }))
    expect(screen.getByText('Harness native configuration conversation is on the right')).toBeInTheDocument()

    const testTab = screen.getByRole('tab', { name: 'Test chat' })
    await waitFor(() => expect(testTab).not.toBeDisabled())
    fireEvent.click(testTab)
    await waitFor(() => expect(fixture.runtime.beginTest).toHaveBeenNthCalledWith(1,
      'mine', expect.objectContaining({ presetId: 'mine', configVersion: 'v1-a' }),
    ))
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenCalledWith({
      sessionId: 'session-test-v1', interactive: true,
    }))
    expect(screen.getByText('Harness native test conversation is on the right')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Configuration chat' }))
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Senior research reviewer' } })
    fireEvent.click(testTab)
    expect(screen.getByText('Save the Agent configuration first')).toBeInTheDocument()
    expect(onNativeConversationChange).toHaveBeenCalledWith({ sessionId: null, interactive: false })
    expect(fixture.runtime.beginTest).toHaveBeenCalledTimes(1)

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
    await waitFor(() => expect(fixture.runtime.beginTest).toHaveBeenNthCalledWith(2,
      'mine', expect.objectContaining({ presetId: 'mine', configVersion: 'v2-saved' }),
    ))
    await waitFor(() => expect(onNativeConversationChange).toHaveBeenCalledWith({
      sessionId: 'session-test-v2', interactive: true,
    }))
    expect(screen.getByText('Harness native test conversation is on the right')).toBeInTheDocument()
  })
  it('declares one combined Center surface with Remote, Workspace, and conversation dependencies', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'sessions', 'workspaces', 'conversation'])
  })

  it('reuses one native Conversation while switching configuration and test Sessions, then restores the opening Session', async () => {
    const fixture = services()
    let currentSessionId = 'session-original'
    fixture.runtime.currentSessionId.mockImplementation(() => currentSessionId)
    fixture.runtime.openSession.mockImplementation((sessionId: string) => {
      currentSessionId = sessionId
      return () => {}
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
    const trigger = screen.getByRole('button', { name: 'Open Agent Center' })
    expect(trigger.querySelector('svg')).not.toBeNull()
    fireEvent.click(trigger)
    const surface = await screen.findByRole('main', { name: 'Agent Center' })
    expect(center).toContainElement(surface)
    expect(surface.parentElement).toBe(center)
    expect(trigger).toHaveAttribute('aria-current', 'page')
    expect(trigger).not.toHaveAttribute('inert')
    expect(nativeConversation).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('')

    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(fixture.runtime.openSession).toHaveBeenCalledWith('session-authoring'))
    expect(currentSessionId).toBe('session-authoring')
    expect(center.querySelectorAll(':scope > [data-slot="conversation"]')).toHaveLength(1)
    expect(surface.querySelector('[data-slot="conversation"]')).toBeNull()
    expect(center).toHaveAttribute('data-paimind-product-center-native-conversation')
    expect(nativeConversation).not.toHaveAttribute('inert')
    expect(nativeConversation).not.toHaveAttribute('aria-hidden')

    fireEvent.click(screen.getByRole('tab', { name: 'Test chat' }))
    await waitFor(() => expect(fixture.runtime.beginTest).toHaveBeenCalledWith(
      'mine', expect.objectContaining({ presetId: 'mine', configVersion: 'v1-a' }),
    ))
    await waitFor(() => expect(fixture.runtime.openSession).toHaveBeenCalledWith('session-test'))
    expect(currentSessionId).toBe('session-test')
    expect(screen.getByText('Harness native test conversation is on the right')).toBeInTheDocument()
    expect(center.querySelectorAll(':scope > [data-slot="conversation"]')).toHaveLength(1)

    act(() => { controller.close() })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(screen.queryByRole('main', { name: 'Agent Center' })).toBeNull()
    expect(fixture.runtime.openSession).toHaveBeenLastCalledWith('session-original')
    expect(currentSessionId).toBe('session-original')
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
    let currentSessionId = 'session-original'
    fixture.runtime.currentSessionId.mockImplementation(() => currentSessionId)
    fixture.runtime.openSession.mockImplementation((sessionId: string) => {
      currentSessionId = sessionId
      return () => {}
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
    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    const starter = screen.getByRole('dialog', { name: 'What should your Agent do?' })
    fireEvent.keyDown(starter, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'What should your Agent do?' })).toBeNull())
    expect(screen.getByRole('main', { name: 'Agent Center' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    fireEvent.change(screen.getByLabelText('Describe what it should accomplish'), { target: { value: 'Review a business workflow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate Agent brief' }))
    const builder = screen.getByRole('region', { name: 'Create Agent' })
    await waitFor(() => expect(fixture.runtime.author).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Review a business workflow',
    })))
    await waitFor(() => expect(fixture.runtime.openSession).toHaveBeenCalledWith('session-authoring'))
    expect(nativeConversation).not.toHaveAttribute('inert')
    fireEvent.keyDown(builder, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Create Agent' })).toBeNull())
    expect(screen.getByRole('main', { name: 'Agent Center' })).toBeInTheDocument()
    await waitFor(() => expect(currentSessionId).toBe('session-original'))

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const editBuilder = await screen.findByRole('region', { name: 'Edit Agent' })
    await waitFor(() => expect(fixture.runtime.beginAuthoring).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(currentSessionId).toBe('session-authoring'))
    expect(nativeConversation).not.toHaveAttribute('inert')
    fireEvent.keyDown(nativeConversation, { key: 'Escape' })
    await waitFor(() => expect(editBuilder).not.toBeInTheDocument())
    expect(screen.getByRole('main', { name: 'Agent Center' })).toBeInTheDocument()
    await waitFor(() => expect(currentSessionId).toBe('session-original'))

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('main', { name: 'Agent Center' })).toBeNull())
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
    const starter = screen.getByRole('dialog', { name: 'What should your Agent do?' })
    await waitFor(() => expect(screen.getByLabelText('Describe what it should accomplish')).toHaveFocus())
    fireEvent.change(screen.getByLabelText('Describe what it should accomplish'), { target: { value: 'Help me focus' } })
    fireEvent.change(screen.getByLabelText('Agent name (editable later)'), { target: { value: 'Focus helper' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate Agent brief' }))
    const builder = screen.getByRole('region', { name: 'Create Agent' })
    expect(builder).not.toHaveAttribute('aria-modal')
    await waitFor(() => expect(fixture.runtime.author).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Help me focus',
    })))
    await waitFor(() => expect(screen.getByText('Harness native configuration conversation is on the right')).toBeInTheDocument())
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
    expect(AGENT_CENTER_STYLE).toMatch(/\[data-paimind-product-surface='agent-center'\] \[data-paimind-agent-skills-panel\] \{[\s\S]*height: max-content;[\s\S]*min-height: 76px;[\s\S]*display: grid;[\s\S]*overflow: clip;/)
    expect(AGENT_CENTER_STYLE).toContain('@media(max-width:680px)')
    expect(AGENT_CENTER_STYLE).toContain('@media(prefers-reduced-motion:reduce)')
    expect(AGENT_CENTER_STYLE).toContain('[data-paimind-agent-avatar-seat]')
    expect(AGENT_CENTER_STYLE).toContain('[data-paimind-agent-avatar]')
  })

  it('registers native product surfaces and a compact Proposal Tool row that never renders raw arguments', async () => {
    const fixture = services()
    const registered: string[] = []
    const registrations: Array<{
      readonly options: Readonly<Record<string, unknown>>
      readonly component: ComponentType<Record<string, unknown>>
    }> = []
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
        register(options: Readonly<Record<string, unknown>>, component: ComponentType<Record<string, unknown>>) {
          registrations.push({ options, component })
          return () => {}
        },
      },
      effect(install: () => void | (() => void)) { const disposer = install(); if (typeof disposer === 'function') disposers.push(disposer) },
      inject(_dependencies: readonly string[], install: (scope: unknown) => void) {
        install(context)
        return Object.assign(Promise.resolve(), { dispose: async () => { for (const dispose of disposers.reverse()) await dispose() } })
      },
    }

    const dispose = await apply(context as never)
    expect(registered).toEqual(['paimind.extension', 'tool.call.toolview', 'sidebar.footer.action', 'shell.overlay'])
    expect(registered).not.toContain('settings.section')
    const proposalRow = registrations.find(entry => entry.options.key === AGENT_AUTHORING_PROPOSAL_TOOL)
    expect(proposalRow).toBeDefined()
    const rawArguments = '{"name":"NEVER_RENDER_THIS_SECRET"}'
    const row = render(createElement(proposalRow!.component, { block: {
      callId: 'proposal-1', name: AGENT_AUTHORING_PROPOSAL_TOOL, argsRaw: rawArguments,
    } }))
    expect(screen.getByRole('status', { name: 'Generating configuration proposal' })).toBeInTheDocument()
    expect(screen.queryByText(/NEVER_RENDER_THIS_SECRET/)).toBeNull()
    row.rerender(createElement(proposalRow!.component, { block: {
      kind: 'tool-result', callId: 'proposal-1', isError: false,
      call: { name: AGENT_AUTHORING_PROPOSAL_TOOL, argsRaw: rawArguments },
      content: [{ type: 'text', text: 'NEVER_RENDER_RESULT_SECRET' }],
    } }))
    expect(screen.getByRole('status', { name: 'Configuration proposal ready for review' })).toBeInTheDocument()
    expect(screen.queryByText(/NEVER_RENDER_(THIS|RESULT)_SECRET/)).toBeNull()
    expect(document.getElementById('@paimind/agent-market')).not.toBeNull()
    await dispose()
    expect(document.getElementById('@paimind/agent-market')).toBeNull()
  })
})
