import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { HarnessModelReadValues, HarnessModelSettings } from '@paimind/harness-compat/gateway-transport'
import { EnterpriseApi, memberViews, type AccountView } from './api.js'

interface Receipt {
  disclosure: { memberId: string; memberName: string; reason: string; requestId: string; completedAt: string }
  data: { selection: HarnessModelSettings['selection']; providerActive: boolean; modelListed: boolean;
    credential: 'configured' | 'missing' | 'not-inspected'; catalog: HarnessModelReadValues['catalog']; providers: HarnessModelReadValues['providers'];
    configuration: { writable: boolean; revision: number | null; applies: 'live' | 'restart' | null; cellRevision: string; credentialWritable: boolean | null } }
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('模型状态响应无效')
  return value as Record<string, unknown>
}
const label = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
function receipt(value: unknown, memberId: string, reason: string): Receipt {
  const row = object(value), data = object(row.data), disclosure = object(row.disclosure), catalog = object(data.catalog)
  if (disclosure.memberId !== memberId || disclosure.reason !== reason || disclosure.readOnly !== true
    || !label(disclosure.memberName) || !label(disclosure.requestId)
    || ![disclosure.authorizedAt, disclosure.completedAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))) throw Error('模型状态审计回执不匹配')
  if (data.selection !== null) {
    const selected = object(data.selection)
    if (!label(selected.provider) || !label(selected.model) || selected.reasoningEffort !== undefined && !label(selected.reasoningEffort)) throw Error('默认模型响应无效')
  }
  if (typeof data.providerActive !== 'boolean' || typeof data.modelListed !== 'boolean'
    || !['configured', 'missing', 'not-inspected'].includes(String(data.credential))
    || data.authorization !== 'not-evaluated' || data.modelCall !== 'not-performed'
    || !Array.isArray(catalog.groups) || catalog.groups.length > 128 || !Array.isArray(catalog.failedProviders)
    || catalog.failedProviders.length > 128 || !catalog.failedProviders.every(label)) throw Error('模型状态响应无效')
  let count = 0
  for (const item of catalog.groups) {
    const group = object(item)
    if (!label(group.provider) || !label(group.name) || !Array.isArray(group.models)) throw Error('模型目录响应无效')
    count += group.models.length
    if (count > 5000 || !group.models.every(item => { const row = object(item); return label(row.id) && label(row.name) })) throw Error('模型目录响应无效')
  }
  const configuration = object(data.configuration)
  if (typeof configuration.writable !== 'boolean' || configuration.revision !== null && (!Number.isSafeInteger(configuration.revision) || Number(configuration.revision) < 0)
    || !['live', 'restart', null].includes(configuration.applies as never) || typeof configuration.cellRevision !== 'string' || !uuid.test(configuration.cellRevision)
    || configuration.credentialWritable !== null && typeof configuration.credentialWritable !== 'boolean'
    || !Array.isArray(data.providers) || data.providers.length > 128
    || !data.providers.every(item => { const row = object(item); return label(row.provider) && label(row.name) && typeof row.active === 'boolean' })) throw Error('模型配置前置状态无效')
  return row as unknown as Receipt
}

