import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { realpath } from 'node:fs/promises'
import { openConnectorHttpEgress } from '../src/connector-http-egress.ts'
import { createManagedHarnessConnectorProvider } from '../src/managed-connector.ts'
assert.equal(process.platform,'linux');assert.equal(process.getuid(),10001)
const native=createRequire(await realpath('/opt/paimind/node_modules/@deepseek-ai/dsh/package.json'))
const compat=createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
const {Context}=compat('@deepseek-ai/cordis'),{ToolRuntime}=compat('@deepseek-ai/dsh-tools'),{SystemPrompt}=native('@deepseek-ai/dsh-system-prompt'),mcp=native('@deepseek-ai/dsh-mcp-client')
const domain={lookupCwd:'/var/lib/paimind',prepare(){throw Error('HTTP cannot invoke stdio placement')},nodeExecutable:'/usr/local/bin/node',moduleAnchor:'/opt/paimind/package.json'}
const roots=[],fibers=[],relays=[],checks=[],base='http://mcp-public.test:8080'
const passed=name=>{checks.push(name);console.log(JSON.stringify({check:name}))}
async function relay(path,secure=false){const f=await openConnectorHttpEgress({url:(secure?'https://mcp-public.test:8443':base)+path,headers:{}});relays.push(f);return f}
const stats=async()=>await(await fetch(base+'/stats')).json()
async function call(root,label,message){const result=await root.tools.execute({name:`mcp__${label}__echo`,callId:'egress-proof',arguments:{message},signal:AbortSignal.timeout(5000)});assert.equal(result.isError,false,JSON.stringify(result));assert.ok(JSON.stringify(result.value).includes(label+':'+message))}
try{
 for(const label of ['hansen','alex']){
  const root=new Context();roots.push(root);await root.plugin(SystemPrompt,{});await root.plugin(ToolRuntime,{})
  const provider=createManagedHarnessConnectorProvider(root,mcp,domain).select(mcp)
  const config={transport:'streamable-http',serverName:label,url:(label==='hansen'?'https://mcp-public.test:8443':base)+'/mcp/'+label,
    headers:{authorization:'Bearer synthetic-'+label},toolCallTimeoutMs:3000,failOnStartupError:true,reconnect:{enabled:false,initialDelayMs:100,maxDelayMs:1000,maxAttempts:1}}
  const fiber=await root.plugin(provider,config);fibers.push(fiber);assert.equal(fiber.state,2)
  await call(root,label,'actual-native-sse-reply')
 }
 assert.equal((await stats()).calls.length,2);assert.ok((await stats()).sessionRequests>=4)
 passed('real-native-client-http-and-verified-https-sessions-sse-discovery-and-tool-dispatch')
 const one=await relay('/events'),two=await relay('/events')
 assert.equal((await fetch(one.url,{headers:two.headers})).status,403)
 assert.equal((await fetch(one.url,{headers:{...one.headers,origin:'https://foreign.test'}})).status,403)
 const stream=await fetch(one.url,{headers:{...one.headers,'last-event-id':'resume-exact-id'}})
 assert.equal(stream.headers.get('mcp-session-id'),'synthetic-session')
 const reader=stream.body.getReader();assert.ok(new TextDecoder().decode((await reader.read()).value).includes('id: next-id'))
 await reader.cancel();assert.equal((await stats()).lastEventId,true)
 passed('capabilities-isolate-relays-and-native-session-and-replay-headers-survive-streaming')
 for(const path of ['/redirect','/failure']){
  const f=await relay(path),r=await fetch(f.url,{headers:f.headers})
  assert.equal(r.status,path==='/redirect'?502:401);assert.equal(r.headers.get('location'),null);assert.equal(r.headers.get('www-authenticate'),null)
  assert.equal(await r.text(),'Managed connector request unavailable')
 }
 const invalidTls=await openConnectorHttpEgress({url:'https://wrong-name.test:8443/mcp/hansen',headers:{}});relays.push(invalidTls)
 assert.equal((await fetch(invalidTls.url,{headers:invalidTls.headers})).status,502)
 const privateName=await openConnectorHttpEgress({url:'http://private-name.test:8080/private',headers:{}});relays.push(privateName)
 const before=(await stats()).requests
 assert.equal((await fetch(privateName.url,{headers:privateName.headers})).status,502)
 assert.equal((await stats()).requests,before)
 passed('redirects-private-dns-and-invalid-tls-denied-without-error-body-or-auth-challenge-leak')
 const hold=await relay('/hold'),pending=Array.from({length:8},()=>fetch(hold.url,{headers:hold.headers}).catch(()=>undefined))
 // These exact requests have reached the owned peer, not a guessed sleep.
 const deadline=Date.now()+5000
 while((await stats()).requests<before+8){assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,20))}
 assert.equal((await fetch(hold.url,{headers:hold.headers})).status,503)
 await hold.close();await Promise.all(pending)
 await fibers[0].dispose();assert.equal(roots[0].tools.get('mcp__hansen__echo'),undefined)
 await call(roots[1],'alex','peer-survives-disposal')
 passed('bounded-concurrency-cancellation-and-awaited-unload-preserve-other-native-provider')
}finally{for(const root of roots.reverse())await root.fiber.dispose();for(const f of relays.reverse())await f.close()}
console.log(JSON.stringify({status:'NATIVE_CONNECTOR_HTTP_EGRESS_PASSED',checks,finalImage:false,enterpriseAuthorization:false,browserE2E:false,syntheticInternalBridge:true}))
