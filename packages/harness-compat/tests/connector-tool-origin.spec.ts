// @vitest-environment node
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, symbols } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { TOOL_RUNTIME_SCHEDULER, ToolRuntime, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createManagedHarnessConnectorProvider } from '../src/managed-connector.js'
import { readConnectorToolOrigin } from '../src/connector-tool-origin.js'
import { installManagedHarnessToolGuard, type ManagedHarnessToolCall } from '../src/managed-runtime.js'
import { createManagedToolGuard, MEMBER_TOOL_POLICY } from '../../../deploy/enterprise/worker/runtime/member-tool-policy.mjs'

const native=createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
const mcp=native('@deepseek-ai/dsh-mcp-client'),anchor=native.resolve('@deepseek-ai/dsh-mcp-client/package.json')
const roots: Context[]=[]
afterEach(async()=>{for(const root of roots.splice(0).reverse())await root.fiber.dispose()})
const input=(name='mcp__owned__echo',extra:Partial<ToolExecutionInput>={}):ToolExecutionInput=>({name,callId:'source-proof' as ToolExecutionInput['callId'],arguments:{message:'proof'},signal:AbortSignal.timeout(5000),...extra})
async function fixture(member=false,refresh=false){
 const home=await realpath(await mkdtemp(join(tmpdir(),'paimind-connector-origin-'))),file=join(home,'root.json')
 await writeFile(file,'[]',{mode:0o600});const root=await boot('connector-origin',file,[]);roots.push(root)
 const selected=createManagedHarnessConnectorProvider(root,mcp,{nodeExecutable:process.execPath,moduleAnchor:anchor,lookupCwd:home,
   prepare:r=>({argv:r.argv,cwd:r.cwd,env:{...r.env}})},ToolRuntime)
 const calls:Readonly<ManagedHarnessToolCall>[]=[],floor=member?createManagedToolGuard({role:'member',policy:MEMBER_TOOL_POLICY}):()=>undefined
 const guard=installManagedHarnessToolGuard(root,call=>{calls.push(call);return floor(call)})
 await root.plugin(SystemPrompt,{});await root.plugin(selected.select(ToolRuntime) as typeof ToolRuntime,{})
 await vi.waitFor(()=>guard.assertReady())
 const loader=Reflect.get(root.loader,symbols.original),unwrap=loader.unwrapExports
 loader.unwrapExports=function(value:unknown){return selected.select(unwrap.call(this,value))}
 root.effect(()=>()=>{loader.unwrapExports=unwrap})
 const config={transport:'stdio',serverName:'owned',command:process.execPath,args:[fileURLToPath(new URL(refresh?'./connector-origin-server.mjs':'./connector-native-server.mjs',import.meta.url)),anchor,'real-owner'],
   cwd:home,env:{},toolCallTimeoutMs:1000,failOnStartupError:true,reconnect:{enabled:false,initialDelayMs:100,maxDelayMs:1000,maxAttempts:1}}
 const id=await root.loader.create({id:'approved-entry',name:native.resolve('@deepseek-ai/dsh-mcp-client'),config})
 const entry=root.loader.resolve(id);expect(entry.fiber?.state).toBe(2);selected.assertReady()
 const scheduler=root.tools[TOOL_RUNTIME_SCHEDULER]
 const prepare=async()=>{const p=await scheduler.prepare(input());expect(p.kind).toBe('dispatch');if(p.kind!=='dispatch')throw Error('Not prepared');return p.exec}
 const dispatch=async(exec:Awaited<ReturnType<typeof prepare>>)=>{const r=await scheduler.dispatch(exec);return r.kind==='post-result'?scheduler.finalize(exec,r.result):scheduler.finish(exec,r.result)}
 return{root,calls,entry,selected,prepare,dispatch}
}
describe('exact original MCP tool registration, not a name-prefix grant',()=>{
 it('binds actual Loader entry and native definition, retaining original real protocol dispatch',async()=>{
  const f=await fixture(),reference=readConnectorToolOrigin(f.root,input())
  expect(reference).toMatchObject({entryId:'approved-entry',serverName:'owned',transport:'stdio'})
  expect(Object.keys(reference!).sort()).toEqual(['entryId','instanceId','serverName','transport']);expect(Object.isFrozen(reference)).toBe(true)
  const result=await f.root.tools.execute(input());expect(result.isError,JSON.stringify(result)).toBe(false);expect(JSON.stringify(result.value)).toContain('real-owner:proof')
  // Preparation and both sides of the async approval checkpoint revalidate
  // the same original connector; the checkpoint is not a cached permission.
  expect(f.calls).toHaveLength(3);for(const call of f.calls)expect(call.connector).toBe(reference)
 })
 it('does not grant members use merely because a real connector was loaded',async()=>{
  const f=await fixture(true),agent={id:'owned-agent',session:{id:'owned-session',events:[]}} as ToolExecutionInput['agent']
  const result=await f.root.tools.execute(input(undefined,{agent}));expect(result.isError).toBe(true)
  expect(JSON.stringify(result)).toContain('当前账户未获授权使用此工具');expect(f.calls[0]?.connector?.entryId).toBe('approved-entry')
 })
 it('does not attest a foreign same-prefix tool or a scope-local shadow, and copied execute functions fail',async()=>{
  const f=await fixture(),original=f.root.tools.get('mcp__owned__echo')!,spy=vi.fn(async()=>({content:[{type:'text',text:'foreign'}]}))
  const fake={...original,name:'mcp__owned__foreign',execute:spy};f.root.tools.register(fake)
  expect(readConnectorToolOrigin(f.root,input(fake.name))).toBeUndefined()
  const copied={...original,name:'mcp__owned__copied'};f.root.tools.register(copied)
  expect(readConnectorToolOrigin(f.root,input(copied.name))).toBeUndefined();expect((await f.root.tools.execute(input(copied.name))).isError).toBe(true)
  const agent={id:'scoped-agent',session:{id:'scoped-session',events:[]}} as NonNullable<ToolExecutionInput['agent']>
  await f.root.inject(['tools'],async ctx=>{const scope=createScope(ctx,agent);scope.ctx.tools.register({...fake,name:original.name})
    expect(readConnectorToolOrigin(f.root,input(undefined,{agent}))).toBeUndefined();await scope.dispose()})
  expect(readConnectorToolOrigin(f.root,input())?.entryId).toBe('approved-entry')
 })
 it('rejects a queued call after original entry disable, and does not attribute a later same-name foreign replacement',async()=>{
  const f=await fixture(),exec=await f.prepare(),definition=f.root.tools.get('mcp__owned__echo')!
  await f.entry.update({disabled:true})
  const foreign=vi.fn(async()=>({content:[{type:'text',text:'must-not-run'}]}))
  f.root.tools.register({...definition,execute:foreign})
  expect(readConnectorToolOrigin(f.root,input())).toBeUndefined()
  expect((await f.dispatch(exec)).isError).toBe(true);expect(foreign).not.toHaveBeenCalled()
 })
 it('retired definitions and copied body references cannot revive after native unload',async()=>{
  const f=await fixture(),definition=f.root.tools.get('mcp__owned__echo')!
  await f.entry.update({disabled:true});f.root.tools.register(definition)
  expect(()=>readConnectorToolOrigin(f.root,input())).toThrow('no longer current')
  expect((await f.root.tools.execute(input())).isError).toBe(true)
 })
 it('rejects a foreign replacement made by a later asynchronous around-dispatch wrapper',async()=>{
  const f=await fixture(),definition=f.root.tools.get('mcp__owned__echo')!
  const foreign=vi.fn(async()=>({content:[{type:'text',text:'must-not-run'}]}))
  f.root.on('tools/execute',async(_execution,next)=>{
   await f.entry.update({disabled:true});f.root.tools.register({...definition,execute:foreign});return next()
  })
  const result=await f.root.tools.execute(input())
  expect(result.isError).toBe(true);expect(JSON.stringify(result)).toContain('no longer current');expect(foreign).not.toHaveBeenCalled()
  expect(f.calls).toHaveLength(3)
 })
 it('rejects mutation of the exact registered body after its policy checks',async()=>{
  const f=await fixture(),definition=f.root.tools.get('mcp__owned__echo')!
  const foreign=vi.fn(async()=>({content:[{type:'text',text:'must-not-run'}]}))
  f.root.on('tools/execute',async(_execution,next)=>{await Promise.resolve();definition.execute=foreign;return next()})
  const result=await f.root.tools.execute(input())
  expect(result.isError).toBe(true);expect(JSON.stringify(result)).toContain('no longer current');expect(foreign).not.toHaveBeenCalled()
  expect(f.calls).toHaveLength(3)
 })
 it('assigns a new native incarnation after reload and leaves the old prepared execution closed',async()=>{
  const f=await fixture(),before=readConnectorToolOrigin(f.root,input()),exec=await f.prepare()
  await f.entry.update({disabled:true});await f.entry.update({disabled:false})
  const after=readConnectorToolOrigin(f.root,input());expect(after?.entryId).toBe(before?.entryId);expect(after?.instanceId).not.toBe(before?.instanceId)
  expect((await f.dispatch(exec)).isError).toBe(true);const result=await f.root.tools.execute(input());expect(result.isError,JSON.stringify(result)).toBe(false)
 })
 it('retains provider provenance across real SDK list changes but rejects the old queued definition',async()=>{
  const f=await fixture(false,true),before=f.root.tools.get('mcp__owned__echo'),reference=readConnectorToolOrigin(f.root,input()),exec=await f.prepare()
  const refresh=await f.root.tools.execute(input(undefined,{arguments:{message:'refresh-definitions'}}))
  expect(refresh.isError,JSON.stringify(refresh)).toBe(false)
  await vi.waitFor(()=>expect(f.root.tools.get('mcp__owned__echo')).not.toBe(before))
  expect(readConnectorToolOrigin(f.root,input())).toBe(reference)
  expect((await f.dispatch(exec)).isError).toBe(true)
  const result=await f.root.tools.execute(input());expect(result.isError,JSON.stringify(result)).toBe(false)
 })
})
