import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseApi } from '../src/client/api.js'
import { MemberInstructionSettings } from '../src/client/instruction-settings.js'

const hansen={userId:'b0000000-0000-4000-8000-000000000002',tenantId:'instruction-ui',username:'hansen',displayName:'Hansen',role:'member',status:'active'}
const alex={...hansen,userId:'c0000000-0000-4000-8000-000000000003',username:'alex',displayName:'Alex'}
const cellRevision='d0000000-0000-4000-8000-000000000004'
const apis:EnterpriseApi[]=[]
afterEach(()=>{cleanup();for(const api of apis.splice(0))api.dispose();vi.restoreAllMocks()})
function fixture(){
  const ok=(data:unknown)=>new Response(JSON.stringify({data}))
  const state:{members?:typeof hansen[];command?:any;cell?:string;writable?:boolean;read?:(input:any,signal?:AbortSignal|null)=>Promise<Response>;write?:(input:any)=>Promise<Response>}={}
  const read=vi.fn(async(input:any,signal?:AbortSignal|null)=>state.read?state.read(input,signal):ok({targetUserId:input.targetUserId,cellRevision:state.cell??cellRevision,
    configuration:{enabled:true,instructions:input.targetUserId===hansen.userId?'Hansen existing instructions':'Alex existing instructions',revision:3,writable:state.writable??true,applies:'live'},
    audit:{requestId:'e0000000-0000-4000-8000-000000000005',reason:input.reason}}))
  const commands=vi.fn(async(input:any)=>{
    if(state.write)return state.write(input)
    state.command={commandId:crypto.randomUUID(),targetUserId:input.targetUserId,outcome:'applied',intent:{...input,change:{enabled:input.change.enabled,instructionLength:input.change.instructions.length}},historicalReceipt:true,runtimeGrant:false}
    state.command.confirmation={commandId:state.command.commandId,outcome:'applied'};return ok(state.command)
  })
  const transport=vi.fn(async(path:string|URL|Request,options?:RequestInit)=>{
    if(path==='/haas/v1/admin/members')return ok(state.members??[hansen,alex])
    const input=JSON.parse(String(options?.body??'{}'))
    if(path==='/haas/v1/admin/instruction-configuration')return read(input,options?.signal)
    if(path==='/haas/v1/admin/instruction-commands')return commands(input)
    if(path==='/haas/v1/admin/instruction-command-state')return ok({targetUserId:input.targetUserId,command:state.command??null})
    if(String(path).endsWith('/resolve')){state.command={...state.command,outcome:'superseded',confirmation:{commandId:state.command.commandId,outcome:'superseded',effect:'unknown'}};return ok(state.command)}
    throw Error('Unexpected instruction UI route')
  })
  const api=new EnterpriseApi(transport as typeof fetch);apis.push(api);return{api,state,ok,read,commands,transport}
}
async function choose(){
  fireEvent.change(await screen.findByRole('combobox',{name:'成员'}),{target:{value:hansen.userId}})
  fireEvent.change(screen.getByRole('textbox',{name:'操作原因'}),{target:{value:'核对成员企业指令'}})
  fireEvent.click(screen.getByRole('checkbox',{name:/我确认读取/}))
}
const read=()=>fireEvent.click(screen.getByRole('button',{name:'记录原因并读取指令'}))
const edit=async()=>{
  fireEvent.change(await screen.findByRole('textbox',{name:'企业指令正文'}),{target:{value:'New explicit instructions {{literal}}'}})
  fireEvent.click(screen.getByRole('checkbox',{name:/我确认将以上内容/}))
}
describe('ISO-03 original Settings interaction components, not Browser E2E',()=>{
  it('requires member/reason/confirmation, renders original values and does not write on read',async()=>{
    const f=fixture();render(<MemberInstructionSettings api={f.api}/>)
    await screen.findByRole('combobox',{name:'成员'});expect(f.read).not.toHaveBeenCalled()
    expect(screen.getByRole('button',{name:'记录原因并读取指令'})).toBeDisabled()
    await choose();read();expect(await screen.findByDisplayValue('Hansen existing instructions')).toBeInTheDocument()
    expect(f.read.mock.calls[0]![0]).toEqual({targetUserId:hansen.userId,reason:'核对成员企业指令',confirmed:true})
    expect(f.commands).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'保存成员企业指令'})).toBeDisabled()
  })
  it('sends once with exact target/revisions and discards editable text after submission',async()=>{
    const f=fixture();render(<MemberInstructionSettings api={f.api}/>);await choose();read();await edit()
    const button=screen.getByRole('button',{name:'保存成员企业指令'});fireEvent.click(button);fireEvent.click(button)
    await screen.findByText(/原生保存及回读已确认/)
    expect(f.commands).toHaveBeenCalledTimes(1)
    expect(f.commands.mock.calls[0]![0]).toEqual({targetUserId:hansen.userId,expectedCellRevision:cellRevision,expectedSettingsRevision:3,
      change:{enabled:true,instructions:'New explicit instructions {{literal}}'},reason:'核对成员企业指令',confirmed:true})
    expect(screen.queryByRole('textbox',{name:'企业指令正文'})).toBeNull()
    const headers=f.transport.mock.calls.find(([url])=>url==='/haas/v1/admin/instruction-commands')![1]!.headers as Record<string,string>
    expect(headers['Idempotency-Key']).toMatch(/^[a-f0-9-]{36}$/u)
  })
  it('locks navigation while dirty and clears on Escape with reason focus restored',async()=>{
    const f=fixture(),editing=vi.fn();render(<MemberInstructionSettings api={f.api} onEditing={editing}/>);await choose();read();await edit()
    expect(editing).toHaveBeenLastCalledWith(true);expect(screen.getByRole('combobox',{name:'成员'})).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('textbox',{name:'企业指令正文'}),{key:'Escape'})
    expect(screen.queryByDisplayValue('New explicit instructions {{literal}}')).toBeNull()
    expect(screen.getByRole('textbox',{name:'操作原因'})).toHaveFocus();expect(editing).toHaveBeenLastCalledWith(false)
    expect(f.commands).not.toHaveBeenCalled()
  })
  it('does not resend a lost response and only reads the durable receipt',async()=>{
    const f=fixture();f.state.write=async input=>{f.state.command={commandId:crypto.randomUUID(),targetUserId:input.targetUserId,outcome:'unconfirmed',
      intent:{...input,change:{enabled:true,instructionLength:input.change.instructions.length}},historicalReceipt:true,runtimeGrant:false,confirmation:null};throw Error('Explicit simulated disconnect')}
    render(<MemberInstructionSettings api={f.api}/>);await choose();read();await edit();fireEvent.click(screen.getByRole('button',{name:'保存成员企业指令'}))
    await screen.findByText(/写入可能已经发生/);fireEvent.click(screen.getByRole('button',{name:'读取最近操作记录'}));await screen.findByText(/结果不确定，不要重复提交/)
    expect(f.commands).toHaveBeenCalledTimes(1);read();await screen.findByText(/部署人员须先隔离旧运行单元/)
    expect(screen.queryByRole('button',{name:'保存成员企业指令'})).toBeNull()
    fireEvent.click(screen.getByRole('checkbox',{name:/我确认旧操作不会重发/}));expect(screen.getByRole('button',{name:'核对隔离后的单元并结束追认'})).toBeDisabled()
    f.state.cell=crypto.randomUUID();read();await waitFor(()=>expect(screen.getByRole('checkbox',{name:/我确认旧操作不会重发/})).not.toBeChecked())
    fireEvent.click(screen.getByRole('checkbox',{name:/我确认旧操作不会重发/}));fireEvent.click(screen.getByRole('button',{name:'核对隔离后的单元并结束追认'}))
    await screen.findByText(/旧操作已隔离结束/);expect(f.commands).toHaveBeenCalledTimes(1)
  })
  it('aborts a cancelled read and ignores late content before another member is chosen',async()=>{
    const f=fixture();let done!:(v:Response)=>void,signal:AbortSignal|undefined
    f.state.read=async(_input,s)=>{signal=s??undefined;return new Promise(resolve=>{done=resolve})}
    render(<MemberInstructionSettings api={f.api}/>);await choose();read();await waitFor(()=>expect(f.read).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button',{name:'关闭编辑／停止等待'}));expect(signal?.aborted).toBe(true)
    fireEvent.change(screen.getByRole('combobox',{name:'成员'}),{target:{value:alex.userId}})
    await act(async()=>done(f.ok({targetUserId:hansen.userId,cellRevision,configuration:{enabled:true,instructions:'Hansen late private value',revision:3,writable:true,applies:'live'},
      audit:{requestId:crypto.randomUUID(),reason:'核对成员企业指令'}})))
    expect(screen.queryByDisplayValue('Hansen late private value')).toBeNull();expect(screen.queryByRole('textbox',{name:'企业指令正文'})).toBeNull()
  })
  it('rejects mismatched snapshots, clears on unmount and shows read-only and empty states',async()=>{
    const f=fixture();f.state.read=async input=>f.ok({targetUserId:alex.userId,cellRevision,configuration:{enabled:true,instructions:'wrong target',revision:3,writable:true,applies:'live'},audit:{requestId:crypto.randomUUID(),reason:input.reason}})
    const view=render(<MemberInstructionSettings api={f.api}/>);await choose();read();await screen.findByRole('alert');expect(screen.queryByDisplayValue('wrong target')).toBeNull();view.unmount()
    const empty=fixture();empty.state.members=[];const e=render(<MemberInstructionSettings api={empty.api}/>);await screen.findByText('暂无已启用的使用人员。');e.unmount()
    const readonly=fixture();readonly.state.writable=false;render(<MemberInstructionSettings api={readonly.api}/>);await choose();read()
    await screen.findByText('当前原生配置只读，不能保存。');expect(screen.getByRole('textbox',{name:'企业指令正文'})).toBeDisabled();expect(readonly.commands).not.toHaveBeenCalled()
  })
  it('blocks route aliases and unsupported methods before transport',async()=>{
    const f=fixture()
    for(const path of ['/admin/instruction-configuration?target=other','/admin/instruction-commands/../members','/admin/instruction-command-state/']){
      await expect(f.api.request(path,'POST',{},crypto.randomUUID())).rejects.toThrow('Unsupported enterprise plugin route')
    }
    await expect(f.api.request('/admin/instruction-configuration','GET')).rejects.toThrow('Unsupported enterprise plugin route')
    expect(f.transport).not.toHaveBeenCalled()
  })
})
