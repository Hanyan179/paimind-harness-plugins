import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClientContextFixture } from './client-fixture.js'
import { AccountSection, AdminSection, apply } from '../src/client/index.js'
import { EnterpriseApi, EnterpriseSession, accountView, type AccountView } from '../src/client/api.js'

const admin: AccountView = { userId: 'a0000000-0000-4000-8000-000000000001', tenantId: 'unit-tenant',
  username: 'admin', displayName: '测试管理员', role: 'admin', status: 'active' }
const member: AccountView = { ...admin, userId: 'b0000000-0000-4000-8000-000000000002', username: 'member', displayName: '测试成员', role: 'member' }
const ok = (data: unknown) => new Response(JSON.stringify({ data, requestId: 'unit-request' }), { status: 200 })
const denied = () => new Response(JSON.stringify({ title: '登录已失效' }), { status: 401 })
const disposers: (() => void)[] = []
afterEach(() => { cleanup(); for (const dispose of disposers.splice(0).reverse()) dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function sessionFor(account: AccountView, transport = vi.fn<typeof fetch>().mockResolvedValue(ok(account))) {
  const session = new EnterpriseSession(new EnterpriseApi(transport))
  disposers.push(() => session.dispose())
  await session.refresh()
  return { session, transport }
}

describe('native enterprise contribution (component tests, not Browser E2E)', () => {
  it('contributes only native Settings, inherits scoped tokens, and unloads its own registrations and requests', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => ok(admin))
    vi.stubGlobal('fetch', transport)
    const fixture = createClientContextFixture()
    disposers.push(() => fixture.disposeEffects())
    apply(fixture.context)
    await waitFor(() => expect(fixture.slots.some(row => row.options.id === 'paimind-enterprise-admin')).toBe(true))
    expect(fixture.slots.map(row => row.options.name).sort()).toEqual(['paimind.extension', 'settings.section', 'settings.section'])
    expect(document.querySelector('main, aside, #root')).toBeNull()
    expect(document.getElementById('@paimind/enterprise-admin')?.textContent).toContain('--dsw-alias-label-primary')
    const signal = transport.mock.calls[0]![1]!.signal!
    fixture.disposeEffects()
    expect(fixture.slots.every(row => row.disposed())).toBe(true)
    expect(signal.aborted).toBe(true)
    expect(document.getElementById('@paimind/enterprise-admin')).toBeNull()
  })

  it('does not register administrator navigation for a member', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => ok(member)))
    const fixture = createClientContextFixture()
    disposers.push(() => fixture.disposeEffects())
    apply(fixture.context)
    await waitFor(() => expect(fixture.slots).toHaveLength(1))
    await act(async () => { await Promise.resolve() })
    expect(fixture.slots[0]!.options.id).toBe('paimind-enterprise-account')
    expect(fixture.slots.some(row => row.options.name === 'paimind.extension')).toBe(false)
    expect(fixture.slots.some(row => row.options.id === 'paimind-enterprise-admin')).toBe(false)
  })

  it('a directly rendered member management section fetches no admin data', async () => {
    const { session, transport } = await sessionFor(member)
    render(<AdminSection session={session} />)
    expect(screen.getByRole('alert')).toHaveTextContent('仅限管理员')
    expect(transport).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '开通成员' })).toBeNull()
  })

  it('removes sensitive content immediately when the current session is invalidated', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async path => ok(String(path).endsWith('/auth/me') ? admin : [member]))
    const { session } = await sessionFor(admin, transport)
    render(<AdminSection session={session} />)
    await screen.findByText('测试成员')
    act(() => session.invalidate())
    expect(screen.queryByText('测试成员')).toBeNull()
    expect(screen.getByText(/登录已失效/)).toBeInTheDocument()
  })

  it('retains the idempotency key after a failed submission and sends no forged role or tenant', async () => {
    let attempts = 0
    const transport = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
      if (String(path).endsWith('/auth/me')) return ok(admin)
      if (init?.method === 'POST') {
        attempts += 1
        if (attempts === 1) throw new Error('测试网络断开')
        return ok(member)
      }
      return ok([member])
    })
    const { session } = await sessionFor(admin, transport)
    render(<AdminSection session={session} />)
    await screen.findByText('测试成员')
    fireEvent.click(screen.getByRole('button', { name: '开通成员' }))
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'new.member' } })
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '新成员' } })
    fireEvent.change(screen.getByLabelText('初始密码'), { target: { value: 'Synthetic password only 2026' } })
    fireEvent.submit(screen.getByRole('form', { name: '开通使用人员' }))
    await screen.findByText('测试网络断开')
    fireEvent.submit(screen.getByRole('form', { name: '开通使用人员' }))
    await screen.findByText('成员已开通，仅可使用被授权的能力。')
    const writes = transport.mock.calls.filter(call => call[1]?.method === 'POST')
    expect(writes).toHaveLength(2)
    expect(writes[0]![1]!.headers).toEqual(writes[1]![1]!.headers)
    const body = JSON.parse(String(writes[0]![1]!.body))
    expect(Object.keys(body).sort()).toEqual(['displayName', 'password', 'username'])
    expect(screen.queryByLabelText('初始密码')).toBeNull()
    expect(screen.getByRole('button', { name: '开通成员' })).toHaveFocus()
  })

  it('shows existing members first and cancels a focused creation form without writing or closing host Settings', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async path => ok(String(path).endsWith('/auth/me') ? admin : [member]))
    const { session } = await sessionFor(admin, transport)
    const hostEscape = vi.fn()
    render(<div onKeyDown={hostEscape}><AdminSection session={session} /></div>)
    await screen.findByText('测试成员')
    expect(screen.queryByRole('form', { name: '开通使用人员' })).toBeNull()
    const opener = screen.getByRole('button', { name: '开通成员' })
    fireEvent.click(opener)
    expect(screen.getByLabelText('用户名')).toHaveFocus()
    expect(screen.getByRole('button', { name: '停用 测试成员' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'discarded.member' } })
    fireEvent.keyDown(screen.getByLabelText('用户名'), { key: 'Escape' })
    expect(screen.queryByRole('form', { name: '开通使用人员' })).toBeNull()
    expect(opener).toHaveFocus()
    expect(hostEscape).not.toHaveBeenCalled()
    expect(transport.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
    fireEvent.click(opener)
    expect(screen.getByLabelText('用户名')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(opener).toHaveFocus()
  })

  it.each([
    ['开通成员', '开通使用人员', '用户名', 'sam.taylor'],
    ['编辑姓名 测试成员', '编辑成员姓名', '姓名', 'Taylor'],
    ['停用 测试成员', '确认成员状态变更', '操作原因', '核对成员停用'],
  ])('locks member form navigation until explicit cancellation: %s', async (action, form, input, value) => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async path => ok(String(path).endsWith('/auth/me') ? admin : [member]))
    const { session } = await sessionFor(admin, transport)
    render(<AdminSection session={session} />)
    await screen.findByText('测试成员')
    const navigation = within(screen.getByRole('group', { name: '企业管理内容' }))
    fireEvent.click(screen.getByRole('button', { name: action }))
    fireEvent.change(screen.getByLabelText(input), { target: { value } })
    for (const button of navigation.getAllByRole('button')) expect(button).toBeDisabled()
    fireEvent.click(navigation.getByRole('button', { name: '成员组', exact: true }))
    expect(screen.getByRole('form', { name: form })).toBeInTheDocument()
    expect(screen.getByLabelText(input)).toHaveValue(value)
    fireEvent.keyDown(screen.getByLabelText(input), { key: 'Escape' })
    expect(screen.queryByRole('form', { name: form })).toBeNull()
    for (const button of navigation.getAllByRole('button')) expect(button).toBeEnabled()
    expect(transport.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
    expect(transport.mock.calls.some(([path]) => String(path).endsWith('/admin/groups'))).toBe(false)
  })

  it('keeps member form navigation locked for one pending write and unlocks after its confirmed response', async () => {
    let finish!: (response: Response) => void
    const transport = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
      if (init?.method === 'PATCH') return new Promise<Response>(resolve => { finish = resolve })
      return ok(String(path).endsWith('/auth/me') ? admin : [member])
    })
    const { session } = await sessionFor(admin, transport)
    render(<AdminSection session={session} />)
    fireEvent.click(await screen.findByRole('button', { name: '停用 测试成员' }))
    fireEvent.change(screen.getByLabelText('操作原因'), { target: { value: '核对等待期间操作保护' } })
    const form = screen.getByRole('form', { name: '确认成员状态变更' })
    fireEvent.submit(form); fireEvent.submit(form)
    const navigation = within(screen.getByRole('group', { name: '企业管理内容' }))
    for (const button of navigation.getAllByRole('button')) expect(button).toBeDisabled()
    fireEvent.click(navigation.getByRole('button', { name: '操作审计', exact: true }))
    expect(screen.getByRole('form', { name: '确认成员状态变更' })).toBe(form)
    expect(transport.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
    await act(async () => { finish(ok({ ...member, status: 'disabled' })) })
    await screen.findByText('成员状态已更新，操作已记录审计。')
    for (const button of navigation.getAllByRole('button')) expect(button).toBeEnabled()
  })

  it('clears the member form navigation lock and private draft on identity invalidation', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async path => ok(String(path).endsWith('/auth/me') ? admin : [member]))
    const { session } = await sessionFor(admin, transport)
    render(<AdminSection session={session} />)
    await screen.findByText('测试成员')
    fireEvent.click(screen.getByRole('button', { name: '开通成员' }))
    fireEvent.change(screen.getByLabelText('初始密码'), { target: { value: 'Synthetic draft for invalidation' } })
    expect(screen.getByRole('button', { name: '成员组', exact: true })).toBeDisabled()
    act(() => session.invalidate())
    expect(screen.queryByLabelText('初始密码')).toBeNull()
    expect(screen.queryByRole('group', { name: '企业管理内容' })).toBeNull()
    await act(async () => { await session.refresh() })
    await screen.findByText('测试成员')
    expect(screen.getByRole('button', { name: '成员组', exact: true })).toBeEnabled()
    expect(screen.queryByRole('form', { name: '开通使用人员' })).toBeNull()
    expect(transport.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('focuses the status reason and Escape returns focus to its native settings action', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async path => ok(String(path).endsWith('/auth/me') ? admin : [member]))
    const { session } = await sessionFor(admin, transport)
    const hostEscape = vi.fn()
    render(<div onKeyDown={hostEscape}><AdminSection session={session} /></div>)
    const action = await screen.findByRole('button', { name: '停用 测试成员' })
    fireEvent.click(action)
    expect(screen.getByLabelText('操作原因')).toHaveFocus()
    fireEvent.keyDown(screen.getByLabelText('操作原因'), { key: 'Escape' })
    expect(screen.queryByLabelText('操作原因')).toBeNull()
    expect(action).toHaveFocus()
    expect(hostEscape).not.toHaveBeenCalled()
  })

  it('reads audit only when opened and reports failures without fabricated rows', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async path => {
      if (String(path).endsWith('/auth/me')) return ok(admin)
      if (String(path).endsWith('/admin/audit')) return new Response(JSON.stringify({ title: '审计服务不可用' }), { status: 503 })
      return ok([])
    })
    const { session } = await sessionFor(admin, transport)
    render(<AdminSection session={session} />)
    await screen.findByText('暂无成员。')
    expect(transport.mock.calls.some(([path]) => String(path).endsWith('/admin/audit'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '操作审计' }))
    await screen.findByText('审计服务不可用')
    expect(screen.queryByText('暂无审计记录。')).toBeNull()
  })

  it('presents readable audit actions while preserving exact events and user reasons, including unknown outcomes', async () => {
    const record = { occurred_at: '2026-09-07T06:00:00Z', actor_user_id: admin.userId, target_id: member.userId,
      request_id: 'unit-request', reason: null }
    const records = [
      { ...record, event_id: '1', action: 'identity.login', outcome: 'succeeded' },
      { ...record, event_id: '2', action: 'identity.me', outcome: 'failed', reason: 'dependency-failed' },
      { ...record, event_id: '3', action: 'identity.member.status', outcome: 'succeeded', reason: 'dependency-failed' },
      { ...record, event_id: '4', action: 'constructor', outcome: 'unknown-upstream', reason: 'original reason' },
      { ...record, event_id: '5', action: 'runtime.admission', outcome: 'denied', reason: 'runtime-unavailable' },
      { ...record, event_id: '6', action: 'content.access.read', outcome: 'succeeded', reason: JSON.stringify({ reason: '核对客户跟进记录', selection: 'sessions', readOnly: true }) },
      { ...record, event_id: '7', action: 'runtime.model.command.authorized', outcome: 'succeeded', reason: '配置成员模型' },
      { ...record, event_id: '8', action: 'runtime.model.confirmed', outcome: 'succeeded', reason: JSON.stringify({ reason: '选择默认模型', outcome: 'applied', commandId: 'model-command' }) },
      { ...record, event_id: '9', action: 'runtime.model.confirmed', outcome: 'succeeded', reason: JSON.stringify({ reason: '并发修订验证', outcome: 'conflict', commandId: 'model-conflict' }) },
      { ...record, event_id: '10', action: 'runtime.model.resolved', outcome: 'succeeded', reason: JSON.stringify({ reason: '替代环境核验', effect: 'unknown', commandId: 'model-unknown' }) },
      { ...record, event_id: '11', action: 'runtime.model.receipt', outcome: 'succeeded', reason: '读取最近模型操作' },
    ]
    const transport = vi.fn<typeof fetch>().mockImplementation(async path => ok(String(path).endsWith('/auth/me') ? admin
      : String(path).endsWith('/admin/audit') ? records : [member]))
    const { session } = await sessionFor(admin, transport)
    render(<AdminSection session={session} />)
    fireEvent.click(screen.getByRole('button', { name: '操作审计' }))
    await screen.findByText('登录企业账户')
    expect(screen.getByText('验证登录状态')).toBeInTheDocument()
    expect(screen.getByText('变更成员启用状态')).toBeInTheDocument()
    expect(screen.getByText('原因：依赖服务暂时不可用')).toBeInTheDocument()
    expect(screen.getByText('原因：dependency-failed')).toBeInTheDocument()
    expect(screen.getByText('原因：当前账户的运行环境尚未就绪或租约已到期')).toBeInTheDocument()
    expect(screen.getByText('其他企业操作')).toBeInTheDocument()
    expect(screen.getByText('读取成员会话内容')).toBeInTheDocument()
    expect(screen.getByText('原因：核对客户跟进记录；只读访问。具体目标及读取范围见追溯信息。')).toBeInTheDocument()
    expect(screen.getByText('核准模型配置操作权限')).toBeInTheDocument()
    expect(screen.getByText('读取历史模型操作')).toBeInTheDocument()
    expect(screen.getByText('原因：选择默认模型；原生操作已确认，未验证模型调用或凭证有效性。')).toBeInTheDocument()
    expect(screen.getByText('原因：并发修订验证；设置修订冲突，本次未写入。')).toBeInTheDocument()
    expect(screen.getByText('原因：替代环境核验；历史效果仍未知，没有重发或证明回退。')).toBeInTheDocument()
    expect(screen.getByText(/^未知结果/)).toBeInTheDocument()
    const details = [...document.querySelectorAll('details')]
    expect(details).toHaveLength(records.length)
    for (const [index, row] of records.entries()) {
      expect(details[index]!.textContent).toContain(`原始事件：${row.action}`)
      expect(details[index]!.textContent).toContain(`原始结果：${row.outcome}`)
      expect(details[index]!.textContent).toContain(`原始原因：${row.reason ?? '无'}`)
    }
  })

  it('edits a member name with focus, cancellation, stable retry and unchanged account authority', async () => {
    let saved = member; let writes = 0
    const transport = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
      if (String(path).endsWith('/auth/me')) return ok(admin)
      if (init?.method === 'PATCH') {
        writes += 1
        if (writes === 1) throw new Error('测试网络断开')
        saved = { ...member, displayName: 'Morgan' }; return ok(saved)
      }
      return ok([saved])
    })
    const { session } = await sessionFor(admin, transport)
    render(<AdminSection session={session} />)
    const edit = await screen.findByRole('button', { name: '编辑姓名 测试成员' })
    fireEvent.click(edit)
    expect(screen.getByLabelText('姓名')).toHaveFocus()
    fireEvent.keyDown(screen.getByLabelText('姓名'), { key: 'Escape' })
    expect(screen.queryByRole('form', { name: '编辑成员姓名' })).toBeNull()
    expect(edit).toHaveFocus(); expect(writes).toBe(0)
    fireEvent.click(edit)
    expect(screen.getByRole('button', { name: '开通成员' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: 'Morgan' } })
    fireEvent.submit(screen.getByRole('form', { name: '编辑成员姓名' }))
    await screen.findByText('测试网络断开')
    expect(screen.getByLabelText('姓名')).toHaveValue('Morgan')
    fireEvent.submit(screen.getByRole('form', { name: '编辑成员姓名' }))
    const feedback = await screen.findByText('成员姓名已更新，账户、权限和历史记录保持不变。')
    await screen.findByRole('button', { name: '编辑姓名 Morgan' })
    expect(feedback).toHaveFocus()
    expect(screen.queryByRole('form', { name: '编辑成员姓名' })).toBeNull()
    const calls = transport.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    expect(calls).toHaveLength(2)
    expect(calls[0]![0]).toBe(`/haas/v1/admin/members/${member.userId}/name`)
    expect(calls[0]![1]!.headers).toEqual(calls[1]![1]!.headers)
    expect(JSON.parse(String(calls[0]![1]!.body))).toEqual({ displayName: 'Morgan', expectedDisplayName: member.displayName })
  })

  it('logs out through the authorized API and discards its account projection', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async path => ok(String(path).endsWith('/auth/me') ? member : { revoked: true }))
    const { session } = await sessionFor(member, transport)
    render(<AccountSection session={session} />)
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    await screen.findByText(/登录已失效/)
    expect(screen.queryByText('测试成员')).toBeNull()
    expect(transport.mock.calls.at(-1)![0]).toBe('/haas/v1/auth/logout')
  })
})

