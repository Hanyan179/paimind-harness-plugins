import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminSection } from '../src/client/index.js'
import { EnterpriseApi, EnterpriseSession } from '../src/client/api.js'
import { skillAssignments } from '../src/client/skill-review.js'
import type { SkillPublicationView } from '../src/client/member-skills.js'
import type { AssignmentView } from '../src/client/publication-view.js'
const admin = { userId: 'a0000000-0000-4000-8000-000000000001', tenantId: 'skill-review-component', username: 'morgan', displayName: 'Morgan', role: 'admin', status: 'active' }
const hansen = { ...admin, userId: 'b0000000-0000-4000-8000-000000000002', username: 'hansen', displayName: 'Hansen', role: 'member' }
const alex = { ...hansen, userId: 'c0000000-0000-4000-8000-000000000003', username: 'alex', displayName: 'Alex' }
const group = { groupId: 'd0000000-0000-4000-8000-000000000004', name: '客户服务团队', revision: 1, status: 'active', memberIds: [hansen.userId] }
const base: SkillPublicationView = { publicationId: 'e0000000-0000-4000-8000-000000000005', artifactId: 'f0000000-0000-4000-8000-000000000006',
  sourceUserId: admin.userId, name: 'customer-notes', digest: 'sha256:' + 'a'.repeat(64), status: 'pending', revision: 1,
  submissionReason: '审核客户工作方法', reviewReason: null, archiveDigest: 'sha256:' + 'b'.repeat(64), archiveBytes: 512, expandedBytes: 14, entryCount: 1 }
