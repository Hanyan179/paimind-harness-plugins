import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAIMIND_FEATURE_PACKS } from '@paimind/extension-center/feature-packs'
import { FEATURE_CATALOG_DIGEST, featureChangePlan } from '@paimind/extension-center/governance'
import { FeatureManagementPanel } from '../src/client/feature-management.js'
import { EnterpriseApi, EnterpriseSession } from '../src/client/api.js'
const admin = {userId:'a0000000-0000-4000-8000-000000000001',tenantId:'component',username:'morgan',displayName:'Morgan',role:'admin',status:'active'}
const hansen = {...admin,userId:'b0000000-0000-4000-8000-000000000002',username:'hansen',displayName:'Hansen',role:'member'}
const alex = {...hansen,userId:'c0000000-0000-4000-8000-000000000003',username:'alex',displayName:'Alex'}
const imageId = 'sha256:'+'d'.repeat(64), ids = PAIMIND_FEATURE_PACKS.map(pack=>pack.id).sort(), sessions: EnterpriseSession[]=[]
const originalPinDigest = 'sha256:'+'a'.repeat(64), currentPinDigest = 'sha256:'+'b'.repeat(64)
afterEach(()=>{cleanup();for(const session of sessions.splice(0))session.dispose();vi.restoreAllMocks()})
function fixture() {
  const wire = (data:unknown,status=200)=>new Response(JSON.stringify({data}),{status})
  const state: {account:typeof admin; approved:boolean; command:any; override?: (path:string,input:any,options:RequestInit)=>Promise<Response>} = {account:admin,approved:true,command:null}
  const response = (target:string)=>({targetUserId:target,targetName:target===hansen.userId?'Hansen':'Alex',imageId,catalogDigest:FEATURE_CATALOG_DIGEST,
    allowedPackIds:ids,approval:state.approved?{imageId,catalogDigest:FEATURE_CATALOG_DIGEST,packIds:ids,revision:1,reason:'已审阅管理范围'}:null,
    view:{status:'ready',revision:2,writable:true,packs:PAIMIND_FEATURE_PACKS.map(pack=>({...pack,installed:true,enabled:true,desiredEnabled:true,
      capabilities:pack.capabilities.map(cap=>({...cap,installed:true,enabled:true,desiredEnabled:true}))}))},
    command:state.command,recovery:state.command?.outcome==='unconfirmed'?{kind:'same-runtime',originalPinDigest,currentPinDigest:originalPinDigest}:null,
    nativeCommand:null,observedAt:'2026-09-09T00:00:00Z'})
  const transport = vi.fn(async (url:string|URL|Request,options:RequestInit={})=>{
    const path=String(url),input=options.body?JSON.parse(String(options.body)):undefined
    if(path==='/haas/v1/auth/me')return wire(state.account)
    if(path==='/haas/v1/admin/members')return wire([admin,hansen,alex])
    if(state.override)return state.override(path,input,options)
    if(path.endsWith('/feature-packs/state'))return wire(response(input.targetUserId))
    if(path.endsWith('/feature-packs/preview'))return wire({targetUserId:input.targetUserId,imageId,
      plan:featureChangePlan(input.selection,'{}',JSON.stringify({[input.selection.id]:input.selection.enabled}))})
    if(path.endsWith('/feature-packs/approvals'))return wire({targetUserId:input.targetUserId,imageId,catalogDigest:FEATURE_CATALOG_DIGEST,packIds:input.packIds,revision:input.expectedRevision+1})
    if(path.endsWith('/feature-packs/commands')) {
      state.command={commandId:crypto.randomUUID(),targetUserId:input.targetUserId,imageId,planDigest:input.planDigest,selection:input.selection,
        reason:input.reason,outcome:'unconfirmed',historicalReceipt:true,runtimeGrant:false}
      return wire(state.command,202)
    }
    if(path.endsWith('/resume'))return wire({...state.command,outcome:'applied'})
    throw Error('Unexpected component route '+path)
  })
  const api=new EnterpriseApi(transport as typeof fetch),session=new EnterpriseSession(api);sessions.push(session)
  return {api,session,transport,state,response,wire}
}
async function mount(f:ReturnType<typeof fixture>) {await f.session.refresh();return render(<FeatureManagementPanel session={f.session}/>)}
async function choose(target=hansen.userId) {
  fireEvent.change(await screen.findByRole('combobox',{name:'管理对象'}),{target:{value:target}})
  fireEvent.click(screen.getByRole('button',{name:'重新读取状态／找回原命令'}))
  await screen.findByRole('heading',{name:target===hansen.userId?'Hansen 的功能包':'Alex 的功能包'})
}
async function draft() {fireEvent.click(screen.getByRole('switch',{name:'工作运营'}));await screen.findByRole('form',{name:'确认成员功能包操作'})}
function confirm() {fireEvent.change(screen.getByRole('textbox',{name:'操作原因'}),{target:{value:'按成员工作需要调整'}});fireEvent.click(screen.getByRole('checkbox'))}
const mutations=(f:ReturnType<typeof fixture>)=>f.transport.mock.calls.filter(([url])=>String(url).endsWith('/commands')||String(url).endsWith('/approvals')||String(url).endsWith('/resume'))
describe('original Extension Center governance component with explicit HTTP fixtures, not Browser E2E',()=>{
  it('requires an explicit member read and full plan confirmation before any mutation, including duplicate submit',async()=>{
    const f=fixture();await mount(f)
    await screen.findByRole('combobox',{name:'管理对象'});expect(f.transport.mock.calls).toHaveLength(2)
    await choose();await draft();expect(mutations(f)).toHaveLength(0)
    expect(screen.getByText('工作运营：启用 → 关闭')).toBeInTheDocument()
    expect(screen.getByRole('textbox',{name:'操作原因'})).toHaveFocus()
    expect(screen.getByRole('button',{name:'确认提交'})).toBeDisabled();confirm()
    const submit=screen.getByRole('button',{name:'确认提交'});fireEvent.click(submit);fireEvent.submit(submit.closest('form')!)
    await screen.findByText(/结果仍待确认/);expect(mutations(f)).toHaveLength(1)
    const input=JSON.parse(String(mutations(f)[0]![1]!.body));expect(input).toMatchObject({targetUserId:hansen.userId,approvalRevision:1,selection:{id:'paimind:pack:operations',enabled:false,expectedRevision:2},confirmed:true})
    expect(input).not.toHaveProperty('approvedPackIds');expect(input).not.toHaveProperty('origin')
    expect(screen.getByRole('switch',{name:'工作运营'})).toBeDisabled()
  })
  it('clears prior member data and confirmation on target switch without making a request for the new target',async()=>{
    const f=fixture();await mount(f);await choose();await draft();confirm()
    const count=f.transport.mock.calls.length
    fireEvent.change(screen.getByRole('combobox',{name:'管理对象'}),{target:{value:alex.userId}})
    expect(screen.queryByText('Hansen 的功能包')).toBeNull();expect(screen.queryByRole('form')).toBeNull()
    expect(f.transport).toHaveBeenCalledTimes(count);expect(mutations(f)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button',{name:'重新读取状态／找回原命令'}));await screen.findByText('Alex 的功能包')
    await draft();expect(screen.getByRole('checkbox')).not.toBeChecked();expect(screen.getByRole('textbox',{name:'操作原因'})).toHaveValue('')
  })
  it('finds a pending command after a fresh component mount and resumes that exact ID rather than creating a new command',async()=>{
    const f=fixture(),view=await mount(f);await choose();await draft();confirm();fireEvent.click(screen.getByRole('button',{name:'确认提交'}));await screen.findByText(/结果仍待确认/)
    const original=f.state.command.commandId;view.unmount();render(<FeatureManagementPanel session={f.session}/>);await choose()
    fireEvent.click(screen.getByRole('button',{name:'恢复并确认原命令'}));confirm();fireEvent.click(screen.getByRole('button',{name:'确认提交'}))
    await screen.findByText(/原命令已确认应用/)
    expect(mutations(f)).toHaveLength(2);expect(String(mutations(f)[1]![0])).toBe('/haas/v1/admin/feature-commands/'+original+'/resume')
    expect(JSON.parse(String(mutations(f)[1]![1]!.body))).toMatchObject({expectedRuntimeDigest:originalPinDigest})
    expect(JSON.parse(String(mutations(f)[1]![1]!.body))).not.toHaveProperty('allowReplacement')
    expect(screen.getByRole('switch',{name:'工作运营'})).toBeDisabled()
  })
  it('requires explicit replacement confirmation and freezes the reviewed runtime digest on retry',async()=>{
    const f=fixture();await mount(f);await choose();await draft();confirm();fireEvent.click(screen.getByRole('button',{name:'确认提交'}));await screen.findByText(/结果仍待确认/)
    f.state.override=async path=>{
      if(path.endsWith('/state'))return f.wire({...f.response(hansen.userId),recovery:{kind:'replacement-runtime',originalPinDigest,currentPinDigest}})
      throw Error('明确的恢复响应丢失')
    }
    fireEvent.click(screen.getByRole('button',{name:'重新读取状态／找回原命令'}));await screen.findByText(/该成员的运行环境已替换/)
    expect(mutations(f)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button',{name:'恢复并确认原命令'}))
    expect(screen.getByRole('checkbox',{name:/替代运行环境/})).not.toBeChecked();expect(screen.getByRole('button',{name:'确认提交'})).toBeDisabled()
    confirm();fireEvent.click(screen.getByRole('button',{name:'确认提交'}));await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button',{name:'重试原请求'}));await waitFor(()=>expect(mutations(f)).toHaveLength(3))
    const first=mutations(f)[1]![1]!,second=mutations(f)[2]![1]!
    expect(JSON.parse(String(first.body))).toMatchObject({allowReplacement:true,expectedRuntimeDigest:currentPinDigest,confirmed:true})
    expect(first.body).toBe(second.body);expect(first.headers).toEqual(second.headers)
  })
  it.each(['blocked','missing','malformed'] as const)('does not enable recovery from %s runtime evidence',async kind=>{
    const f=fixture();await mount(f);await choose();await draft();confirm();fireEvent.click(screen.getByRole('button',{name:'确认提交'}));await screen.findByText(/结果仍待确认/)
    f.state.override=async()=>f.wire({...f.response(hansen.userId),recovery:kind==='blocked'
      ?{kind,originalPinDigest,currentPinDigest,reason:'原数据或原生回执不匹配，请由部署人员检查。'}
      :kind==='missing'?null:{kind:'replacement-runtime',originalPinDigest,currentPinDigest:originalPinDigest}})
    fireEvent.click(screen.getByRole('button',{name:'重新读取状态／找回原命令'}));await screen.findByRole('alert')
    if(kind==='blocked')expect(screen.getByRole('button',{name:'恢复并确认原命令'})).toBeDisabled()
    else expect(screen.queryByRole('button',{name:'恢复并确认原命令'})).toBeNull()
    expect(mutations(f)).toHaveLength(1)
  })
  it('approves an exact image and complete scope only after confirmation, without automatic toggles',async()=>{
    const f=fixture();f.state.approved=false;await mount(f);await choose()
    expect(screen.getByRole('switch',{name:'工作运营'})).toBeDisabled()
    fireEvent.click(screen.getByRole('button',{name:'批准完整管理范围'}));confirm();fireEvent.click(screen.getByRole('button',{name:'确认提交'}))
    await screen.findByText(/没有启用或关闭任何功能/);expect(mutations(f)).toHaveLength(1)
    expect(JSON.parse(String(mutations(f)[0]![1]!.body))).toMatchObject({targetUserId:hansen.userId,imageId,catalogDigest:FEATURE_CATALOG_DIGEST,packIds:ids,expectedRevision:0})
    expect(screen.queryByRole('switch')).toBeNull()
  })
  it('retains the original key and immutable body on unknown-result retry',async()=>{
    const f=fixture();await mount(f);await choose();await draft();confirm()
    f.state.override=async()=>{throw Error('明确的网络响应丢失')}
    fireEvent.click(screen.getByRole('button',{name:'确认提交'}));await screen.findByRole('alert')
    expect(screen.getByRole('textbox',{name:'操作原因'})).toBeDisabled()
    fireEvent.click(screen.getByRole('button',{name:'重试原请求'}));await waitFor(()=>expect(mutations(f)).toHaveLength(2))
    expect(mutations(f)[0]![1]!.body).toBe(mutations(f)[1]![1]!.body)
    expect(mutations(f)[0]![1]!.headers).toEqual(mutations(f)[1]![1]!.headers)
  })
  it('stops waiting without claiming cancellation and ignores an uncooperative late reply',async()=>{
    const f=fixture();await mount(f);await choose();await draft();confirm();let complete!:(value:Response)=>void
    f.state.override=()=>new Promise(resolve=>{complete=resolve})
    fireEvent.click(screen.getByRole('button',{name:'确认提交'}));await waitFor(()=>expect(mutations(f)).toHaveLength(1))
    fireEvent.click(screen.getByRole('button',{name:'停止等待'}));await act(async()=>complete(f.wire({outcome:'applied'})))
    expect(screen.getByText(/未取消可能已接受的操作/)).toBeInTheDocument();expect(screen.queryByText(/原命令已确认应用/)).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })
  it('uses Escape to dismiss an unsubmitted review and restore the original control focus',async()=>{
    const f=fixture();await mount(f);await choose();await draft()
    fireEvent.keyDown(screen.getByRole('textbox',{name:'操作原因'}),{key:'Escape'})
    await waitFor(()=>expect(screen.getByRole('switch',{name:'工作运营'})).toHaveFocus())
    expect(screen.queryByRole('form')).toBeNull();expect(mutations(f)).toHaveLength(0)
  })
  it.each(['member','replacement','unavailable'] as const)('discards pending UI and never shows late data after %s authority transition',async change=>{
    const f=fixture();await mount(f);await choose();await draft();confirm();let complete!:(value:Response)=>void
    f.state.override=()=>new Promise(resolve=>{complete=resolve})
    fireEvent.click(screen.getByRole('button',{name:'确认提交'}));await waitFor(()=>expect(mutations(f)).toHaveLength(1))
    if(change==='member')f.state.account={...hansen}
    else if(change==='replacement')f.state.account={...admin,userId:'d0000000-0000-4000-8000-000000000004'}
    else f.session.invalidate()
    if(change!=='unavailable')await act(async()=>f.session.refresh())
    await act(async()=>complete(f.wire({outcome:'applied'})))
    expect(screen.queryByText('Hansen 的功能包')).toBeNull();expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByText(/原命令已确认应用/)).toBeNull()
  })
  it('rejects wrong-member state and malformed native catalogs before enabling controls',async()=>{
    const f=fixture();await mount(f)
    f.state.override=async()=>f.wire(f.response(alex.userId))
    fireEvent.change(await screen.findByRole('combobox',{name:'管理对象'}),{target:{value:hansen.userId}})
    fireEvent.click(screen.getByRole('button',{name:'重新读取状态／找回原命令'}));await screen.findByRole('alert');expect(screen.queryByRole('switch')).toBeNull()
    f.state.override=async()=>f.wire({...f.response(hansen.userId),view:{status:'ready',revision:2,writable:true,packs:[]}})
    fireEvent.click(screen.getByRole('button',{name:'重新读取状态／找回原命令'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('目录不完整'))
    expect(mutations(f)).toHaveLength(0)
  })
  it('locks a member and an unverified session before any management read',async()=>{
    const f=fixture();render(<FeatureManagementPanel session={f.session}/>);expect(f.transport).not.toHaveBeenCalled()
    f.state.account={...hansen};await act(async()=>f.session.refresh())
    expect(screen.getByRole('alert')).toHaveTextContent('由管理员管理');expect(f.transport).toHaveBeenCalledTimes(1)
  })
})
