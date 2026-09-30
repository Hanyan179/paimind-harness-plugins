import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { readActiveStorageGeneration } from '/usr/local/lib/paimind/active-storage.mjs'
import { readPreparedStorageLayout } from '/usr/local/lib/paimind/prepared-storage.mjs'

// New container, same named data volume, actual production start entry.
// This diagnostic has no gateway/member grant, model or browser acceptance.
const workspace = '/var/lib/paimind/workspace'
const generation = readActiveStorageGeneration(workspace)
assert.equal(generation, process.argv[2])
const layout = readPreparedStorageLayout(generation, workspace)
const target = path => layout.scopes.find(row => row.path === path).storagePath
const project = workspace + '/client-project', newRoot = project + '/unprepared-session'
const nested = project + '/team/nested-project'
for (const [path, suffix, value] of [[project, '/native-mounted.txt', 'native mounted data'],
  [project, '/code-mounted.txt', 'code mounted data'], [nested, '/notes.txt', 'nested-legal-change'],
  [newRoot, '/draft.txt', 'new scope change'], [newRoot, '/native-now-ready.txt', 'native new root data'],
  [newRoot, '/code-now-ready.txt', 'code new root data']]) assert.equal(await readFile(target(path) + suffix, 'utf8'), value)
const identity = async path => { const s = await stat(path); return `${s.dev}:${s.ino}` }
assert.equal(await identity(target(newRoot) + '/draft.txt'), await identity(target(newRoot) + '/draft-alias.txt'))
assert.notEqual(await identity(target(project) + '/customer.txt'), await identity(target(newRoot) + '/old-parent-alias.txt'))
const env = { ...process.env, HOME: '/var/lib/paimind/home', DSH_HOME: '/var/lib/paimind/dsh-home' }
const child = spawn('/usr/local/bin/node', ['/usr/local/lib/paimind/start-native-runtime.mjs', '--run-active-storage'],
  { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''; let finished
child.stdout.on('data', bytes => { output += bytes }); child.stderr.on('data', bytes => { output += bytes })
const joined = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { finished = { code, signal }; resolve(finished) }) })
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal))
const timeout = setTimeout(() => child.kill('SIGKILL'), 30_000)
try {
  for (;;) {
    const ready = output.split('\n').map(line => { try { return JSON.parse(line) } catch { return {} } })
      .find(row => row.event === 'managed-native-profile-ready')
    if (ready) {
      assert.equal(ready.storageMounted, true); assert.equal(ready.unpreparedExecutionRootGateActive, true)
      assert.equal(ready.nativeToolGuardActive, true); assert.equal(ready.memberAdmissionVerified, false); break
    }
    assert.equal(finished, undefined, output)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  clearTimeout(timeout)
  async function rpc(method, payload) {
    const response = await fetch('http://127.0.0.1:3210/api/' + method, { method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3210' },
      body: JSON.stringify({ type: 'client-request', rpcId: method, method, payload }), signal: AbortSignal.timeout(10_000) })
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.result.ok, true)
    return body.result.value
  }
  const listed = await rpc('workspace.list', {})
  assert.ok(listed.items.some(row => row.workspaceId === process.argv[3] && row.path === project))
  assert.ok(listed.archivedSessionIds.includes(process.argv[4]))
  await rpc('session.create', { sessionId: 'Hansen-unprepared-storage-root', cwd: newRoot, agentPreset: 'standard' })
  assert.equal(readActiveStorageGeneration(workspace), generation)
  console.log(JSON.stringify({ storageReplacementReady: true, generation, actualActiveEntryVerified: true,
    latestFilesAndLinkBoundariesPreserved: true, nativeWorkspaceArchiveAndSessionResumed: true,
    nativeRequests: 2, memberAdmissionVerified: false, browserE2EVerified: false }))
  const result = await joined
  process.stdout.write(output); assert.deepEqual(result, { code: 0, signal: null }, output)
  console.log(JSON.stringify({ storageReplacementClosed: true, actualNativeShutdownJoined: true }))
} finally {
  clearTimeout(timeout)
  if (!finished) { child.kill('SIGKILL'); await joined }
}
