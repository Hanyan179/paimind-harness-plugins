import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  HarnessConversationDraftService,
  HarnessSessionListSnapshot,
  HarnessSessionService,
  HarnessSkillsApi,
  PaimindLocaleSource,
} from '@paimind/harness-compat'
import { SkillMarketSection, inject } from '../src/client/index.js'

const skills = [
  { name: 'openai-docs', description: 'Find official documentation', whenToUse: 'Use for OpenAI questions', modelInvocable: true },
  { name: 'private-review', description: 'Review sensitive input', modelInvocable: false },
] as const

const recommendations = [
  { id: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', version: '1.0.0', source: 'OpenAI Official · Adapted for Harness', license: 'Apache-2.0', digest: `sha256:${'a'.repeat(64)}` },
  { id: 'skill-creator', name: 'skill-creator', description: 'Create Skills', version: '1.0.0', source: 'OpenAI Official · Adapted for Harness', license: 'Apache-2.0', digest: `sha256:${'b'.repeat(64)}` },
] as const

function api(): HarnessSkillsApi {
  return { list: vi.fn().mockResolvedValue({ result: { ok: true, value: { skills } } }) }
}

function installer(items: readonly unknown[] = []) {
  return {
    listCatalog: vi.fn().mockResolvedValue({ ok: true, value: { items: recommendations } }),
    listInstalled: vi.fn().mockResolvedValue({ ok: true, value: { items } }),
    inspectCatalog: vi.fn().mockResolvedValue({ ok: true, value: {
      uploadId: 'db13cad0-4d50-49ef-aa51-17fc1339d9f3', digest: `sha256:${'a'.repeat(64)}`, fileName: 'openai-docs-1.0.0.zip', kind: 'zip',
      name: 'openai-docs', description: 'Find official documentation', fileCount: 3, compressedBytes: 10, expandedBytes: 30, operation: 'install', warnings: [],
    } }),
    inspectUpload: vi.fn(), installUpload: vi.fn().mockResolvedValue({ ok: true, value: { operation: 'installed', record: {} } }), uninstall: vi.fn(),
  }
}

function locale(active = 'en-US'): PaimindLocaleSource {
  return { getLocale: () => ({ active }), subscribe: () => () => {} }
}

function runtime(): { sessions: HarnessSessionService; conversation: HarnessConversationDraftService; setDraft: ReturnType<typeof vi.fn> } {
  const snapshot: HarnessSessionListSnapshot = { current: 'session-1', byId: { 'session-1': { running: false, blank: false, agentPreset: 'standard' } }, jobsBySession: {} }
  const context = {}; const setDraft = vi.fn()
  return {
    sessions: { list: { getSnapshot: () => snapshot, subscribe: () => () => {} }, open: () => {}, binding: () => ({ ctx: context, session: { getSnapshot: () => ({}) as never, subscribe: () => () => {} } }) },
    conversation: { input: { for: () => ({ setDraft }) } }, setDraft,
  }
}

afterEach(() => { cleanup(); document.head.querySelectorAll('style[data-paimind-plugin="@paimind/skill-market"]').forEach(node => { node.remove() }) })

describe('Skill Market business UI', () => {
  it('separates Recommended and Installed, and does not depend on the current Session catalog', async () => {
    const native = runtime()
    render(<SkillMarketSection close={() => {}} api={api()} installer={installer() as never} sessions={native.sessions} conversation={native.conversation} locale={locale()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'View: openai-docs' })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Recommended' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Installed' })).toBeInTheDocument()
    expect(screen.queryByText(/runtime id|host path|not exposed|hash/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    expect(screen.getByText('No personal Skills installed.')).toBeInTheDocument()
  })

  it('uses the native slash invocation without a second runtime registry', async () => {
    const native = runtime(); const close = vi.fn()
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}` }]
    render(<SkillMarketSection close={close} api={api()} installer={installer(installed) as never} sessions={native.sessions} conversation={native.conversation} locale={locale()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'View: openai-docs' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'View: openai-docs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use in conversation' }))
    expect(native.setDraft).toHaveBeenCalledWith('/openai-docs ')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('reviews a recommended package before installing through the shared installer', async () => {
    const native = runtime(); const host = installer()
    render(<SkillMarketSection close={() => {}} api={api()} installer={host as never} sessions={native.sessions} conversation={native.conversation} locale={locale()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review and install' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Review and install' }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'Install confirmation' })).toBeInTheDocument())
    expect(host.inspectCatalog).toHaveBeenCalledWith({ catalogId: 'openai-docs', version: '1.0.0' })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(host.installUpload).toHaveBeenCalled())
  })

  it('declares the Remote and business surface dependencies', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'sessions', 'conversation'])
  })
})
