import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { PAIMIND_FEATURE_PACKS, type PaimindFeaturePackView, type PaimindFeatureToggleMutationRequest } from '@paimind/extension-center/feature-packs'
import type { PaimindFeatureChangePlan } from '@paimind/extension-center/governance'
import type { FeatureManagementContribution } from '@paimind/extension-center/client'
import { EnterpriseApi, memberViews, type AccountView, type EnterpriseSession } from './api.js'

type Selection = PaimindFeatureToggleMutationRequest
interface Approval { imageId: string; catalogDigest: string; packIds: string[]; revision: number; reason: string }
interface Command { commandId: string; targetUserId: string; outcome: 'unconfirmed' | 'applied' | 'rolled-back'; reason: string;
  selection: Selection; planDigest: string; imageId: string; historicalReceipt: true; runtimeGrant: false }
interface Recovery { kind: 'same-runtime' | 'replacement-runtime' | 'blocked'; originalPinDigest: string; currentPinDigest: string; reason?: string }
interface State { targetUserId: string; targetName: string; imageId: string; catalogDigest: string; allowedPackIds: string[];
  approval: Approval | null; view: PaimindFeaturePackView; command: Command | null; recovery: Recovery | null;
  nativeCommand: { commandId: string; phase: string; planDigest: string } | null; observedAt: string }
type Draft = { kind: 'approve' | 'revoke' | 'resume' } | { kind: 'change'; selection: Selection; plan: PaimindFeatureChangePlan }
const hash = /^sha256:[a-f0-9]{64}$/u, uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
const packIds = PAIMIND_FEATURE_PACKS.map(pack => pack.id).sort()
const ids = new Set<string>(PAIMIND_FEATURE_PACKS.flatMap(pack => [pack.id, ...pack.capabilities.map(cap => cap.id)]))
const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('功能包响应格式无效')
  return value as Record<string, any>
}
const validPacks = (value: unknown): value is string[] => Array.isArray(value) && value.length <= packIds.length
  && new Set(value).size === value.length && value.every(id => typeof id === 'string' && packIds.includes(id as never))
