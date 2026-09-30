import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemberContentReview } from '../src/client/member-content.js'
import { AdminSection } from '../src/client/index.js'
import { EnterpriseApi, EnterpriseSession } from '../src/client/api.js'
const admin = { userId: 'a0000000-0000-4000-8000-000000000001', tenantId: 'inspection-component', username: 'morgan', displayName: 'Morgan', role: 'admin', status: 'active' }
const hansen = { ...admin, userId: 'b0000000-0000-4000-8000-000000000002', username: 'hansen', displayName: 'Hansen', role: 'member' }
const alex = { ...hansen, userId: 'c0000000-0000-4000-8000-000000000003', username: 'alex', displayName: 'Alex' }
const accounts = [admin, hansen, alex]
const apis: EnterpriseApi[] = [], sessions: EnterpriseSession[] = []
afterEach(() => { cleanup(); for (const api of apis.splice(0)) api.dispose(); for (const session of sessions.splice(0)) session.dispose(); vi.restoreAllMocks() })
function fixture() {
  const result = (data: unknown) => new Response(JSON.stringify({ data }))
  const state: { account: typeof admin; override?: (input: any) => Promise<Response> } = { account: admin }
  const post = vi.fn(async (input: any) => {
    if (state.override) return state.override(input)
    const name = accounts.find(row => row.userId === input.memberId)!.displayName
    return result({ disclosure: { memberId: input.memberId, memberName: name, reason: input.reason, readOnly: true,
      requestId: crypto.randomUUID(), authorizedAt: '2026-09-09T00:00:00Z', completedAt: '2026-09-09T00:00:01Z' },
    data: input.selection.kind === 'sessions' ? { kind: 'sessions', items: [{ sessionId: name + '-session', title: name + ' 客户跟进', updatedAt: 123,
      running: false, blank: false, presetId: name + '-personal' }] } : { kind: 'history', sessionId: input.selection.sessionId,
      nextBeforeSeq: input.selection.beforeSeq === null ? 3 : null,
      messages: [{ role: 'user', seq: input.selection.beforeSeq === null ? 4 : 1, time: 123, text: '<script>inert employee text</script>', omittedBlocks: 1 }] } })
  })
  const transport = vi.fn(async (path: string | URL | Request, options?: RequestInit) => {
    if (path === '/haas/v1/auth/me') return result(state.account)
    if (path === '/haas/v1/admin/members') return result(accounts)
    if (path === '/haas/v1/admin/member-content' && options?.method === 'POST') return post(JSON.parse(String(options.body)))
    throw Error('Unexpected component route ' + String(path))
  })
  const api = new EnterpriseApi(transport as typeof fetch); apis.push(api)
  return { api, state, post, transport, result }
}
async function choose() {
  fireEvent.change(await screen.findByRole('combobox', { name: '成员' }), { target: { value: hansen.userId } })
  fireEvent.change(screen.getByRole('textbox', { name: '查看原因' }), { target: { value: '核对客户跟进记录' } })
  fireEvent.click(screen.getByRole('checkbox'))
}
const readList = () => fireEvent.click(screen.getByRole('button', { name: '记录原因并读取会话列表' }))
describe('reason-gated native Settings inspection component, not Browser E2E', () => {
  it('never prefetches member content; requires target, reason and explicit confirmation', async () => {
    const f = fixture(); render(<MemberContentReview api={f.api} />)
    await screen.findByRole('combobox', { name: '成员' })
    expect(screen.getByRole('checkbox').closest('label')).toHaveAttribute('data-enterprise-checkbox')
    expect(f.post).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '记录原因并读取会话列表' })).toBeDisabled()
    expect(screen.queryByRole('option', { name: /Morgan/ })).toBeNull()
    await choose(); readList()
    await screen.findByText('Hansen 客户跟进')
    expect(f.post).toHaveBeenCalledTimes(1)
    expect(f.post.mock.calls[0]![0]).toEqual({ memberId: hansen.userId, reason: '核对客户跟进记录', confirmed: true, selection: { kind: 'sessions' } })
    expect(screen.getByRole('status')).toHaveTextContent('本次访问已记录审计')
    expect(screen.queryByRole('button', { name: /发送|删除|编辑/ })).toBeNull()
  })
  it('reads backward pages explicitly and renders employee text inertly with omission disclosure', async () => {
    const f = fixture(); render(<MemberContentReview api={f.api} />); await choose(); readList()
    fireEvent.click(await screen.findByRole('button', { name: '只读查看历史' }))
    expect(await screen.findByText('<script>inert employee text</script>')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByText('另有 1 个非文本内容块未展示。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '读取较早内容' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '读取较早内容' })).toBeNull())
    expect(f.post.mock.calls[2]![0].selection).toEqual({ kind: 'history', sessionId: 'Hansen-session', beforeSeq: 3 })
    fireEvent.click(screen.getByRole('button', { name: '重新读取会话列表' }))
    await screen.findByText('Hansen 客户跟进'); expect(f.post).toHaveBeenCalledTimes(4)
  })
  it('clears prior content on target/reason changes and Escape without another read', async () => {
    const f = fixture(); render(<MemberContentReview api={f.api} />); await choose(); readList(); await screen.findByText('Hansen 客户跟进')
    fireEvent.change(screen.getByRole('combobox', { name: '成员' }), { target: { value: alex.userId } })
    expect(screen.queryByText('Hansen 客户跟进')).toBeNull(); expect(screen.getByRole('checkbox')).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox')); readList(); await screen.findByText('Alex 客户跟进')
    fireEvent.keyDown(screen.getByText('Alex 客户跟进'), { key: 'Escape' })
    expect(screen.queryByText('Alex 客户跟进')).toBeNull(); expect(screen.getByRole('textbox', { name: '查看原因' })).toHaveFocus()
    expect(f.post).toHaveBeenCalledTimes(2)
  })
  it('makes one pending request, allows cancellation, and ignores an uncooperative late result', async () => {
    const f = fixture(); let resolve!: (value: Response) => void
    f.state.override = () => new Promise(done => { resolve = done })
    render(<MemberContentReview api={f.api} />); await choose()
    const button = screen.getByRole('button', { name: '记录原因并读取会话列表' })
    fireEvent.click(button); fireEvent.click(button); fireEvent.submit(button.closest('form')!)
    await waitFor(() => expect(f.post).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: '关闭内容／停止等待' }))
    await act(async () => resolve(f.result({ data: {}, disclosure: {} })))
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByText(/正在只读查看/)).toBeNull()
    expect(screen.getByRole('textbox', { name: '查看原因' })).toHaveFocus()
  })
  it('does not show mismatched receipts or retry automatically, and keeps the reason for explicit retry', async () => {
    const f = fixture(); f.state.override = async () => f.result({ data: { kind: 'sessions', items: [] }, disclosure: { memberId: alex.userId } })
    render(<MemberContentReview api={f.api} />); await choose(); readList()
    expect(await screen.findByRole('alert')).toHaveTextContent('只读审计回执不匹配')
    expect(screen.getByRole('textbox', { name: '查看原因' })).toHaveValue('核对客户跟进记录')
    expect(f.post).toHaveBeenCalledTimes(1); expect(screen.queryByText(/原生会话列表为空/)).toBeNull()
  })
  it('discards pending content and confirmation when the API owner is replaced', async () => {
    const old = fixture(), next = fixture(); let resolve!: (value: Response) => void
    old.state.override = () => new Promise(done => { resolve = done })
    const view = render(<MemberContentReview api={old.api} />); await choose(); readList()
    await waitFor(() => expect(old.post).toHaveBeenCalledTimes(1))
    view.rerender(<MemberContentReview api={next.api} />)
    await screen.findByRole('combobox', { name: '成员' })
    await act(async () => resolve(old.result({ data: { kind: 'sessions', items: [] }, disclosure: {} })))
    expect(screen.getByRole('combobox', { name: '成员' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: '查看原因' })).toHaveValue('')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.queryByRole('alert')).toBeNull(); expect(next.post).not.toHaveBeenCalled()
    await choose(); readList(); await screen.findByText('Hansen 客户跟进')
    expect(next.post).toHaveBeenCalledTimes(1)
  })
  it('contributes the entry only inside verified administrator settings, not member settings', async () => {
    const f = fixture(), session = new EnterpriseSession(f.api); sessions.push(session); await session.refresh()
    render(<AdminSection session={session} />)
    fireEvent.click(screen.getByRole('button', { name: '成员会话只读查看' }))
    await screen.findByRole('heading', { name: '成员会话只读查看' })
    f.state.account = { ...hansen }; await act(async () => session.refresh())
    expect(screen.queryByRole('button', { name: '成员会话只读查看' })).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('此操作仅限管理员')
    expect(f.post).not.toHaveBeenCalled()
  })
})
