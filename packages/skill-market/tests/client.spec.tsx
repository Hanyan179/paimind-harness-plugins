import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  HarnessConversationDraftService,
  HarnessSessionListSnapshot,
  HarnessSessionService,
  HarnessSkillsApi,
  PaimindLocaleSource,
} from '@paimind/harness-compat'
import { PaimindProductSurfaceController } from '@paimind/harness-compat/client-surface'
import {
  SkillCenterSurface,
  SkillCenterTrigger,
  SkillMarketSection,
  apply,
  inject,
  installSkillMarketStyle,
} from '../src/client/index.js'
import { SKILL_CENTER_STYLE } from '../src/client/styles.js'

const skills = [
  { name: 'openai-docs', description: 'Find official documentation', whenToUse: 'Use for OpenAI questions', modelInvocable: true },
  { name: 'private-review', description: 'Review sensitive input', modelInvocable: false },
] as const

const recommendations = [
  { id: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', version: '1.0.0', source: 'OpenAI Official · Adapted for Harness', license: 'Apache-2.0', digest: `sha256:${'a'.repeat(64)}` },
  { id: 'skill-creator', name: 'skill-creator', description: 'Create Skills', version: '1.0.0', source: 'PAIMind', license: 'Apache-2.0', digest: `sha256:${'b'.repeat(64)}` },
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
      runtimeRequirements: [],
    } }),
    inspectUpload: vi.fn(), installUpload: vi.fn().mockResolvedValue({ ok: true, value: { operation: 'installed', record: {} } }), uninstall: vi.fn(),
  }
}

function locale(active = 'en-US'): PaimindLocaleSource {
  return { getLocale: () => ({ active }), subscribe: () => () => {} }
}

function runtime(current: string | undefined | null = 'session-1'): { sessions: HarnessSessionService; conversation: HarnessConversationDraftService; setDraft: ReturnType<typeof vi.fn> } {
  if (current === null) current = undefined
  const snapshot: HarnessSessionListSnapshot = { current, byId: current === undefined ? {} : { [current]: { running: false, blank: false, agentPreset: 'standard' } }, jobsBySession: {} }
  const context = {}; const setDraft = vi.fn()
  return {
    sessions: { list: { getSnapshot: () => snapshot, subscribe: () => () => {} }, open: () => {}, binding: () => ({ ctx: context, session: { getSnapshot: () => ({}) as never, subscribe: () => () => {} } }) },
    conversation: { input: { for: () => ({ setDraft }) } }, setDraft,
  }
}

afterEach(() => { cleanup(); document.head.querySelectorAll('style[data-paimind-plugin="@paimind/skill-market"]').forEach(node => { node.remove() }) })

describe('Skill Market business UI', () => {
  it('stacks the shared footer actions in expanded and collapsed sidebars', () => {
    expect(SKILL_CENTER_STYLE).toContain("button[data-paimind-product-trigger][data-wide='true']){width:100%!important;height:auto!important;flex-direction:column!important")
    expect(SKILL_CENTER_STYLE).toContain("button[data-paimind-product-trigger][data-wide='false']){width:36px!important;height:auto!important;flex-direction:column!important")
  })

  it('keeps its stylesheet while overlapping plugin lifecycles hand over ownership', () => {
    const disposeFirst = installSkillMarketStyle()
    const disposeSecond = installSkillMarketStyle()
    const style = document.head.querySelector('style[data-paimind-plugin="@paimind/skill-market"]')
    expect(style).not.toBeNull()
    expect(style).toHaveAttribute('data-paimind-style-refs', '2')
    disposeFirst()
    expect(document.head.contains(style)).toBe(true)
    expect(style).toHaveAttribute('data-paimind-style-refs', '1')
    disposeSecond()
    expect(document.head.contains(style)).toBe(false)
  })

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
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
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

  it('filters real catalog fields and persists favorites without inventing usage data', async () => {
    const native = runtime()
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() }
    render(<SkillMarketSection close={() => {}} api={api()} installer={installer() as never} sessions={native.sessions} conversation={native.conversation} locale={locale()} storage={storage} />)
    await screen.findByRole('button', { name: 'View: openai-docs' })
    fireEvent.change(screen.getByLabelText('Filter by source'), { target: { value: 'PAIMind' } })
    expect(screen.queryByRole('button', { name: 'View: openai-docs' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View: skill-creator' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Favorite: skill-creator' }))
    expect(storage.setItem).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Favorites only' }))
    expect(screen.getByRole('button', { name: 'View: skill-creator' })).toBeInTheDocument()
  })

  it('explains why current-conversation use is disabled when no Session exists', async () => {
    const native = runtime(null)
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
    render(<SkillMarketSection close={() => {}} api={api()} installer={installer(installed) as never} sessions={native.sessions} conversation={native.conversation} locale={locale()} />)
    await screen.findByRole('button', { name: 'View: openai-docs' })
    const use = screen.getByRole('button', { name: 'Use in conversation' })
    expect(use).toBeDisabled()
    expect(use).toHaveAttribute('title', 'Open a conversation to check')
  })

  it('opens from the native sidebar action as a full-page surface', async () => {
    const native = runtime()
    const controller = new PaimindProductSurfaceController('skill-center', window, document)
    render(<>
      <SkillCenterTrigger wide={false} controller={controller} locale={locale()} />
      <SkillCenterSurface controller={controller} api={api()} installer={installer() as never} sessions={native.sessions} conversation={native.conversation} locale={locale()} />
    </>)
    const trigger = screen.getByRole('button', { name: 'Open Skill Center' })
    expect(trigger.querySelector('svg')).not.toBeNull()
    fireEvent.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'Skill Center' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Skill Center' })).toBeNull())
    controller.dispose()
  })

  it('registers only the native sidebar and shell overlay product surfaces', async () => {
    const native = runtime()
    const host = installer()
    const registered: string[] = []
    const disposers: Array<() => void | Promise<void>> = []
    const remote = {
      async $mount() { Object.assign(remote, { paimindSkillInstaller: host }); return () => {} },
    }
    const context = {
      remote,
      locale: locale(),
      sessions: native.sessions,
      conversation: native.conversation,
      get: () => ({ api: { skills: api() } }),
      reflect: { provide: () => () => {} },
      slots: {
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
