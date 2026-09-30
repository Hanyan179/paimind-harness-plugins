import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseApi, EnterpriseSession, type AccountView } from '../src/client/api.js'
import { adoptedSkillReference, assignedSkill, assignedSkills, createSkillCenterContribution } from '../src/client/member-skills.js'
import { SkillCenterContributionRegistry } from '../../skill-market/src/client/contributions.js'
import { AgentCenterContributionRegistry } from '../../agent-market/src/client/contributions.js'
import { createClientContextFixture } from './client-fixture.js'
import { apply } from '../src/client/index.js'

const hansen: AccountView = { userId: 'a0000000-0000-4000-8000-000000000001', tenantId: 'component-fixture', username: 'hansen', displayName: 'Hansen', role: 'member', status: 'active' }
const alex = { ...hansen, userId: 'b0000000-0000-4000-8000-000000000002', username: 'alex', displayName: 'Alex' }
const row = { publicationId: 'c0000000-0000-4000-8000-000000000003', artifactId: 'd0000000-0000-4000-8000-000000000004',
  sourceUserId: 'e0000000-0000-4000-8000-000000000005', name: 'customer-notes', digest: 'sha256:' + 'a'.repeat(64), status: 'published', revision: 2,
  submissionReason: '供团队使用', reviewReason: '已审核通过', archiveDigest: 'sha256:' + 'b'.repeat(64), archiveBytes: 2048, expandedBytes: 1024,
  entryCount: 4, runtimeGrant: false, access: 'user-allow' }
const adoption = { schema: 'paimind.skill-adoption/v1', adoptedAt: 1, tenantId: hansen.tenantId, publicationId: row.publicationId,
  sourceUserId: row.sourceUserId, name: row.name, packageDigest: row.digest, archiveDigest: row.archiveDigest, archiveBytes: row.archiveBytes,
  expandedBytes: row.expandedBytes, entryCount: row.entryCount, runtimeGrant: false }
const response = (data: unknown) => new Response(JSON.stringify({ data }))
const error = (status: number) => new Response(JSON.stringify({ title: '技能对象不可访问' }), { status })
const disposers: (() => void)[] = []
afterEach(() => { cleanup(); for (const off of disposers.splice(0).reverse()) off(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function fixture() {
  const state = { account: hansen, rows: [row] as unknown[], detail: row as unknown, read: undefined as undefined | ((path: string) => Promise<Response>) }
  const writes = vi.fn(async (_init: RequestInit) => response(adoption))
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url).replace('/haas/v1', '')
    if (init?.method === 'POST') return writes(init)
    if (path === '/auth/me') return response(state.account)
    if (state.read) return state.read(path)
    if (path === '/catalog/skills') return response(state.rows)
    if (path === '/catalog/skills/' + row.publicationId) return state.rows.length ? response(state.detail) : error(404)
    throw new Error('Unexpected route in fixture: ' + path)
  })
  const session = new EnterpriseSession(new EnterpriseApi(transport)); disposers.push(() => session.dispose()); await session.refresh()
  const showAdoptedSkill = vi.fn(async (_selection: unknown, _signal: AbortSignal) => {}), onEditing = vi.fn(), off = vi.fn()
  let guard = () => true
  const registerCloseGuard = (next: () => boolean) => { guard = next; return off }
  const contribution = createSkillCenterContribution(session), Panel = contribution.Panel
  return { state, writes, transport, session, contribution, Panel, showAdoptedSkill, onEditing, off, guard: () => guard(),
    render: () => render(<Panel {...{ showAdoptedSkill, onEditing, registerCloseGuard }} />) }
}
async function details() {
  fireEvent.click(await screen.findByRole('button', { name: '查看企业技能 ' + row.name }))
  await screen.findByRole('form', { name: '采用企业技能 ' + row.name })
}
function adopt() { fireEvent.click(screen.getByRole('checkbox')); fireEvent.submit(screen.getByRole('form')) }

