import { useEffect, useRef, useState, type FormEvent } from 'react'
import { EnterpriseApi, groupViews, memberViews, type AccountView, type GroupView } from './api.js'
import { publicationAssignments, publicationDetail, publicationView, publicationViews,
  skillPublicationChoices, type SkillPublicationChoice, type AssignmentView, type PublicationDetail, type PublicationView } from './publication-view.js'

type Snapshot = { publications: PublicationView[]; members: AccountView[]; groups: GroupView[] }
type Detail = { publication: PublicationDetail; assignments: AssignmentView[] }
type Editor = { kind: 'review'; decision: 'publish' | 'reject' | 'withdraw'; publication: PublicationDetail }
  | { kind: 'assignment'; publication: PublicationDetail; existing?: AssignmentView }
const statusLabel = { pending: '待审核', published: '已发布', rejected: '已拒绝', withdrawn: '已下架' }
const decisionLabel = { publish: '批准发布', reject: '拒绝发布', withdraw: '下架发布' }
const errorText = (error: unknown) => error instanceof Error ? error.message : '企业资源暂时不可用，请重试'
const ruleKey = (row: AssignmentView) => `${row.subjectKind}:${row.subjectId}`

/** Native Settings governance only. No Preset copy, Session creation or grant
 * cache; a readable review copy never becomes a runnable Agent in this view. */