const validSelection = (value: unknown): value is Selection => {
  const row = object(value)
  return ids.has(row.id) && typeof row.enabled === 'boolean' && Number.isSafeInteger(row.expectedRevision) && row.expectedRevision >= 0
}
function commandView(value: unknown, target: string, image: string): Command {
  const row = object(value)
  if (!uuid.test(row.commandId) || row.targetUserId !== target || row.imageId !== image || !hash.test(row.imageId) || !['unconfirmed','applied','rolled-back'].includes(row.outcome)
    || typeof row.reason !== 'string' || row.reason.length > 500 || !hash.test(row.planDigest) || !validSelection(row.selection)
    || row.historicalReceipt !== true || row.runtimeGrant !== false) throw Error('命令回执与所选成员不匹配')
  return row as Command
}
function stateView(value: unknown, target: string): State {
  const row = object(value), view = object(row.view)
  if (row.targetUserId !== target || typeof row.targetName !== 'string' || !hash.test(row.imageId) || !hash.test(row.catalogDigest)
    || !validPacks(row.allowedPackIds) || typeof row.observedAt !== 'string' || !Number.isFinite(Date.parse(row.observedAt))) throw Error('成员状态回执不匹配')
  if (row.approval !== null) {
    const a = object(row.approval)
    if (!hash.test(a.imageId) || !hash.test(a.catalogDigest) || !validPacks(a.packIds) || !Number.isSafeInteger(a.revision) || a.revision < 1 || typeof a.reason !== 'string') throw Error('批准回执格式无效')
  }
  if (row.command !== null) commandView(row.command, target, row.command.imageId)
  if (row.command?.outcome === 'unconfirmed') {
    const recovery = object(row.recovery)
    if (!['same-runtime','replacement-runtime','blocked'].includes(recovery.kind)
      || !hash.test(recovery.originalPinDigest) || !hash.test(recovery.currentPinDigest)
      || recovery.kind === 'same-runtime' && recovery.originalPinDigest !== recovery.currentPinDigest
      || recovery.kind === 'replacement-runtime' && recovery.originalPinDigest === recovery.currentPinDigest
      || recovery.kind === 'blocked' && (typeof recovery.reason !== 'string' || !recovery.reason.trim())) throw Error('原命令恢复环境尚未确认')
  } else if (row.recovery !== null) throw Error('原命令恢复环境尚未确认')
  if (row.nativeCommand !== null) {
    const native = object(row.nativeCommand)
    if (!uuid.test(native.commandId) || !hash.test(native.planDigest) || !['applying','applied','rolling-back','rolled-back'].includes(native.phase)) throw Error('原生回执格式无效')
  }
  if (view.status === 'ready') {
    if (!Number.isSafeInteger(view.revision) || view.revision < 0 || typeof view.writable !== 'boolean' || !Array.isArray(view.packs)
      || JSON.stringify(view.packs.map((pack: any) => pack.id).sort()) !== JSON.stringify(packIds)) throw Error('功能包目录不完整')
    for (const pack of view.packs) {
      const definition = PAIMIND_FEATURE_PACKS.find(row => row.id === pack.id)!
      if (!Array.isArray(pack.capabilities) || JSON.stringify(pack.capabilities.map((cap: any) => cap.id).sort()) !== JSON.stringify(definition.capabilities.map(cap => cap.id).sort())) throw Error('子功能目录不完整')
      for (const item of [pack, ...pack.capabilities]) if (typeof item.installed !== 'boolean' || typeof item.enabled !== 'boolean'
        || item.desiredEnabled !== undefined && typeof item.desiredEnabled !== 'boolean' || item.failure !== undefined && typeof item.failure !== 'string') throw Error('原生功能状态格式无效')
    }
  } else if (view.status !== 'unavailable') throw Error('原生功能状态无效')
  return row as State
}
function previewPlan(value: unknown, state: State, selection: Selection): PaimindFeatureChangePlan {
  const row = object(value), plan = object(row.plan)
  if (row.targetUserId !== state.targetUserId || row.imageId !== state.imageId || plan.catalogDigest !== state.catalogDigest || !hash.test(plan.planDigest)
    || !validSelection(plan.selection) || Object.keys(selection).some(key => plan.selection[key] !== selection[key as keyof Selection])
    || JSON.stringify(plan.reconciledPackIds) !== JSON.stringify(packIds) || plan.schema !== 'paimind.feature-command/v1') throw Error('预览与所选成员或操作不匹配')
  for (const text of [plan.before, plan.after]) {
    if (typeof text !== 'string' || text.length > 8192) throw Error('预览设置格式无效')
    const overrides = object(JSON.parse(text || '{}'))
    if (Object.entries(overrides).some(([id,value]) => !ids.has(id) || typeof value !== 'boolean')) throw Error('预览包含未知功能')
  }
  return plan as PaimindFeatureChangePlan
}
const label = (id: string) => PAIMIND_FEATURE_PACKS.flatMap(pack => [pack, ...pack.capabilities]).find(row => row.id === id)?.nameZh ?? id
function changes(plan: PaimindFeatureChangePlan): string[] {
  const before = JSON.parse(plan.before || '{}'), after = JSON.parse(plan.after || '{}')
  return PAIMIND_FEATURE_PACKS.flatMap(pack => [pack, ...pack.capabilities]).flatMap(item => {
    const a = before[item.id] ?? item.defaultEnabled, b = after[item.id] ?? item.defaultEnabled
    return a === b ? [] : [`${item.nameZh}：${a ? '启用' : '关闭'} → ${b ? '启用' : '关闭'}`]
  })
}

export function FeatureManagementPanel({ session }: { session: EnterpriseSession }): JSX.Element {
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot)
  if (view.status !== 'ready') return <p role="status">正在验证企业管理员；管理操作未开放。</p>
  if (view.account.role !== 'admin') return <p role="alert">功能包由管理员管理。你可以在原生会话中使用已分配能力。</p>
  return <OwnedFeatureManagement key={JSON.stringify([view.account.tenantId, view.account.userId, view.account.role])} api={session.api} />
}
export function createFeatureManagementContribution(session: EnterpriseSession): FeatureManagementContribution {
  return { id: 'enterprise-feature-management', Panel: () => <FeatureManagementPanel session={session} /> }
}

