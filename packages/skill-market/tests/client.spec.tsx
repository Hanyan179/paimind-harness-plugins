import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  HarnessSessionListSnapshot,
  HarnessSessionService,
  PaimindLocaleSource,
} from '@hansen/harness-compat'
import { PaimindProductSurfaceController } from '@hansen/harness-compat/client-surface'
import {
  SkillCenterSurface,
  SkillCenterTrigger,
  SkillMarketSection,
  apply,
  inject,
  installSkillAuthoringDraftNavigation,
  installSkillMarketStyle,
} from '../src/client/index.js'
import { SKILL_CENTER_STYLE } from '../src/client/styles.js'

const recommendations = [
  { id: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', version: '1.0.0', source: 'OpenAI Official · Adapted for Harness', license: 'Apache-2.0', digest: `sha256:${'a'.repeat(64)}`, category: 'research', tags: ['official-docs', 'research'] },
  { id: 'bento-ppt', name: 'bento-ppt', description: 'Create presentations', version: '1.0.0', source: 'PAIMind', license: 'Internal', digest: `sha256:${'b'.repeat(64)}`, category: 'content', tags: ['artifact', 'presentation'] },
] as const

const builtInSkills = [
  {
    kind: 'system', canonicalId: 'system:genui', name: 'genui', description: 'Generate structured UI',
    availability: 'optional', userControl: 'atomic', sourcePluginId: '@deepseek-ai/dsh-tool-genui',
  },
  {
    kind: 'system', canonicalId: 'system:paimind-skill-installation', name: 'paimind-skill-installation', description: 'Install Business Skills from GitHub',
    availability: 'optional', userControl: 'atomic', sourcePluginId: '@hansen/skill-market',
  },
] as const

function installer(items: readonly unknown[] = [], systemItems: readonly unknown[] = builtInSkills) {
  let policy = {
    schema: 'paimind.user-skill-policy/v1' as const,
    revision: 0,
    enabledOptionalSystemSkillNames: [] as readonly string[],
    enabledBusinessSkillNames: items.map(item => (item as { name: string }).name),
    directBusinessSkillNames: [] as readonly string[],
  }
  let sessionSelection = {
    schema: 'paimind.session-business-skill-selection/v1' as const,
    revision: 0,
    skillNames: [] as readonly string[],
  }
  return {
    listCatalog: vi.fn().mockResolvedValue({ ok: true, value: { items: recommendations } }),
    listInstalled: vi.fn().mockResolvedValue({ ok: true, value: { items } }),
    inspectCatalog: vi.fn().mockResolvedValue({ ok: true, value: {
      uploadId: 'db13cad0-4d50-49ef-aa51-17fc1339d9f3', digest: `sha256:${'a'.repeat(64)}`, fileName: 'openai-docs-1.0.0.zip', kind: 'zip',
      name: 'openai-docs', description: 'Find official documentation', fileCount: 3, compressedBytes: 10, expandedBytes: 30, operation: 'install', warnings: [],
      runtimeRequirements: [],
    } }),
    inspectUpload: vi.fn(), installUpload: vi.fn().mockResolvedValue({ ok: true, value: { operation: 'installed', record: { skillId: 'openai-docs' } } }),
    getAuthoringDraft: vi.fn().mockResolvedValue({ ok: true, value: null }),
    dismissAuthoringDraft: vi.fn().mockResolvedValue({ ok: true, value: { dismissed: true } }),
    listSystemSkills: vi.fn().mockResolvedValue({ ok: true, value: { items: systemItems } }),
    getSessionBusinessSkillSelection: vi.fn().mockImplementation(async () => ({ ok: true, value: sessionSelection })),
    replaceSessionBusinessSkillSelection: vi.fn().mockImplementation(async (input: { expectedRevision: number; skillNames: readonly string[] }) => {
      sessionSelection = {
        schema: 'paimind.session-business-skill-selection/v1', revision: sessionSelection.revision + 1,
        skillNames: input.skillNames,
      }
      return { ok: true, value: sessionSelection }
    }),
    getSkillSource: vi.fn().mockResolvedValue({ ok: true, value: {
      skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', instructions: 'Use official sources.',
      digest: `sha256:${'c'.repeat(64)}`, managed: true,
    } }),
    saveSkillSource: vi.fn().mockImplementation(async (input: { name: string; description: string }) => ({ ok: true, value: {
      operation: 'installed', record: { skillId: input.name, name: input.name, description: input.description },
    } })),
    getSkillPackage: vi.fn().mockResolvedValue({ ok: true, value: {
      skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation',
      digest: `sha256:${'c'.repeat(64)}`, managed: true,
      root: { path: '', entries: [
        { path: 'SKILL.md', name: 'SKILL.md', kind: 'text', size: 132, digest: `sha256:${'d'.repeat(64)}` },
        { path: 'references', name: 'references', kind: 'directory', size: 0 },
      ] },
    } }),
    listSkillPackageDirectory: vi.fn().mockResolvedValue({ ok: true, value: { path: 'references', entries: [
      { path: 'references/example.md', name: 'example.md', kind: 'text', size: 12, digest: `sha256:${'e'.repeat(64)}` },
    ] } }),
    readSkillPackageFile: vi.fn().mockImplementation(async (input: { path: string }) => ({ ok: true, value: input.path === 'SKILL.md'
      ? { path: 'SKILL.md', kind: 'text', size: 132, digest: `sha256:${'d'.repeat(64)}`, content: '---\nname: openai-docs\ndescription: "Find official documentation"\n---\n\nUse official sources.\n' }
      : { path: input.path, kind: 'text', size: 12, digest: `sha256:${'e'.repeat(64)}`, content: 'Example text' } })),
    saveSkillPackage: vi.fn().mockImplementation(async (input: { skillId?: string; changes: readonly { operation: string; path: string; content?: string }[] }) => {
      const source = input.changes.find(change => change.path === 'SKILL.md')?.content ?? ''
      const name = input.skillId ?? /\nname:\s*([^\n]+)/.exec(source)?.[1]?.trim() ?? 'new-skill'
      return { ok: true, value: { operation: input.skillId === undefined ? 'installed' : 'updated', record: { skillId: name, name, description: 'Saved Skill' } } }
    }),
    getUserSkillPolicy: vi.fn().mockImplementation(async () => ({ ok: true, value: policy })),
    replaceUserSkillPolicy: vi.fn().mockImplementation(async (input: {
      expectedRevision: number
      enabledOptionalSystemSkillNames: readonly string[]
      enabledBusinessSkillNames: readonly string[]
      directBusinessSkillNames: readonly string[]
    }) => {
      policy = {
        schema: 'paimind.user-skill-policy/v1', revision: policy.revision + 1,
        enabledOptionalSystemSkillNames: input.enabledOptionalSystemSkillNames,
        enabledBusinessSkillNames: input.enabledBusinessSkillNames,
        directBusinessSkillNames: input.directBusinessSkillNames,
      }
      return { ok: true, value: policy }
    }),
    uninstall: vi.fn().mockResolvedValue({ ok: true, value: { skillId: 'openai-docs', removedAt: 1, recoverable: true } }),
  }
}

function locale(active = 'en-US'): PaimindLocaleSource {
  return { getLocale: () => ({ active }), subscribe: () => () => {} }
}

function runtime(current: string | undefined | null = 'session-1'): { sessions: HarnessSessionService } {
  if (current === null) current = undefined
  const snapshot: HarnessSessionListSnapshot = { current, byId: current === undefined ? {} : { [current]: { running: false, blank: false, agentPreset: 'standard' } }, jobsBySession: {} }
  return {
    sessions: { list: { getSnapshot: () => snapshot, subscribe: () => () => {} }, open: () => {} },
  }
}

afterEach(() => { cleanup(); document.head.querySelectorAll('style[data-paimind-plugin="@hansen/skill-market"]').forEach(node => { node.remove() }) })

describe('Skill Market business UI', () => {
  it('opens mobile details at the top, traps focus, and restores the original list position', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    try {
      const view = render(<main data-paimind-product-surface="skill-center"><SkillMarketSection installer={installer()} sessions={runtime().sessions} locale={locale()} close={() => {}} /></main>)
      const surface = view.container.firstElementChild as HTMLElement
      const trigger = await screen.findByRole('button', { name: 'View: bento-ppt' })
      surface.scrollTop = 540
      trigger.focus()
      fireEvent.click(trigger)
      const back = screen.getByRole('button', { name: 'Back to Skill list' })
      expect(surface.scrollTop).toBe(0)
      expect(back).toHaveFocus()
      fireEvent.keyDown(back, { key: 'Tab', shiftKey: true })
      expect(screen.getByRole('button', { name: 'Review and install' })).toHaveFocus()
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      expect(trigger).toHaveFocus()
      expect(surface.scrollTop).toBe(540)
    } finally {
      cleanup()
      vi.unstubAllGlobals()
    }
  })

  it('keeps an unsaved folder when the Center closes, isolates client instances and discards explicitly', async () => {
    const first = installer()
    const sessions = runtime().sessions
    const props = { installer: first, sessions, locale: locale(), close: () => {} }
    const view = render(<SkillMarketSection {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Skill' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Create manually/ }))
    const content = '---\nname: review-draft\ndescription: "unsaved review"\n---\nKeep this text.'
    fireEvent.change(screen.getByRole('textbox', { name: 'Skill file editor' }), { target: { value: content } })
    view.unmount()
    const other = render(<SkillMarketSection {...props} installer={installer()} />)
    expect(screen.queryByRole('textbox', { name: 'Skill file editor' })).toBeNull()
    other.unmount()
    const restored = render(<SkillMarketSection {...props} />)
    expect(screen.getByRole('textbox', { name: 'Skill file editor' })).toHaveValue(content)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    restored.unmount()
    render(<SkillMarketSection {...props} />)
    expect(screen.queryByRole('textbox', { name: 'Skill file editor' })).toBeNull()
    expect(first.saveSkillPackage).not.toHaveBeenCalled()
  })

  it('renders a structured catalog failure and can retry the same service', async () => {
    const service = installer()
    service.listCatalog.mockResolvedValueOnce({ ok: false, error: { message: 'catalog unavailable' } })
    render(<SkillMarketSection installer={service} sessions={runtime().sessions} locale={locale()} close={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('catalog unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('button', { name: 'View: openai-docs' })
    expect(service.listCatalog).toHaveBeenCalledTimes(2)
  })

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
    const style = document.head.querySelector('style[data-paimind-plugin="@hansen/skill-market"]')
    expect(style).not.toBeNull()
    expect(style).toHaveAttribute('data-paimind-style-refs', '2')
    disposeFirst()
    expect(document.head.contains(style)).toBe(true)
    expect(style).toHaveAttribute('data-paimind-style-refs', '1')
    disposeSecond()
    expect(document.head.contains(style)).toBe(false)
  })

  it('uses all Skills, built-in, and installed as the three primary views', async () => {
    const native = runtime()
    render(<SkillMarketSection close={() => {}} installer={installer() as never} sessions={native.sessions} locale={locale()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'View: openai-docs' })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'All Skills' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Built-in' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Installed' })).toBeInTheDocument()
    expect(screen.queryByText(/runtime id|host path|not exposed|hash/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    expect(screen.getByText(/No personal Skills installed/)).toBeInTheDocument()
  })

  it('unifies installed-only Skills and catalog entries without duplicate names or divergent descriptions', async () => {
    const native = runtime()
    const items = [
      { skillId: 'openai-docs', name: 'openai-docs', description: 'My installed documentation workflow', managed: true, sourceFileName: 'docs.zip', digest: recommendations[0].digest, runtimeRequirements: [] },
      { skillId: 'human-writing', name: 'human-writing', description: 'Private writing workflow', managed: true, sourceFileName: 'human-writing.zip', digest: 'local', runtimeRequirements: [] },
    ]
    const host = installer(items)
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('button', { name: 'View: human-writing' })
    expect(screen.getAllByRole('button', { name: /^View:/ })).toHaveLength(3)
    expect(screen.getByRole('tab', { name: 'All Skills' })).toHaveTextContent('3')
    expect(screen.getByRole('tab', { name: 'Installed' })).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: 'View: openai-docs' })).toHaveTextContent(items[0]!.description)
    fireEvent.change(screen.getByLabelText('Filter by install status'), { target: { value: 'installed' } })
    expect(screen.getAllByRole('button', { name: /^View:/ })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'View: human-writing' }))
    expect(screen.queryByRole('button', { name: 'Review and install' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Manage Skill' }))
    expect(screen.getByRole('heading', { name: 'human-writing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View installed: openai-docs' })).toHaveTextContent(items[0]!.description)
    expect(host.installUpload).not.toHaveBeenCalled()
    expect(host.replaceUserSkillPolicy).not.toHaveBeenCalled()
  })

  it('filters catalog membership and local source across all and installed views', async () => {
    const native = runtime()
    const host = installer([
      { skillId: 'private-note', name: 'private-note', description: 'Private note', sourceFileName: 'Skill Center package editor', managed: true, digest: 'a', runtimeRequirements: [] },
      { skillId: 'human-writing', name: 'human-writing', description: 'Private writing', sourceFileName: 'human-writing.zip', managed: true, digest: 'b', runtimeRequirements: [] },
      { skillId: 'external-note', name: 'external-note', description: 'External note', sourceFileName: 'SKILL.md', managed: false, digest: 'c', runtimeRequirements: [] },
    ])
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('button', { name: 'View: human-writing' })
    const source = screen.getByLabelText('Filter by source')
    fireEvent.change(source, { target: { value: 'catalog' } })
    expect(screen.getAllByRole('button', { name: /^View:/ })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'View: human-writing' })).toBeNull()
    fireEvent.change(source, { target: { value: 'created' } })
    expect(screen.getAllByRole('button', { name: /^View:/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'View: private-note' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    expect(screen.getAllByRole('button', { name: /^View installed:/ })).toHaveLength(1)
    fireEvent.change(source, { target: { value: 'imported' } })
    expect(screen.getByRole('button', { name: 'View installed: human-writing' })).toBeInTheDocument()
    fireEvent.change(source, { target: { value: 'external' } })
    expect(screen.getByRole('button', { name: 'View installed: external-note' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Skills' }), { target: { value: 'does-not-exist' } })
    expect(screen.getByText('No installed Skills match these filters.')).toBeInTheDocument()
    expect(screen.queryByText(/No personal Skills installed/)).toBeNull()
  })

  it('retains installed-only Skills after catalog failure and recovers a complete union on retry', async () => {
    const native = runtime()
    const host = installer([{ skillId: 'human-writing', name: 'human-writing', description: 'Private writing', managed: true, sourceFileName: 'local.zip', digest: 'local', runtimeRequirements: [] }])
    host.listCatalog.mockResolvedValueOnce({ ok: false, error: { message: 'catalog offline' } })
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('button', { name: 'View: human-writing' })
    expect(screen.getByRole('alert')).toHaveTextContent('catalog offline')
    expect(screen.getByRole('tab', { name: 'All Skills' })).toHaveTextContent('1+')
    fireEvent.click(screen.getByRole('button', { name: 'Manage Skill' }))
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    fireEvent.click(screen.getByRole('tab', { name: 'All Skills' }))
    expect(screen.getAllByRole('button', { name: /^View:/ })).toHaveLength(3)
    expect(screen.getByRole('tab', { name: 'All Skills' })).toHaveTextContent('3')
    expect(screen.getByRole('tab', { name: 'All Skills' })).not.toHaveTextContent('+')
  })

  it('does not misreport catalog entries as installable when the installed source fails', async () => {
    const native = runtime()
    const host = installer()
    host.listInstalled.mockRejectedValueOnce(new Error('repository offline'))
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('button', { name: 'View: openai-docs' })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('repository offline'))
    expect(screen.getByRole('button', { name: 'View: openai-docs' })).toHaveTextContent('Install status unknown')
    expect(screen.getByRole('button', { name: 'Review and install' })).toBeDisabled()
    expect(screen.getByLabelText('Filter by install status')).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Installed' })).toHaveTextContent('—')
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    expect(screen.queryByText(/No personal Skills installed/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    fireEvent.click(screen.getByRole('tab', { name: 'All Skills' }))
    expect(screen.getByRole('button', { name: 'Review and install' })).toBeEnabled()
  })

  it.each(['human-writing', 'openai-docs'])('reconciles the union after uninstalling %s without editing the catalog', async name => {
    const native = runtime()
    const item = { skillId: name, name, description: 'Local workflow', managed: true, sourceFileName: 'local.zip', digest: 'local', runtimeRequirements: [] }
    const host = installer([item])
    host.uninstall.mockImplementationOnce(async () => {
      host.listInstalled.mockResolvedValue({ ok: true, value: { items: [] } })
      return { ok: true, value: { skillId: name, removedAt: 1, recoverable: true } }
    })
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('button', { name: `View: ${name}` })
    fireEvent.click(screen.getByRole('button', { name: `View: ${name}` }))
    fireEvent.click(screen.getByRole('button', { name: 'Manage Skill' }))
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    fireEvent.click(screen.getByRole('button', { name: `Uninstall with backup` }))
    await screen.findByText(/No personal Skills installed/)
    fireEvent.click(screen.getByRole('tab', { name: 'All Skills' }))
    expect(screen.getAllByRole('button', { name: /^View:/ })).toHaveLength(2)
    if (name === 'human-writing') expect(screen.queryByRole('button', { name: 'View: human-writing' })).toBeNull()
    else expect(screen.getByRole('button', { name: 'View: openai-docs' })).toHaveTextContent('Available')
    expect(host.inspectCatalog).not.toHaveBeenCalled()
  })

  it('places the Center close control in the top-right header and calls close', async () => {
    const native = runtime(); const close = vi.fn()
    render(<SkillMarketSection close={close} installer={installer() as never} sessions={native.sessions} locale={locale()} />)
    const button = await screen.findByRole('button', { name: 'Close Skill Center' })
    expect(button).toHaveAttribute('data-paimind-skill-center-close')
    fireEvent.click(button)
    expect(close).toHaveBeenCalledOnce()
  })

  it('supports roving keyboard navigation across the three primary views', async () => {
    const native = runtime()
    render(<SkillMarketSection close={() => {}} installer={installer() as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('button', { name: 'View: openai-docs' })
    const market = screen.getByRole('tab', { name: 'All Skills' })
    market.focus()
    fireEvent.keyDown(market, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Built-in' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Built-in' })).toHaveFocus()
  })

  it('renders verified built-in descriptors as real lifecycle switches and writes optional policy', async () => {
    const native = runtime(); const host = installer()
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Built-in' }))
    expect(await screen.findByText('genui')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Enable genui' })).not.toBeChecked()
    const optional = screen.getByRole('switch', { name: 'Enable paimind-skill-installation' })
    expect(optional).not.toBeChecked()
    fireEvent.click(optional)
    await waitFor(() => expect(host.replaceUserSkillPolicy).toHaveBeenCalledWith({
      expectedRevision: 0,
      enabledOptionalSystemSkillNames: ['paimind-skill-installation'],
      enabledBusinessSkillNames: [],
      directBusinessSkillNames: [],
    }))
    await waitFor(() => expect(optional).toBeChecked())
  })

  it('fails closed in Built-in when the verified System descriptor API is unavailable', async () => {
    const native = runtime(); const host = installer()
    delete (host as Partial<typeof host>).listSystemSkills
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('tab', { name: 'Built-in' })
    fireEvent.click(screen.getByRole('tab', { name: 'Built-in' }))
    expect(screen.getByRole('heading', { name: 'Built-in Skill descriptors are not connected' })).toBeInTheDocument()
    expect(screen.getByText(/does not guess by name or expose UI-only switches/)).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('creates a Skill through the reviewable editor and saves only after user confirmation', async () => {
    const native = runtime(); const host = installer()
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('button', { name: 'Add Skill' })
    fireEvent.click(screen.getByRole('button', { name: 'Add Skill' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Create manually/ }))
    const skillSource = '---\nname: delivery-risk-review\ndescription: "Review delivery risk when orders are provided."\n---\n\nInspect orders and return ranked risks.\n'
    fireEvent.change(screen.getByLabelText('Skill file editor'), { target: { value: skillSource } })
    fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: 'references' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }))
    fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: 'examples' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }))
    fireEvent.change(screen.getByLabelText('New file name'), { target: { value: 'output-format.md' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create file' }))
    fireEvent.change(screen.getByLabelText('Skill file editor'), { target: { value: '# Output\n\nReturn ranked risks.' } })
    expect(host.saveSkillPackage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save Skill folder' }))
    await waitFor(() => expect(host.saveSkillPackage).toHaveBeenCalledWith({ changes: [
      { operation: 'write', path: 'SKILL.md', content: skillSource },
      { operation: 'mkdir', path: 'references' },
      { operation: 'mkdir', path: 'references/examples' },
      { operation: 'write', path: 'references/examples/output-format.md', content: '# Output\n\nReturn ranked risks.' },
    ] }))
  })

  it('reviews and saves an AI-prepared draft before dismissing its conversation state', async () => {
    const native = runtime(); const host = installer()
    host.getAuthoringDraft.mockResolvedValue({ ok: true, value: {
      draftId: 'db13cad0-4d50-49ef-aa51-17fc1339d9f3', sessionId: 'session-1',
      name: 'delivery-risk-review', description: 'Review delivery risk', instructions: 'Review orders and return ranked risks.', updatedAt: 1,
    } })
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)

    expect(await screen.findByText('Prepared by AI · not saved')).toBeInTheDocument()
    const source = '---\nname: delivery-risk-review\ndescription: "Review delivery risk"\n---\n\nReview orders and return ranked risks.\n'
    expect(screen.getByLabelText('Skill file editor')).toHaveValue(source)
    expect(host.saveSkillPackage).not.toHaveBeenCalled()
    expect(host.dismissAuthoringDraft).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save Skill folder' }))
    await waitFor(() => expect(host.saveSkillPackage).toHaveBeenCalledWith({ changes: [
      { operation: 'write', path: 'SKILL.md', content: source },
    ] }))
    await waitFor(() => expect(host.dismissAuthoringDraft).toHaveBeenCalledWith({
      sessionId: 'session-1', draftId: 'db13cad0-4d50-49ef-aa51-17fc1339d9f3',
    }))
  })

  it('creates nested content beneath an explicitly selected lazily loaded directory', async () => {
    const native = runtime(); const host = installer([{
      skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true,
      digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [],
    }])
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('tab', { name: 'Installed' })
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Select directory: references' }))
    await waitFor(() => expect(host.listSkillPackageDirectory).toHaveBeenCalledWith({ skillId: 'openai-docs', path: 'references' }))

    fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: 'examples' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }))
    fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: 'nested' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }))
    fireEvent.change(screen.getByLabelText('New file name'), { target: { value: 'guide.md' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create file' }))
    fireEvent.change(screen.getByLabelText('Skill file editor'), { target: { value: '# Guide\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Skill folder' }))

    await waitFor(() => expect(host.saveSkillPackage).toHaveBeenCalledWith({
      skillId: 'openai-docs', expectedDigest: `sha256:${'c'.repeat(64)}`,
      changes: [
        { operation: 'mkdir', path: 'references/examples' },
        { operation: 'mkdir', path: 'references/examples/nested' },
        { operation: 'write', path: 'references/examples/nested/guide.md', content: '# Guide\n' },
      ],
    }))
  })

  it('opens an installed managed Skill for editing and saves with optimistic concurrency', async () => {
    const native = runtime(); const host = installer([{
      skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true,
      digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [],
    }])
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('tab', { name: 'Installed' })
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = await screen.findByLabelText('Skill file editor')
    expect((editor as HTMLTextAreaElement).value).toContain('Use official sources.')
    const revised = '---\nname: openai-docs\ndescription: "Find official documentation"\n---\n\nUse primary official sources only.\n'
    fireEvent.change(editor, { target: { value: revised } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Skill folder' }))
    await waitFor(() => expect(host.saveSkillPackage).toHaveBeenCalledWith({
      skillId: 'openai-docs', expectedDigest: `sha256:${'c'.repeat(64)}`,
      changes: [{ operation: 'write', path: 'SKILL.md', content: revised, expectedDigest: `sha256:${'d'.repeat(64)}` }],
    }))
  })

  it('reviews a recommended package before installing through the shared installer', async () => {
    const native = runtime(); const host = installer()
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
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
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('button', { name: 'Add Skill' })
    const input = screen.getByLabelText('Choose Skill folder') as HTMLInputElement
    const openPicker = vi.spyOn(input, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Add Skill' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Import from device/ }))
    const dialog = screen.getByRole('dialog', { name: 'Choose a recognizable Skill package' })
    expect(dialog).toHaveTextContent('YAML frontmatter')
    expect(dialog).toHaveTextContent('SKILL.md')
    expect(dialog).toHaveTextContent('scripts/')
    expect(dialog).toHaveTextContent('personal Skill scope')
    expect(host.inspectUpload).not.toHaveBeenCalled()
    const choose = screen.getByRole('button', { name: 'Choose folder' })
    await waitFor(() => expect(choose).toHaveFocus())
    fireEvent.click(choose)
    expect(openPicker).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: 'Choose a recognizable Skill package' })).toBeNull()
  })

  it('does not offer a redundant catalog update when package digests match', async () => {
    const native = runtime()
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
    render(<SkillMarketSection close={() => {}} installer={installer(installed) as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('button', { name: 'View: openai-docs' })
    expect(screen.queryByRole('button', { name: /Update|Review update|Catalog version is current/ })).toBeNull()
  })

  it('requires an explicit recoverable-uninstall confirmation', async () => {
    const native = runtime(); const host = installer([{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }])
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('button', { name: 'View: openai-docs' })
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    expect(screen.getByRole('dialog', { name: 'Uninstall openai-docs' })).toBeInTheDocument()
    expect(host.uninstall).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall with backup' }))
    await waitFor(() => expect(host.uninstall).toHaveBeenCalledWith({ skillId: 'openai-docs', version: `sha256:${'a'.repeat(64)}` }))
  })

  it('declares the Remote and business surface dependencies', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'sessions'])
  })

  it('filters the market by explicit metadata, inferred categories, and the stable general fallback', async () => {
    const native = runtime()
    const host = installer()
    host.listCatalog.mockResolvedValue({ ok: true, value: { items: [
      ...recommendations,
      { id: 'release-helper', name: 'release-helper', description: 'Search and analyze release data', version: '1.0.0', source: 'Community', license: 'MIT', digest: `sha256:${'c'.repeat(64)}`, category: 'engineering', tags: ['release-pipeline'] },
      { id: 'specialized-capability', name: 'specialized-capability', description: 'A specialized capability', version: '1.0.0', source: 'Community', license: 'MIT', digest: `sha256:${'d'.repeat(64)}` },
    ] } })
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('button', { name: 'View: openai-docs' })
    const category = screen.getByLabelText('Filter by business category')
    expect(screen.getByRole('option', { name: 'Engineering (1)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'General (1)' })).toBeInTheDocument()
    fireEvent.change(category, { target: { value: 'content' } })
    expect(screen.queryByRole('button', { name: 'View: openai-docs' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View: bento-ppt' })).toBeInTheDocument()
    fireEvent.change(category, { target: { value: 'engineering' } })
    expect(screen.getByRole('button', { name: 'View: release-helper' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Skills' }), { target: { value: 'release-pipeline' } })
    expect(screen.getByRole('button', { name: 'View: release-helper' })).toBeInTheDocument()
    fireEvent.change(category, { target: { value: 'general' } })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Skills' }), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'View: specialized-capability' })).toBeInTheDocument()
  })

  it('does not expose favorite actions or filters', async () => {
    const native = runtime()
    render(<SkillMarketSection close={() => {}} installer={installer() as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('button', { name: 'View: openai-docs' })
    expect(screen.queryByRole('button', { name: /favorite/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /unfavorite/i })).toBeNull()
    expect(screen.queryByText('Favorites only')).toBeNull()
  })

  it('pages a 1,000-item market catalog and resets the window when filters change', async () => {
    const native = runtime()
    const host = installer()
    const items = Array.from({ length: 1_000 }, (_, index) => ({
      id: `catalog-skill-${String(index).padStart(4, '0')}`,
      name: `catalog-skill-${String(index).padStart(4, '0')}`,
      description: `General catalog capability ${index}`,
      category: index < 500 ? 'data' : 'engineering', tags: [index < 500 ? 'analytics' : 'development'],
      version: '1.0.0', source: 'Community', license: 'MIT', digest: `sha256:${index.toString(16).padStart(64, '0')}`,
    }))
    host.listCatalog.mockResolvedValue({ ok: true, value: { items } })
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    await screen.findByRole('button', { name: 'View: catalog-skill-0000' })
    expect(screen.getAllByRole('button', { name: /^View: catalog-skill-/ })).toHaveLength(50)
    expect(screen.getByText('Showing 50 of 1000 results')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more (950 remaining)' }))
    expect(screen.getAllByRole('button', { name: /^View: catalog-skill-/ })).toHaveLength(100)
    expect(screen.getByText('Showing 100 of 1000 results')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load more (900 remaining)' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Filter by business category'), { target: { value: 'data' } })
    expect(screen.getAllByRole('button', { name: /^View: catalog-skill-/ })).toHaveLength(50)
    expect(screen.getByText('Showing 50 of 500 results')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load more (450 remaining)' })).toBeInTheDocument()
  })

  it('writes Business Skill eligibility and direct-chat defaults through the real policy contract', async () => {
    const native = runtime()
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
    const host = installer(installed)
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Installed' }))
    const eligible = await screen.findByRole('switch', { name: 'Enable openai-docs' })
    const direct = screen.getByRole('switch', { name: 'Use openai-docs by default in direct chats' })
    expect(eligible).toBeChecked()
    expect(direct).not.toBeChecked()
    fireEvent.click(direct)
    await waitFor(() => expect(host.replaceUserSkillPolicy).toHaveBeenLastCalledWith({
      expectedRevision: 0,
      enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: ['openai-docs'],
      directBusinessSkillNames: ['openai-docs'],
    }))
    await waitFor(() => expect(direct).toBeChecked())
    fireEvent.click(eligible)
    await waitFor(() => expect(host.replaceUserSkillPolicy).toHaveBeenLastCalledWith({
      expectedRevision: 1,
      enabledOptionalSystemSkillNames: [],
      enabledBusinessSkillNames: [],
      directBusinessSkillNames: [],
    }))
  })

  it('loads the current Session selection before enabling its runtime switch', async () => {
    const native = runtime()
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
    const host = installer(installed)
    let resolveSelection!: (value: unknown) => void
    host.getSessionBusinessSkillSelection.mockReturnValueOnce(new Promise(resolve => { resolveSelection = resolve }))
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Installed' }))
    const current = await screen.findByRole('switch', { name: 'Use openai-docs in current conversation' })
    expect(current).toBeDisabled()
    expect(screen.getByText(/Reading the current runtime Session scope/)).toBeInTheDocument()
    resolveSelection({ ok: true, value: { schema: 'paimind.session-business-skill-selection/v1', revision: 0, skillNames: [] } })
    await waitFor(() => expect(current).toBeEnabled())
  })

  it('adds an enabled Business Skill to the current runtime Session with optimistic revision', async () => {
    const native = runtime()
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
    const host = installer(installed)
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Installed' }))
    const current = await screen.findByRole('switch', { name: 'Use openai-docs in current conversation' })
    await waitFor(() => expect(current).toBeEnabled())
    expect(screen.getByText(/Runtime-ephemeral.*host restarts/)).toBeInTheDocument()
    fireEvent.click(current)
    await waitFor(() => expect(host.replaceSessionBusinessSkillSelection).toHaveBeenCalledWith({
      sessionId: 'session-1', expectedRevision: 0, skillNames: ['openai-docs'],
    }))
    await waitFor(() => expect(current).toBeChecked())
    expect(screen.getAllByText(/clears when the host restarts/).length).toBeGreaterThan(0)
  })

  it('does not allow a disabled Business Skill to be added to the current Session', async () => {
    const native = runtime()
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
    const host = installer(installed)
    host.getUserSkillPolicy.mockResolvedValue({ ok: true, value: {
      schema: 'paimind.user-skill-policy/v1', revision: 2,
      enabledOptionalSystemSkillNames: [], enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    } })
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Installed' }))
    const current = await screen.findByRole('switch', { name: 'Use openai-docs in current conversation' })
    await waitFor(() => expect(current).toBeDisabled())
    expect(screen.getByText(/Enable this Business Skill first/)).toBeInTheDocument()
    expect(host.replaceSessionBusinessSkillSelection).not.toHaveBeenCalled()
  })

  it('allows a selected Business Skill to be removed after the user disables it', async () => {
    const native = runtime()
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
    const host = installer(installed)
    host.getUserSkillPolicy.mockResolvedValue({ ok: true, value: {
      schema: 'paimind.user-skill-policy/v1', revision: 2,
      enabledOptionalSystemSkillNames: [], enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    } })
    host.getSessionBusinessSkillSelection.mockResolvedValue({ ok: true, value: {
      schema: 'paimind.session-business-skill-selection/v1', revision: 3, skillNames: ['openai-docs'],
    } })
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Installed' }))
    const current = await screen.findByRole('switch', { name: 'Use openai-docs in current conversation' })
    await waitFor(() => expect(current).toBeChecked())
    expect(current).toBeEnabled()
    expect(screen.getByText(/disabled but can still be removed/)).toBeInTheDocument()
    fireEvent.click(current)
    await waitFor(() => expect(host.replaceSessionBusinessSkillSelection).toHaveBeenCalledWith({
      sessionId: 'session-1', expectedRevision: 3, skillNames: [],
    }))
    await waitFor(() => expect(current).not.toBeChecked())
  })

  it('refreshes the current Session selection after an optimistic concurrency conflict', async () => {
    const native = runtime()
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
    const host = installer(installed)
    host.getSessionBusinessSkillSelection
      .mockResolvedValueOnce({ ok: true, value: { schema: 'paimind.session-business-skill-selection/v1', revision: 0, skillNames: [] } })
      .mockResolvedValueOnce({ ok: true, value: { schema: 'paimind.session-business-skill-selection/v1', revision: 1, skillNames: ['openai-docs'] } })
    host.replaceSessionBusinessSkillSelection.mockRejectedValueOnce(new Error('Session Business Skill Selection was updated'))
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Installed' }))
    const current = await screen.findByRole('switch', { name: 'Use openai-docs in current conversation' })
    await waitFor(() => expect(current).toBeEnabled())
    fireEvent.click(current)
    await waitFor(() => expect(host.getSessionBusinessSkillSelection).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(current).toBeChecked())
    expect(screen.getByRole('alert')).toHaveTextContent(/latest runtime Session state has been refreshed/)
  })

  it('fails closed when the Session selection API is unavailable', async () => {
    const native = runtime()
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
    const host = installer(installed)
    delete (host as Partial<typeof host>).getSessionBusinessSkillSelection
    delete (host as Partial<typeof host>).replaceSessionBusinessSkillSelection
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Installed' }))
    expect(await screen.findByRole('switch', { name: 'Use openai-docs in current conversation' })).toBeDisabled()
    expect(screen.getByText(/does not expose the real Session selection API/)).toBeInTheDocument()
  })

  it('keeps Agent attachment locked when the Agent Center surface is unavailable', async () => {
    const native = runtime()
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
    render(<SkillMarketSection close={() => {}} installer={installer(installed) as never} sessions={native.sessions} locale={locale()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Installed' }))
    const attach = screen.getByRole('button', { name: 'Attach in Agent Center' })
    expect(attach).toBeDisabled()
    expect(attach).toHaveAttribute('title', 'Agent Center is not installed or is currently unavailable')
  })

  it('navigates to the Agent Center surface without writing an Agent Profile from Skill Center', async () => {
    render(<button type="button" data-paimind-product-trigger="agent-center">Agent Center navigation anchor</button>)
    const native = runtime(); const close = vi.fn()
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    render(<SkillMarketSection close={close} installer={installer(installed) as never} sessions={native.sessions} locale={locale()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Installed' }))
    const attach = screen.getByRole('button', { name: 'Attach in Agent Center' })
    expect(attach).toBeEnabled()
    fireEvent.click(attach)
    expect(controller.getSnapshot().open).toBe(true)
    expect(close).toHaveBeenCalledOnce()
    expect(screen.queryByRole('status', { name: /attached/i })).toBeNull()
    controller.dispose()
  })

  it('fails closed if the Agent Center surface disappears before navigation', async () => {
    const anchor = render(<button type="button" data-paimind-product-trigger="agent-center">Agent Center navigation anchor</button>)
    const native = runtime(); const close = vi.fn()
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
    const controller = new PaimindProductSurfaceController('agent-center', window, document)
    render(<SkillMarketSection close={close} installer={installer(installed) as never} sessions={native.sessions} locale={locale()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Installed' }))
    const attach = screen.getByRole('button', { name: 'Attach in Agent Center' })
    anchor.unmount()
    fireEvent.click(attach)
    expect(await screen.findByRole('alert')).toHaveTextContent('Agent Center is unavailable. No Skill was attached.')
    expect(controller.getSnapshot().open).toBe(false)
    expect(close).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('disables and explains current-conversation attachment when there is no current Session', async () => {
    const native = runtime(null)
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
    const host = installer(installed)
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Installed' }))
    expect(await screen.findByRole('switch', { name: 'Use openai-docs in current conversation' })).toBeDisabled()
    expect(screen.getByText(/Open a conversation first/)).toBeInTheDocument()
    expect(host.getSessionBusinessSkillSelection).not.toHaveBeenCalled()
  })

  it('locks policy controls when the user policy API is unavailable', async () => {
    const native = runtime()
    const installed = [{ skillId: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', managed: true, digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }]
    const host = installer(installed)
    delete (host as Partial<typeof host>).getUserSkillPolicy
    delete (host as Partial<typeof host>).replaceUserSkillPolicy
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Installed' }))
    expect(await screen.findByRole('switch', { name: 'Enable openai-docs' })).toBeDisabled()
    expect(screen.getByText(/controls stay locked and never fake success/)).toBeInTheDocument()
  })

  it('opens from the native sidebar action inside the native center column', async () => {
    const native = runtime()
    const controller = new PaimindProductSurfaceController('skill-center', window, document)
    render(<>
      <SkillCenterTrigger wide={false} controller={controller} locale={locale()} />
      <div data-testid="harness-center"><section data-slot="conversation"><div>Native conversation</div></section></div>
      <SkillCenterSurface controller={controller} installer={installer() as never} sessions={native.sessions} locale={locale()} />
    </>)
    const trigger = screen.getByRole('button', { name: 'Open Skill Center' })
    expect(trigger.querySelector('svg')).not.toBeNull()
    fireEvent.click(trigger)
    const surface = await screen.findByRole('main', { name: 'Skill Center' })
    const center = screen.getByTestId('harness-center')
    const conversationContent = screen.getByText('Native conversation')
    const conversation = conversationContent.closest<HTMLElement>('[data-slot="conversation"]')!
    expect(surface.parentElement).toBe(center)
    expect(conversation).toHaveAttribute('inert')
    expect(conversation).toHaveAttribute('aria-hidden', 'true')
    expect(trigger).toHaveAttribute('aria-current', 'page')
    expect(surface.querySelector('[data-paimind-product-bar]')).toBeNull()
    expect(surface.querySelector('[data-paimind-product-return]')).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Skill Center' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('main', { name: 'Skill Center' })).toBeNull())
    expect(conversation).not.toHaveAttribute('inert')
    expect(conversation).not.toHaveAttribute('aria-hidden')
    expect(trigger).not.toHaveAttribute('aria-current')
    controller.dispose()
  })

  it('opens the Skill Center when a conversation Tool prepares a new authoring draft', async () => {
    let bindingListener = (): void => {}
    const snapshot: HarnessSessionListSnapshot = { current: 'session-1', byId: { 'session-1': { running: false, blank: false, agentPreset: 'standard' } }, jobsBySession: {} }
    const sessions: HarnessSessionService = {
      list: { getSnapshot: () => snapshot, subscribe: () => () => {} }, open: () => {},
      binding: () => ({ ctx: {}, session: { getSnapshot: () => ({}) as never, subscribe: listener => { bindingListener = listener; return () => {} } } }),
    }
    let draft: unknown = null
    const host = installer()
    host.getUserSkillPolicy.mockResolvedValue({ ok: true, value: {
      schema: 'paimind.user-skill-policy/v1', revision: 0,
      enabledOptionalSystemSkillNames: ['paimind-skill-authoring'],
      enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    } })
    host.getAuthoringDraft.mockImplementation(async () => ({ ok: true, value: draft }))
    const controller = new PaimindProductSurfaceController('skill-center', window, document)
    const open = vi.spyOn(controller, 'open')
    const dispose = installSkillAuthoringDraftNavigation(sessions, host as never, controller)
    await waitFor(() => expect(host.getAuthoringDraft).toHaveBeenCalled())
    draft = { draftId: 'db13cad0-4d50-49ef-aa51-17fc1339d9f3', sessionId: 'session-1', name: 'delivery-risk-review', description: 'Review risk', instructions: 'Review orders.', updatedAt: 1 }
    bindingListener()
    await waitFor(() => expect(open).toHaveBeenCalledOnce())
    dispose(); controller.dispose()
  })

  it('does not auto-open an AI Skill draft while skill authoring is disabled', async () => {
    let bindingListener = (): void => {}
    const snapshot: HarnessSessionListSnapshot = { current: 'session-1', byId: { 'session-1': { running: false, blank: false, agentPreset: 'standard' } }, jobsBySession: {} }
    const sessions: HarnessSessionService = {
      list: { getSnapshot: () => snapshot, subscribe: () => () => {} }, open: () => {},
      binding: () => ({ ctx: {}, session: { getSnapshot: () => ({}) as never, subscribe: listener => { bindingListener = listener; return () => {} } } }),
    }
    const host = installer()
    host.getAuthoringDraft.mockResolvedValue({ ok: true, value: {
      draftId: 'db13cad0-4d50-49ef-aa51-17fc1339d9f3', sessionId: 'session-1',
      name: 'delivery-risk-review', description: 'Review risk', instructions: 'Review orders.', updatedAt: 1,
    } })
    const controller = new PaimindProductSurfaceController('skill-center', window, document)
    const open = vi.spyOn(controller, 'open')
    const dispose = installSkillAuthoringDraftNavigation(sessions, host as never, controller)
    await waitFor(() => expect(host.getUserSkillPolicy).toHaveBeenCalled())
    bindingListener()
    await new Promise(resolve => { setTimeout(resolve, 20) })
    expect(open).not.toHaveBeenCalled()
    dispose(); controller.dispose()
  })

  it('fails closed without a unique native conversation host', async () => {
    const native = runtime()
    const controller = new PaimindProductSurfaceController('skill-center', window, document)
    render(<>
      <SkillCenterTrigger wide controller={controller} locale={locale()} />
      <SkillCenterSurface controller={controller} installer={installer() as never} sessions={native.sessions} locale={locale()} />
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
