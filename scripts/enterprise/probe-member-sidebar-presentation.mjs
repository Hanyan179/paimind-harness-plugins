import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {lstat,mkdtemp,readFile,realpath,writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {createServer as reservationServer} from 'node:net'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {build} from 'esbuild'

// Original two live worker providers and PG identity; only a new temporary
// gateway and exactly two test login sessions. No native settings, credentials,
// business objects, existing browser login or live service is changed.
assert.equal(process.argv.length,4)
const root=await realpath(resolve(dirname(fileURLToPath(import.meta.url)),'../..'))
const base=await realpath(join(root,'../.paimind-goal-evidence'))
const runtime=await realpath(process.argv[2]),credentialPath=await realpath(process.argv[3])
assert.equal(dirname(runtime),base);assert.ok(runtime.startsWith(base+'/haas-member-browser-cells-'))
assert.equal(dirname(dirname(credentialPath)),base);assert.ok(dirname(credentialPath).startsWith(base+'/haas-members-normal-names-'))
const hash=value=>createHash('sha256').update(value).digest('hex')
async function privateJson(path){const s=await lstat(path);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.uid===process.getuid()&&!(s.mode&0o077));return JSON.parse(await readFile(path,'utf8'))}
const state=await privateJson(join(runtime,'operator-state.json')),config=await privateJson(join(runtime,'gateway-config.json'))
const credentials=await privateJson(credentialPath)
assert.equal(state.sourceRoot,root);assert.equal(state.cells.length,2);assert.equal(config.nativePrivateCells.length,2)
assert.deepEqual(state.cells.map(c=>c.member).sort(),['alex','hansen'])
const db=new URL(config.applicationUrl);assert.equal(db.hostname,'127.0.0.1');assert.equal(db.pathname,'/haas_e2e');assert.ok(!['3080','5432','10012'].includes(db.port))
const inspect=()=>state.cells.map(c=>{const [s]=JSON.parse(execFileSync('docker',['inspect',c.pin.containerId],{encoding:'utf8',timeout:10000}));
 assert.equal(s.State.Running,true);assert.equal(s.Image,c.pin.imageId);assert.equal(s.Config.User,'10001:10001');assert.equal(s.HostConfig.ReadonlyRootfs,true)
 assert.ok(s.Mounts.some(m=>m.Name===c.pin.volumeName));const pin=config.nativePrivateCells.find(p=>p.cellId===c.pin.cellId)
 for(const [key,value]of Object.entries(c.pin))assert.equal(pin[key],value)
 return{member:c.member,cellId:c.pin.cellId,containerId:s.Id,imageId:s.Image,startedAt:s.State.StartedAt,volume:c.pin.volumeName}})
