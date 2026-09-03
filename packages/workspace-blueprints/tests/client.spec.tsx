import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  HarnessSessionService,
  HarnessWorkspaceListSnapshot,
  HarnessWorkspaceService,
  HarnessWorkspaceView,
  PaimindLocaleSource,
} from '@paimind/harness-compat'
import type {
  WorkspaceBlueprintAgentChoice,
  WorkspaceBlueprintBusinessSkillChoice,
  WorkspaceBlueprintCatalogItem,
  WorkspaceBlueprintComposition,
  WorkspaceBlueprintCompositionChoices,
} from '../src/contract.ts'
import {
  WorkspaceBlueprintCenter,
  apply,
  inject,
  installWorkspaceBlueprintCenterStyle,
  preflightWorkspaceBlueprintComposition,
  type WorkspaceBlueprintRemoteNamespace,
} from '../src/client/index.tsx'
import { WORKSPACE_BLUEPRINT_CENTER_STYLE } from '../src/client/styles.ts'

const folderOnly = Object.freeze({ agent: null, businessSkills: Object.freeze([]) }) satisfies Readonly<WorkspaceBlueprintComposition>
const boundComposition = Object.freeze({
  agent: Object.freeze({ agentId: 'delivery-agent', presetId: 'delivery-preset', configVersion: 'cfg-7' }),
  businessSkills: Object.freeze([{ name: 'delivery-risk', digest: `sha256:${'d'.repeat(64)}` as const }]),
}) satisfies Readonly<WorkspaceBlueprintComposition>

function item(overrides: Partial<WorkspaceBlueprintCatalogItem> = {}): Readonly<WorkspaceBlueprintCatalogItem> {
  return Object.freeze({
    schema: 'paimind.workspace-blueprint/v1', blueprintId: 'delivery-command-center', version: '1.0.0',
    name: 'Delivery Command Center', description: 'A practical Workspace package for project delivery.',
    category: 'project-delivery', tags: ['delivery'], source: 'builtin', digest: `sha256:${'a'.repeat(64)}`,
    fileCount: 2, totalBytes: 1_536, createdAt: 1, updatedAt: 2, composition: folderOnly,
    versionCount: 1,
    files: [{ path: 'PROJECT.md', kind: 'text', size: 1_024 }, { path: 'playbooks/review.md', kind: 'text', size: 512 }],
    ...overrides,
  })
}

const builtin = item()
const personal = item({ blueprintId: 'my-delivery-kit', name: 'My Delivery Kit', source: 'user' })

function locale(active = 'en-US'): PaimindLocaleSource {
  return { getLocale: () => ({ active }), subscribe: () => () => {} }
}

