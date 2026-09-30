import assert from 'node:assert/strict'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readActiveStorageGeneration } from './active-storage.mjs'

const defaultRoot = '/var/lib/paimind/storage-generations'
const defaultMember = '/var/lib/paimind/workspace'
const identity = stat => ({ dev: String(stat.dev), ino: String(stat.ino), ctimeNs: String(stat.ctimeNs) })

// Operator-only offline recovery. A dead PID, elapsed timeout or this directory
// alone is NOT authority to recover. The controller must exclude other volume
// users continuously before starting this helper and until its process closes.
// Ordinary runtime startup never calls this module or takes over a stale lock.
export async function inspectOfflineStorage({ storageRoot = defaultRoot, memberRoot = defaultMember } = {}) {
  assert.equal(await realpath(storageRoot), storageRoot)
  const root = await lstat(storageRoot)
  assert.ok(root.isDirectory() && !root.isSymbolicLink() && root.uid === process.getuid() && (root.mode & 0o077) === 0)
  const activeGeneration = readActiveStorageGeneration(memberRoot, storageRoot)
  let lock
  try { lock = await lstat(join(storageRoot, '.prepare-lock'), { bigint: true }) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (lock) {
    assert.ok(lock.isDirectory() && !lock.isSymbolicLink() && lock.uid === BigInt(process.getuid())
      && (lock.mode & 0o077n) === 0n, 'Unsafe offline storage lock')
    assert.deepEqual(await readdir(join(storageRoot, '.prepare-lock')), [], 'Non-empty storage lock requires investigation')
  }
  return { activeGeneration, lock: lock ? identity(lock) : null }
}

export async function quarantineOfflineStorageLock({ expected, storageRoot = defaultRoot,
  memberRoot = defaultMember, signal }) {
  signal?.throwIfAborted()
  assert.ok(expected && expected.lock, 'Explicit observed offline lock required')
  const before = await inspectOfflineStorage({ storageRoot, memberRoot })
  assert.deepEqual(before, expected, 'Offline storage changed; inspect before retrying')
  const oldPath = join(storageRoot, '.prepare-lock')
  const quarantine = join(storageRoot, `.quarantined-lock-${randomUUID()}`)
  // Recheck immediately before rename. No recursive deletion, replacement of
  // data, guessed generation selection, or automatic replay of partial copies.
  signal?.throwIfAborted()
  assert.deepEqual(identity(await lstat(oldPath, { bigint: true })), expected.lock)
  await rename(oldPath, quarantine)
  try {
    const moved = await lstat(quarantine, { bigint: true })
    assert.equal(String(moved.dev), expected.lock.dev); assert.equal(String(moved.ino), expected.lock.ino)
    const directory = await open(storageRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { await directory.sync() } finally { await directory.close() }
    const after = await inspectOfflineStorage({ storageRoot, memberRoot })
    assert.equal(after.lock, null); assert.equal(after.activeGeneration, expected.activeGeneration)
    return { event: 'offline-storage-lock-quarantined', quarantine, activeGeneration: after.activeGeneration,
      originalLock: expected.lock, userDataDeleted: false, memberAdmissionVerified: false }
  } catch (error) {
    throw new Error('Offline lock recovery may have committed; inspect before retrying', { cause: error })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 10001)
  assert.equal(process.getgid(), 10001)
  const mode = process.argv[2]
  assert.ok(mode === '--inspect' && process.argv.length === 3 || mode === '--quarantine' && process.argv.length === 4)
  const value = mode === '--inspect' ? await inspectOfflineStorage()
    : await quarantineOfflineStorageLock({ expected: JSON.parse(process.argv[3]) })
  process.stdout.write(JSON.stringify(value) + '\n')
}