const result = (data: unknown) => new Response(JSON.stringify({ data }))
const sessions: EnterpriseSession[] = []
afterEach(() => { cleanup(); for (const session of sessions.splice(0)) session.dispose(); vi.restoreAllMocks() })
async function fixture(status: SkillPublicationView['status'] = 'pending', assignments: AssignmentView[] = []) {
  const state = { row: { ...base, status }, account: admin, assignments, badDetail: false, malformedReceipt: false }
  const write = vi.fn(async (path: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    const row = { ...state.row, runtimeGrant: false, revision: state.row.revision + 1 }
    if (path.endsWith('/review')) {
      row.status = body.decision === 'publish' ? 'published' : body.decision === 'reject' ? 'rejected' : 'withdrawn'; row.reviewReason = body.reason
      state.row = row
      return result({ ...row, ...(state.malformedReceipt ? { archiveDigest: 'sha256:' + 'c'.repeat(64) } : {}) })
    }
    const assignment: AssignmentView = { active: body.active, effect: body.effect, subjectId: body.subjectId ?? null, subjectKind: body.subjectKind }
    state.assignments = [...state.assignments.filter(x => `${x.subjectKind}:${x.subjectId}` !== `${assignment.subjectKind}:${assignment.subjectId}`), assignment]
    state.row = row; return result({ ...row, assignment }) // JSONB-style field order must not affect exact matching.
  })
  const transport = vi.fn<typeof fetch>(async (value, init) => {
    const path = String(value).replace('/haas/v1', '')
    if (init?.method !== 'GET') return write(path, init!)
    if (path === '/auth/me') return result(state.account)
    if (path === '/admin/members') return result([admin, hansen, alex])
    if (path === '/admin/groups') return result([group])
    if (path === '/admin/skill-publications') return result([{ ...state.row, runtimeGrant: false }])
    if (path.endsWith('/assignments')) return result({ publication: { ...state.row, runtimeGrant: false }, assignments: state.assignments })
    if (path.includes('/content/')) return result({ publicationId: base.publicationId, revision: state.row.revision, archiveDigest: base.archiveDigest, runtimeGrant: false,
      content: path.endsWith('/entries/0') ? { kind: 'entries', cursor: 0, total: 1, nextCursor: null, entries: [{ index: 0, path: 'SKILL.md', kind: 'file', size: 14 }] }
        : { kind: 'file', entry: { index: 0, path: 'SKILL.md', kind: 'file', size: 14 }, offset: 0, data: btoa('sealed content'), nextOffset: null } })
    if (path === '/admin/skill-publications/' + base.publicationId) return result({ ...state.row, runtimeGrant: false, access: state.badDetail ? 'user-allow' : 'review-copy' })
    throw Error('Unexpected skill review fixture path')
  })
  const session = new EnterpriseSession(new EnterpriseApi(transport)); sessions.push(session); await session.refresh()
  return { state, session, transport, write }
}
async function open(f: Awaited<ReturnType<typeof fixture>>) {
  const view = render(<AdminSection session={f.session} />)
  fireEvent.click(screen.getByRole('button', { name: '技能审核与分配', exact: true }))
  fireEvent.click(await screen.findByRole('button', { name: '查看技能发布 customer-notes' }))
  await screen.findByRole('region', { name: '技能发布详情' }); return view
}
function confirm() {
  fireEvent.change(screen.getByLabelText('技能操作原因'), { target: { value: '业务负责人审核确认' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '我已检查所选封存内容、版本、分配范围和操作影响' }))
}
async function readContent() {
  fireEvent.click(screen.getByRole('button', { name: '查看封存内容' }))
  fireEvent.click(await screen.findByRole('button', { name: '查看文件 SKILL.md' }))
  await screen.findByText('sealed content')
  // The completed-content callback is a separate effect from rendering text.
  // Wait for the actual approval gate, not just a visible partial render.
  await waitFor(() => expect(screen.getByRole('button', { name: '批准技能发布' })).toBeEnabled())
}
describe('native Settings Skill review and assignment component fixture, NOT Browser E2E', () => {
  it('uses native navigation, reads exact sealed content on demand, and never offers native run or automatic installation', async () => {
    const f = await fixture(); await open(f)
    expect(screen.getByText('提交人：Morgan (@morgan)')).toBeInTheDocument()
    expect(f.transport.mock.calls.some(([url]) => String(url).includes('/content/'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '查看封存内容' }))
    fireEvent.click(await screen.findByRole('button', { name: '查看文件 SKILL.md' })); await screen.findByText('sealed content')
    expect(f.write).not.toHaveBeenCalled(); expect(document.querySelector('main, aside, #root')).toBeNull()
    expect(screen.queryByRole('button', { name: /开始对话|确认采用/ })).toBeNull()
  })
  it.each([['pending', '批准技能发布', 'published'], ['pending', '拒绝技能发布', 'rejected'], ['published', '下架技能发布', 'withdrawn']] as const)('confirms %s through %s with exact revision and one write', async (status, label, next) => {
    const f = await fixture(status); await open(f); if (label === '批准技能发布') { expect(screen.getByRole('button', { name: label })).toBeDisabled(); await readContent() }
    fireEvent.click(screen.getByRole('button', { name: label, exact: true }))
    expect(screen.getByLabelText('技能操作原因')).toHaveFocus(); expect(screen.getByRole('button', { name: '成员管理' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认技能变更' })).toBeDisabled(); confirm()
    fireEvent.submit(screen.getByRole('form', { name: '确认技能管理变更' })); fireEvent.submit(screen.getByRole('form', { name: '确认技能管理变更' }))
    await screen.findByText(/技能变更已保存/); expect(f.write).toHaveBeenCalledOnce(); expect(f.state.row.status).toBe(next)
    expect(JSON.parse(String(f.write.mock.calls[0]![1].body))).toMatchObject({ expectedRevision: 1, reason: '业务负责人审核确认' })
    expect(screen.getByRole('button', { name: '成员管理' })).toBeEnabled()
  })
  it('assigns Hansen by stable id, accepts unordered receipts, then revokes only that fixed rule', async () => {
    const f = await fixture('published'); await open(f); fireEvent.click(screen.getByRole('button', { name: '新增技能分配' }))
    fireEvent.change(screen.getByLabelText('技能分配对象'), { target: { value: hansen.userId } }); confirm()
    fireEvent.submit(screen.getByRole('form', { name: '确认技能管理变更' })); await screen.findByText(/技能变更已保存/)
    fireEvent.click(await screen.findByRole('button', { name: '编辑技能分配 Hansen (@hansen)' }))
    expect(screen.queryByLabelText('技能分配对象')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: '启用此技能分配规则（取消即撤销）' })); confirm()
    fireEvent.submit(screen.getByRole('form', { name: '确认技能管理变更' })); await screen.findByText(/技能变更已保存/)
    expect(f.state.assignments).toEqual([{ subjectKind: 'user', subjectId: hansen.userId, effect: 'allow', active: false }])
    expect(JSON.parse(String(f.write.mock.calls[1]![1].body))).toMatchObject({ expectedRevision: 2, subjectId: hansen.userId, active: false })
  })
  it('does not approve metadata alone and disables a prepared approval when the content view closes', async () => {
    const f = await fixture(); await open(f)
    expect(screen.getByRole('button', { name: '批准技能发布' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '拒绝技能发布' })).toBeEnabled()
    await readContent(); fireEvent.click(screen.getByRole('button', { name: '批准技能发布' })); confirm()
    expect(screen.getByRole('button', { name: '确认技能变更' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '关闭封存内容' }))
    expect(screen.getByRole('button', { name: '确认技能变更' })).toBeDisabled()
    fireEvent.submit(screen.getByRole('form', { name: '确认技能管理变更' })); expect(f.write).not.toHaveBeenCalled()
    expect(screen.getByLabelText('技能操作原因')).toHaveValue('业务负责人审核确认')
  })
  it('retains reason and the same logical key after unknown results, and rejects malformed success receipts', async () => {
    const f = await fixture(); await open(f); await readContent(); fireEvent.click(screen.getByRole('button', { name: '批准技能发布' })); confirm()
    f.write.mockRejectedValueOnce(Error('Unknown network result'))
    fireEvent.submit(screen.getByRole('form', { name: '确认技能管理变更' })); await screen.findByRole('alert')
    const firstKey = (f.write.mock.calls[0]![1].headers as Record<string, string>)['Idempotency-Key']
    f.state.malformedReceipt = true
    fireEvent.submit(screen.getByRole('form', { name: '确认技能管理变更' })); await waitFor(() => expect(f.write).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('不一致'))
    expect((f.write.mock.calls[1]![1].headers as Record<string, string>)['Idempotency-Key']).toBe(firstKey)
    expect(screen.getByLabelText('技能操作原因')).toHaveValue('业务负责人审核确认'); expect(screen.queryByText(/技能变更已保存/)).toBeNull()
  })
  it('aborts pending writes and removes administration content on identity change; a late reply cannot reopen it', async () => {
    const f = await fixture(); await open(f); await readContent(); fireEvent.click(screen.getByRole('button', { name: '批准技能发布' })); confirm()
    let release!: (value: Response) => void
    f.write.mockImplementationOnce(() => new Promise(done => { release = done }))
    fireEvent.submit(screen.getByRole('form', { name: '确认技能管理变更' })); await waitFor(() => expect(release).toBeTypeOf('function'))
    const signal = f.write.mock.calls[0]![1].signal!
    f.state.account = hansen; await act(async () => f.session.refresh())
    expect(signal.aborted).toBe(true); expect(screen.queryByRole('region', { name: '技能发布详情' })).toBeNull()
    await act(async () => release(result({ ...base, runtimeGrant: false })))
    expect(screen.queryByText(/技能变更已保存/)).toBeNull()
  })
  it('rejects duplicate, foreign-shape and non-user deny assignments and refuses unsupported content writes', async () => {
    const p = { ...base, runtimeGrant: false }, rule = { subjectKind: 'user', subjectId: hansen.userId, effect: 'allow', active: true }
    expect(() => skillAssignments({ publication: p, assignments: [rule, rule] })).toThrow()
    expect(() => skillAssignments({ publication: p, assignments: [{ ...rule, subjectKind: 'all', subjectId: null, effect: 'deny' }] })).toThrow()
    const f = await fixture(), path = `/admin/skill-publications/${base.publicationId}/content/1/${'b'.repeat(64)}/entries/0`
    await expect(f.session.api.request(path, 'POST', {}, 'key')).rejects.toThrow('Unsupported')
    await expect(f.session.api.request(path + '?skip=true')).rejects.toThrow('Unsupported')
    await expect(f.session.api.request(`/admin/skill-publications/${base.publicationId}/review`, 'PATCH', {}, 'key')).rejects.toThrow('Unsupported')
    expect(f.write).not.toHaveBeenCalled()
  })
})
