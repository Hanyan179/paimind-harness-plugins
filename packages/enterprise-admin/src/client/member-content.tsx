import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { HarnessSessionInspectionPage, HarnessSessionInspectionSelection } from '@paimind/harness-compat/gateway-transport'
import { EnterpriseApi, memberViews, type AccountView } from './api.js'

interface ReadReceipt {
  data: HarnessSessionInspectionPage
  disclosure: { memberId: string; memberName: string; reason: string; requestId: string; readOnly: true; authorizedAt: string; completedAt: string }
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('只读查看响应格式无效')
  return value as Record<string, unknown>
}
function receipt(value: unknown, memberId: string, reason: string, selected: HarnessSessionInspectionSelection): ReadReceipt {
  const row = object(value), page = object(row.data), disclosure = object(row.disclosure)
  if (disclosure.memberId !== memberId || disclosure.reason !== reason || disclosure.readOnly !== true
    || typeof disclosure.memberName !== 'string' || typeof disclosure.requestId !== 'string'
    || ![disclosure.authorizedAt, disclosure.completedAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))) throw Error('只读审计回执不匹配')
  if (page.kind !== selected.kind) throw Error('只读查看目标不匹配')
  if (page.kind === 'sessions') {
    if (!Array.isArray(page.items) || page.items.length > 500) throw Error('会话列表响应无效')
    for (const item of page.items) {
      const row = object(item)
      if (typeof row.sessionId !== 'string' || row.sessionId.length > 200 || row.title !== null && typeof row.title !== 'string'
        || typeof row.blank !== 'boolean' || typeof row.running !== 'boolean' || typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt)
        || row.presetId !== undefined && typeof row.presetId !== 'string') throw Error('会话列表响应无效')
    }
  } else {
    if (selected.kind !== 'history' || page.sessionId !== selected.sessionId || !Array.isArray(page.messages) || page.messages.length > 10000
      || page.nextBeforeSeq !== null && (!Number.isSafeInteger(page.nextBeforeSeq) || Number(page.nextBeforeSeq) <= 0
        || selected.beforeSeq !== undefined && Number(page.nextBeforeSeq) >= selected.beforeSeq)) throw Error('会话历史响应无效')
    for (const item of page.messages) {
      const row = object(item)
      if (!Number.isSafeInteger(row.seq) || Number(row.seq) < 0 || !['user', 'assistant'].includes(String(row.role))
        || typeof row.text !== 'string' || typeof row.time !== 'number' || !Number.isFinite(row.time)
        || !Number.isSafeInteger(row.omittedBlocks) || Number(row.omittedBlocks) < 0) throw Error('会话消息响应无效')
    }
  }
  return row as unknown as ReadReceipt
}

/** Temporary, inert native Settings view only. Every actual read is separately
 * authorized/audited; this component has no member mutation or send capability. */
