import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseApi, EnterpriseSession, type AccountView } from '../src/client/api.js'
import { createSkillCenterContribution } from '../src/client/member-skills.js'

const admin: AccountView = { userId: 'a0000000-0000-4000-8000-000000000001', tenantId: 'component-fixture', username: 'morgan', displayName: 'Morgan', role: 'admin', status: 'active' }
const source = { skillId: 'customer-notes', name: 'customer-notes', digest: 'sha256:' + 'a'.repeat(64) }
const receipt = { publicationId: 'c0000000-0000-4000-8000-000000000003', artifactId: 'd0000000-0000-4000-8000-000000000004',
  sourceUserId: admin.userId, name: source.name, digest: source.digest, status: 'pending', revision: 1, submissionReason: '给团队审核', reviewReason: null,
  archiveDigest: 'sha256:' + 'b'.repeat(64), archiveBytes: 2048, expandedBytes: 1024, entryCount: 4, runtimeGrant: false }
const response = (data: unknown) => new Response(JSON.stringify({ data }))
const disposers: (() => void)[] = []
afterEach(() => { cleanup(); for (const off of disposers.splice(0)) off(); vi.restoreAllMocks() })
async function fixture(account: AccountView = admin) {
  const state = { account }
  const writes = vi.fn(async (_init: RequestInit) => response(receipt))
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url) === '/haas/v1/auth/me') return response(state.account)
    expect(String(url)).toBe('/haas/v1/admin/skill-publications'); expect(init?.method).toBe('POST')
    return writes(init!)
  })
  const session = new EnterpriseSession(new EnterpriseApi(transport)); disposers.push(() => session.dispose()); await session.refresh()
  const Action = createSkillCenterContribution(session).SourceAction!
  const readSource = vi.fn(async (_id: string, _signal: AbortSignal) => source), onEditing = vi.fn(), off = vi.fn()
  let guard = () => true
  const registerCloseGuard = (fn: () => boolean) => { guard = fn; return off }
  const view = render(<Action selection={{ skillId: source.skillId, name: source.name }} disabled={false} {...{ readSource, onEditing, registerCloseGuard }} />)
  return { state, writes, transport, session, readSource, onEditing, off, view, guard: () => guard() }
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: '提交技能审核' }))
  await screen.findByRole('textbox', { name: '提交原因' })
}
function confirm() {
  fireEvent.change(screen.getByRole('textbox', { name: '提交原因' }), { target: { value: '给团队审核' } })
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.submit(screen.getByRole('form'))
}
describe('native administrator Skill source submission (components, NOT Browser E2E)', () => {
  it('reads the original directory version on demand, confirms exact source, and performs only the existing submission command', async () => {
    const f = await fixture(); expect(f.readSource).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled()
    await open(); expect(f.readSource).toHaveBeenCalledWith(source.skillId, expect.any(AbortSignal))
    expect(screen.getByRole('textbox')).toHaveFocus(); expect(screen.getByRole('button', { name: '确认提交技能' })).toBeDisabled()
    confirm(); await screen.findByText(/已确认提交 customer-notes/)
    expect(f.writes).toHaveBeenCalledOnce(); expect(JSON.parse(String(f.writes.mock.calls[0]![0].body))).toEqual({ skillId: source.skillId, expectedDigest: source.digest, reason: '给团队审核' })
    expect(f.transport.mock.calls.map(([url]) => String(url))).toEqual(['/haas/v1/auth/me', '/haas/v1/admin/skill-publications'])
    await waitFor(() => expect(f.onEditing).toHaveBeenLastCalledWith(false)); expect(screen.getByRole('button', { name: '提交技能审核' })).toHaveFocus()
  })
  it.each([{ role: 'member' as const, username: 'hansen', displayName: 'Hansen' }, { role: 'member' as const, username: 'alex', displayName: 'Alex' }, { status: 'disabled' as const }])('never offers or reads a source for an unqualified account: %j', async patch => {
    const f = await fixture({ ...admin, ...patch }); expect(screen.queryByRole('button')).toBeNull()
    expect(f.readSource).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled()
  })
  it('rejects a mismatched native source and lets the user explicitly retry without submitting', async () => {
    const f = await fixture(); f.readSource.mockResolvedValueOnce({ ...source, name: 'foreign' })
    fireEvent.click(screen.getByRole('button', { name: '提交技能审核' })); expect(await screen.findByRole('alert')).toHaveTextContent('来源或目录版本不一致')
    expect(screen.queryByRole('textbox')).toBeNull(); expect(f.writes).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '重新读取技能来源' })); await screen.findByRole('textbox')
    expect(f.readSource).toHaveBeenCalledTimes(2)
  })
  it('requires explicit discard, handles Escape, restores focus and releases the original close guard', async () => {
    const f = await fixture(); await open(); fireEvent.change(screen.getByRole('textbox'), { target: { value: '未提交原因' } })
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(screen.getByRole('form')).toBeInTheDocument(); expect(f.guard()).toBe(false)
    ask.mockReturnValue(true); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    await waitFor(() => expect(screen.getByRole('button', { name: '提交技能审核' })).toHaveFocus())
    expect(screen.queryByRole('form')).toBeNull(); expect(f.off).toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled()
  })
  it('guards duplicate activation and page unload, then ignores a late response after account replacement', async () => {
    const f = await fixture(); let done!: (value: Response) => void
    f.writes.mockImplementation(() => new Promise(resolve => { done = resolve })); await open(); confirm(); fireEvent.submit(screen.getByRole('form'))
    await waitFor(() => expect(f.writes).toHaveBeenCalledOnce()); expect(f.guard()).toBe(false)
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true)
    const signal = f.writes.mock.calls[0]![0].signal!; f.state.account = { ...admin, userId: 'b0000000-0000-4000-8000-000000000002', username: 'alex', role: 'member' }
    await act(() => f.session.refresh()); expect(signal.aborted).toBe(true); await act(async () => done(response(receipt)))
    expect(screen.queryByRole('form')).toBeNull(); expect(screen.queryByText(/已确认提交/)).toBeNull(); expect(f.onEditing).toHaveBeenLastCalledWith(false)
  })
  it('retains exact version, reason and command key after unknown or invalid responses; no repeated native capture is inferred', async () => {
    const f = await fixture(); f.writes.mockRejectedValueOnce(new Error('响应未知')); await open(); confirm()
    expect(await screen.findByRole('alert')).toHaveTextContent('响应未知'); expect(screen.getByRole('alert')).toHaveFocus()
    f.writes.mockResolvedValueOnce(response({ ...receipt, digest: 'sha256:' + 'c'.repeat(64) }))
    fireEvent.submit(screen.getByRole('form')); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('准确来源不一致'))
    expect(screen.queryByText(/已确认提交/)).toBeNull(); expect(screen.getByRole('textbox')).toHaveValue('给团队审核')
    fireEvent.submit(screen.getByRole('form')); await screen.findByText(/已确认提交/)
    expect(new Set(f.writes.mock.calls.map(([init]) => (init.headers as Record<string, string>)['Idempotency-Key'])).size).toBe(1)
    expect(f.readSource).toHaveBeenCalledOnce()
  })
  it('can stop waiting without deleting possible writes and retries the same command', async () => {
    const f = await fixture()
    f.writes.mockImplementationOnce(init => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })))
    await open(); confirm(); await waitFor(() => expect(f.writes).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: '停止等待' })); expect(await screen.findByRole('alert')).toHaveTextContent('停止等待')
    expect(screen.getByRole('textbox')).toHaveValue('给团队审核'); fireEvent.submit(screen.getByRole('form')); await screen.findByText(/已确认提交/)
    expect(new Set(f.writes.mock.calls.map(([init]) => (init.headers as Record<string, string>)['Idempotency-Key'])).size).toBe(1)
  })
  it('revokes a pending native read on provider unload and never displays the late version', async () => {
    const f = await fixture(); let done!: (value: typeof source) => void
    f.readSource.mockImplementation(() => new Promise(resolve => { done = resolve }))
    fireEvent.click(screen.getByRole('button', { name: '提交技能审核' })); const signal = f.readSource.mock.calls[0]![1]
    f.view.unmount(); expect(signal.aborted).toBe(true); await act(async () => done(source))
    expect(f.writes).not.toHaveBeenCalled(); expect(f.onEditing).toHaveBeenLastCalledWith(false)
  })
  it('rejects all other methods and query variants instead of widening the submission route', async () => {
    const transport = vi.fn<typeof fetch>(async () => response(receipt)), api = new EnterpriseApi(transport)
    for (const [path, method] of [['/admin/skill-publications', 'DELETE'], ['/admin/skill-publications?user=alex', 'POST'], ['/admin/skill-publications/../members', 'POST']]) {
      await expect(api.request(path!, method, {}, 'key')).rejects.toThrow('Unsupported')
    }
    await expect(api.request('/admin/skill-publications', 'POST', {})).rejects.toThrow('stable command')
    expect(transport).not.toHaveBeenCalled(); api.dispose()
  })
})
