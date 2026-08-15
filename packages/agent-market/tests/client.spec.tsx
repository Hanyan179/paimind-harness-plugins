import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HarnessAgentPresetApi, PaimindLocaleSource } from '@paimind/harness-compat'
import { AgentCenterSection, inject } from '../src/client/index.js'

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
    skills: { listInstalled: vi.fn().mockResolvedValue({ ok: true, value: { items: [{ name: 'web-research' }] } }) },
    runtime: { subscribe: () => () => {}, getSnapshot: () => runtimeSnapshot, start: vi.fn().mockResolvedValue('session-new') },
  }
}

afterEach(() => { cleanup(); document.head.querySelectorAll('style[data-paimind-plugin="@paimind/agent-market"]').forEach(node => { node.remove() }) })

describe('Agent Center business UI', () => {
  it('is the only business entry, splits Platform and My Agents, and hides internal ids and hashes', async () => {
    const fixture = services()
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={() => true} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Standard' })).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Creator' })).toBeInTheDocument()
    expect(screen.queryByText(/preset id|hash|file path|config version/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    expect(screen.getByRole('heading', { name: 'Research Agent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Agent' })).toBeInTheDocument()
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

  it('opens native advanced configuration and prevents Skill selection for Minimal', async () => {
    const fixture = services(); const openAdvanced = vi.fn(() => true)
    render(<AgentCenterSection close={() => {}} api={api()} profiles={fixture.profiles as never} skills={fixture.skills as never} runtime={fixture.runtime as never} locale={locale()} openAdvanced={openAdvanced} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Advanced configuration' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Advanced configuration' }))
    expect(openAdvanced).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('tab', { name: 'My Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' }))
    fireEvent.change(screen.getByLabelText('Base template'), { target: { value: 'minimal' } })
    expect(screen.getByText(/Minimal mode does not load Skills/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Preferred installed Skills' })).toBeDisabled()
  })

  it('declares one combined Center surface with Remote, Workspace, and conversation dependencies', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'sessions', 'workspaces', 'conversation'])
  })
})
