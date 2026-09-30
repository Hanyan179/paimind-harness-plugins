import { useEffect, useRef, useState, type FormEvent } from 'react'
import { EnterpriseApi, groupView, groupViews, memberViews, type AccountView, type GroupView } from './api.js'

type Editor = { mode: 'create' } | { mode: 'edit' | 'status'; group: GroupView }
/** A section in native Settings. Identity and grants are never browser state. */
export function Groups({ api, onEditing }: { api: EnterpriseApi; onEditing: (editing: boolean) => void }): JSX.Element {
  const [snapshot, setSnapshot] = useState<{ groups: GroupView[]; members: AccountView[] }>()
  const [reload, setReload] = useState(0)
  const [error, setError] = useState<unknown>()
  const [message, setMessage] = useState('')
  const [editor, setEditor] = useState<Editor>()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const reasonInput = useRef<HTMLTextAreaElement>(null)
  const focusKey = useRef('create')
  const actions = useRef(new Map<string, HTMLButtonElement>())
  const actionRef = (key: string) => (button: HTMLButtonElement | null) => { if (button) actions.current.set(key, button); else actions.current.delete(key) }
  const pendingFocus = useRef(false)
  const write = useRef<AbortController>()
  const attempt = useRef<{ fingerprint: string; key: string }>()
  const dirty = !!editor && (editor.mode === 'create' ? name !== '' : editor.mode === 'status' ? reason !== ''
    : name !== editor.group.name || JSON.stringify([...selected].sort()) !== JSON.stringify([...editor.group.memberIds].sort()))
  useEffect(() => {
    onEditing(!!editor)
    return () => onEditing(false)
  }, [editor, onEditing])
  useEffect(() => () => { write.current?.abort() }, [])
  useEffect(() => {
    const abort = new AbortController()
    setSnapshot(undefined); setError(undefined)
    void Promise.all([api.request('/admin/groups', 'GET', undefined, undefined, abort.signal).then(groupViews),
      api.request('/admin/members', 'GET', undefined, undefined, abort.signal).then(memberViews)])
      .then(([groups, members]) => {
        if (abort.signal.aborted) return
        const ids = new Set(members.map(member => member.userId))
        if (ids.size !== members.length || groups.some(group => group.memberIds.some(id => !ids.has(id)))) throw new Error('成员列表与分组不一致，请刷新后重试')
        setSnapshot({ groups, members })
      }).catch(failure => { if (!abort.signal.aborted) setError(failure) })
    return () => abort.abort()
  }, [api, reload])
  useEffect(() => {
    if (editor?.mode === 'status') reasonInput.current?.focus()
    else if (editor) input.current?.focus()
    else if (!busy && pendingFocus.current) {
      const button = actions.current.get(focusKey.current)
      if (button && !button.disabled) { pendingFocus.current = false; button.focus() }
    }
  }, [editor, busy, snapshot])
  useEffect(() => {
    if (!dirty && !busy) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty, busy])
  const open = (next: Editor) => {
    focusKey.current = next.mode === 'create' ? 'create' : `${next.mode}:${next.group.groupId}`
    attempt.current = undefined; setError(undefined); setMessage('')
    setName(next.mode === 'create' ? '' : next.group.name)
    setSelected(next.mode === 'create' ? [] : [...next.group.memberIds]); setReason(''); setEditor(next)
  }
  const cancel = () => {
    if (locked.current || (dirty && !window.confirm('放弃未保存的成员组修改？'))) return
    pendingFocus.current = true; setEditor(undefined); setError(undefined); attempt.current = undefined
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editor || locked.current) return
    const target = editor.mode === 'create' ? '/admin/groups' : `/admin/groups/${editor.group.groupId}${editor.mode === 'status' ? '/status' : ''}`
    const body = editor.mode === 'create' ? { name: name.trim() } : editor.mode === 'edit'
      ? { name: name.trim(), memberIds: [...selected].sort(), expectedRevision: editor.group.revision }
      : { status: editor.group.status === 'active' ? 'archived' : 'active', reason: reason.trim(), expectedRevision: editor.group.revision }
    const fingerprint = JSON.stringify([target, body])
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() }
    const abort = new AbortController(); write.current = abort
    locked.current = true; setBusy(true); setError(undefined)
    try {
      const saved = groupView(await api.request(target, editor.mode === 'create' ? 'POST' : 'PATCH', body, attempt.current.key, abort.signal))
      if (abort.signal.aborted) return
      // Do not keep an obsolete selection after a successful server write.
      setSnapshot(undefined); setMessage(`成员组「${saved.name}」已${editor.mode === 'create' ? '创建' : editor.mode === 'edit' ? '保存' : saved.status === 'archived' ? '归档' : '恢复'}。分组本身不授予资源权限。`)
      pendingFocus.current = true; setEditor(undefined); attempt.current = undefined; setReload(value => value + 1)
    } catch (failure) { if (!abort.signal.aborted) setError(failure) }
    finally { locked.current = false; if (!abort.signal.aborted) setBusy(false) }
  }
  const unavailable = busy || !!editor || !snapshot
  return <>
    <div data-enterprise-toolbar><h3>成员组</h3><div data-enterprise-actions>
      <button ref={actionRef('create')} data-paimind-ui-button disabled={unavailable} onClick={() => open({ mode: 'create' })}>新建成员组</button>
      <button data-paimind-ui-button disabled={busy || !!editor} onClick={() => setReload(value => value + 1)}>刷新成员组</button>
    </div></div>
    <p data-paimind-ui-summary>按团队组织账户，为后续资源分配提供对象。加入组不改变角色，也不自动开放智能体或会话；停用账户仍不可使用。</p>
    <p role="status" data-enterprise-feedback>{message}</p>
    {error ? <p role="alert">{error instanceof Error ? error.message : '成员组暂时不可用，请重试'}</p> : null}
    {!snapshot && !error && <p role="status" aria-busy="true">正在读取成员组和账户…</p>}
    {editor && <form aria-label={editor.mode === 'create' ? '新建成员组' : editor.mode === 'edit' ? '编辑成员组' : '变更成员组状态'} data-enterprise-form
      onSubmit={event => { void submit(event) }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() } }}>
      <fieldset disabled={busy}><legend>{editor.mode === 'create' ? '新建成员组' : editor.mode === 'edit' ? `编辑「${editor.group.name}」` : `${editor.group.status === 'active' ? '归档' : '恢复'}「${editor.group.name}」`}</legend>
        {editor.mode === 'status' ? <><p>保留原组编号、成员关系与审计历史，不删除账户或个人资源。</p>
          <label>操作原因<textarea ref={reasonInput} required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.currentTarget.value)} /></label></>
          : <label>成员组名称<input ref={input} required maxLength={120} value={name} onChange={event => setName(event.currentTarget.value)} /></label>}
        {editor.mode === 'edit' && <fieldset><legend>选择账户（已选 {selected.length} 人）</legend>
          {snapshot?.members.map(member => <label key={member.userId} data-enterprise-checkbox><input type="checkbox" checked={selected.includes(member.userId)} onChange={event => { const checked = event.currentTarget.checked; setSelected(ids => checked ? [...ids, member.userId] : ids.filter(id => id !== member.userId)) }} />
            <span>{member.displayName} (@{member.username}) · {member.role === 'admin' ? '管理员' : '成员'}{member.status === 'disabled' ? ' · 已停用' : ''}</span></label>)}
        </fieldset>}
        <div data-enterprise-actions><button data-paimind-ui-button type="submit" disabled={editor.mode === 'status' ? reason.trim().length < 3 : !name.trim()}>{busy ? '正在保存…' : '保存成员组'}</button>
          <button data-paimind-ui-button type="button" onClick={cancel}>取消</button></div>
      </fieldset>
    </form>}
    {snapshot?.groups.length === 0 && <p role="status">暂无成员组。可先创建一个组，再选择现有账户。</p>}
    <ul data-enterprise-list>{snapshot?.groups.map(group => <li key={group.groupId} data-enterprise-row><div><strong>{group.name}</strong>
      <p>{group.status === 'active' ? '使用中' : '已归档'} · {group.memberIds.length} 人 · 版本 {group.revision}</p>
      <p>{group.memberIds.map(id => { const member = snapshot.members.find(row => row.userId === id)!; return `${member.displayName} (@${member.username})${member.status === 'disabled' ? '（已停用）' : ''}` }).join('、') || '尚未添加成员'}</p></div>
      <div data-enterprise-actions><button ref={actionRef(`edit:${group.groupId}`)} data-paimind-ui-button disabled={unavailable || group.status !== 'active'} onClick={() => open({ mode: 'edit', group })} aria-label={`编辑成员组 ${group.name}`}>编辑</button>
        <button ref={actionRef(`status:${group.groupId}`)} data-paimind-ui-button disabled={unavailable} onClick={() => open({ mode: 'status', group })} aria-label={`${group.status === 'active' ? '归档' : '恢复'}成员组 ${group.name}`}>{group.status === 'active' ? '归档' : '恢复'}</button></div>
    </li>)}</ul>
  </>
}
