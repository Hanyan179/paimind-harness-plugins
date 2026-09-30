import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createPreparedExecutionDomain } from '/usr/local/lib/paimind/confine-execution.mjs'
import { readPreparedStorageLayout, verifyPreparedStorageMounts } from '/usr/local/lib/paimind/prepared-storage.mjs'

// Inside the same descriptor-mounted runtime layout used by the deployment.
// Real native providers, synthetic files; no member/model/browser acceptance.
const workspace = process.cwd(); const project = workspace + '/client-project'
const nested = project + '/team/nested-project'; const history = workspace + '/history-project'
const layout = readPreparedStorageLayout(process.argv[2], workspace)
const scopes = verifyPreparedStorageMounts(layout)
assert.equal(scopes.length, 4)
const preparedDomain = createPreparedExecutionDomain(workspace, scopes)
const denials = []
const domain = { ...preparedDomain, prepare(request) {
  try { return preparedDomain.prepare(request) }
  catch (error) { denials.push({ root: request.workspaceRoot, message: error.message }); throw error }
} }
for (const path of [domain.temporaryRoot, domain.resourceRoot]) await mkdir(path, { recursive: true, mode: 0o700 })
const require = createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
const { bootManagedHarnessProfile } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-runtime')).href)
let root
const checks = {}
try {
  const { prepareNativeStorage } = await import('/usr/local/lib/paimind/prepare-native-storage.mjs')
  await assert.rejects(prepareNativeStorage({ memberRoot: workspace,
    storageRoot: '/var/lib/paimind/storage-generations', env: { ...process.env }, sourceGeneration: process.argv[2] }),
  /wrong write policy/)
  checks.writableSourceCannotClaimReadOnlyPreparation = true
  root = await bootManagedHarnessProfile({ runtimeRoot: '/opt/paimind', profileHome: '/usr/share/paimind/managed',
    profileName: 'web', installationManifest: '/opt/paimind/node_modules/@deepseek-ai/dsh/package.json',
    args: ['--host', '127.0.0.1', '--port', '3210', '--no-open'], environment: { ...process.env },
    executionDomain: domain, toolGuard: () => 'candidate-not-admitted', prepare: context => { root = context },
    requestExit: () => { throw Error('Unexpected native exit') },
  })
  async function command(program, writeRoot = workspace) {
    const argv = root.sandbox.confine(['/usr/local/bin/node', '--input-type=module', '-e', program],
      { mode: 'workspace-write', workspaceRoot: writeRoot }).argv
    const handle = root.subprocess.spawn({ argv, cwd: workspace, graceMs: 200,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: { maxBytes: 8192 } } })
    try {
      assert.equal((await handle.done).exitCode, 0, handle.collected.stderr.readFrom(0).text)
      await handle.waitForExit(); return JSON.parse(handle.collected.stdout.readFrom(0).text)
    } finally { handle.terminate(); await handle.waitForExit() }
  }
  const target = await root.fs.resolve(project + '/native-mounted.txt')
  const created = await root.fs.writeText(target, 'native mounted data', { kind: 'createIfAbsent' })
  assert.equal(created.operation, 'create')
  const code = await root.codeRuntime.run({ bindings: [], program: `
    const fs=await import('node:fs/promises');const content=await fs.readFile(${JSON.stringify(target.path ?? project + '/native-mounted.txt')},'utf8');
    await fs.writeFile(${JSON.stringify(project + '/code-mounted.txt')}, 'code mounted data');return content;` })
  assert.equal(code.value, 'native mounted data')
  checks.nativeFileCodeAndCommandShareMounts = (await command(`import{readFile}from'node:fs/promises';
    console.log(JSON.stringify(await readFile('${project}/code-mounted.txt','utf8')))`)) === 'code mounted data'
  const alias = await command(`import{writeFile,readFile,link,stat}from'node:fs/promises';
    await writeFile('${nested}/old-parent-alias.txt','nested-only-change');await writeFile('${nested}/notes-alias.txt','nested-legal-change');
    let cross;try{await link('${project}/customer.txt','${nested}/new-cross');cross='ALLOWED'}catch(e){cross=e.code}
    console.log(JSON.stringify({parent:await readFile('${project}/customer.txt','utf8'),legal:await readFile('${nested}/notes.txt','utf8'),cross}));`, nested)
  checks.nestedExistingAliasSeparated = alias.parent === 'prepared project change'
  checks.nestedLegalLinksPreserved = alias.legal === 'nested-legal-change'
  checks.newCrossScopeLinkRejected = alias.cross === 'EXDEV'
  checks.otherPreparedProjectUnchanged = await readFile(history + '/old-project-alias.txt', 'utf8') === 'Hansen customer original'

  // A native session can name a new cwd; execution must not inherit the parent
  // scope's write grant just because the path is a descendant of that scope.
  const unprepared = project + '/unprepared-session'
  const sessionId = 'Hansen-unprepared-storage-root'
  for (const [method, payload] of [
    ['session.create', { sessionId, cwd: unprepared, agentPreset: 'standard' }],
    ['session.rename', { sessionId, title: 'Hansen awaiting storage preparation' }],
  ]) {
    const reply = await fetch('http://127.0.0.1:3210/api/' + method, { method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3210' },
      body: JSON.stringify({ type: 'client-request', rpcId: method, method, payload }) })
    assert.equal(reply.status, 200); assert.equal((await reply.json()).result.ok, true)
  }
  const agent = root.agents.get(sessionId); assert.ok(agent)
  assert.equal(agent.session.header.cwd, unprepared)
  await assert.rejects(command("console.log('{}')", agent.session.header.cwd), /has not been prepared/)
  const denied = await root.fs.resolve(unprepared + '/must-not-exist.txt')
  await assert.rejects(root.fs.writeText(denied, 'must-not-write', { kind: 'createIfAbsent' }, undefined,
    { mode: 'workspace-write', workspaceRoot: agent.session.header.cwd }), /has not been prepared/)
  let scopedCodeChecked = false
  await agent.ctx.inject(['sandboxPolicy', 'codeRuntime'], async context => {
    const scopedPolicy = context.sandboxPolicy.resolve({ session: agent.session })
    assert.equal(scopedPolicy.workspaceRoot, unprepared)
    const before = denials.length
    const deniedCode = await root.agents.withInitiator(agent, () => context.codeRuntime.run({ bindings: [], program: 'return 42' }))
    assert.equal(deniedCode.error?.kind, 'worker-exit'); assert.equal(deniedCode.value, undefined)
    assert.equal(denials.length, before + 1)
    assert.equal(denials.at(-1).root, unprepared); assert.match(denials.at(-1).message, /has not been prepared/)
    scopedCodeChecked = true
  })
  assert.equal(scopedCodeChecked, true)
  await assert.rejects(stat(unprepared + '/must-not-exist.txt'), { code: 'ENOENT' })
  checks.nativeNewSessionProcessFileCodeWritesRejected = true
  const workflow = root.agentPresets.serviceFor(agent, 'workflowEngine'); assert.ok(workflow)
  assert.throws(() => workflow.start({ parent: agent, meta: { name: 'unprepared', description: 'Unprepared native scope', phases: [{ title: 'Check' }] },
    script: 'return 42' }), /has not been prepared/)
  checks.nativeNewSessionWorkflowRejected = true

  // The already-authorized parent scope can contain files and aliases before
  // this new narrower Session root is prepared. The next generation must copy
  // these latest bytes and separate its cross-scope alias, not restore old data.
  await command(`import{writeFile,link}from'node:fs/promises';
    await writeFile('${unprepared}/draft.txt','Hansen latest draft');
    await link('${unprepared}/draft.txt','${unprepared}/draft-alias.txt');
    await link('${project}/customer.txt','${unprepared}/old-parent-alias.txt');console.log('{}');`, project)

  // Capture a launch first, then move an unmounted ancestor containing a
  // mounted nested root and recreate its old spelling. Rechecking in JS alone
  // would miss this interval; the actual opened descriptor must reject it.
  const captured = domain.prepare({ kind: 'process', fileAccess: 'workspace-write', workspaceRoot: nested,
    cwd: workspace, env: {}, argv: ['/usr/local/bin/node', '-e', `require('fs').writeFileSync('${nested}/victim.txt','ESCAPED')`] })
  await command(`import{rename,mkdir,writeFile}from'node:fs/promises';await rename('${project}/team','${project}/team-moved');
    await mkdir('${nested}',{recursive:true});await writeFile('${nested}/victim.txt','keep');console.log('{}');`)
  const processEnv = { ...process.env, ...captured.env }
  for (const [key, value] of Object.entries(processEnv)) if (value === undefined) delete processEnv[key]
  const child = spawn(captured.argv[0], captured.argv.slice(1), { cwd: captured.cwd, env: processEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes }); child.stdout.resume()
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) })
  assert.deepEqual(exit, { code: 125, signal: null }); assert.match(stderr, /prepared directory identity changed/)
  assert.equal(await readFile(nested + '/victim.txt', 'utf8'), 'keep')
  checks.replacedRootRejectedAfterProjection = true
  await command(`import{rm,rename}from'node:fs/promises';await rm('${project}/team',{recursive:true});
    await rename('${project}/team-moved','${project}/team');console.log('{}');`)
  assert.deepEqual(verifyPreparedStorageMounts(layout), scopes)
  checks.restoredMountStillUsable = (await command(`import{readFile}from'node:fs/promises';console.log(JSON.stringify(await readFile('${nested}/notes.txt','utf8')))`, nested)) === 'nested-legal-change'
  console.log(JSON.stringify({ preparedNativeRuntimeVerified: true, checks, nativeNewSessionRequests: 2,
    workflowNewRootGateVerified: true, memberAdmissionVerified: false, browserE2EVerified: false }))
  assert.ok(Object.values(checks).every(value => value === true))
} finally { await root?.fiber.dispose() }
