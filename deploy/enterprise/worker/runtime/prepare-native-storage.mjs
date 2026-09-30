import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { lstat, mkdir, mkdtemp, open, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { pathToFileURL } from 'node:url'
import { readPreparedStorageLayout, verifyPreparedStorageMounts } from './prepared-storage.mjs'
import { withNativeStorageLock } from './storage-lock.mjs'
export { withNativeStorageLock } from './storage-lock.mjs'

const within = (path, root) => path === root || path.startsWith(root + '/')
const canonical = path => {
  assert.ok(typeof path === 'string' && isAbsolute(path) && normalize(path) === path
    && path !== '/' && !path.includes('\0'), 'Storage path must be canonical and non-root')
}
async function directory(path, privateDirectory = false) {
  canonical(path)
  const stat = await lstat(path)
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Storage path must be a direct directory')
  assert.equal(await realpath(path), path, 'Storage path has a redirected ancestor')
  if (privateDirectory) assert.ok(stat.uid === process.getuid() && (stat.mode & 0o077) === 0,
    'Storage preparation directory must be private to the runtime owner')
  return stat
}

// Deployment layout only: do not persist Workspace/Session identities here.
// Native owners are read again on every cold preparation. A missing historical
// root is retained as missing, never silently recreated or granted a mount.
export async function validateNativeStorageSnapshot(snapshot, memberRoot) {
  canonical(memberRoot)
  assert.equal(snapshot?.memberRoot, memberRoot, 'Native snapshot member root mismatch')
  assert.ok(Array.isArray(snapshot.scopes) && snapshot.scopes.length > 0, 'Native storage scopes are missing')
  await directory(memberRoot)
  const paths = new Set()
  const scopes = []
  for (const scope of snapshot.scopes) {
    canonical(scope.path)
    assert.ok(within(scope.path, memberRoot), 'Storage scope is outside the member world')
    assert.ok(!paths.has(scope.path), 'Duplicate storage scope'); paths.add(scope.path)
    assert.ok(['present', 'missing'].includes(scope.availability), 'Invalid storage availability')
    if (scope.availability === 'present') await directory(scope.path)
    else {
      await assert.rejects(lstat(scope.path), { code: 'ENOENT' }, 'Missing storage scope appeared')
      let ancestor = dirname(scope.path)
      for (;;) {
        try { await directory(ancestor); break }
        catch (error) { if (error.code !== 'ENOENT') throw error; ancestor = dirname(ancestor) }
      }
    }
    scopes.push({ path: scope.path, availability: scope.availability })
  }
  assert.ok(scopes.some(row => row.path === memberRoot && row.availability === 'present'), 'Native fallback root is missing')
  return scopes.sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))
}

