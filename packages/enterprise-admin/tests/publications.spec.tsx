import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminSection } from '../src/client/index.js'
import { EnterpriseApi, EnterpriseSession, type AccountView } from '../src/client/api.js'
import { publicationAssignments, publicationDetail, publicationView, publicationViews,
  type AssignmentView, type PublicationView } from '../src/client/publication-view.js'

const admin: AccountView = { userId: 'a0000000-0000-4000-8000-000000000001', tenantId: 'component-tenant', username: 'morgan', displayName: 'Morgan', role: 'admin', status: 'active' }
const hansen: AccountView = { ...admin, userId: 'b0000000-0000-4000-8000-000000000002', username: 'hansen', displayName: 'Hansen', role: 'member' }
const alex: AccountView = { ...hansen, userId: 'c0000000-0000-4000-8000-000000000003', username: 'alex', displayName: 'Alex' }
const group = { groupId: 'd0000000-0000-4000-8000-000000000004', name: '客户服务团队', revision: 1, status: 'active', memberIds: [hansen.userId] }
const base: PublicationView = { publicationId: 'e0000000-0000-4000-8000-000000000005', sourceUserId: hansen.userId,
  presetId: 'hansen-client', configVersion: 'v2-fixture', digest: 'sha256:' + 'a'.repeat(64), name: 'Hansen 客户跟进助手', description: '跟进客户',
  status: 'pending', revision: 1, submissionReason: '提交企业共享审核', reviewReason: null }
const detail = (view: PublicationView) => ({ ...view, access: 'review-copy', snapshot: { digest: view.digest,
  content: { schema: 'paimind.agent-publication/v1', agentId: view.presetId, presetId: view.presetId, configVersion: view.configVersion,
    profile: { name: view.name, description: view.description, basePresetId: 'standard', role: '客户助理', goal: '梳理跟进事项',
      behavior: '明确依据', instructions: '', preferredSkillNames: [] }, dependencies: [], nativeCompositionDigest: 'sha256:' + 'b'.repeat(64) } } })
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 })
const sessions: EnterpriseSession[] = []
afterEach(() => { cleanup(); for (const session of sessions.splice(0)) session.dispose(); vi.restoreAllMocks() })
async function fixture(status: PublicationView['status'] = 'pending', initial: AssignmentView[] = []) {
  const state = { publication: { ...base, status }, assignments: structuredClone(initial), account: admin,
    list: undefined as unknown[] | undefined, read: undefined as unknown, failRead: false, skills: [] as unknown[] }
  const write = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(async (path, init) => {
    const body = JSON.parse(String(init.body)); const previous = state.publication
    if (path.endsWith('/review')) {
      state.publication = { ...previous, status: body.decision === 'publish' ? 'published' : body.decision === 'reject' ? 'rejected' : 'withdrawn',
        revision: previous.revision + 1, reviewReason: body.reason }
    } else {
      const row: AssignmentView = { subjectKind: body.subjectKind, subjectId: body.subjectId ?? null, effect: body.effect, active: body.active }
      state.assignments = [...state.assignments.filter(rule => `${rule.subjectKind}:${rule.subjectId}` !== `${row.subjectKind}:${row.subjectId}`), row]
      state.publication = { ...previous, revision: previous.revision + 1 }
    }
    return ok(state.publication)
  })
  const transport = vi.fn<typeof fetch>(async (value, init) => {
    const path = String(value).replace('/haas/v1', '')
    if (init?.method !== 'GET') return write(path, init!)
    if (path === '/auth/me') return ok(state.account)
    if (path === '/admin/members') return ok([admin, hansen, alex])
    if (path === '/admin/groups') return ok([group])
    if (state.failRead) return new Response(JSON.stringify({ title: '企业服务连接失败' }), { status: 503 })
    if (path === '/admin/skill-publications') return ok(state.skills)
    if (path === '/admin/publications') return ok(state.list ?? [state.publication])
    if (path === '/publications/' + base.publicationId) return ok(state.read ?? detail(state.publication))
    if (path.endsWith('/assignments')) return ok({ publication: state.publication, assignments: state.assignments })
    throw new Error('Unexpected test route: ' + path)
  })
  const session = new EnterpriseSession(new EnterpriseApi(transport)); sessions.push(session); await session.refresh()
  return { state, session, transport, write }
}
async function open(session: EnterpriseSession) {
  const rendered = render(<AdminSection session={session} />)
  fireEvent.click(screen.getByRole('button', { name: '智能体审核与分配', exact: true }))
  await screen.findByRole('button', { name: '查看发布 ' + base.name })
  return rendered
}
async function select() {
  fireEvent.click(screen.getByRole('button', { name: '查看发布 ' + base.name }))
  await screen.findByRole('region', { name: '发布详情' })
}
function confirm(reason = '业务负责人核对后确认') {
  fireEvent.change(screen.getByLabelText('操作原因'), { target: { value: reason } })
  fireEvent.click(screen.getByRole('checkbox', { name: '我已核对资源、版本、分配范围和操作影响' }))
}

