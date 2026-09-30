import { Component, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { contributePaimindExtension, installHarnessSettingsResponsiveLayout, installHarnessSettingsSectionVisibility, type HarnessSlotRegistry, type PaimindClientContext } from '@paimind/harness-compat'
import { PaimindRefreshIcon, PaimindUserIcon } from '@paimind/harness-compat/client-icons'
import { observeHarnessConnectionLoss } from '@paimind/harness-compat/client-surface'
import { EnterpriseApi, EnterpriseSession, auditViews, memberViews, type AccountView, type AuditView } from './api.js'
import { installStyle } from './style.js'
import { installAuthLifecycle } from './auth-lifecycle.js'
import { Groups } from './groups.js'
import { Publications } from './publications.js'
import { SkillReview } from './skill-review.js'
import { MemberContentReview } from './member-content.js'
import { MemberModelState } from './model-state.js'
import { MemberInstructionSettings } from './instruction-settings.js'
import { MemberConnectorState } from './connector-state.js'
import { MemberRuntimeManagement } from './runtime-management.js'
import type { AgentCenterContributions } from '@paimind/agent-market/client'
import { createAgentCenterContribution } from './member-publications.js'
import type { SkillCenterContributions } from '@paimind/skill-market/client'
import { createSkillCenterContribution } from './member-skills.js'
import type { FeatureManagementContributions } from '@paimind/extension-center/client'
import { createFeatureManagementContribution } from './feature-management.js'

interface EnterpriseClientContext extends PaimindClientContext {
  readonly connection: unknown
  readonly paimindAgentCenterContributions: AgentCenterContributions
  readonly paimindSkillCenterContributions: SkillCenterContributions
  readonly paimindFeatureManagementContributions: FeatureManagementContributions
  inject(services: readonly string[], install: (scope: EnterpriseClientContext) => () => void, label?: string):
    PromiseLike<unknown> & { dispose(): Promise<void> }
}

export const inject = ['slots', 'locale', 'connection']
function Failure({ error }: { error: unknown }): JSX.Element | null {
  return error ? <p role="alert">{error instanceof Error ? error.message : '网络暂时不可用，请重试'}</p> : null
}
function Notice({ session }: { session: EnterpriseSession }): JSX.Element {
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot)
  return <div role="status"><p>{view.status === 'loading' ? '正在验证企业账户…' : view.status === 'signed-out'
    ? '登录已失效，请从企业入口重新登录。' : '企业服务暂时不可用，管理操作已锁定。'}</p>
    <button data-paimind-ui-button onClick={() => { void session.refresh() }}>重新验证</button></div>
}
export function AccountSection({ session }: { session: EnterpriseSession }): JSX.Element {
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const key = useRef<string>()
  const locked = useRef(false)
  const logout = async () => {
    if (locked.current) return
    locked.current = true; setBusy(true); setError(undefined)
    key.current ??= crypto.randomUUID()
    try { await session.api.request('/auth/logout', 'POST', {}, key.current); session.invalidate() }
    catch (failure) { setError(failure) } finally { locked.current = false; setBusy(false) }
  }
  return <section data-paimind-enterprise data-paimind-ui-scope="enterprise-account"><h2>企业账户</h2>
    {view.status !== 'ready' ? <Notice session={session} /> : <><p><PaimindUserIcon /> {view.account.displayName} · {view.account.username}</p>
      <p data-paimind-ui-summary>{view.account.role === 'admin' ? '管理员：在设置中管理企业，使用原生对话与工作区。' : '使用人员：创建和使用个人智能体，使用管理员分配的能力、自己的对话与工作区。插件、模型连接与企业管理由管理员负责。'}</p>
      <button data-paimind-ui-button disabled={busy} onClick={() => { void logout() }}>{busy ? '正在退出…' : '退出登录'}</button><Failure error={error} /></>}
  </section>
}