/** Original Settings contribution; native services remain the only owners. */
export function MemberModelState({ api, onEditing }: { api: EnterpriseApi; onEditing?: (value: boolean) => void }): JSX.Element {
  const [members, setMembers] = useState<AccountView[]>(), [memberId, setMemberId] = useState('')
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<Receipt>(), [error, setError] = useState<string>(), [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0), [focusRequest, setFocusRequest] = useState(0)
  const [editing, setEditing] = useState(false), [stale, setStale] = useState(false)
  const current = useRef<AbortController>(), input = useRef<HTMLTextAreaElement>(null), feedback = useRef<HTMLDivElement>(null)
  const clear = () => { current.current?.abort(); current.current = undefined; setBusy(false); setResult(undefined); setError(undefined); setStale(false) }
  useEffect(() => { onEditing?.(editing); return () => onEditing?.(false) }, [editing, onEditing])
  useEffect(() => {
    const abort = new AbortController()
    current.current?.abort(); current.current = undefined
    setMembers(undefined); setMemberId(''); setReason(''); setConfirmed(false); setResult(undefined); setError(undefined); setBusy(false); setStale(false); setEditing(false)
    void api.request('/admin/members', 'GET', undefined, undefined, abort.signal).then(memberViews).then(rows => {
      if (!abort.signal.aborted) setMembers(rows.filter(row => row.role === 'member' && row.status === 'active'))
    }).catch(error => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : '成员列表读取失败') })
    return () => { abort.abort(); current.current?.abort(); current.current = undefined }
  }, [api, reload])
  useEffect(() => { if (result || error) feedback.current?.focus() }, [result, error])
  useEffect(() => { if (focusRequest) input.current?.focus() }, [focusRequest])
  const valid = confirmed && reason.trim().length >= 3 && reason.trim().length <= 500 && members?.some(row => row.userId === memberId)
  const read = async (event: FormEvent) => {
    event.preventDefault()
    if (!valid || current.current || editing) return
    const abort = new AbortController(), selectedReason = reason.trim(), selectedMember = memberId
    current.current = abort; setBusy(true); setResult(undefined); setError(undefined); setStale(false)
    try {
      const value = await api.request('/admin/model-state', 'POST', { memberId: selectedMember, reason: selectedReason, confirmed: true }, crypto.randomUUID(), abort.signal)
      if (!abort.signal.aborted && current.current === abort) setResult(receipt(value, selectedMember, selectedReason))
    } catch (error) {
      if (!abort.signal.aborted && current.current === abort) setError(error instanceof Error ? error.message : '模型状态读取失败')
    } finally { if (current.current === abort) { current.current = undefined; setBusy(false) } }
  }
  const close = () => { clear(); setConfirmed(false); setFocusRequest(value => value + 1) }
  return <div onKeyDown={event => { if (event.key === 'Escape' && !editing) { event.preventDefault(); event.stopPropagation(); close() } }}>
    <div data-enterprise-toolbar><h3>成员模型配置</h3><button data-paimind-ui-button type="button" disabled={editing} onClick={close}>关闭状态／停止等待</button></div>
    <p data-paimind-ui-summary>从所选成员的原生运行环境读取，不复制模型配置、不显示密钥、不发起模型调用。目录可见和凭证已配置均不等于调用授权或真实会话成功。</p>
    {members === undefined && !error && <p role="status" aria-busy="true">正在读取成员…</p>}
    {members?.length === 0 && <p role="status">暂无已启用的使用人员。</p>}
    {members !== undefined && <form data-enterprise-form onSubmit={event => { void read(event) }}>
      <fieldset disabled={busy || editing} aria-busy={busy}><legend>只读核对模型</legend>
        <label>成员<select required value={memberId} onChange={event => { clear(); setMemberId(event.currentTarget.value); setConfirmed(false) }}>
          <option value="">请选择成员</option>{members.map(member => <option key={member.userId} value={member.userId}>{member.displayName}（{member.username}）</option>)}
        </select></label>
        <label>核对原因<textarea ref={input} required minLength={3} maxLength={500} value={reason} onChange={event => { clear(); setReason(event.currentTarget.value); setConfirmed(false) }} /></label>
        <label data-enterprise-checkbox><input type="checkbox" checked={confirmed} onChange={event => { clear(); setConfirmed(event.currentTarget.checked) }} />我确认读取所选成员的模型状态，并保留原因与访问审计。</label>
        <button data-paimind-ui-button type="submit" data-variant="primary" disabled={!valid}>{busy ? '正在读取…' : '记录原因并读取模型状态'}</button>
      </fieldset>
    </form>}
    <div ref={feedback} tabIndex={-1}>
      {error && <p role="alert">{error}；未展示旧状态。{members === undefined && <button type="button" data-paimind-ui-button onClick={() => setReload(value => value + 1)}>重试成员列表</button>}</p>}
      {busy && <p role="status" aria-busy="true">正在授权、审计并读取原生模型状态…</p>}
      {result && <>
        {stale && <p role="status">已提交配置操作；以下是操作前的读取快照。请重新读取原生状态后再进行下一项配置。</p>}
        <p role="status">已读取 {result.disclosure.memberName} 的模型状态；原因：{result.disclosure.reason}。本次读取已记录审计。</p>
        <dl><dt>默认模型</dt><dd>{result.data.selection ? `${result.data.selection.provider} / ${result.data.selection.model}` : '未发现默认模型设置'}</dd>
          <dt>推理级别</dt><dd>{result.data.selection?.reasoningEffort ?? '由原生提供方决定'}</dd>
          <dt>供应商注册</dt><dd>{result.data.providerActive ? '读取时已注册' : '读取时未注册'}</dd>
          <dt>默认模型目录</dt><dd>{result.data.modelListed ? '读取时在目录中' : '读取时未出现在目录中；不据此判断调用结果'}</dd>
          <dt>默认路线凭证</dt><dd>{result.data.credential === 'configured' ? '原生凭证服务报告已配置；未验证调用' : result.data.credential === 'missing' ? '原生凭证服务报告未配置' : '未检查；可能由提供方管理其他认证方式'}</dd>
        </dl>
        <p>这是一组读取时的状态观察，不是持续授权证明。未验证配额、当前调用权限或真实会话回复，也不代表已有会话使用相同模型。</p>
        {result.data.catalog.failedProviders.length > 0 && <p role="status">部分供应商目录读取失败：{result.data.catalog.failedProviders.join('、')}。未返回供应商错误原文。</p>}
        <details><summary>读取到的模型目录</summary>{result.data.catalog.groups.length === 0 ? <p>本次没有读取到模型目录。</p>
          : <ul data-enterprise-list>{result.data.catalog.groups.map(group => <li key={group.provider}><strong>{group.name}</strong><p>{group.models.map(model => model.name).join('、')}</p></li>)}</ul>}</details>
        <details><summary>访问追溯信息</summary><p>请求编号：{result.disclosure.requestId}</p><p>读取完成：{result.disclosure.completedAt}</p></details>
      </>}
    </div>
    {result && <ModelCommands key={result.disclosure.requestId} api={api} snapshot={result} onEditing={setEditing} onChanged={() => setStale(true)} />}
  </div>
}

