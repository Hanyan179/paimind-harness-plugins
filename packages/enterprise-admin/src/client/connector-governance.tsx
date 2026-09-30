import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { EnterpriseApi } from './api.js'
import { connectorApproval, connectorApprovalState, connectorActivationCommand, connectorActivationCommandState, connectorCommandState, matchesConnectorActivationIntent,
  type ConnectorActivationSnapshot, type ConnectorApproval, type ConnectorActivationCommand, type ConnectorActivationIntent, type ConnectorCommand } from './connector-view.js'

type Action = 'read' | 'approve' | 'revoke' | 'enable' | 'disable' | 'resolve'
const labels: Record<Action, string> = { read: '读取批准记录', approve: '批准当前配置版本', revoke: '撤销批准', enable: '启用连接器', disable: '停用连接器', resolve: '核验替代环境并结束启停旧操作追认' }
const outcomes = { enabled: '该次启用操作已确认；不代表现在仍获准使用，也未验证外部连接。', disabled: '该次停用操作已确认；当前状态须重新读取。',
  conflict: '启停配置修订冲突，本次未写入；请重新读取原生状态。', unconfirmed: '启停结果未确认，可能已经生效。禁止重复提交或更换请求标识。',
  superseded: '已结束旧启停操作追认；历史效果仍未知，没有重发或证明回退。' }

/** Settings-only projection. Approval, native configuration and execution authority
 * remain with their existing owners; no polling, storage or automatic resend. */