function workspaceView(workspaceId = 'workspace-new', path = '/tmp/new-workspace'): HarnessWorkspaceView {
  return { workspaceId, path, title: 'New Workspace', sessionIds: [], createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z' }
}

function workspaceSnapshot(items: readonly HarnessWorkspaceView[] = []): HarnessWorkspaceListSnapshot {
  return { items, archivedSessionIds: [], state: 'idle', error: null, baselinesReady: true }
}

function compositionChoices(options: {
  readonly events?: string[]
  readonly agentStatus?: 'ready' | 'unavailable' | 'error'
  readonly skillStatus?: 'ready' | 'unavailable' | 'error'
  readonly skillDigest?: `sha256:${string}`
  readonly agentItems?: readonly Readonly<WorkspaceBlueprintAgentChoice>[]
  readonly skillItems?: readonly Readonly<WorkspaceBlueprintBusinessSkillChoice>[]
} = {}): Readonly<WorkspaceBlueprintCompositionChoices> {
  options.events?.push('choices')
  return Object.freeze({
    schema: 'paimind.workspace-blueprint-composition-choices/v1',
    agents: Object.freeze({
      status: options.agentStatus ?? 'ready',
      items: Object.freeze(options.agentItems ?? [{ agentId: 'delivery-agent', presetId: 'delivery-preset', configVersion: 'cfg-7', name: 'Delivery Agent' }]),
    }),
    businessSkills: Object.freeze({
      status: options.skillStatus ?? 'ready',
      items: Object.freeze(options.skillItems ?? [{ name: 'delivery-risk', description: 'Review delivery risk', digest: options.skillDigest ?? `sha256:${'d'.repeat(64)}` }]),
    }),
  })
}

function workspaces(options: { readonly items?: readonly HarnessWorkspaceView[]; readonly events?: string[] } = {}) {
  const events = options.events ?? []
  const created = workspaceView()
  const snapshot = workspaceSnapshot(options.items)
  return {
    list: { getSnapshot: () => snapshot, subscribe: () => () => {} },
    pickDirectory: vi.fn(async () => { events.push('pick'); return created.path }),
    create: vi.fn(async ({ path }: { readonly path: string }) => { events.push(`create:${path}`); return { ...created, path } }),
    startSession: vi.fn((workspaceId?: string) => { events.push(`start:${workspaceId ?? ''}`) }),
    openPath: vi.fn(async () => {}),
  } satisfies HarnessWorkspaceService
}

function blueprintRemote(options: {
  readonly builtins?: readonly Readonly<WorkspaceBlueprintCatalogItem>[]
  readonly users?: readonly Readonly<WorkspaceBlueprintCatalogItem>[]
  readonly events?: string[]
  readonly choices?: Readonly<WorkspaceBlueprintCompositionChoices>
} = {}) {
  const builtins = options.builtins ?? [builtin]
  const users = options.users ?? [personal]
  const events = options.events ?? []
  const api = {
    listBlueprints: vi.fn(async (input: { readonly source?: string } = {}) => ({ ok: true as const, value: { revision: 2, items: input.source === 'user' ? users : builtins } })),
    getCompositionChoices: vi.fn(async () => ({ ok: true as const, value: options.choices ?? compositionChoices({ events }) })),
    materializeBlueprint: vi.fn(async (input: { readonly workspaceId: string; readonly blueprintId: string; readonly version: string; readonly expectedDigest: string }) => {
      events.push(`materialize:${input.workspaceId}`)
      const selected = [...builtins, ...users].find(candidate => candidate.blueprintId === input.blueprintId) ?? builtin
      return { ok: true as const, value: { workspaceId: input.workspaceId, path: '/tmp/new-workspace', blueprintId: selected.blueprintId, version: selected.version, digest: selected.digest, warnings: [] } }
    }),
    bindEntryAgentSession: vi.fn(async (input: Parameters<WorkspaceBlueprintRemoteNamespace['bindEntryAgentSession']>[0]) => {
      events.push('bind-entry-agent')
      const selected = [...builtins, ...users].find(candidate => candidate.blueprintId === input.blueprintId && candidate.version === input.version) ?? builtin
      if (selected.composition.agent === null) throw new Error('missing test Agent')
      return { ok: true as const, value: {
        workspaceId: input.workspaceId, sessionId: input.sessionId, blueprintId: input.blueprintId,
        version: input.version, digest: input.expectedDigest, agent: selected.composition.agent,
      } }
    }),
    publishBlueprint: vi.fn(async (input: Parameters<WorkspaceBlueprintRemoteNamespace['publishBlueprint']>[0]) => ({ ok: true as const, value: { ...personal, ...input, source: 'user' as const, digest: `sha256:${'b'.repeat(64)}`, fileCount: 2, totalBytes: 1_536, createdAt: 3, updatedAt: 3 } })),
    getBlueprint: vi.fn(async (input: { readonly blueprintId: string; readonly version: string }) => {
      const selected = [...builtins, ...users].find(candidate => candidate.blueprintId === input.blueprintId) ?? builtin
      return { ok: true as const, value: { manifest: selected, entries: [
        { path: 'PROJECT.md', kind: 'text' as const, size: 1_024, digest: `sha256:${'f'.repeat(64)}` },
        { path: 'playbooks', kind: 'directory' as const, size: 0 },
        { path: 'playbooks/review.md', kind: 'text' as const, size: 512, digest: `sha256:${'e'.repeat(64)}` },
      ] } }
    }),
    readBlueprintText: vi.fn(async (input: { readonly blueprintId: string; readonly version: string; readonly path: string }) => ({ ok: true as const, value: { ...input, blueprintDigest: `sha256:${'a'.repeat(64)}`, digest: `sha256:${'f'.repeat(64)}`, text: '# Project\n' } })),
    writeBlueprintText: vi.fn(async () => ({ ok: true as const, value: { blueprintId: personal.blueprintId, version: '1.0.1', digest: `sha256:${'c'.repeat(64)}`, fileCount: 2, totalBytes: 1_540, updatedAt: 4 } })),
    createBlueprintDirectory: vi.fn(async () => ({ ok: true as const, value: { blueprintId: personal.blueprintId, version: '1.0.1', digest: `sha256:${'c'.repeat(64)}`, fileCount: 2, totalBytes: 1_536, updatedAt: 4 } })),
    deleteBlueprintFile: vi.fn(async () => ({ ok: true as const, value: { blueprintId: personal.blueprintId, version: '1.0.1', digest: `sha256:${'c'.repeat(64)}`, fileCount: 1, totalBytes: 512, updatedAt: 4 } })),
    updateBlueprintComposition: vi.fn(async () => ({ ok: true as const, value: { blueprintId: personal.blueprintId, version: '1.0.1', digest: `sha256:${'c'.repeat(64)}`, fileCount: 2, totalBytes: 1_536, updatedAt: 4 } })),
  }
  return api
}

function sessions() {
  return {
    list: { getSnapshot: () => ({ current: undefined, byId: {} }), subscribe: () => () => {} },
    open: vi.fn(),
  } satisfies HarnessSessionService
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  document.head.querySelectorAll('style[data-paimind-plugin="@paimind/workspace-blueprints"]').forEach(node => { node.remove() })
})

