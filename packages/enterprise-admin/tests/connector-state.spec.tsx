import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemberConnectorState } from '../src/client/connector-state.js'
import { connectorCommand, connectorSnapshot, connectorActivationSnapshot } from '../src/client/connector-view.js'
import { EnterpriseApi, EnterpriseSession } from '../src/client/api.js'
import { AdminSection } from '../src/client/index.js'

const hansen = { userId: 'b0000000-0000-4000-8000-000000000002', tenantId: 'component', username: 'hansen', displayName: 'Hansen', role: 'member' as const, status: 'active' as const }
const alex = { ...hansen, userId: 'c0000000-0000-4000-8000-000000000003', username: 'alex', displayName: 'Alex' }
const admin = { ...hansen, userId: 'a0000000-0000-4000-8000-000000000001', username: 'morgan', displayName: 'Morgan', role: 'admin' as const }
const cellRevision = 'd0000000-0000-4000-8000-000000000004', configRevision = 'a'.repeat(64)
const disposers: Array<() => void> = []
afterEach(() => { cleanup(); for (const dispose of disposers.splice(0).reverse()) dispose(); vi.restoreAllMocks() })
const ok = (data: unknown) => new Response(JSON.stringify({ data }))
const entry = { entryId: 'sales', serverName: 'sales', transport: 'streamable-http', enabled: false }
const configuration = () => ({ schema: 'paimind.connector-configuration/v1', revision: configRevision, activation: 'not-authorized', entries: [{ ...entry }] })
const snapshot = (targetUserId = hansen.userId) => ({ targetUserId, cellRevision, configuration: configuration(), activation: 'not-authorized' })
const activation = (targetUserId = hansen.userId) => ({ targetUserId, cellRevision, observation:'native-lifecycle-only',runtimeGrant:false,
  lifecycle:{schema:'paimind.connector-observation/v1',revision:configRevision,entries:[{...entry,configurationVersion:'b'.repeat(64),enabled:true,authority:'live',phase:'active',connection:'not-probed'}]} })