function OwnedFeatureManagement({ api }: { api: EnterpriseApi }): JSX.Element {
  const [members,setMembers] = useState<AccountView[]>(), [target,setTarget] = useState(''), [state,setState] = useState<State>()
  const [draft,setDraft] = useState<Draft>(), [reason,setReason] = useState(''), [confirmed,setConfirmed] = useState(false)
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState(''), [reload,setReload] = useState(0)
  const [focusRequest,setFocusRequest] = useState(0)
  const [needsRead,setNeedsRead] = useState(false)
  const current = useRef<AbortController>(), attempt = useRef<{ key: string; body: object; path: string }>()
  const opener = useRef<HTMLElement | null>(null), reasonField = useRef<HTMLTextAreaElement>(null), feedback = useRef<HTMLDivElement>(null)
  const cancel = () => { current.current?.abort(); current.current = undefined; setBusy(false) }
  const clear = () => { cancel(); setState(undefined); setDraft(undefined); attempt.current = undefined; setReason(''); setConfirmed(false); setError(''); setMessage(''); setNeedsRead(false) }
  useEffect(() => {
    const abort = new AbortController(); clear(); setTarget(''); setMembers(undefined)
    void api.request('/admin/members','GET',undefined,undefined,abort.signal).then(memberViews).then(rows => {
      if (!abort.signal.aborted) setMembers(rows.filter(row => row.status === 'active'))
    }).catch(error => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : '成员读取失败') })
    return () => { abort.abort(); current.current?.abort(); current.current = undefined }
  }, [api,reload])
  useEffect(() => { if (draft && !busy) reasonField.current?.focus() },[draft,busy])
  useEffect(() => { if (focusRequest && !busy) opener.current?.focus() },[focusRequest,busy])
  useEffect(() => { if (error || message) feedback.current?.focus() },[error,message])
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (current.current) return
    const abort = new AbortController(); current.current = abort; setBusy(true); setError(''); setMessage('')
    try { await work(abort.signal) } catch(error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : '请求未完成，请重新读取') }
    finally { if (current.current === abort) { current.current = undefined; setBusy(false) } }
  }
  const read = () => {
    if (!target || busy) return
    setState(undefined); setDraft(undefined); attempt.current = undefined; setConfirmed(false)
    void run(async signal => { const result = stateView(await api.request('/admin/feature-packs/state','POST',{targetUserId:target},crypto.randomUUID(),signal),target); if (!signal.aborted) { setState(result); setNeedsRead(false) } })
  }
  const open = (draft: Draft, element: HTMLElement) => { opener.current = element; setReason(''); setConfirmed(false); attempt.current = undefined; setError(''); setMessage(''); setDraft(draft) }
  const preview = (selection: Selection, element: HTMLElement) => {
    if (!state || busy || draft) return
    opener.current = element
    void run(async signal => {
      const plan = previewPlan(await api.request('/admin/feature-packs/preview','POST',{targetUserId:target,selection},crypto.randomUUID(),signal),state,selection)
      if (!signal.aborted) open({kind:'change',selection,plan},element)
    })
  }
  const pending = state?.command?.outcome === 'unconfirmed'
  const nativePending = state?.nativeCommand && ['applying','rolling-back'].includes(state.nativeCommand.phase)
  const approved = state?.approval && state.approval.imageId === state.imageId && state.approval.catalogDigest === state.catalogDigest
    && packIds.every(id => state.approval!.packIds.includes(id))
  const ceiling = state && packIds.every(id => state.allowedPackIds.includes(id))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!state || !draft || current.current || !confirmed || reason.trim().length < 3 || reason.trim().length > 500) return
    if (draft.kind === 'resume' && (!state.recovery || state.recovery.kind === 'blocked' || !pending || !approved || needsRead)) return
    const common = { reason:reason.trim(),confirmed:true }
    attempt.current ??= { key:crypto.randomUUID(), path:draft.kind === 'change' ? '/admin/feature-packs/commands'
      : draft.kind === 'resume' ? '/admin/feature-commands/'+state.command!.commandId+'/resume' : '/admin/feature-packs/approvals',
    body:draft.kind === 'change' ? { ...common,targetUserId:target,selection:draft.selection,planDigest:draft.plan.planDigest,approvalRevision:state.approval?.revision ?? 0 }
      : draft.kind === 'resume' ? { ...common,expectedRuntimeDigest:state.recovery!.currentPinDigest,
        ...(state.recovery!.kind === 'replacement-runtime' ? {allowReplacement:true} : {}) } : { ...common,targetUserId:target,imageId:state.imageId,catalogDigest:state.catalogDigest,
        packIds:draft.kind === 'approve' ? packIds : [],expectedRevision:state.approval?.revision ?? 0 } }
    const request = attempt.current
    void run(async signal => {
      const result = await api.request(request.path,'POST',request.body,request.key,signal)
      if (signal.aborted) return
      if (draft.kind === 'approve' || draft.kind === 'revoke') {
        const a = object(result)
        if (a.targetUserId !== target || a.imageId !== state.imageId || a.catalogDigest !== state.catalogDigest
          || a.revision !== (state.approval?.revision ?? 0)+1 || JSON.stringify(a.packIds) !== JSON.stringify(draft.kind === 'approve' ? packIds : [])) throw Error('批准响应与原请求不匹配；请重新读取')
        setMessage(draft.kind === 'approve' ? '已批准完整管理范围；没有启用或关闭任何功能。请重新读取状态。' : '已撤销后续管理批准；没有改变已启用状态。请重新读取状态。')
        setState(undefined)
      } else {
        const command = commandView(result,target,state.imageId)
        if (draft.kind === 'change' && command.planDigest !== draft.plan.planDigest || draft.kind === 'resume' && command.commandId !== state.command?.commandId) throw Error('命令确认与原请求不匹配')
        setState({...state,command}); setNeedsRead(true)
        setMessage(command.outcome === 'unconfirmed' ? '结果仍待确认。操作可能已经生效，请重新读取并恢复原命令，不要重复创建。'
          : command.outcome === 'rolled-back' ? '原命令已确认回退。请重新读取实际状态。' : '原命令已确认应用。请重新读取实际状态；目标成员可能需要重载页面以同步界面。')
      }
      attempt.current = undefined; setDraft(undefined); setConfirmed(false)
    })
  }
  const close = () => { const started = Boolean(attempt.current); cancel(); setDraft(undefined); setConfirmed(false); attempt.current = undefined
    if (started) { setState(undefined); setMessage('已停止等待，未取消可能已接受的操作。请重新读取并找回原命令。') }
    setFocusRequest(value=>value+1)
  }
  return <div data-paimind-enterprise data-paimind-ui-scope="enterprise-features" onKeyDown={event=>{if(event.key==='Escape' && draft){event.preventDefault();close()}}}>
    <h3>成员功能包管理</h3><p data-paimind-ui-summary>设置仍由原生插件负责。批准范围、实际状态和历史回执分别显示；成员只能使用获准能力。</p>
    {!members ? <><p role="status" aria-busy={!error}>正在读取企业成员…</p>{error && <button type="button" data-paimind-ui-button onClick={()=>setReload(value=>value+1)}>重试成员列表</button>}</>
      : <><label>管理对象<select value={target} disabled={busy} onChange={event=>{clear();setTarget(event.currentTarget.value)}}><option value="">请选择成员</option>{members.map(member=><option key={member.userId} value={member.userId}>{member.displayName} · {member.username}{member.role==='admin'?' · 管理员':''}</option>)}</select></label>
        {members.length===0 && <p role="status">没有可管理的活动账户。</p>}
        <button type="button" data-paimind-ui-button disabled={!target||busy} onClick={read}>重新读取状态／找回原命令</button></>}
    {busy && <p role="status" aria-busy="true">正在校验并与原生插件通信…</p>}
    {(busy||draft) && <button type="button" data-paimind-ui-button onClick={close}>{busy?'停止等待':'关闭确认'}</button>}
    {state && <>
      <h4>{state.targetName} 的功能包</h4><p>状态读取于 {new Date(state.observedAt).toLocaleString()}，不是持续实时状态。</p>
      <p>管理批准：{approved?'已覆盖完整协调范围':'尚未覆盖完整协调范围'}。{!ceiling && '部署允许范围不完整，请由部署人员检查已验收镜像。'}</p>
      <details><summary>批准与运行版本</summary><p>镜像：<code>{state.imageId}</code></p><p>目录：<code>{state.catalogDigest}</code></p><p>批准版本：{state.approval?.revision??0}</p><p>范围：{state.approval?.packIds.map(label).join('、')||'无'}</p></details>
      <div data-enterprise-actions><button type="button" data-paimind-ui-button disabled={busy||Boolean(draft)||needsRead||!ceiling} onClick={event=>open({kind:'approve'},event.currentTarget)}>批准完整管理范围</button>
        <button type="button" data-paimind-ui-button disabled={busy||Boolean(draft)||needsRead||!state.approval?.packIds.length} onClick={event=>open({kind:'revoke'},event.currentTarget)}>撤销管理批准</button></div>
      {state.command && <section aria-label="历史命令回执"><h4>历史命令回执</h4><p>{state.command.outcome==='unconfirmed'?'待确认':state.command.outcome==='applied'?'已确认应用':'已确认回退'} · {label(state.command.selection.id)}</p>
        <p>原原因：{state.command.reason}</p><code>{state.command.commandId}</code><p>此回执不代表当前仍启用，也不是使用权限。</p>
        {pending && state.recovery?.kind==='replacement-runtime' && <p role="status">该成员的运行环境已替换，原命令回执仍在。继续前需要明确确认当前环境，不会自动重建命令。</p>}
        {pending && state.recovery?.kind==='blocked' && <p role="alert">{state.recovery.reason}</p>}
        {pending && <button type="button" data-paimind-ui-button disabled={busy||Boolean(draft)||needsRead||!approved||!state.recovery||state.recovery.kind==='blocked'||state.command.imageId!==state.imageId} onClick={event=>open({kind:'resume'},event.currentTarget)}>恢复并确认原命令</button>}</section>}
      {nativePending && <p role="status">原生操作尚未结束。未开放新的启停；请保留原命令。</p>}
      {state.view.status==='unavailable' ? <p role="status">原生功能包暂时不可管理。</p> : <div data-paimind-feature-pack-grid>{state.view.packs.map(pack=><article key={pack.id} data-paimind-feature-pack data-enabled={String(pack.enabled)}>
        <h4>{label(pack.id)}</h4><p>已保存意愿：{(pack.desiredEnabled??pack.enabled)?'启用':'关闭'} · 原生报告：{pack.enabled?'启用':'关闭'}</p>{pack.failure && <p role="alert">{pack.failure}</p>}
        {[pack,...pack.capabilities].map(item=><div key={item.id} data-paimind-feature-capability><span>{label(item.id)}{item.failure && <span role="alert">{item.failure}</span>}</span><button type="button" role="switch" data-paimind-feature-switch aria-label={label(item.id)} aria-checked={item.desiredEnabled??item.enabled}
          disabled={busy||Boolean(draft)||needsRead||!approved||!ceiling||Boolean(pending)||Boolean(nativePending)||state.view.status!=='ready'||!state.view.writable||!item.installed}
          onClick={event=>{if(state.view.status==='ready')preview({id:item.id,enabled:!(item.desiredEnabled??item.enabled),expectedRevision:state.view.revision},event.currentTarget)}} /></div>)}
      </article>)}</div>}
      {draft && <form onSubmit={submit} aria-label="确认成员功能包操作"><fieldset disabled={busy}><legend>{draft.kind==='approve'?'批准管理范围':draft.kind==='revoke'?'撤销管理批准':draft.kind==='resume'?'恢复原命令':'确认功能包变更'}</legend>
        <p>目标：{state.targetName}。{draft.kind==='approve'||draft.kind==='revoke'?'本操作只改变管理批准，不启停功能。':'将影响所选成员，其他成员不在本次目标中。'}</p>
        {draft.kind==='resume' && state.recovery?.kind==='replacement-runtime' && <p>本次确认在同一成员、原数据、相同镜像与隔离策略的替代运行环境中恢复原命令。服务端会再次核对完整原生回执；环境变化时拒绝继续。</p>}
        {draft.kind==='change' && <><ul>{changes(draft.plan).map(change=><li key={change}>{change}</li>)}</ul><p>原生协调及回退会核对全部功能包：{draft.plan.reconciledPackIds.map(label).join('、')}。</p></>}
        <label>操作原因<textarea ref={reasonField} value={reason} maxLength={500} disabled={Boolean(attempt.current)} onChange={event=>{setReason(event.currentTarget.value);setConfirmed(false)}} /></label>
        <label data-enterprise-checkbox><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.currentTarget.checked)} />{draft.kind==='resume' && state.recovery?.kind==='replacement-runtime'?'我确认所选成员的替代运行环境、原命令、完整影响范围及审计记录。':'我确认所选成员、完整影响范围及审计记录。'}</label>
        <button type="submit" data-paimind-ui-button data-variant="primary" disabled={!confirmed||reason.trim().length<3}>{attempt.current?'重试原请求':'确认提交'}</button>
      </fieldset></form>}
    </>}
    <div ref={feedback} tabIndex={-1}>{error && <p role="alert">{error}。未把未知结果标记为成功。</p>}{message && <p role="status">{message}</p>}</div>
  </div>
}
