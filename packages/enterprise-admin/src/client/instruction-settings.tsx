import { useEffect, useRef, useState, type FormEvent } from 'react'
import { EnterpriseApi, memberViews, type AccountView } from './api.js'

interface Snapshot { targetUserId: string; cellRevision: string; configuration: { enabled: boolean; instructions: string; revision: number; writable: boolean; applies: 'live' }; audit: { requestId: string; reason: string } }
interface Receipt { commandId: string; targetUserId: string; outcome: 'applied' | 'conflict' | 'unconfirmed' | 'superseded'; intent: { expectedCellRevision: string } }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(v)
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('成员指令响应无效'); return v as Record<string, unknown> }
function snapshot(v: unknown, target: string, reason: string): Snapshot {
  const row=object(v), c=object(row.configuration), audit=object(row.audit)
  if(row.targetUserId!==target || !uuid(row.cellRevision) || !uuid(audit.requestId) || audit.reason!==reason
    || typeof c.enabled!=='boolean' || typeof c.instructions!=='string' || c.instructions.length>8000 || typeof c.writable!=='boolean'
    || !Number.isSafeInteger(c.revision) || Number(c.revision)<0 || c.applies!=='live') throw Error('成员或原生指令修订不匹配')
  return row as unknown as Snapshot
}
function receipt(v: unknown, target: string): Receipt {
  const row=object(v), intent=object(row.intent)
  if(row.targetUserId!==target || intent.targetUserId!==target || !uuid(row.commandId) || !uuid(intent.expectedCellRevision)
    || !['applied','conflict','unconfirmed','superseded'].includes(String(row.outcome)) || row.historicalReceipt!==true || row.runtimeGrant!==false) throw Error('成员指令操作回执不匹配')
  const change=object(intent.change)
  if(Object.hasOwn(change,'instructions') || typeof change.enabled!=='boolean' || !Number.isSafeInteger(change.instructionLength)
    || Number(change.instructionLength)<0 || Number(change.instructionLength)>8000) throw Error('成员指令回执元数据无效')
  if(row.outcome==='unconfirmed') { if(row.confirmation!==null)throw Error('未知操作回执无效') }
  else { const c=object(row.confirmation); if(c.commandId!==row.commandId || c.outcome!==row.outcome)throw Error('操作确认不匹配') }
  return row as unknown as Receipt
}
const labels = { applied:'原生保存及回读已确认', conflict:'原生修订冲突，未执行此次覆盖', unconfirmed:'结果不确定，不要重复提交', superseded:'旧操作已隔离结束，历史效果仍不确定' }

/** One existing Settings contribution. No local storage, copied configuration
 * service, automatic retries, or client-side authorization. */