function fixture() {
  const state: { members?: any[]; account?: any; snapshot?: (input: any) => Promise<Response>; activation?: (input:any)=>Promise<Response>; write?: (input: any) => Promise<Response>; metadata?: () => Promise<Response>; command?: any; audits?: any[] } = {}
  const writes = vi.fn(async (input: any) => {
    if (state.write) return state.write(input)
    state.command = command(input)
    return ok(state.command)
  })
  const reads = vi.fn(async (input: any) => state.snapshot ? state.snapshot(input) : ok(snapshot(input.targetUserId)))
  const metadata = vi.fn(async (input: any) => state.metadata ? state.metadata() : ok({ targetUserId: input.targetUserId, command: state.command ?? null }))
  const transport = vi.fn(async (path: string | URL | Request, options?: RequestInit) => {
    if (path === '/haas/v1/auth/me') return ok(state.account ?? admin)
    if (path === '/haas/v1/admin/members') return ok(state.members ?? [hansen, alex, { ...hansen, userId: 'disabled', status: 'disabled' }])
    if (path === '/haas/v1/admin/audit') return ok(state.audits ?? [])
    const input = options?.body ? JSON.parse(String(options.body)) : undefined
    if (path === '/haas/v1/admin/connector-configuration') return reads(input)
    if (path === '/haas/v1/admin/connector-activation-state') return state.activation ? state.activation(input) : ok(activation(input.targetUserId))
    if (path === '/haas/v1/admin/connector-command-state') return metadata(input)
    if (path === '/haas/v1/admin/connector-commands') return writes(input)
    if (String(path).endsWith('/resolve')) {
      state.command = { ...state.command, outcome: 'superseded', confirmation: { commandId: state.command.commandId, outcome: 'superseded', effect: 'unknown', cellRevision, configuration: configuration(), reason: input.reason } }
      return ok(state.command)
    }
    throw Error('Unexpected connector component route')
  })
  const api = new EnterpriseApi(transport as typeof fetch); disposers.push(() => api.dispose())
  return { api, state, writes, reads, metadata, transport }
}
function intent() { return { targetUserId: hansen.userId, expectedCellRevision: cellRevision, expectedConfigurationRevision: configRevision, change: { kind: 'upsert', entryId: 'sales' }, reason: '配置业务连接器', confirmed: true } }
function command(input = intent(), outcome = 'saved-disabled') {
  const id = crypto.randomUUID()
  return { commandId: id, targetUserId: input.targetUserId, outcome, intent: { ...input, change: { kind: input.change.kind, entryId: input.change.entryId } },
    historicalReceipt: true, runtimeGrant: false, confirmation: outcome === 'unconfirmed' ? null : { commandId: id, outcome, configuration: configuration(), activation: 'not-authorized' } }
}
async function choose() {
  fireEvent.change(await screen.findByRole('combobox', { name: '成员' }), { target: { value: hansen.userId } })
  fireEvent.change(screen.getByRole('textbox', { name: '核对原因' }), { target: { value: '核对业务连接器' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /我确认读取所选成员/ }))
}
async function read() {
  fireEvent.click(screen.getByRole('button', { name: '记录原因并读取连接器配置' }))
  await screen.findByText('未发现该成员的连接器配置操作记录。')
}
async function draft(name = '新增停用配置') {
  fireEvent.click(await screen.findByRole('button', { name }))
  const form = screen.getByRole('form', { name: '确认连接器配置变更' })
  fireEvent.change(within(form).getByRole('textbox', { name: '变更原因' }), { target: { value: '配置业务连接器' } })
  return form
}
function confirm(form: HTMLElement) { fireEvent.click(within(form).getByRole('checkbox', { name: /我确认所选成员、完整变更/ })) }
function http(form: HTMLElement) {
  const ui = within(form)
  if (!(ui.getByLabelText('条目编号') as HTMLInputElement).readOnly) fireEvent.change(ui.getByLabelText('条目编号'), { target: { value: 'support' } })
  fireEvent.change(ui.getByLabelText('服务名称'), { target: { value: 'support' } })
  fireEvent.change(ui.getByLabelText('网络服务地址'), { target: { value: 'https://example.invalid/mcp' } })
  fireEvent.click(ui.getByRole('button', { name: '添加请求头' }))
  fireEvent.change(ui.getByLabelText('请求头名称 1'), { target: { value: 'Authorization' } })
  fireEvent.change(ui.getByLabelText('请求头值 1'), { target: { value: 'SYNTHETIC_SECRET' } })
}
describe('native Settings connector management component, not Browser E2E', () => {
  it('reads lifecycle only after confirmation, separates intent/gate/provider/connection and does not create an edit or grant',async()=>{
    const f=fixture();render(<MemberConnectorState api={f.api}/>);await screen.findByRole('combobox',{name:'成员'})
    expect(screen.getByRole('button',{name:'记录原因并读取启停状态'})).toBeDisabled();expect(f.transport).toHaveBeenCalledTimes(1)
    await choose();fireEvent.click(screen.getByRole('button',{name:'记录原因并读取启停状态'}))
    const result=await screen.findByRole('region',{name:'连接器启停观察'})
    expect(within(result).getByText('已保存启用意图 · 原生授权门禁存在')).toBeInTheDocument()
    expect(within(result).getByText('原生插件状态：已启动；外部连接未探测。')).toBeInTheDocument()
    expect(within(result).getByText(/不是当前数据库批准或使用授权/)).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'新增停用配置'})).toBeNull();expect(f.reads).not.toHaveBeenCalled();expect(f.writes).not.toHaveBeenCalled();expect(f.metadata).not.toHaveBeenCalled()
    expect(result.parentElement).toHaveFocus()
    fireEvent.keyDown(result,{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('region',{name:'连接器启停观察'})).toBeNull())
    expect(screen.getByRole('textbox',{name:'核对原因'})).toHaveFocus()
  })
  it('clears observed lifecycle on member/reason changes and discards a canceled late response',async()=>{
    const f=fixture();let release!:(r:Response)=>void;f.state.activation=()=>new Promise(resolve=>{release=resolve})
    render(<MemberConnectorState api={f.api}/>);await choose();fireEvent.click(screen.getByRole('button',{name:'记录原因并读取启停状态'}))
    await waitFor(()=>expect(release).toBeTypeOf('function'));expect(screen.getByRole('combobox',{name:'成员'})).toBeDisabled()
    fireEvent.click(screen.getByRole('button',{name:'关闭配置／停止读取'}))
    fireEvent.change(screen.getByRole('combobox',{name:'成员'}),{target:{value:alex.userId}})
    await act(async()=>release(ok(activation())));expect(screen.queryByRole('region',{name:'连接器启停观察'})).toBeNull()
    f.state.activation=async input=>ok({...activation(input.targetUserId),lifecycle:{...activation().lifecycle,entries:[{...activation().lifecycle.entries[0],authority:'absent',phase:'pending'}]}})
    fireEvent.click(screen.getByRole('checkbox',{name:/我确认读取所选成员/}));fireEvent.click(screen.getByRole('button',{name:'记录原因并读取启停状态'}))
    expect(await screen.findByText('已保存启用意图 · 原生授权门禁未建立')).toBeInTheDocument()
    expect(screen.getByText('原生插件状态：等待依赖；外部连接未探测。')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox',{name:'核对原因'}),{target:{value:'重新核对状态'}})
    expect(screen.queryByRole('region',{name:'连接器启停观察'})).toBeNull();expect(screen.getByRole('button',{name:'记录原因并读取启停状态'})).toBeDisabled()
  })
  it('contains malformed lifecycle claims and displays empty and legacy states without inventing permission',async()=>{
    const valid=activation(),e=valid.lifecycle.entries[0]!
    for(const bad of [{...valid,targetUserId:alex.userId},{...valid,runtimeGrant:true},{...valid,headers:'PRIVATE'},
      {...valid,lifecycle:{...valid.lifecycle,entries:[e,e]}},{...valid,lifecycle:{...valid.lifecycle,entries:[{...e,connection:'connected'}]}},
      {...valid,lifecycle:{...valid.lifecycle,entries:[{...e,configurationVersion:null}]}},{...valid,lifecycle:{...valid.lifecycle,entries:[{...e,phase:6}]}},
      {...valid,lifecycle:{...valid.lifecycle,entries:[{...e,enabled:false}]}},{...valid,lifecycle:{...valid.lifecycle,entries:[{...e,url:'PRIVATE'}]}}])expect(()=>connectorActivationSnapshot(bad,hansen.userId)).toThrow()
    const f=fixture();f.state.activation=async()=>ok({...valid,runtimeGrant:true});render(<MemberConnectorState api={f.api}/>);await choose()
    fireEvent.click(screen.getByRole('button',{name:'记录原因并读取启停状态'}));await screen.findByRole('alert');expect(screen.queryByRole('region',{name:'连接器启停观察'})).toBeNull()
    f.state.activation=async()=>ok({...valid,lifecycle:{...valid.lifecycle,entries:[]}})
    fireEvent.click(screen.getByRole('button',{name:'记录原因并读取启停状态'}));await screen.findByText('当前没有已保存的受管连接器配置。')
    f.state.activation=async()=>ok({...valid,lifecycle:{...valid.lifecycle,entries:[{...e,enabled:false,authority:'absent',phase:null,configurationVersion:null}]}})
    fireEvent.click(screen.getByRole('button',{name:'记录原因并读取启停状态'}));await screen.findByText('旧配置未版本化，须显式完整替换后才能批准。')
    expect(screen.getByText('原生插件状态：未创建；外部连接未探测。')).toBeInTheDocument()
  })
  it('requires active member, reason and confirmation, without prefetching configuration or exposing activation', async () => {
    const f = fixture(); render(<MemberConnectorState api={f.api} />)
    await screen.findByRole('combobox', { name: '成员' })
    expect(f.reads).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: '记录原因并读取连接器配置' })).toBeDisabled()
    await choose(); await read()
    expect(f.reads).toHaveBeenCalledWith({ targetUserId: hansen.userId, reason: '核对业务连接器', confirmed: true })
    expect(screen.getByText('远程网络连接 · 已停用，未获准使用')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '启用' })).toBeNull(); expect(f.writes).not.toHaveBeenCalled()
  })
  it('saves a disabled HTTP configuration exactly once and clears detached secret inputs without retaining them in receipts or storage', async () => {
    const f = fixture(), storage = vi.spyOn(Storage.prototype, 'setItem'); render(<MemberConnectorState api={f.api} />); await choose(); await read()
    const form = await draft(); http(form)
    const secret = within(form).getByLabelText('请求头值 1') as HTMLInputElement
    expect(within(form).getByRole('button', { name: '确认连接器变更' })).toBeDisabled(); confirm(form); fireEvent.submit(form)
    await screen.findByText('原生停用配置变更已保存；没有启用连接器或授权使用。')
    expect(f.writes).toHaveBeenCalledTimes(1); expect(f.writes.mock.calls[0]![0]).toMatchObject({ targetUserId: hansen.userId, expectedCellRevision: cellRevision, expectedConfigurationRevision: configRevision,
      change: { kind: 'upsert', entryId: 'support', configuration: { transport: 'streamable-http', headers: { Authorization: 'SYNTHETIC_SECRET' }, reconnect: { enabled: false, maxAttempts: 3 } } } })
    expect(secret.value).toBe(''); expect(storage).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain('SYNTHETIC_SECRET')
    expect(screen.getByRole('button', { name: '新增停用配置' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '读取连接器操作记录' })); await waitFor(() => expect(f.metadata).toHaveBeenCalledTimes(2))
    expect(f.writes).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: '新增停用配置' })).toBeDisabled()
  })
  it('saves stdio using explicit command, per-line args, absolute cwd and masked environment with bounded retry fields', async () => {
    const f = fixture(); render(<MemberConnectorState api={f.api} />); await choose(); await read(); const form = await draft(), ui = within(form)
    fireEvent.change(ui.getByLabelText('条目编号'), { target: { value: 'local' } }); fireEvent.change(ui.getByLabelText('服务名称'), { target: { value: 'local' } })
    fireEvent.change(ui.getByRole('combobox', { name: '连接方式' }), { target: { value: 'stdio' } })
    fireEvent.change(ui.getByLabelText('启动命令'), { target: { value: '/NOT_EXECUTED' } })
    fireEvent.change(ui.getByLabelText('启动参数（每行一个）'), { target: { value: '--mode\nread only' } })
    fireEvent.change(ui.getByLabelText('工作目录（受管单元内的绝对路径）'), { target: { value: '/NOT_OPENED' } })
    fireEvent.click(ui.getByRole('button', { name: '添加环境变量' })); fireEvent.change(ui.getByLabelText('环境变量名称 1'), { target: { value: 'API_KEY' } }); fireEvent.change(ui.getByLabelText('环境变量值 1'), { target: { value: 'SYNTHETIC_ENV' } })
    confirm(form); fireEvent.submit(form); await screen.findByText('原生停用配置变更已保存；没有启用连接器或授权使用。')
    expect(f.writes.mock.calls[0]![0].change.configuration).toMatchObject({ transport: 'stdio', command: '/NOT_EXECUTED', args: ['--mode','read only'], cwd: '/NOT_OPENED', env: { API_KEY: 'SYNTHETIC_ENV' } })
  })
  it('requires full replacement and exact deletion target with independent explicit confirmation', async () => {
    const f = fixture(); render(<MemberConnectorState api={f.api} />); await choose(); await read()
    let form = await draft('替换配置 sales')
    expect(within(form).getByLabelText('条目编号')).toHaveAttribute('readonly'); expect(within(form).getByLabelText('网络服务地址')).toHaveValue('')
    expect(screen.getByText(/未填写的可选项会被清除/)).toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: '放弃未提交配置' }))
    expect(screen.getByRole('button', { name: '替换配置 sales' })).toHaveFocus()
    form = await draft('删除配置 sales'); expect(screen.getByText(/不删除会话、智能体或其他连接器/)).toBeInTheDocument()
    confirm(form); fireEvent.submit(form); await screen.findByText('原生停用配置变更已保存；没有启用连接器或授权使用。')
    expect(f.writes.mock.calls[0]![0].change).toEqual({ kind: 'remove', entryId: 'sales' })
  })
  it('clears private values on Escape, removal, transport change and unmount, restoring focus after cancel', async () => {
    const f = fixture(), editing = vi.fn(), rendered = render(<MemberConnectorState api={f.api} onEditing={editing} />); await choose(); await read()
    let form = await draft(); http(form); const first = within(form).getByLabelText('请求头值 1') as HTMLInputElement
    fireEvent.click(within(form).getByRole('button', { name: '移除请求头 1' })); expect(first.value).toBe('')
    http(form); const second = within(form).getByLabelText('请求头值 1') as HTMLInputElement
    fireEvent.change(within(form).getByRole('combobox', { name: '连接方式' }), { target: { value: 'stdio' } }); expect(second.value).toBe('')
    fireEvent.keyDown(form, { key: 'Escape' }); expect(screen.queryByRole('form', { name: '确认连接器配置变更' })).toBeNull()
    expect(screen.getByRole('button', { name: '新增停用配置' })).toHaveFocus(); expect(editing).toHaveBeenLastCalledWith(false)
    form = await draft(); http(form); const third = within(form).getByLabelText('请求头值 1') as HTMLInputElement
    rendered.unmount(); expect(third.value).toBe(''); expect(editing).toHaveBeenLastCalledWith(false); expect(f.writes).not.toHaveBeenCalled()
  })
  it('invalidates confirmation whenever config changes and rejects duplicate headers, credential URLs and oversize payload before submission', async () => {
    const f = fixture(); render(<MemberConnectorState api={f.api} />); await choose(); await read(); const form = await draft(); http(form)
    confirm(form); fireEvent.change(within(form).getByLabelText('服务名称'), { target: { value: 'changed' } })
    expect(within(form).getByRole('checkbox', { name: /我确认所选成员、完整变更/ })).not.toBeChecked()
    fireEvent.change(within(form).getByLabelText('网络服务地址'), { target: { value: 'https://user:password@example.invalid/' } }); confirm(form); fireEvent.submit(form)
    await screen.findByRole('alert'); expect(f.writes).not.toHaveBeenCalled()
    fireEvent.change(within(form).getByLabelText('网络服务地址'), { target: { value: 'https://example.invalid/' } })
    fireEvent.click(within(form).getByRole('button', { name: '添加请求头' })); fireEvent.change(within(form).getByLabelText('请求头名称 2'), { target: { value: 'authorization' } }); confirm(form); fireEvent.submit(form)
    await screen.findByText('请求头或环境变量名称重复、格式无效或超出限制'); expect(f.writes).not.toHaveBeenCalled()
    fireEvent.click(within(form).getByRole('button', { name: '移除请求头 2' }))
    fireEvent.change(within(form).getByLabelText('网络服务地址'), { target: { value: 'https://example.invalid/' + '界'.repeat(7000) } }); confirm(form); fireEvent.submit(form)
    await screen.findByText(/配置超过本次提交的16 KiB/); expect(f.writes).not.toHaveBeenCalled()
  })
  it('keeps a lost response uncertain, clears submitted secrets and only reads the receipt without retrying', async () => {
    const f = fixture(); f.state.write = async input => { f.state.command = command(input, 'unconfirmed'); throw Error('Synthetic lost response') }
    render(<MemberConnectorState api={f.api} />); await choose(); await read(); const form = await draft(); http(form); confirm(form); fireEvent.submit(form)
    await screen.findByRole('alert'); expect(screen.queryByRole('form', { name: '确认连接器配置变更' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '读取连接器操作记录' }))
    await screen.findByText('操作结果未确认，可能已经保存。不要重复提交或更换请求标识。')
    expect(f.writes).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: '新增停用配置' })).toBeDisabled()
  })
  it('stops waiting without a retry, ignores late write success and retains explicit uncertainty', async () => {
    const f = fixture(); let release!: (response: Response) => void
    f.state.write = () => new Promise(resolve => { release = resolve })
    render(<MemberConnectorState api={f.api} />); await choose(); await read(); const form = await draft(); http(form); confirm(form); fireEvent.submit(form)
    await waitFor(() => expect(f.writes).toHaveBeenCalledTimes(1)); fireEvent.click(screen.getByRole('button', { name: '停止等待，结果待确认' }))
    await act(async () => { release(ok(command(f.writes.mock.calls[0]![0]))); await Promise.resolve() })
    expect(screen.getByText(/已停止等待，未撤销操作/)).toBeInTheDocument(); expect(screen.queryByText('原生停用配置变更已保存；没有启用连接器或授权使用。')).toBeNull()
    expect(f.writes).toHaveBeenCalledTimes(1)
  })
  it.each(['unchanged','conflict'])('distinguishes %s from activation or successful use and requires a fresh configuration read', async outcome => {
    const f = fixture(); f.state.write = async input => ok(command(input, outcome))
    render(<MemberConnectorState api={f.api} />); await choose(); await read(); const form = await draft('删除配置 sales'); confirm(form); fireEvent.submit(form)
    await screen.findByText(outcome === 'unchanged' ? '原生配置与提交内容一致，本次没有改写；仍未启用或授权。' : '原生配置修订冲突，本次未写入；请重新读取。')
    expect(screen.getByRole('button', { name: '删除配置 sales' })).toBeDisabled()
  })
  it('does not reuse content after a member switch or late cancelled metadata read', async () => {
    const f = fixture(); render(<MemberConnectorState api={f.api} />); await choose(); await read()
    fireEvent.change(screen.getByRole('combobox', { name: '成员' }), { target: { value: alex.userId } })
    expect(screen.queryByText('sales')).toBeNull(); expect(screen.getByRole('checkbox', { name: /我确认读取所选成员/ })).not.toBeChecked()
    let release!: (response: Response) => void; f.state.snapshot = () => new Promise(resolve => { release = resolve })
    fireEvent.click(screen.getByRole('checkbox', { name: /我确认读取所选成员/ })); fireEvent.click(screen.getByRole('button', { name: '记录原因并读取连接器配置' }))
    await waitFor(() => expect(f.reads).toHaveBeenCalledTimes(2)); fireEvent.click(screen.getByRole('button', { name: '关闭配置／停止读取' }))
    await act(async () => { release(ok(snapshot(alex.userId))); await Promise.resolve() })
    expect(screen.queryByText('sales')).toBeNull(); expect(screen.getByRole('textbox', { name: '核对原因' })).toHaveFocus()
  })
  it('rejects target mismatch, extra raw configuration, forged activation, duplicate ids and mismatched receipts', () => {
    const valid = snapshot()
    for (const bad of [{ ...valid, targetUserId: alex.userId }, { ...valid, secret: 'PRIVATE' }, { ...valid, activation: 'approved' },
      { ...valid, configuration: { ...valid.configuration, entries: [{ ...entry, url: 'PRIVATE' }] } }, { ...valid, configuration: { ...valid.configuration, entries: [entry,entry] } }]) expect(() => connectorSnapshot(bad, hansen.userId)).toThrow()
    const receipt = command()
    for (const bad of [{ ...receipt, runtimeGrant: true }, { ...receipt, confirmation: { ...receipt.confirmation, secret: 'PRIVATE' } },
      { ...receipt, intent: { ...receipt.intent, change: { ...receipt.intent.change, configuration: 'PRIVATE' } } }, { ...receipt, outcome: 'unconfirmed' }]) expect(() => connectorCommand(bad, hansen.userId)).toThrow()
  })
  it('shows empty members, preserves permission failures as errors and never turns either into success', async () => {
    const f = fixture(); f.state.members = []; const rendered = render(<MemberConnectorState api={f.api} />)
    await screen.findByText('暂无使用人员。'); expect(f.reads).not.toHaveBeenCalled(); rendered.unmount()
    const g = fixture(); g.state.snapshot = async () => new Response(JSON.stringify({ title: '需要管理员权限' }), { status: 403 })
    render(<MemberConnectorState api={g.api} />); await choose(); fireEvent.click(screen.getByRole('button', { name: '记录原因并读取连接器配置' }))
    await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: '新增停用配置' })).toBeNull()
  })
  it('recovers historical unknown commands only after a different cell is observed and never resends their configuration', async () => {
    const f = fixture(); f.state.command = command(intent(), 'unconfirmed'); f.state.command.intent.expectedCellRevision = 'e0000000-0000-4000-8000-000000000005'
    render(<MemberConnectorState api={f.api} />); await choose(); fireEvent.click(screen.getByRole('button', { name: '记录原因并读取连接器配置' }))
    await screen.findByText('操作结果未确认，可能已经保存。不要重复提交或更换请求标识。')
    const form = await draft('核验替代环境并结束连接器旧操作追认'); confirm(form); fireEvent.submit(form)
    await screen.findByText('旧操作已结束追认，但历史效果仍未知，没有重发或证明回退。'); expect(f.writes).not.toHaveBeenCalled()
  })
  it('contributes in existing administrator Settings, locks navigation during drafts and clears secrets on role loss', async () => {
    const f = fixture(), session = new EnterpriseSession(f.api); disposers.push(() => session.dispose()); await session.refresh()
    render(<AdminSection session={session} />)
    fireEvent.click(screen.getByRole('button', { name: '成员连接器配置' })); await choose(); await read(); const form = await draft(); http(form)
    const secret = within(form).getByLabelText('请求头值 1') as HTMLInputElement
    expect(screen.getByRole('button', { name: '操作审计' })).toBeDisabled(); expect(screen.getByRole('combobox', { name: '成员' })).toBeDisabled()
    f.state.account = hansen; await act(async () => { await session.refresh() })
    expect(secret.value).toBe(''); expect(screen.getByText('此操作仅限管理员。')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: '成员连接器配置' })).toBeNull()
  })
  it('renders connector audit outcomes as disabled configuration changes, retaining request correlation', async () => {
    const f = fixture(); f.state.audits = [{ event_id: 'event-connector', action: 'runtime.connector.confirmed', outcome: 'succeeded', occurred_at: '2026-09-23T00:00:00Z', actor_user_id: admin.userId, target_id: hansen.userId,
      reason: JSON.stringify({ commandId: crypto.randomUUID(), outcome: 'saved-disabled', reason: '连接器保存核对' }), request_id: 'connector-request' }]
    const session = new EnterpriseSession(f.api); disposers.push(() => session.dispose()); await session.refresh(); render(<AdminSection session={session} />)
    fireEvent.click(screen.getByRole('button', { name: '操作审计' })); await screen.findByText('记录连接器配置确认结果')
    expect(screen.getByText(/原生停用配置变更已保存，没有启用或授予使用权限/)).toBeInTheDocument(); expect(screen.getByText(/connector-request/)).toBeInTheDocument()
  })
  it('admits only exact new versioned routes and does not allow arbitrary connector/native operations', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => ok({})), api = new EnterpriseApi(transport); disposers.push(() => api.dispose())
    const id = crypto.randomUUID()
    for (const path of ['/admin/connector-configuration','/admin/connector-command-state','/admin/connector-commands',`/admin/connector-commands/${id}/resolve`]) await api.request(path, 'POST', {}, crypto.randomUUID())
    await api.request(`/admin/connector-commands/${id}`)
    expect(transport).toHaveBeenCalledTimes(5)
    for (const [path, method] of [['/admin/connector-configuration','GET'],['/admin/connector-commands','GET'],[`/admin/connector-commands/${id}/activate`,'POST'],['/native/connector.configure','POST']]) await expect(api.request(path!, method!, {}, crypto.randomUUID())).rejects.toThrow('Unsupported')
    expect(transport).toHaveBeenCalledTimes(5)
  })
})