function Members({ api, onEditing }: { api: EnterpriseApi; onEditing: (editing: boolean) => void }): JSX.Element {
  const [rows, setRows] = useState<AccountView[]>()
  const [error, setError] = useState<unknown>()
  const [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<AccountView>()
  const [editingName, setEditingName] = useState<AccountView>()
  const [creating, setCreating] = useState(false)
  const locked = useRef(false)
  const attempt = useRef<{ body: string; key: string }>()
  const opener = useRef<HTMLButtonElement | null>(null)
  const reason = useRef<HTMLTextAreaElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const createForm = useRef<HTMLFormElement>(null)
  const createAction = useRef<HTMLButtonElement>(null)
  const feedback = useRef<HTMLParagraphElement>(null)
  const pendingFocus = useRef<HTMLElement | null>(null)
  const editing = busy || creating || selected !== undefined || editingName !== undefined
  useEffect(() => {
    onEditing(editing)
    return () => onEditing(false)
  }, [editing, onEditing])
  useEffect(() => {
    const abort = new AbortController()
    setRows(undefined); setError(undefined)
    void api.request('/admin/members', 'GET', undefined, undefined, abort.signal).then(memberViews)
      .then(setRows).catch(failure => { if (!abort.signal.aborted) setError(failure) })
    return () => abort.abort()
  }, [api, reload])
  useEffect(() => { if (selected) reason.current?.focus() }, [selected])
  useEffect(() => { if (editingName) nameInput.current?.focus() }, [editingName])
  useEffect(() => { if (creating) createForm.current?.querySelector('input')?.focus() }, [creating])
  useEffect(() => { if (!busy) { pendingFocus.current?.focus(); pendingFocus.current = null } }, [busy, creating, selected, editingName])
  const cancel = () => { if (!locked.current) { pendingFocus.current = opener.current; setSelected(undefined); setEditingName(undefined); setError(undefined); attempt.current = undefined } }
  const cancelCreate = () => {
    if (!locked.current) { pendingFocus.current = createAction.current; setCreating(false); setError(undefined); attempt.current = undefined }
  }
  const submit = async (event: FormEvent<HTMLFormElement>, target?: AccountView, action: 'status' | 'name' = 'status') => {
    event.preventDefault()
    if (locked.current) return
    locked.current = true; setBusy(true); setError(undefined); setMessage('')
    const form = event.currentTarget
    const values = new FormData(form)
    const path = target ? `/admin/members/${target.userId}/${action}` : '/admin/members'
    const data = target ? action === 'name' ? { displayName: String(values.get('displayName')), expectedDisplayName: target.displayName }
      : { status: target.status === 'active' ? 'disabled' : 'active', reason: String(values.get('reason')) }
      : { username: String(values.get('username')), displayName: String(values.get('displayName')), password: String(values.get('password')) }
    const body = JSON.stringify([path, data])
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() }
    try {
      await api.request(path, target ? 'PATCH' : 'POST', data, attempt.current.key)
      attempt.current = undefined; form.reset(); setSelected(undefined); setEditingName(undefined); setCreating(false)
      setMessage(target ? action === 'name' ? '成员姓名已更新，账户、权限和历史记录保持不变。' : '成员状态已更新，操作已记录审计。' : '成员已开通，仅可使用被授权的能力。')
      pendingFocus.current = target ? feedback.current : createAction.current
      setReload(value => value + 1)
    } catch (failure) { setError(failure) } finally { locked.current = false; setBusy(false) }
  }
  return <><div data-enterprise-toolbar><h3>成员管理</h3><div data-enterprise-actions>
    <button data-paimind-ui-button disabled={busy || creating || selected !== undefined || editingName !== undefined} onClick={() => setReload(value => value + 1)}><PaimindRefreshIcon />刷新成员</button>
    <button ref={createAction} data-paimind-ui-button data-variant="primary" disabled={busy || creating || selected !== undefined || editingName !== undefined} aria-expanded={creating}
      onClick={() => { setMessage(''); setError(undefined); setCreating(true) }}>开通成员</button>
    </div></div><p data-paimind-ui-summary>使用人员只能使用已授权的能力。停用会立即撤销该成员的登录。</p>
    {creating && <form ref={createForm} data-enterprise-form aria-label="开通使用人员" onSubmit={event => { void submit(event) }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelCreate() } }}>
      <fieldset disabled={busy} aria-busy={busy}><legend>开通使用人员</legend>
        <label>用户名<input name="username" required minLength={3} maxLength={128} autoComplete="off" pattern="[A-Za-z0-9][A-Za-z0-9._+@-]*" /></label>
        <label>姓名<input name="displayName" required maxLength={120} autoComplete="off" /></label>
        <label>初始密码<input name="password" type="password" required minLength={12} maxLength={256} autoComplete="new-password" /></label>
        <div data-enterprise-actions><button data-paimind-ui-button data-variant="primary">{busy ? '正在保存…' : '确认开通'}</button>
          <button data-paimind-ui-button type="button" onClick={cancelCreate}>取消</button></div>
      </fieldset>
    </form>}
    <Failure error={error} /><p ref={feedback} tabIndex={-1} role="status" data-enterprise-feedback>{message}</p>
    {rows === undefined && !error && <p role="status" aria-busy="true">正在读取成员…</p>}
    {rows?.length === 0 && <p role="status">暂无成员。</p>}
    <ul data-enterprise-list>{rows?.map(row => <li key={row.userId} data-enterprise-row><div><strong>{row.displayName}</strong><p data-paimind-ui-summary>{row.username} · {row.role === 'admin' ? '管理员' : '使用人员'} · {row.status === 'active' ? '已启用' : '已停用'}</p></div>
      {row.role === 'member' && <div data-enterprise-actions>
        <button data-paimind-ui-button disabled={busy || creating || selected !== undefined || editingName !== undefined} aria-label={`编辑姓名 ${row.displayName}`} onClick={event => { opener.current = event.currentTarget; setMessage(''); setError(undefined); setEditingName(row) }}>编辑姓名</button>
        <button data-paimind-ui-button disabled={busy || creating || selected !== undefined || editingName !== undefined} aria-label={`${row.status === 'active' ? '停用' : '启用'} ${row.displayName}`} onClick={event => { opener.current = event.currentTarget; setMessage(''); setError(undefined); setSelected(row) }}>{row.status === 'active' ? '停用' : '启用'}</button>
      </div>}
    </li>)}</ul>
    {editingName && <form key={`name:${editingName.userId}`} data-enterprise-form aria-label="编辑成员姓名" onSubmit={event => { void submit(event, editingName, 'name') }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() } }}>
      <fieldset disabled={busy} aria-busy={busy}><legend>编辑 {editingName.displayName} 的姓名</legend>
        <p data-paimind-ui-summary>只修改显示姓名。用户名 {editingName.username}、权限、会话和历史记录不变。</p>
        <label>姓名<input ref={nameInput} name="displayName" required maxLength={120} defaultValue={editingName.displayName} autoComplete="off" /></label>
        <div data-enterprise-actions><button data-paimind-ui-button data-variant="primary">{busy ? '正在保存…' : '保存姓名'}</button><button data-paimind-ui-button type="button" onClick={cancel}>取消</button></div>
      </fieldset>
    </form>}
    {selected && <form key={selected.userId} data-enterprise-form aria-label="确认成员状态变更" onSubmit={event => { void submit(event, selected) }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() } }}>
      <fieldset disabled={busy}><legend>{selected.status === 'active' ? '停用' : '启用'} {selected.displayName}</legend>
        <p data-paimind-ui-summary>{selected.status === 'active' ? '该成员将立即退出，无法再访问企业内容。' : '该成员需要重新登录，之前撤销的登录不会恢复。'}</p>
        <label>操作原因<textarea ref={reason} name="reason" required minLength={3} maxLength={500} /></label>
        <div data-enterprise-actions><button data-paimind-ui-button data-variant="primary">确认变更</button><button data-paimind-ui-button type="button" onClick={cancel}>取消</button></div>
      </fieldset>
    </form>}
  </>
}
const auditActions: Readonly<Record<string, string>> = Object.freeze({
  'runtime.resources.read': '读取成员运行状态与恢复记录', 'runtime.resources.configure': '保存成员资源与运行目标',
  'runtime.recovery.request': '记录管理员恢复请求', 'runtime.recovery.claimed': '操作者领取恢复请求',
  'runtime.recovery.confirmed': '确认替代运行单元及网关', 'runtime.recovery.rejected': '执行前拒绝恢复请求',
  'runtime.recovery.unconfirmed': '记录恢复效果未知',
  'runtime.connector.authorized': '授权读取成员连接器盘点', 'runtime.connector.read': '读取成员连接器盘点',
  'runtime.connector.command.authorized': '核准连接器配置操作权限', 'runtime.connector.configuration.read': '读取停用连接器配置状态',
  'runtime.connector.activation.read': '读取成员连接器启停状态',
  'runtime.connector.approval.read': '读取连接器历史批准记录', 'runtime.connector.approval': '变更连接器批准记录',
  'runtime.connector.activation.requested': '预留连接器启停操作', 'runtime.connector.activation.confirmed': '记录连接器启停确认结果',
  'runtime.connector.activation.receipt': '读取历史连接器启停操作', 'runtime.connector.activation.resolved': '结束未知连接器启停追认',
  'runtime.connector.requested': '预留连接器配置操作', 'runtime.connector.confirmed': '记录连接器配置确认结果',
  'runtime.connector.resolved': '结束未知连接器操作追认', 'runtime.connector.receipt': '读取历史连接器操作',
  'runtime.model.authorized': '授权读取成员模型状态', 'runtime.model.read': '读取成员模型状态',
  'runtime.model.command.authorized': '核准模型配置操作权限', 'runtime.model.requested': '预留模型配置操作',
  'runtime.model.confirmed': '记录模型操作确认结果', 'runtime.model.resolved': '结束未知模型操作追认', 'runtime.model.receipt': '读取历史模型操作',
  'runtime.instructions.authorized': '核准成员企业指令操作', 'runtime.instructions.read': '读取成员企业指令',
  'runtime.instructions.requested': '预留成员指令写入', 'runtime.instructions.confirmed': '确认成员指令操作结果',
  'runtime.instructions.receipt': '读取历史指令操作', 'runtime.instructions.resolved': '结束未知指令操作追认',
  'identity.bootstrap': '初始化企业管理员', 'identity.login': '登录企业账户',
  'identity.logout': '退出登录', 'identity.session.replaced': '替换当前浏览器登录',
  'identity.me': '验证登录状态', 'identity.members.list': '查看成员列表',
  'identity.member.create': '开通使用人员', 'identity.member.status': '变更成员启用状态',
  'identity.member.rename': '修改成员姓名', 'runtime.operation': '执行原生操作',
  'content.access.authorized': '成员会话只读访问获准', 'content.access.read': '读取成员会话内容',
  'identity.groups.list': '查看成员组', 'identity.group.create': '创建成员组',
  'identity.group.update': '编辑成员组及成员', 'identity.group.status': '归档或恢复成员组',
  'identity.audit.list': '查看操作审计', 'runtime.admission': '访问原生工作区',
  'resource.submit': '提交智能体审核', 'resource.review': '审核智能体发布', 'resource.assignment': '变更智能体分配',
})
const auditReasons: Readonly<Record<string, string>> = Object.freeze({
  'runtime-recovery-changed': '恢复身份、资源或准确运行版本已变化', 'runtime-recovery-precondition': '需重新回读已撤回版本及运行资源策略',
  'runtime-recovery-pending': '已有未完成或结果未知的恢复请求', 'runtime-policy-conflict': '资源策略版本已变化，请重新读取',
  'precondition-changed': '恢复前置条件已变化，未开始执行', 'exact-stopped-cell': '领取准确已撤回单元的恢复请求',
  'verified-replacement-and-gateway-acknowledgement': '替代单元已核验且网关已确认', 'effect-unknown-no-automatic-retry': '效果未知，不自动重试',
  'connector-context-changed': '成员、管理员或连接器配置修订已变化', 'connector-command-pending': '该成员仍有结果未确认的连接器操作',
  'connector-configuration-unavailable': '原生连接器配置无法确认', 'connector-management-busy': '连接器管理暂不可用或达到并发上限',
  'connector-approval-changed': '连接器批准修订或作用域已变化，请重新读取', 'connector-version-required': '连接器配置尚无稳定版本，须先完整替换',
  'unauthenticated': '登录已失效或尚未登录', 'invalid-credentials': '用户名或密码不正确',
  'dependency-failed': '依赖服务暂时不可用', 'admin-required': '该操作需要管理员权限',
  'runtime-unavailable': '当前账户的运行环境尚未就绪或租约已到期',
  'native-unavailable': '原生运行环境暂时无法连接',
  'member-native-policy-pending': '成员运行权限尚未完成配置',
  'native-operation-denied': '当前账户未获授权执行此操作', 'invalid-native-operation': '原生操作请求格式无效',
  'runtime-principal-changed': '账户运行权限已变化', 'member-name-changed': '成员姓名已被修改，请刷新后重试',
  'group-changed': '成员组已被修改，请刷新后重试', 'group-archived': '成员组已归档，需先恢复',
  'group-capacity': '成员组超过当前上限', 'group-status-unchanged': '成员组已处于该状态',
  'member-list-capacity': '账户列表超过当前界面上限',
})
const auditOutcomes: Readonly<Record<string, string>> = Object.freeze({ succeeded: '成功', denied: '已拒绝', failed: '失败' })
function labelFor(labels: Readonly<Record<string, string>>, key: string, fallback: string): string {
  return Object.hasOwn(labels, key) ? labels[key]! : fallback
}
function auditReason(row: AuditView): string {
  if (['runtime.model.confirmed', 'runtime.model.resolved', 'runtime.connector.confirmed', 'runtime.connector.resolved', 'runtime.connector.approval', 'runtime.connector.activation.confirmed', 'runtime.connector.activation.resolved'].includes(row.action) && row.outcome === 'succeeded' && row.reason) {
    try {
      const value: unknown = JSON.parse(row.reason)
      if (value && typeof value === 'object' && 'reason' in value && typeof value.reason === 'string') {
        if (row.action === 'runtime.connector.approval' && 'decision' in value && ['approved','revoked'].includes(String(value.decision))) return `${value.reason}；${value.decision === 'approved' ? '记录已批准，不自动启用' : '记录已撤销，不证明运行单元已停用'}。`
        if (row.action === 'runtime.connector.activation.confirmed' && 'outcome' in value && ['enabled','disabled'].includes(String(value.outcome))) return `${value.reason}；该次${value.outcome === 'enabled' ? '启用' : '停用'}已确认，历史回执不代表当前状态或使用许可。`
        if ('effect' in value && value.effect === 'unknown') return `${value.reason}；历史效果仍未知，没有重发或证明回退。`
        if ('outcome' in value && value.outcome === 'conflict') return `${value.reason}；设置修订冲突，本次未写入。`
        if ('outcome' in value && value.outcome === 'applied') return `${value.reason}；原生操作已确认，未验证模型调用或凭证有效性。`
        if ('outcome' in value && value.outcome === 'saved-disabled') return `${value.reason}；原生停用配置变更已保存，没有启用或授予使用权限。`
        if ('outcome' in value && value.outcome === 'unchanged') return `${value.reason}；原生配置未改写，没有启用或授予使用权限。`
      }
    } catch { /* Retain unknown original evidence. */ }
  }
  if (['content.access.authorized', 'content.access.read', 'runtime.model.authorized', 'runtime.model.read', 'runtime.connector.authorized', 'runtime.connector.read'].includes(row.action) && row.outcome === 'succeeded' && row.reason) {
    try {
      const value: unknown = JSON.parse(row.reason)
      if (value && typeof value === 'object' && 'reason' in value && typeof value.reason === 'string'
        && 'readOnly' in value && value.readOnly === true) {
        return `${value.reason}；只读访问。具体目标及读取范围见追溯信息。`
      }
    } catch { /* Keep original evidence when its shape is unknown. */ }
  }
  if (row.action === 'identity.group.update' && row.outcome === 'succeeded' && row.reason) {
    try {
      const value: unknown = JSON.parse(row.reason)
      if (value && typeof value === 'object' && 'name' in value && typeof value.name === 'string'
        && 'previousName' in value && typeof value.previousName === 'string'
        && 'addedUserIds' in value && Array.isArray(value.addedUserIds)
        && 'removedUserIds' in value && Array.isArray(value.removedUserIds)) {
        return `成员组「${value.previousName}」→「${value.name}」；加入 ${value.addedUserIds.length} 人，移出 ${value.removedUserIds.length} 人。成员编号见追溯信息。`
      }
    } catch { /* Preserve unknown original reasons, never invent a summary. */ }
  }
  return row.action.startsWith('runtime.recovery.') || row.outcome !== 'succeeded' ? labelFor(auditReasons, row.reason ?? '', row.reason ?? '') : row.reason ?? ''
}
function Audit({ api }: { api: EnterpriseApi }): JSX.Element {
  const [rows, setRows] = useState<AuditView[]>()
  const [error, setError] = useState<unknown>()
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    setRows(undefined); setError(undefined)
    void api.request('/admin/audit', 'GET', undefined, undefined, abort.signal).then(auditViews)
      .then(setRows).catch(failure => { if (!abort.signal.aborted) setError(failure) })
    return () => abort.abort()
  }, [api, reload])
  return <><div data-enterprise-toolbar><h3>操作审计</h3>
    <button data-paimind-ui-button onClick={() => setReload(value => value + 1)}><PaimindRefreshIcon />刷新审计</button></div>
    <p data-paimind-ui-summary>最近 200 条记录，按时间倒序。记录不可修改，原始事件保留在追溯信息中。</p><Failure error={error} />
    {rows === undefined && !error && <p role="status" aria-busy="true">正在读取审计…</p>}
    {rows?.length === 0 && <p role="status">暂无审计记录。</p>}
    <ol data-enterprise-list>{rows?.map(row => <li key={row.event_id} data-enterprise-audit><strong>{labelFor(auditActions, row.action, '其他企业操作')}</strong>
      <span>{labelFor(auditOutcomes, row.outcome, '未知结果')} · <time dateTime={row.occurred_at}>{new Date(row.occurred_at).toLocaleString()}</time></span>
      {row.reason && <span>原因：{auditReason(row)}</span>}
      <details><summary>追溯信息</summary><p>原始事件：{row.action}<br />原始结果：{row.outcome}<br />原始原因：{row.reason ?? '无'}<br />操作者：{row.actor_user_id ?? '未验证身份'}<br />目标：{row.target_id ?? '无'}<br />请求：{row.request_id}</p></details>
    </li>)}</ol>
  </>
}
export function AdminSection({ session }: { session: EnterpriseSession }): JSX.Element {
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [page, setPage] = useState<'members' | 'groups' | 'publications' | 'skills' | 'content' | 'models' | 'instructions' | 'connectors' | 'runtime' | 'audit'>('members')
  const [editingChild, setEditingChild] = useState(false)
  return <section data-paimind-enterprise data-paimind-ui-scope="enterprise-admin"><header><h2>企业管理</h2><p data-paimind-ui-summary>管理成员与组、审核和分配智能体与技能，查看企业操作记录。</p></header>
    {view.status !== 'ready' ? <Notice session={session} /> : view.account.role !== 'admin' ? <p role="alert">此操作仅限管理员。</p> : <>
      <div data-enterprise-actions data-enterprise-navigation role="group" aria-label="企业管理内容">
        <button data-paimind-ui-button disabled={editingChild} aria-pressed={page === 'members'} onClick={() => setPage('members')}>成员管理</button>
        <button data-paimind-ui-button disabled={editingChild} aria-pressed={page === 'groups'} onClick={() => setPage('groups')}>成员组</button>
        <button data-paimind-ui-button disabled={editingChild} aria-pressed={page === 'publications'} onClick={() => setPage('publications')}>智能体审核与分配</button>
        <button data-paimind-ui-button disabled={editingChild} aria-pressed={page === 'skills'} onClick={() => setPage('skills')}>技能审核与分配</button>
        <button data-paimind-ui-button disabled={editingChild} aria-pressed={page === 'content'} onClick={() => setPage('content')}>成员会话只读查看</button>
        <button data-paimind-ui-button disabled={editingChild} aria-pressed={page === 'models'} onClick={() => setPage('models')}>成员模型配置</button>
        <button data-paimind-ui-button disabled={editingChild} aria-pressed={page === 'instructions'} onClick={() => setPage('instructions')}>成员企业指令</button>
        <button data-paimind-ui-button disabled={editingChild} aria-pressed={page === 'connectors'} onClick={() => setPage('connectors')}>成员连接器配置</button>
        <button data-paimind-ui-button disabled={editingChild} aria-pressed={page === 'runtime'} onClick={() => setPage('runtime')}>成员配额与运行</button>
        <button data-paimind-ui-button disabled={editingChild} aria-pressed={page === 'audit'} onClick={() => setPage('audit')}>操作审计</button>
      </div>
      {page === 'members' ? <Members key={`${view.account.tenantId}:${view.account.userId}`} api={session.api} onEditing={setEditingChild} /> : page === 'groups'
        ? <Groups key={`${view.account.tenantId}:${view.account.userId}`} api={session.api} onEditing={setEditingChild} />
        : page === 'publications' ? <Publications key={`${view.account.tenantId}:${view.account.userId}`} api={session.api} onEditing={setEditingChild} />
        : page === 'skills' ? <SkillReview key={`${view.account.tenantId}:${view.account.userId}`} api={session.api} onEditing={setEditingChild} />
        : page === 'content' ? <MemberContentReview key={`${view.account.tenantId}:${view.account.userId}`} api={session.api} />
        : page === 'models' ? <MemberModelState key={`${view.account.tenantId}:${view.account.userId}`} api={session.api} onEditing={setEditingChild} />
        : page === 'instructions' ? <MemberInstructionSettings key={`${view.account.tenantId}:${view.account.userId}`} api={session.api} onEditing={setEditingChild} />
        : page === 'connectors' ? <MemberConnectorState key={`${view.account.tenantId}:${view.account.userId}`} api={session.api} onEditing={setEditingChild} />
        : page === 'runtime' ? <MemberRuntimeManagement key={`${view.account.tenantId}:${view.account.userId}`} api={session.api} onEditing={setEditingChild} />
        : <Audit key={`${view.account.tenantId}:${view.account.userId}`} api={session.api} />}
    </>}
  </section>
}
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  render(): ReactNode { return this.state.failed ? <p role="alert">企业管理暂时不可用，原生对话和其他插件不受影响。</p> : this.props.children }
}
/** Gate both discovery metadata and Settings by the same verified projection.
 * This owns only visibility; every command still requires gateway authorization.
 * Installations follow the native slot-provider lifecycle, including loss and
 * return of Extension Center, and are disposed on any authority transition. */