const before=inspect();process.umask(0o077)
const evidence=await mkdtemp(join(base,'haas-sidebar-presentation-real-'))
const save=(name,value)=>writeFile(join(evidence,name),JSON.stringify(value,null,2),{mode:0o600,flag:'wx'})
const snapshot=(name,baseline)=>execFileSync(process.execPath,[join(root,'scripts/enterprise/snapshot-member-native.mjs'),runtime,join(evidence,name),...(baseline?[join(evidence,baseline)]:[])],{cwd:root,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']})
snapshot('before-native.json')
console.log(JSON.stringify({status:'REAL_SIDEBAR_PRESENTATION_STARTED',evidence,runtime,browserE2EVerified:false}))
const artifact=join(evidence,'probe-runtime.mjs')
const built=await build({stdin:{contents:`export {Identity} from './apps/enterprise-server/src/identity.ts';
export {NativeGateway} from './apps/enterprise-server/src/native-gateway.ts';
export {RuntimeBindings} from './apps/enterprise-server/src/runtime-bindings.ts';
export {CellTransport} from './apps/enterprise-server/src/cell-transport.ts';
export {createEnterpriseServer} from './apps/enterprise-server/src/server.ts';`,resolveDir:root,loader:'ts'},outfile:artifact,bundle:true,platform:'node',format:'esm',target:'node24',metafile:true,
 plugins:[{name:'exact-installed-external-files',setup(builder){builder.onResolve({filter:/^[^./]/},async args=>{
  if(args.path.startsWith('node:'))return{path:args.path,external:true};if(args.pluginData==='installed')return undefined
  const result=await builder.resolve(args.path,{resolveDir:args.resolveDir,kind:args.kind,pluginData:'installed'});return{path:result.path,external:true,errors:result.errors,warnings:result.warnings}
 })}}]})
const inputs=[]
for(const path of [...Object.keys(built.metafile.inputs).filter(p=>p!=='<stdin>'),'packages/better-sidebar-adapter/lib/index.js','packages/harness-compat/lib/gateway-transport.js']){
 const absolute=await realpath(resolve(root,path));assert.ok(absolute.startsWith(root+'/'));inputs.push({path,sha256:hash(await readFile(absolute))})}
await save('inputs.json',{sourceRoot:root,inputs,before})
const {Identity,NativeGateway,RuntimeBindings,CellTransport,createEnterpriseServer}=await import(pathToFileURL(artifact).href)
const reserve=reservationServer();await new Promise((done,reject)=>{reserve.once('error',reject);reserve.listen(0,'127.0.0.1',done)})
const address=reserve.address();assert.ok(address&&typeof address!=='string'&&address.port!==3080);const publicOrigin=`http://127.0.0.1:${address.port}`
assert.notEqual(publicOrigin,config.publicOrigin);await new Promise(done=>reserve.close(done))
const postgres=createRequire(join(root,'apps/enterprise-server/package.json'))('postgres')
const sql=postgres(config.applicationUrl,{max:4,connect_timeout:5,onnotice:()=>{},connection:{statement_timeout:5000,lock_timeout:5000}})
const identity=new Identity(sql,config.tenantId,Buffer.from(config.masterKey,'base64url'),config.bootstrapSecret)
const pins=config.nativePrivateCells.map(({transportKey:_secret,...pin})=>pin),userIds=pins.map(p=>p.userId)
const readLogins=()=>sql`select session_id,user_id,revoked_at,expires_at from haas.login_sessions where tenant_id=${config.tenantId} and user_id in ${sql(userIds)} order by session_id`
const oldLogins=Array.from(await readLogins()),bindings=new RuntimeBindings(sql,identity,publicOrigin,[],pins)
const transports=new Map(config.nativePrivateCells.map(p=>[p.origin,new CellTransport(p.origin,p.transportKey)]))
const gateway=new NativeGateway({publicOrigin,transports,resolve:(token,id)=>bindings.resolve(token,id),authorize:(token,id,grant,request,verify)=>identity.authorizeRuntimeOperation(token,id,grant,request,verify)})
const server=createEnterpriseServer({identity,publicOrigin,nativeGateway:gateway,loopbackDevelopment:true})
const sessions=[],operations=[],command=()=>({key:randomUUID(),requestId:randomUUID()})
let phase='listen',passed=false,result
async function send(session,path,body={}){
 const response=await fetch(publicOrigin+path,{method:'POST',headers:{origin:publicOrigin,'content-type':'application/json',cookie:`paimind_haas_session=${session.token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)})
 const value=await response.json();operations.push({member:session.member,path,inputKeys:Object.keys(body),status:response.status,requestId:response.headers.get('x-request-id')})
 return{status:response.status,value,requestId:response.headers.get('x-request-id')}
}
try{
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(address.port,'127.0.0.1',done)})
 for(const member of before){phase=member.member+':login';const credential=credentials.members.find(c=>c.username===member.member);assert.ok(credential)
  const login=await identity.login({username:credential.username,password:credential.password},command());const session={member:member.member,token:login.token,closed:false};sessions.push(session)
  const me=await identity.me(login.token,randomUUID());assert.equal(me.role,'member');assert.equal(me.userId,pins.find(p=>p.cellId===member.cellId).userId)
  const grant=await bindings.resolve(login.token,randomUUID());assert.equal(grant.cellId,member.cellId);assert.equal(grant.transport,'private-cell')
 }
 const readings=[]
 for(const session of sessions){for(const path of ['/sidebar/api/shell.get','/sidebar/api/settings.get']){
  phase=session.member+':'+path;const response=await send(session,path);assert.equal(response.status,200);assert.equal(response.value.ok,true)
  const view=response.value.value;assert.ok(view&&typeof view==='object')
  if(path.endsWith('shell.get')){assert.deepEqual(Object.keys(view).sort(),['name','shell']);assert.equal(typeof view.name,'string');assert.equal(typeof view.shell,'string')}
  else{assert.equal(typeof view.externalDisable,'boolean');assert.equal(typeof view.revision,'number');assert.ok(view.value)
   assert.equal(Object.hasOwn(view.value,'terminalShellArgs'),false);assert.equal(Object.hasOwn(view.value,'pluginSettings'),false)
   for(const key of ['htmlViewerNoSandbox','htmlViewerDefaultUnsafe','browserNoSandbox'])assert.equal(view.value[key],false)
  }
  readings.push({member:session.member,path,view})
  for(const selector of ['userId','sessionId','cwd','patch']){const rejected=await send(session,path,{[selector]:'foreign-selector'});assert.equal(rejected.status,400)}
 }
 for(const path of ['/sidebar/api/settings.update','/sidebar/api/shell.execute'])assert.ok((await send(session,path)).status>=400)
 }
 phase='one-login-revocation';await identity.logout(sessions[0].token,{},command());sessions[0].closed=true
 assert.equal((await send(sessions[0],'/sidebar/api/settings.get')).status,401);assert.equal((await send(sessions[1],'/sidebar/api/settings.get')).status,200)
 const deniedIds=operations.filter(o=>o.status===400).map(o=>o.requestId);assert.ok(deniedIds.every(Boolean))
 const audit=await sql`select request_id,actor_user_id,action,outcome,reason from haas.audit_events where tenant_id=${config.tenantId} and request_id in ${sql(deniedIds)} order by request_id`
 assert.equal(audit.length,deniedIds.length);for(const row of audit){assert.equal(row.action,'runtime.operation');assert.equal(row.outcome,'denied');assert.ok(['invalid-native-operation','native-operation-denied'].includes(row.reason));const op=operations.find(o=>o.requestId===row.request_id);assert.equal(row.actor_user_id,state.cells.find(c=>c.member===op.member).pin.userId)}
 phase='state-and-source';snapshot('after-native.json','before-native.json');const after=inspect();assert.deepEqual(after,before)
 for(const input of inputs)assert.equal(hash(await readFile(resolve(root,input.path))),input.sha256)
 result={status:'REAL_SIDEBAR_PRESENTATION_PASSED',publicOrigin,runtime,before,after,readings,operations,audit,nativeObjectsAndHistoryUnchanged:true,browserE2EVerified:false,finalWorkerImageAccepted:false}
 passed=true
}catch{
 await save('failure.json',{status:'FAILED',phase,operations,browserE2EVerified:false});console.error(JSON.stringify({status:'REAL_SIDEBAR_PRESENTATION_FAILED',phase,evidence}));process.exitCode=1
}finally{
 gateway.close();server.closeAllConnections();await new Promise(done=>server.close(done))
 let loginReadbackVerified=false
 try{for(const session of sessions)if(!session.closed){await identity.logout(session.token,{},command());session.closed=true}
  const all=Array.from(await readLogins()),ids=new Set(oldLogins.map(r=>r.session_id));assert.deepEqual(all.filter(r=>ids.has(r.session_id)),oldLogins)
  const created=all.filter(r=>!ids.has(r.session_id));assert.equal(created.length,sessions.length);assert.ok(created.every(r=>r.revoked_at!==null));loginReadbackVerified=true
  await save('test-login-closure.json',{existingLoginsUnchanged:true,existingCount:oldLogins.length,createdTestLogins:created})
 }catch{passed=false;process.exitCode=1;await save('cleanup-failure.json',{phase:'exact-test-login-closure',logoutsCompleted:sessions.filter(s=>s.closed).length})}
 finally{await sql.end({timeout:5})}
 await save('closed.json',{probeGatewayClosed:true,createdTestLoginsRevoked:sessions.every(s=>s.closed),loginReadbackVerified,liveMembersRestarted:false,userVolumesRemoved:false})
}
if(passed){await save('result.json',result);console.log(JSON.stringify({status:result.status,evidence,checks:operations.length,browserE2EVerified:false,liveMembersRestarted:false}))}
