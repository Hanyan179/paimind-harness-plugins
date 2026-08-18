import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HarnessAgentPresetApi, PaimindLocaleSource } from '@paimind/harness-compat'
import { PaimindProductSurfaceController } from '@paimind/harness-compat/client-surface'
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
    runtime: { subscribe: () => () => {}, getSnapshot: () => runtimeSnapshot, start: vi.fn().mockResolvedValue('session-new') },
  }
}

afterEach(() => { cleanup(); document.head.querySelectorAll('style[data-paimind-plugin="@paimind/agent-market"]').forEach(node => { node.remove() }) })

describe('Agent Center business UI', () => {
  it('stacks the shared footer actions in expanded and collapsed sidebars', () => {
    expect(AGENT_CENTER_STYLE).toContain("button[data-paimind-product-trigger][data-wide='true']){width:100%!important;height:auto!important;flex-direction:column!important")
    expect(AGENT_CENTER_STYLE).toContain("button[data-paimind-product-trigger][data-wide='false']){width:36px!important;height:auto!important;flex-direction:column!important")
  })

  it('is the only business entry, splits Platform and My Agents, and hides internal ids and hashes', async () => {
    const fixture = services()
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Standard' })).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Creator' })).toBeInTheDocument()
    expect(screen.queryByText(/preset id|hash|file path|config version/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    expect(screen.getByRole('heading', { name: 'Research Agent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Personal Agent' })).toBeInTheDocument()
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

  it('opens native advanced configuration and prevents Skill selection for Minimal', async () => {
    const fixture = services(); const openAdvanced = vi.fn(() => true)
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={openAdvanced} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Advanced configuration' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Advanced configuration' }))
    expect(openAdvanced).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Personal Agent' }))
    fireEvent.change(screen.getByLabelText('Runtime mode'), { target: { value: 'minimal' } })
    expect(screen.getByText(/Minimal mode does not inject Skills/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Session-injected Skills' })).toBeDisabled()
  })

  it('shows platform modes and business Agents without explanatory category copy', async () => {
    const fixture = services()
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Standard' })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Platform modes' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Business Agents' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByText(/General, PDM, and AIM are business categories/)).toBeNull()
    expect(screen.queryByText(/Category is not mode/)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Business Agents' }))
    expect(screen.getByText('No Business Agents yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Platform modes' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy and edit' })[0]!)
    expect(screen.getByRole('heading', { name: 'Copy and edit' })).toBeInTheDocument()
    expect(screen.getByLabelText('Runtime mode')).toHaveValue('standard')
    expect(screen.getByText(/official original will not be changed/)).toBeInTheDocument()
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
    await screen.findByRole('heading', { name: 'Standard' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy and edit' })[0]!)
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Product analyst' } })
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Deliver validated product analysis' } })
    fireEvent.change(screen.getByLabelText('Behavior'), { target: { value: 'Use evidence and state uncertainty' } })
    expect(screen.getByText(/Other installed Skills remain discoverable in Skill Center but are not injected/)).toBeInTheDocument()
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
    await screen.findByRole('heading', { name: 'Standard' })
    fireEvent.click(screen.getByRole('tab', { name: 'Business Agents' }))
    expect(screen.getAllByRole('button', { name: 'Create Business Agent' })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Create Business Agent' })[1]!)
    expect(screen.getByRole('complementary', { name: 'Create Business Agent' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'PDM Assistant' } })
    fireEvent.change(screen.getByLabelText('Business category'), { target: { value: 'Product & PDM' } })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'PDM analyst' } })
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Maintain product decisions' } })
    fireEvent.change(screen.getByLabelText('Behavior'), { target: { value: 'Use product evidence' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Business Agent' }))

    await waitFor(() => expect(presetApi.copy).toHaveBeenCalledWith(expect.objectContaining({ from: 'standard' })))
    expect(fixture.profiles.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      presetId: copiedPresetId, productKind: 'business', businessCategory: 'Product & PDM', basePresetId: 'standard',
    }))
    expect(await screen.findByRole('heading', { name: 'PDM Assistant' })).toBeInTheDocument()
    expect(screen.getByText('Business Agent · Locally managed')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Business category' })).toHaveValue('all')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const builder = screen.getByRole('complementary', { name: 'Edit Business Agent' })
    expect(builder).toBeInTheDocument()
    expect(within(builder).getByRole('combobox', { name: 'Business category' })).toHaveValue('Product & PDM')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }))
    await waitFor(() => expect(fixture.runtime.start).toHaveBeenCalledWith(
      copiedPresetId, expect.objectContaining({ productKind: 'business', businessCategory: 'Product & PDM' }),
    ))
  })

  it('declares one combined Center surface with Remote, Workspace, and conversation dependencies', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'sessions', 'workspaces', 'conversation'])
  })

  it('opens from the native sidebar action as a full-page surface and restores focus', async () => {
    const fixture = services()
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    render(<>
      <AgentCenterTrigger wide controller={controller} locale={locale()} />
      <AgentCenterSurface controller={controller} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />
    </>)
    const trigger = screen.getByRole('button', { name: 'Open Agent Center' })
    expect(trigger.querySelector('svg')).not.toBeNull()
    fireEvent.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'Agent Center' })).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Close Agent Center' }))
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(screen.queryByRole('dialog', { name: 'Agent Center' })).toBeNull()
    controller.dispose()
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
    await dispose()
  })
})
