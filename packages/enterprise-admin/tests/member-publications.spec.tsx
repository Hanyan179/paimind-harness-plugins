import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseApi, EnterpriseSession, type AccountView } from '../src/client/api.js'
import { assignedPublications, createAgentCenterContribution, MemberPublicationCatalog, SubmitPersonalAgent } from '../src/client/member-publications.js'
import { AgentCenterContributionRegistry } from '../../agent-market/src/client/contributions.js'
import { createClientContextFixture } from './client-fixture.js'
import { apply } from '../src/client/index.js'
import { adoptedPublicationPreset } from '../src/client/publication-view.js'

const hansen: AccountView = { userId: 'a0000000-0000-4000-8000-000000000001', tenantId: 'component-only', username: 'hansen', displayName: 'Hansen', role: 'member', status: 'active' }
const alex = { ...hansen, userId: 'b0000000-0000-4000-8000-000000000002', username: 'alex', displayName: 'Alex' }
const publication = { publicationId: 'c0000000-0000-4000-8000-000000000003', sourceUserId: hansen.userId, presetId: 'hansen-client', configVersion: 'v2-fixture',
  digest: 'sha256:' + 'a'.repeat(64), name: 'Hansen 客户跟进助手', description: '跟进客户', status: 'pending', revision: 1, submissionReason: '供团队审核使用', reviewReason: null }
const selection = { presetId: publication.presetId, configVersion: publication.configVersion, name: publication.name }
const granted = { ...publication, status: 'published', access: 'user-allow' }
const adoption = { publicationId: publication.publicationId, presetId: 'paimind-enterprise-' + publication.publicationId.replaceAll('-', ''),
  configVersion: 'v3-adopted-fixture', digest: publication.digest, nativeCompositionDigest: 'sha256:' + 'c'.repeat(64), adopted: true, runtimeGrant: false }
const snapshot = (row = publication, access = 'review-copy') => ({ ...row, access, snapshot: { digest: row.digest,
  content: { schema: 'paimind.agent-publication/v1', agentId: row.presetId, presetId: row.presetId, configVersion: row.configVersion,
    profile: { name: row.name, description: row.description, basePresetId: 'standard', role: '客户助理', goal: '梳理跟进事项', behavior: '明确依据', instructions: '', preferredSkillNames: [] },
    dependencies: [], nativeCompositionDigest: 'sha256:' + 'b'.repeat(64) } } })
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 })
const failed = (status: number) => new Response(JSON.stringify({ title: '对象不可访问' }), { status })
const disposers: (() => void)[] = []
afterEach(() => { cleanup(); for (const off of disposers.splice(0).reverse()) off(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function fixture() {
  const state = { account: hansen, submitted: [publication] as unknown[], assigned: [] as unknown[], detail: snapshot() as unknown,
    read: undefined as undefined | ((path: string) => Promise<Response>) }
  const writes = vi.fn<(init: RequestInit) => Promise<Response>>(async init => ok({ ...publication, submissionReason: JSON.parse(String(init.body)).reason }))
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url).replace('/haas/v1', '')
    if (init?.method === 'POST') return writes(init!)
    if (path === '/auth/me') return ok(state.account)
    if (state.read) return state.read(path)
    if (path === '/catalog/agents') return ok(state.assigned)
    if (path === '/publications') return ok(state.submitted)
    if (path === '/publications/' + publication.publicationId) return ok(state.detail)
    if (path === '/catalog/agents/' + publication.publicationId) return state.assigned.length ? ok(state.detail) : failed(404)
    throw new Error('Unexpected fixture route: ' + path)
  })
  const session = new EnterpriseSession(new EnterpriseApi(transport)); disposers.push(() => session.dispose()); await session.refresh()
  return { state, writes, transport, session, contribution: createAgentCenterContribution(session) }
}
function fill() {
  fireEvent.change(screen.getByLabelText('提交原因'), { target: { value: '供团队审核使用' } })
  fireEvent.click(screen.getByRole('checkbox'))
}
async function details() { fireEvent.click(await screen.findByRole('button', { name: '查看企业版本 ' + publication.name })) }

