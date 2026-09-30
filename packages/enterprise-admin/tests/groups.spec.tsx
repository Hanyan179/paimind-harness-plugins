import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminSection } from '../src/client/index.js'
import { EnterpriseApi, EnterpriseSession, groupView, groupViews, type AccountView, type GroupView } from '../src/client/api.js'

const admin: AccountView = { userId: 'a0000000-0000-4000-8000-000000000001', tenantId: 'component-tenant', username: 'morgan', displayName: 'Morgan', role: 'admin', status: 'active' }
const hansen: AccountView = { ...admin, userId: 'b0000000-0000-4000-8000-000000000002', username: 'hansen', displayName: 'Hansen', role: 'member' }
const alex: AccountView = { ...hansen, userId: 'c0000000-0000-4000-8000-000000000003', username: 'alex', displayName: 'Alex', status: 'disabled' }
const baseGroup: GroupView = { groupId: 'd0000000-0000-4000-8000-000000000004', name: '客户服务团队', revision: 1, status: 'active', memberIds: [hansen.userId] }
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 })
const sessions: EnterpriseSession[] = []
afterEach(() => { cleanup(); for (const session of sessions.splice(0)) session.dispose(); vi.restoreAllMocks() })
async function fixture(groups: GroupView[] = [baseGroup], write?: (path: string, init: RequestInit) => Promise<Response>) {
  let rows = structuredClone(groups)
  const transport = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
    if (init?.method !== 'GET') {
      if (write) return write(String(path), init!)
      const body = JSON.parse(String(init?.body))
      const saved: GroupView = init?.method === 'POST' ? { ...baseGroup, name: body.name, memberIds: [] }
        : String(path).endsWith('/status') ? { ...rows[0]!, status: body.status, revision: rows[0]!.revision + 1 }
        : { ...rows[0]!, name: body.name, memberIds: body.memberIds, revision: rows[0]!.revision + 1 }
      rows = [saved]; return ok(saved)
    }
    return ok(String(path).endsWith('/auth/me') ? admin : String(path).endsWith('/admin/groups') ? rows : [admin, hansen, alex])
  })
  const session = new EnterpriseSession(new EnterpriseApi(transport)); sessions.push(session); await session.refresh()
  return { session, transport, setRows: (value: GroupView[]) => { rows = value } }
}
async function openGroups(session: EnterpriseSession) {
  render(<AdminSection session={session} />)
  fireEvent.click(screen.getByRole('button', { name: '成员组', exact: true }))
  await waitFor(() => expect(screen.getByRole('button', { name: '新建成员组' })).toBeEnabled())
}