export function MemberInstructionSettings({api,onEditing}:{api:EnterpriseApi;onEditing?:(value:boolean)=>void}):JSX.Element {
  const [members,setMembers]=useState<AccountView[]>(),[member,setMember]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false)
  const [state,setState]=useState<Snapshot>(),[command,setCommand]=useState<Receipt|null>(),[instructions,setInstructions]=useState(''),[enabled,setEnabled]=useState(true)
  const [ack,setAck]=useState(false),[busy,setBusy]=useState<string>(),[error,setError]=useState<string>(),[notice,setNotice]=useState<string>(),[reload,setReload]=useState(0)
  const [focusRequest,setFocusRequest]=useState(0)
  const current=useRef<AbortController>(),feedback=useRef<HTMLDivElement>(null),reasonInput=useRef<HTMLTextAreaElement>(null)
  const dirty=Boolean(state && (instructions!==state.configuration.instructions || enabled!==state.configuration.enabled))
  useEffect(()=>{onEditing?.(dirty||busy==='write');return()=>onEditing?.(false)},[dirty,busy,onEditing])
  const clear=()=>{current.current?.abort();current.current=undefined;setState(undefined);setCommand(undefined);setInstructions('');setAck(false);setBusy(undefined);setError(undefined);setNotice(undefined)}
  useEffect(()=>{
    const abort=new AbortController();clear();setMembers(undefined);setMember('');setReason('');setConfirmed(false)
    void api.request('/admin/members','GET',undefined,undefined,abort.signal).then(memberViews).then(rows=>{if(!abort.signal.aborted)setMembers(rows.filter(r=>r.role==='member'&&r.status==='active'))})
      .catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'成员读取失败')})
    return()=>{abort.abort();current.current?.abort();current.current=undefined}
  },[api,reload])
  useEffect(()=>{if(error||notice||command)feedback.current?.focus()},[error,notice,command])
  // The reason field is disabled while editing; focus it only after React has
  // committed the cleared state and re-enabled its fieldset.
  useEffect(()=>{if(focusRequest)reasonInput.current?.focus()},[focusRequest])
  const valid=members?.some(r=>r.userId===member)&&confirmed&&reason.trim().length>=3&&reason.trim().length<=500
  const start=(kind:string)=>{const abort=new AbortController();current.current=abort;setBusy(kind);setError(undefined);setNotice(undefined);return abort}
  const live=(abort:AbortController)=>current.current===abort&&!abort.signal.aborted
  const finish=(abort:AbortController)=>{if(current.current===abort){current.current=undefined;setBusy(undefined)}}
  const latest=async(abort:AbortController,target:string)=>{
    const row=object(await api.request('/admin/instruction-command-state','POST',{targetUserId:target},crypto.randomUUID(),abort.signal))
    if(row.targetUserId!==target)throw Error('操作记录成员不匹配')
    return row.command===null?null:receipt(row.command,target)
  }
  const read=async(event:FormEvent)=>{
    event.preventDefault();if(!valid||current.current||dirty)return
    const abort=start('read'),target=member,why=reason.trim();setState(undefined);setInstructions('');setCommand(undefined);setAck(false)
    try{
      const value=snapshot(await api.request('/admin/instruction-configuration','POST',{targetUserId:target,reason:why,confirmed:true},crypto.randomUUID(),abort.signal),target,why)
      const prior=await latest(abort,target)
      if(live(abort)){setState(value);setInstructions(value.configuration.instructions);setEnabled(value.configuration.enabled);setCommand(prior);setNotice('已读取原生配置并记录访问原因与审计。')}
    }catch(e){if(live(abort))setError(e instanceof Error?e.message:'指令读取失败')}finally{finish(abort)}
  }
  const recover=async()=>{
    if(!member||current.current)return
    const abort=start('receipt'),target=member;setState(undefined);setInstructions('');setAck(false)
    try{const value=await latest(abort,target);if(live(abort)){setCommand(value);setNotice('只回读操作记录，没有再次发送指令。请重新核对原生配置后再操作。')}}
    catch(e){if(live(abort))setError(e instanceof Error?e.message:'操作记录读取失败')}finally{finish(abort)}
  }
  const write=async(event:FormEvent)=>{
    event.preventDefault();if(!state||!valid||!dirty||!ack||!state.configuration.writable||current.current||command?.outcome==='unconfirmed')return
    const abort=start('write'),target=member,input={targetUserId:member,expectedCellRevision:state.cellRevision,expectedSettingsRevision:state.configuration.revision,
      change:{enabled,instructions},reason:reason.trim(),confirmed:true}
    // Discard the editor immediately. An uncertain operation can only be read
    // back, never retried with cached content or a newly generated key.
    setState(undefined);setInstructions('');setAck(false);setCommand(undefined);setNotice('正在提交；停止等待不代表取消原生写入。')
    try{const value=receipt(await api.request('/admin/instruction-commands','POST',input,crypto.randomUUID(),abort.signal),target);if(live(abort)){setCommand(value);setNotice('操作回执已返回；再次配置前须重新读取。')}}
    catch(e){if(live(abort)){setError(e instanceof Error?e.message:'提交结果未知');setNotice('写入可能已经发生。请读取最近操作记录，不要重复提交。')}}finally{finish(abort)}
  }
  const resolve=async()=>{
    if(!state||!command||command.outcome!=='unconfirmed'||state.cellRevision===command.intent.expectedCellRevision||!ack||!valid||current.current)return
    const abort=start('resolve'),target=member,id=command.commandId,pin=state.cellRevision;setState(undefined);setInstructions('');setAck(false)
    try{const value=receipt(await api.request('/admin/instruction-commands/'+id+'/resolve','POST',{expectedCellRevision:pin,reason:reason.trim(),confirmed:true},crypto.randomUUID(),abort.signal),target)
      if(live(abort)){setCommand(value);setNotice('历史效果仍不确定，旧操作没有重发。新配置需重新读取并明确提交。')}}
    catch(e){if(live(abort))setError(e instanceof Error?e.message:'追认未完成')}finally{finish(abort)}
  }
  const cancel=()=>{const writing=busy==='write'||busy==='resolve';clear();setConfirmed(false);if(writing)setNotice('已停止等待，不能据此判断写入是否发生。请读取最近操作记录。');setFocusRequest(n=>n+1)}
  return <div onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel()}}}>
    <div data-enterprise-toolbar><h3>成员企业指令</h3><button data-paimind-ui-button type="button" onClick={cancel}>关闭编辑／停止等待</button></div>
    <p data-paimind-ui-summary>由管理员配置到所选成员的原生设置，作为系统提示词的补充；不替换智能体人设，不改变工具、模型或权限。正文不进入企业操作记录。</p>
    {members===undefined&&!error&&<p role="status" aria-busy="true">正在读取成员…</p>}
    {members?.length===0&&<p role="status">暂无已启用的使用人员。</p>}
    {members&&<form data-enterprise-form onSubmit={event=>{void read(event)}}><fieldset disabled={Boolean(busy)||dirty}><legend>选择成员并核对原生配置</legend>
      <label>成员<select required value={member} onChange={event=>{clear();setMember(event.currentTarget.value);setConfirmed(false)}}><option value="">请选择成员</option>{members.map(row=><option key={row.userId} value={row.userId}>{row.displayName}（{row.username}）</option>)}</select></label>
      <label>操作原因<textarea ref={reasonInput} required minLength={3} maxLength={500} value={reason} onChange={event=>{clear();setReason(event.currentTarget.value);setConfirmed(false)}}/></label>
      <label data-enterprise-checkbox><input type="checkbox" checked={confirmed} onChange={event=>{clear();setConfirmed(event.currentTarget.checked)}}/>我确认读取所选成员的企业指令，并保留访问审计。</label>
      <button data-paimind-ui-button type="submit" disabled={!valid}>记录原因并读取指令</button>
    </fieldset></form>}
    {state&&<><p>读取请求：{state.audit.requestId}；原因：{state.audit.reason}。原生修订：{state.configuration.revision}。</p>
      {command?.outcome==='unconfirmed'?<div><p role="status">该成员有未知结果操作，不能提交新配置。部署人员须先隔离旧运行单元；当前页面不能重启它。</p>
        <label data-enterprise-checkbox><input type="checkbox" checked={ack} onChange={event=>setAck(event.currentTarget.checked)}/>我确认旧操作不会重发，历史效果仍不确定。</label>
        <button data-paimind-ui-button type="button" disabled={!ack||Boolean(busy)||state.cellRevision===command.intent.expectedCellRevision} onClick={()=>{void resolve()}}>核对隔离后的单元并结束追认</button></div>
      :<form data-enterprise-form onSubmit={event=>{void write(event)}}><fieldset disabled={Boolean(busy)||!state.configuration.writable}><legend>编辑当前成员的企业指令</legend>
        <label data-enterprise-checkbox><input type="checkbox" checked={enabled} onChange={event=>{setEnabled(event.currentTarget.checked);setAck(false)}}/>启用企业指令</label>
        <label>企业指令正文<textarea value={instructions} maxLength={8000} rows={8} onChange={event=>{setInstructions(event.currentTarget.value);setAck(false)}}/></label>
        <p>{instructions.length} / 8000 字符；停用会保留原文。保存仅影响所选成员，原生修订变化时拒绝覆盖。</p>
        <label data-enterprise-checkbox><input type="checkbox" checked={ack} onChange={event=>setAck(event.currentTarget.checked)}/>我确认将以上内容保存到所选成员，并记录操作原因。</label>
        <button data-paimind-ui-button type="submit" data-variant="primary" disabled={!dirty||!ack}>保存成员企业指令</button>
      </fieldset>{!state.configuration.writable&&<p role="status">当前原生配置只读，不能保存。</p>}</form>}
    </>}
    <div ref={feedback} tabIndex={-1}>{busy&&<p role="status" aria-busy="true">正在核对并处理，请稍候…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {command&&<p role="status">{labels[command.outcome]}。操作编号：{command.commandId}。这是历史回执，不是当前权限或持续状态证明。</p>}
      {command===null&&<p role="status">未发现已预留的指令操作记录。</p>}
      {member&&<button data-paimind-ui-button type="button" disabled={Boolean(busy)||dirty} onClick={()=>{void recover()}}>读取最近操作记录</button>}
      {!members&&error&&<button data-paimind-ui-button type="button" onClick={()=>setReload(n=>n+1)}>重试成员列表</button>}
    </div>
  </div>
}
