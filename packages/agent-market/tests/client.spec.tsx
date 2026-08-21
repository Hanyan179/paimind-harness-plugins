import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  return {
    profiles: {
      listProfiles: vi.fn().mockResolvedValue({ ok: true, value: { profiles: [profile] } }),
      saveProfile: vi.fn(), setDefault: vi.fn(), bindSession: vi.fn(), migrationPlan: vi.fn(), recordMigration: vi.fn(), verifySession: vi.fn(), listAudit: vi.fn(),
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
      test: vi.fn().mockResolvedValue('session-test'),
      sessionState: vi.fn(() => ({ running: true, completed: false, error: null })),
      subscribeSessions: vi.fn(() => () => {}),
      openSession: vi.fn(),
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

  it('starts a real runtime conversation from a personal Agent', async () => {
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
    expect(setDraft).toHaveBeenCalledWith('请介绍一下你可以如何帮助我，并给出一个简短示例。')
    runtime.dispose()
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

  it('shows platform modes and business Agents without explanatory category copy', async () => {
    const fixture = services()
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await screen.findByRole('heading', { name: 'Research Agent' })
    fireEvent.click(screen.getByRole('tab', { name: 'Platform modes' }))
    expect(screen.getByRole('heading', { name: 'Standard' })).toBeInTheDocument()
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
    expect(screen.getByRole('heading', { name: 'Standard' })).toBeInTheDocument()
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
    expect(screen.getByRole('dialog', { name: 'What should your Agent do?' })).toHaveAttribute('aria-modal', 'true')
    fireEvent.change(screen.getByLabelText('Describe what it should accomplish'), { target: { value: 'Maintain product decisions with evidence' } })
    fireEvent.change(screen.getByLabelText('Agent name (editable later)'), { target: { value: 'PDM Assistant' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate Agent brief' }))
    expect(screen.getByRole('region', { name: 'Create Agent' })).not.toHaveAttribute('aria-modal')
    fireEvent.change(screen.getByLabelText('Business category'), { target: { value: 'Product & PDM' } })
    fireEvent.change(screen.getByPlaceholderText(/Tell me what to adjust/), { target: { value: 'Role: PDM analyst\nGoal: Maintain product decisions\nBehavior: Use product evidence' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send configuration message' }))
    expect(screen.getByLabelText('Role')).toHaveValue('PDM analyst')
    expect(screen.getByLabelText('Goal')).toHaveValue('Maintain product decisions')
    expect(screen.getByLabelText('Behavior')).toHaveValue('Use product evidence')
    expect(screen.getByText(/Creation assistant updated: Role, Goal, Behavior/)).toBeInTheDocument()
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

    expect(await screen.findByRole('dialog', { name: 'What should your Agent do?' })).toBeInTheDocument()
    expect(screen.getByLabelText('Describe what it should accomplish')).toHaveValue('Review contracts and list business risks')
    expect(screen.getByRole('tab', { name: 'My Agents' })).toHaveAttribute('aria-selected', 'true')
    builderRequests.dispose()
    surface.dispose()
  })

  it('gates Test Chat on saved state and runs the same edited Preset without copying', async () => {
    const fixture = services()
    const presetApi = api()
    fixture.profiles.saveProfile.mockImplementation(async input => ({ ok: true, value: {
      ...input,
      revision: 2,
      configVersion: 'v2-saved',
      updatedAt: 2,
      health: 'healthy' as const,
    } }))
    render(<AgentCenterSection close={() => {}} api={presetApi} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await screen.findByRole('tab', { name: 'My Agents' })
    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    fireEvent.click(screen.getByRole('tab', { name: 'Test chat' }))
    expect(screen.queryByText('Save the Agent configuration first')).toBeNull()
    expect(screen.getByPlaceholderText('Enter a test question…')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Configuration chat' }))
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Senior research reviewer' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Test chat' }))
    expect(screen.getByText('Save the Agent configuration first')).toBeInTheDocument()
    expect(screen.getByText(/same saved Agent Preset/)).toBeInTheDocument()

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
    fireEvent.change(screen.getByPlaceholderText('Enter a test question…'), { target: { value: 'Give me a two-step review plan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send test message' }))
    await waitFor(() => expect(fixture.runtime.test).toHaveBeenCalledWith(
      'mine', expect.objectContaining({ presetId: 'mine', configVersion: 'v2-saved' }), 'Give me a two-step review plan',
    ))
    expect(screen.getByRole('button', { name: 'Open full test conversation' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open full test conversation' }))
    expect(fixture.runtime.openSession).toHaveBeenCalledWith('session-test')
  })

  it('declares one combined Center surface with Remote, Workspace, and conversation dependencies', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'sessions', 'workspaces', 'conversation'])
  })

  it('mounts inside the native center column, keeps the sidebar interactive, and restores the conversation', async () => {
    const fixture = services()
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    const center = document.createElement('main')
    const nativeConversation = document.createElement('div')
    nativeConversation.dataset.slot = 'conversation'
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
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(screen.queryByRole('main', { name: 'Agent Center' })).toBeNull()
    expect(nativeConversation).not.toHaveAttribute('inert')
    expect(nativeConversation).not.toHaveAttribute('aria-hidden')
    controller.dispose()
  })

  it('closes only the starter or Builder on their first Escape inside the combined Center surface', async () => {
    const fixture = services()
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    const center = document.createElement('main')
    const nativeConversation = document.createElement('div')
    nativeConversation.dataset.slot = 'conversation'
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
    fireEvent.keyDown(builder, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Create Agent' })).toBeNull())
    expect(screen.getByRole('main', { name: 'Agent Center' })).toBeInTheDocument()

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
    await waitFor(() => expect(screen.getByPlaceholderText(/Tell me what to adjust/)).toHaveFocus())
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
      get: () => ({ api: { agentPresets: api() } }),
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
