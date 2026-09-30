import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemberConnectorState } from '../src/client/connector-state.js'
import { connectorApprovalState, connectorActivationCommand } from '../src/client/connector-view.js'
import { EnterpriseApi, EnterpriseSession } from '../src/client/api.js'
import { AdminSection } from '../src/client/index.js'

const hansen = { userId:'b0000000-0000-4000-8000-000000000002',tenantId:'test',username:'hansen',displayName:'Hansen',role:'member',status:'active' }
const alex = { ...hansen,userId:'c0000000-0000-4000-8000-000000000003',username:'alex',displayName:'Alex' }
const admin = { ...hansen,userId:'a0000000-0000-4000-8000-000000000001',username:'morgan',displayName:'Morgan',role:'admin' }
const cell='d0000000-0000-4000-8000-000000000004',oldCell='e0000000-0000-4000-8000-000000000005',revision='a'.repeat(64),version='b'.repeat(64)
const entry = {entryId:'sales',serverName:'sales',transport:'streamable-http',configurationVersion:version,enabled:false,authority:'absent',phase:null,connection:'not-probed'}
const observation = (target=hansen.userId) => ({targetUserId:target,cellRevision:cell,observation:'native-lifecycle-only',runtimeGrant:false,lifecycle:{schema:'paimind.connector-observation/v1',revision,entries:[{...entry}]}})
const approved = () => ({targetUserId:hansen.userId,entryId:'sales',configurationVersion:version,serverName:'sales',transport:'streamable-http',imageId:'sha256:'+revision,policyDigest:'sha256:'+version,
  decision:'approved',revision:1,reason:'业务连接器批准',updatedBy:admin.userId,historicalRecord:true,runtimeGrant:false,activation:'not-observed'})
const intent = (enabled=true) => ({targetUserId:hansen.userId,expectedCellRevision:cell,expectedConfigurationRevision:revision,entryId:'sales',configurationVersion:version,enabled,expectedApprovalRevision:enabled?1:null,reason:'核对业务连接器',confirmed:true})
function receipt(input=intent(),outcome=input.enabled?'enabled':'disabled') {
  const commandId=crypto.randomUUID(),lifecycle=observation().lifecycle
  lifecycle.entries[0]={...entry,enabled:input.enabled,authority:input.enabled?'live':'absent'}
  return {commandId,targetUserId:input.targetUserId,outcome,intent:input,historicalReceipt:true,runtimeGrant:false,
    confirmation:outcome==='unconfirmed'?null:{commandId,outcome,lifecycle,observation:'native-lifecycle-only'}}
}
const ok = (data:unknown) => new Response(JSON.stringify({data}))
const disposers:Array<()=>void>=[]
afterEach(()=>{cleanup();disposers.splice(0).reverse().forEach(f=>f());vi.restoreAllMocks()})
function fixture() {
  const state:{account:any;members:any[];snapshot:any;approval:any;command:any;configCommand:any;write?:(path:string,input:any)=>Promise<Response>;approvalRead?:()=>Promise<Response>;audits:any[]}= {
    account:admin,members:[hansen,alex],snapshot:observation(),approval:null,command:null,configCommand:null,audits:[],
  }
  const writes=vi.fn(async(path:string,input:any)=>{
    if(state.write)return state.write(path,input)
    if(path.endsWith('/connector-approvals')) {state.approval={...(state.approval??approved()),decision:input.decision,revision:input.expectedApprovalRevision+1,reason:input.reason};return ok(state.approval)}
    if(path.endsWith('/resolve')){state.command={...state.command,outcome:'superseded',confirmation:{commandId:state.command.commandId,outcome:'superseded',effect:'unknown',cellRevision:input.expectedCellRevision,lifecycle:state.snapshot.lifecycle,reason:input.reason}};return ok(state.command)}
    state.command=receipt(input);return ok(state.command)
  })
  const transport=vi.fn(async(path:string|URL|Request,options?:RequestInit)=>{
    const url=String(path),body=options?.body?JSON.parse(String(options.body)):undefined
    if(url.endsWith('/auth/me'))return ok(state.account)
    if(url.endsWith('/admin/members'))return ok(state.members)
    if(url.endsWith('/admin/audit'))return ok(state.audits)
    if(url.endsWith('/connector-activation-state'))return ok({...state.snapshot,targetUserId:body.targetUserId})
    if(url.endsWith('/connector-approval-state'))return state.approvalRead?state.approvalRead():ok({targetUserId:body.targetUserId,entryId:body.entryId,approval:state.approval,observation:'stored-only'})
    if(url.endsWith('/connector-activation-command-state'))return ok({targetUserId:body.targetUserId,command:state.command})
    if(url.endsWith('/connector-command-state'))return ok({targetUserId:body.targetUserId,command:state.configCommand})
    if(url.endsWith('/connector-approvals')||url.endsWith('/connector-activation-commands')||url.endsWith('/resolve'))return writes(url,body)
    throw Error('Unexpected governance route: '+url)
  })
  const api=new EnterpriseApi(transport as typeof fetch);disposers.push(()=>api.dispose());return {api,state,transport,writes}
}
async function choose(target=hansen.userId){fireEvent.change(await screen.findByRole('combobox',{name:'成员'}),{target:{value:target}})}
async function observe(){fireEvent.change(screen.getByRole('textbox',{name:'核对原因'}),{target:{value:'核对原生启停'}});fireEvent.click(screen.getByRole('checkbox',{name:/我确认读取所选成员/}));fireEvent.click(screen.getByRole('button',{name:'记录原因并读取启停状态'}));await screen.findByRole('region',{name:'连接器启停观察'});fireEvent.click(screen.getByRole('button',{name:'选择 sales（sales）'}))}
async function draft(action='读取批准记录'){
  fireEvent.click(screen.getByRole('button',{name:action}));const form=screen.getByRole('form',{name:'确认连接器治理操作'})
  fireEvent.change(within(form).getByRole('textbox',{name:'治理原因'}),{target:{value:'核对业务连接器'}});return form
}
function submit(form:HTMLElement){fireEvent.click(within(form).getByRole('checkbox',{name:/我确认成员、条目/}));fireEvent.submit(form)}
async function readApproval(){submit(await draft());await waitFor(()=>expect(screen.queryByRole('form',{name:'确认连接器治理操作'})).toBeNull());await screen.findByText(/所选条目尚无批准记录|历史批准记录已/)}
async function readCommands(){fireEvent.click(screen.getByRole('button',{name:'读取启停操作记录'}));await waitFor(()=>expect(screen.getByRole('button',{name:'读取启停操作记录'})).toBeEnabled())}
async function ready(f:ReturnType<typeof fixture>){render(<MemberConnectorState api={f.api}/>);await choose();await observe();await readApproval();await readCommands()}

