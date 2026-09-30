import assert from 'node:assert/strict'
import { lstat, mkdir, realpath, rmdir } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'

async function privateDirectory(path) {
  assert.ok(isAbsolute(path) && normalize(path) === path && path !== '/' && !path.includes('\0'))
  const stat = await lstat(path)
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0,
    'Storage lock directory must be private to its owner')
  assert.equal(await realpath(path), path, 'Storage lock path has a redirected ancestor')
  return stat
}

// Dependency-neutral: importing this module never boots/discovers native state
// or evaluates a command entry point. In-process capabilities cannot be forged
// by a JSON flag, retained after release, or used with another storage root.
const heldLocks = new WeakMap()
export async function withNativeStorageLock(storageRoot, operation) {
  await privateDirectory(storageRoot)
  const lock = join(storageRoot, '.prepare-lock')
  await mkdir(lock, { mode: 0o700 })
  const original = await privateDirectory(lock)
  const lease = Object.freeze({}); heldLocks.set(lease, storageRoot)
  try { return await operation(lease) }
  finally {
    heldLocks.delete(lease)
    const current = await privateDirectory(lock)
    assert.equal(current.dev, original.dev); assert.equal(current.ino, original.ino, 'Storage lock was replaced')
    await rmdir(lock)
  }
}

export async function withinNativeStorageLock(storageRoot, lease, operation) {
  if (lease === undefined) return withNativeStorageLock(storageRoot, operation)
  assert.equal(heldLocks.get(lease), storageRoot, 'Storage lock lease is absent, expired or belongs to another root')
  return operation(lease)
}