describe('native Settings Agent review and assignment (component fixture, NOT Browser E2E)', () => {
  it('loads on demand, presents source identity/version, and offers no native run action for a review copy', async () => {
    const f = await fixture(); render(<AdminSection session={f.session} />)
    await screen.findByText('Hansen')
    expect(f.transport.mock.calls.some(([path]) => String(path).includes('publications'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '智能体审核与分配' })); await screen.findByText(base.name); await select()
    expect(screen.getByText(/提交人：Hansen \(@hansen\)/)).toBeInTheDocument()
    expect(screen.getByText('配置版本：v2-fixture')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: base.name + ' · 待审核' })).toHaveFocus()
    expect(screen.queryByRole('button', { name: /开始对话|采用/ })).toBeNull()
    expect(f.write).not.toHaveBeenCalled()
    expect(f.transport.mock.calls.every(([path]) => String(path).startsWith('/haas/v1/'))).toBe(true)
    expect(document.querySelector('main, aside, #root')).toBeNull()
  })

  it('confirms the exact revision once, locks navigation, and reloads authoritative state after publishing', async () => {
    const f = await fixture(); await open(f.session); await select()
    fireEvent.click(screen.getByRole('button', { name: '批准发布', exact: true }))
    expect(screen.getByLabelText('操作原因')).toHaveFocus()
    expect(screen.getByRole('button', { name: '确认提交' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '成员管理' })).toBeDisabled()
    confirm()
    const form = screen.getByRole('form', { name: '审核智能体发布' })
    fireEvent.submit(form); fireEvent.submit(form)
    await screen.findByRole('button', { name: '新增分配规则' })
    expect(f.write).toHaveBeenCalledTimes(1)
    const [path, init] = f.write.mock.calls[0]!
    expect(path).toBe('/admin/publications/' + base.publicationId + '/review')
    expect(JSON.parse(String(init.body))).toEqual({ decision: 'publish', expectedRevision: 1, reason: '业务负责人核对后确认' })
    expect(init.credentials).toBe('same-origin')
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.getByText(/批准本身不授予使用权限/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '成员管理' })).toBeEnabled()
    expect(screen.getByText(/提交人：Hansen.*审核修订 2/)).toBeInTheDocument()
  })

  it.each([['pending', '拒绝发布', 'rejected'], ['published', '下架发布', 'withdrawn']] as const)('supports %s review transitions without deleting immutable history', async (status, button, next) => {
    const f = await fixture(status); await open(f.session); await select()
    fireEvent.click(screen.getByRole('button', { name: button, exact: true })); confirm()
    fireEvent.submit(screen.getByRole('form', { name: '审核智能体发布' }))
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull())
    await screen.findByRole('region', { name: '发布详情' })
    expect(f.state.publication.status).toBe(next); expect(f.state.publication.digest).toBe(base.digest)
    expect(f.write.mock.calls[0]?.[1].method).toBe('POST')
  })

  it.each(['user', 'group', 'all'] as const)('writes an explicit %s assignment and never infers permission from publication', async kind => {
    const f = await fixture('published'); await open(f.session); await select()
    expect(screen.getByText('尚未配置分配规则。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新增分配规则' }))
    fireEvent.change(screen.getByLabelText('分配范围'), { target: { value: kind } })
    if (kind !== 'all') fireEvent.change(screen.getByLabelText(kind === 'user' ? '分配账户' : '分配成员组'), { target: { value: kind === 'user' ? alex.userId : group.groupId } })
    if (kind !== 'user') expect(screen.queryByRole('option', { name: '明确拒绝（优先）' })).toBeNull()
    confirm(); fireEvent.submit(screen.getByRole('form', { name: '配置智能体分配' }))
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull()); await screen.findByText('允许 · 规则启用')
    expect(JSON.parse(String(f.write.mock.calls[0]?.[1].body))).toEqual({ subjectKind: kind,
      ...(kind === 'all' ? {} : { subjectId: kind === 'user' ? alex.userId : group.groupId }), effect: 'allow', active: true,
      expectedRevision: 1, reason: '业务负责人核对后确认' })
  })

  it('edits and revokes an existing exact user rule without silently changing its target', async () => {
    const f = await fixture('published', [{ subjectKind: 'user', subjectId: alex.userId, effect: 'allow', active: true }]); await open(f.session); await select()
    fireEvent.click(screen.getByRole('button', { name: '编辑分配 Alex (@alex)' }))
    expect(screen.queryByLabelText('分配账户')).toBeNull(); expect(screen.queryByLabelText('分配范围')).toBeNull()
    expect(screen.getByText(/固定分配对象：Alex/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('授权效果'), { target: { value: 'deny' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '启用此分配规则（取消勾选即撤销该规则）' }))
    expect(screen.getByText('撤销明确拒绝后，该账户可能重新获得组或全员授权。')).toBeInTheDocument()
    confirm(); fireEvent.submit(screen.getByRole('form', { name: '配置智能体分配' }))
    await screen.findByText('明确拒绝 · 规则已撤销')
    expect(f.state.assignments).toEqual([{ subjectKind: 'user', subjectId: alex.userId, effect: 'deny', active: false }])
  })

  it('preserves a conflicting draft and retry key after an uncertain result, without claiming success', async () => {
    const f = await fixture(); f.write.mockRejectedValueOnce(new Error('连接中断，结果未知')).mockResolvedValue(new Response(JSON.stringify({ title: '发布状态已变化，请刷新后重试' }), { status: 409 }))
    await open(f.session); await select(); fireEvent.click(screen.getByRole('button', { name: '批准发布', exact: true })); confirm('保留这个审核理由')
    fireEvent.submit(screen.getByRole('form')); await screen.findByText('连接中断，结果未知')
    fireEvent.submit(screen.getByRole('form')); await screen.findByText('发布状态已变化，请刷新后重试')
    expect(screen.getByLabelText('操作原因')).toHaveValue('保留这个审核理由')
    expect(f.write.mock.calls[0]?.[1].headers).toEqual(f.write.mock.calls[1]?.[1].headers)
    expect(screen.queryByText(/已发布，原因和操作已记录/)).toBeNull()
    expect(screen.getByRole('button', { name: '刷新发布与分配' })).toBeDisabled()
  })

  it('confirms dirty cancellation, restores action focus, and prevents Escape from closing native Settings', async () => {
    const f = await fixture(), hostEscape = vi.fn(), confirmDialog = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<div onKeyDown={hostEscape}><AdminSection session={f.session} /></div>)
    fireEvent.click(screen.getByRole('button', { name: '智能体审核与分配' })); await screen.findByText(base.name); await select()
    const approve = screen.getByRole('button', { name: '批准发布', exact: true }); fireEvent.click(approve)
    fireEvent.change(screen.getByLabelText('操作原因'), { target: { value: '尚未提交的说明' } })
    fireEvent.keyDown(screen.getByLabelText('操作原因'), { key: 'Escape' })
    expect(screen.getByRole('form')).toBeInTheDocument(); expect(hostEscape).not.toHaveBeenCalled()
    confirmDialog.mockReturnValue(true); fireEvent.keyDown(screen.getByLabelText('操作原因'), { key: 'Escape' })
    await waitFor(() => expect(approve).toHaveFocus()); expect(f.write).not.toHaveBeenCalled()
  })

  it('aborts selected content and ignores its late reply on identity loss', async () => {
    const f = await fixture(); await open(f.session)
    const real = f.transport.getMockImplementation()!; let complete!: (value: Response) => void
    f.transport.mockImplementation((path, init) => String(path) === '/haas/v1/publications/' + base.publicationId
      ? new Promise(done => { complete = done }) : real(path, init))
    fireEvent.click(screen.getByRole('button', { name: '查看发布 ' + base.name }))
    await screen.findByText('正在回读所选版本和分配规则…')
    const request = f.transport.mock.calls.find(([path]) => String(path) === '/haas/v1/publications/' + base.publicationId)!
    act(() => f.session.invalidate()); expect(request[1]?.signal?.aborted).toBe(true)
    await act(async () => complete(ok(detail(base))))
    expect(screen.queryByText(base.name)).toBeNull(); expect(screen.queryByRole('region', { name: '发布详情' })).toBeNull()
    expect(screen.getByText(/登录已失效/)).toBeInTheDocument()
  })

  it('aborts an in-flight write on disposal and ignores a late successful receipt', async () => {
    const f = await fixture(); const view = await open(f.session); await select()
    let complete!: (value: Response) => void; f.write.mockImplementation(() => new Promise(done => { complete = done }))
    fireEvent.click(screen.getByRole('button', { name: '批准发布', exact: true })); confirm(); fireEvent.submit(screen.getByRole('form'))
    const signal = f.write.mock.calls[0]?.[1].signal; expect(signal?.aborted).toBe(false)
    view.unmount(); expect(signal?.aborted).toBe(true)
    const reads = f.transport.mock.calls.length
    await act(async () => complete(ok({ ...base, status: 'published', revision: 2, reviewReason: '确认发布' })))
    expect(f.transport).toHaveBeenCalledTimes(reads)
  })

  it('distinguishes empty/filter/error states and fails closed on inconsistent detail revisions', async () => {
    const f = await fixture(); await open(f.session)
    fireEvent.change(screen.getByLabelText('搜索企业发布'), { target: { value: 'Alex' } })
    expect(screen.getByText('当前筛选没有匹配的发布。')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('搜索企业发布'), { target: { value: '' } })
    f.state.read = detail({ ...base, revision: 2 }); fireEvent.click(screen.getByRole('button', { name: '查看发布 ' + base.name }))
    await screen.findByText('发布版本或分配对象已变化，请重新读取详情')
    expect(screen.queryByRole('button', { name: '批准发布' })).toBeNull()
    f.state.failRead = true; fireEvent.click(screen.getByRole('button', { name: '刷新发布与分配' }))
    await screen.findByText('企业服务连接失败')
    expect(screen.queryByText(/暂无提交审核/)).toBeNull(); expect(screen.queryByText(base.name)).toBeNull()
  })

  it('keeps the administrator subsection absent and performs no governance reads for members', async () => {
    const f = await fixture(); f.state.account = hansen; await f.session.refresh(); render(<AdminSection session={f.session} />)
    expect(screen.queryByRole('button', { name: '智能体审核与分配' })).toBeNull()
    expect(f.transport.mock.calls.every(([path]) => String(path).endsWith('/auth/me'))).toBe(true)
  })

  it('shows a genuine empty queue and preserves archived assignment targets without offering a new archived group', async () => {
    const f = await fixture('published'); f.state.list = []; render(<AdminSection session={f.session} />)
    fireEvent.click(screen.getByRole('button', { name: '智能体审核与分配' }))
    await screen.findByText('暂无提交审核的智能体。个人创建不自动提交或发布。')
    f.state.list = undefined
    const actual = f.transport.getMockImplementation()!
    f.transport.mockImplementation((path, init) => String(path).endsWith('/admin/groups') ? Promise.resolve(ok([{ ...group, status: 'archived' }])) : actual(path, init))
    f.state.assignments = [{ subjectKind: 'group', subjectId: group.groupId, effect: 'allow', active: true }]
    fireEvent.click(screen.getByRole('button', { name: '刷新发布与分配' })); await screen.findByText(base.name); await select()
    fireEvent.click(screen.getByRole('button', { name: '编辑分配 客户服务团队 · 已归档' }))
    expect(screen.getByText(/固定分配对象：客户服务团队 · 已归档/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: '新增分配规则' })); fireEvent.change(screen.getByLabelText('分配范围'), { target: { value: 'group' } })
    expect(screen.queryByRole('option', { name: '客户服务团队' })).toBeNull()
  })

  it('cannot submit dependency approval without an explicitly selected matching published Skill', async () => {
    const f = await fixture(), value = detail(base)
    const content = { ...value.snapshot.content, dependencies: [{ name: 'client-research', digest: 'sha256:' + 'd'.repeat(64) }],
      profile: { ...value.snapshot.content.profile, preferredSkillNames: ['client-research'] } }
    f.state.read = { ...value, snapshot: { ...value.snapshot, content } }
    await open(f.session); await select()
    expect(screen.getByRole('button', { name: '批准发布', exact: true })).toBeEnabled()
    expect(screen.getByRole('button', { name: '拒绝发布', exact: true })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '批准发布', exact: true }))
    await screen.findByText(/没有已发布的匹配版本/)
    confirm()
    expect(screen.getByRole('button', { name: '确认提交' })).toBeDisabled()
    fireEvent.submit(screen.getByRole('form', { name: '审核智能体发布' }))
    expect(f.write).not.toHaveBeenCalled()
  })

  it('freezes the explicitly chosen id, filters incompatible versions, and reads the fixed edge after approval', async () => {
    const f = await fixture(), value = detail(base), name = 'client-research', digest = 'sha256:' + 'd'.repeat(64)
    const first = '10000000-0000-4000-8000-000000000001', chosen = '20000000-0000-4000-8000-000000000002'
    const content = { ...value.snapshot.content, dependencies: [{ name, digest }], profile: { ...value.snapshot.content.profile, preferredSkillNames: [name] } }
    f.state.read = { ...value, snapshot: { ...value.snapshot, content } }
    f.state.skills = [{ publicationId: first, name, digest, status: 'published' }, { publicationId: chosen, name, digest, status: 'published' },
      { publicationId: '30000000-0000-4000-8000-000000000003', name, digest, status: 'pending' },
      { publicationId: '40000000-0000-4000-8000-000000000004', name, digest: 'sha256:' + 'e'.repeat(64), status: 'published' }]
    f.write.mockImplementationOnce(async () => {
      f.state.publication = { ...base, status: 'published', revision: 2, reviewReason: '业务负责人核对后确认' }
      f.state.read = { ...f.state.read as object, ...f.state.publication,
        skillPublications: [{ publicationId: chosen, name, packageDigest: digest, status: 'published' }] }
      return ok(f.state.publication)
    })
    await open(f.session); await select(); fireEvent.click(screen.getByRole('button', { name: '批准发布', exact: true }))
    await screen.findByRole('option', { name: name + ' · ' + chosen })
    const selectSkill = screen.getByLabelText('依赖技能 ' + name)
    expect(selectSkill).toHaveValue(''); expect(selectSkill.querySelectorAll('option')).toHaveLength(3)
    confirm(); expect(screen.getByRole('button', { name: '确认提交' })).toBeDisabled()
    fireEvent.change(selectSkill, { target: { value: chosen } })
    fireEvent.submit(screen.getByRole('form', { name: '审核智能体发布' }))
    await screen.findByText(name + ' · 固定技能发布 ' + chosen + ' · 已发布')
    expect(JSON.parse(String(f.write.mock.calls[0]![1].body))).toEqual({ decision: 'publish', expectedRevision: 1,
      reason: '业务负责人核对后确认', skillPublications: [{ name, publicationId: chosen }] })
    expect(f.write).toHaveBeenCalledOnce()
  })

  it('retains the review draft across a Skill catalog failure and retry without choosing or granting anything', async () => {
    const f = await fixture(), value = detail(base), name = 'client-research', digest = 'sha256:' + 'd'.repeat(64)
    f.state.read = { ...value, snapshot: { ...value.snapshot, content: { ...value.snapshot.content, dependencies: [{ name, digest }],
      profile: { ...value.snapshot.content.profile, preferredSkillNames: [name] } } } }
    await open(f.session); await select(); f.state.failRead = true
    fireEvent.click(screen.getByRole('button', { name: '批准发布', exact: true }))
    await screen.findByRole('button', { name: '重读技能发布' }); confirm('保留审核草稿')
    expect(screen.getByRole('button', { name: '确认提交' })).toBeDisabled()
    f.state.failRead = false; fireEvent.click(screen.getByRole('button', { name: '重读技能发布' }))
    await screen.findByText(/没有已发布的匹配版本/)
    expect(screen.getByLabelText('操作原因')).toHaveValue('保留审核草稿')
    expect(f.write).not.toHaveBeenCalled()
  })

  it('preserves the draft when a success-shaped receipt describes the wrong result', async () => {
    const f = await fixture(); f.write.mockResolvedValue(ok({ ...base, revision: 2, status: 'rejected', reviewReason: '不同决定' }))
    await open(f.session); await select(); fireEvent.click(screen.getByRole('button', { name: '批准发布', exact: true })); confirm()
    fireEvent.submit(screen.getByRole('form'))
    await screen.findByText('操作回执与所选版本不一致，请重新读取；请勿重复创建变更')
    expect(screen.getByLabelText('操作原因')).toHaveValue('业务负责人核对后确认')
    expect(screen.queryByText(/已发布，原因和操作已记录/)).toBeNull()
  })

  it('validates bounded display projections and refuses foreign routes before transport', async () => {
    expect(publicationDetail(detail(base)).configVersion).toBe(base.configVersion)
    const named = detail(base), longName = 'skill-' + 'a'.repeat(170)
    expect(publicationDetail({ ...named, snapshot: { ...named.snapshot, content: { ...named.snapshot.content,
      profile: { ...named.snapshot.content.profile, preferredSkillNames: [longName] },
      dependencies: [{ name: longName, digest: 'sha256:' + 'd'.repeat(64) }] } } }).dependencies[0]?.name).toBe(longName)
    for (const invalid of [{ ...base, digest: 'fake' }, { ...base, revision: 0 }, { ...base, sourceUserId: 'unknown' }, { ...base, status: 'ready' }]) expect(() => publicationView(invalid)).toThrow()
    expect(() => publicationViews([base, base])).toThrow()
    expect(() => publicationDetail({ ...detail(base), access: 'user-allow' })).toThrow()
    expect(() => publicationDetail({ ...detail(base), snapshot: { ...detail(base).snapshot, digest: 'sha256:' + 'c'.repeat(64) } })).toThrow()
    for (const invalid of [
      [{ subjectKind: 'all', subjectId: hansen.userId, effect: 'allow', active: true }],
      [{ subjectKind: 'group', subjectId: group.groupId, effect: 'deny', active: true }],
      [{ subjectKind: 'all', subjectId: null, effect: 'allow', active: true }, { subjectKind: 'all', subjectId: null, effect: 'allow', active: false }],
    ]) expect(() => publicationAssignments({ publication: base, assignments: invalid })).toThrow()
    const transport = vi.fn<typeof fetch>(), api = new EnterpriseApi(transport)
    for (const path of ['https://foreign.invalid/admin/publications', '/admin/publications/../../auth/me', '/publications?tenantId=foreign', '/api/session.prompt']) await expect(api.request(path)).rejects.toThrow('Unsupported')
    expect(transport).not.toHaveBeenCalled(); api.dispose()
  })
})
