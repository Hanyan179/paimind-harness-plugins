import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { EnterpriseApi, memberViews, type AccountView } from './api.js'
import { ConnectorGovernance } from './connector-governance.js'
import { connectorSnapshot, connectorActivationSnapshot, connectorCommand, connectorCommandState, matchesConnectorIntent,
  type ConnectorSnapshot, type ConnectorActivationSnapshot, type ConnectorCommand, type ConnectorEntry, type ConnectorIntent } from './connector-view.js'

/** Every potentially sensitive config value lives only in its input element,
 * never React state, storage, URL or a retained retry payload. */
function PrivateValue({ label, name, type = 'text', multiline = false, required = false, defaultValue = '', maxLength = 4096, min, max, pattern, readOnly = false }:
  { label: string; name: string; type?: 'text' | 'password' | 'url' | 'number'; multiline?: boolean; required?: boolean; defaultValue?: string; maxLength?: number; min?: number; max?: number; pattern?: string; readOnly?: boolean }): JSX.Element {
  const current = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const ref = useCallback((node: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (current.current && current.current !== node) current.current.value = ''
    current.current = node
  }, [])
  const props = { name, required, defaultValue, maxLength, readOnly, autoComplete: 'off', spellCheck: false, ref }
  return <label>{label}{multiline ? <textarea {...props} rows={3} /> : <input {...props} type={type} min={min} max={max} pattern={pattern} />}</label>
}
function PrivatePairs({ kind, onChange }: { kind: 'headers' | 'env'; onChange: () => void }): JSX.Element {
  const [rows, setRows] = useState<number[]>([]), sequence = useRef(0)
  const label = kind === 'headers' ? '请求头' : '环境变量'
  return <fieldset><legend>{label}（可选，值不回显）</legend>
    {rows.map((id, index) => <div key={id} data-enterprise-form>
      <PrivateValue label={`${label}名称 ${index + 1}`} name={`${kind}Name`} required maxLength={128} />
      <PrivateValue label={`${label}值 ${index + 1}`} name={`${kind}Value`} type="password" />
      <button type="button" data-paimind-ui-button onClick={() => { setRows(values => values.filter(value => value !== id)); onChange() }}>移除{label} {index + 1}</button>
    </div>)}
    <button type="button" data-paimind-ui-button disabled={rows.length >= 64} onClick={() => { sequence.current++; setRows(values => [...values, sequence.current]); onChange() }}>添加{label}</button>
  </fieldset>
}
function configuration(form: FormData, transport: ConnectorEntry['transport']): object {
  const get = (key: string) => String(form.get(key) ?? '')
  const text = (key: string, max: number, pattern?: RegExp) => { const value = get(key)
    if (!value || value.length > max || /[\u0000-\u001f\u007f]/u.test(value) || pattern && !pattern.test(value)) throw Error('请检查连接器名称、地址和启动参数')
    return value }
  const number = (key: string, min: number, max: number) => { const value = Number(get(key)); if (!Number.isSafeInteger(value) || value < min || value > max) throw Error('超时或重连限制无效'); return value }
  const pairs = (kind: 'headers' | 'env') => {
    const keys = form.getAll(`${kind}Name`).map(String), values = form.getAll(`${kind}Value`).map(String), seen = new Set()
    if (keys.length > 64 || keys.length !== values.length) throw Error('配置项数量无效')
    return Object.fromEntries(keys.map((key, index) => {
      const value = values[index]!, identity = kind === 'headers' ? key.toLowerCase() : key
      if (key.length > 128 || !(kind === 'headers' ? /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u : /^[A-Za-z_][A-Za-z0-9_]*$/u).test(key)
        || ['__proto__','constructor','prototype'].includes(key) || seen.has(identity) || value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value)) throw Error('请求头或环境变量名称重复、格式无效或超出限制')
      seen.add(identity); return [key, value]
    }))
  }
  const initialDelayMs = number('initialDelayMs', 100, 30000)
  const common = { transport, serverName: text('serverName', 32, /^[A-Za-z0-9_-]+$/u), toolCallTimeoutMs: number('toolCallTimeoutMs', 1000, 60000), failOnStartupError: true,
    reconnect: { enabled: get('reconnectEnabled') === 'on', initialDelayMs, maxDelayMs: number('maxDelayMs', initialDelayMs, 120000), maxAttempts: number('maxAttempts', 1, 10) } }
  if (transport === 'streamable-http') {
    let url: URL
    try { url = new URL(text('url', 8192)) } catch { throw Error('请填写完整的网络服务地址') }
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.hash) throw Error('仅接受不含内嵌用户名、密码或片段的网络地址')
    return { ...common, url: url.href, headers: pairs('headers') }
  }
  const raw = get('args'), args = raw ? raw.split('\n') : []
  if (args.length > 64 || args.some(value => value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value))) throw Error('启动参数须每行一个，最多64项')
  const cwd = text('cwd', 4096)
  if (!cwd.startsWith('/')) throw Error('受管运行单元的工作目录须为绝对路径')
  return { ...common, command: text('command', 4096), args, cwd, env: pairs('env') }
}