function authenticatedAdminSlots(slots: HarnessSlotRegistry, session: EnterpriseSession): HarnessSlotRegistry {
  return {
    register: (options, component) => slots.register(options, component),
    inject: (name, install) => slots.inject(name, () => {
      let owner: string | undefined
      let remove: (() => void) | undefined
      const clear = () => { remove?.(); remove = undefined; owner = undefined }
      const update = () => {
        const view = session.getSnapshot()
        const next = view.status === 'ready' && view.account.role === 'admin'
          ? JSON.stringify([view.account.tenantId, view.account.userId]) : undefined
        if (next === owner) return
        clear()
        if (next === undefined) return
        const installed = install()
        const disposers = typeof installed === 'function' ? [installed] : [...installed]
        remove = () => { for (const dispose of disposers.reverse()) dispose() }
        owner = next
      }
      const unsubscribe = session.subscribe(update); update()
      return () => { unsubscribe(); clear() }
    }),
  }
}
export function apply(ctx: EnterpriseClientContext): void {
  const session = new EnterpriseSession(new EnterpriseApi())
  const adminSlots = authenticatedAdminSlots(ctx.slots, session)
  contributePaimindExtension(adminSlots, {
    id: 'paimind:enterprise-admin', packageName: '@paimind/enterprise-admin', category: 'governance',
    nameZh: '企业管理', nameEn: 'Enterprise Administration',
    descriptionZh: '在原生设置中管理企业账户、成员与审计。完整企业隔离与端到端验收尚未完成。',
    descriptionEn: 'Enterprise account, member and audit settings. Full enterprise isolation and end-to-end acceptance are pending.',
    surface: 'settings', maturity: 'technical-preview', order: 27,
  })
  ctx.effect(installStyle, 'paimind-enterprise-admin: scoped host theme')
  ctx.effect(() => { session.start(); return () => session.dispose() }, 'paimind-enterprise-admin: identity projection')
  ctx.effect(() => installAuthLifecycle(session, undefined, onLoss => observeHarnessConnectionLoss(ctx.connection, onLoss)),
    'paimind-enterprise-admin: authenticated document lifecycle')
  ctx.effect(() => {
    const child = ctx.inject(['paimindFeatureManagementContributions'], scope =>
      scope.paimindFeatureManagementContributions.register(createFeatureManagementContribution(session)),
    'paimind-enterprise-admin: original Extension Center contribution')
    return () => { void child.dispose() }
  }, 'paimind-enterprise-admin: optional Extension Center integration')
  ctx.effect(() => {
    // This child waits for its own required owner service. Native Settings do
    // not depend on Agent Center being enabled, and no loader order is assumed.
    const child = ctx.inject(['paimindAgentCenterContributions'], scope =>
      scope.paimindAgentCenterContributions.register(createAgentCenterContribution(session)),
    'paimind-enterprise-admin: Agent Center owner contribution')
    return () => { void child.dispose() }
  }, 'paimind-enterprise-admin: optional Agent Center integration')
  ctx.effect(() => {
    const child = ctx.inject(['paimindSkillCenterContributions'], scope =>
      scope.paimindSkillCenterContributions.register(createSkillCenterContribution(session)),
    'paimind-enterprise-admin: Skill Center owner contribution')
    return () => { void child.dispose() }
  }, 'paimind-enterprise-admin: optional Skill Center integration')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'paimind-enterprise-account', order: 26,
    label: () => ctx.locale.getLocale().active.startsWith('zh') ? '企业账户' : 'Enterprise Account',
  }, () => <Boundary><AccountSection session={session} /></Boundary>))
  ctx.effect(() => installHarnessSettingsResponsiveLayout(ctx.slots, 'paimind-enterprise-account'), 'paimind-enterprise-admin: native Settings responsive layout')
  ctx.effect(() => installHarnessSettingsSectionVisibility(ctx.slots, {
    getSnapshot: () => {
      const view = session.getSnapshot()
      return view.status === 'ready' && view.account.role === 'admin' ? null : ['paimind-enterprise-account']
    },
    subscribe: session.subscribe,
  }, 'paimind-enterprise-account'), 'paimind-enterprise-admin: authenticated native Settings navigation')
  adminSlots.inject('settings.section', () => adminSlots.register({ name: 'settings.section', id: 'paimind-enterprise-admin', order: 27,
    label: () => ctx.locale.getLocale().active.startsWith('zh') ? '企业管理' : 'Enterprise Administration',
  }, () => <Boundary><AdminSection session={session} /></Boundary>))
}
