import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiFailure, groupViews, memberViews, type AccountView, type EnterpriseApi, type GroupView } from './api.js'
import { skillPublication, type SkillPublicationView } from './member-skills.js'
import { PublicationContent } from './skill-content.js'
import type { AssignmentView } from './publication-view.js'
const labels = { pending: '待审核', published: '已发布', rejected: '已拒绝', withdrawn: '已下架' }
const decisions = { publish: '批准技能发布', reject: '拒绝技能发布', withdraw: '下架技能发布' }
const invalid = (): never => { throw new Error('技能发布或分配响应不一致，请重新读取') }
const object = (input: unknown): Record<string, unknown> => input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : invalid()
const same = (a: SkillPublicationView, b: SkillPublicationView) => JSON.stringify(a) === JSON.stringify(b)
type Inventory = { rows: SkillPublicationView[]; members: AccountView[]; groups: GroupView[] }
type Detail = { publication: SkillPublicationView; assignments: AssignmentView[] }
type Editor = { kind: 'review'; decision: keyof typeof decisions } | { kind: 'assignment'; rule?: AssignmentView }
export function skillAssignments(input: unknown): Detail {
  const data = object(input), publication = skillPublication(data.publication)
  if (!Array.isArray(data.assignments) || data.assignments.length > 701) return invalid()
  const assignments = data.assignments.map(value => {
    const row = object(value)
    if (!['user', 'group', 'all'].includes(String(row.subjectKind)) || !['allow', 'deny'].includes(String(row.effect)) || typeof row.active !== 'boolean'
      || row.effect === 'deny' && row.subjectKind !== 'user' || (row.subjectKind === 'all' ? row.subjectId !== null
        : typeof row.subjectId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(row.subjectId))) return invalid()
    return { subjectKind: row.subjectKind as AssignmentView['subjectKind'], subjectId: row.subjectId as string | null,
      effect: row.effect as AssignmentView['effect'], active: row.active }
  })
  if (new Set(assignments.map(x => `${x.subjectKind}:${x.subjectId}`)).size !== assignments.length) return invalid()
  return { publication, assignments }
}
/** Native Settings only. Immutable review is never a native installation or a
 * permission cache; source capture remains with the original Skill Center. */
