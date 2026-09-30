import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import postgres from 'postgres'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Identity } from '../src/identity.js'
import { RuntimeAdmission } from '../src/runtime-admission.js'
import { RuntimeRecoveryOperator } from '../src/runtime-recovery.js'
import type { PrivateRuntimeCell } from '../src/runtime-bindings.js'
import { DEFAULT_RUNTIME_RESOURCES } from '../src/runtime-resources.js'
import { createEnterpriseServer } from '../src/server.js'

const path=process.env.PAIMIND_HAAS_TEST_CONFIG
if(!path||statSync(path).mode&0o077)throw Error('Private isolated test database required')
const config=JSON.parse(readFileSync(path,'utf8'))
for(const value of [config.ownerUrl,config.applicationUrl]){const u=new URL(value);if(u.hostname!=='127.0.0.1'||u.pathname!=='/haas_e2e'||!u.port||['3080','5432','57631'].includes(u.port))throw Error('Unsafe recovery database')}
const owner=postgres(config.ownerUrl,{max:3,onnotice:()=>{}}),app=postgres(config.applicationUrl,{max:5,onnotice:()=>{}})
const disposers:Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const close of disposers.splice(0).reverse())await close()})
afterAll(async()=>{await owner.end();await app.end()})
const context=()=>({key:randomUUID(),requestId:randomUUID()})
async function fixture(){
  const tenantId='recovery-'+randomUUID(),password='Explicit synthetic recovery credential 2026'
  await owner`insert into haas.tenants(tenant_id) values(${tenantId})`
  const identity=new Identity(app,tenantId,Buffer.from(config.masterKey,'base64url'),config.bootstrapSecret)
  await identity.bootstrap({username:'morgan',displayName:'Morgan',password,bootstrapSecret:config.bootstrapSecret},context())
  const admin=await identity.login({username:'morgan',password},context())
  const member=(await identity.createMember(admin.token,{username:'hansen',displayName:'Hansen',password},context())).data
  const login=await identity.login({username:'hansen',password},context())
  const [port]=await owner`select p from generate_series(2000,65530) p where p<>3080 and not exists
    (select 1 from haas.runtime_bindings where origin='http://127.0.0.1:'||p::text) order by p limit 1`
  // Synthetic immutable pin, not an actual container. Real DB/auth/HTTP and
  // durable operator ordering only; real recovery/browser acceptance separate.
  const pin:PrivateRuntimeCell={cellId:randomUUID(),tenantId,userId:member.userId,role:'member',revision:randomUUID(),
    origin:`http://127.0.0.1:${port!.p}`,containerId:randomBytes(32).toString('hex'),imageId:'sha256:'+'d'.repeat(64),
    volumeName:'paimind-haas-member-recovery-'+randomUUID(),policyDigest:'sha256:'+'e'.repeat(64)}
  const admission=new RuntimeAdmission(owner,'http://127.0.0.1:62167'),operator=new RuntimeRecoveryOperator(owner)
  await admission.admit(pin,{...DEFAULT_RUNTIME_RESOURCES});await admission.suspend(pin)
  const [b]=await owner`select revision from haas.runtime_bindings where cell_id=${pin.cellId}`
  const fenced={...pin,revision:b!.revision}
  const reserve=createServer();await new Promise<void>(resolve=>reserve.listen(0,'127.0.0.1',resolve))
  const addr=reserve.address();if(!addr||typeof addr==='string')throw Error('No isolated listener');await new Promise<void>(resolve=>reserve.close(()=>resolve()))
  const origin=`http://127.0.0.1:${addr.port}`,server=createEnterpriseServer({identity,publicOrigin:origin,loopbackDevelopment:true})
  await new Promise<void>(resolve=>server.listen(addr.port,'127.0.0.1',resolve))
  disposers.push(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))})
  const post=(route:string,input:object,token=admin.token,key=randomUUID())=>fetch(origin+'/haas/v1/admin/'+route,{method:'POST',redirect:'error',
    headers:{origin,'content-type':'application/json','idempotency-key':key,cookie:'paimind_haas_session='+token},body:JSON.stringify(input)})
  const get=(id:string,token=admin.token)=>fetch(origin+'/haas/v1/admin/runtime-recovery-requests/'+id,{redirect:'error',headers:{cookie:'paimind_haas_session='+token}})
  const input={targetUserId:member.userId,expectedCellRevision:fenced.revision,expectedResourceRevision:0,reason:'显式恢复原成员运行环境',confirmed:true}
  const enqueue=async()=>{const response=await post('runtime-recovery-requests',input);expect(response.status).toBe(202);return (await response.json()).data.requestId as string}
  const next=()=>({...pin,revision:randomUUID(),containerId:randomBytes(32).toString('hex')})
  return {tenantId,identity,admin,member,login,pin,fenced,admission,operator,post,get,input,enqueue,next}
}