export function ConnectorGovernance({ api, target, memberName, active, snapshot, onEditing, onChanged }: {
  api: EnterpriseApi; target: string; memberName: string; active: boolean; snapshot?: ConnectorActivationSnapshot | undefined
  onEditing: (value: boolean) => void; onChanged: () => void
}): JSX.Element {
  const [entryId, setEntryId] = useState(''), [approval, setApproval] = useState<ConnectorApproval | null>()
  const [command, setCommand] = useState<ConnectorActivationCommand | null>(), [configurationCommand, setConfigurationCommand] = useState<ConnectorCommand | null>()
  const [draft, setDraft] = useState<Action>(), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [stale, setStale] = useState(false), [error, setError] = useState(''), [focusRequest, setFocusRequest] = useState(0)
  const current = useRef<AbortController>(), mutation = useRef(false), opener = useRef<HTMLButtonElement | null>(null)
  const reasonField = useRef<HTMLTextAreaElement>(null), feedback = useRef<HTMLDivElement>(null)
  useEffect(() => () => { current.current?.abort(); current.current = undefined }, [api, target])
  useEffect(() => { onEditing(Boolean(draft) || busy); return () => onEditing(false) }, [draft, busy, onEditing])
  useEffect(() => { if (draft) reasonField.current?.focus() }, [draft])
  useEffect(() => { if (focusRequest && !draft && !busy) opener.current?.focus() }, [focusRequest, draft, busy])
  useEffect(() => { if (error || approval !== undefined || command !== undefined) feedback.current?.focus() }, [error, approval, command])
  const entry = snapshot?.lifecycle.entries.find(row => row.entryId === entryId)
  const pending = command?.outcome === 'unconfirmed' || configurationCommand?.outcome === 'unconfirmed'
  const known = command !== undefined && configurationCommand !== undefined
  const currentEntry = active && snapshot?.targetUserId === target && entry?.configurationVersion && !stale
  const replaceable = command?.outcome === 'unconfirmed' && active && snapshot?.targetUserId === target && command.intent.expectedCellRevision !== snapshot.cellRevision
  const approvedVersion = approval?.decision === 'approved' && approval.configurationVersion === entry?.configurationVersion
    && approval.serverName === entry?.serverName && approval.transport === entry?.transport
  const eligible: Record<Action, boolean> = {
    read: /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(entryId),
    approve: Boolean(currentEntry && known && !pending && approval !== undefined),
    revoke: approval?.decision === 'approved',
    enable: Boolean(currentEntry && known && !pending && approvedVersion && !entry?.enabled),
    disable: Boolean(currentEntry && known && !pending && entry?.enabled),
    resolve: Boolean(replaceable),
  }
  const open = (action: Action, button: HTMLButtonElement) => {
    if (current.current || draft || !eligible[action]) return
    opener.current = button; setDraft(action); setReason(''); setConfirmed(false); setError('')
  }
  const cancel = () => { if (current.current) return; setDraft(undefined); setReason(''); setConfirmed(false); setError(''); setFocusRequest(value => value + 1) }
  const stop = () => {
    current.current?.abort(); current.current = undefined; setBusy(false); setDraft(undefined); setReason(''); setConfirmed(false)
    setError(mutation.current ? '已停止等待，未撤销操作；请读取批准或操作记录确认结果，不要重复提交。' : '已停止读取，未采用迟到结果。')
  }
  const readCommands = async () => {
    if (current.current || draft) return
    const abort = new AbortController(); current.current = abort; mutation.current = false; setBusy(true); setError(''); setCommand(undefined); setConfigurationCommand(undefined)
    try {
      const [activation, configuration] = await Promise.all([
        api.request('/admin/connector-activation-command-state', 'POST', { targetUserId: target }, crypto.randomUUID(), abort.signal),
        api.request('/admin/connector-command-state', 'POST', { targetUserId: target }, crypto.randomUUID(), abort.signal),
      ])
      const latest = connectorActivationCommandState(activation, target), config = connectorCommandState(configuration, target)
      if (!abort.signal.aborted && current.current === abort) { setCommand(latest); setConfigurationCommand(config) }
    } catch (error) { if (!abort.signal.aborted && current.current === abort) setError(error instanceof Error ? error.message : '连接器操作记录读取失败') }
    finally { if (current.current === abort) { current.current = undefined; setBusy(false) } }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft || !eligible[draft] || current.current || !confirmed || reason.trim().length < 3 || reason.trim().length > 500) return
    const action = draft, previous = approval, previousCommand = command, auditReason = reason.trim()
    const selection = { targetUserId: target, entryId, reason: auditReason, confirmed: true as const }
    let body: object = selection, path = '/admin/connector-approval-state', intent: ConnectorActivationIntent | undefined
    if (action === 'approve' || action === 'revoke') {
      path = '/admin/connector-approvals'
      body = { ...selection, expectedApprovalRevision: previous?.revision ?? 0, decision: action === 'approve' ? 'approved' : 'revoked',
        ...(action === 'approve' ? { expectedCellRevision: snapshot!.cellRevision, expectedConfigurationRevision: snapshot!.lifecycle.revision } : {}) }
    } else if (action === 'enable' || action === 'disable') {
      path = '/admin/connector-activation-commands'
      intent = { ...selection, expectedCellRevision: snapshot!.cellRevision, expectedConfigurationRevision: snapshot!.lifecycle.revision,
        configurationVersion: entry!.configurationVersion!, enabled: action === 'enable', expectedApprovalRevision: action === 'enable' ? previous!.revision : null }
      body = intent
    } else if (action === 'resolve') {
      path = `/admin/connector-activation-commands/${previousCommand!.commandId}/resolve`
      body = { expectedCellRevision: snapshot!.cellRevision, reason: auditReason, confirmed: true }
    }
    const abort = new AbortController(); current.current = abort; mutation.current = action !== 'read'; setBusy(true); setError(''); setDraft(undefined); setReason(''); setConfirmed(false)
    if (['read','approve','revoke'].includes(action)) setApproval(undefined)
    else { setCommand(undefined); setStale(true); onChanged() }
    try {
      const value = await api.request(path, 'POST', body, crypto.randomUUID(), abort.signal)
      if (abort.signal.aborted || current.current !== abort) return
      if (action === 'read') setApproval(connectorApprovalState(value, target, entryId))
      else if (action === 'approve' || action === 'revoke') {
        const next = connectorApproval(value, target, entryId)
        if (next.decision !== (action === 'approve' ? 'approved' : 'revoked') || next.revision !== (previous?.revision ?? 0) + 1 || next.reason !== auditReason
          || action === 'approve' && (next.configurationVersion !== entry!.configurationVersion || next.serverName !== entry!.serverName || next.transport !== entry!.transport)
          || action === 'revoke' && (next.configurationVersion !== previous!.configurationVersion || next.imageId !== previous!.imageId || next.policyDigest !== previous!.policyDigest)) throw Error('批准操作与回执不匹配，请重新读取记录')
        setApproval(next)
      } else {
        const next = connectorActivationCommand(value, target)
        if (action === 'resolve' ? next.commandId !== previousCommand!.commandId || next.outcome !== 'superseded' || next.resolvedCellRevision !== snapshot!.cellRevision
          || !matchesConnectorActivationIntent(next.intent, previousCommand!.intent) : !intent || !matchesConnectorActivationIntent(next.intent, intent)) throw Error('启停操作与回执不匹配，请读取操作记录')
        setCommand(next)
      }
    } catch (error) { if (!abort.signal.aborted && current.current === abort) setError(`${error instanceof Error ? error.message : '连接器操作失败'}${action === 'read' ? '' : '；结果未确认，请读取记录，不要重复提交。'}`) }
    finally { if (current.current === abort) { current.current = undefined; setBusy(false) } }
  }
  return <section aria-label="连接器批准与启停管理" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) cancel() } }}>
    <h4>为 {memberName} 管理批准与启停</h4>
    <p>批准记录与启停回执均为历史记录，不是当前使用许可。撤销批准不等于已停用；实际调用仍核验当前权限。</p>
    {!active && <p>成员已停用，仍可读取历史记录和撤销批准；不能批准或启停运行配置。</p>}
    {!snapshot && <p>批准和启停前，请先在上方读取原生启停状态。运行单元离线时，可凭已知条目编号读取并撤销批准。</p>}
    <label>治理条目编号<input value={entryId} maxLength={64} autoComplete="off" disabled={busy || Boolean(draft)} onChange={event => { setEntryId(event.currentTarget.value); setApproval(undefined); setError('') }} /></label>
    {snapshot && snapshot.lifecycle.entries.length > 0 && <div data-enterprise-actions>{snapshot.lifecycle.entries.map(row => <button type="button" data-paimind-ui-button key={row.entryId} disabled={busy || Boolean(draft)} onClick={() => { setEntryId(row.entryId); setApproval(undefined); setError('') }}>选择 {row.serverName}（{row.entryId}）</button>)}</div>}
    <div ref={feedback} tabIndex={-1}>
      {error && <p role="alert">{error}</p>}{busy && <p role="status" aria-busy="true">正在处理批准或启停记录，请勿重复提交…</p>}
      {approval === null && <p role="status">所选条目尚无批准记录。</p>}
      {approval && <><p role="status">{approval.decision === 'approved' ? '历史批准记录已批准' : '历史批准记录已撤销'} · 修订 {approval.revision}</p>
        <details><summary>批准记录追溯</summary><p>条目：{approval.entryId} · 服务：{approval.serverName}</p><p>配置版本：{approval.configurationVersion}</p><p>镜像：{approval.imageId}</p><p>策略：{approval.policyDigest}</p><p>原因：{approval.reason}</p></details>
        {entry && approval.configurationVersion !== entry.configurationVersion && <p>批准记录与观察到的配置版本不一致，不能用旧批准启用。</p>}</>}
      {known && command === null && <p role="status">未发现该成员的连接器启停操作记录。</p>}
      {command && <><p role="status">{outcomes[command.outcome]}</p><details><summary>启停操作追溯</summary><p>操作编号：{command.commandId}</p><p>条目：{command.intent.entryId} · 原因：{command.intent.reason}</p><p>这是历史回执，不证明当前运行状态或使用许可。</p></details></>}
      {configurationCommand?.outcome === 'unconfirmed' && <p>该成员的停用配置操作仍未确认；请在停用配置页读取原操作，不得新批准或启停。</p>}
      {stale && <p>原生状态已过期，请重新读取启停状态；读取操作记录不会重发操作。</p>}
    </div>
    <div data-enterprise-actions><button type="button" data-paimind-ui-button disabled={busy || Boolean(draft)} onClick={() => { void readCommands() }}>读取启停操作记录</button>
      {(['read','approve','revoke','enable','disable'] as const).map(action => <button type="button" data-paimind-ui-button key={action} disabled={busy || Boolean(draft) || !eligible[action]} onClick={event => open(action, event.currentTarget)}>{labels[action]}</button>)}
      {replaceable && <button type="button" data-paimind-ui-button disabled={busy || Boolean(draft)} onClick={event => open('resolve', event.currentTarget)}>{labels.resolve}</button>}
      {busy && <button type="button" data-paimind-ui-button onClick={stop}>停止等待批准／启停结果</button>}
    </div>
    {!known && <p>新批准或启停前须读取该成员的操作记录，确认没有结果未知的配置或启停。</p>}
    {command?.outcome === 'unconfirmed' && !replaceable && <p>同一运行单元不能结束未知启停追认。须由部署人员先停止旧单元并准入同数据、镜像与策略的替代单元；撤销批准仍可用。</p>}
    {draft && <form aria-label="确认连接器治理操作" data-enterprise-form onSubmit={event => { void submit(event) }} onChange={event => { if ((event.target as HTMLInputElement).name !== 'confirmed') setConfirmed(false) }}>
      <fieldset disabled={busy}><legend>{labels[draft]} · {memberName} · {draft === 'resolve' ? command?.intent.entryId : entryId}</legend>
        <label>治理原因<textarea ref={reasonField} required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.currentTarget.value)} /></label>
        {draft === 'approve' && <p>仅批准观察到的准确配置版本，不自动启用，也不授予绕过当前权限检查的使用权。</p>}
        {draft === 'revoke' && <p>撤销修订 {approval?.revision} 的批准。即使成员停用或运行单元离线仍可提交；此回执不证明进程已停止。</p>}
        {draft === 'enable' && <p>将保存启用意图并尝试启动原生提供方；须保持准确配置及批准修订有效，外部连接和工具调用仍可能失败。</p>}
        {draft === 'disable' && <p>保存停用意图并卸载该原生连接器，不要求继续批准；不会删除配置、会话或其他连接器。</p>}
        {draft === 'resolve' && <p>服务端必须核验旧单元已隔离的替代环境。历史效果仍未知，不重发、不回退，不自动启停。</p>}
        <label data-enterprise-checkbox><input name="confirmed" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)} />我确认成员、条目、操作影响与原因，并记录审计。</label>
        <div data-enterprise-actions><button type="submit" data-paimind-ui-button data-variant="primary" disabled={!confirmed || reason.trim().length < 3}>确认治理操作</button>
          <button type="button" data-paimind-ui-button onClick={cancel}>放弃未提交治理操作</button></div>
      </fieldset>
    </form>}
  </section>
}