export function SkillReview({ api, onEditing }: { api: EnterpriseApi; onEditing: (editing: boolean) => void }): JSX.Element {
  const [inventory, setInventory] = useState<Inventory>(), [selected, setSelected] = useState<string>(), [detail, setDetail] = useState<Detail>()
  const [editor, setEditor] = useState<Editor>(), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [kind, setKind] = useState<AssignmentView['subjectKind']>('user'), [subject, setSubject] = useState('')
  const [effect, setEffect] = useState<AssignmentView['effect']>('allow'), [active, setActive] = useState(true)
  const [reload, setReload] = useState(0), [query, setQuery] = useState(''), [status, setStatus] = useState('all')
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(), [message, setMessage] = useState('')
  const [contentReady, setContentReady] = useState(false)
  const lock = useRef(false), request = useRef<AbortController>(), attempt = useRef<{ fingerprint: string; key: string }>()
  const reasonInput = useRef<HTMLTextAreaElement>(null), heading = useRef<HTMLHeadingElement>(null), opener = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { onEditing(!!editor); return () => onEditing(false) }, [editor, onEditing])
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (!editor) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent)
  }, [editor])
  useEffect(() => {
    const abort = new AbortController(); setInventory(undefined); setDetail(undefined); setError(undefined)
    void Promise.all([api.request('/admin/skill-publications', 'GET', undefined, undefined, abort.signal),
      api.request('/admin/members', 'GET', undefined, undefined, abort.signal).then(memberViews),
      api.request('/admin/groups', 'GET', undefined, undefined, abort.signal).then(groupViews)]).then(([raw, members, groups]) => {
      if (!Array.isArray(raw) || raw.length > 1000) return invalid()
      const rows = raw.map(skillPublication)
      if (new Set(rows.map(x => x.publicationId)).size !== rows.length || rows.some(x => !members.some(m => m.userId === x.sourceUserId))) return invalid()
      if (!abort.signal.aborted) setInventory({ rows, members, groups })
    }).catch(failure => { if (!abort.signal.aborted) setError(failure) })
    return () => abort.abort()
  }, [api, reload])
  useEffect(() => {
    const abort = new AbortController(); setDetail(undefined)
    if (selected && inventory) void Promise.all([api.request('/admin/skill-publications/' + selected, 'GET', undefined, undefined, abort.signal),
      api.request('/admin/skill-publications/' + selected + '/assignments', 'GET', undefined, undefined, abort.signal)]).then(([raw, rules]) => {
      const result = skillAssignments(rules), row = object(raw)
      if (row.access !== 'review-copy' || result.publication.publicationId !== selected || !same(result.publication, skillPublication(raw))
        || !inventory.members.some(x => x.userId === result.publication.sourceUserId)
        || result.assignments.some(x => x.subjectKind === 'user' ? !inventory.members.some(m => m.userId === x.subjectId)
          : x.subjectKind === 'group' && !inventory.groups.some(g => g.groupId === x.subjectId))) return invalid()
      if (!abort.signal.aborted) setDetail(result)
    }).catch(failure => { if (!abort.signal.aborted) setError(failure) })
    return () => abort.abort()
  }, [api, selected, inventory])
  useEffect(() => { if (editor) reasonInput.current?.focus(); else if (detail) heading.current?.focus() }, [detail, editor])
  const open = (next: Editor, button: HTMLButtonElement) => {
    const rule = next.kind === 'assignment' ? next.rule : undefined
    opener.current = button; attempt.current = undefined; setEditor(next); setReason(''); setConfirmed(false); setError(undefined); setMessage('')
    setKind(rule?.subjectKind ?? 'user'); setSubject(rule?.subjectId ?? ''); setEffect(rule?.effect ?? 'allow'); setActive(rule?.active ?? true)
  }
  const cancel = () => {
    if (lock.current || (reason || confirmed || editor?.kind === 'assignment') && !window.confirm('放弃未保存的技能审核或分配修改？')) return
    setEditor(undefined); setError(undefined); attempt.current = undefined; queueMicrotask(() => opener.current?.focus())
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!detail || !editor || lock.current || reason.trim().length < 3 || !confirmed || editor.kind === 'assignment' && kind !== 'all' && !subject) return
    if (editor.kind === 'review' && editor.decision === 'publish' && !contentReady) return
    const selected = detail.publication, path = `/admin/skill-publications/${selected.publicationId}/${editor.kind === 'review' ? 'review' : 'assignments'}`
    const rule = { subjectKind: kind, subjectId: kind === 'all' ? null : subject, effect, active }
    const body = { expectedRevision: selected.revision, reason: reason.trim(), ...(editor.kind === 'review'
      ? { decision: editor.decision } : { subjectKind: kind, ...(kind === 'all' ? {} : { subjectId: subject }), effect, active }) }
    const fingerprint = JSON.stringify([path, body]); if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() }
    const abort = new AbortController(); request.current = abort; lock.current = true; setBusy(true); setError(undefined)
    try {
      const raw = await api.request(path, 'POST', body, attempt.current.key, abort.signal); if (abort.signal.aborted) return
      const result = skillPublication(raw), expectedStatus = editor.kind === 'assignment' ? 'published'
        : editor.decision === 'publish' ? 'published' : editor.decision === 'reject' ? 'rejected' : 'withdrawn'
      if (!same({ ...result, status: selected.status, revision: selected.revision, reviewReason: selected.reviewReason }, selected)
        || result.status !== expectedStatus || result.revision !== selected.revision + 1
        || editor.kind === 'review' && result.reviewReason !== reason.trim()
        || editor.kind === 'assignment' && (result.reviewReason !== selected.reviewReason
          || JSON.stringify(skillAssignments({ publication: raw, assignments: [object(raw).assignment] }).assignments[0]) !== JSON.stringify(rule))) return invalid()
      setMessage('技能变更已保存，原因与操作已记录审计；不会自动安装、启用或运行成员技能。')
      setEditor(undefined); setDetail(undefined); attempt.current = undefined; setReload(x => x + 1)
    } catch (failure) {
      if (!abort.signal.aborted) {
        setError(failure)
        if (failure instanceof ApiFailure && [401, 403, 404].includes(failure.status)) { setDetail(undefined); setInventory(undefined); setEditor(undefined) }
      }
    } finally { lock.current = false; if (!abort.signal.aborted) setBusy(false) }
  }
  const member = (id: string | null) => { const user = inventory?.members.find(x => x.userId === id); return user ? `${user.displayName} (@${user.username})` : id }
  const subjectName = (rule: AssignmentView) => rule.subjectKind === 'all' ? '企业全员' : rule.subjectKind === 'user' ? member(rule.subjectId)
    : inventory?.groups.find(x => x.groupId === rule.subjectId)?.name ?? rule.subjectId
  const rows = inventory?.rows.filter(x => (status === 'all' || status === x.status) && `${x.name} ${member(x.sourceUserId)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const unavailable = busy || !!editor
  return <section aria-label="技能审核与分配"><header data-enterprise-toolbar><h3>技能审核与分配</h3>
    <button data-paimind-ui-button disabled={unavailable} onClick={() => setReload(x => x + 1)}>刷新技能发布</button></header>
    <p>审核完整封存内容后再批准；批准不自动授予使用权限。源码编辑与提交由原技能中心负责。</p>
    {message && <p role="status">{message}</p>}{!!error && <p role="alert">{error instanceof Error ? error.message : '技能管理未确认'}；未知结果请保留原操作重试。</p>}
    {!inventory && !error && <p role="status">正在读取技能发布、成员与组…</p>}
    {inventory && <><label>搜索技能发布<input type="search" disabled={unavailable} value={query} onChange={event => setQuery(event.currentTarget.value)} /></label>
      <label>技能发布状态<select disabled={unavailable} value={status} onChange={event => setStatus(event.currentTarget.value)}><option value="all">全部状态</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {!rows?.length && <p role="status">{inventory.rows.length ? '没有匹配的技能发布。' : '暂无提交审核的技能。创建或安装不会自动发布。'}</p>}
      <ul data-enterprise-list>{rows?.map(row => <li data-enterprise-row key={row.publicationId}><div><strong>{row.name}</strong><p>{member(row.sourceUserId)} · {labels[row.status]} · 修订 {row.revision}</p></div>
        <button data-paimind-ui-button disabled={unavailable} onClick={() => { setSelected(row.publicationId); setError(undefined); setMessage('') }}>查看技能发布 {row.name}</button></li>)}</ul></>}
    {selected && inventory && !detail && !error && <p role="status">正在核对技能版本和分配…</p>}
    {detail && <section aria-label="技能发布详情" data-enterprise-form><h3 ref={heading} tabIndex={-1}>{detail.publication.name} · {labels[detail.publication.status]}</h3>
      <p>提交人：{member(detail.publication.sourceUserId)}</p><p>提交原因：{detail.publication.submissionReason}</p><p>审核反馈：{detail.publication.reviewReason ?? '尚未审核'}</p>
      <details><summary>准确版本与来源</summary><p>发布：{detail.publication.publicationId}</p><p>目录版本：{detail.publication.digest}</p><p>封存归档：{detail.publication.archiveDigest}</p></details>
      <PublicationContent api={api} publication={detail.publication} admin disabled={busy} onAvailabilityChange={setContentReady} />
      {detail.publication.status === 'pending' && <p>{contentReady ? '封存正文已完整读取；还需检查附带文件，并明确确认审核判断。读取成功不代表自动通过。' : '批准前请展开封存内容并读取 SKILL.md 的全部分块；内容不可读时仍可拒绝发布。'}</p>}
      <div data-enterprise-actions>{(detail.publication.status === 'pending' ? ['publish', 'reject'] as const : detail.publication.status === 'published' ? ['withdraw'] as const : []).map(decision => <button key={decision} data-paimind-ui-button disabled={unavailable || decision === 'publish' && !contentReady} onClick={event => open({ kind: 'review', decision }, event.currentTarget)}>{decisions[decision]}</button>)}
        {detail.publication.status === 'published' && <button data-paimind-ui-button disabled={unavailable} onClick={event => open({ kind: 'assignment' }, event.currentTarget)}>新增技能分配</button>}</div>
      <h4>技能分配规则</h4><p>用户明确拒绝优先；其余依次匹配用户、有效成员组和全员允许。撤销一条允许规则不排除其他授权；撤销拒绝可能恢复其他授权。</p>
      {!detail.assignments.length && <p>尚无技能分配规则。</p>}
      <ul data-enterprise-list>{detail.assignments.map(rule => <li data-enterprise-row key={`${rule.subjectKind}:${rule.subjectId}`}><span>{subjectName(rule)} · {rule.effect === 'deny' ? '明确拒绝' : '允许'} · {rule.active ? '启用' : '已撤销'}</span>
        <button data-paimind-ui-button disabled={unavailable || detail.publication.status !== 'published'} onClick={event => open({ kind: 'assignment', rule }, event.currentTarget)}>编辑技能分配 {subjectName(rule)}</button></li>)}</ul>
    </section>}
    {editor && detail && <form aria-label="确认技能管理变更" data-enterprise-form onSubmit={event => { void save(event) }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() }
    }}><fieldset disabled={busy}><legend>{editor.kind === 'review' ? decisions[editor.decision] : '管理技能分配'} · 修订 {detail.publication.revision}</legend>
      {editor.kind === 'assignment' && <>{editor.rule ? <p>固定对象：{subjectName(editor.rule)}</p> : <>
        <label>技能分配范围<select value={kind} onChange={event => { setKind(event.currentTarget.value as AssignmentView['subjectKind']); setSubject(''); setEffect('allow') }}><option value="user">指定账户</option><option value="group">指定成员组</option><option value="all">企业全员</option></select></label>
        {kind !== 'all' && <label>技能分配对象<select required value={subject} onChange={event => setSubject(event.currentTarget.value)}><option value="">请选择</option>{kind === 'user'
          ? inventory?.members.map(row => <option key={row.userId} value={row.userId}>{member(row.userId)}</option>)
          : inventory?.groups.filter(row => row.status === 'active').map(row => <option key={row.groupId} value={row.groupId}>{row.name}</option>)}</select></label>}</>}
        <label>技能授权效果<select value={effect} onChange={event => setEffect(event.currentTarget.value as AssignmentView['effect'])}><option value="allow">允许</option>{kind === 'user' && <option value="deny">明确拒绝</option>}</select></label>
        <label data-enterprise-checkbox><input type="checkbox" checked={active} onChange={event => setActive(event.currentTarget.checked)} />启用此技能分配规则（取消即撤销）</label></>}
      <label>技能操作原因<textarea ref={reasonInput} required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.currentTarget.value)} /></label>
      <label data-enterprise-checkbox><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)} />我已检查所选封存内容、版本、分配范围和操作影响</label>
      <button data-paimind-ui-button type="submit" disabled={!confirmed || reason.trim().length < 3 || editor.kind === 'assignment' && kind !== 'all' && !subject || editor.kind === 'review' && editor.decision === 'publish' && !contentReady}>{busy ? '正在提交技能变更…' : '确认技能变更'}</button>
      <button data-paimind-ui-button type="button" onClick={cancel}>取消技能变更</button>
    </fieldset></form>}
  </section>
}
