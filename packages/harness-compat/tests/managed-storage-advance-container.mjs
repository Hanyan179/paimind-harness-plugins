import assert from 'node:assert/strict'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readPreparedStorageLayout, verifyPreparedStorageMounts } from '/usr/local/lib/paimind/prepared-storage.mjs'
import { createPreparedExecutionDomain } from '/usr/local/lib/paimind/confine-execution.mjs'

// Real original providers after advancing a stopped cell's coherent layout.
// This is not a gateway binding, model reply or browser/member acceptance.
const workspace = process.cwd(), project = workspace + '/client-project'
const newRoot = project + '/unprepared-session', nested = project + '/team/nested-project'
const layout = readPreparedStorageLayout(process.argv[2], workspace)
const scopes = verifyPreparedStorageMounts(layout); assert.equal(scopes.length, 5)
const domain = createPreparedExecutionDomain(workspace, scopes)
const require = createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
const { bootManagedHarnessProfile } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-runtime')).href)
const checks = {}; let root
try {
  root = await bootManagedHarnessProfile({ runtimeRoot: '/opt/paimind', profileHome: '/usr/share/paimind/managed',
    profileName: 'web', installationManifest: '/opt/paimind/node_modules/@deepseek-ai/dsh/package.json',
    args: ['--host', '127.0.0.1', '--port', '3210', '--no-open'], environment: { ...process.env },
    executionDomain: domain, toolGuard: () => 'candidate-not-admitted', prepare: value => { root = value },
    requestExit: () => { throw Error('Unexpected native exit') } })
  for (const [path, value] of [[project + '/native-mounted.txt', 'native mounted data'],
    [project + '/code-mounted.txt', 'code mounted data'], [nested + '/notes.txt', 'nested-legal-change'],
    [newRoot + '/draft.txt', 'Hansen latest draft']]) assert.equal(await readFile(path, 'utf8'), value)
  checks.latestPreparedWritesPreserved = true
  const identity = async path => { const s = await stat(path); return `${s.dev}:${s.ino}` }
  assert.equal(await identity(newRoot + '/draft.txt'), await identity(newRoot + '/draft-alias.txt'))
  assert.notEqual(await identity(project + '/customer.txt'), await identity(newRoot + '/old-parent-alias.txt'))
  checks.newRootAliasesSeparatedAndInternalLinksPreserved = true
  const sessionId = 'Hansen-unprepared-storage-root'
  const before = await root.sessionPersistence.inspect(sessionId)
  assert.equal(before.meta.cwd, newRoot)
  assert.ok(JSON.stringify(before.events).includes('Hansen awaiting storage preparation'))
  // session.create with the existing identity uses the original persistence
  // resume path, including preset composition and cwd conflict validation.
  const method = 'session.create', rpcId = 'resume-prepared-native-session'
  const response = await fetch('http://127.0.0.1:3210/api/' + method, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3210' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { sessionId, cwd: newRoot, agentPreset: 'standard' } }) })
  assert.equal(response.status, 200); assert.equal((await response.json()).result.ok, true)
  const agent = root.agents.get(sessionId); assert.ok(agent); assert.equal(agent.session.header.cwd, newRoot)
  assert.equal(agent.id, sessionId); checks.originalSessionIdentityAndHistoryResumed = true
  const listResponse = await fetch('http://127.0.0.1:3210/api/workspace.list', { method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3210' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'advanced-workspace-readback', method: 'workspace.list', payload: {} }) })
  assert.equal(listResponse.status, 200)
  const listed = (await listResponse.json()).result; assert.equal(listed.ok, true)
  assert.ok(listed.value.items.some(row => row.workspaceId === process.argv[3] && row.path === project))
  assert.ok(listed.value.archivedSessionIds.includes(process.argv[4]))
  checks.originalWorkspaceAndArchivePreserved = true
  const policy = { mode: 'workspace-write', workspaceRoot: agent.session.header.cwd }
  const target = await root.fs.resolve(newRoot + '/native-now-ready.txt')
  const write = await root.fs.writeText(target, 'native new root data', { kind: 'createIfAbsent' }, undefined, policy)
  assert.equal(write.operation, 'create')
  await agent.ctx.inject(['codeRuntime'], async ctx => {
    const result = await root.agents.withInitiator(agent, () => ctx.codeRuntime.run({ bindings: [], program:
      `const fs=await import('node:fs/promises');await fs.writeFile('${newRoot}/code-now-ready.txt','code new root data');return await fs.readFile('${newRoot}/native-now-ready.txt','utf8')` }))
    assert.equal(result.error, undefined); assert.equal(result.value, 'native new root data')
  })
  const confined = root.sandbox.confine(['/usr/local/bin/node', '--input-type=module', '-e',
    `import{readFile,writeFile}from'node:fs/promises';await writeFile('${newRoot}/draft-alias.txt','new scope change');console.log(JSON.stringify(await readFile('${newRoot}/code-now-ready.txt','utf8')))`], policy)
  const handle = root.subprocess.spawn({ argv: confined.argv, cwd: workspace, graceMs: 200,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } } })
  try {
    assert.equal((await handle.done).exitCode, 0, handle.collected.stderr.readFrom(0).text)
    await handle.waitForExit(); assert.equal(JSON.parse(handle.collected.stdout.readFrom(0).text), 'code new root data')
  } finally { handle.terminate(); await handle.waitForExit() }
  assert.equal(await readFile(newRoot + '/draft.txt', 'utf8'), 'new scope change')
  assert.equal(await readFile(project + '/customer.txt', 'utf8'), 'prepared project change')
  checks.resumedSessionFileCodeProcessCanUseNewRoot = true
  const engine = root.agentPresets.serviceFor(agent, 'workflowEngine'); assert.ok(engine)
  const workflow = engine.start({ parent: agent, meta: { name: 'prepared', description: 'Prepared native scope', phases: [{ title: 'Check' }] }, script: 'return 42' })
  try { assert.deepEqual(await workflow.result, { value: 42, stopReason: 'completed', agentsStarted: 0 }) }
  finally { await workflow.dispose() }
  checks.resumedSessionWorkflowCanExecute = true
  console.log(JSON.stringify({ advancedNativeStorageRuntimeVerified: true, checks,
    nativeResumeRequests: 1, memberAdmissionVerified: false, browserE2EVerified: false }))
} finally { await root?.fiber.dispose() }
