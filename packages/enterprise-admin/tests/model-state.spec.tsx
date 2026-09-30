import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemberModelState } from '../src/client/model-state.js'
import { EnterpriseApi } from '../src/client/api.js'
const hansen = { userId: 'b0000000-0000-4000-8000-000000000002', tenantId: 'model-component', username: 'hansen', displayName: 'Hansen', role: 'member', status: 'active' }
const alex = { ...hansen, userId: 'c0000000-0000-4000-8000-000000000003', username: 'alex', displayName: 'Alex' }
const accounts = [hansen, alex, { ...hansen, userId: 'd0000000-0000-4000-8000-000000000004', displayName: 'Disabled', status: 'disabled' }]
const apis: EnterpriseApi[] = []
const cellRevision = 'e0000000-0000-4000-8000-000000000005'
afterEach(() => { cleanup(); for (const api of apis.splice(0)) api.dispose(); vi.restoreAllMocks() })
function fixture() {
  const result = (data: unknown) => new Response(JSON.stringify({ data }))
  const state: { override?: (input: any) => Promise<Response>; members?: typeof accounts; credential?: string;
    writable?: boolean; command?: any; write?: (input: any) => Promise<Response>; metadata?: () => Promise<Response> } = {}
  const post = vi.fn(async (input: any) => {
    if (state.override) return state.override(input)
    const member = accounts.find(row => row.userId === input.memberId)!
    return result({ disclosure: { memberId: input.memberId, memberName: member.displayName, reason: input.reason, readOnly: true,
      requestId: crypto.randomUUID(), authorizedAt: '2026-09-09T00:00:00Z', completedAt: '2026-09-09T00:00:01Z' },
    data: { selection: { provider: 'deepseek-official', model: member.username + '-model', reasoningEffort: 'off' }, providerActive: true, modelListed: true,
      credential: state.credential ?? 'configured', authorization: 'not-evaluated', modelCall: 'not-performed',
      configuration: { writable: state.writable ?? true, revision: 3, applies: 'live', cellRevision, credentialWritable: state.credential === 'not-inspected' ? null : state.writable ?? true },
      providers: [{ provider: 'deepseek-official', name: 'DeepSeek', active: true }],
      catalog: { groups: [{ provider: 'deepseek-official', name: 'DeepSeek', models: [{ id: member.username + '-model', name: member.displayName + ' Chat' }, { id: 'reasoner', name: 'Reasoner' }] }], failedProviders: [] } } })
  })
  const commands = vi.fn(async (input: any) => {
    if (state.write) return state.write(input)
    const change = input.change.kind === 'selection' ? input.change : { kind: 'credential', action: input.change.action }
    state.command = { commandId: crypto.randomUUID(), targetUserId: input.targetUserId, outcome: 'applied', intent: { ...input, change }, historicalReceipt: true, runtimeGrant: false }
    state.command.confirmation = { commandId: state.command.commandId, outcome: 'applied' }
    return result(state.command)
  })
  const metadata = vi.fn(async (targetUserId: string) => state.metadata ? state.metadata() : result({ targetUserId, command: state.command ?? null }))
  const transport = vi.fn(async (path: string | URL | Request, options?: RequestInit) => {
    if (path === '/haas/v1/admin/members') return result(state.members ?? accounts)
    if (path === '/haas/v1/admin/model-state' && options?.method === 'POST') return post(JSON.parse(String(options.body)))
    if (path === '/haas/v1/admin/model-command-state' && options?.method === 'POST') return metadata(JSON.parse(String(options.body)).targetUserId)
    if (path === '/haas/v1/admin/model-commands' && options?.method === 'POST') return commands(JSON.parse(String(options.body)))
    if (String(path).endsWith('/resolve') && options?.method === 'POST') {
      state.command = { ...state.command, outcome: 'superseded', confirmation: { commandId: state.command.commandId, outcome: 'superseded', effect: 'unknown' } }
      return result(state.command)
    }
    throw Error('Unexpected model component route')
  })
  const api = new EnterpriseApi(transport as typeof fetch); apis.push(api)
  return { api, state, post, result, commands, metadata, transport }
}
async function choose() {
  fireEvent.change(await screen.findByRole('combobox', { name: '成员' }), { target: { value: hansen.userId } })
  fireEvent.change(screen.getByRole('textbox', { name: '核对原因' }), { target: { value: '核对成员模型配置' } })
  fireEvent.click(screen.getByRole('checkbox'))
}
const read = () => fireEvent.click(screen.getByRole('button', { name: '记录原因并读取模型状态' }))
describe('native Settings model state component, not Browser E2E', () => {
  it('does not prefetch model state and requires a target, reason and confirmation', async () => {
    const f = fixture(); render(<MemberModelState api={f.api} />)
    await screen.findByRole('combobox', { name: '成员' })
    expect(screen.getByRole('checkbox').closest('label')).toHaveAttribute('data-enterprise-checkbox')
    expect(f.post).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: '记录原因并读取模型状态' })).toBeDisabled()
    expect(screen.queryByRole('option', { name: /Disabled/ })).toBeNull()
    await choose(); read(); await screen.findByText('deepseek-official / hansen-model')
    expect(f.post).toHaveBeenCalledTimes(1)
    expect(f.post.mock.calls[0]![0]).toEqual({ memberId: hansen.userId, reason: '核对成员模型配置', confirmed: true })
    expect(screen.getByText('原生凭证服务报告已配置；未验证调用')).toBeInTheDocument()
    await screen.findByText('未发现该成员的模型配置操作记录。')
    expect(f.commands).not.toHaveBeenCalled()
  })
  it.each(['missing', 'not-inspected'])('does not equate %s authentication with successful use', async credential => {
    const f = fixture(); f.state.credential = credential
    render(<MemberModelState api={f.api} />); await choose(); read()
    await screen.findByText(credential === 'missing' ? '原生凭证服务报告未配置' : '未检查；可能由提供方管理其他认证方式')
    expect(screen.getByText(/未验证配额、当前调用权限或真实会话回复/)).toBeInTheDocument()
  })
  it('discards prior state on target changes and closes with Escape, restoring keyboard focus', async () => {
    const f = fixture(); render(<MemberModelState api={f.api} />); await choose(); read(); await screen.findByText('deepseek-official / hansen-model')
    await waitFor(() => expect(screen.getByRole('combobox', { name: '成员' })).not.toBeDisabled())
    fireEvent.change(screen.getByRole('combobox', { name: '成员' }), { target: { value: alex.userId } })
    expect(screen.queryByText('deepseek-official / hansen-model')).toBeNull(); expect(screen.getByRole('checkbox')).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox')); read(); await screen.findByText('deepseek-official / alex-model')
    await waitFor(() => expect(screen.getByRole('combobox', { name: '成员' })).not.toBeDisabled())
    fireEvent.keyDown(screen.getByText('deepseek-official / alex-model'), { key: 'Escape' })
    expect(screen.queryByText('deepseek-official / alex-model')).toBeNull(); expect(screen.getByRole('textbox', { name: '核对原因' })).toHaveFocus()
  })
  it('allows cancellation and ignores late results without another request or a false error', async () => {
    const f = fixture(); let resolve!: (value: Response) => void
    f.state.override = () => new Promise(done => { resolve = done })
    render(<MemberModelState api={f.api} />); await choose(); read()
    await waitFor(() => expect(f.post).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('combobox', { name: '成员' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '关闭状态／停止等待' }))
    await act(async () => resolve(f.result({ data: {}, disclosure: {} })))
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByRole('textbox', { name: '核对原因' })).toHaveFocus()
  })
  it('rejects mismatched disclosure and never silently retries or shows stale state', async () => {
    const f = fixture(); f.state.override = async () => f.result({ disclosure: { memberId: alex.userId }, data: { catalog: {} } })
    render(<MemberModelState api={f.api} />); await choose(); read()
    expect(await screen.findByRole('alert')).toHaveTextContent('模型状态审计回执不匹配')
    expect(f.post).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: '核对原因' })).toHaveValue('核对成员模型配置')
  })
  it('clears pending state when the API owner changes', async () => {
    const old = fixture(), next = fixture(); let resolve!: (value: Response) => void
    old.state.override = () => new Promise(done => { resolve = done })
    const view = render(<MemberModelState api={old.api} />); await choose(); read()
    await waitFor(() => expect(old.post).toHaveBeenCalledTimes(1))
    view.rerender(<MemberModelState api={next.api} />)
    await act(async () => resolve(old.result({ data: {}, disclosure: {} })))
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('combobox', { name: '成员' })).toHaveValue('')
  })
  it('discloses the empty enabled-member list', async () => {
    const f = fixture(); f.state.members = []
    render(<MemberModelState api={f.api} />)
    await screen.findByText('暂无已启用的使用人员。'); expect(f.post).not.toHaveBeenCalled()
  })
})

