import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { open, rename, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { readPreparedStorageLayout } from './prepared-storage.mjs'
import { withinNativeStorageLock } from './storage-lock.mjs'

const defaultRoot = '/var/lib/paimind/storage-generations'

/** Physical layout selection only. Call while holding the normal operator
 * lock for start/update; reading this file alone is never member admission.
 * No timestamp guessing, newest-directory fallback or stale-lock takeover.
 */
export function readActiveStorageGeneration(memberRoot, storageRoot = defaultRoot) {
  const root = lstatSync(storageRoot)
  assert.ok(root.isDirectory() && !root.isSymbolicLink() && root.uid === process.getuid() && (root.mode & 0o077) === 0)
  assert.equal(realpathSync.native(storageRoot), storageRoot)
  let fd
  try { fd = openSync(join(storageRoot, 'active-layout.json'), constants.O_RDONLY | constants.O_NOFOLLOW) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  let value
  try {
    const stat = fstatSync(fd)
    assert.ok(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid() && (stat.mode & 0o077) === 0
      && stat.size > 0 && stat.size <= 4096, 'Active storage receipt is not a private regular file')
    value = JSON.parse(readFileSync(fd, 'utf8'))
  } finally { closeSync(fd) }
  assert.deepEqual(Object.keys(value).sort(), ['generation', 'schemaVersion'])
  assert.equal(value.schemaVersion, 1); assert.match(value.generation, /^unpublished-[A-Za-z0-9]{6}$/)
  const generation = join(storageRoot, value.generation)
  readPreparedStorageLayout(generation, memberRoot, storageRoot)
  return generation
}

/** Explicit offline compare-and-swap. Initial layouts have no parent; updates
 * must have been copied from the actual current generation. Never silently
 * activate stale sibling copies or roll user data back to an older generation.
 * Image rollback can keep the same current data. A failed durability sync after
 * rename is ambiguous: callers must read back, not assume an uncommitted write.
 * Standalone use requires an external fence held continuously since copying;
 * ordinary updates should use the preparer's atomic prepare-and-activate path.
 */
export async function activatePreparedStorage({ generation, expectedGeneration, memberRoot,
  storageRoot = defaultRoot, signal, lease }) {
  assert.ok(expectedGeneration === null || typeof expectedGeneration === 'string', 'Explicit expected generation required')
  signal?.throwIfAborted()
  return withinNativeStorageLock(storageRoot, lease, async () => {
    signal?.throwIfAborted()
    const layout = readPreparedStorageLayout(generation, memberRoot, storageRoot)
    const current = readActiveStorageGeneration(memberRoot, storageRoot)
    if (current === generation && (expectedGeneration === current || (layout.sourceGeneration ?? null) === expectedGeneration)) {
      return { event: 'native-storage-activated', generation, changed: false, memberAdmissionVerified: false }
    }
    assert.equal(current, expectedGeneration, 'Active storage generation changed; read current state before retrying')
    assert.equal(layout.sourceGeneration ?? null, current, 'Prepared layout was not derived from the current generation')
    const temporary = join(storageRoot, `.active-layout-${randomUUID()}.tmp`)
    let created = false; let committed = false
    try {
      const fd = await open(temporary, 'wx', 0o600)
      created = true
      try { await fd.writeFile(JSON.stringify({ schemaVersion: 1, generation: basename(generation) })); await fd.sync() }
      finally { await fd.close() }
      signal?.throwIfAborted()
      await rename(temporary, join(storageRoot, 'active-layout.json')); committed = true
      const parent = await open(storageRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      try { await parent.sync() } finally { await parent.close() }
      assert.equal(readActiveStorageGeneration(memberRoot, storageRoot), generation)
      return { event: 'native-storage-activated', generation, changed: true, memberAdmissionVerified: false }
    } catch (error) {
      if (committed) throw new Error('Storage activation may have committed; read active storage before retrying', { cause: error })
      throw error
    } finally {
      if (created && !committed) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
  })
}