export function MemberConnectorState({ api, onEditing }: { api: EnterpriseApi; onEditing?: (value: boolean) => void }): JSX.Element {
  const [members, setMembers] = useState<AccountView[]>(), [memberId, setMemberId] = useState(''), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<ConnectorSnapshot>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false)
  const [activation, setActivation] = useState<ConnectorActivationSnapshot>()
  const [stale, setStale] = useState(false), [reload, setReload] = useState(0), [generation, setGeneration] = useState(0), [focusRequest, setFocusRequest] = useState(0)
  const current = useRef<AbortController>(), reasonField = useRef<HTMLTextAreaElement>(null), feedback = useRef<HTMLDivElement>(null)
  const clear = () => { current.current?.abort(); current.current = undefined; setBusy(false); setResult(undefined); setActivation(undefined); setError(''); setStale(false); setGeneration(value => value + 1) }
  useEffect(() => { onEditing?.(editing); return () => onEditing?.(false) }, [editing, onEditing])
  useEffect(() => {
    const abort = new AbortController(); clear(); setMembers(undefined); setMemberId(''); setReason(''); setConfirmed(false); setEditing(false)
    void api.request('/admin/members', 'GET', undefined, undefined, abort.signal).then(memberViews).then(rows => {
      if (!abort.signal.aborted) setMembers(rows.filter(row => row.role === 'member'))
    }).catch(error => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : '成员列表读取失败') })
    return () => { abort.abort(); current.current?.abort(); current.current = undefined }
  }, [api, reload])
  useEffect(() => { if (result || activation || error) feedback.current?.focus() }, [result, activation, error])
  useEffect(() => { if (focusRequest) reasonField.current?.focus() }, [focusRequest])
  const close = () => { clear(); setConfirmed(false); setFocusRequest(value => value + 1) }
  const member = members?.find(row => row.userId === memberId)
  const valid = confirmed && reason.trim().length >= 3 && reason.trim().length <= 500 && member?.status === 'active'
  const read = async (event: { preventDefault(): void }, mode: 'configuration' | 'activation' = 'configuration') => {
    event.preventDefault(); if (!valid || current.current || editing) return
    const abort = new AbortController(), target = memberId
    current.current = abort; setBusy(true); setResult(undefined); setActivation(undefined); setError(''); setStale(false)
    try {
      const value = await api.request(mode === 'activation' ? '/admin/connector-activation-state' : '/admin/connector-configuration', 'POST', { targetUserId: target, reason: reason.trim(), confirmed: true }, crypto.randomUUID(), abort.signal)
      if (!abort.signal.aborted && current.current === abort) {
        if (mode === 'activation') setActivation(connectorActivationSnapshot(value, target))
        else setResult(connectorSnapshot(value, target))
        setGeneration(value => value + 1)
      }
    } catch (error) { if (!abort.signal.aborted && current.current === abort) setError(error instanceof Error ? error.message : '连接器配置读取失败') }
    finally { if (current.current === abort) { current.current = undefined; setBusy(false) } }
  }
  return <div onKeyDown={event => { if (event.key === 'Escape' && !editing) { event.preventDefault(); event.stopPropagation(); close() } }}>
    <div data-enterprise-toolbar><h3>成员连接器配置</h3><button data-paimind-ui-button type="button" disabled={editing} onClick={close}>关闭配置／停止读取</button></div>
    <p data-paimind-ui-summary>沿用所选成员的原生连接器配置。可管理停用配置，或读取启停状态后批准、撤销和启停。读取与历史回执不授予当前使用权限。</p>
    {members === undefined && !error && <p role="status" aria-busy="true">正在读取成员…</p>}
    {members?.length === 0 && <p role="status">暂无使用人员。</p>}
    {members !== undefined && <form data-enterprise-form onSubmit={event => { void read(event) }}><fieldset disabled={busy || editing} aria-busy={busy}><legend>核对成员连接器</legend>
      <label>成员<select required value={memberId} onChange={event => { clear(); setMemberId(event.currentTarget.value); setConfirmed(false) }}><option value="">请选择成员</option>
        {members.map(member => <option key={member.userId} value={member.userId}>{member.displayName}（{member.username}）{member.status === 'disabled' ? ' · 已停用' : ''}</option>)}
      </select></label>
      <label>核对原因<textarea ref={reasonField} required minLength={3} maxLength={500} value={reason} onChange={event => { clear(); setReason(event.currentTarget.value); setConfirmed(false) }} /></label>
      <label data-enterprise-checkbox><input type="checkbox" checked={confirmed} onChange={event => { clear(); setConfirmed(event.currentTarget.checked) }} />我确认读取所选成员的连接器配置状态，并保留原因与审计。</label>
      <button data-paimind-ui-button type="submit" data-variant="primary" disabled={!valid}>{busy ? '正在读取…' : '记录原因并读取连接器配置'}</button>
      <button data-paimind-ui-button type="button" disabled={!valid} onClick={event => { void read(event, 'activation') }}>记录原因并读取启停状态</button>
    </fieldset></form>}
    <div ref={feedback} tabIndex={-1}>{error && <p role="alert">{error}；未展示旧配置。{members === undefined && <button type="button" data-paimind-ui-button onClick={() => setReload(value => value + 1)}>重试成员列表</button>}</p>}
      {busy && <p role="status" aria-busy="true">正在授权、审计并读取原生连接器配置…</p>}
      {result && <><p role="status">已读取 {members?.find(row => row.userId === result.targetUserId)?.displayName} 的停用配置，读取已记录审计。</p>
        {stale && <p role="status">已提交操作，列表是提交前的快照；请重新读取原生配置后再进行下一项变更。</p>}
        {result.configuration.entries.length === 0 && <p>当前没有已保存的受管连接器配置；这不代表运行单元中没有其他原生插件。</p>}
      </>}
      {activation && <section aria-label="连接器启停观察"><p role="status">已读取 {members?.find(row => row.userId === activation.targetUserId)?.displayName} 的启停状态，读取已记录审计。</p>
        {stale && <p role="status">已提交启停操作，以下是提交前的快照，不代表操作后的当前状态。</p>}
        <p>这是读取时的原生状态快照，不是当前数据库批准或使用授权，也未探测外部连接。实际调用仍须重新核验权限。</p>
        {activation.lifecycle.entries.length === 0 && <p>当前没有已保存的受管连接器配置。</p>}
        {activation.lifecycle.entries.length > 0 && <ul data-enterprise-list>{activation.lifecycle.entries.map(entry => <li key={entry.entryId} data-enterprise-row><div>
          <strong>{entry.serverName}</strong><p>{entry.enabled ? '已保存启用意图' : '已保存停用意图'} · {entry.authority === 'live' ? '原生授权门禁存在' : '原生授权门禁未建立'}</p>
          <p>原生插件状态：{entry.phase === null ? '未创建' : ({ pending:'等待依赖',loading:'正在加载',active:'已启动',failed:'启动失败',disposed:'已释放',unloading:'正在卸载' })[entry.phase]}；外部连接未探测。</p>
          <p>条目编号：{entry.entryId} · {entry.transport === 'stdio' ? '本地进程连接' : '远程网络连接'}</p>
          {entry.configurationVersion === null && <p>旧配置未版本化，须显式完整替换后才能批准。</p>}
        </div></li>)}</ul>}
        {activation.lifecycle.entries.some(entry => entry.enabled) && <p>存在启用意图；当前停用配置编辑接口不可用，须先完成持久停用操作，不能将它视为停用配置。</p>}
      </section>}
    </div>
    {result && <ConnectorCommands key={`${result.targetUserId}:${generation}`} api={api} snapshot={result} memberName={members?.find(row => row.userId === result.targetUserId)?.displayName ?? '所选成员'} onEditing={setEditing} onChanged={() => setStale(true)} />}
    {member && !result && !busy && <ConnectorGovernance key={`${memberId}:${generation}`} api={api} target={memberId} memberName={member.displayName} active={member.status === 'active'} snapshot={activation} onEditing={setEditing} onChanged={() => setStale(true)} />}
  </div>
}
const messages = { 'saved-disabled': '原生停用配置变更已保存；没有启用连接器或授权使用。', unchanged: '原生配置与提交内容一致，本次没有改写；仍未启用或授权。',
  conflict: '原生配置修订冲突，本次未写入；请重新读取。', unconfirmed: '操作结果未确认，可能已经保存。不要重复提交或更换请求标识。',
  superseded: '旧操作已结束追认，但历史效果仍未知，没有重发或证明回退。' }