describe('member Skill catalog and adoption (component fixtures, NOT Browser E2E)', () => {
  it('loads only current assigned metadata on demand and distinguishes search misses from an empty catalog', async () => {
    const f = await fixture(); expect(f.transport).toHaveBeenCalledOnce(); f.render(); await screen.findByText(row.name)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Alex' } }); expect(screen.getByText('没有匹配结果，请调整搜索。')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } }); f.state.rows = []
    fireEvent.click(screen.getByRole('button', { name: '重新读取技能目录' })); await screen.findByText('当前没有分配给你的企业技能。')
    expect(f.writes).not.toHaveBeenCalled(); expect(f.transport.mock.calls.every(([url]) => !String(url).includes('/admin/'))).toBe(true)
  })
  it('requires explicit confirmation, rechecks current metadata and passes only exact adopted bytes to the native owner', async () => {
    const f = await fixture(); f.render(); await details()
    expect(screen.getByRole('heading', { name: row.name + ' · 固定企业版本' })).toHaveFocus()
    expect(screen.getByRole('button', { name: '确认采用并查看已安装技能' })).toBeDisabled(); expect(f.writes).not.toHaveBeenCalled()
    adopt(); await waitFor(() => expect(f.showAdoptedSkill).toHaveBeenCalledOnce())
    expect(f.showAdoptedSkill).toHaveBeenCalledWith({ publicationId: row.publicationId, name: row.name,
      packageDigest: row.digest, archiveDigest: row.archiveDigest }, expect.any(AbortSignal))
    expect(JSON.parse(String(f.writes.mock.calls[0]![0].body))).toEqual({ expectedRevision: row.revision, expectedDigest: row.digest })
    expect(f.transport.mock.calls.map(([url]) => String(url))).toEqual(['/haas/v1/auth/me', '/haas/v1/catalog/skills',
      '/haas/v1/catalog/skills/' + row.publicationId, '/haas/v1/catalog/skills/' + row.publicationId, '/haas/v1/catalog/skills/' + row.publicationId + '/adoption'])
    await screen.findByText('原生技能版本已回读；尚未自动启用或加入任何会话。'); expect(f.onEditing).toHaveBeenLastCalledWith(false)
  })
  it('cancels confirmation with Escape, restores focus and never adopts the package', async () => {
    const f = await fixture(); f.render(); await details()
    expect(screen.getByRole('searchbox')).toBeDisabled(); expect(screen.getByRole('button', { name: '重新读取技能目录' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('checkbox'), { key: 'Escape' })
    await waitFor(() => expect(screen.getByRole('button', { name: '查看企业技能 ' + row.name })).toHaveFocus())
    expect(screen.queryByRole('form')).toBeNull(); expect(f.writes).not.toHaveBeenCalled()
  })
  it('serializes repeated submission, guards close/reload and defers focus refresh while adopting', async () => {
    const f = await fixture(); let complete!: (value: Response) => void
    f.writes.mockImplementation(() => new Promise(done => { complete = done })); f.render(); await details(); adopt(); fireEvent.submit(screen.getByRole('form'))
    await waitFor(() => expect(f.writes).toHaveBeenCalledOnce()); expect(f.guard()).toBe(false)
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true)
    fireEvent.keyDown(screen.getByRole('form'), { key: 'Escape' }); expect(screen.getByRole('form')).toBeInTheDocument()
    const count = f.transport.mock.calls.length; fireEvent.focus(window); expect(f.transport).toHaveBeenCalledTimes(count)
    await act(async () => complete(response(adoption))); await waitFor(() => expect(f.showAdoptedSkill).toHaveBeenCalledOnce())
    await waitFor(() => expect(f.transport.mock.calls.length).toBeGreaterThan(count))
  })
  it('keeps an uncertain command key across retries and native-readback failure without pretending rollback', async () => {
    const f = await fixture(); f.writes.mockRejectedValueOnce(new Error('响应未知')); f.render(); await details(); adopt()
    expect(await screen.findByRole('alert')).toHaveTextContent('响应未知'); expect(screen.getByRole('alert')).toHaveFocus()
    f.showAdoptedSkill.mockRejectedValueOnce(new Error('目录回读失败'))
    fireEvent.submit(screen.getByRole('form')); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('目录回读失败'))
    expect(screen.queryByText(/原生技能版本已回读/)).toBeNull(); fireEvent.submit(screen.getByRole('form'))
    await screen.findByText('原生技能版本已回读；尚未自动启用或加入任何会话。')
    expect(f.writes).toHaveBeenCalledTimes(3)
    expect(new Set(f.writes.mock.calls.map(([init]) => (init.headers as Record<string, string>)['Idempotency-Key'])).size).toBe(1)
  })
  it('refuses current revocation before any native write or owner navigation', async () => {
    const f = await fixture(); f.render(); await details(); f.state.rows = []; adopt()
    expect(await screen.findByRole('alert')).toHaveTextContent('技能对象不可访问')
    expect(screen.queryByText(row.name)).toBeNull(); expect(screen.queryByRole('form')).toBeNull()
    expect(f.writes).not.toHaveBeenCalled(); expect(f.showAdoptedSkill).not.toHaveBeenCalled()
  })
  it('lets the user stop a long transfer without deleting possible native writes or losing its retry key', async () => {
    const f = await fixture()
    f.writes.mockImplementationOnce(init => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    }))
    f.render(); await details(); adopt(); await waitFor(() => expect(f.writes).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: '停止等待' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('实际采用结果可能尚未确认')
    expect(f.writes.mock.calls[0]![0].signal!.aborted).toBe(true); expect(f.showAdoptedSkill).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox')).toBeChecked(); fireEvent.submit(screen.getByRole('form'))
    await screen.findByText('原生技能版本已回读；尚未自动启用或加入任何会话。')
    expect(new Set(f.writes.mock.calls.map(([init]) => (init.headers as Record<string, string>)['Idempotency-Key'])).size).toBe(1)
  })
  it('rejects a mismatched detail instead of substituting an administrator review copy', async () => {
    const f = await fixture(); f.state.detail = { ...row, access: 'review-copy' }; f.render()
    fireEvent.click(await screen.findByRole('button', { name: '查看企业技能 ' + row.name }))
    await screen.findByRole('alert'); expect(screen.queryByRole('form')).toBeNull(); expect(f.writes).not.toHaveBeenCalled()
    expect(f.transport.mock.calls.some(([url]) => String(url).includes('/admin/'))).toBe(false)
  })
  it('clears Hansen content and aborts a late adoption receipt when Alex replaces the current account', async () => {
    const f = await fixture(); let complete!: (value: Response) => void
    f.writes.mockImplementation(() => new Promise(done => { complete = done })); f.render(); await details(); adopt()
    await waitFor(() => expect(f.writes).toHaveBeenCalledOnce()); const signal = f.writes.mock.calls[0]![0].signal!
    f.state.account = alex; f.state.rows = []; await act(async () => f.session.refresh()); expect(signal.aborted).toBe(true)
    await act(async () => complete(response(adoption))); expect(f.showAdoptedSkill).not.toHaveBeenCalled()
    await screen.findByText('当前没有分配给你的企业技能。'); expect(screen.queryByText(row.name)).toBeNull()
  })
  it('cancels an in-flight native owner readback on logout without reporting success', async () => {
    const f = await fixture(); let complete!: () => void
    f.showAdoptedSkill.mockImplementation(() => new Promise(done => { complete = done })); f.render(); await details(); adopt()
    await waitFor(() => expect(f.showAdoptedSkill).toHaveBeenCalledOnce()); const signal = f.showAdoptedSkill.mock.calls[0]![1]
    act(() => f.session.invalidate()); expect(signal.aborted).toBe(true); await act(async () => complete())
    expect(screen.queryByText(/原生技能版本已回读/)).toBeNull(); expect(screen.getByText(/登录已失效/)).toBeInTheDocument()
  })
  it.each([{ runtimeGrant: true }, { tenantId: 'foreign' }, { sourceUserId: alex.userId }, { publicationId: alex.userId },
    { packageDigest: row.archiveDigest }, { archiveDigest: row.digest }, { name: 'other-skill' }, { archiveBytes: 9 }, { expandedBytes: 8 },
    { entryCount: 7 }, { adoptedAt: -1 }, { extra: true }])('rejects a mismatched adoption receipt: %j', patch => {
    expect(() => adoptedSkillReference({ ...adoption, ...patch }, assignedSkill(row), hansen)).toThrow()
  })
  it('rejects duplicate, oversized or unassigned catalog projections', () => {
    expect(() => assignedSkills([row, row])).toThrow(); expect(() => assignedSkills(Array(1001).fill(row))).toThrow()
    for (const patch of [{ status: 'withdrawn' }, { access: 'admin' }, { runtimeGrant: true }, { name: '../unsafe' }, { archiveBytes: 216 * 1024 ** 2 + 1 }]) {
      expect(() => assignedSkill({ ...row, ...patch })).toThrow()
    }
  })
  it('bounds only the explicit Skill adoption route to five minutes and rejects unintended methods and routes', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout'), transport = vi.fn<typeof fetch>(async () => response(adoption)), api = new EnterpriseApi(transport)
    disposers.push(() => api.dispose())
    const base = '/catalog/skills/' + row.publicationId
    for (const [path, method] of [[base, 'POST'], [base + '/adoption', 'GET'], ['/catalog/skills/adoption', 'POST'], [base + '/adoption/extra', 'POST']]) {
      await expect(api.request(path!, method!, {}, 'key')).rejects.toThrow('Unsupported')
    }
    await expect(api.request(base + '/adoption', 'POST', {})).rejects.toThrow('stable command key')
    expect(transport).not.toHaveBeenCalled()
    await api.request(base + '/adoption', 'POST', {}, 'key'); expect(timeout).toHaveBeenLastCalledWith(300_000)
    await api.request(base); expect(timeout).toHaveBeenLastCalledWith(15_000)
  })
  it('mounts each optional native center independently and clears only its own contribution on unload', async () => {
    const f = await fixture(); vi.stubGlobal('fetch', f.transport)
    const host = createClientContextFixture(); disposers.push(() => host.disposeEffects()); apply(host.context)
    await waitFor(() => expect(host.slots.some(row => row.options.id === 'paimind-enterprise-account')).toBe(true))
    const agents = new AgentCenterContributionRegistry(), skills = new SkillCenterContributionRegistry()
    host.setOwner(agents); host.setSkillOwner(skills)
    expect(agents.getSnapshot().contribution?.id).toBe('enterprise'); expect(skills.getSnapshot().contribution?.id).toBe('enterprise')
    host.setSkillOwner(); expect(skills.getSnapshot().contribution).toBeNull(); expect(agents.getSnapshot().contribution).not.toBeNull()
    host.setSkillOwner(skills); host.setOwner(); expect(skills.getSnapshot().contribution).not.toBeNull()
    host.disposeEffects(); expect(skills.getSnapshot().contribution).toBeNull(); host.setSkillOwner(skills); expect(skills.getSnapshot().contribution).toBeNull()
    expect(f.transport.mock.calls.every(([url]) => String(url).endsWith('/auth/me'))).toBe(true)
  })
})