export function MemberContentReview({ api }: { api: EnterpriseApi }): JSX.Element {
  const [members, setMembers] = useState<AccountView[]>(), [memberId, setMemberId] = useState('')
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<ReadReceipt>(), [error, setError] = useState<string>(), [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [focusRequest, setFocusRequest] = useState(0)
  const current = useRef<AbortController>(), input = useRef<HTMLTextAreaElement>(null), feedback = useRef<HTMLDivElement>(null)
  const clear = () => { current.current?.abort(); current.current = undefined; setBusy(false); setResult(undefined); setError(undefined) }
  useEffect(() => {
    const abort = new AbortController()
    current.current?.abort(); current.current = undefined
    setMembers(undefined); setMemberId(''); setReason(''); setConfirmed(false); setResult(undefined); setError(undefined); setBusy(false)
    void api.request('/admin/members', 'GET', undefined, undefined, abort.signal).then(memberViews).then(rows => {
      if (!abort.signal.aborted) setMembers(rows.filter(row => row.role === 'member'))
    }).catch(error => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : '成员列表读取失败') })
    return () => { abort.abort(); current.current?.abort(); current.current = undefined }
  }, [api, reload])
  useEffect(() => { if (result || error) feedback.current?.focus() }, [result, error])
  useEffect(() => { if (focusRequest) input.current?.focus() }, [focusRequest])
  const valid = confirmed && reason.trim().length >= 3 && reason.trim().length <= 500 && members?.some(row => row.userId === memberId)
  const read = async (selected: HarnessSessionInspectionSelection) => {
    if (!valid || current.current) return
    const abort = new AbortController(), selectedReason = reason.trim(), selectedMember = memberId
    current.current = abort; setBusy(true); setResult(undefined); setError(undefined)
    try {
      const value = await api.request('/admin/member-content', 'POST', { memberId: selectedMember, reason: selectedReason, confirmed: true,
        selection: selected.kind === 'sessions' ? selected : { ...selected, beforeSeq: selected.beforeSeq ?? null } }, crypto.randomUUID(), abort.signal)
      if (!abort.signal.aborted && current.current === abort) setResult(receipt(value, selectedMember, selectedReason, selected))
    } catch (error) {
      if (!abort.signal.aborted && current.current === abort) setError(error instanceof Error ? error.message : '成员内容读取失败')
    } finally { if (current.current === abort) { current.current = undefined; setBusy(false) } }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); void read({ kind: 'sessions' }) }
  const close = () => { clear(); setConfirmed(false); setFocusRequest(value => value + 1) }
  return <div onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
    <div data-enterprise-toolbar><h3>成员会话只读查看</h3><button data-paimind-ui-button type="button" onClick={close}>关闭内容／停止等待</button></div>
    <p data-paimind-ui-summary>请选择具体成员并填写工作原因。每次列表和历史读取都会先记录审计，不会以成员身份登录、发送消息或修改内容。</p>
    {members === undefined && !error && <p role="status" aria-busy="true">正在读取成员…</p>}
    {members?.length === 0 && <p role="status">暂无可选择的使用人员。</p>}
    {members !== undefined && <form data-enterprise-form onSubmit={submit}>
      <fieldset disabled={busy} aria-busy={busy}><legend>确认只读访问</legend>
        <label>成员<select required value={memberId} onChange={event => { clear(); setMemberId(event.currentTarget.value); setConfirmed(false) }}>
          <option value="">请选择成员</option>{members.map(member => <option key={member.userId} value={member.userId}>{member.displayName}（{member.username}）{member.status === 'disabled' ? ' · 已停用' : ''}</option>)}
        </select></label>
        <label>查看原因<textarea ref={input} required minLength={3} maxLength={500} value={reason} onChange={event => { clear(); setReason(event.currentTarget.value); setConfirmed(false) }} /></label>
        <label data-enterprise-checkbox><input type="checkbox" checked={confirmed} onChange={event => { clear(); setConfirmed(event.currentTarget.checked) }} />我确认访问所选成员的会话内容，并知晓原因与访问记录将保留审计。</label>
        <button data-paimind-ui-button type="submit" data-variant="primary" disabled={!valid}>{busy ? '正在读取…' : '记录原因并读取会话列表'}</button>
      </fieldset>
    </form>}
    <div ref={feedback} tabIndex={-1}>
      {error && <p role="alert">{error}；未展示旧内容。{members === undefined && <button type="button" data-paimind-ui-button onClick={() => setReload(value => value + 1)}>重试成员列表</button>}</p>}
      {busy && <p role="status" aria-busy="true">正在授权、记录审计并读取原生会话…</p>}
      {result && <>
        <p role="status">正在只读查看 {result.disclosure.memberName}。原因：{result.disclosure.reason}。本次访问已记录审计，不代表已读完全部内容。</p>
        <details><summary>访问追溯信息</summary><p>请求编号：{result.disclosure.requestId}</p><p>读取完成：{result.disclosure.completedAt}</p></details>
        {result.data.kind === 'sessions' ? <>
          {result.data.items.length === 0 && <p role="status">该成员的原生会话列表为空。</p>}
          <ul data-enterprise-list>{result.data.items.map(session => <li key={session.sessionId}>
            <strong>{session.title ?? '未命名会话'}</strong><p>{session.blank ? '空白会话' : '已有会话记录'} · {session.running ? '正在运行' : '未运行'}</p>
            <p>智能体预设：{session.presetId ?? '原生默认'} · 更新时间：{new Date(session.updatedAt).toLocaleString()}</p>
            <button data-paimind-ui-button type="button" disabled={busy || !valid} onClick={() => void read({ kind: 'history', sessionId: session.sessionId })}>只读查看历史</button>
            <details><summary>会话编号</summary><code>{session.sessionId}</code></details>
          </li>)}</ul>
        </> : <>
          <p data-paimind-ui-summary>本页仅显示原用户／助手的文字，不展示隐藏推理或执行附件；非文本内容不会被当作已审阅。</p>
          {result.data.messages.length === 0 && <p role="status">本页没有可展示的用户／助手文字消息。</p>}
          <ol data-enterprise-list>{result.data.messages.map(message => <li key={message.seq}>
            <strong>{message.role === 'user' ? result.disclosure.memberName : '助手'}</strong><span> · {new Date(message.time).toLocaleString()}</span>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.text}</pre>
            {message.omittedBlocks > 0 && <p>另有 {message.omittedBlocks} 个非文本内容块未展示。</p>}
          </li>)}</ol>
          <div data-enterprise-actions>
            {result.data.nextBeforeSeq !== null && <button data-paimind-ui-button type="button" disabled={busy || !valid} onClick={() => {
              if (result.data.kind === 'history') void read({ kind: 'history', sessionId: result.data.sessionId, beforeSeq: result.data.nextBeforeSeq! })
            }}>读取较早内容</button>}
            <button data-paimind-ui-button type="button" disabled={busy || !valid} onClick={() => void read({ kind: 'sessions' })}>重新读取会话列表</button>
          </div>
        </>}
      </>}
    </div>
  </div>
}