export function Publications({ api, onEditing }: { api: EnterpriseApi; onEditing: (editing: boolean) => void }): JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<Detail>()
  const [editor, setEditor] = useState<Editor>()
  const [reload, setReload] = useState(0)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [error, setError] = useState<unknown>()
  const [detailError, setDetailError] = useState<unknown>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [skillChoices, setSkillChoices] = useState<SkillPublicationChoice[]>()
  const [skillSelections, setSkillSelections] = useState<Record<string, string>>({})
  const [skillError, setSkillError] = useState<unknown>()
  const [skillReload, setSkillReload] = useState(0)
  const [kind, setKind] = useState<AssignmentView['subjectKind']>('user')
  const [subjectId, setSubjectId] = useState('')
  const [effect, setEffect] = useState<AssignmentView['effect']>('allow')
  const [active, setActive] = useState(true)
  const lock = useRef(false), write = useRef<AbortController>()
  const attempt = useRef<{ fingerprint: string; key: string }>()
  const reasonInput = useRef<HTMLTextAreaElement>(null), detailHeading = useRef<HTMLHeadingElement>(null)
  const refresh = useRef<HTMLButtonElement>(null), opener = useRef<HTMLButtonElement | null>(null)
  const focusAfterSave = useRef(false)
  const dirty = !!editor && (reason !== '' || confirmed || Object.keys(skillSelections).length > 0 || editor.kind === 'assignment'
    && (subjectId !== (editor.existing?.subjectId ?? '') || kind !== (editor.existing?.subjectKind ?? 'user')
      || effect !== (editor.existing?.effect ?? 'allow') || active !== (editor.existing?.active ?? true)))
  useEffect(() => { onEditing(!!editor); return () => onEditing(false) }, [editor, onEditing])
  useEffect(() => () => write.current?.abort(), [])
  useEffect(() => {
    setSkillChoices(undefined); setSkillError(undefined)
    if (editor?.kind !== 'review' || editor.decision !== 'publish' || !editor.publication.dependencies.length) return
    const abort = new AbortController()
    void api.request('/admin/skill-publications', 'GET', undefined, undefined, abort.signal).then(skillPublicationChoices)
      .then(rows => { if (!abort.signal.aborted) setSkillChoices(rows) })
      .catch(error => { if (!abort.signal.aborted) setSkillError(error) })
    return () => abort.abort()
  }, [api, editor, skillReload])
  useEffect(() => {
    const abort = new AbortController()
    setSnapshot(undefined); setDetail(undefined); setError(undefined); setDetailError(undefined)
    void Promise.all([api.request('/admin/publications', 'GET', undefined, undefined, abort.signal).then(publicationViews),
      api.request('/admin/members', 'GET', undefined, undefined, abort.signal).then(memberViews),
      api.request('/admin/groups', 'GET', undefined, undefined, abort.signal).then(groupViews)])
      .then(([publications, members, groups]) => {
        if (abort.signal.aborted) return
        const ids = new Set(members.map(row => row.userId))
        if (ids.size !== members.length || publications.some(row => !ids.has(row.sourceUserId))) throw new Error('发布来源与账户清单不一致，请重新读取')
        setSnapshot({ publications, members, groups })
      }).catch(failure => { if (!abort.signal.aborted) setError(failure) })
    return () => abort.abort()
  }, [api, reload])
  useEffect(() => {
    setDetail(undefined); setDetailError(undefined)
    if (!selectedId || !snapshot) return
    const abort = new AbortController()
    void Promise.all([api.request('/publications/' + selectedId, 'GET', undefined, undefined, abort.signal),
      api.request('/admin/publications/' + selectedId + '/assignments', 'GET', undefined, undefined, abort.signal)])
      .then(([raw, rules]) => {
        if (abort.signal.aborted) return
        const publication = publicationDetail(raw), assignments = publicationAssignments(rules)
        if (publication.publicationId !== selectedId || JSON.stringify(publicationView(raw)) !== JSON.stringify(assignments.publication)
          || !snapshot.members.some(row => row.userId === publication.sourceUserId)
          || assignments.assignments.some(row => row.subjectKind === 'user' ? !snapshot.members.some(user => user.userId === row.subjectId)
            : row.subjectKind === 'group' && !snapshot.groups.some(group => group.groupId === row.subjectId))) throw new Error('发布版本或分配对象已变化，请重新读取详情')
        setDetail({ publication, assignments: assignments.assignments })
      }).catch(failure => { if (!abort.signal.aborted) setDetailError(failure) })
    return () => abort.abort()
  }, [api, selectedId, snapshot])
  useEffect(() => {
    if (editor) reasonInput.current?.focus()
    else if (detail) detailHeading.current?.focus()
    else if (focusAfterSave.current && snapshot) { focusAfterSave.current = false; refresh.current?.focus() }
  }, [editor, detail, snapshot])
  useEffect(() => {
    if (!dirty && !busy) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty, busy])
  const open = (next: Editor, button: HTMLButtonElement) => {
    opener.current = button; attempt.current = undefined; setError(undefined); setMessage('')
    setReason(''); setConfirmed(false); setSkillSelections({}); setEditor(next)
    const existing = next.kind === 'assignment' ? next.existing : undefined
    setKind(existing?.subjectKind ?? 'user'); setSubjectId(existing?.subjectId ?? '')
    setEffect(existing?.effect ?? 'allow'); setActive(existing?.active ?? true)
  }
  const cancel = () => {
    if (lock.current || dirty && !window.confirm('放弃未保存的审核或分配修改？')) return
    setEditor(undefined); setError(undefined); attempt.current = undefined
    // The original action remains mounted until an authoritative reload.
    queueMicrotask(() => opener.current?.focus())
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editor || lock.current || reason.trim().length < 3 || !confirmed || editor.kind === 'assignment' && kind !== 'all' && !subjectId) return
    if (editor.kind === 'review' && editor.decision === 'publish' && editor.publication.dependencies.some(dependency =>
      !skillChoices?.some(choice => choice.publicationId === skillSelections[dependency.name] && choice.status === 'published'
        && choice.name === dependency.name && choice.digest === dependency.digest))) return
    const path = `/admin/publications/${editor.publication.publicationId}/${editor.kind === 'review' ? 'review' : 'assignments'}`
    const body = editor.kind === 'review'
      ? { decision: editor.decision, expectedRevision: editor.publication.revision, reason: reason.trim(),
        ...(editor.decision === 'publish' && editor.publication.dependencies.length ? {
          skillPublications: editor.publication.dependencies.map(row => ({ name: row.name, publicationId: skillSelections[row.name] })) } : {}) }
      : { subjectKind: kind, ...(kind === 'all' ? {} : { subjectId }), effect, active,
        expectedRevision: editor.publication.revision, reason: reason.trim() }
    const fingerprint = JSON.stringify([path, body])
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() }
    const abort = new AbortController(); write.current = abort; lock.current = true; setBusy(true); setError(undefined)
    try {
      const result = publicationView(await api.request(path, 'POST', body, attempt.current.key, abort.signal))
      if (abort.signal.aborted) return
      if (result.publicationId !== editor.publication.publicationId || result.digest !== editor.publication.digest
        || result.sourceUserId !== editor.publication.sourceUserId || result.revision !== editor.publication.revision + 1
        || result.presetId !== editor.publication.presetId || result.configVersion !== editor.publication.configVersion
        || result.status !== (editor.kind === 'assignment' ? 'published' : editor.decision === 'publish' ? 'published' : editor.decision === 'reject' ? 'rejected' : 'withdrawn')) throw new Error('操作回执与所选版本不一致，请重新读取；请勿重复创建变更')
      setMessage(editor.kind === 'review' ? `「${result.name}」${statusLabel[result.status]}，原因和操作已记录审计。批准本身不授予使用权限；使用人员还须获得依赖技能分配并完成准确版本采用。`
        : `「${result.name}」的分配规则已保存，原因和操作已记录审计。分配不等于已完成原生运行采用。`)
      setDetail(undefined); setSnapshot(undefined); setEditor(undefined); attempt.current = undefined
      focusAfterSave.current = true; setReload(value => value + 1)
    } catch (failure) { if (!abort.signal.aborted) setError(failure) }
    finally { lock.current = false; if (!abort.signal.aborted) setBusy(false) }
  }
  const memberName = (id: string) => { const user = snapshot?.members.find(row => row.userId === id); return user ? `${user.displayName} (@${user.username})${user.status === 'disabled' ? ' · 已停用' : ''}` : id }
  const subjectName = (rule: AssignmentView) => rule.subjectKind === 'all' ? '企业全员' : rule.subjectKind === 'user' ? memberName(rule.subjectId!)
    : `${snapshot?.groups.find(group => group.groupId === rule.subjectId)?.name ?? rule.subjectId}${snapshot?.groups.find(group => group.groupId === rule.subjectId)?.status === 'archived' ? ' · 已归档' : ''}`
  const visible = snapshot?.publications.filter(row => (status === 'all' || row.status === status)
    && `${row.name} ${row.description} ${memberName(row.sourceUserId)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const unavailable = busy || !!editor
  return <>
    <div data-enterprise-toolbar><h3>智能体审核与分配</h3><button ref={refresh} data-paimind-ui-button disabled={unavailable} onClick={() => setReload(value => value + 1)}>刷新发布与分配</button></div>
    <p data-paimind-ui-summary>审核准确的已保存版本，再明确分配给使用人员。个人智能体、审核副本和企业分配是不同来源；此处不能直接开始对话。</p>
    <p role="status" data-enterprise-feedback>{message}</p>
    {error ? <p role="alert">{errorText(error)}</p> : null}
    {!snapshot && !error && <p role="status" aria-busy="true">正在读取发布、成员和组…</p>}
    {snapshot && <><div data-enterprise-actions><label>搜索企业发布<input type="search" value={query} disabled={unavailable} onChange={event => setQuery(event.currentTarget.value)} /></label>
      <label>发布状态<select value={status} disabled={unavailable} onChange={event => setStatus(event.currentTarget.value)}><option value="all">全部状态</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      {visible?.length === 0 && <p role="status">{snapshot.publications.length ? '当前筛选没有匹配的发布。' : '暂无提交审核的智能体。个人创建不自动提交或发布。'}</p>}
      <ul data-enterprise-list>{visible?.map(row => <li key={row.publicationId} data-enterprise-row><div><strong>{row.name}</strong><p>{memberName(row.sourceUserId)} · {statusLabel[row.status]} · 修订 {row.revision}</p><p>{row.description}</p></div>
        <button data-paimind-ui-button disabled={unavailable} aria-expanded={selectedId === row.publicationId} aria-label={`查看发布 ${row.name}`} onClick={() => { setSelectedId(row.publicationId); setMessage('') }}>查看详情</button></li>)}</ul>
    </>}
    {selectedId && !detail && snapshot && !detailError && <p role="status" aria-busy="true">正在回读所选版本和分配规则…</p>}
    {detailError ? <p role="alert">{errorText(detailError)}</p> : null}
    {detail && <section aria-label="发布详情" data-enterprise-form><h3 ref={detailHeading} tabIndex={-1}>{detail.publication.name} · {statusLabel[detail.publication.status]}</h3>
      <p>提交人：{memberName(detail.publication.sourceUserId)} · 审核修订 {detail.publication.revision}</p>
      <p>提交原因：{detail.publication.submissionReason}</p>{detail.publication.reviewReason && <p>审核原因：{detail.publication.reviewReason}</p>}
      <p data-paimind-ui-summary>这是不可变审核副本。作者或管理员能查看不等于获得运行授权；分配和实际采用分别验证。</p>
      <details><summary>查看配置、准确版本和摘要</summary><p>发布编号：{detail.publication.publicationId}</p><p>来源预设：{detail.publication.presetId}</p><p>配置版本：{detail.publication.configVersion}</p><p>内容摘要：{detail.publication.digest}</p><p>原生组合摘要：{detail.publication.nativeCompositionDigest}</p>
        {Object.entries({ 角色: detail.publication.profile.role, 目标: detail.publication.profile.goal, 行为规范: detail.publication.profile.behavior, 补充要求: detail.publication.profile.instructions }).map(([label, value]) => <p key={label} data-enterprise-source>{label}：{value || '无'}</p>)}
        <p>精确技能依赖：{detail.publication.dependencies.length || '无'}</p><ul>{detail.publication.dependencies.map(row => <li key={row.name}>{row.name} · {row.digest}</li>)}</ul></details>
      {detail.publication.dependencies.length > 0 && <p role="status">批准时须明确绑定每个技能的已发布准确版本。智能体分配不会自动扩大技能权限；成员还需获配并采用这些技能。</p>}
      <ul>{detail.publication.skillPublications.map(row => <li key={row.name}>{row.name} · 固定技能发布 {row.publicationId} · {statusLabel[row.status]}</li>)}</ul>
      <div data-enterprise-actions>{(detail.publication.status === 'pending' ? ['publish', 'reject'] as const : detail.publication.status === 'published' ? ['withdraw'] as const : []).map(decision => <button key={decision} data-paimind-ui-button disabled={unavailable}
        onClick={event => open({ kind: 'review', decision, publication: detail.publication }, event.currentTarget)}>{decisionLabel[decision]}</button>)}
        {detail.publication.status === 'published' && <button data-paimind-ui-button disabled={unavailable} onClick={event => open({ kind: 'assignment', publication: detail.publication }, event.currentTarget)}>新增分配规则</button>}</div>
      <h3>分配规则</h3><p data-paimind-ui-summary>用户明确拒绝优先于用户允许、有效组允许和全员允许；未匹配默认拒绝。停用的规则和下架版本保留记录，但不参与当前授权。</p>
      <p data-paimind-ui-summary>撤销一条允许规则后，其他规则仍可能授权。撤销明确拒绝可能恢复其他授权；如需禁止某个账户，应保留启用的用户明确拒绝。</p>
      {detail.assignments.length === 0 && <p>尚未配置分配规则。</p>}
      <ul data-enterprise-list>{detail.assignments.map(row => <li key={ruleKey(row)} data-enterprise-row><div><strong>{subjectName(row)}</strong><p>{row.effect === 'deny' ? '明确拒绝' : '允许'} · {row.active ? '规则启用' : '规则已撤销'}</p></div>
        <button data-paimind-ui-button disabled={unavailable || detail.publication.status !== 'published'} aria-label={`编辑分配 ${subjectName(row)}`} onClick={event => open({ kind: 'assignment', publication: detail.publication, existing: row }, event.currentTarget)}>编辑或撤销</button></li>)}</ul>
    </section>}
    {editor && <form aria-label={editor.kind === 'review' ? '审核智能体发布' : '配置智能体分配'} data-enterprise-form onSubmit={event => { void submit(event) }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() } }}>
      <fieldset disabled={busy} aria-busy={busy}><legend>{editor.kind === 'review' ? decisionLabel[editor.decision] : editor.existing ? '编辑既有分配规则' : '新增分配规则'}：{editor.publication.name}</legend>
        <p>准确配置版本 {editor.publication.configVersion} · 审核修订 {editor.publication.revision}</p>
        {editor.kind === 'review' && editor.decision === 'publish' && editor.publication.dependencies.length > 0 && <>
          <p>为每个依赖选择一个已发布且完整目录摘要一致的技能版本。批准后不能替换这条依赖关系；升级须提交新的智能体版本。</p>
          {!skillChoices && !skillError && <p role="status" aria-busy="true">正在读取可审核的技能发布版本…</p>}
          {skillError ? <><p role="alert">{errorText(skillError)}</p><button type="button" data-paimind-ui-button onClick={() => setSkillReload(value => value + 1)}>重读技能发布</button></> : null}
          {editor.publication.dependencies.map(dependency => {
            const choices = skillChoices?.filter(row => row.status === 'published' && row.name === dependency.name && row.digest === dependency.digest)
            return <label key={dependency.name}>依赖技能 {dependency.name}<select required disabled={!skillChoices} value={skillSelections[dependency.name] ?? ''}
              onChange={event => { const publicationId = event.currentTarget.value; setSkillSelections(current => ({ ...current, [dependency.name]: publicationId })) }}>
              <option value="">请选择准确发布版本</option>{choices?.map(row => <option key={row.publicationId} value={row.publicationId}>{row.name} · {row.publicationId}</option>)}</select>
              {choices?.length === 0 && <span role="status">没有已发布的匹配版本，请先在技能治理中完成该版本发布。</span>}</label>
          })}
        </>}
        {editor.kind === 'assignment' && <>{editor.existing ? <p>固定分配对象：{subjectName(editor.existing)}。此操作不替换为其他成员或组。</p> : <>
          <label>分配范围<select value={kind} onChange={event => { setKind(event.currentTarget.value as AssignmentView['subjectKind']); setSubjectId(''); setEffect('allow') }}><option value="user">指定账户</option><option value="group">指定成员组</option><option value="all">企业全员</option></select></label>
          {kind !== 'all' && <label>{kind === 'user' ? '分配账户' : '分配成员组'}<select required value={subjectId} onChange={event => setSubjectId(event.currentTarget.value)}><option value="">请选择</option>{kind === 'user'
            ? snapshot?.members.map(row => <option key={row.userId} value={row.userId}>{memberName(row.userId)}</option>)
            : snapshot?.groups.filter(row => row.status === 'active').map(row => <option key={row.groupId} value={row.groupId}>{row.name}</option>)}</select></label>}</>}
          <label>授权效果<select value={effect} onChange={event => setEffect(event.currentTarget.value as AssignmentView['effect'])}><option value="allow">允许</option>{kind === 'user' && <option value="deny">明确拒绝（优先）</option>}</select></label>
          <label data-enterprise-checkbox><input type="checkbox" checked={active} onChange={event => setActive(event.currentTarget.checked)} /><span>启用此分配规则（取消勾选即撤销该规则）</span></label>
          {!active && <p role="status">{effect === 'deny' ? '撤销明确拒绝后，该账户可能重新获得组或全员授权。' : '仅撤销这一条允许规则，其他允许规则仍可能生效。'}</p>}
          {kind === 'all' && <p>范围包含企业全部账户，但用户明确拒绝仍优先，停用账户不会因此恢复。</p>}</>}
        <label>操作原因<textarea ref={reasonInput} required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.currentTarget.value)} /></label>
        <label data-enterprise-checkbox><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)} /><span>我已核对资源、版本、分配范围和操作影响</span></label>
        <div data-enterprise-actions><button data-paimind-ui-button type="submit" disabled={!confirmed || reason.trim().length < 3
          || editor.kind === 'assignment' && kind !== 'all' && !subjectId
          || editor.kind === 'review' && editor.decision === 'publish' && editor.publication.dependencies.some(dependency => !skillChoices?.some(choice =>
            choice.publicationId === skillSelections[dependency.name] && choice.status === 'published' && choice.name === dependency.name && choice.digest === dependency.digest))}>{busy ? '正在提交…' : '确认提交'}</button><button data-paimind-ui-button type="button" onClick={cancel}>取消</button></div>
      </fieldset>
    </form>}
  </>
}
