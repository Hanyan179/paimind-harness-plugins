import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { createManagedHarnessConnectorProvider } from '../src/managed-connector.ts'

// Diagnostic on the immutable existing image plus this exact source overlay.
// No online/member volume is mounted; not final image or enterprise admission.
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 10001)
const { createPreparedExecutionDomain } = await import('/usr/local/lib/paimind/confine-execution.mjs')
const anchor = await realpath('/opt/paimind/node_modules/@deepseek-ai/dsh/package.json'), require = createRequire(anchor)
const compat = createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
const { Context } = compat('@deepseek-ai/cordis'), { ToolRuntime } = compat('@deepseek-ai/dsh-tools')
const { SystemPrompt } = require('@deepseek-ai/dsh-system-prompt'), mcp = require('@deepseek-ai/dsh-mcp-client')
const mcpAnchor = require.resolve('@deepseek-ai/dsh-mcp-client/package.json')
const marker = 'paimind-connector-probe-' + randomUUID(), privateRoot = '/var/lib/paimind/dsh-home'
await mkdir(privateRoot, { recursive: true, mode: 0o700 }); await writeFile(privateRoot + '/canary', 'SYNTHETIC_PRIVATE_FILE')
process.env.PAIMIND_AMBIENT_DIAGNOSTIC = 'SYNTHETIC_PARENT_VALUE'
const peer = createServer((_req, res) => res.end('SYNTHETIC_PRIVATE_NETWORK'))
await new Promise(resolve => peer.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${peer.address().port}/private`
assert.equal(await (await fetch(url)).text(), 'SYNTHETIC_PRIVATE_NETWORK')
const serverProgram = String.raw`
import {createRequire} from 'node:module';import{readFile,writeFile,readdir}from'node:fs/promises';import{randomUUID}from'node:crypto';
const [anchor,workspace,other,url]=process.argv.slice(2),require=createRequire(anchor),{Server}=require('@modelcontextprotocol/sdk/server/index.js'),{StdioServerTransport}=require('@modelcontextprotocol/sdk/server/stdio.js'),{ListToolsRequestSchema,CallToolRequestSchema}=require('@modelcontextprotocol/sdk/types.js');
const server=new Server({name:'managed-placement-probe',version:'1'},{capabilities:{tools:{}}}),generation=randomUUID();
const readable=async path=>{try{await readFile(path);return true}catch{return false}};
server.setRequestHandler(ListToolsRequestSchema,()=>({tools:['inspect','exit'].map(name=>({name,description:'Local isolation diagnostic',inputSchema:{type:'object',properties:{},additionalProperties:false}}))}));
server.setRequestHandler(CallToolRequestSchema,async req=>{
 if(req.params.name==='exit'){setTimeout(()=>process.exit(0),25);return{content:[{type:'text',text:'exit scheduled'}]}}
 if(req.params.name!=='inspect')throw Error('Unknown diagnostic');
 let network=false;try{network=(await fetch(url,{signal:AbortSignal.timeout(300)})).ok}catch{}
 let proc=false;try{await readdir('/proc');proc=true}catch{}
 await writeFile(workspace+'/connector-owned.txt',process.env.CONNECTOR_LABEL);
 const data={generation,label:process.env.CONNECTOR_LABEL,cwd:process.cwd(),ambient:process.env.PAIMIND_AMBIENT_DIAGNOSTIC!==undefined,late:process.env.PAIMIND_LATE_DIAGNOSTIC!==undefined,
 privateFile:await readable('/var/lib/paimind/dsh-home/canary'),otherMember:await readable(other+'/ownership.txt'),network,proc,
 ownFile:await readFile(workspace+'/connector-owned.txt','utf8')};
 return{content:[{type:'text',text:JSON.stringify(data)}]}
});await server.connect(new StdioServerTransport());
`
assert.ok(serverProgram.length < 4096)
const roots = [], fibers = [], checks = []
const passed = name => { checks.push(name); console.log(JSON.stringify({ managedConnectorCheck: name })) }
async function until(check) { for (let n=0;n<100;n++) { if (await check()) return; await delay(50) } throw Error('Diagnostic readiness/disposal timeout') }
async function ownedProcesses() {
  const rows = await readdir('/proc'), found = []
  for (const pid of rows.filter(p => /^\d+$/u.test(p))) { try { if ((await readFile('/proc/'+pid+'/cmdline','utf8')).includes(marker)) found.push(pid) } catch(e) { if (!['ENOENT','ESRCH'].includes(e.code)) throw e } }
  return found
}
async function call(root, name, tool = 'inspect') {
  const result = await root.tools.execute({ name:`mcp__${name}__${tool}`,callId:'connector-kernel-probe',arguments:{},signal:AbortSignal.timeout(5000) })
  assert.equal(result.isError,false,JSON.stringify(result))
  return tool === 'inspect' ? JSON.parse(result.value.content[0].text) : result.value
}
function verify(value, name) {
  assert.equal(value.label,name);assert.equal(value.ownFile,name);assert.equal(value.cwd,'/var/lib/paimind/workspaces/'+name)
  for(const key of ['ambient','late','privateFile','otherMember','network','proc'])assert.equal(value[key],false,key)
}
try {
  for (const name of ['hansen','alex']) {
    for (const kind of ['workspaces','temporary','resources']) await mkdir(`/var/lib/paimind/${kind}/${name}`,{recursive:true,mode:0o700})
    await writeFile(`/var/lib/paimind/workspaces/${name}/ownership.txt`,name)
  }
  for (const name of ['hansen','alex']) {
    const root = new Context();roots.push(root);await root.plugin(SystemPrompt,{});await root.plugin(ToolRuntime,{})
    const workspace = '/var/lib/paimind/workspaces/'+name, info = await stat(workspace)
    const domain = createPreparedExecutionDomain(workspace,[{path:workspace,identity:info.dev+':'+info.ino}])
    const owner = createManagedHarnessConnectorProvider(root,mcp,domain), provider = owner.select(mcp)
    const script = workspace+'/connector-probe.mjs';await writeFile(script,serverProgram,{flag:'wx',mode:0o600})
    const config = {transport:'stdio',serverName:name,command:'/usr/local/bin/node',args:[script,mcpAnchor,workspace,
      '/var/lib/paimind/workspaces/'+(name==='hansen'?'alex':'hansen'),url,marker],cwd:workspace,env:{CONNECTOR_LABEL:name},toolCallTimeoutMs:1000,failOnStartupError:true,
      reconnect:{enabled:true,initialDelayMs:100,maxDelayMs:1000,maxAttempts:2}}
    const fiber = await root.plugin(provider,config);fibers.push(fiber);assert.equal(fiber.state,2)
    verify(await call(root,name),name)
  }
  passed('two-native-providers-use-exact-isolated-worlds-and-real-tool-dispatch')
  passed('private-home-cross-member-proc-ambient-env-and-native-loopback-denied')
  const [hansen,alex] = roots, prior = await call(hansen,'hansen'), oldTool = hansen.tools.get('mcp__hansen__inspect')
  process.env.PAIMIND_LATE_DIAGNOSTIC='SYNTHETIC_LATE_PARENT'
  await call(hansen,'hansen','exit')
  await until(()=>hansen.tools.get('mcp__hansen__inspect') && hansen.tools.get('mcp__hansen__inspect')!==oldTool)
  const next = await call(hansen,'hansen');verify(next,'hansen');assert.notEqual(next.generation,prior.generation)
  verify(await call(alex,'alex'),'alex')
  passed('original-native-reconnect-preserves-placement-and-scrubs-late-parent-env')
  await fibers[0].dispose();assert.equal(hansen.tools.get('mcp__hansen__inspect'),undefined)
  verify(await call(alex,'alex'),'alex')
  await fibers[1].dispose();assert.equal(alex.tools.get('mcp__alex__inspect'),undefined)
  await until(async()=>!(await ownedProcesses()).length)
  passed('original-awaited-disposal-removes-tools-and-descendants-without-stopping-peer')
  for(const name of ['hansen','alex'])assert.equal(await readFile(`/var/lib/paimind/workspaces/${name}/connector-owned.txt`,'utf8'),name)
  console.log(JSON.stringify({status:'MANAGED_CONNECTOR_STDIO_LINUX_PASSED',checks,finalImage:false,enterpriseGrant:false,browserE2E:false}))
} finally {
  for (const root of roots.reverse()) await root.fiber.dispose()
  peer.closeAllConnections();await new Promise(resolve=>peer.close(resolve))
}