describe('member Agent catalog and submission (component fixtures, NOT Browser E2E)', () => {
  it('does not treat authorship or administrator review copies as assignment', () => {
    expect(assignedPublications([])).toEqual([])
    expect(assignedPublications([granted])[0]?.access).toBe('user-allow')
    for (const row of [publication, { ...granted, access: 'review-copy' }, { ...granted, access: 'admin' }, { ...granted, status: 'withdrawn' }]) {
      expect(() => assignedPublications([row])).toThrow()
    }
  })
  it('loads only the opened catalog; own review history has no run or administration action', async () => {
    const f = await fixture(); const Panel = f.contribution.tabs[1]!.Panel
    render(<Panel query="" />); await details(); await screen.findByRole('region', { name: '企业智能体详情' })
    expect(screen.getByText(/这是你的提交审核副本/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /开始对话|批准|分配|编辑/ })).toBeNull()
    expect(f.transport.mock.calls.map(([url]) => String(url))).toEqual(['/haas/v1/auth/me', '/haas/v1/publications', '/haas/v1/publications/' + publication.publicationId])
    expect(f.writes).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '收起详情' }))
    expect(screen.queryByRole('region', { name: '企业智能体详情' })).toBeNull()
    expect(screen.getByRole('button', { name: '查看企业版本 ' + publication.name })).toHaveFocus()
  })
  it('uses a distinct granted catalog and distinguishes search miss from genuinely empty', async () => {
    const f = await fixture(); f.state.assigned = [granted]
    const Panel = f.contribution.tabs[0]!.Panel, view = render(<Panel query="Alex" />)
    await screen.findByText('没有匹配结果，请调整或清空搜索。')
    expect(screen.queryByText(publication.name)).toBeNull()
    view.rerender(<Panel query="Hansen" />); expect(screen.getByText(publication.name)).toBeInTheDocument()
    f.state.assigned = []; fireEvent.click(screen.getByRole('button', { name: '重新读取目录' }))
    view.rerender(<Panel query="" />); await screen.findByText('当前没有分配给你的企业智能体。')
    expect(f.transport.mock.calls.some(([url]) => String(url).includes('/admin/'))).toBe(false)
  })
  it('refuses a foreign owner in the submitted projection before rendering any name', async () => {
    const f = await fixture(); f.state.submitted = [{ ...publication, sourceUserId: alex.userId }]
    const Panel = f.contribution.tabs[1]!.Panel; render(<Panel query="" />)
    await screen.findByText('提交记录归属不一致，已停止显示'); expect(screen.queryByText(publication.name)).toBeNull()
  })
  it('uses the dedicated current-assignment detail without reading an author copy or a second catalog', async () => {
    const f = await fixture(); f.state.assigned = [granted]; f.state.detail = snapshot(granted, 'user-allow')
    const Panel = f.contribution.tabs[0]!.Panel; render(<Panel query="" />); await details()
    await screen.findByRole('region', { name: '企业智能体详情' })
    expect(f.transport.mock.calls.map(([url]) => String(url))).toEqual(['/haas/v1/auth/me', '/haas/v1/catalog/agents', '/haas/v1/catalog/agents/' + publication.publicationId])
    expect(screen.getByRole('button', { name: '开始对话' })).toBeDisabled()
    expect(screen.getByRole('heading', { name: publication.name + ' · 已发布' })).toHaveFocus()
  })
  it('cannot render a revoked assignment through the still-readable author copy', async () => {
    const f = await fixture(); f.state.assigned = [granted]; f.state.detail = snapshot(granted)
    const Panel = f.contribution.tabs[0]!.Panel; render(<Panel query="" />)
    await screen.findByText(publication.name); f.state.assigned = []; await details()
    await screen.findByText('对象不可访问')
    expect(screen.queryByRole('region', { name: '企业智能体详情' })).toBeNull()
    expect(screen.queryByText('角色：客户助理')).toBeNull()
    expect(f.transport.mock.calls.some(([url]) => String(url).includes('/publications/'))).toBe(false)
  })
  it('rejects a review-copy returned from the assigned endpoint without falling back', async () => {
    const f = await fixture(); f.state.assigned = [granted]; f.state.detail = snapshot(granted, 'review-copy')
    const Panel = f.contribution.tabs[0]!.Panel; render(<Panel query="" />); await details()
    await screen.findByText('企业发布响应不完整或不一致，请重新读取')
    expect(screen.queryByText('角色：客户助理')).toBeNull()
    expect(f.transport.mock.calls).toHaveLength(3)
    expect(f.transport.mock.calls.some(([url]) => String(url).includes('/publications/'))).toBe(false)
  })
  it('aborts and discards a late assigned detail after identity invalidation', async () => {
    const f = await fixture(); f.state.assigned = [granted]
    const Panel = f.contribution.tabs[0]!.Panel; render(<Panel query="" />); await screen.findByText(publication.name)
    let complete!: (response: Response) => void
    f.state.read = () => new Promise(done => { complete = done })
    await details(); await waitFor(() => expect(complete).toBeTypeOf('function'))
    const signal = f.transport.mock.calls.at(-1)![1]!.signal!
    act(() => f.session.invalidate()); expect(signal.aborted).toBe(true)
    await act(async () => complete(ok(snapshot(granted, 'user-allow'))))
    expect(screen.queryByRole('region', { name: '企业智能体详情' })).toBeNull()
    expect(screen.queryByText('角色：客户助理')).toBeNull()
    expect(screen.getByText(/登录已失效/)).toBeInTheDocument()
  })
  it('clears a selected detail on focus refresh and preserves backend errors as errors, not emptiness', async () => {
    const f = await fixture(); f.state.assigned = [granted]; f.state.detail = snapshot(granted, 'user-allow')
    const Panel = f.contribution.tabs[0]!.Panel; render(<Panel query="" />); await details(); await screen.findByText('角色：客户助理')
    f.state.read = async () => failed(503); fireEvent.focus(window)
    await screen.findByRole('alert'); expect(screen.queryByText('角色：客户助理')).toBeNull()
    expect(screen.queryByText('当前没有分配给你的企业智能体。')).toBeNull()
  })
  it('refuses a mismatched revision or a known-ID rejection without opening content', async () => {
    const f = await fixture(); f.state.detail = snapshot({ ...publication, revision: 2 })
    const Panel = f.contribution.tabs[1]!.Panel; render(<Panel query="" />); await details()
    await screen.findByText('发布版本或归属已变化，请重新读取目录'); expect(screen.queryByText('角色：客户助理')).toBeNull()
    f.state.read = async path => path === '/publications' ? ok([publication]) : failed(404)
    fireEvent.click(screen.getByRole('button', { name: '重新读取目录' })); await details(); await screen.findByText('对象不可访问')
  })
  it('discards a late catalog response after identity invalidation and makes no follow-up admin call', async () => {
    const f = await fixture(); let complete!: (response: Response) => void
    f.state.read = () => new Promise(done => { complete = done })
    const Panel = f.contribution.tabs[1]!.Panel; render(<Panel query="" />)
    await waitFor(() => expect(complete).toBeTypeOf('function'))
    const signal = f.transport.mock.calls.at(-1)![1]!.signal!
    act(() => f.session.invalidate()); expect(signal.aborted).toBe(true)
    await act(async () => complete(ok([publication])))
    expect(screen.queryByText(publication.name)).toBeNull(); expect(screen.getByText(/登录已失效/)).toBeInTheDocument()
  })
  it('remounts the owned catalog on user replacement with no old names or details', async () => {
    const f = await fixture(); const Panel = f.contribution.tabs[1]!.Panel; render(<Panel query="" />); await details(); await screen.findByText('角色：客户助理')
    f.state.account = alex; f.state.submitted = []
    await act(async () => f.session.refresh()); await screen.findByText(/还没有提交记录/)
    expect(screen.queryByText(publication.name)).toBeNull(); expect(screen.queryByText('角色：客户助理')).toBeNull()
    expect(screen.getByText(/Alex 的提交历史/)).toBeInTheDocument()
  })
  it('distinguishes identity unavailability from loading and can explicitly retry without keeping old content', async () => {
    const f = await fixture(), Panel = f.contribution.tabs[1]!.Panel; render(<Panel query="" />); await screen.findByText(publication.name)
    f.transport.mockImplementationOnce(async () => failed(503)); await act(async () => f.session.refresh())
    expect(screen.getByRole('alert')).toHaveTextContent('企业服务暂时不可用'); expect(screen.queryByText(publication.name)).toBeNull()
    f.state.submitted = []; fireEvent.click(screen.getByRole('button', { name: '重新验证账户' })); await screen.findByText(/还没有提交记录/)
  })
  it('sends exactly the selected saved version, guards duplicate submission and never sends account or native data', async () => {
    const f = await fixture(), onEditing = vi.fn(); let complete!: (response: Response) => void
    f.writes.mockImplementation(() => new Promise(done => { complete = done }))
    const Action = f.contribution.PersonalAction
    const view = render(<Action selection={selection} disabled={false} onEditing={onEditing} />)
    expect(f.transport).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '提交审核' })); expect(screen.getByLabelText('提交原因')).toHaveFocus(); fill()
    view.rerender(<Action selection={{ ...selection, configVersion: 'v2-newer', name: 'Changed later' }} disabled={true} onEditing={onEditing} />)
    const form = screen.getByRole('form'); fireEvent.submit(form); fireEvent.submit(form)
    expect(f.writes).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: '正在提交…' })).toBeDisabled()
    expect(JSON.parse(String(f.writes.mock.calls[0]![0].body))).toEqual({ presetId: selection.presetId, expectedVersion: selection.configVersion, reason: '供团队审核使用' })
    await act(async () => complete(ok(publication))); await screen.findByText(/等待管理员审核。个人智能体和会话保持不变/)
    expect(onEditing).toHaveBeenLastCalledWith(false); expect(screen.queryByRole('form')).toBeNull()
  })
  it('preserves uncertain-result keys and changes the key only after an explicit body change', async () => {
    const f = await fixture(); f.writes.mockRejectedValue(new Error('响应未知'))
    render(<SubmitPersonalAgent api={f.session.api} account={hansen} selection={selection} disabled={false} onEditing={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '提交审核' })); fill()
    fireEvent.submit(screen.getByRole('form')); await screen.findByText('响应未知')
    fireEvent.submit(screen.getByRole('form')); await waitFor(() => expect(f.writes).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: '确认提交审核' })).toBeEnabled())
    const key = (index: number) => (f.writes.mock.calls[index]![0].headers as Record<string, string>)['Idempotency-Key']
    expect(key(0)).toBe(key(1)); expect(screen.getByLabelText('提交原因')).toHaveValue('供团队审核使用')
    fireEvent.change(screen.getByLabelText('提交原因'), { target: { value: '更新明确的提交原因' } }); fireEvent.submit(screen.getByRole('form'))
    await waitFor(() => expect(f.writes).toHaveBeenCalledTimes(3)); expect(key(2)).not.toBe(key(1))
  })
  it('rejects a success-shaped receipt for a different owner and retains the draft', async () => {
    const f = await fixture(); f.writes.mockResolvedValue(ok({ ...publication, sourceUserId: alex.userId }))
    render(<SubmitPersonalAgent api={f.session.api} account={hansen} selection={selection} disabled={false} onEditing={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '提交审核' })); fill(); fireEvent.submit(screen.getByRole('form'))
    await screen.findByText(/提交回执与所选来源不一致/); expect(screen.getByLabelText('提交原因')).toHaveValue('供团队审核使用')
    expect(screen.queryByText(/已提交 Hansen/)).toBeNull()
  })
  it('protects cancel, Escape, close and reload without ever submitting a draft', async () => {
    const f = await fixture(), off = vi.fn(), onEditing = vi.fn(); let guard!: () => boolean
    const register = (next: () => boolean) => { guard = next; return off }
    render(<SubmitPersonalAgent api={f.session.api} account={hansen} selection={selection} disabled={false} onEditing={onEditing} registerCloseGuard={register} />)
    fireEvent.click(screen.getByRole('button', { name: '提交审核' })); fill()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: '取消提交' })); expect(screen.getByRole('form')).toBeInTheDocument()
    expect(guard()).toBe(false)
    const reload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(reload); expect(reload.defaultPrevented).toBe(true)
    const bubbled = vi.fn(); document.addEventListener('keydown', bubbled); disposers.push(() => document.removeEventListener('keydown', bubbled))
    confirm.mockReturnValue(true); fireEvent.keyDown(screen.getByLabelText('提交原因'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull()); expect(bubbled).not.toHaveBeenCalled()
    expect(off).toHaveBeenCalledTimes(1); expect(onEditing).toHaveBeenLastCalledWith(false)
    await waitFor(() => expect(screen.getByRole('button', { name: '提交审核' })).toHaveFocus()); expect(f.writes).not.toHaveBeenCalled()
  })
  it('aborts an in-flight submission and ignores success after identity loss', async () => {
    const f = await fixture(); let complete!: (response: Response) => void
    f.writes.mockImplementation(() => new Promise(done => { complete = done }))
    const Action = f.contribution.PersonalAction; render(<Action selection={selection} disabled={false} onEditing={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '提交审核' })); fill(); fireEvent.submit(screen.getByRole('form'))
    const signal = f.writes.mock.calls[0]![0].signal!; act(() => f.session.invalidate()); expect(signal.aborted).toBe(true)
    await act(async () => complete(ok(publication))); expect(screen.queryByRole('form')).toBeNull(); expect(screen.queryByText(/已提交 Hansen/)).toBeNull()
  })
  it('binds and disposes a late native owner independently of Settings without prefetching catalogs', async () => {
    const f = await fixture(); vi.stubGlobal('fetch', f.transport)
    const host = createClientContextFixture(); disposers.push(() => host.disposeEffects()); apply(host.context)
    await waitFor(() => expect(host.slots.some(row => row.options.id === 'paimind-enterprise-account')).toBe(true))
    const registry = new AgentCenterContributionRegistry(); host.setOwner(registry)
    expect(registry.getSnapshot().contribution?.id).toBe('enterprise')
    expect(f.transport.mock.calls.every(([url]) => String(url).endsWith('/auth/me'))).toBe(true)
    host.setOwner(); expect(registry.getSnapshot().contribution).toBeNull()
    host.setOwner(registry); expect(registry.getSnapshot().contribution).not.toBeNull()
    host.disposeEffects(); expect(registry.getSnapshot().contribution).toBeNull()
    host.setOwner(registry); expect(registry.getSnapshot().contribution).toBeNull()
  })
})

