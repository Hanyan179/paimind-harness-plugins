import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createCandidateExecutionDomain } from '/usr/local/lib/paimind/confine-execution.mjs'

assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 10001)
const require = createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
const base = createRequire(await realpath('/opt/paimind/node_modules/@deepseek-ai/dsh-base/package.json'))
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
const { SandboxPolicyService } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-sandbox-policy')).href)
const { LocalSandboxProvider } = await import(pathToFileURL(base.resolve('@deepseek-ai/dsh-sandbox-local')).href)
const { createManagedHarnessSubprocessProvider } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-subprocess')).href)
const { createManagedHarnessCodeProvider } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-code-runtime')).href)
const workspace = '/var/lib/paimind/workspaces/hansen'
const privateRoot = '/var/lib/paimind/dsh-home'
const alex = '/var/lib/paimind/workspaces/alex'
const domain = createCandidateExecutionDomain(workspace)
for (const directory of [workspace, privateRoot, alex, domain.resourceRoot, domain.temporaryRoot]) await mkdir(directory, { recursive: true, mode: 0o700 })
const secret = randomUUID()
process.env.PAIMIND_PRIVATE_CANARY = secret
await writeFile(`${privateRoot}/private-canary`, secret)
await writeFile(`${alex}/Alex.txt`, 'Alex only')
await writeFile(`${domain.resourceRoot}/reference.txt`, 'Hansen resource')
const root = new Context()
const checks = []
const passed = name => { checks.push(name); console.log(JSON.stringify({ nativeCodeCheck: name })) }
async function result(runtime, program, bindings = [], signal) {
  const value = await runtime.run({ program, bindings, ...(signal ? { signal } : {}) })
  assert.equal(value.error, undefined, JSON.stringify(value)); return value
}
async function markerPids(marker) {
  const pids = []
  for (const name of (await readdir('/proc')).filter(name => /^\d+$/.test(name))) {
    try { if ((await readFile(`/proc/${name}/cmdline`, 'utf8')).includes(marker)) pids.push(Number(name)) }
    catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error }
  }
  return pids
}
try {
  await root.plugin(LocalSandboxProvider, {})
  await root.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
  await root.plugin(createManagedHarnessSubprocessProvider(domain, root.sandbox))
  await root.plugin(createManagedHarnessCodeProvider({ executionWorld: domain }), {
    computeMs: 1000, maxWallMs: 5000, maxOutputBytes: 4096, maxOldGenerationSizeMb: 128,
  })
  const code = root.codeRuntime
  assert.equal(code.isolation, 'process'); assert.equal(code.language, 'typescript')
  assert.deepEqual(await result(code, 'const n: number = 3; console.log("Hansen ready"); return {n, ok:true}'),
    { value: { n: 3, ok: true }, logs: ['Hansen ready'] })
  await assert.rejects(code.run({ program: '', bindings: [{ global: 'console', functions: {} }] }), /reserved/)
  assert.equal((await code.run({ program: 'enum Color { Red }', bindings: [] })).error.kind, 'exception')
  passed('original-native-code-parsing-declarations-and-output')

  const observed = []
  const functions = Object.assign(Object.create(null), {
    echo: async args => { observed.push(args); return args },
    reject: async () => { throw Error('expected host refusal') },
  })
  Object.defineProperty(functions, '__proto__', { enumerable: true, value: async args => args })
  const bindings = [{ global: 'capabilities', functions, errorClass: { name: 'CapabilityError', memberNameProperty: 'member' } }]
  const called = await result(code, `
    const a=await capabilities.echo({member:'Hansen'});
    const literal=await capabilities.__proto__({literal:true});
    try {await capabilities.reject(null)} catch(e) {
      return {a,literal,typed:e instanceof CapabilityError,name:e.name,member:e.member,message:e.message};
    }
  `, bindings)
  assert.deepEqual(called.value, { a: { member: 'Hansen' }, literal: { literal: true }, typed: true,
    name: 'CapabilityError', member: 'reject', message: 'expected host refusal' })
  assert.deepEqual(observed, [{ member: 'Hansen' }])
  const large = await result(code, `
    const big=await transfer.echo({text:'汉森😀'.repeat(300000)});
    let deep=null;for(let i=0;i<12000;i++)deep={next:deep};
    let returned=await transfer.echo(deep),depth=0;while(returned){depth++;returned=returned.next};
    return {length:big.text.length,depth};
  `, [{ global: 'transfer', functions: { echo: async args => args } }])
  assert.deepEqual(large.value, { length: 1_200_000, depth: 12_000 })
  passed('declared-bindings-typed-errors-large-and-deep-json')

  const isolation = await result(code, `
    const fs=await import('node:fs/promises');
    const inaccessible=[];
    for(const path of [${JSON.stringify(privateRoot + '/private-canary')},${JSON.stringify(alex + '/Alex.txt')}]) {
      try {await fs.readFile(path)}catch(e){inaccessible.push(e.code)}
    }
    await fs.writeFile(${JSON.stringify(workspace + '/Code.txt')},'Hansen native code');
    let readonly;try{await fs.writeFile(${JSON.stringify(domain.resourceRoot + '/reference.txt')},'bad')}catch(e){readonly=e.code}
    return {inaccessible,readonly,resource:await fs.readFile(${JSON.stringify(domain.resourceRoot + '/reference.txt')},'utf8'),env:process.env.PAIMIND_PRIVATE_CANARY??null};
  `)
  assert.deepEqual(isolation.value, { inaccessible: ['ENOENT', 'ENOENT'], readonly: 'EROFS', resource: 'Hansen resource', env: null })
  assert.equal(await readFile(`${workspace}/Code.txt`, 'utf8'), 'Hansen native code')
  assert.equal(await readFile(`${privateRoot}/private-canary`, 'utf8'), secret)
  assert.equal(await readFile(`${alex}/Alex.txt`, 'utf8'), 'Alex only')
  assert.deepEqual((await result(code, 'globalThis.memberState="Hansen";return true')).value, true)
  assert.equal((await result(code, 'return typeof globalThis.memberState')).value, 'undefined')
  const readonly = new Context()
  try {
    await readonly.plugin(LocalSandboxProvider, {})
    await readonly.plugin(SandboxPolicyService, { mode: 'read-only', workspaceRoot: workspace })
    await readonly.plugin(createManagedHarnessSubprocessProvider(domain, readonly.sandbox))
    await readonly.plugin(createManagedHarnessCodeProvider({ executionWorld: domain }), {
      computeMs: 1000, maxWallMs: 5000, maxOutputBytes: 4096, maxOldGenerationSizeMb: 128,
    })
    const refusal = await result(readonly.codeRuntime, `const fs=await import('node:fs/promises');
      try{await fs.writeFile(${JSON.stringify(workspace + '/Code.txt')},'bad');return 'wrote'}catch(e){return e.code}`)
    assert.equal(refusal.value, 'EROFS')
    assert.equal(await readFile(`${workspace}/Code.txt`, 'utf8'), 'Hansen native code')
  } finally { await readonly.fiber.dispose() }
  passed('actual-code-private-other-member-resource-and-fresh-run-isolation')

  assert.equal((await code.run({ program: 'return ()=>1', bindings: [] })).error.kind, 'invalid-output')
  const over = await code.run({ program: 'console.log("x".repeat(5000));return true', bindings: [] })
  assert.equal(over.error.kind, 'output-limit')
  assert.ok(Buffer.byteLength(JSON.stringify(over.logs)) + Buffer.byteLength(JSON.stringify(over.error.message)) <= 4096)
  const slow = await result(code, 'return await clock.slow(null)', [{ global: 'clock', functions: { slow: async () => { await delay(1250); return 'waited' } } }])
  assert.equal(slow.value, 'waited')
  const busy = await code.run({ program: 'console.log("before busy timeout");while(true){}', bindings: [] })
  assert.equal(busy.error.kind, 'timeout'); assert.deepEqual(busy.logs, ['before busy timeout'])
  assert.equal((await code.run({ program: 'await new Promise(()=>{})', bindings: [] })).error.kind, 'timeout')
  passed('native-invalid-output-output-budget-busy-and-wall-time')

  const marker = `managed-code-child-${randomUUID()}`
  const abort = new AbortController()
  let signalStarted
  const started = new Promise(resolve => { signalStarted = resolve })
  const running = code.run({ program: `
    const {spawn}=await import('node:child_process');
    spawn('/usr/local/bin/node',['-e','setInterval(()=>{},1000)',${JSON.stringify(marker)}],{detached:true,stdio:'ignore'}).unref();
    await host.started(null);await new Promise(()=>{});
  `, bindings: [{ global: 'host', functions: { started: async () => { signalStarted(); return null } } }], signal: abort.signal })
  await Promise.race([started, delay(10_000, undefined, { ref: false }).then(() => { throw Error('code child did not start') })])
  assert.ok((await markerPids(marker)).length > 0)
  abort.abort('member cancelled')
  assert.equal((await running).error.kind, 'abort')
  assert.deepEqual(await markerPids(marker), [])
  const completedMarker = `managed-code-completed-child-${randomUUID()}`
  const completed = await result(code, `const {spawn}=await import('node:child_process');
    const child=spawn('/usr/local/bin/node',['-e','setInterval(()=>{},1000)',${JSON.stringify(completedMarker)}],{detached:true,stdio:'ignore'});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();return {pid:child.pid};`)
  assert.ok(Number.isInteger(completed.value.pid) && completed.value.pid > 0)
  assert.deepEqual(await markerPids(completedMarker), [])
  passed('native-abort-joins-detached-code-process-descendants')

  const memoryRoot = new Context()
  try {
    await memoryRoot.plugin(LocalSandboxProvider, {})
    await memoryRoot.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
    await memoryRoot.plugin(createManagedHarnessSubprocessProvider(domain, memoryRoot.sandbox))
    await memoryRoot.plugin(createManagedHarnessCodeProvider({ executionWorld: domain }), {
      computeMs: 60_000, maxWallMs: 5000, maxOutputBytes: 4096, maxOldGenerationSizeMb: 16,
    })
    const memory = await memoryRoot.codeRuntime.run({ program: 'const retain=[];while(true)retain.push(new Array(10000).fill("retained"))', bindings: [] })
    assert.equal(memory.error.kind, 'worker-exit')
    assert.equal((await result(code, 'return "other code runtime survives"')).value, 'other code runtime survives')
  } finally { await memoryRoot.fiber.dispose() }
  passed('native-worker-heap-limit-preserved-without-killing-controller')

  // Raw process descriptor writes bypass the native thread's console slots.
  // They must not be interpreted as trusted state or crash the controller.
  const hostile = await code.run({ program: `const fs=await import('node:fs');fs.writeSync(1,'malformed transport\\n');await new Promise(()=>{});`, bindings: [] })
  assert.equal(hostile.error.kind, 'worker-exit')
  assert.equal((await result(code, 'return "controller remains available"')).value, 'controller remains available')
  // A fresh readiness promise proves the active run, not an old completed one.
  const active = new Promise(resolve => { signalStarted = resolve })
  const live = code.run({ program: 'await host.started(null);while(true){}',
    bindings: [{ global: 'host', functions: { started: async () => { signalStarted(); return null } } }] })
  await Promise.race([active, delay(10_000, undefined, { ref: false }).then(() => { throw Error('disposal probe did not start') })])
  await root.fiber.dispose()
  assert.equal((await live).error.kind, 'abort')
  await assert.rejects(code.run({ program: 'return true', bindings: [] }), /withdrawn|disposal/)
  passed('hostile-transport-contained-and-disposal-quiescent')
} finally { await root.fiber.dispose() }
console.log(JSON.stringify({ status: 'NATIVE_CODE_PROCESS_SLICE_PASSED', checks,
  nativeCodeProcessSliceVerified: true, nativeFullProfileCodeVerified: false, workflowIsolationVerified: false,
  finalWorkerImageAccepted: false, memberAdmissionVerified: false, browserE2EVerified: false }))