async function ready(f: ReturnType<typeof fixture>, onEditing?: (value: boolean) => void) {
  const view = render(<MemberModelState api={f.api} onEditing={onEditing} />)
  await choose(); read()
  await waitFor(() => expect(screen.getByRole('button', { name: '更改默认模型' })).not.toBeDisabled())
  return view
}
function confirmChange() {
  const form = within(screen.getByRole('form', { name: '确认模型配置变更' }))
  fireEvent.change(form.getByRole('textbox', { name: '变更原因' }), { target: { value: '为 Hansen 配置授权模型' } })
  fireEvent.click(form.getByRole('checkbox'))
  fireEvent.click(form.getByRole('button', { name: '确认本次变更' }))
}
function pendingCommand() {
  return { commandId: 'f0000000-0000-4000-8000-000000000006', targetUserId: hansen.userId, outcome: 'unconfirmed', confirmation: null,
    intent: { targetUserId: hansen.userId, expectedCellRevision: cellRevision, expectedSettingsRevision: 3,
      change: { kind: 'credential', action: 'set' }, reason: '既有未确认的凭证提交', confirmed: true }, historicalReceipt: true, runtimeGrant: false }
}
describe('administrator configuration interaction components, not real Browser E2E', () => {
  it('locks navigation while editing, confirms one exact model change and requires a new native read afterwards', async () => {
    const f = fixture(), editing = vi.fn(); await ready(f, editing)
    const button = screen.getByRole('button', { name: '更改默认模型' }); fireEvent.click(button)
    expect(screen.getByRole('textbox', { name: '变更原因' })).toHaveFocus()
    expect(screen.getByRole('combobox', { name: '成员' })).toBeDisabled(); expect(editing).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('button', { name: '关闭状态／停止等待' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认本次变更' })).toBeDisabled(); expect(f.commands).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox', { name: '默认模型' }), { target: { value: JSON.stringify(['deepseek-official', 'reasoner']) } })
    confirmChange()
    await screen.findByText('原生操作已确认；这不代表模型调用或凭证有效性验证通过。')
    expect(f.commands).toHaveBeenCalledTimes(1)
    expect(f.commands.mock.calls[0]![0]).toMatchObject({ targetUserId: hansen.userId, expectedCellRevision: cellRevision, expectedSettingsRevision: 3,
      change: { kind: 'selection', selection: { provider: 'deepseek-official', model: 'reasoner', reasoningEffort: 'off' } }, confirmed: true })
    expect(screen.getByRole('button', { name: '更改默认模型' })).toBeDisabled()
    expect(screen.getByText(/以下是操作前的读取快照/)).toBeInTheDocument()
    expect(f.post).toHaveBeenCalledTimes(1); expect(f.metadata).toHaveBeenCalledTimes(1)
  })
  it('clears an unsubmitted password on Escape and returns focus without closing the original state', async () => {
    const f = fixture(); await ready(f)
    const button = screen.getByRole('button', { name: '设置模型凭证' }); fireEvent.click(button)
    const field = screen.getByLabelText('模型凭证') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'SYNTHETIC_NEVER_SUBMITTED' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(field.value).toBe(''); expect(screen.queryByLabelText('模型凭证')).toBeNull()
    expect(screen.getByText('deepseek-official / hansen-model')).toBeInTheDocument(); expect(button).toHaveFocus()
    expect(f.commands).not.toHaveBeenCalled()
  })
  it('sends a write-only password once, clears its input immediately and never uses browser storage', async () => {
    const f = fixture(); await ready(f)
    const storage = vi.spyOn(Storage.prototype, 'setItem'), credential = 'SYNTHETIC_WRITE_ONLY_PASSWORD'
    fireEvent.click(screen.getByRole('button', { name: '设置模型凭证' }))
    const field = screen.getByLabelText('模型凭证') as HTMLInputElement
    expect(field.type).toBe('password'); expect(field.autocomplete).toBe('off')
    fireEvent.change(field, { target: { value: credential } }); confirmChange()
    expect(field.value).toBe('')
    await screen.findByText('原生操作已确认；这不代表模型调用或凭证有效性验证通过。')
    expect(f.commands.mock.calls[0]![0].change).toEqual({ kind: 'credential', action: 'set', value: credential })
    expect(f.commands).toHaveBeenCalledTimes(1); expect(storage).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain(credential)
  })
  it('requires an explicit independent confirmation before removing the native credential', async () => {
    const f = fixture(); await ready(f)
    fireEvent.click(screen.getByRole('button', { name: '删除模型凭证' }))
    expect(screen.getByText(/可能使该成员后续模型调用失败/)).toBeInTheDocument(); expect(f.commands).not.toHaveBeenCalled()
    confirmChange(); await screen.findByText('原生操作已确认；这不代表模型调用或凭证有效性验证通过。')
    expect(f.commands.mock.calls[0]![0].change).toEqual({ kind: 'credential', action: 'unset' })
  })
  it.each(['unconfirmed', 'conflict'] as const)('renders %s as its own result, never as successful model usage', async outcome => {
    const f = fixture(); await ready(f)
    f.state.write = async input => { f.state.command = { ...pendingCommand(), intent: input, outcome,
      confirmation: outcome === 'unconfirmed' ? null : { commandId: pendingCommand().commandId, outcome } }; return f.result(f.state.command) }
    fireEvent.click(screen.getByRole('button', { name: '更改默认模型' })); confirmChange()
    await screen.findByText(outcome === 'unconfirmed' ? '操作结果不确定，可能已经生效。不要重复提交或更换请求标识。' : '原生设置修订冲突，本次操作未写入。请重新读取状态。')
    expect(screen.getByRole('button', { name: '更改默认模型' })).toBeDisabled(); expect(f.commands).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '读取操作记录' }))
    await waitFor(() => expect(f.metadata).toHaveBeenCalledTimes(2)); expect(f.commands).toHaveBeenCalledTimes(1)
  })
  it('recovers a completely lost response through metadata without retaining or re-entering the secret', async () => {
    const f = fixture(); await ready(f)
    f.state.write = async () => { f.state.command = pendingCommand(); throw Error('连接中断') }
    fireEvent.click(screen.getByRole('button', { name: '设置模型凭证' }))
    fireEvent.change(screen.getByLabelText('模型凭证'), { target: { value: 'SYNTHETIC_LOST' } }); confirmChange()
    expect(await screen.findByRole('alert')).toHaveTextContent('结果未确认，请读取操作记录')
    expect(screen.queryByLabelText('模型凭证')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '读取操作记录' }))
    await screen.findByText('操作结果不确定，可能已经生效。不要重复提交或更换请求标识。')
    expect(f.commands).toHaveBeenCalledTimes(1); expect(document.body.textContent).not.toContain('SYNTHETIC_LOST')
  })
  it('does not permit a new key to bypass pending work after a fresh component mount', async () => {
    const f = fixture(); f.state.command = pendingCommand()
    render(<MemberModelState api={f.api} />); await choose(); read()
    await screen.findByText('操作结果不确定，可能已经生效。不要重复提交或更换请求标识。')
    for (const name of ['更改默认模型','设置模型凭证','删除模型凭证']) expect(screen.getByRole('button', { name })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '核验替代环境并结束旧操作追认' })).toBeNull()
    expect(f.commands).not.toHaveBeenCalled()
  })
  it('ignores a late applied response after stopping the wait and never calls cancellation a rollback', async () => {
    const f = fixture(); await ready(f); let resolve!: (value: Response) => void
    f.state.write = input => new Promise(done => { resolve = value => { f.state.command = { ...pendingCommand(), intent: input, outcome: 'applied', confirmation: { commandId: pendingCommand().commandId, outcome: 'applied' } }; done(value) } })
    fireEvent.click(screen.getByRole('button', { name: '更改默认模型' })); confirmChange()
    await screen.findByRole('button', { name: '停止等待，结果待确认' })
    fireEvent.click(screen.getByRole('button', { name: '停止等待，结果待确认' }))
    expect(screen.getByRole('alert')).toHaveTextContent('这不是撤销')
    await act(async () => resolve(f.result({ ...pendingCommand(), outcome: 'applied', intent: f.commands.mock.calls[0]![0], confirmation: { commandId: pendingCommand().commandId, outcome: 'applied' } })))
    expect(screen.queryByText('原生操作已确认；这不代表模型调用或凭证有效性验证通过。')).toBeNull(); expect(f.commands).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '更改默认模型' })).toBeDisabled()
  })
  it('rejects a mismatched successful receipt and does not show success or automatically retry', async () => {
    const f = fixture(); await ready(f)
    f.state.write = async input => f.result({ ...pendingCommand(), intent: { ...input, expectedSettingsRevision: 99 }, outcome: 'applied',
      confirmation: { commandId: pendingCommand().commandId, outcome: 'applied' } })
    fireEvent.click(screen.getByRole('button', { name: '更改默认模型' })); confirmChange()
    expect(await screen.findByRole('alert')).toHaveTextContent('提交与模型操作回执不匹配')
    expect(f.commands).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: '更改默认模型' })).toBeDisabled()
  })
  it('only offers explicit resolution after a different observed cell revision and keeps historical effect unknown', async () => {
    const f = fixture(); f.state.command = pendingCommand(); f.state.command.intent.expectedCellRevision = 'a0000000-0000-4000-8000-000000000007'
    render(<MemberModelState api={f.api} />); await choose(); read()
    const button = await screen.findByRole('button', { name: '核验替代环境并结束旧操作追认' })
    fireEvent.click(button); expect(screen.getByText(/必须已由部署人员终止旧单元/)).toBeInTheDocument(); confirmChange()
    await screen.findByText('已结束旧操作追认，但其历史效果仍未知；没有重发、撤销或证明回退。')
    expect(f.commands).not.toHaveBeenCalled()
    const calls = f.transport.mock.calls.filter(([path]) => String(path).endsWith('/resolve'))
    expect(calls).toHaveLength(1); expect(JSON.parse(String(calls[0]![1]!.body))).toEqual({ expectedCellRevision: cellRevision, reason: '为 Hansen 配置授权模型', confirmed: true })
  })
  it('blocks configuration when the historical lookup fails instead of assuming no pending operation', async () => {
    const f = fixture(); f.state.metadata = async () => { throw Error('操作记录暂不可读') }
    render(<MemberModelState api={f.api} />); await choose(); read()
    expect(await screen.findByRole('alert')).toHaveTextContent('操作记录暂不可读')
    expect(screen.getByRole('button', { name: '更改默认模型' })).toBeDisabled(); expect(f.commands).not.toHaveBeenCalled()
  })
  it('allows closing a slow readonly operation lookup and discards its late result', async () => {
    const f = fixture(); let resolve!: (response: Response) => void
    f.state.metadata = () => new Promise(done => { resolve = done })
    render(<MemberModelState api={f.api} />); await choose(); read()
    await waitFor(() => expect(f.metadata).toHaveBeenCalledTimes(1))
    const close = screen.getByRole('button', { name: '关闭状态／停止等待' })
    expect(close).not.toBeDisabled(); fireEvent.click(close)
    await act(async () => resolve(f.result({ targetUserId: hansen.userId, command: pendingCommand() })))
    expect(screen.queryByRole('region', { name: '管理员模型配置' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull(); expect(f.commands).not.toHaveBeenCalled()
  })
  it('rejects secret-bearing or foreign metadata without retaining it in the visible view', async () => {
    const f = fixture(); f.state.command = pendingCommand(); f.state.command.intent.change.value = 'SYNTHETIC_BAD_SERVER_SECRET'
    render(<MemberModelState api={f.api} />); await choose(); read()
    expect(await screen.findByRole('alert')).toHaveTextContent('凭证操作回执无效')
    expect(document.body.textContent).not.toContain('SYNTHETIC_BAD_SERVER_SECRET')
    expect(screen.getByRole('button', { name: '设置模型凭证' })).toBeDisabled()
  })
  it('allows only the exact versioned command routes and preserves transport credentials and cancellation', async () => {
    const f = fixture(), id = pendingCommand().commandId
    for (const [path, method] of [['/admin/model-commands/' + id + '/resolve', 'GET'], ['/admin/model-commands/' + id + '/delete', 'POST'],
      ['/admin/model-command-state?targetUserId=' + hansen.userId, 'POST'], ['/admin/model-commands/../../auth/me', 'GET']]) {
      await expect(f.api.request(path!, method, {}, crypto.randomUUID())).rejects.toThrow('Unsupported enterprise plugin route')
    }
    expect(f.transport).not.toHaveBeenCalled()
    await f.api.request('/admin/model-command-state', 'POST', { targetUserId: hansen.userId }, crypto.randomUUID())
    expect(f.transport.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) })
  })
  it('clears a draft secret and unlocks its parent when the component unmounts', async () => {
    const f = fixture(), editing = vi.fn(), view = await ready(f, editing)
    fireEvent.click(screen.getByRole('button', { name: '设置模型凭证' }))
    const field = screen.getByLabelText('模型凭证') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'SYNTHETIC_UNMOUNT' } }); view.unmount()
    expect(field.value).toBe(''); expect(editing).toHaveBeenLastCalledWith(false); expect(f.commands).not.toHaveBeenCalled()
  })
})