// Wait for close, not just an optimistic stdout receipt or an exit request.
// Bounded output, timeout and cancellation all kill/join the owned child before
// returning. Native shutdown itself joins its native providers. This helper is
// NOT a lease over other containers or externally shared writable volumes.
export async function runStoragePreparationProcess(file, args, { cwd, env, signal, timeoutMs = 30_000, fds = [] }) {
  signal?.throwIfAborted()
  const child = spawn(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe', ...fds] })
  const decoder = new StringDecoder('utf8')
  let output = ''; let size = 0; let failure; let force
  const cancel = error => {
    if (failure) return
    failure = error; child.kill('SIGTERM')
    force = setTimeout(() => child.kill('SIGKILL'), 2_000)
  }
  const onAbort = () => cancel(signal.reason ?? Error('Storage preparation aborted'))
  const timeout = setTimeout(() => cancel(Error('Storage preparation process timed out')), timeoutMs)
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
    size += bytes.length
    if (size > 2 * 1024 * 1024) cancel(Error('Storage preparation output exceeded its limit'))
    else if (stream === child.stdout) output += decoder.write(bytes)
  })
  try {
    const result = await new Promise(resolve => {
      child.once('error', error => { failure ??= error })
      child.once('close', (code, closeSignal) => resolve({ code, signal: closeSignal }))
    })
    if (failure) throw failure
    signal?.throwIfAborted()
    assert.deepEqual(result, { code: 0, signal: null }, 'Storage preparation child did not close successfully')
    return output + decoder.end()
  } finally {
    clearTimeout(timeout); clearTimeout(force)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Offline, operator-only preparation in an unbound cell with exclusive data
 * ownership. The caller must have stopped/joined the old cell and fenced all
 * external traffic/volume writers before invoking this operation. The lock
 * serializes this preparer only; it is not proof that arbitrary writers stopped.
 * No binding, member grant or live mount is published. Default preparation does
 * not select an active generation; explicit activate=true commits that physical
 * selection before releasing the same lock after a fully prepared copy.
 * Originals and partial generations are never overwritten/deleted. A crash
 * leaves the private lock for explicit operator recovery, not automatic theft.
 */
export async function prepareNativeStorage({ memberRoot, storageRoot, env, signal, sourceGeneration, activate = false }) {
  assert.equal(typeof activate, 'boolean')
  assert.equal(process.platform, 'linux', 'Native storage preparation requires the pinned Linux image')
  await directory(memberRoot)
  await directory(storageRoot, true)
  assert.ok(!within(storageRoot, memberRoot) && !within(memberRoot, storageRoot), 'Storage and member roots overlap')
  signal?.throwIfAborted()
  return withNativeStorageLock(storageRoot, async lease => {
  let generation
  try {
    // The normal lock is acquired by this actual copying process, not bypassed
    // by a flag or success-shaped parent receipt. Re-read the source and prove
    // its kernel mounts are read-only before native discovery or copying.
    if (sourceGeneration !== undefined) {
      const source = readPreparedStorageLayout(sourceGeneration, memberRoot, storageRoot)
      verifyPreparedStorageMounts(source, { writable: false })
    }
    const stdout = await runStoragePreparationProcess(process.execPath,
      ['/usr/local/lib/paimind/boot-native-runtime.mjs', '--inspect-storage'], { cwd: memberRoot, env, signal })
    const receipts = stdout.split('\n').flatMap(line => {
      try { const row = JSON.parse(line); return row.event === 'native-storage-discovery' ? [row] : [] }
      catch { return [] }
    })
    assert.equal(receipts.length, 1, 'Native storage discovery receipt is missing or ambiguous')
    const receipt = receipts[0]
    assert.equal(receipt.storagePrepared, false); assert.equal(receipt.memberAdmissionVerified, false)
    const scopes = await validateNativeStorageSnapshot(receipt.snapshot, memberRoot)
    signal?.throwIfAborted()
    generation = await mkdtemp(join(storageRoot, 'unpublished-'))
    await directory(generation, true)
    await mkdir(join(generation, 'scopes'), { mode: 0o700 })
    const mounts = []
    for (const [index, scope] of scopes.entries()) {
      signal?.throwIfAborted()
      const target = scope.availability === 'present' ? join(generation, 'scopes', String(index)) : null
      if (target) {
        const before = await directory(scope.path)
        // One GNU cp invocation per exact native policy root: retain hardlinks
        // within that root, break existing aliases across independently copied
        // roots. Nested roots must also be mounted separately by the next stage.
        await runStoragePreparationProcess('/bin/cp', ['--archive', '--', scope.path, target],
          { cwd: generation, env, signal, timeoutMs: 300_000 })
        const after = await directory(scope.path)
        assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino, 'Source directory was replaced')
        const copied = await directory(target)
        assert.ok(copied.dev !== before.dev || copied.ino !== before.ino, 'Storage copy aliases its source')
      }
      mounts.push({ ...scope, storagePath: target })
    }
    await validateNativeStorageSnapshot(receipt.snapshot, memberRoot)
    signal?.throwIfAborted()
    const layout = { schemaVersion: 1, state: 'prepared-not-mounted', memberRoot, scopes: mounts,
      ...(sourceGeneration === undefined ? {} : { sourceGeneration }) }
    // Only a complete, unpublished layout gets a receipt. A failed copy leaves
    // its recoverable partial generation without this file. No native IDs or
    // Session content are copied into a deployment-side object database.
    const manifest = await open(join(generation, 'layout.json'), 'wx', 0o600)
    try { await manifest.writeFile(JSON.stringify(layout)); await manifest.sync() }
    finally { await manifest.close() }
    await runStoragePreparationProcess('/bin/sync', ['--file-system', '--', generation],
      { cwd: generation, env, signal, timeoutMs: 300_000 })
    let activation
    if (activate) {
      // Same actual copying-process lock, not a gap between public commands.
      // The unforgeable in-process lease is checked again by the activator.
      const { activatePreparedStorage } = await import('./active-storage.mjs')
      activation = await activatePreparedStorage({ generation, expectedGeneration: sourceGeneration ?? null,
        memberRoot, storageRoot, signal, lease })
    }
    return { event: 'native-storage-prepared', generation, layout, nativeDiscoveryJoined: true,
      ...(sourceGeneration === undefined ? {} : { sourceGeneration, sourceMountedReadOnly: true }),
      ...(activation ? { activation } : {}),
      storageMounted: false, memberAdmissionVerified: false }
  } catch (error) {
    if (generation) throw new Error(`Storage preparation failed; original data retained; partial generation: ${generation}`, { cause: error })
    throw error
  }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const activate = process.argv[2] === '--mounted-source-and-activate'
  const mountedSource = process.argv[2] === '--mounted-source' || activate
  assert.ok(process.argv.length === 2 || process.argv.length === 4 && mountedSource)
  assert.equal(process.getuid(), 10001); assert.equal(process.getgid(), 10001)
  const controller = new AbortController()
  for (const name of ['SIGTERM', 'SIGINT']) process.once(name, () => controller.abort(Error('Storage preparation stopped')))
  try {
    const receipt = await prepareNativeStorage({ memberRoot: process.cwd(), storageRoot: '/var/lib/paimind/storage-generations',
      env: { ...process.env }, signal: controller.signal,
      activate,
      ...(mountedSource ? { sourceGeneration: process.argv[3] } : {}) })
    process.stdout.write(JSON.stringify(receipt) + '\n')
  } catch (error) {
    process.stderr.write(`Native storage preparation failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