type IntentChange = { kind: 'selection'; selection: NonNullable<HarnessModelSettings['selection']> } | { kind: 'credential'; action: 'set' | 'unset' }
interface ModelCommand {
  commandId: string; targetUserId: string; outcome: 'unconfirmed' | 'applied' | 'conflict' | 'superseded';
  intent: { targetUserId: string; expectedCellRevision: string; expectedSettingsRevision: number; change: IntentChange; reason: string; confirmed: true }
}
function commandView(value: unknown, target: string): ModelCommand {
  const row = object(value), intent = object(row.intent), change = object(intent.change)
  if (typeof row.commandId !== 'string' || !uuid.test(row.commandId) || row.targetUserId !== target || intent.targetUserId !== target
    || !['unconfirmed','applied','conflict','superseded'].includes(String(row.outcome)) || row.historicalReceipt !== true || row.runtimeGrant !== false
    || typeof intent.expectedCellRevision !== 'string' || !uuid.test(intent.expectedCellRevision)
    || !Number.isSafeInteger(intent.expectedSettingsRevision) || Number(intent.expectedSettingsRevision) < 0
    || typeof intent.reason !== 'string' || intent.reason.length < 3 || intent.reason.length > 500 || intent.confirmed !== true) throw Error('模型操作回执与所选成员不匹配')
  let projected: IntentChange
  if (change.kind === 'selection') {
    const selected = object(change.selection)
    if (!label(selected.provider) || !label(selected.model) || selected.reasoningEffort !== undefined && !label(selected.reasoningEffort)
      || Object.keys(change).some(key => !['kind','selection'].includes(key))
      || Object.keys(selected).some(key => !['provider','model','reasoningEffort'].includes(key))) throw Error('模型操作选择无效')
    projected = { kind: 'selection', selection: { provider: selected.provider, model: selected.model,
      ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort as string }) } }
  } else {
    if (change.kind !== 'credential' || !['set','unset'].includes(String(change.action)) || Object.keys(change).some(key => !['kind','action'].includes(key))) throw Error('凭证操作回执无效')
    projected = { kind: 'credential', action: change.action as 'set' | 'unset' }
  }
  if (row.outcome === 'unconfirmed') { if (row.confirmation !== null) throw Error('不确定结果不能带成功确认') }
  else {
    const confirmation = object(row.confirmation)
    if (confirmation.commandId !== row.commandId || confirmation.outcome !== row.outcome
      || row.outcome === 'superseded' && confirmation.effect !== 'unknown') throw Error('模型操作终态不匹配')
  }
  // Explicit projection: never retain raw responses, secret fields or pins.
  return { commandId: row.commandId, targetUserId: target, outcome: row.outcome as ModelCommand['outcome'], intent: {
    targetUserId: target, expectedCellRevision: intent.expectedCellRevision, expectedSettingsRevision: Number(intent.expectedSettingsRevision),
    change: projected, reason: intent.reason, confirmed: true } }
}
const commandMessages = { applied: '原生操作已确认；这不代表模型调用或凭证有效性验证通过。', conflict: '原生设置修订冲突，本次操作未写入。请重新读取状态。',
  unconfirmed: '操作结果不确定，可能已经生效。不要重复提交或更换请求标识。', superseded: '已结束旧操作追认，但其历史效果仍未知；没有重发、撤销或证明回退。' }

