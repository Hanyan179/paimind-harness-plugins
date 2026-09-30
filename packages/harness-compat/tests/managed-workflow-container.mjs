import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createCandidateExecutionDomain } from '/usr/local/lib/paimind/confine-execution.mjs'

// Actual published workflow engine in the real Linux execution domain. The
// subagent endpoint is explicitly a data/lifecycle fixture; it is NOT a real
// model, an admitted member, or full-profile/preset/Browser E2E acceptance.
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 10001)
const workspace = '/var/lib/paimind/workspaces/hansen'
const alex = '/var/lib/paimind/workspaces/alex'
const privateRoot = '/var/lib/paimind/dsh-home'
const domain = createCandidateExecutionDomain(workspace)
for (const path of [workspace, alex, privateRoot, '/var/lib/paimind/home', domain.temporaryRoot, domain.resourceRoot]) {
  await mkdir(path, { recursive: true, mode: 0o700 })
}
await writeFile(`${privateRoot}/private-canary`, 'controller-only')
await writeFile(`${alex}/Alex.txt`, 'Alex-only')
await writeFile(`${domain.resourceRoot}/reference.txt`, 'Hansen reference')
process.env.HOME = '/var/lib/paimind/home'; process.env.DSH_HOME = privateRoot
process.env.PAIMIND_PRIVATE_CANARY = 'controller-environment-only'; process.chdir(workspace)
const require = createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
const load = async name => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { LocalSandboxProvider } = await load('@deepseek-ai/dsh-sandbox-local')
const { SandboxPolicyService } = await load('@deepseek-ai/dsh-sandbox-policy')
const { createManagedHarnessSubprocessProvider } = await load('@paimind/harness-compat/managed-subprocess')
const { createManagedHarnessWorkflowProvider } = await load('@paimind/harness-compat/managed-workflow')
const root = new Context(); const checks = []; const disposed = []; const calls = []; const events = []
const parent = Object.freeze({ fixtureParent: 'Hansen' })
const meta = { name: 'hansen-review', description: 'Review Hansen delivery', phases: [{ title: 'Review' }] }
const helperAuthority = `const p=log.constructor('return process')();const fs=p.getBuiltinModule('node:fs');`
async function pids(marker) {
  const found = []
  for (const pid of (await readdir('/proc')).filter(pid => /^\d+$/.test(pid))) {
    try { if ((await readFile(`/proc/${pid}/cmdline`, 'utf8')).includes(marker)) found.push(Number(pid)) }
    catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error }
  }
  return found
}
function passed(name) { checks.push(name); console.log(JSON.stringify({ nativeWorkflowCheck: name })) }
async function setup(context, mode = 'workspace-write') {
  context.provide('subagents', { getProvider: name => name === 'spawn' ? {} : undefined,
    start: async (provider, request) => {
      assert.equal(provider, 'spawn'); assert.equal(request.parent, parent)
      const id = `fixture-child-${calls.length + 1}`; calls.push({ id, signal: request.signal })
      return { id, result: Promise.resolve({ output: [{ type: 'text', text: 'Hansen fixture result' }], stopReason: 'completed' }),
        dispose: async () => { disposed.push(id) } }
    } })
  for (const name of ['workflow/start', 'workflow/phase', 'workflow/log', 'workflow/agent-start', 'workflow/agent-end', 'workflow/end']) {
    context.on(name, (...values) => events.push({ name, values }))
  }
  await context.plugin(LocalSandboxProvider, {})
  await context.plugin(SandboxPolicyService, { mode, workspaceRoot: workspace })
  await context.plugin(createManagedHarnessSubprocessProvider(domain, context.sandbox))
  await context.plugin(createManagedHarnessWorkflowProvider({ executionWorld: domain }), {
    maxConcurrentAgents: 2, maxTotalAgents: 5, maxItemsPerCall: 10, syncTimeoutMs: 500, disposeGraceMs: 200,
  })
}
async function run(script, context = root, args) {
  const handle = context.workflowEngine.start({ script, meta, parent, ...(args === undefined ? {} : { args }) })
  try { return await handle.result } finally { await handle.dispose() }
}
try {
  await setup(root)
  const ordinary = await run(`phase('Review');log('Hansen review');return await parallel([
    ()=>agent('review order',{label:'Order'}),()=>agent('review invoice',{label:'Invoice'})]);`)
  assert.deepEqual(ordinary, { value: ['Hansen fixture result', 'Hansen fixture result'], stopReason: 'completed', agentsStarted: 2 })
  assert.equal(calls.length, 2); assert.equal(new Set(disposed).size, 2); assert.equal(disposed.length, 2)
  assert.equal(calls[0].signal, calls[1].signal)
  assert.equal(events.filter(event => event.name === 'workflow/agent-start').length, 2)
  assert.equal(events.filter(event => event.name === 'workflow/agent-end').length, 2)
  passed('published-native-workflow-hooks-and-fixture-child-lifecycle')

  const isolation = await run(`${helperAuthority}
    const codes=[];for(const file of ${JSON.stringify([`${privateRoot}/private-canary`, `${alex}/Alex.txt`])}){
      try{fs.readFileSync(file);codes.push('EXPOSED')}catch(e){codes.push(e.code)}
    }
    fs.writeFileSync(${JSON.stringify(workspace + '/Workflow.txt')},'Hansen workflow');
    let readonly;try{fs.writeFileSync(${JSON.stringify(domain.resourceRoot + '/reference.txt')},'bad')}catch(e){readonly=e.code}
    return{codes,readonly,resource:fs.readFileSync(${JSON.stringify(domain.resourceRoot + '/reference.txt')},'utf8'),
      content:fs.readFileSync(${JSON.stringify(workspace + '/Workflow.txt')},'utf8'),environment:p.env.PAIMIND_PRIVATE_CANARY??null};`)
  assert.deepEqual(isolation, { stopReason: 'completed', agentsStarted: 0, value: {
    codes: ['ENOENT', 'ENOENT'], readonly: 'EROFS', resource: 'Hansen reference', content: 'Hansen workflow', environment: null } })
  assert.equal(await readFile(`${privateRoot}/private-canary`, 'utf8'), 'controller-only')
  assert.equal(await readFile(`${alex}/Alex.txt`, 'utf8'), 'Alex-only')
  const readonly = new Context()
  try {
    await setup(readonly, 'read-only')
    const denied = await run(`${helperAuthority}try{fs.writeFileSync(${JSON.stringify(workspace + '/Workflow.txt')},'bad');return'EXPOSED'}catch(e){return e.code}`, readonly)
    assert.equal(denied.value, 'EROFS')
  } finally { await readonly.fiber.dispose() }
  assert.equal(await readFile(`${workspace}/Workflow.txt`, 'utf8'), 'Hansen workflow')
  assert.equal((await run('globalThis.perRunSecret="Hansen";return true')).value, true)
  assert.equal((await run('return typeof globalThis.perRunSecret')).value, 'undefined')
  passed('actual-vm-escape-stays-inside-member-readonly-and-private-boundaries')

  assert.equal((await run('while(true){}')).stopReason, 'error')
  const marker = `hansen-workflow-descendant-${Date.now()}`
  const ready = Promise.withResolvers()
  const release = root.on('workflow/log', (_info, value) => { if (value === marker) ready.resolve() })
  const handle = root.workflowEngine.start({ meta, parent, script: `${helperAuthority}
    const cp=p.getBuiltinModule('node:child_process');
    cp.spawn(p.execPath,['-e','setInterval(()=>{},1000)',${JSON.stringify(marker)}],{detached:true,stdio:'ignore'}).unref();
    log(${JSON.stringify(marker)});await new Promise(()=>{});` })
  try {
    await Promise.race([ready.promise, delay(5000, undefined, { ref: false }).then(() => { throw Error('Workflow child was not observed') })])
    assert.ok((await pids(marker)).length > 0)
    handle.cancel('Hansen stopped'); assert.equal((await handle.result).stopReason, 'cancelled'); await handle.dispose()
    assert.deepEqual(await pids(marker), [])
  } finally { release(); await handle.dispose() }
  const normalMarker = `hansen-workflow-completed-descendant-${Date.now()}`
  assert.equal((await run(`${helperAuthority}p.getBuiltinModule('node:child_process').spawn(p.execPath,
    ['-e','setInterval(()=>{},1000)',${JSON.stringify(normalMarker)}],{detached:true,stdio:'ignore'}).unref();return true;`)).value, true)
  assert.deepEqual(await pids(normalMarker), [])
  passed('native-sync-timeout-and-joined-process-trees-after-cancel-and-completion')

  const hostile = await run(`${helperAuthority}fs.writeSync(1,${JSON.stringify('invalid workflow pipe\n')});await new Promise(()=>{});`)
  assert.equal(hostile.stopReason, 'error')
  assert.equal((await run('return "controller remains usable"')).value, 'controller remains usable')
  const retained = root.workflowEngine
  await root.fiber.dispose()
  assert.throws(() => retained.start({ meta, parent, script: 'return true' }), /withdrawn/)
  passed('hostile-pipe-rejected-and-retained-start-authority-withdrawn')
} finally { await root.fiber.dispose() }
console.log(JSON.stringify({ status: 'NATIVE_WORKFLOW_PROCESS_SLICE_PASSED', checks,
  nativeWorkflowProcessSliceVerified: true, realNativeChildProviderVerified: false, nativeWorkflowFullProfileVerified: false,
  memberAdmissionVerified: false, browserE2EVerified: false, finalWorkerImageAccepted: false }))
