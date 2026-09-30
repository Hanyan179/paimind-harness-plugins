// @vitest-environment node
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtemp, realpath, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, symbols } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { TOOL_RUNTIME_SCHEDULER, ToolRuntime, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { createNativeConnectorConfiguration } from '../src/connector-configuration.js'
import { createManagedConnectorAuthority } from '../src/connector-authority.js'
import { createManagedHarnessConnectorProvider } from '../src/managed-connector.js'
import { installManagedHarnessToolGuard, installManagedHarnessOriginGuard } from '../src/managed-runtime.js'
import { createManagedToolGuard, MEMBER_TOOL_POLICY } from '../../../deploy/enterprise/worker/runtime/member-tool-policy.mjs'

const native = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
const mcp = native('@deepseek-ai/dsh-mcp-client'), anchor = native.resolve('@deepseek-ai/dsh-mcp-client/package.json')
const roots: Context[] = []
afterEach(async () => { for (const root of roots.splice(0).reverse()) await root.fiber.dispose() })
const signal = () => AbortSignal.timeout(10_000)
const source = 'paimind-origin-v1.e30.'+'h'.repeat(43)
const message = {source:{kind:'user',rpcId:source}}
async function fixture() {
  const home=await realpath(await mkdtemp(join(tmpdir(),'paimind-connector-authority-'))),file=join(home,'root.json'),directory=join(home,'.enterprise-connectors')
  await writeFile(file,'[]',{mode:0o600})
  const approvals=new Map<string,{reference:any;revision:number}>(),lifetime=new AbortController()
  const read=vi.fn(async(reference:any,expected:number|null,_signal:AbortSignal)=>{
    const row=approvals.get(reference.entryId)
    if(!row||JSON.stringify(row.reference)!==JSON.stringify(reference)||expected!==null&&row.revision!==expected)throw Error('Explicit current authority denied')
    return row.revision
  })
  const authorize=vi.fn(async(_origins:any,reference:any,revision:number,cancellation:AbortSignal)=>{await read(reference,revision,cancellation)})
  const start=async()=>{
    const root=await boot('connector-authority',file,[],undefined,pathToFileURL(native.resolve('@deepseek-ai/dsh/package.json')).href);roots.push(root)
    const selected=createManagedHarnessConnectorProvider(root,mcp,{nodeExecutable:process.execPath,moduleAnchor:anchor,lookupCwd:home,
      prepare:r=>({argv:r.argv,cwd:r.cwd,env:{...r.env}})},ToolRuntime)
    let controller:ReturnType<typeof createManagedConnectorAuthority>|undefined
    const guard=installManagedHarnessToolGuard(root,createManagedToolGuard({role:'member',policy:MEMBER_TOOL_POLICY},(ref:any)=>controller?.admits(ref)===true))
    // Explicit active-native-hook fixture, not a real model/browser history.
    installManagedHarnessOriginGuard(root,async()=>{})
    await root.plugin(SystemPrompt,{});await root.plugin(selected.select(ToolRuntime) as typeof ToolRuntime,{})
    await vi.waitFor(()=>guard.assertReady())
    const starts:string[]=[],loader=Reflect.get(root.loader,symbols.original),unwrap=loader.unwrapExports
    loader.unwrapExports=function(value:unknown){const original=unwrap.call(this,value),managed=selected.select(original) as typeof mcp
      if(original?.apply!==mcp.apply)return managed
      return {...managed,apply:async(ctx:Context,config:Record<string,unknown>)=>{starts.push(String(config.serverName));await managed.apply(ctx,config)}}}
    root.effect(()=>()=>{loader.unwrapExports=unwrap})
    const owner=await createNativeConnectorConfiguration(root,directory)
    controller=createManagedConnectorAuthority(root,owner,{signal:lifetime.signal,readApproval:read,authorizeUse:authorize})
    const input=(entryId='sales',enabled=true)=>{const view=owner.activationState(signal()),row=view.entries.find(row=>row.entryId===entryId)!
      return {entryId,enabled,configurationVersion:row.configurationVersion!,expectedRevision:view.revision}}
    const put=async(id='sales')=>{
      await owner.configure({kind:'upsert',entryId:id,expectedRevision:owner.read(signal()).revision,configuration:{transport:'stdio',serverName:id,
        command:process.execPath,args:[fileURLToPath(new URL('./connector-native-server.mjs',import.meta.url)),anchor,id],cwd:home,env:{},toolCallTimeoutMs:1000,
        failOnStartupError:true,reconnect:{enabled:false,initialDelayMs:100,maxDelayMs:1000,maxAttempts:1}}},signal())
      const reference=owner.release({entryId:id,expectedRevision:owner.read(signal()).revision},signal()).reference!
      approvals.set(id,{reference,revision:1})
    }
    const events:any[]=[{type:'turn/start',data:{turn:1}}],abort=new AbortController()
    const agent={id:'hansen-native-agent',cancel:()=>abort.abort(),session:{id:'hansen-native-session',header:{agentPreset:'standard'},events,surface:{nodes:[]}}} as unknown as NonNullable<ToolExecutionInput['agent']>
    const begin=async()=>{await root.waterfall('agent/pre-step',{agent,turn:1,step:1,messages:[message],signal:abort.signal} as never,()=>Promise.resolve({kind:'enter',messages:[message]} as never))
      events.push({type:'step/start',data:{turn:1,step:1}},{type:'user/message',data:message})}
    const request=(id='sales'):ToolExecutionInput=>({name:`mcp__${id}__echo`,agent,callId:'authority-native-call' as ToolExecutionInput['callId'],arguments:{message:'proof'},signal:signal()})
    return {root,owner,controller,put,input,begin,request,starts,entry:(id='sales')=>root.loader.resolve('paimind-managed-connectors:'+id)}
  }
  return {home,directory,persisted:join(directory,'cordis.json'),approvals,lifetime,read,authorize,start,...await start()}
}

describe('real original connector lifecycle/current-use composition with explicit authority and active-hook fixtures',()=>{
  it('pins administrator activation to its exact approval revision rather than silently adopting a newer approval',async()=>{
    const f=await fixture();await f.put();const bytes=await readFile(f.persisted,'utf8'),row=f.approvals.get('sales')!;row.revision=3
    await expect(f.controller.activate(f.input(),signal(),1)).rejects.toThrow()
    expect(await readFile(f.persisted,'utf8')).toBe(bytes);expect(f.starts).toEqual([])
    expect((await f.controller.activate(f.input(),signal(),3)).outcome).toBe('activated')
    expect(f.read).toHaveBeenLastCalledWith(row.reference,3,expect.any(AbortSignal))
    f.approvals.delete('sales')
    expect((await f.controller.activate(f.input('sales',false),signal(),null)).outcome).toBe('disabled')
    expect(f.root.tools.get(f.request().name)).toBeUndefined()
  })
  it('uses exact current approval at activation and actual native dispatch, without allowing a copied or same-prefix tool',async()=>{
    const f=await fixture();await f.put();await f.controller.activate(f.input(),signal());await f.begin()
    expect(f.starts).toEqual(['sales']);expect(f.read).toHaveBeenCalledTimes(2)
    const result=await f.root.tools.execute(f.request());expect(result.isError,JSON.stringify(result)).toBe(false)
    expect(f.authorize).toHaveBeenCalledTimes(2)
    expect(f.authorize).toHaveBeenNthCalledWith(1,expect.objectContaining({nativeSessionId:'hansen-native-session',sources:[source]}),f.approvals.get('sales')!.reference,1,expect.any(AbortSignal))
    const definition=f.root.tools.get(f.request().name)!,foreign=vi.fn(async()=>({foreign:true}))
    f.root.tools.register({...definition,name:'mcp__copy__echo',execute:foreign})
    expect((await f.root.tools.execute({...f.request(),name:'mcp__copy__echo'})).isError).toBe(true);expect(foreign).not.toHaveBeenCalled()
  })
  it('withdraws a revoked native connection while retaining enabled intent and another authorized connector',async()=>{
    const f=await fixture();await f.put();await f.put('support')
    await f.controller.activate(f.input(),signal());await f.controller.activate(f.input('support'),signal());await f.begin()
    const bytes=await readFile(f.persisted,'utf8');f.approvals.delete('sales')
    await vi.waitFor(()=>expect(f.root.tools.get(f.request().name)).toBeUndefined(),{timeout:5000})
    expect(f.entry().fiber?.state).toBe(0);expect(await readFile(f.persisted,'utf8')).toBe(bytes)
    expect((await f.root.tools.execute(f.request('support'))).isError).toBe(false)
    expect(f.starts).toEqual(['sales','support'])
  })
  it('checks actual dispatch after native preparation, never reusing an earlier allowance after revocation',async()=>{
    const f=await fixture();await f.put();await f.controller.activate(f.input(),signal());await f.begin()
    const scheduler=f.root.tools[TOOL_RUNTIME_SCHEDULER],prepared=await scheduler.prepare(f.request())
    expect(prepared.kind).toBe('dispatch');if(prepared.kind!=='dispatch')throw Error('Expected original prepared call')
    f.authorize.mockRejectedValueOnce(Error('Current login revoked'))
    const dispatched=await scheduler.dispatch(prepared.exec)
    const result=dispatched.kind==='post-result'?await scheduler.finalize(prepared.exec,dispatched.result):scheduler.finish(prepared.exec,dispatched.result)
    expect(result.isError).toBe(true)
    expect(f.authorize).toHaveBeenCalledOnce()
    expect((await f.root.tools.execute(f.request())).isError).toBe(false)
  })
  it('does not accept a pending authority request as renewal, and ignores its eventual late success',async()=>{
    const f=await fixture();await f.put();await f.controller.activate(f.input(),signal())
    const stalled=Promise.withResolvers<number>(),entered=Promise.withResolvers<void>()
    f.read.mockImplementationOnce(async()=>{entered.resolve();return stalled.promise})
    await entered.promise
    await vi.waitFor(()=>expect(f.root.tools.get(f.request().name)).toBeUndefined(),{timeout:5000})
    stalled.resolve(1);await Promise.resolve()
    expect(f.owner.activationState(signal()).entries[0]?.authority).toBe('absent');expect(f.starts).toEqual(['sales'])
  })
  it('fails a pending execution on explicit withdrawal even when a late authority callback says yes',async()=>{
    const f=await fixture();await f.put();await f.controller.activate(f.input(),signal());await f.begin()
    const entered=Promise.withResolvers<void>(),finish=Promise.withResolvers<void>()
    f.authorize.mockImplementationOnce(async()=>{entered.resolve();await finish.promise})
    const pending=f.root.tools.execute(f.request());await entered.promise;await f.controller.withdraw('sales')
    expect((await pending).isError).toBe(true);finish.resolve()
    expect(f.root.tools.get(f.request().name)).toBeUndefined()
  })
  it('cold-restores only persisted enabled entries with fresh authority, not disabled intent or a cached prior grant',async()=>{
    const f=await fixture();await f.put();await f.put('support');await f.controller.activate(f.input(),signal())
    const bytes=await readFile(f.persisted,'utf8');await f.root.fiber.dispose();const next=await f.start()
    expect(next.starts).toEqual([]);expect(next.entry().fiber?.state).toBe(0)
    f.approvals.delete('sales');expect(await next.controller.restore(signal())).toEqual({restored:[],pending:['sales']})
    const reference=next.owner.release({entryId:'sales',expectedRevision:next.owner.activationState(signal()).revision},signal()).reference!
    f.approvals.set('sales',{reference,revision:3})
    expect(await next.controller.restore(signal())).toEqual({restored:['sales'],pending:[]});await next.begin()
    expect((await next.root.tools.execute(next.request())).isError).toBe(false);expect(next.starts).toEqual(['sales'])
    expect(await next.controller.restore(signal())).toEqual({restored:['sales'],pending:[]});expect(next.starts).toEqual(['sales'])
    expect(await readFile(f.persisted,'utf8')).toBe(bytes)
  })
  it('aborts every connection on control lifetime closure and cannot revive it with saved enabled intent',async()=>{
    const f=await fixture();await f.put();await f.controller.activate(f.input(),signal())
    f.lifetime.abort();await vi.waitFor(()=>expect(f.root.tools.get(f.request().name)).toBeUndefined())
    await expect(f.controller.restore(signal())).rejects.toThrow();expect(f.entry().fiber?.state).toBe(0)
  })
  it('does not persist a fresh enable or start a provider without current exact approval',async()=>{
    const f=await fixture();await f.put();const bytes=await readFile(f.persisted,'utf8');f.approvals.delete('sales')
    await expect(f.controller.activate(f.input(),signal())).rejects.toThrow()
    expect(await readFile(f.persisted,'utf8')).toBe(bytes);expect(f.starts).toEqual([])
  })
  it('does not keep an old approval revision alive after replacement or auto-retry activation',async()=>{
    const f=await fixture();await f.put();await f.controller.activate(f.input(),signal())
    f.approvals.get('sales')!.revision=3
    await vi.waitFor(()=>expect(f.root.tools.get(f.request().name)).toBeUndefined(),{timeout:5000})
    expect(f.starts).toEqual(['sales']);expect(await f.controller.restore(signal())).toEqual({restored:['sales'],pending:[]})
    expect(f.starts).toEqual(['sales','sales'])
  })
  it('revalidates an already-live restoration instead of reporting a previous allowance as current',async()=>{
    const f=await fixture();await f.put();await f.controller.activate(f.input(),signal());f.approvals.delete('sales')
    expect(await f.controller.restore(signal())).toEqual({restored:[],pending:['sales']})
    expect(f.root.tools.get(f.request().name)).toBeUndefined()
  })
  it('withholds a completed native result when the current authority denies the post-call check',async()=>{
    const f=await fixture();await f.put();await f.controller.activate(f.input(),signal());await f.begin()
    f.authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('Revoked while tool executed'))
    expect((await f.root.tools.execute(f.request())).isError).toBe(true);expect(f.authorize).toHaveBeenCalledTimes(2)
  })
})