describe('HAAS-04 administrator recovery queue and operator boundary, real database/HTTP, synthetic runtime pins',()=>{
  it('accepts once with audit, keeps replay historical, allows a single durable claim and confirms only a new exact observed binding',async()=>{
    const f=await fixture(),key=randomUUID()
    const first=await f.post('runtime-recovery-requests',f.input,f.admin.token,key);expect(first.status).toBe(202)
    const receipt=(await first.json()).data;expect(receipt).toMatchObject({outcome:'queued',result:null,acceptedResourceRevision:0})
    expect((await f.post('runtime-recovery-requests',f.input)).status).toBe(409)
    const claim=await f.operator.claim(f.pin);expect(claim).not.toBeNull()
    expect(await new RuntimeRecoveryOperator(owner).claim(f.pin)).toBeNull()
    await f.operator.verify(claim!)
    await expect(f.operator.complete(claim!,f.pin)).rejects.toMatchObject({code:'runtime-recovery-changed'})
    const next=f.next()
    await f.admission.replaceSuspended(f.fenced,next,claim!.resources,db=>f.operator.verifyInTransaction(db,claim!))
    await f.operator.complete(claim!,next)
    expect((await (await f.get(receipt.requestId)).json()).data).toMatchObject({outcome:'applied',result:{cellRevision:next.revision,effect:'verified-replacement'}})
    const replay=await (await f.post('runtime-recovery-requests',f.input,f.admin.token,key)).json()
    expect(replay.replayed).toBe(true);expect(replay.data).toEqual(receipt)
    const publicText=JSON.stringify((await (await f.get(receipt.requestId)).json()).data)
    for(const privateValue of [f.pin.origin,f.pin.containerId,f.pin.volumeName,f.admin.token])expect(publicText).not.toContain(privateValue)
    const events=await owner`select action from haas.audit_events where tenant_id=${f.tenantId} and request_id=${receipt.requestId} and outcome='succeeded' order by sequence`
    expect(events.map(r=>r.action)).toEqual(['runtime.recovery.request','runtime.recovery.claimed','runtime.recovery.confirmed'])
    await expect(owner`update haas.runtime_recovery_requests set outcome='queued' where tenant_id=${f.tenantId}`).rejects.toBeDefined()
  })
  it('serializes equal/different-key requests, rejects changed same-key input and never dispatches through HTTP',async()=>{
    const f=await fixture(),key=randomUUID()
    const responses=await Promise.all([f.post('runtime-recovery-requests',f.input,f.admin.token,key),f.post('runtime-recovery-requests',f.input,f.admin.token,key)])
    expect(responses.map(r=>r.status)).toEqual([202,202]);expect((await Promise.all(responses.map(r=>r.json()))).filter(r=>r.replayed)).toHaveLength(1)
    expect((await f.post('runtime-recovery-requests',{...f.input,reason:'改变同键请求原因'},f.admin.token,key)).status).toBe(409)
    expect((await f.post('runtime-recovery-requests',f.input)).status).toBe(409)
    const [row]=await owner`select outcome,claim_id from haas.runtime_recovery_requests where tenant_id=${f.tenantId}`
    expect(row).toMatchObject({outcome:'queued',claim_id:null})
  })
  it('denies members, cross-tenant known receipts/targets, stale versions, active bindings and missing confirmation',async()=>{
    const f=await fixture(),foreign=await fixture(),id=await foreign.enqueue()
    expect((await f.post('runtime-recovery-requests',f.input,f.login.token)).status).toBe(403)
    expect((await f.get(id)).status).toBe(404)
    expect((await f.get(id,f.login.token)).status).toBe(403)
    expect((await f.post('runtime-recovery-requests',{...f.input,targetUserId:foreign.member.userId})).status).toBe(404)
    expect((await f.post('runtime-recovery-requests',{...f.input,expectedCellRevision:randomUUID()})).status).toBe(409)
    expect((await f.post('runtime-recovery-requests',{...f.input,expectedResourceRevision:1})).status).toBe(409)
    expect((await f.post('runtime-recovery-requests',{...f.input,confirmed:false})).status).toBe(400)
    const next=f.next();await f.admission.replaceSuspended(f.fenced,next,{...DEFAULT_RUNTIME_RESOURCES})
    expect((await f.post('runtime-recovery-requests',{...f.input,expectedCellRevision:next.revision})).status).toBe(409)
  })
  it.each(['logout','role','target','tenant','policy'] as const)('rejects a queued request before effects after %s changes',async change=>{
    const f=await fixture(),id=await f.enqueue()
    if(change==='logout')await f.identity.logout(f.admin.token,{},context())
    if(change==='role')await owner`update haas.users set role='member' where tenant_id=${f.tenantId} and user_id=${f.admin.data.userId}`
    if(change==='target')await owner`update haas.users set status='disabled' where tenant_id=${f.tenantId} and user_id=${f.member.userId}`
    if(change==='tenant')await owner`update haas.tenants set status='disabled' where tenant_id=${f.tenantId}`
    if(change==='policy')expect((await f.post('runtime-resource-policy',{targetUserId:f.member.userId,expectedRevision:0,desiredState:'suspended',cpuMillis:1000,memoryMiB:1024,pidsLimit:256,reason:'暂停尚未执行的恢复',confirmed:true})).status).toBe(200)
    expect(await f.operator.claim(f.pin)).toBeNull()
    const [r]=await owner`select outcome,result from haas.runtime_recovery_requests where tenant_id=${f.tenantId} and request_id=${id}`
    expect(r).toMatchObject({outcome:'rejected',result:{effect:'not-started'}})
    const [binding]=await owner`select container_id,revision from haas.runtime_bindings where cell_id=${f.pin.cellId}`
    expect(binding).toMatchObject({container_id:f.pin.containerId,revision:f.fenced.revision})
  })
  it('rechecks current authority within replacement commit and retains unknown effects without automatic reclaim',async()=>{
    const f=await fixture(),id=await f.enqueue(),claim=(await f.operator.claim(f.pin))!
    await f.identity.logout(f.admin.token,{},context())
    await expect(f.admission.replaceSuspended(f.fenced,f.next(),claim.resources,db=>f.operator.verifyInTransaction(db,claim))).rejects.toMatchObject({code:'runtime-recovery-changed'})
    await f.operator.unconfirmed(claim)
    expect(await f.operator.claim(f.pin)).toBeNull()
    const [row]=await owner`select outcome,result from haas.runtime_recovery_requests where tenant_id=${f.tenantId} and request_id=${id}`
    expect(row).toMatchObject({outcome:'unconfirmed',result:{effect:'unknown',retry:'operator-inspection-required'}})
    await expect(owner`delete from haas.runtime_recovery_requests where tenant_id=${f.tenantId}`).rejects.toBeDefined()
  })
  it('never reclaims an interrupted executing command after a new operator instance and rejects modified claim identity',async()=>{
    const f=await fixture();await f.enqueue();const claim=(await f.operator.claim(f.pin))!
    expect(await new RuntimeRecoveryOperator(owner).claim(f.pin)).toBeNull()
    for(const altered of [{...claim,claimId:randomUUID()},{...claim,pin:{...claim.pin,volumeName:'paimind-haas-member-foreign'}},
      {...claim,resources:{...claim.resources,memoryMiB:512}}])await expect(f.operator.verify(altered)).rejects.toMatchObject({code:'runtime-recovery-changed'})
    await expect(app`update haas.runtime_recovery_requests set outcome='applied' where tenant_id=${f.tenantId}`).rejects.toMatchObject({code:'42501'})
    await expect(app`insert into haas.runtime_recovery_requests (tenant_id,request_id,outcome) values (${f.tenantId},${randomUUID()},'applied')`).rejects.toMatchObject({code:'42501'})
    await expect(new RuntimeRecoveryOperator(app).claim(f.pin)).rejects.toBeDefined()
    const state=await f.post('runtime-recovery-state',{targetUserId:f.member.userId,reason:'回读恢复请求记录',confirmed:true})
    expect((await state.json()).data.request).toMatchObject({outcome:'executing',result:null})
  })
  it('rolls back request and claim if their corresponding audit fails, before any operator effect',async()=>{
    const f=await fixture(),trigger='reject_recovery_'+randomBytes(6).toString('hex')
    for(const action of ['runtime.recovery.request','runtime.recovery.claimed']){
      await owner.unsafe(`create function haas.${trigger}() returns trigger language plpgsql as $$ begin
        if NEW.tenant_id='${f.tenantId}' and NEW.action='${action}' and NEW.outcome='succeeded' then raise exception 'explicit recovery audit fault'; end if; return NEW; end $$;
        create trigger ${trigger} before insert on haas.audit_events for each row execute function haas.${trigger}();`)
      try{
        if(action.endsWith('request'))expect((await f.post('runtime-recovery-requests',f.input)).status).toBe(503)
        else await expect(f.operator.claim(f.pin)).rejects.toBeDefined()
      }finally{await owner.unsafe(`drop trigger ${trigger} on haas.audit_events; drop function haas.${trigger}();`)}
      if(action.endsWith('request')){expect(await owner`select 1 from haas.runtime_recovery_requests where tenant_id=${f.tenantId}`).toHaveLength(0);await f.enqueue()}
      else {const [r]=await owner`select outcome,claim_id from haas.runtime_recovery_requests where tenant_id=${f.tenantId}`;expect(r).toMatchObject({outcome:'queued',claim_id:null})}
    }
  })
})