describe('native Settings member groups (component interaction only, not Browser E2E)', () => {
  it('loads only on demand and shows normal names, membership count, and non-grant semantics', async () => {
    const { session, transport } = await fixture()
    render(<AdminSection session={session} />)
    await screen.findByText('Hansen')
    expect(transport.mock.calls.some(([path]) => String(path).endsWith('/admin/groups'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '成员组', exact: true }))
    await screen.findByText('客户服务团队')
    expect(screen.getByText('使用中 · 1 人 · 版本 1')).toBeInTheDocument()
    expect(screen.getByText('Hansen (@hansen)')).toBeInTheDocument()
    expect(screen.getByText(/加入组不改变角色，也不自动开放智能体或会话/)).toBeInTheDocument()
    expect(document.querySelector('main, aside, #root')).toBeNull()
  })

  it('creates from an empty list and restores focus after authoritative refresh', async () => {
    const { session, transport } = await fixture([])
    await openGroups(session)
    expect(screen.getByText(/暂无成员组/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新建成员组' }))
    expect(screen.getByLabelText('成员组名称')).toHaveFocus()
    expect(screen.getByRole('button', { name: '操作审计' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存成员组' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('成员组名称'), { target: { value: '市场研究团队' } })
    fireEvent.submit(screen.getByRole('form', { name: '新建成员组' }))
    await screen.findByText('市场研究团队')
    expect(screen.getByText('使用中 · 0 人 · 版本 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建成员组' })).toHaveFocus()
    const calls = transport.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(String(calls[0]![1]!.body))).toEqual({ name: '市场研究团队' })
  })

  it('edits membership without changing roles, including disabled accounts and administrators', async () => {
    const { session, transport } = await fixture()
    await openGroups(session)
    fireEvent.click(screen.getByRole('button', { name: '编辑成员组 客户服务团队' }))
    expect(screen.getByLabelText('成员组名称')).toHaveFocus()
    expect(screen.getByRole('checkbox', { name: 'Hansen (@hansen) · 成员' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hansen (@hansen) · 成员' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alex (@alex) · 成员 · 已停用' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Morgan (@morgan) · 管理员' }))
    fireEvent.change(screen.getByLabelText('成员组名称'), { target: { value: '销售与市场' } })
    fireEvent.submit(screen.getByRole('form', { name: '编辑成员组' }))
    await screen.findByText('销售与市场')
    expect(screen.getByText('Morgan (@morgan)、Alex (@alex)（已停用）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑成员组 销售与市场' })).toHaveFocus()
    const calls = transport.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    expect(JSON.parse(String(calls[0]![1]!.body))).toEqual({ name: '销售与市场', memberIds: [admin.userId, alex.userId], expectedRevision: 1 })
  })

  it('preserves a conflicting draft and reuses the command key after an uncertain transport failure', async () => {
    let count = 0
    const { session, transport } = await fixture([baseGroup], async () => {
      count += 1
      if (count === 1) throw new Error('测试连接中断，结果未知')
      return new Response(JSON.stringify({ title: '成员组已被修改，请刷新后重新编辑' }), { status: 409 })
    })
    await openGroups(session)
    fireEvent.click(screen.getByRole('button', { name: '编辑成员组 客户服务团队' }))
    fireEvent.change(screen.getByLabelText('成员组名称'), { target: { value: '未提交的名称' } })
    fireEvent.submit(screen.getByRole('form', { name: '编辑成员组' }))
    await screen.findByText('测试连接中断，结果未知')
    fireEvent.submit(screen.getByRole('form', { name: '编辑成员组' }))
    await screen.findByText('成员组已被修改，请刷新后重新编辑')
    expect(screen.getByLabelText('成员组名称')).toHaveValue('未提交的名称')
    const writes = transport.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    expect(writes).toHaveLength(2); expect(writes[0]![1]!.headers).toEqual(writes[1]![1]!.headers)
    expect(writes[0]![1]!.body).toBe(writes[1]![1]!.body)
    expect(screen.queryByText(/已保存/)).toBeNull()
  })

  it('does not discard dirty edits on Escape until confirmed, then restores focus without closing host Settings', async () => {
    const { session, transport } = await fixture()
    const hostEscape = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<div onKeyDown={hostEscape}><AdminSection session={session} /></div>)
    fireEvent.click(screen.getByRole('button', { name: '成员组', exact: true }))
    fireEvent.click(await screen.findByRole('button', { name: '编辑成员组 客户服务团队' }))
    fireEvent.change(screen.getByLabelText('成员组名称'), { target: { value: '保留草稿' } })
    fireEvent.keyDown(screen.getByLabelText('成员组名称'), { key: 'Escape' })
    expect(screen.getByLabelText('成员组名称')).toHaveValue('保留草稿')
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true)
    confirm.mockReturnValue(true)
    fireEvent.keyDown(screen.getByLabelText('成员组名称'), { key: 'Escape' })
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.getByRole('button', { name: '编辑成员组 客户服务团队' })).toHaveFocus()
    expect(hostEscape).not.toHaveBeenCalled()
    expect(transport.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
    const clean = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(clean); expect(clean.defaultPrevented).toBe(false)
  })

  it('requires a reason for archiving and restores the same group without dropping member references', async () => {
    const { session, transport } = await fixture()
    await openGroups(session)
    fireEvent.click(screen.getByRole('button', { name: '归档成员组 客户服务团队' }))
    expect(screen.getByLabelText('操作原因')).toHaveFocus()
    expect(screen.getByRole('button', { name: '保存成员组' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('操作原因'), { target: { value: '项目暂时归档' } })
    fireEvent.submit(screen.getByRole('form', { name: '变更成员组状态' }))
    await screen.findByText('已归档 · 1 人 · 版本 2')
    expect(screen.getByRole('button', { name: '编辑成员组 客户服务团队' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '恢复成员组 客户服务团队' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '恢复成员组 客户服务团队' }))
    fireEvent.change(screen.getByLabelText('操作原因'), { target: { value: '恢复客户项目' } })
    fireEvent.submit(screen.getByRole('form', { name: '变更成员组状态' }))
    await screen.findByText('使用中 · 1 人 · 版本 3')
    const writes = transport.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    expect(writes.map(([, init]) => JSON.parse(String(init!.body)))).toEqual([
      { status: 'archived', reason: '项目暂时归档', expectedRevision: 1 }, { status: 'active', reason: '恢复客户项目', expectedRevision: 2 },
    ])
  })

  it('suppresses simultaneous submissions and aborts its write on identity invalidation', async () => {
    let resolve!: (value: Response) => void
    const { session, transport } = await fixture([], () => new Promise(done => { resolve = done }))
    await openGroups(session)
    fireEvent.click(screen.getByRole('button', { name: '新建成员组' }))
    fireEvent.change(screen.getByLabelText('成员组名称'), { target: { value: '只创建一次' } })
    const form = screen.getByRole('form', { name: '新建成员组' })
    fireEvent.submit(form); fireEvent.submit(form)
    const writes = transport.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    act(() => session.invalidate())
    expect(writes[0]![1]!.signal!.aborted).toBe(true)
    await act(async () => { resolve(ok({ ...baseGroup, name: '只创建一次' })) })
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByText(/已创建/)).toBeNull()
    expect(screen.getByText(/登录已失效/)).toBeInTheDocument()
  })

  it.each(['unavailable', 'orphan', 'duplicate'] as const)('fails closed on %s lists without fabricated empty state or editable partial data', async failure => {
    const { session, transport } = await fixture()
    transport.mockImplementation(async path => {
      if (String(path).endsWith('/auth/me')) return ok(admin)
      if (String(path).endsWith('/admin/groups')) return failure === 'unavailable'
        ? new Response(JSON.stringify({ title: '成员组服务不可用' }), { status: 503 })
        : ok(failure === 'duplicate' ? [baseGroup, baseGroup] : [{ ...baseGroup, memberIds: ['e0000000-0000-4000-8000-000000000005'] }])
      return ok([admin, hansen, alex])
    })
    render(<AdminSection session={session} />)
    fireEvent.click(screen.getByRole('button', { name: '成员组', exact: true }))
    await screen.findByRole('alert')
    expect(screen.queryByText(/暂无成员组/)).toBeNull()
    expect(screen.getByRole('button', { name: '新建成员组' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '刷新成员组' })).toBeEnabled()
  })

  it('rejects malformed group projections rather than trusting fields or shared mutable arrays', () => {
    for (const patch of [{ groupId: 'not-a-uuid' }, { name: '' }, { name: ' untrimmed' }, { revision: 0 }, { revision: 1.2 }, { status: 'disabled' },
      { memberIds: ['foreign'] }, { memberIds: [hansen.userId, hansen.userId] }, { memberIds: Array(501).fill(hansen.userId) }]) {
      expect(() => groupView({ ...baseGroup, ...patch })).toThrow()
    }
    expect(() => groupViews(Array(201).fill(baseGroup))).toThrow()
    const source = structuredClone(baseGroup); const projected = groupView(source)
    projected.memberIds.length = 0; expect(source.memberIds).toEqual([hansen.userId])
  })
})
