import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,realpath,stat,writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {createPreparedExecutionDomain} from '/usr/local/lib/paimind/confine-execution.mjs'
assert.equal(process.platform,'linux');assert.equal(process.getuid(),10001)
const require=createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
const base=createRequire(await realpath('/opt/paimind/node_modules/@deepseek-ai/dsh-base/package.json'))
const load=async name=>import(pathToFileURL(require.resolve(name)).href)
const {Context}=await load('@deepseek-ai/cordis'),{SandboxPolicyService}=await load('@deepseek-ai/dsh-sandbox-policy')
const {LocalSandboxProvider}=await import(pathToFileURL(base.resolve('@deepseek-ai/dsh-sandbox-local')).href)
const {createManagedHarnessSubprocessProvider}=await load('@paimind/harness-compat/managed-subprocess')
const {createManagedHarnessFilesystemProvider,readManagedHarnessFileChunk}=await load('@paimind/harness-compat/managed-filesystem')
const workspace='/var/lib/paimind/workspaces/hansen',path=workspace+'/Hansen full binary.dat'
await mkdir(workspace,{recursive:true,mode:0o700})
const bytes=Buffer.alloc(20971520);for(let i=0;i<bytes.length;i++)bytes[i]=i%251
await writeFile(path,bytes)
const identity=await stat(workspace,{bigint:true}),domain=createPreparedExecutionDomain(workspace,[{path:workspace,identity:`${identity.dev}:${identity.ino}`}])
for(const dir of [domain.temporaryRoot,domain.resourceRoot])await mkdir(dir,{recursive:true,mode:0o700})
const root=new Context(),helpers=[]
try{
 await root.plugin(LocalSandboxProvider,{})
 await root.plugin(SandboxPolicyService,{mode:'workspace-write',workspaceRoot:workspace})
 const Process=createManagedHarnessSubprocessProvider(domain,root.sandbox)
 class Observed extends Process{spawn(spec){const handle=super.spawn(spec);helpers.push(handle);return handle}}
 await root.plugin(Observed);await root.plugin(createManagedHarnessFilesystemProvider({executionWorld:domain}),{cwd:workspace})
 const hash=createHash('sha256'),start=performance.now(),signal=AbortSignal.timeout(120000)
 let offset=0,version
 while(offset<bytes.length){
  const chunk=await readManagedHarnessFileChunk(root,workspace,path,offset,version,signal)
  version??=chunk.version;assert.equal(chunk.version,version);assert.equal(chunk.size,bytes.length);assert.equal(chunk.offset,offset)
  const data=Buffer.from(chunk.data,'base64');assert.equal(data.length,65536);hash.update(data);offset+=data.length
  assert.equal(chunk.nextOffset,offset<bytes.length?offset:null)
 }
 const sha256=hash.digest('hex');assert.equal(sha256,createHash('sha256').update(bytes).digest('hex'))
 await root.fiber.dispose();for(const helper of helpers)assert.equal(await helper.waitForExit(AbortSignal.timeout(3000)),true)
 console.log(JSON.stringify({status:'MANAGED_FULL_FILE_LINUX_PASSED',bytes:offset,chunks:helpers.length,sha256,
  elapsedMs:Math.round(performance.now()-start),nativeFilesystem:true,authenticatedGateway:false,finalImage:false,browserE2E:false}))
}catch(error){for(const helper of helpers)process.stderr.write(helper.collected.stderr.readFrom(0).text);throw error}
finally{await root.fiber.dispose()}
