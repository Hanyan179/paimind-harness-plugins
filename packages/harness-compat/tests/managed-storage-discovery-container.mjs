import assert from 'node:assert/strict'
import { chmod, link, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createCandidateExecutionDomain } from '/usr/local/lib/paimind/confine-execution.mjs'

// Real native HTTP/registry/session-persistence recovery, not Browser E2E and
// not a dynamic mount operator. All data is synthetic in this disposable cell.
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 10001)
const runStorage = process.argv[2] === '--run-storage'
const workspace = runStorage ? '/var/lib/paimind/workspace' : '/var/lib/paimind/workspaces/hansen'
const project = workspace + '/client-project'; const nested = project + (runStorage ? '/team' : '') + '/nested-project'
const history = workspace + '/history-project'
const prepareStorage = process.argv[2] === '--prepare-storage' || runStorage
const privateHome = '/var/lib/paimind/dsh-home'
const domain = createCandidateExecutionDomain(workspace)
for (const dir of [workspace, project, nested, history, privateHome, '/var/lib/paimind/home', domain.temporaryRoot, domain.resourceRoot]) {
  await mkdir(dir, { recursive: true, mode: 0o700 })
}
await writeFile(history + '/keep.txt', 'Hansen history bytes')
if (prepareStorage) {
  await writeFile(project + '/customer.txt', 'Hansen customer original')
  await link(project + '/customer.txt', project + '/customer-alias.txt')
  await link(project + '/customer.txt', nested + '/old-parent-alias.txt')
  await link(project + '/customer.txt', history + '/old-project-alias.txt')
  await writeFile(nested + '/notes.txt', 'Hansen nested notes')
  await link(nested + '/notes.txt', nested + '/notes-alias.txt')
}
process.chdir(workspace)
process.env.HOME = '/var/lib/paimind/home'; process.env.DSH_HOME = privateHome
process.env.NODE_ENV = 'production'; process.env.DSH_TELEMETRY_MODE = 'DISABLED'
const require = createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
const { bootManagedHarnessProfile, readManagedHarnessStorageScopes } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-runtime')).href)
const requests = []
async function rpc(method, payload) {
  const rpcId = randomUUID()
  const response = await fetch('http://127.0.0.1:3210/api/' + method, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3210' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }), signal: AbortSignal.timeout(10_000) })
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body))
  assert.equal(body.rpcId, rpcId); assert.equal(body.result.ok, true, JSON.stringify(body))
  requests.push({ method, rpcId, accepted: true })
  return body.result.value
}
let root
let liveSnapshot
const ids = {}
try {
  root = await bootManagedHarnessProfile({ runtimeRoot: '/opt/paimind', profileHome: '/usr/share/paimind/managed',
    profileName: 'web', installationManifest: '/opt/paimind/node_modules/@deepseek-ai/dsh/package.json',
    args: ['--host', '127.0.0.1', '--port', '3210', '--no-open'],
    environment: Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')),
    executionDomain: domain, toolGuard: () => 'candidate-not-admitted',
    requestExit: () => { throw Error('Unexpected native exit') }, prepare: context => { root = context },
  })
  const initial = await readManagedHarnessStorageScopes(root, workspace)
  assert.deepEqual(initial.scopes, [{ path: workspace, availability: 'present', workspaceIds: [], sessionIds: [] }])
  for (const [name, path] of Object.entries({ project, nested, history })) {
    const created = await rpc('workspace.create', { path }); assert.equal(created.created, true)
    ids[name] = { workspaceId: created.workspace.workspaceId, sessionId: `Hansen-storage-${name}-${randomUUID()}` }
    await rpc('session.create', { workspaceId: ids[name].workspaceId, sessionId: ids[name].sessionId, agentPreset: 'standard' })
    await rpc('session.rename', { sessionId: ids[name].sessionId, title: `Hansen ${name} notes` })
  }
  // Native deletion removes registration only; native archived sessions also
  // remain recoverable. Neither may disappear from the storage root inventory.
  await rpc('workspace.delete', { workspaceId: ids.history.workspaceId })
  await rpc('workspace.archiveSession', { sessionId: ids.nested.sessionId })
  const listed = await rpc('workspace.list', {})
  assert.ok(!listed.items.some(row => row.workspaceId === ids.history.workspaceId))
  assert.ok(listed.archivedSessionIds.includes(ids.nested.sessionId))
  liveSnapshot = await readManagedHarnessStorageScopes(root, workspace)
  const row = path => liveSnapshot.scopes.find(scope => scope.path === path)
  assert.deepEqual(row(project).workspaceIds, [ids.project.workspaceId])
  assert.deepEqual(row(nested).sessionIds, [ids.nested.sessionId])
  assert.deepEqual(row(history).workspaceIds, [])
  assert.deepEqual(row(history).sessionIds, [ids.history.sessionId])
  assert.equal(await readFile(history + '/keep.txt', 'utf8'), 'Hansen history bytes')
} finally { await root?.fiber.dispose() }