describe('Workspace Blueprint Center client', () => {
  it('uses a native-center surface and reference-counted styles', () => {
    expect(WORKSPACE_BLUEPRINT_CENTER_STYLE).toContain("[data-paimind-product-surface='workspace-blueprints']{position:absolute;inset:0")
    expect(WORKSPACE_BLUEPRINT_CENTER_STYLE).toContain('width:calc(100% + 8px);min-width:0;min-height:34px;margin:4px -4px;padding:6px 8px 6px 10px')
    expect(WORKSPACE_BLUEPRINT_CENTER_STYLE).toContain('color:var(--dsw-alias-label-primary,#202124)')
    expect(WORKSPACE_BLUEPRINT_CENTER_STYLE).not.toContain('color:var(--dsw-alias-label-secondary,#5f6f89)')
    expect(WORKSPACE_BLUEPRINT_CENTER_STYLE).not.toContain('position:fixed')
    expect(WORKSPACE_BLUEPRINT_CENTER_STYLE).not.toContain("head-actions]>[data-paimind-workspace-blueprints-button]{display:none}")
    const first = installWorkspaceBlueprintCenterStyle()
    const second = installWorkspaceBlueprintCenterStyle()
    expect(document.getElementById('@paimind/workspace-blueprints')).toHaveAttribute('data-paimind-style-refs', '2')
    first(); second()
    expect(document.getElementById('@paimind/workspace-blueprints')).toBeNull()
  })

  it('separates built-in templates from personal templates and treats a folder-only package as valid', async () => {
    const api = blueprintRemote()
    render(<WorkspaceBlueprintCenter close={() => {}} blueprints={api} workspaces={workspaces()} locale={locale()} />)

    expect(await screen.findByRole('button', { name: 'View template: Delivery Command Center' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Built-in templates' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('button', { name: 'Template market' })).toBeNull()
    expect(screen.getByText(/folder-only template with no Agent or Business Skill extensions/i)).toBeInTheDocument()
    expect(screen.queryByText('No Agent binding')).toBeNull()
    expect(screen.queryByText(/recommended capabilities/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'My templates' }))
    expect(await screen.findByRole('button', { name: 'View template: My Delivery Kit' })).toBeInTheDocument()
    await waitFor(() => expect(api.listBlueprints).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'user' })))
  })

  it('preflights exact managed-folder Skill revisions and rejects drift', async () => {
    expect(() => preflightWorkspaceBlueprintComposition(boundComposition, compositionChoices({ skillDigest: `sha256:${'9'.repeat(64)}` }))).toThrow(/managed-folder revision.*changed/i)
  })

  it('adopts a folder-only package without requiring Agent or Skill Center', async () => {
    const events: string[] = []
    const native = workspaces({ events })
    const api = blueprintRemote({ events })
    const close = vi.fn()
    render(<WorkspaceBlueprintCenter close={close} blueprints={api} workspaces={native} locale={locale()} />)

    expect(await screen.findByText(/choosing an empty folder/i)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Copy to new Workspace' }))
    await waitFor(() => expect(close).toHaveBeenCalledWith(false))
    expect(events).toEqual(['pick', 'create:/tmp/new-workspace', 'materialize:workspace-new', 'start:workspace-new'])
  })

  it('localizes a rejected non-empty adoption after preserving native Workspace registration', async () => {
    const api = blueprintRemote()
    api.materializeBlueprint.mockRejectedValueOnce(new Error('Workspace Blueprint target must be empty'))
    render(<WorkspaceBlueprintCenter close={() => {}} blueprints={api} workspaces={workspaces()} locale={locale('zh-CN')} />)

    fireEvent.click(await screen.findByRole('button', { name: '复制为新工作区' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('原生工作区已注册并保留，但后续采用流程未完成；系统没有自动删除所选目录。原因：目标文件夹必须为空')
    expect(screen.getByRole('alert')).not.toHaveTextContent('Workspace Blueprint target must be empty')
  })

  it('does not expose an unknown remote error or absolute path in the Chinese UI', async () => {
    const api = blueprintRemote()
    api.materializeBlueprint.mockRejectedValueOnce(new Error('EACCES: permission denied, open /Users/example/private'))
    render(<WorkspaceBlueprintCenter close={() => {}} blueprints={api} workspaces={workspaces()} locale={locale('zh-CN')} />)

    fireEvent.click(await screen.findByRole('button', { name: '复制为新工作区' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('操作未完成，请重试；如问题持续，请查看运行日志。')
    expect(screen.getByRole('alert')).not.toHaveTextContent('/Users/example/private')
  })

  it('validates exact bindings, materializes, and binds only the native entry Agent Session', async () => {
    const events: string[] = []
    const bound = item({ composition: boundComposition })
    const api = blueprintRemote({ builtins: [bound], events })
    const native = workspaces({ events })
    const nativeSessions = sessions()
    const sessionApi = { create: vi.fn(async () => { events.push('create-session'); return { result: { ok: true as const, value: { sessionId: 'session-entry', agentPreset: 'delivery-preset' } } } }) }
    const close = vi.fn()
    render(<WorkspaceBlueprintCenter close={close} blueprints={api} workspaces={native} locale={locale()} sessions={nativeSessions} sessionApi={sessionApi as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Copy to new Workspace' }))
    await waitFor(() => expect(close).toHaveBeenCalledWith(false))
    expect(events).toEqual(['choices', 'pick', 'create:/tmp/new-workspace', 'materialize:workspace-new', 'create-session', 'bind-entry-agent'])
    expect(native.startSession).not.toHaveBeenCalled()
    expect(api.bindEntryAgentSession).toHaveBeenCalledWith({
      workspaceId: 'workspace-new', sessionId: 'session-entry', blueprintId: bound.blueprintId,
      version: bound.version, expectedDigest: bound.digest,
    })
    expect(nativeSessions.open).toHaveBeenCalledWith('session-entry')
  })

  it('publishes a personal folder-only package from an authoritative registered Workspace', async () => {
    const source = workspaceView('workspace-source', '/tmp/source')
    const api = blueprintRemote({ users: [] })
    render(<WorkspaceBlueprintCenter close={() => {}} blueprints={api} workspaces={workspaces({ items: [source] })} locale={locale()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Create personal template' }))
    const sourceSelect = screen.getByRole('combobox', { name: 'Source Workspace' })
    expect(sourceSelect).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled()
    fireEvent.change(sourceSelect, { target: { value: 'workspace-source' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Template identifier' }), { target: { value: 'my-blueprint' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'My Blueprint' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'A reusable starting Workspace.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))

    await waitFor(() => expect(api.publishBlueprint).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-source', blueprintId: 'my-blueprint', version: '1.0.0',
      composition: folderOnly,
    })))
  })

  it('loads Agent and Business Skill choices only through the Blueprint-owned Host projection', async () => {
    const source = workspaceView('workspace-source', '/tmp/source')
    const api = blueprintRemote({ users: [] })
    render(<WorkspaceBlueprintCenter close={() => {}} blueprints={api} workspaces={workspaces({ items: [source] })} locale={locale()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Create personal template' }))
    expect(api.getCompositionChoices).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Configure optional extensions' }))
    expect(await screen.findByRole('option', { name: 'Delivery Agent' })).toBeInTheDocument()
    expect(screen.getByText('delivery-risk')).toBeInTheDocument()
    expect(api.getCompositionChoices).toHaveBeenCalledOnce()
  })

  it('retries one transient choices failure and then exposes the recovered exact choices', async () => {
    const source = workspaceView('workspace-source', '/tmp/source')
    const api = blueprintRemote({ users: [] })
    api.getCompositionChoices
      .mockRejectedValueOnce(new Error('projection is still starting'))
      .mockResolvedValueOnce({ ok: true as const, value: compositionChoices() })
    render(<WorkspaceBlueprintCenter close={() => {}} blueprints={api} workspaces={workspaces({ items: [source] })} locale={locale()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Create personal template' }))
    fireEvent.click(screen.getByRole('button', { name: 'Configure optional extensions' }))
    expect(await screen.findByRole('option', { name: 'Delivery Agent' })).toBeInTheDocument()
    expect(api.getCompositionChoices).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/projection is still starting/i)).toBeNull()
  })

  it('shows request failures, provider states, and genuinely empty choices without conflating them', async () => {
    const source = workspaceView('workspace-source', '/tmp/source')
    const rejected = blueprintRemote({ users: [] })
    rejected.getCompositionChoices.mockRejectedValue(new Error('projection bridge offline'))
    const first = render(<WorkspaceBlueprintCenter close={() => {}} blueprints={rejected} workspaces={workspaces({ items: [source] })} locale={locale()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Create personal template' }))
    fireEvent.click(screen.getByRole('button', { name: 'Configure optional extensions' }))
    expect(await screen.findAllByText(/projection bridge offline/i)).toHaveLength(2)
    expect(rejected.getCompositionChoices).toHaveBeenCalledTimes(2)
    first.unmount()

    const providerStates = blueprintRemote({ users: [], choices: compositionChoices({ agentStatus: 'unavailable', skillStatus: 'error' }) })
    render(<WorkspaceBlueprintCenter close={() => {}} blueprints={providerStates} workspaces={workspaces({ items: [source] })} locale={locale()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Create personal template' }))
    fireEvent.click(screen.getByRole('button', { name: 'Configure optional extensions' }))
    expect(await screen.findByText(/Agent Center is not connected/i)).toBeInTheDocument()
    expect(screen.getByText(/Business Skill choices could not be read/i)).toBeInTheDocument()
    cleanup()

    const empty = blueprintRemote({ users: [], choices: compositionChoices({ agentItems: [], skillItems: [] }) })
    render(<WorkspaceBlueprintCenter close={() => {}} blueprints={empty} workspaces={workspaces({ items: [source] })} locale={locale()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Create personal template' }))
    fireEvent.click(screen.getByRole('button', { name: 'Configure optional extensions' }))
    expect(await screen.findByText('No Agent choices are currently available.')).toBeInTheDocument()
    expect(screen.getByText('No Business Skill choices are currently available.')).toBeInTheDocument()
  })

  it('collapses folder branches and searches a growing Business Skill list', async () => {
    const source = workspaceView('workspace-source', '/tmp/source')
    const choices = compositionChoices({ skillItems: [
      { name: 'delivery-risk', description: 'Review delivery risk', digest: `sha256:${'d'.repeat(64)}` },
      { name: 'research-brief', description: 'Prepare evidence briefs', digest: `sha256:${'e'.repeat(64)}` },
    ] })
    const api = blueprintRemote({ users: [], choices })
    render(<WorkspaceBlueprintCenter close={() => {}} blueprints={api} workspaces={workspaces({ items: [source] })} locale={locale()} />)

    const folder = await screen.findByRole('button', { name: 'Collapse folder: playbooks' })
    expect(screen.getByRole('button', { name: 'Open entry: playbooks/review.md' })).toBeInTheDocument()
    fireEvent.click(folder)
    expect(screen.queryByRole('button', { name: 'Open entry: playbooks/review.md' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand folder: playbooks' }))
    expect(screen.getByRole('button', { name: 'Open entry: playbooks/review.md' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create personal template' }))
    fireEvent.click(screen.getByRole('button', { name: 'Configure optional extensions' }))
    const search = await screen.findByRole('searchbox', { name: 'Search Business Skills' })
    fireEvent.change(search, { target: { value: 'evidence' } })
    expect(screen.getByText('research-brief')).toBeInTheDocument()
    expect(screen.queryByText('delivery-risk')).toBeNull()
  })

  it('edits files and optional extensions by creating a new preserved version', async () => {
    const api = blueprintRemote({ builtins: [], users: [personal] })
    render(<WorkspaceBlueprintCenter close={() => {}} blueprints={api} workspaces={workspaces()} locale={locale()} />)
    fireEvent.click(screen.getByRole('button', { name: 'My templates' }))
    await screen.findByRole('button', { name: 'View template: My Delivery Kit' })

    fireEvent.click(await screen.findByRole('button', { name: 'Open entry: PROJECT.md' }))
    const editor = await screen.findByRole('textbox', { name: 'Template text file editor' })
    fireEvent.change(editor, { target: { value: '# Updated Project\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as new version' }))
    await waitFor(() => expect(api.writeBlueprintText).toHaveBeenCalledWith(expect.objectContaining({ path: 'PROJECT.md', text: '# Updated Project\n', expectedDigest: personal.digest })))
    expect(await screen.findByText(/saved as v1\.0\.1.*original v1\.0\.0 remains unchanged/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await screen.findByRole('button', { name: 'Save extension settings' })
    fireEvent.click(screen.getByRole('button', { name: 'Save extension settings' }))
    await waitFor(() => expect(api.updateBlueprintComposition).toHaveBeenCalledWith(expect.objectContaining({ composition: folderOnly })))
  })

  it('registers the extension, footer entry, and product surface with Session support', async () => {
    const registered: string[] = []
    const effects: Array<() => void | Promise<void>> = []
    const remoteDispose = vi.fn()
    const context: Record<string, unknown> = {
      remote: { paimindWorkspaceBlueprints: blueprintRemote(), $mount: vi.fn(async () => remoteDispose) },
      locale: locale(), workspaces: workspaces(), sessions: sessions(), reflect: { provide: () => () => {} },
      get: () => ({ api: { sessions: {} } }),
      slots: {
        inject(name: string, install: () => unknown) { registered.push(name); const dispose = install(); if (typeof dispose === 'function') effects.push(dispose as () => void) },
        register: () => () => {},
      },
      effect(install: () => void | (() => void)) { const dispose = install(); if (typeof dispose === 'function') effects.push(dispose) },
    }
    context.inject = (_services: readonly string[], install: (scope: unknown) => void) => {
      install(context)
      return Object.assign(Promise.resolve(), { dispose: async () => { for (const dispose of effects.reverse()) await dispose() } })
    }

    const dispose = await apply(context as never)
    expect(inject).toEqual(['slots', 'locale', 'remote', 'workspaces', 'sessions'])
    expect(registered).toEqual(['paimind.extension', 'sidebar.footer.action', 'shell.overlay'])
    await dispose()
    expect(remoteDispose).toHaveBeenCalledOnce()
  })

})