type Draft = { kind: 'upsert' | 'remove' | 'resolve'; entry?: ConnectorEntry }
function ConnectorCommands({ api, snapshot, memberName, onEditing, onChanged }: { api: EnterpriseApi; snapshot: ConnectorSnapshot; memberName: string; onEditing: (value: boolean) => void; onChanged: () => void }): JSX.Element {
  const target = snapshot.targetUserId
  const [command, setCommand] = useState<ConnectorCommand | null>(), [draft, setDraft] = useState<Draft>(), [transport, setTransport] = useState<ConnectorEntry['transport']>('streamable-http')
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [needsRead, setNeedsRead] = useState(false), [reload, setReload] = useState(0)
  const [error, setError] = useState(''), [focusRequest, setFocusRequest] = useState(0)
  const current = useRef<AbortController>(), reasonField = useRef<HTMLTextAreaElement>(null), opener = useRef<HTMLButtonElement | null>(null), feedback = useRef<HTMLDivElement>(null)
  useEffect(() => { onEditing(Boolean(draft) || busy && needsRead); return () => onEditing(false) }, [draft, busy, needsRead, onEditing])
  useEffect(() => {
    const abort = new AbortController(); current.current = abort; setBusy(true); setCommand(undefined); setError('')
    void api.request('/admin/connector-command-state', 'POST', { targetUserId: target }, crypto.randomUUID(), abort.signal).then(value => {
      if (!abort.signal.aborted && current.current === abort) setCommand(connectorCommandState(value, target))
    }).catch(error => { if (!abort.signal.aborted && current.current === abort) setError(error instanceof Error ? error.message : '操作记录读取失败') })
      .finally(() => { if (current.current === abort) { current.current = undefined; setBusy(false) } })
    return () => { abort.abort(); current.current?.abort(); current.current = undefined }
  }, [api, target, reload])
  useEffect(() => { if (draft) reasonField.current?.focus() }, [draft])
  useEffect(() => { if (focusRequest && !draft && !busy) opener.current?.focus() }, [focusRequest, draft, busy])
  useEffect(() => { if (error || command) feedback.current?.focus() }, [error, command])
  const pending = command?.outcome === 'unconfirmed', replacement = pending && command.intent.expectedCellRevision !== snapshot.cellRevision
  const canEdit = !busy && !draft && !needsRead && command !== undefined && !pending
  const open = (value: Draft, button: HTMLButtonElement) => { opener.current = button; setDraft(value); setReason(''); setConfirmed(false); setError(''); setTransport(value.entry?.transport ?? 'streamable-http') }
  const cancel = () => { if (busy) return; setDraft(undefined); setReason(''); setConfirmed(false); setError(''); setFocusRequest(value => value + 1) }
  const stopWaiting = () => { current.current?.abort(); current.current = undefined; setBusy(false); setCommand(undefined); setError('已停止等待，未撤销操作；请读取操作记录确认结果。') }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!draft || !confirmed || reason.trim().length < 3 || reason.trim().length > 500 || current.current) return
    let body: object, intent: ConnectorIntent | undefined
    const resolving = draft.kind === 'resolve', previousId = command?.commandId
    try {
      if (resolving) { if (!replacement || !previousId) return; body = { expectedCellRevision: snapshot.cellRevision, reason: reason.trim(), confirmed: true } }
      else {
        const form = new FormData(event.currentTarget), entryId = draft.entry?.entryId ?? String(form.get('entryId') ?? '')
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(entryId)) throw Error('条目编号须以字母或数字开头，仅含字母、数字、下划线和短横线')
        const kind = draft.kind as 'upsert' | 'remove'
        intent = { targetUserId: target, expectedCellRevision: snapshot.cellRevision, expectedConfigurationRevision: snapshot.configuration.revision,
          change: { kind, entryId }, reason: reason.trim(), confirmed: true }
        body = { ...intent, change: { ...intent.change, ...(kind === 'upsert' ? { configuration: configuration(form, transport) } : {}) } }
      }
      if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 16384) throw Error('配置超过本次提交的16 KiB大小上限，请精简后确认')
    } catch (error) { setConfirmed(false); setError(error instanceof Error ? error.message : '配置表单无效'); return }
    const abort = new AbortController(); current.current = abort
    setBusy(true); setNeedsRead(true); onChanged(); setCommand(undefined); setDraft(undefined); setReason(''); setConfirmed(false); setError('')
    try {
      const path = resolving ? `/admin/connector-commands/${previousId}/resolve` : '/admin/connector-commands'
      const value = connectorCommand(await api.request(path, 'POST', body, crypto.randomUUID(), abort.signal), target)
      if (resolving ? value.commandId !== previousId || value.outcome !== 'superseded' : !intent || !matchesConnectorIntent(value.intent, intent)) throw Error('提交与连接器操作回执不匹配')
      if (!abort.signal.aborted && current.current === abort) setCommand(value)
    } catch (error) { if (!abort.signal.aborted && current.current === abort) setError(`${error instanceof Error ? error.message : '配置提交未完成'}；结果未确认，请读取操作记录，不要重复提交。`) }
    finally { if (current.current === abort) { current.current = undefined; setBusy(false) } }
  }
  return <section aria-label="管理员连接器配置" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() } }}>
    <h4>为 {memberName} 管理停用配置</h4><p data-paimind-ui-summary>配置只由原生文件保存，敏感值不回显。替换时须完整重填；提交后停止等待或关闭页面不等于撤销。</p>
    <div ref={feedback} tabIndex={-1}>{error && <p role="alert">{error}</p>}{busy && <p role="status" aria-busy="true">正在处理连接器操作，请勿重复提交…</p>}
      {command === null && <p role="status">未发现该成员的连接器配置操作记录。</p>}
      {command && <><p role="status">{messages[command.outcome]}</p><details><summary>连接器操作追溯</summary><p>操作编号：{command.commandId}</p><p>原因：{command.intent.reason}</p><p>这是历史回执，不是当前使用授权。</p></details></>}
      {needsRead && <p>请重新读取原生配置后再编辑。读取操作记录不会重发已提交的配置。</p>}
    </div>
    <div data-enterprise-actions><button data-paimind-ui-button type="button" disabled={busy || Boolean(draft)} onClick={() => setReload(value => value + 1)}>读取连接器操作记录</button>
      {busy && needsRead && <button data-paimind-ui-button type="button" onClick={stopWaiting}>停止等待，结果待确认</button>}
      <button data-paimind-ui-button type="button" disabled={!canEdit || snapshot.configuration.entries.length >= 128} onClick={event => open({ kind: 'upsert' }, event.currentTarget)}>新增停用配置</button>
      {replacement && <button data-paimind-ui-button type="button" disabled={busy || Boolean(draft)} onClick={event => open({ kind: 'resolve' }, event.currentTarget)}>核验替代环境并结束连接器旧操作追认</button>}
    </div>
    {snapshot.configuration.entries.length > 0 && <ul data-enterprise-list>{snapshot.configuration.entries.map(entry => <li key={entry.entryId} data-enterprise-row><div><strong>{entry.serverName}</strong><p>{entry.transport === 'stdio' ? '本地进程连接' : '远程网络连接'} · 已停用，未获准使用</p><p>条目编号：{entry.entryId}</p></div><div data-enterprise-actions>
      <button type="button" data-paimind-ui-button disabled={!canEdit} onClick={event => open({ kind: 'upsert', entry }, event.currentTarget)}>替换配置 {entry.serverName}</button>
      <button type="button" data-paimind-ui-button disabled={!canEdit} onClick={event => open({ kind: 'remove', entry }, event.currentTarget)}>删除配置 {entry.serverName}</button>
    </div></li>)}</ul>}
    {pending && !replacement && <p>不能在同一运行单元推断或重试未知结果。如需结束追认，部署人员必须先停止旧单元并准入同数据、镜像与策略的替代单元。</p>}
    {draft && <form data-enterprise-form aria-label="确认连接器配置变更" onSubmit={event => { void submit(event) }} onChange={event => { if ((event.target as HTMLInputElement).name !== 'confirmed') setConfirmed(false) }}>
      <fieldset disabled={busy}><legend>{draft.kind === 'resolve' ? '结束未知操作追认' : draft.kind === 'remove' ? '删除停用配置' : draft.entry ? '完整替换停用配置' : '新增停用配置'} · {memberName}</legend>
        <label>变更原因<textarea ref={reasonField} required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.currentTarget.value)} /></label>
        {draft.kind === 'upsert' && <>
          <PrivateValue label="条目编号" name="entryId" required maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" defaultValue={draft.entry?.entryId ?? ''} readOnly={Boolean(draft.entry)} />
          <PrivateValue label="服务名称" name="serverName" required maxLength={32} pattern="[A-Za-z0-9_-]+" defaultValue={draft.entry?.serverName ?? ''} />
          <label>连接方式<select value={transport} onChange={event => setTransport(event.currentTarget.value as ConnectorEntry['transport'])}>
            <option value="streamable-http">远程网络服务</option><option value="stdio">受管单元内的本地进程</option>
          </select></label>
          {transport === 'streamable-http' ? <div key="http"><PrivateValue label="网络服务地址" name="url" type="url" required maxLength={8192} /><PrivatePairs kind="headers" onChange={() => setConfirmed(false)} /></div>
            : <div key="stdio"><PrivateValue label="启动命令" name="command" required /><PrivateValue label="启动参数（每行一个）" name="args" multiline maxLength={16384} />
              <PrivateValue label="工作目录（受管单元内的绝对路径）" name="cwd" required /><PrivatePairs kind="env" onChange={() => setConfirmed(false)} /></div>}
          <details><summary>超时和重连限制</summary><PrivateValue label="工具调用超时（毫秒）" name="toolCallTimeoutMs" type="number" required min={1000} max={60000} defaultValue="10000" />
            <label data-enterprise-checkbox><input name="reconnectEnabled" type="checkbox" />将来获准启用时允许有界重连</label>
            <PrivateValue label="首次重连等待（毫秒）" name="initialDelayMs" type="number" required min={100} max={30000} defaultValue="500" />
            <PrivateValue label="最长重连等待（毫秒）" name="maxDelayMs" type="number" required min={100} max={120000} defaultValue="30000" />
            <PrivateValue label="最多重连次数" name="maxAttempts" type="number" required min={1} max={10} defaultValue="3" />
          </details><p>连接失败时拒绝启动。当前保存后仍停用，不连接外部服务、不执行启动命令。</p>
          {draft.entry && <p>原地址、参数、请求头和环境变量不会回显；本次内容将完整替换此条目的原配置，未填写的可选项会被清除。</p>}
        </>}
        {draft.kind === 'remove' && <p>仅删除 {draft.entry?.serverName}（{draft.entry?.entryId}）的已停用配置，不删除会话、智能体或其他连接器。</p>}
        {draft.kind === 'resolve' && <p>服务端会核验替代单元，旧操作的历史效果仍未知。此操作不重新发送配置，不代表回退或成功。</p>}
        <label data-enterprise-checkbox><input name="confirmed" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)} />我确认所选成员、完整变更内容和原因，并记录操作审计。</label>
        <div data-enterprise-actions><button data-paimind-ui-button data-variant="primary" type="submit" disabled={!confirmed || reason.trim().length < 3}>确认连接器变更</button>
          <button data-paimind-ui-button type="button" onClick={cancel}>放弃未提交配置</button></div>
      </fieldset>
    </form>}
  </section>
}
