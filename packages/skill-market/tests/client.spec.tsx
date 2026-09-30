import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  HarnessSessionListSnapshot,
  HarnessSessionService,
  PaimindLocaleSource,
} from '@paimind/harness-compat'
import { PaimindProductSurfaceController } from '@paimind/harness-compat/client-surface'
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
import { SkillCenterContributionRegistry, type SkillCenterPanelProps, type SkillCenterSourceActionProps } from '../src/client/contributions.js'

const recommendations = [
  { id: 'openai-docs', name: 'openai-docs', description: 'Find official documentation', version: '1.0.0', source: 'OpenAI Official · Adapted for Harness', license: 'Apache-2.0', digest: `sha256:${'a'.repeat(64)}`, category: 'research', tags: ['official-docs', 'research'] },
  { id: 'bento-ppt', name: 'bento-ppt', description: 'Create presentations', version: '1.0.0', source: 'PAIMind', license: 'Internal', digest: `sha256:${'b'.repeat(64)}`, category: 'content', tags: ['artifact', 'presentation'] },
] as const

describe('original Skill source submission projection (client adapter fixtures, NOT Browser E2E)', () => {
  const record = { skillId: 'openai-docs', name: 'openai-docs', description: 'Original source', digest: 'sha256:' + 'a'.repeat(64),
    sourceFileName: 'original.zip', installedAt: 1, updatedAt: 1, managed: true, runtimeRequirements: [] }
  async function fixture(patch = {}) {
    const api = installer([{ ...record, ...patch }]), contributions = new SkillCenterContributionRegistry()
    let props!: SkillCenterSourceActionProps
    const remove = contributions.register({ id: 'enterprise', zh: '企业分配的', en: 'Assigned', Panel: () => null, SourceAction: next => {
      props = next; return <button onClick={() => next.onEditing(true)}>Prepare submission</button>
    } })
    const view = render(<SkillMarketSection contributions={contributions} close={() => {}} installer={api as never} sessions={runtime().sessions} locale={locale()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Installed' })); await screen.findByRole('heading', { name: record.name })
    return { api, contributions, remove, view, props: () => props }
  }
  it('supplies only a current original-source reader and uses the directory digest, not the install archive digest', async () => {
    const f = await fixture(); expect(f.api.getSkillPackage).not.toHaveBeenCalled()
    expect(Object.keys(f.props()).sort()).toEqual(['disabled', 'onEditing', 'readSource', 'selection'])
    expect(f.props().selection).toEqual({ skillId: record.skillId, name: record.name })
    expect(await f.props().readSource(record.skillId, new AbortController().signal)).toEqual({ skillId: record.skillId, name: record.name, digest: 'sha256:' + 'c'.repeat(64) })
    expect(f.api.getSkillPackage).toHaveBeenCalledWith({ skillId: record.skillId })
    expect(f.api.saveSkillPackage).not.toHaveBeenCalled(); expect(f.api.replaceUserSkillPolicy).not.toHaveBeenCalled()
  })
  it('locks native source navigation and policy actions while confirming, and releases them when the contribution is removed', async () => {
    const f = await fixture(); fireEvent.click(screen.getByRole('button', { name: 'Prepare submission' }))
    expect(screen.getByRole('tab', { name: 'Market' })).toBeDisabled(); expect(screen.getByRole('searchbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'View installed: openai-docs' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Uninstall' })).toBeDisabled()
    act(() => f.remove()); expect(screen.queryByRole('button', { name: 'Prepare submission' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Installed' })).toBeEnabled(); expect(screen.getByRole('searchbox')).toBeEnabled()
  })
  it.each([{ managed: false }, { publication: { publicationId: 'retained-version' } }])('does not offer source submission for ineligible installed records: %j', async patch => {
    const f = await fixture(patch); expect(screen.queryByRole('button', { name: 'Prepare submission' })).toBeNull()
    expect(f.api.getSkillPackage).not.toHaveBeenCalled()
  })
  it.each([{ managed: false }, { publication: {} }])('rechecks original ownership before reading a source that became ineligible: %j', async patch => {
    const f = await fixture(); f.api.listInstalled.mockResolvedValue({ ok: true, value: { items: [{ ...record, ...patch }] } })
    await expect(f.props().readSource(record.skillId, new AbortController().signal)).rejects.toThrow('只可提交')
    expect(f.api.getSkillPackage).not.toHaveBeenCalled()
  })
  it('rejects invalid or wrong source metadata without making a native write', async () => {
    const f = await fixture()
    await expect(f.props().readSource('../other', new AbortController().signal)).rejects.toThrow('编号无效')
    f.api.getSkillPackage.mockResolvedValue({ ok: true, value: { skillId: 'foreign', name: 'foreign', managed: true, digest: record.digest } })
    await expect(f.props().readSource(record.skillId, new AbortController().signal)).rejects.toThrow('版本未确认')
    expect(f.api.saveSkillPackage).not.toHaveBeenCalled()
  })
  it('refuses a retained callback after the contribution is removed, without reusing the native owner authority', async () => {
    const f = await fixture(), read = f.props().readSource
    act(() => f.remove()); await expect(read(record.skillId, new AbortController().signal)).rejects.toThrow('入口已变化')
    expect(f.api.getSkillPackage).not.toHaveBeenCalled()
  })
  it('aborts a hung original read on owner unload and ignores the eventual response', async () => {
    const f = await fixture(); let done!: (value: unknown) => void
    f.api.getSkillPackage.mockImplementation(() => new Promise(resolve => { done = resolve }))
    const pending = f.props().readSource(record.skillId, new AbortController().signal)
    await waitFor(() => expect(done).toBeTypeOf('function')); f.view.unmount()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    done({ ok: true, value: { skillId: record.skillId, name: record.name, digest: record.digest, managed: true } })
    expect(f.api.saveSkillPackage).not.toHaveBeenCalled()
  })
})

describe('enterprise Skill native-owner handoff (component fixtures, NOT Browser E2E)', () => {
  const publication = { schema: 'paimind.skill-adoption/v1', adoptedAt: 1, tenantId: 'fixture',
    publicationId: 'c0000000-0000-4000-8000-000000000003', sourceUserId: 'a0000000-0000-4000-8000-000000000001',
    name: 'openai-docs', packageDigest: `sha256:${'c'.repeat(64)}`, archiveDigest: `sha256:${'a'.repeat(64)}`, archiveBytes: 2048, expandedBytes: 1024, entryCount: 2 }
  const selected = { publicationId: publication.publicationId, name: publication.name, packageDigest: publication.packageDigest, archiveDigest: publication.archiveDigest }
  const record = { skillId: 'openai-docs', name: 'openai-docs', description: 'Governed instructions', digest: publication.archiveDigest,
    sourceFileName: 'immutable.zip', installedAt: 1, updatedAt: 1, managed: true, runtimeRequirements: [], publication, publicationEligible: true,
    publicationPreference: { revision: 0, enabled: false, direct: false } }
  async function fixture() {
    const api = installer(), contributions = new SkillCenterContributionRegistry()
    let props!: SkillCenterPanelProps
    let remove = () => {}
    const view = render(<SkillMarketSection contributions={contributions} close={() => {}} installer={api as never} sessions={runtime().sessions} locale={locale()} />)
    await screen.findByRole('tab', { name: 'Market' })
    act(() => { remove = contributions.register({ id: 'enterprise', zh: '企业分配的', en: 'Assigned', Panel: next => {
      props = next; return <button onClick={() => next.onEditing?.(true)}>Confirm adoption</button>
    } }) })
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Installed' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Assigned' })).toHaveFocus()
    await screen.findByRole('button', { name: 'Confirm adoption' })
    return { api, contributions, view, remove, props: () => props }
  }
  it('adds a removable catalog and locks other native actions while its confirmation is open', async () => {
    const f = await fixture()
    expect(Object.keys(f.props()).sort()).toEqual(['onEditing', 'showAdoptedSkill'])
    fireEvent.click(screen.getByRole('button', { name: 'Confirm adoption' }))
    expect(screen.getByRole('tab', { name: 'Installed' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Add Skill' })).toBeDisabled()
    act(() => f.remove()); expect(screen.queryByRole('tab', { name: 'Assigned' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Installed' })).toHaveAttribute('aria-selected', 'true'); expect(screen.getByRole('button', { name: 'Add Skill' })).toBeEnabled()
  })
  it('verifies both original provenance and live directory digest, then lets the user explicitly enable without changing other scopes', async () => {
    const f = await fixture(); f.api.listInstalled.mockResolvedValue({ ok: true, value: { items: [record] } })
    await act(async () => f.props().showAdoptedSkill!(selected, new AbortController().signal))
    expect(screen.getByRole('tab', { name: 'Installed' })).toHaveAttribute('aria-selected', 'true')
    await screen.findByText('Enterprise fixed version · read-only')
    expect(f.api.readAdoptedSkillContent).toHaveBeenCalledWith({ reference: expect.objectContaining({ publicationId: publication.publicationId,
      packageDigest: publication.packageDigest, archiveDigest: publication.archiveDigest }), kind: 'directory', path: '' })
    expect(f.api.getSkillPackage).not.toHaveBeenCalled(); expect(f.api.replaceUserSkillPolicy).not.toHaveBeenCalled()
    expect(f.api.installUpload).not.toHaveBeenCalled(); expect(f.api.saveSkillPackage).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Enable openai-docs' })).toBeEnabled())
    expect(screen.getByRole('switch', { name: 'Enable openai-docs' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('switch', { name: 'Enable openai-docs' }))
    await waitFor(() => expect(f.api.setAdoptedSkillPreference).toHaveBeenCalledOnce())
    expect(f.api.setAdoptedSkillPreference.mock.calls[0]![0]).toMatchObject({ reference: expect.objectContaining({ publicationId: publication.publicationId }), expectedRevision: 0, field: 'enabled', value: true })
    expect(f.api.replaceUserSkillPolicy).not.toHaveBeenCalled()
    expect(f.api.replaceSessionBusinessSkillSelection).not.toHaveBeenCalled()
  })
  it.each([{ publicationEligible: false }, { publication: { ...publication, publicationId: 'd0000000-0000-4000-8000-000000000004' } },
    { publication: { ...publication, archiveDigest: `sha256:${'b'.repeat(64)}` } }])('rejects a mismatched installed projection: %j', async patch => {
    const f = await fixture(); f.api.listInstalled.mockResolvedValue({ ok: true, value: { items: [{ ...record, ...patch }] } })
    await expect(f.props().showAdoptedSkill!(selected, new AbortController().signal)).rejects.toThrow('未确认')
    expect(screen.getByRole('tab', { name: 'Assigned' })).toHaveAttribute('aria-selected', 'true')
    expect(f.api.getSkillPackage).not.toHaveBeenCalled(); expect(f.api.replaceUserSkillPolicy).not.toHaveBeenCalled()
  })
  it('keeps missing restricted preference support locked without falling back to platform policy writes', async () => {
    const f = await fixture(); (f.api as any).setAdoptedSkillPreference = undefined
    f.api.listInstalled.mockResolvedValue({ ok: true, value: { items: [record] } })
    await act(async () => f.props().showAdoptedSkill!(selected, new AbortController().signal))
    const enable = await screen.findByRole('switch', { name: 'Enable openai-docs' })
    expect(enable).toBeDisabled(); fireEvent.click(enable); expect(f.api.replaceUserSkillPolicy).not.toHaveBeenCalled()
  })
  it('shows stored intent separately after revocation, allows withdrawal, and keeps actual Session use denied', async () => {
    const f = await fixture()
    f.api.listInstalled.mockResolvedValue({ ok: true, value: { items: [{ ...record, publicationEligible: false,
      publicationPreference: { revision: 3, enabled: true, direct: true } }] } })
    // Open the existing Installed view directly; revoked adoption navigation is denied.
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    act(() => f.remove())
    // Reload the mounted owner to read the new native projection.
    f.view.unmount()
    const native = runtime()
    render(<SkillMarketSection close={() => {}} installer={f.api as never} sessions={native.sessions} locale={locale()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    const enable = await screen.findByRole('switch', { name: 'Enable openai-docs' })
    await waitFor(() => expect(enable).toBeEnabled()); expect(enable).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Use openai-docs in current conversation' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Attach in Agent Center' })).toBeDisabled()
    fireEvent.click(enable)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Enable openai-docs' })).not.toBeChecked())
    expect(f.api.setAdoptedSkillPreference).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3, field: 'enabled', value: false }))
    expect(f.api.replaceUserSkillPolicy).not.toHaveBeenCalled(); expect(f.api.replaceSessionBusinessSkillSelection).not.toHaveBeenCalled()
  })
  it('deduplicates pending preference clicks and discards a late reply when the native owner unmounts', async () => {
    const f = await fixture(); f.api.listInstalled.mockResolvedValue({ ok: true, value: { items: [record] } })
    await act(async () => f.props().showAdoptedSkill!(selected, new AbortController().signal))
    let release!: (value: unknown) => void
    f.api.setAdoptedSkillPreference.mockImplementation(() => new Promise(done => { release = done }) as never)
    const control = await screen.findByRole('switch', { name: 'Enable openai-docs' })
    fireEvent.click(control); fireEvent.click(control)
    await waitFor(() => expect(release).toBeTypeOf('function')); expect(f.api.setAdoptedSkillPreference).toHaveBeenCalledOnce()
    f.view.unmount(); await act(async () => release({ ok: true, value: {} }))
    expect(screen.queryByText(/Preference saved/)).toBeNull(); expect(f.api.replaceUserSkillPolicy).not.toHaveBeenCalled()
  })
  it('rejects a mismatched preference receipt and re-reads current state without retrying the write', async () => {
    const f = await fixture(); f.api.listInstalled.mockResolvedValue({ ok: true, value: { items: [record] } })
    await act(async () => f.props().showAdoptedSkill!(selected, new AbortController().signal))
    f.api.setAdoptedSkillPreference.mockResolvedValue({ ok: true, value: { reference: { ...publication, publicationId: 'foreign' },
      revision: 1, enabled: true, direct: false, runtimeGrant: false } } as never)
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable openai-docs' }))
    await screen.findByText(/preference receipt does not match/)
    expect(f.api.setAdoptedSkillPreference).toHaveBeenCalledOnce(); expect(f.api.replaceUserSkillPolicy).not.toHaveBeenCalled()
    expect(screen.queryByText(/Preference saved/)).toBeNull()
  })
  it('replaces native-owner UI state during a pending preference without borrowing old results or leaving the new owner busy', async () => {
    const f = await fixture(); f.api.listInstalled.mockResolvedValue({ ok: true, value: { items: [record] } })
    await act(async () => f.props().showAdoptedSkill!(selected, new AbortController().signal))
    let release!: (value: unknown) => void
    f.api.setAdoptedSkillPreference.mockImplementation(() => new Promise(done => { release = done }) as never)
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable openai-docs' })); await waitFor(() => expect(release).toBeTypeOf('function'))
    const other = installer([{ ...record, description: 'Alex independent native owner' }]), native = runtime()
    f.view.rerender(<SkillMarketSection close={() => {}} installer={other as never} sessions={native.sessions} locale={locale()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    const control = await screen.findByRole('switch', { name: 'Enable openai-docs' })
    await waitFor(() => expect(control).toBeEnabled())
    fireEvent.click(control); await screen.findByText(/Preference saved/)
    expect(other.setAdoptedSkillPreference).toHaveBeenCalledOnce()
    const reads = other.listInstalled.mock.calls.length
    await act(async () => release({ ok: true, value: { reference: {}, runtimeGrant: true } }))
    expect(other.listInstalled).toHaveBeenCalledTimes(reads); expect(screen.queryByText(/receipt does not match/)).toBeNull()
    expect(screen.getByRole('switch', { name: 'Enable openai-docs' })).toBeChecked()
  })
  it('does not substitute the archive digest for the live package digest', async () => {
    const f = await fixture(); f.api.listInstalled.mockResolvedValue({ ok: true, value: { items: [record] } })
    f.api.readAdoptedSkillContent.mockImplementation(async input => ({ ok: true, value: { reference: { ...input.reference, packageDigest: publication.archiveDigest },
      kind: 'directory', runtimeGrant: false, page: { path: '', entries: [] } } }))
    await expect(f.props().showAdoptedSkill!(selected, new AbortController().signal)).rejects.toThrow('不一致')
    expect(screen.getByRole('tab', { name: 'Assigned' })).toHaveAttribute('aria-selected', 'true')
  })
  it('owner unload rejects a pending read immediately and ignores a late native response', async () => {
    const f = await fixture(); let complete!: (value: unknown) => void
    f.api.listInstalled.mockImplementation(() => new Promise(done => { complete = done }))
    const operation = f.props().showAdoptedSkill!(selected, new AbortController().signal)
    await waitFor(() => expect(complete).toBeTypeOf('function')); f.view.unmount()
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    complete({ ok: true, value: { items: [record] } }); await Promise.resolve()
    expect(f.api.getSkillPackage).not.toHaveBeenCalled(); expect(f.api.replaceUserSkillPolicy).not.toHaveBeenCalled()
  })
})

const builtInSkills = [
  {
    kind: 'system', canonicalId: 'system:genui', name: 'genui', description: 'Generate structured UI',
    availability: 'optional', userControl: 'atomic', sourcePluginId: '@deepseek-ai/dsh-tool-genui',
  },
  {
    kind: 'system', canonicalId: 'system:paimind-skill-installation', name: 'paimind-skill-installation', description: 'Install Business Skills from GitHub',
    availability: 'optional', userControl: 'atomic', sourcePluginId: '@paimind/skill-market',
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
  const api = {
    listCatalog: vi.fn().mockResolvedValue({ ok: true, value: { items: recommendations } }),
    listInstalled: vi.fn().mockResolvedValue({ ok: true, value: { items } }),
    readAdoptedSkillContent: vi.fn().mockImplementation(async input => ({ ok: true, value: { reference: input.reference,
      kind: 'directory', runtimeGrant: false, page: { path: '', entries: [] } } })),
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
    setAdoptedSkillPreference: vi.fn().mockImplementation(async (input: { reference: { name: string; publicationId: string }; expectedRevision: number; field: 'enabled' | 'direct'; value: boolean }) => {
      const installed = (await api.listInstalled()).value.items as Array<{ name: string; publicationEligible?: boolean; publicationPreference?: { revision: number; enabled: boolean; direct: boolean } }>
      const item = installed.find(item => item.name === input.reference.name)!
      const preference = { ...item.publicationPreference!, revision: input.expectedRevision + 1, [input.field]: input.value }
      if (!preference.enabled) preference.direct = false
      api.listInstalled.mockResolvedValue({ ok: true, value: { items: installed.map(row => row === item ? { ...row, publicationPreference: preference } : row) } })
      policy = { ...policy, revision: preference.revision,
        enabledBusinessSkillNames: preference.enabled && item.publicationEligible ? [item.name] : [],
        directBusinessSkillNames: preference.direct && item.publicationEligible ? [item.name] : [] }
      return { ok: true, value: { reference: input.reference, ...preference, runtimeGrant: false } }
    }),
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
  return api
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

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.head.querySelectorAll('style[data-paimind-plugin="@paimind/skill-market"]').forEach(node => { node.remove() }) })

describe('member Skill presentation (component fixtures, NOT Browser E2E)', () => {
  const record = { skillId: 'openai-docs', name: 'openai-docs', description: 'Retained original source', managed: true,
    digest: `sha256:${'a'.repeat(64)}`, runtimeRequirements: [] }
  it('loads the installed owner without forbidden market or authoring requests, including keyboard navigation', async () => {
    const host = installer([record])
    host.listCatalog.mockResolvedValue({ ok: false, error: { message: 'member-operation-forbidden' } })
    host.getAuthoringDraft.mockResolvedValue({ ok: false, error: { message: 'member-operation-forbidden' } })
    const contributions = new SkillCenterContributionRegistry()
    contributions.register({ id: 'enterprise', zh: '企业分配的', en: 'Assigned', Panel: () => <p>Current assigned catalog</p>,
      SourceAction: () => <button>Prepare submission</button> })
    render(<SkillMarketSection audience="member" contributions={contributions} close={() => {}} installer={host as never} sessions={runtime().sessions} locale={locale()} />)
    await screen.findByRole('heading', { name: record.name })
    expect(screen.getByRole('tab', { name: 'Installed' })).toHaveAttribute('aria-selected', 'true')
    for (const name of ['Add Skill', 'Edit', 'Uninstall', 'Prepare submission']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Market' })).toBeNull()
    expect(screen.getByRole('switch', { name: 'Enable openai-docs' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Use openai-docs by default in direct chats' })).toBeDisabled()
    expect(screen.queryByText('Service unavailable')).toBeNull()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Installed' }), { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'Built-in' })).toHaveFocus()
    for (const control of await screen.findAllByRole('switch')) { expect(control).toBeDisabled(); fireEvent.click(control) }
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Built-in' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Assigned' })).toHaveFocus()
    await screen.findByText('Current assigned catalog')
    expect(host.listCatalog).not.toHaveBeenCalled(); expect(host.getAuthoringDraft).not.toHaveBeenCalled()
    expect(host.replaceUserSkillPolicy).not.toHaveBeenCalled(); expect(host.getSkillPackage).not.toHaveBeenCalled()
  })
  it('explains an empty member list without directing the member to forbidden installation', async () => {
    const host = installer()
    render(<SkillMarketSection audience="member" close={() => {}} installer={host as never} sessions={runtime().sessions} locale={locale()} />)
    await screen.findByText('No Skills have been adopted here. Check enterprise assignments or contact your administrator.')
    for (const name of ['Browse market', 'Import local', 'Add Skill']) expect(screen.queryByRole('button', { name })).toBeNull()
  })
  it('shows an original installed-read failure and retries instead of reporting an empty catalog', async () => {
    const host = installer()
    host.listInstalled.mockResolvedValueOnce({ ok: false, error: { message: 'installed-owner-unavailable' } })
    render(<SkillMarketSection audience="member" close={() => {}} installer={host as never} sessions={runtime().sessions} locale={locale()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('installed-owner-unavailable')
    expect(screen.queryByText(/No Skills have been adopted/)).toBeNull()
    host.listInstalled.mockResolvedValue({ ok: true, value: { items: [record] } })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('heading', { name: record.name })
    expect(host.listCatalog).not.toHaveBeenCalled()
  })
  it('keeps installed content independently available when the administrator market read fails', async () => {
    const host = installer([record])
    host.listCatalog.mockResolvedValue({ ok: false, error: { message: 'catalog-owner-unavailable' } })
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={runtime().sessions} locale={locale()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('catalog-owner-unavailable')
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    await screen.findByRole('heading', { name: record.name })
  })
})

describe('Skill Market business UI', () => {
  it.each([['en-US', 'default'], ['zh-CN', 'default'], ['en-US', 'member'], ['zh-CN', 'member']] as const)('allows the existing scope controls only with current enterprise eligibility in %s / %s', async (language, audience) => {
    const zh = language === 'zh-CN', native = runtime()
    const host = installer([{ skillId: 'customer-notes', name: 'customer-notes', description: 'Assigned fixed version', managed: true,
      digest: `sha256:${'c'.repeat(64)}`, runtimeRequirements: [], publicationEligible: true, publicationPreference: { revision: 0, enabled: true, direct: false }, publication: {
        schema: 'paimind.skill-adoption/v1', tenantId: 'enterprise-test', publicationId: 'eb6ed5e2-d7d8-4fb9-937f-28cd5a2f0fae',
        sourceUserId: 'ab301a92-c6d7-4af8-8ef7-7db59407499e', name: 'customer-notes', packageDigest: `sha256:${'d'.repeat(64)}`,
        archiveDigest: `sha256:${'c'.repeat(64)}`, archiveBytes: 100, expandedBytes: 80, entryCount: 1, adoptedAt: 42,
      } }])
    render(<SkillMarketSection audience={audience} close={() => {}} installer={host as never} sessions={native.sessions} locale={locale(language)} />)
    fireEvent.click(screen.getByRole('tab', { name: zh ? '已安装' : 'Installed' }))
    const enable = await screen.findByRole('switch', { name: zh ? '允许使用 customer-notes' : 'Enable customer-notes' })
    await waitFor(() => expect(enable).not.toBeDisabled())
    expect(enable).toBeChecked()
    const direct = screen.getByRole('switch', { name: zh ? '普通对话默认使用 customer-notes' : 'Use customer-notes by default in direct chats' })
    fireEvent.click(direct)
    await waitFor(() => expect(direct).toBeChecked())
    expect(host.setAdoptedSkillPreference).toHaveBeenCalledWith(expect.objectContaining({ field: 'direct', value: true }))
    expect(host.replaceUserSkillPolicy).not.toHaveBeenCalled()
    const current = screen.getByRole('switch', { name: zh ? '用于当前对话 customer-notes' : 'Use customer-notes in current conversation' })
    fireEvent.click(current)
    await waitFor(() => expect(current).toBeChecked())
    expect(host.replaceSessionBusinessSkillSelection).toHaveBeenCalledWith(expect.objectContaining({ skillNames: ['customer-notes'] }))
    fireEvent.click(enable)
    await waitFor(() => expect(enable).not.toBeChecked())
    expect(direct).not.toBeChecked()
    for (const name of [zh ? '编辑' : 'Edit', zh ? '卸载' : 'Uninstall']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    expect(host.saveSkillPackage).not.toHaveBeenCalled(); expect(host.uninstall).not.toHaveBeenCalled()
  })
  it.each(['en-US', 'zh-CN'])('keeps an enterprise fixed version visibly read-only in %s without faking runtime eligibility', async language => {
    const zh = language === 'zh-CN', native = runtime()
    const host = installer([{ skillId: 'openai-docs', name: 'openai-docs', description: 'Assigned fixed version', managed: true,
      digest: `sha256:${'c'.repeat(64)}`, runtimeRequirements: [], publication: {
        schema: 'paimind.skill-adoption/v1', tenantId: 'enterprise-test', publicationId: 'eb6ed5e2-d7d8-4fb9-937f-28cd5a2f0fae',
        sourceUserId: 'ab301a92-c6d7-4af8-8ef7-7db59407499e', name: 'openai-docs', packageDigest: `sha256:${'d'.repeat(64)}`,
        archiveDigest: `sha256:${'c'.repeat(64)}`, archiveBytes: 100, expandedBytes: 80, entryCount: 1, adoptedAt: 42,
      } }])
    // Deliberately stale local preferences must not make a receipt into authority.
    render(<SkillMarketSection close={() => {}} installer={host as never} sessions={native.sessions} locale={locale(language)} />)
    await screen.findByRole('button', { name: `${zh ? '查看' : 'View'}: openai-docs` })
    expect(screen.queryByRole('button', { name: zh ? '更新' : 'Update' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: zh ? '已安装' : 'Installed' }))
    expect(await screen.findByText(zh ? '企业分配 · 只读' : 'Enterprise assigned · read-only')).toBeInTheDocument()
    expect(screen.getByText(zh ? /当前企业分配不可用或资格服务未接通/ : /current assignment is unavailable or eligibility is not connected/)).toBeInTheDocument()
    for (const name of [zh ? '编辑' : 'Edit', zh ? '更新' : 'Update', zh ? '卸载' : 'Uninstall']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    for (const control of screen.getAllByRole('switch')) {
      expect(control).toBeDisabled(); expect(control).not.toBeChecked(); fireEvent.click(control)
    }
    expect(screen.getByRole('button', { name: zh ? '从智能体中心挂载' : 'Attach in Agent Center' })).toBeDisabled()
    expect(host.replaceUserSkillPolicy).not.toHaveBeenCalled()
    expect(host.replaceSessionBusinessSkillSelection).not.toHaveBeenCalled()
    expect(host.installUpload).not.toHaveBeenCalled(); expect(host.uninstall).not.toHaveBeenCalled()
    expect(host.inspectCatalog).not.toHaveBeenCalled(); expect(host.saveSkillPackage).not.toHaveBeenCalled()
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
    const style = document.head.querySelector('style[data-paimind-plugin="@paimind/skill-market"]')
    expect(style).not.toBeNull()
    expect(style).toHaveAttribute('data-paimind-style-refs', '2')
    disposeFirst()
    expect(document.head.contains(style)).toBe(true)
    expect(style).toHaveAttribute('data-paimind-style-refs', '1')
    disposeSecond()
    expect(document.head.contains(style)).toBe(false)
  })

  it('uses market, built-in, and installed as the three primary views', async () => {
    const native = runtime()
    render(<SkillMarketSection close={() => {}} installer={installer() as never} sessions={native.sessions} locale={locale()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'View: openai-docs' })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Market' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Built-in' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Installed' })).toBeInTheDocument()
    expect(screen.queryByText(/runtime id|host path|not exposed|hash/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    expect(screen.getByText(/No personal Skills installed/)).toBeInTheDocument()
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
    const market = screen.getByRole('tab', { name: 'Market' })
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

  it.each(['default', 'member'] as const)('registers only original surfaces and the appropriate draft navigation for %s', async audience => {
    if (audience === 'member') vi.stubGlobal('__PAIMIND_CLIENT_AUDIENCE__', { schemaVersion: 1, audience })
    const native = runtime()
    const host = installer()
    host.getUserSkillPolicy.mockResolvedValue({ ok: true, value: {
      schema: 'paimind.user-skill-policy/v1', revision: 0, enabledOptionalSystemSkillNames: ['paimind-skill-authoring'],
      enabledBusinessSkillNames: [], directBusinessSkillNames: [],
    } })
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
    if (audience === 'member') { expect(host.getAuthoringDraft).not.toHaveBeenCalled(); expect(host.getUserSkillPolicy).not.toHaveBeenCalled() }
    else await waitFor(() => expect(host.getAuthoringDraft).toHaveBeenCalledOnce())
    await dispose()
  })
  it('rejects malformed presentation metadata before mounting any native API', async () => {
    vi.stubGlobal('__PAIMIND_CLIENT_AUDIENCE__', { schemaVersion: 2, audience: 'member' })
    const mount = vi.fn()
    await expect(apply({ remote: { $mount: mount } } as never)).rejects.toThrow('Invalid Skill Center presentation metadata')
    expect(mount).not.toHaveBeenCalled()
  })
})