describe('connector governance in native Settings (component evidence, not Browser E2E)',()=>{
  it('does not prefetch approval or command records, requires reason/confirmation and shows no-record feedback',async()=>{
    const f=fixture();render(<MemberConnectorState api={f.api}/>);await choose();expect(f.transport).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button',{name:'读取批准记录'})).toBeDisabled();fireEvent.change(screen.getByLabelText('治理条目编号'),{target:{value:'sales'}})
    const form=await draft();expect(within(form).getByRole('button',{name:'确认治理操作'})).toBeDisabled();expect(screen.getByRole('combobox',{name:'成员'})).toBeDisabled()
    submit(form);await screen.findByText('所选条目尚无批准记录。');expect(f.writes).not.toHaveBeenCalled();expect(f.transport).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button',{name:'批准当前配置版本'})).toBeDisabled()
  })
  it('approves exactly the observed cell/configuration and expected approval revision without enabling',async()=>{
    const f=fixture();await ready(f);submit(await draft('批准当前配置版本'));await screen.findByText('历史批准记录已批准 · 修订 1')
    expect(f.writes).toHaveBeenCalledTimes(1);expect(f.writes.mock.calls[0]![1]).toEqual({targetUserId:hansen.userId,entryId:'sales',expectedApprovalRevision:0,decision:'approved',expectedCellRevision:cell,expectedConfigurationRevision:revision,reason:'核对业务连接器',confirmed:true})
    expect(screen.getByRole('button',{name:'启用连接器'})).toBeEnabled();expect(f.state.command).toBeNull()
  })
  it('enables once with exact version/approval and invalidates the snapshot; history read never resends',async()=>{
    const f=fixture();f.state.approval=approved();await ready(f);const form=await draft('启用连接器');submit(form);fireEvent.submit(form)
    await screen.findByText(/该次启用操作已确认/);expect(f.writes).toHaveBeenCalledTimes(1);expect(f.writes.mock.calls[0]![1]).toEqual(intent())
    expect(screen.getByRole('button',{name:'启用连接器'})).toBeDisabled();expect(screen.getByText(/以下是提交前的快照/)).toBeInTheDocument()
    await readCommands();expect(f.writes).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'启用连接器'})).toBeDisabled()
    expect(screen.getByRole('button',{name:'撤销批准'})).toBeEnabled()
  })
  it('disables without current approval and without deleting configuration',async()=>{
    const f=fixture();f.state.snapshot.lifecycle.entries[0]={...entry,enabled:true,authority:'absent',phase:'pending'};await ready(f)
    expect(screen.getByRole('button',{name:'撤销批准'})).toBeDisabled();submit(await draft('停用连接器'));await screen.findByText(/该次停用操作已确认/)
    expect(f.writes.mock.calls[0]![1]).toEqual(intent(false));expect(f.state.approval).toBeNull()
  })
  it('allows a disabled/offline member approval read and revocation without native read or cell fields',async()=>{
    const f=fixture();f.state.members=[{...hansen,status:'disabled'},alex];f.state.approval=approved();render(<MemberConnectorState api={f.api}/>);await choose()
    fireEvent.change(screen.getByLabelText('治理条目编号'),{target:{value:'sales'}});await readApproval()
    expect(screen.getByRole('button',{name:'记录原因并读取启停状态'})).toBeDisabled();submit(await draft('撤销批准'));await screen.findByText('历史批准记录已撤销 · 修订 2')
    expect(f.writes.mock.calls[0]![1]).toEqual({targetUserId:hansen.userId,entryId:'sales',expectedApprovalRevision:1,decision:'revoked',reason:'核对业务连接器',confirmed:true})
    expect(f.transport.mock.calls.some(([path])=>String(path).endsWith('/connector-activation-state'))).toBe(false)
  })
  it('blocks unknown activation but leaves revocation available and no same-cell recovery',async()=>{
    const f=fixture();f.state.approval=approved();f.state.command=receipt(intent(),'unconfirmed');await ready(f)
    for(const name of ['批准当前配置版本','启用连接器','停用连接器'])expect(screen.getByRole('button',{name})).toBeDisabled()
    expect(screen.queryByRole('button',{name:'核验替代环境并结束启停旧操作追认'})).toBeNull();submit(await draft('撤销批准'));await screen.findByText('历史批准记录已撤销 · 修订 2');expect(f.writes).toHaveBeenCalledTimes(1)
  })
  it('recovers a lost whole activation response through metadata only and preserves unknown effects',async()=>{
    const f=fixture();f.state.approval=approved();f.state.write=async(_path,input)=>{f.state.command=receipt(input,'unconfirmed');throw Error('连接已中断')};await ready(f)
    submit(await draft('启用连接器'));await screen.findByRole('alert');expect(screen.getByRole('button',{name:'启用连接器'})).toBeDisabled()
    await readCommands();await screen.findByText(/启停结果未确认，可能已经生效/);expect(f.writes).toHaveBeenCalledTimes(1)
  })
  it('cancels local waiting, unlocks selection and discards a late response after member change',async()=>{
    const f=fixture();f.state.approval=approved();let release!:(value:Response)=>void;f.state.write=async()=>new Promise(resolve=>{release=resolve});await ready(f)
    submit(await draft('启用连接器'));await waitFor(()=>expect(release).toBeTypeOf('function'));expect(screen.getByRole('combobox',{name:'成员'})).toBeDisabled()
    fireEvent.click(screen.getByRole('button',{name:'停止等待批准／启停结果'}));await screen.findByText(/已停止等待，未撤销操作/);await choose(alex.userId)
    await act(async()=>release(ok(receipt())));expect(screen.queryByText(/该次启用操作已确认/)).toBeNull();expect(screen.getByText('为 Alex 管理批准与启停')).toBeInTheDocument();expect(f.writes).toHaveBeenCalledTimes(1)
  })
  it('rejects mismatched activation receipts, retains uncertainty and never grants via history',async()=>{
    const f=fixture();f.state.approval=approved();f.state.write=async(_path,input)=>ok(receipt({...input,configurationVersion:'c'.repeat(64)}));await ready(f)
    submit(await draft('启用连接器'));await screen.findByRole('alert');expect(screen.queryByText(/该次启用操作已确认/)).toBeNull();expect(screen.getByRole('button',{name:'启用连接器'})).toBeDisabled()
  })
  it('blocks new approvals/activation for an unknown disabled-configuration command too',async()=>{
    const f=fixture();f.state.approval=approved();f.state.configCommand={commandId:crypto.randomUUID(),targetUserId:hansen.userId,outcome:'unconfirmed',intent:{targetUserId:hansen.userId,expectedCellRevision:cell,expectedConfigurationRevision:revision,change:{kind:'upsert',entryId:'sales'},reason:'修改连接器配置',confirmed:true},confirmation:null,historicalReceipt:true,runtimeGrant:false};await ready(f)
    expect(screen.getByText(/停用配置操作仍未确认/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'批准当前配置版本'})).toBeDisabled();expect(screen.getByRole('button',{name:'撤销批准'})).toBeEnabled()
  })
  it('only offers fenced replacement resolution after a different observed cell and sends no activation',async()=>{
    const f=fixture();f.state.command=receipt({...intent(),expectedCellRevision:oldCell},'unconfirmed');await ready(f)
    submit(await draft('核验替代环境并结束启停旧操作追认'));await screen.findByText(/已结束旧启停操作追认；历史效果仍未知/)
    expect(f.writes).toHaveBeenCalledTimes(1);expect(f.writes.mock.calls[0]![0]).toContain('/resolve');expect(f.writes.mock.calls[0]![1]).toEqual({expectedCellRevision:cell,reason:'核对业务连接器',confirmed:true})
  })
  it('does not reinterpret permission or concurrent approval conflict as success or retry',async()=>{
    const f=fixture();f.state.approval=approved();f.state.write=async()=>new Response(JSON.stringify({title:'批准修订已变化'}),{status:409});await ready(f)
    submit(await draft('撤销批准'));await screen.findByRole('alert');expect(screen.queryByText(/历史批准记录已批准/)).toBeNull();expect(screen.getByRole('button',{name:'撤销批准'})).toBeDisabled();expect(f.writes).toHaveBeenCalledTimes(1)
    f.state.approvalRead=async()=>new Response(JSON.stringify({title:'需要管理员权限'}),{status:403});submit(await draft());await screen.findByText('需要管理员权限');expect(f.writes).toHaveBeenCalledTimes(1)
  })
  it('clears confirmation after editing, Escape restores opener focus, target changes clear prior records',async()=>{
    const f=fixture();f.state.approval=approved();await ready(f);const button=screen.getByRole('button',{name:'撤销批准'}),form=await draft('撤销批准'),ui=within(form)
    expect(ui.getByRole('textbox',{name:'治理原因'})).toHaveFocus();fireEvent.click(ui.getByRole('checkbox'));fireEvent.change(ui.getByRole('textbox'),{target:{value:'新的撤销原因'}});expect(ui.getByRole('checkbox')).not.toBeChecked()
    fireEvent.keyDown(form,{key:'Escape'});await waitFor(()=>expect(button).toHaveFocus());expect(screen.queryByRole('form',{name:'确认连接器治理操作'})).toBeNull()
    await choose(alex.userId);expect(screen.queryByText(/历史批准记录已批准/)).toBeNull();expect(f.writes).not.toHaveBeenCalled()
  })
  it('does not enable with an old approval version or unversioned native configuration',async()=>{
    const f=fixture();f.state.approval={...approved(),configurationVersion:'c'.repeat(64)};await ready(f)
    expect(screen.getByRole('button',{name:'启用连接器'})).toBeDisabled();expect(screen.getByText(/不能用旧批准启用/)).toBeInTheDocument()
    f.state.snapshot.lifecycle.entries[0]={...entry,configurationVersion:null};fireEvent.click(screen.getByRole('button',{name:'记录原因并读取启停状态'}));await screen.findByText(/旧配置未版本化/)
    fireEvent.click(screen.getByRole('button',{name:'选择 sales（sales）'}));await readApproval();await readCommands();expect(screen.getByRole('button',{name:'批准当前配置版本'})).toBeDisabled();expect(screen.getByRole('button',{name:'撤销批准'})).toBeEnabled()
  })
  it('locks native administration navigation while editing and clears on role loss during an in-flight action',async()=>{
    const f=fixture();f.state.approval=approved();const session=new EnterpriseSession(f.api);disposers.push(()=>session.dispose());await session.refresh();render(<AdminSection session={session}/>);fireEvent.click(screen.getByRole('button',{name:'成员连接器配置'}));await choose();await observe();await readApproval();await readCommands()
    let release!:(value:Response)=>void;f.state.write=async()=>new Promise(resolve=>{release=resolve});const form=await draft('启用连接器');expect(screen.getByRole('button',{name:'操作审计'})).toBeDisabled();submit(form);await waitFor(()=>expect(release).toBeTypeOf('function'))
    f.state.account=hansen;await act(async()=>session.refresh());await act(async()=>release(ok(receipt())));expect(screen.getByText('此操作仅限管理员。')).toBeInTheDocument();expect(screen.queryByText(/该次启用操作已确认/)).toBeNull()
  })
  it('strictly rejects authority claims, private fields, wrong identities and inconsistent receipts',()=>{
    const a=approved(),state={targetUserId:hansen.userId,entryId:'sales',approval:a,observation:'stored-only'}
    for(const approval of [{...a,runtimeGrant:true},{...a,headers:'PRIVATE'},{...a,targetUserId:alex.userId},{...a,entryId:'other'},{...a,revision:0},{...a,imageId:'latest'},{...a,activation:'enabled'}])expect(()=>connectorApprovalState({...state,approval},hansen.userId,'sales')).toThrow()
    const c=receipt()
    for(const bad of [{...c,runtimeGrant:true},{...c,targetUserId:alex.userId},{...c,url:'PRIVATE'},{...c,intent:{...c.intent,expectedApprovalRevision:null}},{...c,outcome:'disabled'},{...c,confirmation:{...c.confirmation,observation:'authorized'}},{...c,outcome:'unconfirmed'}])expect(()=>connectorActivationCommand(bad,hansen.userId)).toThrow()
    expect(()=>connectorActivationCommand(receipt(intent(false)),hansen.userId)).not.toThrow()
  })
  it('allowlists only exact governance routes/methods and never persists browser state',async()=>{
    const storage=vi.spyOn(Storage.prototype,'setItem'),transport=vi.fn<typeof fetch>().mockImplementation(async()=>ok({})),api=new EnterpriseApi(transport);disposers.push(()=>api.dispose());const id=crypto.randomUUID()
    for(const path of ['/admin/connector-approval-state','/admin/connector-approvals','/admin/connector-activation-commands','/admin/connector-activation-command-state',`/admin/connector-activation-commands/${id}/resolve`]){await api.request(path,'POST',{},crypto.randomUUID());await expect(api.request(path)).rejects.toThrow('Unsupported')}
    await api.request(`/admin/connector-activation-commands/${id}`)
    for(const path of ['/native/connector.activate','/admin/connector-activation-commands/invalid/resolve',`/admin/connector-activation-commands/${id}/activate`])await expect(api.request(path,'POST',{},crypto.randomUUID())).rejects.toThrow('Unsupported')
    expect(transport).toHaveBeenCalledTimes(6);expect(storage).not.toHaveBeenCalled()
  })
  it('renders approval, activation and unknown-effect audit feedback without a current-grant claim',async()=>{
    const f=fixture();f.state.audits=[['runtime.connector.approval',{decision:'revoked',reason:'撤销旧业务批准'}],['runtime.connector.activation.confirmed',{outcome:'enabled',reason:'启用业务连接器'}],['runtime.connector.activation.resolved',{effect:'unknown',reason:'核验替代环境'}]].map(([action,reason],index)=>({event_id:'audit-'+index,action,reason:JSON.stringify(reason),outcome:'succeeded',occurred_at:'2026-09-23T00:00:00Z',actor_user_id:admin.userId,target_id:hansen.userId,request_id:'governance-'+index}))
    const session=new EnterpriseSession(f.api);disposers.push(()=>session.dispose());await session.refresh();render(<AdminSection session={session}/>);fireEvent.click(screen.getByRole('button',{name:'操作审计'}))
    await screen.findByText(/记录已撤销，不证明运行单元已停用/);expect(screen.getByText(/该次启用已确认，历史回执不代表当前状态或使用许可/)).toBeInTheDocument();expect(screen.getByText(/历史效果仍未知，没有重发或证明回退/)).toBeInTheDocument()
  })
})
