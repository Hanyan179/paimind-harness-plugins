import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseApi, EnterpriseSession } from '../src/client/api.js'
import { AdminSection } from '../src/client/index.js'
import { MemberRuntimeManagement } from '../src/client/runtime-management.js'
import { resourcePolicy, runtimeState, recoveryReceipt } from '../src/client/runtime-view.js'

const hansen = { userId: 'b0000000-0000-4000-8000-000000000002', tenantId: 'component', username: 'hansen', displayName: 'Hansen', role: 'member', status: 'active' }
const alex = { ...hansen, userId: 'c0000000-0000-4000-8000-000000000003', username: 'alex', displayName: 'Alex' }
const admin = { ...hansen, userId: 'a0000000-0000-4000-8000-000000000001', role: 'admin', username: 'morgan', displayName: 'Morgan' }
const revision = 'd0000000-0000-4000-8000-000000000004', requestId = 'e0000000-0000-4000-8000-000000000005'
const policy = { revision: 0, desiredState: 'running', cpuMillis: 1000, memoryMiB: 1024, pidsLimit: 256 }
const snapshot = (target = hansen.userId): any => ({ targetUserId: target, targetName: target === hansen.userId ? 'Hansen' : 'Alex', desired: { ...policy },
  enforcement: 'unconfirmed', persistentStorageQuota: 'not-enforced', runtime: { cellId: revision, cellRevision: revision, bindingState: 'suspended', leaseValid: false, policyMatches: true, observed: { ...policy }, observedAt: '2026-09-24T00:00:00Z', physicalStop: 'not-observed' } })
const receipt = (target = hansen.userId, outcome = 'queued'): any => ({ requestId, targetUserId: target, outcome, result: null, acceptedResourceRevision: 0, physicalStop: 'operator-must-verify' })
const ok = (data: unknown) => new Response(JSON.stringify({ data }))
const disposers: Array<() => void> = []
afterEach(() => { cleanup(); for (const close of disposers.splice(0).reverse()) close(); vi.restoreAllMocks() })
function fixture() {
  const state: { members?: any[]; account?: any; value?: any; command?: any; read?: (input: any) => Promise<Response>; write?: (input: any) => Promise<Response>; audit?: any[] } = {}
  const reads = vi.fn(async (input: any) => state.read ? state.read(input) : ok(state.value ?? snapshot(input.targetUserId)))
  const metadata = vi.fn(async (input: any) => ok({ targetUserId: input.targetUserId, request: state.command ?? null }))
  const writes = vi.fn(async (path: string, input: any) => {
    if (state.write) return state.write(input)
    if (path.endsWith('runtime-recovery-requests')) { state.command = receipt(input.targetUserId); return ok(state.command) }
    return ok({ targetUserId: input.targetUserId, policy: { revision: input.expectedRevision + 1, desiredState: input.desiredState, cpuMillis: input.cpuMillis, memoryMiB: input.memoryMiB, pidsLimit: input.pidsLimit },
      outcome: 'intent-recorded', enforcement: 'unconfirmed', automaticRestart: false, persistentStorageQuota: 'not-enforced' })
  })
  const transport = vi.fn(async (path: string | URL | Request, options?: RequestInit) => {
    if (path === '/haas/v1/auth/me') return ok(state.account ?? admin)
    if (path === '/haas/v1/admin/members') return ok(state.members ?? [hansen, alex])
    if (path === '/haas/v1/admin/audit') return ok(state.audit ?? [])
    const input = options?.body ? JSON.parse(String(options.body)) : undefined
    if (path === '/haas/v1/admin/runtime-state') return reads(input)
    if (path === '/haas/v1/admin/runtime-recovery-state') return metadata(input)
    if (String(path).endsWith('runtime-resource-policy') || String(path).endsWith('runtime-recovery-requests')) return writes(String(path), input)
    throw Error('Unexpected runtime test route')
  })
  const api = new EnterpriseApi(transport as typeof fetch); disposers.push(() => api.dispose())
  return { api, state, reads, metadata, writes, transport }
}
async function choose() {
  await screen.findByRole('option', { name: 'Hansen' })
  fireEvent.change(screen.getByRole('combobox', { name: '成员' }), { target: { value: hansen.userId } })
  fireEvent.change(screen.getByLabelText('读取原因'), { target: { value: '核对业务成员资源' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /我确认读取该成员/ }))
}
async function read() { fireEvent.click(screen.getByRole('button', { name: '记录原因并读取运行状态' })); await screen.findByText('Hansen 的运行观察') }
function confirm(form: HTMLElement) {
  fireEvent.change(within(form).getByLabelText('操作原因'), { target: { value: '明确调整业务成员资源' } })
  fireEvent.click(within(form).getByRole('checkbox', { name: /我确认以上影响/ }))
}

