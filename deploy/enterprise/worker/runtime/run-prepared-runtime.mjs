import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { runStoragePreparationProcess, withNativeStorageLock } from './prepare-native-storage.mjs'
import { openPreparedStorageLaunch, readPreparedStorageLayout } from './prepared-storage.mjs'
import { activatePreparedStorage, readActiveStorageGeneration } from './active-storage.mjs'
import { NATIVE_CONTROL_SOCKET } from './native-control.mjs'

export async function runPreparedNativeRuntime({ generation, memberRoot, env, signal }) {
  assert.equal(process.platform, 'linux')
  signal?.throwIfAborted()
  return withNativeStorageLock('/var/lib/paimind/storage-generations', async () => {
    const activeGeneration = readActiveStorageGeneration(memberRoot)
    if (generation === undefined) generation = activeGeneration
    if (activeGeneration) assert.equal(generation, activeGeneration, 'Refusing to start a superseded storage generation')
    assert.ok(generation, 'No active storage generation; explicit offline activation required')
    const layout = readPreparedStorageLayout(generation, memberRoot)
    signal?.throwIfAborted()
    const controlDirectory = env.PAIMIND_NATIVE_CONTROL_DIRECTORY
    const launch = openPreparedStorageLaunch(layout, { controlDirectory })
    const runtimeEnv = { ...env }
    delete runtimeEnv.PAIMIND_NATIVE_CONTROL_DIRECTORY
    delete runtimeEnv.PAIMIND_NATIVE_CONTROL_SOCKET
    if (controlDirectory !== undefined) runtimeEnv.PAIMIND_NATIVE_CONTROL_SOCKET = NATIVE_CONTROL_SOCKET
    let child
    try {
      child = spawn(launch.argv[0], [...launch.argv.slice(1), '/usr/local/bin/node',
        '/usr/local/lib/paimind/boot-native-runtime.mjs', '--prepared-storage', generation],
      { cwd: '/', env: runtimeEnv, stdio: ['ignore', 'inherit', 'inherit', ...launch.fds] })
    } finally { launch.close() }
    let force; let failure
    const stop = () => {
      child.kill('SIGTERM')
      force ??= setTimeout(() => child.kill('SIGKILL'), 10_000)
    }
    signal?.addEventListener('abort', stop, { once: true })
    if (signal?.aborted) stop()
    try {
      const outcome = await new Promise(resolve => {
        child.once('error', error => { failure = error })
        child.once('close', (code, closeSignal) => resolve({ code, signal: closeSignal }))
      })
      if (failure) throw failure
      return { ...outcome, stopped: !!signal?.aborted }
    } finally {
      clearTimeout(force); signal?.removeEventListener('abort', stop)
    }
  })
}

/** Offline update from the operator-selected CURRENT generation, not stale
 * unmounted originals. Mount setup exposes source scopes read-only; the actual
 * preparer acquires the same lock and re-verifies mounts before native discovery
 * or writes. No arbitrary command or lock bypass. Explicit activate=true also
 * commits the active pointer before that same lock is released. The operator
 * still owns external fencing and exclusive volume ownership.
 */
export async function prepareNextNativeStorage({ generation, memberRoot, env, signal, activate = false }) {
  assert.equal(typeof activate, 'boolean')
  signal?.throwIfAborted()
  const layout = readPreparedStorageLayout(generation, memberRoot)
  const launch = openPreparedStorageLaunch(layout, { readOnlyScopes: true })
  try {
    const output = await runStoragePreparationProcess(launch.argv[0], [...launch.argv.slice(1),
      '/usr/local/bin/node', '/usr/local/lib/paimind/prepare-native-storage.mjs', activate ? '--mounted-source-and-activate' : '--mounted-source', generation],
    { cwd: '/', env, signal, fds: launch.fds, timeoutMs: 300_000 })
    const receipts = output.split('\n').flatMap(line => {
      try { const value = JSON.parse(line); return value.event === 'native-storage-prepared' ? [value] : [] }
      catch { return [] }
    })
    assert.equal(receipts.length, 1, 'Next storage preparation receipt is missing or ambiguous')
    const receipt = receipts[0]
    assert.equal(receipt.sourceGeneration, generation); assert.equal(receipt.sourceMountedReadOnly, true)
    assert.notEqual(receipt.generation, generation)
    assert.equal(receipt.nativeDiscoveryJoined, true); assert.equal(receipt.storageMounted, false)
    assert.equal(receipt.memberAdmissionVerified, false)
    if (activate) {
      assert.equal(receipt.activation?.generation, receipt.generation)
      assert.equal(receipt.activation.changed, true)
      assert.equal(readActiveStorageGeneration(memberRoot), receipt.generation)
    } else assert.equal(receipt.activation, undefined)
    assert.deepEqual(readPreparedStorageLayout(receipt.generation, memberRoot), receipt.layout)
    return receipt
  } finally { launch.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const activateNext = process.argv[2] === '--prepare-next-and-activate'
  const prepareNext = process.argv[2] === '--prepare-next' || activateNext
  const activate = process.argv[2] === '--activate'
  const active = process.argv[2] === '--active'
  assert.ok(process.argv.length === 3 && !prepareNext && !activate || process.argv.length === 4 && prepareNext
    || process.argv.length === 5 && activate)
  assert.equal(process.getuid(), 10001); assert.equal(process.getgid(), 10001)
  const controller = new AbortController()
  for (const name of ['SIGTERM', 'SIGINT']) process.once(name, () => controller.abort())
  try {
    const options = { generation: active ? undefined : process.argv[prepareNext || activate ? 3 : 2], memberRoot: process.cwd(),
      env: { ...process.env }, signal: controller.signal, activate: activateNext }
    if (activate) process.stdout.write(JSON.stringify(await activatePreparedStorage({ ...options,
      expectedGeneration: process.argv[4] === 'none' ? null : process.argv[4] })) + '\n')
    else if (prepareNext) process.stdout.write(JSON.stringify(await prepareNextNativeStorage(options)) + '\n')
    else {
      const result = await runPreparedNativeRuntime(options)
      process.stdout.write(JSON.stringify({ event: 'prepared-native-runtime-closed', ...result, memberAdmissionVerified: false }) + '\n')
      process.exitCode = result.code ?? (result.stopped && result.signal === 'SIGTERM' ? 0 : 1)
    }
  } catch (error) {
    process.stderr.write(`Prepared native runtime failed: ${error.message}\n`); process.exitCode = 1
  }
}