describe('explicit assigned Agent adoption and native entry (component fixtures, NOT Browser E2E)', () => {
  async function assigned() {
    const f = await fixture(); f.state.assigned = [granted]; f.state.detail = snapshot(granted, 'user-allow')
    f.writes.mockImplementation(async () => ok(adoption))
    const prepareConversation = vi.fn(async (_preset: string, _signal: AbortSignal) => 'native-session-fixture')
    const returnToConversation = vi.fn(), onEditing = vi.fn(), off = vi.fn()
    let guard = () => true
    const registerCloseGuard = (value: () => boolean) => { guard = value; return off }
    const Panel = f.contribution.tabs[0]!.Panel
    const view = render(<Panel query="" {...{ prepareConversation, returnToConversation, onEditing, registerCloseGuard }} />)
    await details(); await screen.findByRole('region', { name: '使用企业智能体' })
    return { ...f, view, prepareConversation, returnToConversation, onEditing, off, guard: () => guard() }
  }
  async function adopt() {
    fireEvent.click(screen.getByRole('button', { name: '采用企业版本' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.submit(screen.getByRole('form'))
    await waitFor(() => expect(screen.getByRole('button', { name: '开始对话' })).toBeEnabled())
  }
  const key = (f: Awaited<ReturnType<typeof assigned>>, index: number) =>
    (f.writes.mock.calls[index]![0].headers as Record<string, string>)['Idempotency-Key']
  it('separates adoption from starting; rechecks current assignment and replays exact native evidence before preparing', async () => {
    const f = await assigned()
    expect(f.writes).not.toHaveBeenCalled(); expect(f.prepareConversation).not.toHaveBeenCalled()
    await adopt(); expect(screen.getByRole('button', { name: '开始对话' })).toHaveFocus()
    expect(f.prepareConversation).not.toHaveBeenCalled(); expect(f.returnToConversation).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '开始对话' }))
    await waitFor(() => expect(f.returnToConversation).toHaveBeenCalledOnce())
    expect(f.writes).toHaveBeenCalledTimes(2); expect(key(f, 0)).toBe(key(f, 1))
    expect(f.writes.mock.calls.every(([init]) => JSON.stringify(JSON.parse(String(init.body))) === JSON.stringify({
      expectedRevision: 1, expectedDigest: publication.digest }))).toBe(true)
    expect(f.prepareConversation).toHaveBeenCalledWith(adoption.presetId, expect.any(AbortSignal))
    expect(f.onEditing).toHaveBeenLastCalledWith(false); expect(f.guard()).toBe(true)
    expect(f.transport.mock.calls.map(([url]) => String(url))).toEqual(['/haas/v1/auth/me', '/haas/v1/catalog/agents',
      ...[0, 1, 2].flatMap(index => index === 0 ? ['/haas/v1/catalog/agents/' + publication.publicationId]
        : ['/haas/v1/catalog/agents/' + publication.publicationId, '/haas/v1/publications/' + publication.publicationId + '/adopt'])])
  })
  it('supports Escape and focus restoration without adopting, and locks navigation and reload during a command', async () => {
    const f = await assigned()
    fireEvent.click(screen.getByRole('button', { name: '采用企业版本' }))
    expect(screen.getByRole('checkbox')).toHaveFocus(); expect(screen.getByRole('button', { name: '重新读取目录' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('checkbox'), { key: 'Escape' })
    await waitFor(() => expect(screen.getByRole('button', { name: '采用企业版本' })).toHaveFocus())
    expect(f.writes).not.toHaveBeenCalled()
    let complete!: (response: Response) => void
    f.writes.mockImplementation(() => new Promise(done => { complete = done }))
    fireEvent.click(screen.getByRole('button', { name: '采用企业版本' })); fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.submit(screen.getByRole('form')); fireEvent.submit(screen.getByRole('form'))
    await waitFor(() => expect(f.writes).toHaveBeenCalledOnce()); expect(f.guard()).toBe(false)
    expect(screen.getByRole('button', { name: '收起详情' })).toBeDisabled()
    const reload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(reload); expect(reload.defaultPrevented).toBe(true)
    fireEvent.keyDown(screen.getByRole('form'), { key: 'Escape' }); expect(screen.getByRole('form')).toBeInTheDocument()
    const count = f.transport.mock.calls.length; fireEvent.focus(window); expect(f.transport).toHaveBeenCalledTimes(count)
    await act(async () => complete(ok(adoption)))
    await waitFor(() => expect(screen.queryByRole('region', { name: '使用企业智能体' })).toBeNull())
    expect(f.prepareConversation).not.toHaveBeenCalled(); expect(f.guard()).toBe(true)
  })
  it('retains the exact command key after an uncertain result and does not prepare or pretend rollback', async () => {
    const f = await assigned(); f.writes.mockRejectedValueOnce(new Error('响应未知'))
    fireEvent.click(screen.getByRole('button', { name: '采用企业版本' })); fireEvent.click(screen.getByRole('checkbox')); fireEvent.submit(screen.getByRole('form'))
    expect(await screen.findByRole('alert')).toHaveTextContent('响应未知'); expect(screen.getByRole('alert')).toHaveFocus()
    expect(screen.getByRole('checkbox')).toBeChecked(); expect(f.prepareConversation).not.toHaveBeenCalled()
    fireEvent.submit(screen.getByRole('form')); await waitFor(() => expect(screen.getByRole('button', { name: '开始对话' })).toBeEnabled())
    expect(key(f, 1)).toBe(key(f, 0)); expect(screen.queryByRole('alert')).toBeNull()
  })
  it('rejects revoked assignment before native preparation even after successful adoption', async () => {
    const f = await assigned(); await adopt(); f.state.assigned = []
    fireEvent.click(screen.getByRole('button', { name: '开始对话' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('对象不可访问')
    expect(f.writes).toHaveBeenCalledOnce(); expect(f.prepareConversation).not.toHaveBeenCalled(); expect(f.returnToConversation).not.toHaveBeenCalled()
  })
  it('rejects changed versions before starting without reading a review copy', async () => {
    const f = await assigned(); await adopt(); f.state.detail = snapshot({ ...granted, revision: 2 }, 'user-allow')
    fireEvent.click(screen.getByRole('button', { name: '开始对话' })); expect(await screen.findByRole('alert')).toHaveTextContent('发布版本或归属已变化')
    expect(f.writes).toHaveBeenCalledOnce(); expect(f.prepareConversation).not.toHaveBeenCalled()
  })
  it('retains adoption after a native preparation error and verifies the same command before retrying', async () => {
    const f = await assigned(); await adopt(); f.prepareConversation.mockRejectedValueOnce(new Error('宿主连接断开'))
    fireEvent.click(screen.getByRole('button', { name: '开始对话' })); expect(await screen.findByRole('alert')).toHaveTextContent('宿主连接断开')
    expect(f.returnToConversation).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: '采用企业版本' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '开始对话' })); await waitFor(() => expect(f.returnToConversation).toHaveBeenCalledOnce())
    expect(f.writes).toHaveBeenCalledTimes(3); expect(new Set([key(f, 0), key(f, 1), key(f, 2)]).size).toBe(1)
  })
  it('aborts a native preparation after identity loss and cannot navigate on a late response', async () => {
    const f = await assigned(); await adopt(); let complete!: (sessionId: string) => void
    f.prepareConversation.mockImplementation(() => new Promise(done => { complete = done }))
    fireEvent.click(screen.getByRole('button', { name: '开始对话' })); await waitFor(() => expect(complete).toBeTypeOf('function'))
    const signal = f.prepareConversation.mock.calls[0]![1]; expect(f.guard()).toBe(false)
    act(() => f.session.invalidate()); expect(signal.aborted).toBe(true)
    await act(async () => complete('late-session')); expect(f.returnToConversation).not.toHaveBeenCalled()
    expect(screen.queryByText(/已确认采用记录/)).toBeNull(); expect(screen.getByText(/登录已失效/)).toBeInTheDocument()
  })
  it('discards an adoption response after switching from Hansen to Alex', async () => {
    const f = await assigned(); let complete!: (response: Response) => void
    f.writes.mockImplementation(() => new Promise(done => { complete = done }))
    fireEvent.click(screen.getByRole('button', { name: '采用企业版本' })); fireEvent.click(screen.getByRole('checkbox')); fireEvent.submit(screen.getByRole('form'))
    await waitFor(() => expect(f.writes).toHaveBeenCalledOnce()); const signal = f.writes.mock.calls[0]![0].signal!
    f.state.account = alex; f.state.assigned = []; await act(async () => f.session.refresh())
    expect(signal.aborted).toBe(true); await act(async () => complete(ok(adoption)))
    expect(screen.queryByText(/已确认采用记录/)).toBeNull(); expect(f.prepareConversation).not.toHaveBeenCalled()
  })
  it.each([{ runtimeGrant: true }, { adopted: false }, { presetId: 'hansen-personal' }, { publicationId: alex.userId },
    { digest: 'sha256:' + 'd'.repeat(64) }, { nativeCompositionDigest: 'unknown' }, { configVersion: '' }, { extra: true }])('rejects success-shaped mismatched command evidence: %j', patch => {
    expect(() => adoptedPublicationPreset({ ...adoption, ...patch }, publication as never)).toThrow()
  })
  it('allows only POST to the exact adoption route and requires a stable key', async () => {
    const transport = vi.fn<typeof fetch>(async () => ok(adoption)), api = new EnterpriseApi(transport)
    disposers.push(() => api.dispose())
    const path = '/publications/' + publication.publicationId + '/adopt'
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) await expect(api.request(path, method, {}, 'key')).rejects.toThrow('Unsupported')
    for (const suffix of ['/extra', '?user=alex', '/..']) await expect(api.request(path + suffix, 'POST', {}, 'key')).rejects.toThrow('Unsupported')
    await expect(api.request(path, 'POST', {})).rejects.toThrow('stable command key'); expect(transport).not.toHaveBeenCalled()
    await api.request(path, 'POST', {}, 'key'); expect(transport).toHaveBeenCalledOnce()
  })
})
