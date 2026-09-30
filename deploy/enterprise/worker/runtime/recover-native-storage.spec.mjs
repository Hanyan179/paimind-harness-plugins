import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { activatePreparedStorage } from './active-storage.mjs'
import { inspectOfflineStorage, quarantineOfflineStorageLock } from './recover-native-storage.mjs'
import { offlineStorageFenceName } from '../../controller/offline-storage.mjs'

async function fixture(t) {
  const storageRoot = await realpath(await mkdtemp(join(tmpdir(), 'paimind-storage-recovery-')))
  t.after(() => rm(storageRoot, { recursive: true, force: true }))
  const memberRoot = '/var/lib/paimind/workspace', generation = join(storageRoot, 'unpublished-Hansen')
  const target = join(generation, 'scopes/0'); await mkdir(target, { recursive: true, mode: 0o700 })
  await writeFile(join(generation, 'layout.json'), JSON.stringify({ schemaVersion: 1, state: 'prepared-not-mounted',
    memberRoot, scopes: [{ path: memberRoot, availability: 'present', storagePath: target }] }), { mode: 0o600 })
  await writeFile(join(target, 'customer.txt'), 'keep customer content')
  await activatePreparedStorage({ generation, expectedGeneration: null, memberRoot, storageRoot })
  const options = { memberRoot, storageRoot }, lock = join(storageRoot, '.prepare-lock')
  return { ...options, options, lock, generation, target,
    inspect: () => inspectOfflineStorage(options),
    recover: (expected, signal) => quarantineOfflineStorageLock({ ...options, expected, signal }),
    createLock: () => mkdir(lock, { mode: 0o700 }) }
}

test('offline inspection does not invent a lock or recover without an observed identity', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.inspect(), { activeGeneration: f.generation, lock: null })
  await assert.rejects(f.recover(await f.inspect()), /Explicit observed/)
  assert.equal((await f.inspect()).lock, null)
})
test('quarantines only the exact empty lock, retaining user bytes and active selection', async t => {
  const f = await fixture(t); await f.createLock()
  const expected = await f.inspect(), original = await readFile(join(f.storageRoot, 'active-layout.json'))
  const result = await f.recover(expected), moved = await lstat(result.quarantine, { bigint: true })
  assert.equal(String(moved.ino), expected.lock.ino); assert.equal(String(moved.dev), expected.lock.dev)
  assert.deepEqual(await readdir(result.quarantine), [])
  assert.equal(result.userDataDeleted, false); assert.equal(result.memberAdmissionVerified, false)
  assert.equal(await readFile(join(f.target, 'customer.txt'), 'utf8'), 'keep customer content')
  assert.deepEqual(await readFile(join(f.storageRoot, 'active-layout.json')), original)
  assert.deepEqual(await f.inspect(), { activeGeneration: f.generation, lock: null })
  await assert.rejects(f.recover(expected), /changed/)
})
test('rejects stale lock identity and leaves its path untouched', async t => {
  const f = await fixture(t); await f.createLock(); const expected = await f.inspect()
  await assert.rejects(f.recover({ ...expected, lock: { ...expected.lock, ino: '0' } }), /changed/)
  assert.deepEqual(await f.inspect(), expected)
})
test('refuses non-empty or symbolic link lock targets without traversing or deleting them', async t => {
  const f = await fixture(t); await f.createLock(); const expected = await f.inspect()
  await writeFile(join(f.lock, 'unexpected'), 'keep')
  await assert.rejects(f.recover(expected), /Non-empty/)
  assert.equal(await readFile(join(f.lock, 'unexpected'), 'utf8'), 'keep')
  await rm(join(f.lock, 'unexpected')); await rm(f.lock, { recursive: true })
  await symlink(f.target, f.lock)
  await assert.rejects(f.inspect(), /Unsafe/)
  assert.equal(await readFile(join(f.target, 'customer.txt'), 'utf8'), 'keep customer content')
})
test('rejects public lock permissions and redirected storage roots', async t => {
  const f = await fixture(t); await f.createLock(); await chmod(f.lock, 0o755)
  await assert.rejects(f.inspect(), /Unsafe/); await chmod(f.lock, 0o700)
  const alias = join(f.storageRoot, 'alias'); await symlink(f.storageRoot, alias)
  await assert.rejects(inspectOfflineStorage({ ...f.options, storageRoot: alias }))
})
test('rejects corrupt active selection before touching the stale lock', async t => {
  const f = await fixture(t); await f.createLock(); const expected = await f.inspect()
  await writeFile(join(f.storageRoot, 'active-layout.json'), '{')
  await assert.rejects(f.recover(expected)); assert.ok((await lstat(f.lock)).isDirectory())
})
test('cancellation preserves lock and incomplete preparation directories', async t => {
  const f = await fixture(t); await f.createLock(); const expected = await f.inspect()
  const partial = join(f.storageRoot, 'unpublished-Alex00'); await mkdir(partial, { mode: 0o700 })
  await writeFile(join(partial, 'partial.txt'), 'unfinished copy')
  await assert.rejects(f.recover(expected, AbortSignal.abort(new Error('stop recovery'))), /stop recovery/)
  assert.deepEqual(await f.inspect(), expected)
  assert.equal(await readFile(join(partial, 'partial.txt'), 'utf8'), 'unfinished copy')
})
test('controller fence identity is stable per exact owned-volume name and rejects broad targets', () => {
  assert.equal(offlineStorageFenceName('paimind-member-hansen'), offlineStorageFenceName('paimind-member-hansen'))
  assert.notEqual(offlineStorageFenceName('paimind-member-hansen'), offlineStorageFenceName('paimind-member-alex'))
  for (const value of ['/', 'home', '../paimind-example', 'paimind-x,other=value']) assert.throws(() => offlineStorageFenceName(value))
})
