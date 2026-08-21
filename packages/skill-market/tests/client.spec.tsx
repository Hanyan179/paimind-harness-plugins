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
    inspectUpload: vi.fn(), installUpload: vi.fn().mockResolvedValue({ ok: true, value: { operation: 'installed', record: { skillId: 'openai-docs' } } }),
    uninstall: vi.fn().mockResolvedValue({ ok: true, value: { skillId: 'openai-docs', removedAt: 1, recoverable: true } }),
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
    expect(SKILL_CENTER_STYLE).toContain("button[data-paimind-product-trigger='skill-center'][data-wide='true']){width:100%!important;height:auto!important;flex-direction:column!important")
    expect(SKILL_CENTER_STYLE).toContain("button[data-paimind-product-trigger='skill-center'][data-wide='false']){width:36px!important;height:auto!important;flex-direction:column!important")
  })

  it('scopes the Center CSS and confines responsive detail to its native column', () => {
    expect(SKILL_CENTER_STYLE).toContain("[data-paimind-product-surface='skill-center']{")
    expect(SKILL_CENTER_STYLE).toContain('position:absolute;inset:0')
    expect(SKILL_CENTER_STYLE).toContain("@scope ([data-paimind-product-surface='skill-center'])")
    expect(SKILL_CENTER_STYLE).toContain('[data-paimind-skill-detail]{position:absolute;inset:0')
    expect(SKILL_CENTER_STYLE).not.toContain('[data-paimind-skill-detail]{position:fixed')
    expect(SKILL_CENTER_STYLE).not.toContain('[data-paimind-product-bar]')
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

  it('uses one catalog, installed, and favorites scope without depending on the current Session catalog', async () => {
    const native = runtime()
    render(<SkillMarketSection close={() => {}} api={api()} installer={installer() as never} sessions={native.sessions} conversation={native.conversation} locale={locale()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'View: openai-docs' })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Catalog' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Installed' })).toBeInTheDocument()
    expect(screen.queryByText(/runtime id|host path|not exposed|hash/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    expect(screen.getByText(/No personal Skills installed/)).toBeInTheDocument()
  })

  it('supports roving keyboard navigation across the single scope tablist', async () => {
    const native = runtime()
    render(<SkillMarketSection close={() => {}} api={api()} installer={installer() as never} sessions={native.sessions} conversation={native.conversation} locale={locale()} />)
    await screen.findByRole('button', { name: 'View: openai-docs' })
    const catalog = screen.getByRole('tab', { name: 'Catalog' })
    catalog.focus()
    fireEvent.keyDown(catalog, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Installed' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Installed' })).toHaveFocus()
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
    const dialog = await screen.findByRole('dialog', { name: 'Install openai-docs' })
    expect(host.inspectCatalog).toHaveBeenCalledWith({ catalogId: 'openai-docs', version: '1.0.0' })
    const confirm = screen.getByRole('button', { name: 'Confirm install' })
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(confirm).toHaveFocus())
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(cancel).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(confirm).toHaveFocus()
    fireEvent.click(confirm)
    await waitFor(() => expect(host.installUpload).toHaveBeenCalled())
  })

  it('explains the local Skill package contract before opening the file picker', async () => {
    const native = runtime(); const host = installer()
    render(<SkillMarketSection close={() => {}} api={api()} installer={host as never} sessions={native.sessions} conversation={native.conversation} locale={locale()} />)
    await screen.findByRole('button', { name: 'Import local Skill' })
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    const openPicker = vi.spyOn(input, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Import local Skill' }))
    const dialog = screen.getByRole('dialog', { name: 'Choose a recognizable Skill package' })
    expect(dialog).toHaveTextContent('YAML frontmatter')
    expect(dialog).toHaveTextContent('SKILL.md')
    expect(dialog).toHaveTextContent('scripts/')
    expect(dialog).toHaveTextContent('personal Skill scope')
    expect(host.inspectUpload).not.toHaveBeenCalled()
    const choose = screen.getByRole('button', { name: 'Choose Skill package' })
    await waitFor(() => expect(choose).toHaveFocus())
    fireEvent.click(choose)
    expect(openPicker).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: 'Choose a recognizable Skill package' })).toBeNull()
  })

  it('does not offer a redundant catalog update when package digests match', async () => {
    const native = runtime()
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
    render(<SkillMarketSection close={() => {}} api={api()} installer={installer(installed) as never} sessions={native.sessions} conversation={native.conversation} locale={locale()} />)
    await screen.findByRole('button', { name: 'View: openai-docs' })
    const current = screen.getByRole('button', { name: 'Catalog version is current' })
    expect(current).toBeDisabled()
  })

  it('requires an explicit recoverable-uninstall confirmation', async () => {
    const native = runtime(); const host = installer([{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }])
    render(<SkillMarketSection close={() => {}} api={api()} installer={host as never} sessions={native.sessions} conversation={native.conversation} locale={locale()} />)
    await screen.findByRole('button', { name: 'View: openai-docs' })
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    expect(screen.getByRole('dialog', { name: 'Uninstall openai-docs' })).toBeInTheDocument()
    expect(host.uninstall).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall with backup' }))
    await waitFor(() => expect(host.uninstall).toHaveBeenCalledWith({ skillId: 'openai-docs', version: `sha256:${'a'.repeat(64)}` }))
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

  it('opens from the native sidebar action inside the native center column', async () => {
    const native = runtime()
    const controller = new PaimindProductSurfaceController('skill-center', window, document)
    render(<>
      <SkillCenterTrigger wide={false} controller={controller} locale={locale()} />
      <div data-testid="harness-center"><section data-slot="conversation"><div>Native conversation</div></section></div>
      <SkillCenterSurface controller={controller} api={api()} installer={installer() as never} sessions={native.sessions} conversation={native.conversation} locale={locale()} />
    </>)
    const trigger = screen.getByRole('button', { name: 'Open Skill Center' })
    expect(trigger.querySelector('svg')).not.toBeNull()
    fireEvent.click(trigger)
    const surface = await screen.findByRole('main', { name: 'Skill Center' })
    const center = screen.getByTestId('harness-center')
    const conversationContent = screen.getByText('Native conversation')
    const conversation = conversationContent.closest<HTMLElement>('[data-slot="conversation"]')!
    expect(surface.parentElement).toBe(center)
    expect(conversationContent).toHaveAttribute('data-paimind-product-center-native-conversation-content')
    expect(conversation).toHaveAttribute('inert')
    expect(conversation).toHaveAttribute('aria-hidden', 'true')
    expect(trigger).toHaveAttribute('aria-current', 'page')
    expect(surface.querySelector('[data-paimind-product-bar]')).toBeNull()
    expect(surface.querySelector('[data-paimind-product-return]')).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Skill Center' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('main', { name: 'Skill Center' })).toBeInTheDocument()
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.queryByRole('main', { name: 'Skill Center' })).toBeNull())
    expect(conversation).not.toHaveAttribute('inert')
    expect(conversation).not.toHaveAttribute('aria-hidden')
    expect(conversationContent).not.toHaveAttribute('data-paimind-product-center-native-conversation-content')
    expect(trigger).not.toHaveAttribute('aria-current')
    controller.dispose()
  })

  it('fails closed without a unique native conversation host', async () => {
    const native = runtime()
    const controller = new PaimindProductSurfaceController('skill-center', window, document)
    render(<>
      <SkillCenterTrigger wide controller={controller} locale={locale()} />
      <SkillCenterSurface controller={controller} api={api()} installer={installer() as never} sessions={native.sessions} conversation={native.conversation} locale={locale()} />
    </>)
    const trigger = screen.getByRole('button', { name: 'Open Skill Center' })
    fireEvent.click(trigger)
    await waitFor(() => expect(trigger).not.toHaveAttribute('aria-current'))
    expect(screen.queryByRole('main', { name: 'Skill Center' })).toBeNull()
    expect(document.body.querySelector('[data-paimind-product-surface="skill-center"]')).toBeNull()
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