// Exercise the deployment's actual operator-only discovery entry point after
// the native owner flushed and joined. This process starts from cold headers.
const child = spawn('/usr/local/bin/node', ['/usr/local/lib/paimind/boot-native-runtime.mjs', '--inspect-storage'],
  { cwd: workspace, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
let stdout = ''; let stderr = ''
child.stdout.on('data', bytes => { stdout += bytes }); child.stderr.on('data', bytes => { stderr += bytes })
const timeout = setTimeout(() => child.kill('SIGKILL'), 30_000)
try {
  const exit = await new Promise((done, reject) => { child.once('error', reject); child.once('close', (code, signal) => done({ code, signal })) })
  assert.deepEqual(exit, { code: 0, signal: null }, stdout + stderr)
  const receipt = stdout.split('\n').map(line => { try { return JSON.parse(line) } catch { return {} } })
    .find(row => row.event === 'native-storage-discovery')
  assert.ok(receipt, stdout + stderr); assert.equal(receipt.storagePrepared, false); assert.equal(receipt.memberAdmissionVerified, false)
  assert.deepEqual(receipt.snapshot, liveSnapshot, 'Cold native owners must recover the same workspace and history-only scopes')
  assert.equal(await readFile(history + '/keep.txt', 'utf8'), 'Hansen history bytes')
  console.log(JSON.stringify({ nativeStorageDiscoveryVerified: true, originalHttpRequests: requests,
    originalOwnersOnly: true, liveSnapshot, coldSnapshot: receipt.snapshot, coldLog: stdout + stderr,
    dynamicNativeWorkspaceProvisioningVerified: false, memberAdmissionVerified: false, browserE2EVerified: false }))
} finally { clearTimeout(timeout) }

if (prepareStorage) {
  // Exercise the same offline operation shipped by start-native-runtime's
  // explicit --prepare-storage command. It boots/discovers/joins its own cold
  // native process before invoking real GNU cp, not a mocked copy service.
  const { prepareNativeStorage, runStoragePreparationProcess } = await import('/usr/local/lib/paimind/prepare-native-storage.mjs')
  const storageRoot = '/var/lib/paimind/storage-generations'
  await mkdir(storageRoot, { mode: 0o700 })
  const options = { memberRoot: workspace, storageRoot, env: { ...process.env } }
  const first = prepareNativeStorage(options)
  // Wait only for the private lock, never a guessed native boot duration.
  for (let round = 0; ; round++) {
    try { await lstat(storageRoot + '/.prepare-lock'); break }
    catch (error) { assert.equal(error.code, 'ENOENT'); assert.ok(round < 100); await new Promise(done => setTimeout(done, 10)) }
  }
  await assert.rejects(prepareNativeStorage(options), { code: 'EEXIST' })
  const prepared = await first
  assert.equal(prepared.nativeDiscoveryJoined, true)
  assert.equal(prepared.storageMounted, false); assert.equal(prepared.memberAdmissionVerified, false)
  assert.deepEqual(prepared.layout.scopes.map(row => ({ path: row.path, availability: row.availability })),
    liveSnapshot.scopes.map(row => ({ path: row.path, availability: row.availability })))
  const manifest = JSON.parse(await readFile(prepared.generation + '/layout.json', 'utf8'))
  assert.deepEqual(manifest, prepared.layout)
  for (const row of manifest.scopes) {
    assert.deepEqual(Object.keys(row).sort(), ['availability', 'path', 'storagePath'])
    assert.ok(!JSON.stringify(manifest).includes(ids.project.workspaceId))
  }
  const target = path => manifest.scopes.find(row => row.path === path).storagePath
  const fileIdentity = async path => { const stat = await lstat(path); return `${stat.dev}:${stat.ino}` }
  const copiedProject = target(project); const copiedNested = target(nested); const copiedHistory = target(history)
  assert.equal(await fileIdentity(copiedProject + '/customer.txt'), await fileIdentity(copiedProject + '/customer-alias.txt'))
  assert.equal(await fileIdentity(copiedNested + '/notes.txt'), await fileIdentity(copiedNested + '/notes-alias.txt'))
  assert.notEqual(await fileIdentity(copiedProject + '/customer.txt'), await fileIdentity(copiedNested + '/old-parent-alias.txt'))
  assert.notEqual(await fileIdentity(copiedProject + '/customer.txt'), await fileIdentity(copiedHistory + '/old-project-alias.txt'))
  assert.notEqual(await fileIdentity(project + '/customer.txt'), await fileIdentity(copiedProject + '/customer.txt'))
  await writeFile(copiedProject + '/customer-alias.txt', 'prepared project change')
  assert.equal(await readFile(copiedProject + '/customer.txt', 'utf8'), 'prepared project change')
  for (const path of [project + '/customer.txt', copiedNested + '/old-parent-alias.txt', copiedHistory + '/old-project-alias.txt']) {
    assert.equal(await readFile(path, 'utf8'), 'Hansen customer original')
  }
  await assert.rejects(lstat(storageRoot + '/.prepare-lock'), { code: 'ENOENT' })

  // The next native discovery still succeeds, but a real unreadable source
  // makes GNU cp fail. The old complete generation and source bytes survive;
  // partial output remains recoverable and is not a mount/admission receipt.
  const unreadable = workspace + '/unreadable-diagnostic.txt'
  await writeFile(unreadable, 'keep on failed preparation', { mode: 0o000 })
  const before = await readdir(storageRoot)
  await assert.rejects(prepareNativeStorage(options), /original data retained; partial generation/)
  const added = (await readdir(storageRoot)).filter(name => !before.includes(name))
  assert.equal(added.length, 1); assert.ok(added[0].startsWith('unpublished-'))
  await assert.rejects(lstat(storageRoot + '/' + added[0] + '/layout.json'), { code: 'ENOENT' })
  await chmod(unreadable, 0o600)
  assert.equal(await readFile(unreadable, 'utf8'), 'keep on failed preparation')
  assert.equal(await readFile(project + '/customer.txt', 'utf8'), 'Hansen customer original')
  assert.deepEqual(JSON.parse(await readFile(prepared.generation + '/layout.json', 'utf8')), manifest)
  assert.equal(await readFile(copiedProject + '/customer.txt', 'utf8'), 'prepared project change')
  await assert.rejects(lstat(storageRoot + '/.prepare-lock'), { code: 'ENOENT' })
  console.log(JSON.stringify({ nativeOfflineStoragePreparationVerified: true, nativeDiscoveryJoined: true,
    sourceScopes: liveSnapshot.scopes.length, originalHttpRequests: requests.length,
    sameScopeHardlinksPreserved: true, crossScopeExistingAliasesSeparated: true,
    sourceDataUnchanged: true, concurrentPreparationRejected: true,
    failedCopyLeavesOriginalAndPriorGeneration: true, failedCopyHasNoLayoutReceipt: true,
    preparedLayout: manifest, partialGeneration: storageRoot + '/' + added[0],
    storageMounted: false, dynamicNativeWorkspaceProvisioningVerified: false,
    memberAdmissionVerified: false, browserE2EVerified: false }))

  if (runStorage) {
    const { openPreparedStorageLaunch, readPreparedStorageLayout } = await import('/usr/local/lib/paimind/prepared-storage.mjs')
    const launch = openPreparedStorageLaunch(readPreparedStorageLayout(prepared.generation, workspace))
    const mounted = spawn(launch.argv[0], [...launch.argv.slice(1), '/usr/local/bin/node',
      '/usr/local/lib/paimind/storage-runtime-check.mjs', prepared.generation],
    { cwd: '/', env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe', ...launch.fds] })
    launch.close()
    let output = ''; mounted.stdout.on('data', bytes => { output += bytes }); mounted.stderr.on('data', bytes => { output += bytes })
    const exit = await new Promise((resolve, reject) => { mounted.once('error', reject); mounted.once('close', (code, signal) => resolve({ code, signal })) })
    process.stdout.write(output); assert.deepEqual(exit, { code: 0, signal: null }, output)

    // Now execute the actual deployment runner and bootstrap, not the custom
    // verification program. The same prepared files must survive a new mount
    // namespace and cold native process; its private operator lock stays held.
    const actual = spawn('/usr/local/bin/node', ['/usr/local/lib/paimind/start-native-runtime.mjs', '--run-storage', prepared.generation],
      { cwd: workspace, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let actualLog = ''; actual.stdout.on('data', bytes => { actualLog += bytes }); actual.stderr.on('data', bytes => { actualLog += bytes })
    const joined = new Promise((resolve, reject) => { actual.once('error', reject); actual.once('close', (code, signal) => resolve({ code, signal })) })
    let actualExit
    const deadline = setTimeout(() => actual.kill('SIGKILL'), 30_000)
    try {
      for (let round = 0; ; round++) {
        const ready = actualLog.split('\n').map(line => { try { return JSON.parse(line) } catch { return {} } })
          .find(row => row.event === 'managed-native-profile-ready')
        if (ready) {
          assert.equal(ready.storageMounted, true); assert.equal(ready.unpreparedExecutionRootGateActive, true)
          assert.equal(ready.nativeToolGuardActive, true); assert.equal(ready.memberAdmissionVerified, false); break
        }
        assert.ok(actual.exitCode === null && actual.signalCode === null && round < 150, actualLog)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      await assert.rejects(prepareNativeStorage(options), { code: 'EEXIST' })
      await assert.rejects(runStoragePreparationProcess('/usr/local/bin/node',
        ['/usr/local/lib/paimind/start-native-runtime.mjs', '--activate-storage', prepared.generation, 'none'],
        { cwd: workspace, env: { ...process.env } }), /did not close successfully/)
      const beforeConcurrent = await readdir(storageRoot)
      await assert.rejects(runStoragePreparationProcess('/usr/local/bin/node',
        ['/usr/local/lib/paimind/start-native-runtime.mjs', '--prepare-storage-from', prepared.generation],
        { cwd: workspace, env: { ...process.env } }), /did not close successfully/)
      assert.deepEqual(await readdir(storageRoot), beforeConcurrent)
      const restored = await rpc('workspace.list', {})
      assert.ok(restored.items.some(row => row.workspaceId === ids.project.workspaceId))
      assert.ok(restored.archivedSessionIds.includes(ids.nested.sessionId))
      assert.equal(await readFile(copiedProject + '/native-mounted.txt', 'utf8'), 'native mounted data')
      assert.equal(await readFile(copiedProject + '/code-mounted.txt', 'utf8'), 'code mounted data')
      assert.equal(await readFile(copiedNested + '/notes.txt', 'utf8'), 'nested-legal-change')
      actual.kill('SIGTERM'); actualExit = await joined
      assert.deepEqual(actualExit, { code: 0, signal: null }, actualLog)
      await assert.rejects(lstat(storageRoot + '/.prepare-lock'), { code: 'ENOENT' })
      console.log(JSON.stringify({ actualPreparedRunnerBootAndShutdownVerified: true,
        coldNativeWorkspaceAndArchivePreserved: true, samePreparedGenerationWritesPreserved: true,
        preparationRejectedWhileRuntimeActive: true, actualExit, actualLog,
        containerReplacementPersistenceVerified: false, memberAdmissionVerified: false, browserE2EVerified: false }))
    } finally {
      clearTimeout(deadline)
      if (!actualExit) { actual.kill('SIGKILL'); await joined }
    }

    // The actual old runtime has joined. Update from its latest mounted view,
    // never from the stale original directory outside that namespace.
    const beforeUnmountedClaim = await readdir(storageRoot)
    await assert.rejects(prepareNativeStorage({ ...options, sourceGeneration: prepared.generation }),
      /exactly one prepared mount/)
    assert.deepEqual(await readdir(storageRoot), beforeUnmountedClaim)
    const prepareNext = () => runStoragePreparationProcess('/usr/local/bin/node',
      ['/usr/local/lib/paimind/start-native-runtime.mjs', '--prepare-storage-from', prepared.generation],
      { cwd: workspace, env: { ...process.env }, timeoutMs: 90_000 })
    const failedSource = copiedProject + '/unreadable-next-generation.txt'
    await writeFile(failedSource, 'retain current generation on failure', { mode: 0o000 })
    const beforeNext = await readdir(storageRoot)
    await assert.rejects(prepareNext(), /did not close successfully/)
    const partial = (await readdir(storageRoot)).filter(name => !beforeNext.includes(name))
    assert.equal(partial.length, 1); assert.ok(partial[0].startsWith('unpublished-'))
    await assert.rejects(lstat(storageRoot + '/' + partial[0] + '/layout.json'), { code: 'ENOENT' })
    await chmod(failedSource, 0o600)
    assert.equal(await readFile(copiedProject + '/native-mounted.txt', 'utf8'), 'native mounted data')
    assert.deepEqual(JSON.parse(await readFile(prepared.generation + '/layout.json', 'utf8')), manifest)
    const nextOutput = await prepareNext()
    const next = nextOutput.split('\n').flatMap(line => {
      try { const value = JSON.parse(line); return value.event === 'native-storage-prepared' ? [value] : [] }
      catch { return [] }
    })
    assert.equal(next.length, 1)
    const successor = next[0]
    assert.equal(successor.sourceGeneration, prepared.generation); assert.equal(successor.sourceMountedReadOnly, true)
    assert.equal(successor.layout.scopes.length, 5); assert.notEqual(successor.generation, prepared.generation)
    const nextTarget = path => successor.layout.scopes.find(row => row.path === path).storagePath
    assert.equal(await readFile(nextTarget(project) + '/native-mounted.txt', 'utf8'), 'native mounted data')
    await assert.rejects(lstat(project + '/native-mounted.txt'), { code: 'ENOENT' })
    assert.equal(await readFile(project + '/customer.txt', 'utf8'), 'Hansen customer original')
    const nextLaunch = openPreparedStorageLaunch(readPreparedStorageLayout(successor.generation, workspace))
    const nextRuntime = spawn(nextLaunch.argv[0], [...nextLaunch.argv.slice(1), '/usr/local/bin/node',
      '/usr/local/lib/paimind/storage-advance-check.mjs', successor.generation, ids.project.workspaceId, ids.nested.sessionId],
    { cwd: '/', env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe', ...nextLaunch.fds] })
    nextLaunch.close()
    let nextLog = ''; nextRuntime.stdout.on('data', bytes => { nextLog += bytes }); nextRuntime.stderr.on('data', bytes => { nextLog += bytes })
    const nextExit = await new Promise((resolve, reject) => { nextRuntime.once('error', reject); nextRuntime.once('close', (code, signal) => resolve({ code, signal })) })
    process.stdout.write(nextLog); assert.deepEqual(nextExit, { code: 0, signal: null }, nextLog)
    assert.equal(await readFile(copiedProject + '/unprepared-session/draft.txt', 'utf8'), 'Hansen latest draft')
    assert.equal(await readFile(nextTarget(project + '/unprepared-session') + '/draft.txt', 'utf8'), 'new scope change')
    assert.equal(await readFile(copiedNested + '/notes.txt', 'utf8'), 'nested-legal-change')
    await assert.rejects(lstat(storageRoot + '/.prepare-lock'), { code: 'ENOENT' })
    console.log(JSON.stringify({ nextNativeStorageGenerationVerified: true,
      actualPrepareFromEntryVerified: true, concurrentRuntimePreparationRejected: true,
      failedPreparationPreservesCurrentGeneration: true, failedPreparationHasNoLayout: true,
      unmountedSourceClaimRejected: true,
      sourceReadOnlyMountsVerified: true, latestWritesCopiedInsteadOfStaleOriginals: true,
      oldGenerationUnchangedAfterNextRuntimeWrites: true, originalPathsAndNativeIdsPreserved: true,
      nextScopes: 5, successor, partialGeneration: storageRoot + '/' + partial[0],
      automaticActivationVerified: false, containerReplacementPersistenceVerified: false,
      memberAdmissionVerified: false, browserE2EVerified: false }))
    if (process.argv[3] === '--activate-for-replacement') {
      for (const [generation, expected] of [[prepared.generation, 'none'], [successor.generation, prepared.generation]]) {
        const output = await runStoragePreparationProcess('/usr/local/bin/node',
          ['/usr/local/lib/paimind/start-native-runtime.mjs', '--activate-storage', generation, expected],
          { cwd: workspace, env: { ...process.env } })
        const selected = output.split('\n').map(line => { try { return JSON.parse(line) } catch { return {} } })
          .find(row => row.event === 'native-storage-activated')
        assert.equal(selected?.generation, generation); assert.equal(selected.changed, true)
      }
      const atomicOutput = await runStoragePreparationProcess('/usr/local/bin/node',
        ['/usr/local/lib/paimind/start-native-runtime.mjs', '--prepare-storage-from-and-activate', successor.generation],
        { cwd: workspace, env: { ...process.env }, timeoutMs: 90_000 })
      const atomic = atomicOutput.split('\n').map(line => { try { return JSON.parse(line) } catch { return {} } })
        .find(row => row.event === 'native-storage-prepared')
      assert.ok(atomic); assert.equal(atomic.sourceGeneration, successor.generation)
      assert.equal(atomic.activation?.generation, atomic.generation); assert.equal(atomic.activation.changed, true)
      const superseded = spawn('/usr/local/bin/node',
        ['/usr/local/lib/paimind/start-native-runtime.mjs', '--run-storage', successor.generation],
        { cwd: workspace, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
      let refusedLog = ''; superseded.stdout.on('data', bytes => { refusedLog += bytes }); superseded.stderr.on('data', bytes => { refusedLog += bytes })
      const refused = await new Promise((resolve, reject) => { superseded.once('error', reject); superseded.once('close', (code, signal) => resolve({ code, signal })) })
      assert.notEqual(refused.code, 0); assert.match(refusedLog, /Refusing to start a superseded storage generation/)
      assert.ok(!refusedLog.includes('managed-native-profile-ready'))
      console.log(JSON.stringify({ persistentNativeStorageSeedReady: true, generation: atomic.generation,
        projectWorkspaceId: ids.project.workspaceId, archivedSessionId: ids.nested.sessionId,
        actualOfflineActivationVerified: true, atomicPrepareAndActivationVerified: true,
        supersededRuntimeRejected: true, refusedLog, memberAdmissionVerified: false }))
    }
  }
}