describe('enterprise transport and current identity projection', () => {
  it('rejects cross-origin paths, missing command keys and malformed roles', async () => {
    const transport = vi.fn<typeof fetch>()
    const api = new EnterpriseApi(transport)
    disposers.push(() => api.dispose())
    await expect(api.request('https://example.invalid/admin/members')).rejects.toThrow('Unsupported')
    await expect(api.request('/admin/members', 'POST', {})).rejects.toThrow('stable command key')
    expect(transport).not.toHaveBeenCalled()
    expect(() => accountView({ ...admin, role: 'super_admin' })).toThrow()
  })
  it('does not restore a stale successful identity read after logout', async () => {
    let resolve!: (response: Response) => void
    const transport = vi.fn<typeof fetch>().mockImplementation(() => new Promise(done => { resolve = done }))
    const session = new EnterpriseSession(new EnterpriseApi(transport))
    disposers.push(() => session.dispose())
    const pending = session.refresh()
    session.invalidate(); resolve(ok(admin)); await pending
    expect(session.getSnapshot().status).toBe('signed-out')
  })
  it('clears identity on an unauthorized response before exposing the error', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => ok(admin))
    const { session } = await sessionFor(admin, transport)
    transport.mockImplementation(async () => denied())
    await session.refresh()
    expect(session.getSnapshot().status).toBe('signed-out')
    const init = transport.mock.calls[0]![1]!
    expect(init).toMatchObject({ credentials: 'same-origin', redirect: 'error', cache: 'no-store' })
    expect(init.headers).toBeUndefined()
  })
})