function ModelCommands({ api, snapshot, onEditing, onChanged }: { api: EnterpriseApi; snapshot: Receipt;
  onEditing: (value: boolean) => void; onChanged: () => void }): JSX.Element {
  const target = snapshot.disclosure.memberId, configuration = snapshot.data.configuration
  const [command, setCommand] = useState<ModelCommand | null>(), [draft, setDraft] = useState<'selection' | 'set' | 'unset' | 'resolve'>()
  const [choice, setChoice] = useState(''), [effort, setEffort] = useState(''), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [needsRead, setNeedsRead] = useState(false), [reload, setReload] = useState(0)
  const [focusRequest, setFocusRequest] = useState(0)
  const current = useRef<AbortController>(), secret = useRef<HTMLInputElement | null>(null), reasonField = useRef<HTMLTextAreaElement>(null)
  const secretRef = useCallback((node: HTMLInputElement | null) => {
    if (secret.current && secret.current !== node) secret.current.value = ''
    secret.current = node
  }, [])
  const feedback = useRef<HTMLDivElement>(null), opener = useRef<HTMLButtonElement | null>(null)
  const choices = snapshot.data.catalog.groups.filter(group => snapshot.data.providers.some(provider => provider.provider === group.provider && provider.active)
    && !snapshot.data.catalog.failedProviders.includes(group.provider)).flatMap(group => group.models.map(model => ({ provider: group.provider, model: model.id, name: `${group.name} / ${model.name}`, key: JSON.stringify([group.provider, model.id]) })))
  const clearSecret = () => { if (secret.current) secret.current.value = '' }
  useEffect(() => { onEditing(Boolean(draft) || busy && needsRead); return () => onEditing(false) }, [draft, busy, needsRead, onEditing])
  useEffect(() => {
    const abort = new AbortController(); current.current = abort; setBusy(true); setCommand(undefined); setError('')
    void api.request('/admin/model-command-state', 'POST', { targetUserId: target }, crypto.randomUUID(), abort.signal).then(value => {
      const row = object(value); if (row.targetUserId !== target) throw Error('模型操作目标不匹配')
      const result = row.command === null ? null : commandView(row.command, target)
      if (!abort.signal.aborted && current.current === abort) setCommand(result)
    }).catch(error => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : '操作记录读取失败') })
      .finally(() => { if (current.current === abort) { current.current = undefined; setBusy(false) } })
    return () => { abort.abort(); current.current?.abort(); current.current = undefined; clearSecret() }
  }, [api, target, reload])
  useEffect(() => { if (draft) reasonField.current?.focus() }, [draft])
  useEffect(() => { if (focusRequest && !draft && !busy) opener.current?.focus() }, [focusRequest, draft, busy])
  useEffect(() => { if (command || error) feedback.current?.focus() }, [command, error])
  const open = (kind: NonNullable<typeof draft>, button: HTMLButtonElement) => {
    opener.current = button; setDraft(kind); setReason(''); setConfirmed(false); setError(''); clearSecret()
    setChoice(snapshot.data.selection ? JSON.stringify([snapshot.data.selection.provider, snapshot.data.selection.model]) : '')
    setEffort(snapshot.data.selection?.reasoningEffort ?? '')
  }
  const cancel = () => { if (busy) return; clearSecret(); setDraft(undefined); setReason(''); setConfirmed(false); setFocusRequest(value => value + 1) }
  const pending = command?.outcome === 'unconfirmed'
  const canEdit = command !== undefined && !pending && !needsRead && !busy && !draft && configuration.revision !== null
  const replacement = pending && command.intent.expectedCellRevision !== configuration.cellRevision
  const stopWaiting = () => {
    current.current?.abort(); current.current = undefined; setBusy(false); setDraft(undefined); clearSecret(); setNeedsRead(true)
    setError('已停止等待，操作可能已经生效；这不是撤销。请读取操作记录，不要重复提交。')
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft || current.current || !confirmed || reason.trim().length < 3 || reason.trim().length > 500) return
    if (draft === 'resolve' ? !replacement : pending || needsRead || command === undefined || configuration.revision === null) return
    const selected = choices.find(row => row.key === choice)
    if (draft === 'selection' && (!selected || !configuration.writable)) return
    if ((draft === 'set' || draft === 'unset') && configuration.credentialWritable !== true) return
    const credential = draft === 'set' ? secret.current?.value : undefined
    if (draft === 'set' && (!credential || credential.length > 8192 || /[\u0000\r\n]/u.test(credential))) { setError('请输入有效凭证；不允许换行。'); return }
    const change: IntentChange = draft === 'selection' ? { kind: 'selection', selection: { provider: selected!.provider, model: selected!.model,
      ...(effort.trim() ? { reasoningEffort: effort.trim() } : {}) } } : { kind: 'credential', action: draft === 'set' ? 'set' : 'unset' }
    const intent = { targetUserId: target, expectedCellRevision: configuration.cellRevision, expectedSettingsRevision: configuration.revision!, change, reason: reason.trim(), confirmed: true as const }
    const resolving = draft === 'resolve', originalCommandId = command?.commandId
    const body = resolving ? { expectedCellRevision: configuration.cellRevision, reason: reason.trim(), confirmed: true }
      : { ...intent, change: draft === 'set' ? { ...change, value: credential } : change }
    const path = resolving ? `/admin/model-commands/${originalCommandId}/resolve` : '/admin/model-commands'
    const abort = new AbortController(); current.current = abort; setBusy(true); setError(''); setNeedsRead(true); onChanged()
    clearSecret(); setDraft(undefined); setConfirmed(false); setReason('')
    try {
      const value = commandView(await api.request(path, 'POST', body, crypto.randomUUID(), abort.signal), target)
      if (resolving ? value.commandId !== originalCommandId || value.outcome !== 'superseded' : JSON.stringify(value.intent) !== JSON.stringify(intent)) throw Error('提交与模型操作回执不匹配')
      if (!abort.signal.aborted && current.current === abort) setCommand(value)
    } catch (error) {
      if (!abort.signal.aborted && current.current === abort) setError(`${error instanceof Error ? error.message : '配置提交未完成'}；结果未确认，请读取操作记录，不要重复提交。`)
    } finally { if (current.current === abort) { current.current = undefined; setBusy(false) } }
  }
  return <section aria-label="管理员模型配置" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() }
  }}>
    <h4>为 {snapshot.disclosure.memberName} 配置模型</h4>
    <p data-paimind-ui-summary>变更由该成员的原生设置／凭证服务保存。每项单独确认，不发起模型调用；提交后停止等待或关闭页面均不等于撤销。</p>
    <div ref={feedback} tabIndex={-1}>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status" aria-busy="true">正在处理模型操作，请勿重复提交…</p>}
      {command && <><p role="status">{commandMessages[command.outcome]}</p><details><summary>模型操作追溯</summary><p>操作编号：{command.commandId}</p><p>原因：{command.intent.reason}</p><p>这是历史回执，不是当前使用授权。</p></details></>}
      {command === null && <p role="status">未发现该成员的模型配置操作记录。</p>}
      {needsRead && <p>重新读取原生模型状态后才能继续配置；操作记录读取不会重发原请求。</p>}
    </div>
    <div data-enterprise-actions>
      <button data-paimind-ui-button type="button" disabled={busy || Boolean(draft)} onClick={() => setReload(value => value + 1)}>读取操作记录</button>
      {busy && needsRead && <button data-paimind-ui-button type="button" onClick={stopWaiting}>停止等待，结果待确认</button>}
      <button data-paimind-ui-button type="button" disabled={!canEdit || !configuration.writable || !choices.length} onClick={event => open('selection', event.currentTarget)}>更改默认模型</button>
      <button data-paimind-ui-button type="button" disabled={!canEdit || configuration.credentialWritable !== true} onClick={event => open('set', event.currentTarget)}>设置模型凭证</button>
      <button data-paimind-ui-button type="button" disabled={!canEdit || configuration.credentialWritable !== true || snapshot.data.credential !== 'configured'} onClick={event => open('unset', event.currentTarget)}>删除模型凭证</button>
      {replacement && <button data-paimind-ui-button type="button" disabled={busy || Boolean(draft)} onClick={event => open('resolve', event.currentTarget)}>核验替代环境并结束旧操作追认</button>}
    </div>
    {!configuration.writable && <p>原生默认模型设置不可写。</p>}
    {configuration.credentialWritable !== true && <p>当前原生路线没有可写的命名凭证；不替换提供方管理的认证方式。</p>}
    {pending && !replacement && <p>不能在同一运行单元推断或重试未知结果。如需结束追认，请由部署人员先停止旧单元并准入同数据、镜像与策略的替代单元，再重新读取状态。</p>}
    {draft && <form data-enterprise-form aria-label="确认模型配置变更" onSubmit={event => { void submit(event) }}>
      <fieldset disabled={busy}><legend>{draft === 'selection' ? '更改默认模型' : draft === 'set' ? '设置模型凭证' : draft === 'unset' ? '删除模型凭证' : '结束不确定操作追认'} · {snapshot.disclosure.memberName}</legend>
        <label>变更原因<textarea ref={reasonField} required minLength={3} maxLength={500} value={reason} onChange={event => { setReason(event.currentTarget.value); setConfirmed(false) }} /></label>
        {draft === 'selection' && <><label>默认模型<select required value={choice} onChange={event => { setChoice(event.currentTarget.value); setConfirmed(false) }}>
          <option value="">请选择当前可用模型</option>{choices.map(row => <option key={row.key} value={row.key}>{row.name}</option>)}
        </select></label><label>推理级别（留空保留原生设置）<input maxLength={200} value={effort} onChange={event => { setEffort(event.currentTarget.value); setConfirmed(false) }} /></label></>}
        {draft === 'set' && <label>模型凭证<input ref={secretRef} type="password" required maxLength={8192} autoComplete="off" onChange={() => setConfirmed(false)} /></label>}
        {draft === 'unset' && <p>删除当前路线的命名凭证，可能使该成员后续模型调用失败；不会删除会话或智能体。</p>}
        {draft === 'resolve' && <p>必须已由部署人员终止旧单元并准入准确替代环境。服务端将再次核验；历史效果仍然未知，不代表成功或回退。</p>}
        <label data-enterprise-checkbox><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)} />我确认所选成员、变更内容和原因，并记录操作审计。</label>
        <div data-enterprise-actions><button data-paimind-ui-button data-variant="primary" type="submit" disabled={!confirmed || reason.trim().length < 3}>确认本次变更</button>
          <button data-paimind-ui-button type="button" onClick={cancel}>放弃未提交变更</button></div>
      </fieldset>
    </form>}
  </section>
}