describe('HAAS-04 native settings runtime management component (not Browser E2E)', () => {
  it('does not read or write before explicit target, reason and confirmation; distinguishes intent, observation and absent receipts', async () => {
    const f = fixture(); render(<MemberRuntimeManagement api={f.api} />); await screen.findByRole('combobox', { name: '成员' })
    expect(f.reads).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: '记录原因并读取运行状态' })).toBeDisabled()
    await choose(); await read(); expect(f.reads).toHaveBeenCalledWith({ targetUserId: hansen.userId, reason: '核对业务成员资源', confirmed: true })
    expect(f.metadata).toHaveBeenCalledTimes(1); expect(f.writes).not.toHaveBeenCalled(); expect(screen.getByText('尚未确认资源限制生效。')).toBeInTheDocument()
    expect(screen.getByText('没有恢复请求记录。')).toBeInTheDocument(); expect(screen.getByText(/持久存储配额尚未实施/)).toBeInTheDocument()
  })
  it('saves bounded policy once with exact revision, locks target and requires fresh reads before another mutation', async () => {
    const f = fixture(), storage = vi.spyOn(Storage.prototype, 'setItem'); render(<MemberRuntimeManagement api={f.api} />); await choose(); await read()
    fireEvent.click(screen.getByRole('button', { name: '调整资源与目标状态' })); const form = screen.getByRole('form', { name: '调整成员资源' })
    expect(screen.getByRole('combobox', { name: '成员' })).toBeDisabled(); expect(within(form).getByRole('button', { name: '确认提交' })).toBeDisabled()
    fireEvent.change(within(form).getByLabelText('处理器（毫核）'), { target: { value: '500' } }); confirm(form); fireEvent.submit(form); fireEvent.submit(form)
    await screen.findByText(/资源意图已记录，旧运行准入将失效/)
    expect(f.writes).toHaveBeenCalledTimes(1); expect(f.writes.mock.calls[0]![1]).toMatchObject({ expectedRevision: 0, cpuMillis: 500, memoryMiB: 1024, pidsLimit: 256, confirmed: true })
    expect(screen.getByRole('button', { name: '调整资源与目标状态' })).toBeDisabled(); expect(screen.getByRole('button', { name: '请求恢复已停止单元' })).toBeDisabled()
    expect(storage).not.toHaveBeenCalled()
  })
  it('queues explicit recovery only once; reads subsequent execution/unknown states without claiming success or retrying', async () => {
    const f = fixture(); render(<MemberRuntimeManagement api={f.api} />); await choose(); await read()
    fireEvent.click(screen.getByRole('button', { name: '请求恢复已停止单元' })); const form = screen.getByRole('form', { name: '请求成员恢复' }); confirm(form); fireEvent.submit(form)
    await screen.findAllByText(/请求已排队，尚未恢复/); expect(f.writes).toHaveBeenCalledTimes(1)
    expect(f.writes.mock.calls[0]![1]).toMatchObject({ expectedCellRevision: revision, expectedResourceRevision: 0, targetUserId: hansen.userId })
    f.state.command = receipt(hansen.userId, 'executing'); await read(); await screen.findByText(/操作者正在恢复/)
    expect(screen.getByRole('button', { name: '请求恢复已停止单元' })).toBeDisabled()
    f.state.command = { ...receipt(hansen.userId, 'unconfirmed'), result: { effect: 'unknown', retry: 'operator-inspection-required' } }; await read(); await screen.findByText(/恢复效果未知/)
    expect(screen.getByRole('button', { name: '请求恢复已停止单元' })).toBeDisabled(); expect(f.writes).toHaveBeenCalledTimes(1)
  })
  it.each(['running', 'suspended-intent', 'no-binding', 'disabled-member'])('does not request recovery with %s preconditions', async kind => {
    const f = fixture(); f.state.value = snapshot()
    if (kind === 'running') { f.state.value.runtime.bindingState = 'ready'; f.state.value.runtime.leaseValid = true }
    if (kind === 'suspended-intent') f.state.value.desired.desiredState = 'suspended'
    if (kind === 'no-binding') f.state.value.runtime = null
    if (kind === 'disabled-member') f.state.members = [{ ...hansen, status: 'disabled' }, alex]
    render(<MemberRuntimeManagement api={f.api} />)
    if (kind === 'disabled-member') {
      await screen.findByRole('option', { name: 'Hansen（已停用，仅可读取）' }); fireEvent.change(screen.getByLabelText('成员'), { target: { value: hansen.userId } })
      fireEvent.change(screen.getByLabelText('读取原因'), { target: { value: '读取停用成员状态' } }); fireEvent.click(screen.getByRole('checkbox'))
    } else await choose()
    await read(); expect(screen.getByRole('button', { name: '请求恢复已停止单元' })).toBeDisabled(); expect(f.writes).not.toHaveBeenCalled()
  })
  it('Escape cancels drafts, returns focus, unlocks parent navigation and does not submit', async () => {
    const f = fixture(), session = new EnterpriseSession(f.api); disposers.push(() => session.dispose()); await session.refresh(); render(<AdminSection session={session} />)
    fireEvent.click(screen.getByRole('button', { name: '成员配额与运行' })); await choose(); await read()
    const button = screen.getByRole('button', { name: '调整资源与目标状态' }); fireEvent.click(button)
    expect(screen.getByRole('button', { name: '操作审计' })).toBeDisabled(); expect(screen.getByLabelText('操作原因')).toHaveFocus()
    fireEvent.keyDown(screen.getByLabelText('操作原因'), { key: 'Escape' }); await waitFor(() => expect(button).toHaveFocus())
    expect(screen.getByRole('button', { name: '操作审计' })).toBeEnabled(); expect(f.writes).not.toHaveBeenCalled()
  })
  it('lost mutation response and stopping the wait never retry, accept a late response or claim cancellation of server effects', async () => {
    const f = fixture(); let resolve!: (value: Response) => void
    f.state.write = () => new Promise(done => { resolve = done }); render(<MemberRuntimeManagement api={f.api} />); await choose(); await read()
    fireEvent.click(screen.getByRole('button', { name: '请求恢复已停止单元' })); const form = screen.getByRole('form', { name: '请求成员恢复' }); confirm(form); fireEvent.submit(form)
    fireEvent.click(screen.getByRole('button', { name: '停止等待' })); expect(screen.getByRole('alert')).toHaveTextContent('这不是撤销')
    await act(async () => resolve(ok(receipt()))); expect(screen.queryByText(/请求已排队/)).toBeNull(); expect(f.writes).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '请求恢复已停止单元' })).toBeDisabled()
  })
  it('rejects mismatched responses and late reads after cancellation or unmount', async () => {
    const f = fixture(); f.state.value = snapshot(alex.userId); const rendered = render(<MemberRuntimeManagement api={f.api} />); await choose()
    fireEvent.click(screen.getByRole('button', { name: '记录原因并读取运行状态' })); await screen.findByRole('alert'); expect(screen.queryByText('Alex 的运行观察')).toBeNull()
    let resolve!: (value: Response) => void; f.state.read = () => new Promise(done => { resolve = done })
    fireEvent.click(screen.getByRole('button', { name: '记录原因并读取运行状态' })); fireEvent.click(screen.getByRole('button', { name: '停止等待' }))
    fireEvent.change(screen.getByLabelText('成员'), { target: { value: alex.userId } }); await act(async () => resolve(ok(snapshot())))
    expect(screen.queryByText('Hansen 的运行观察')).toBeNull(); rendered.unmount(); expect(f.writes).not.toHaveBeenCalled()
  })
  it('shows empty/read failure honestly and never exposes management entry to ordinary members', async () => {
    const f = fixture(); f.state.members = []; const rendered = render(<MemberRuntimeManagement api={f.api} />); await screen.findByText(/暂无使用人员/); rendered.unmount()
    f.state.account = hansen; const session = new EnterpriseSession(f.api); disposers.push(() => session.dispose()); await session.refresh(); render(<AdminSection session={session} />)
    expect(screen.queryByRole('button', { name: '成员配额与运行' })).toBeNull(); expect(screen.getByRole('alert')).toHaveTextContent('仅限管理员')
  })
  it('validates projections, drops private extras and rejects contradictory current success or altered recovery outcomes', () => {
    expect(() => resourcePolicy({ ...policy, memoryMiB: 2000 })).toThrow()
    expect(() => runtimeState({ ...snapshot(), enforcement: 'operator-observed' }, hansen.userId)).toThrow()
    expect(() => recoveryReceipt({ ...receipt(), outcome: 'applied' }, hansen.userId)).toThrow()
    expect(() => recoveryReceipt({ ...receipt(), targetUserId: alex.userId }, hansen.userId)).toThrow()
    const privateValue = { ...snapshot(), containerId: 'PRIVATE', transportKey: 'PRIVATE' }
    expect(JSON.stringify(runtimeState(privateValue, hansen.userId))).not.toContain('PRIVATE')
    const valid = { ...receipt(), outcome: 'applied', result: { cellRevision: revision, resourceRevision: 0, effect: 'verified-replacement' } }
    expect(recoveryReceipt(valid, hansen.userId).outcome).toBe('applied')
  })
  it('allows only exact runtime API routes/methods and translates operator audit without hiding original event', async () => {
    const f = fixture()
    for (const path of ['/admin/runtime-state/extra', '/admin/runtime-recovery-requests/not-an-id', '/admin/runtime-resource-policy']) {
      await expect(f.api.request(path, 'GET')).rejects.toThrow('Unsupported enterprise plugin route')
    }
    f.state.audit = [{ event_id: requestId, action: 'runtime.recovery.confirmed', outcome: 'succeeded', occurred_at: '2026-09-24T00:00:00Z', actor_user_id: admin.userId, target_id: hansen.userId, reason: 'verified-replacement-and-gateway-acknowledgement', request_id: requestId }]
    const session = new EnterpriseSession(f.api); disposers.push(() => session.dispose()); await session.refresh(); render(<AdminSection session={session} />)
    fireEvent.click(screen.getByRole('button', { name: '操作审计' })); await screen.findByText('确认替代运行单元及网关'); expect(screen.getByText('原因：替代单元已核验且网关已确认')).toBeInTheDocument()
  })
  it('retains version conflict and malformed success as unknown until explicit read, without resending', async () => {
    const f = fixture(); f.state.write = async () => new Response(JSON.stringify({ title: '资源策略版本已变化' }), { status: 409 })
    render(<MemberRuntimeManagement api={f.api} />); await choose(); await read()
    fireEvent.click(screen.getByRole('button', { name: '调整资源与目标状态' })); const form = screen.getByRole('form', { name: '调整成员资源' }); confirm(form); fireEvent.submit(form)
    await screen.findByRole('alert'); expect(screen.getByRole('alert')).toHaveTextContent('资源策略版本已变化')
    expect(screen.getByRole('button', { name: '调整资源与目标状态' })).toBeDisabled(); expect(f.writes).toHaveBeenCalledTimes(1)
    await read(); await waitFor(() => expect(screen.getByRole('button', { name: '调整资源与目标状态' })).toBeEnabled())
    f.state.write = async () => ok(receipt(alex.userId))
    fireEvent.click(screen.getByRole('button', { name: '请求恢复已停止单元' })); const recovery = screen.getByRole('form', { name: '请求成员恢复' }); confirm(recovery); fireEvent.submit(recovery)
    await screen.findByRole('alert'); expect(screen.queryByText(/请求已排队/)).toBeNull(); expect(f.writes).toHaveBeenCalledTimes(2)
  })
})
