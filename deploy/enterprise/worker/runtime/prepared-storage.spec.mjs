import assert from 'node:assert/strict'
import { chmod, link, mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseMountPoints, readPreparedStorageLayout } from './prepared-storage.mjs'
import { withNativeStorageLock } from './prepare-native-storage.mjs'

async function fixture(t) {
  const storage = await realpath(await mkdtemp(join(tmpdir(), 'paimind-prepared-mount-')))
  t.after(() => rm(storage, { recursive: true, force: true }))
  const generation = join(storage, 'unpublished-Hansen')
  await mkdir(join(generation, 'scopes'), { recursive: true, mode: 0o700 })
  const member = '/var/lib/paimind/workspace'
  const scopes = [member, member + '/client', member + '/old'].map((path, index) => ({ path,
    availability: index === 2 ? 'missing' : 'present', storagePath: index === 2 ? null : join(generation, 'scopes', String(index)) }))
  for (const row of scopes.filter(row => row.storagePath)) await mkdir(row.storagePath, { mode: 0o700 })
  const layout = { schemaVersion: 1, state: 'prepared-not-mounted', memberRoot: member, scopes }
  const file = join(generation, 'layout.json')
  const save = async value => writeFile(file, JSON.stringify(value), { mode: 0o600 })
  await save(layout)
  const read = () => readPreparedStorageLayout(generation, member, storage)
  return { storage, generation, member, layout, file, save, read }
}

test('reads a private completed mount-only layout and freezes its projection', async t => {
  const { layout, read } = await fixture(t)
  const value = read(); assert.deepEqual(value, layout)
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.scopes) && value.scopes.every(Object.isFrozen))
})
test('rejects missing, private-permission drift, symlink and hardlinked receipts', async t => {
  const { file, read } = await fixture(t)
  await chmod(file, 0o644); assert.throws(read); await chmod(file, 0o600)
  await link(file, file + '.link'); assert.throws(read); await rm(file + '.link')
  await rename(file, file + '.original'); assert.throws(read, { code: 'ENOENT' })
  await symlink(file + '.original', file); assert.throws(read)
})
test('rejects duplicate, foreign, missing fallback and unordered native scope paths', async t => {
  const { layout, save, read } = await fixture(t)
  for (const scopes of [[...layout.scopes, layout.scopes[0]], layout.scopes.slice(1),
    [...layout.scopes].reverse(), [layout.scopes[0], { ...layout.scopes[1], path: '/var/lib/paimind/workspaces/alex' }]]) {
    await save({ ...layout, scopes }); assert.throws(read)
  }
})
test('rejects activation claims, extra business fields and cross-generation sources', async t => {
  const { layout, save, read, generation } = await fixture(t)
  for (const value of [{ ...layout, state: 'ready' }, { ...layout, sessionIds: [] }, { ...layout, schemaVersion: 2 },
    { ...layout, scopes: [layout.scopes[0], { ...layout.scopes[1], storagePath: generation + '/scopes/0' }] },
    { ...layout, scopes: [layout.scopes[0], { ...layout.scopes[1], storagePath: '/tmp/foreign' }] }]) {
    await save(value); assert.throws(read)
  }
})
test('rejects source and generation directory redirection', async t => {
  const { layout, read, generation, storage, member } = await fixture(t)
  const source = layout.scopes[1].storagePath
  await rename(source, source + '-original'); await symlink(source + '-original', source)
  assert.throws(read, /redirected/)
  const alias = join(storage, 'unpublished-Alex00'); await symlink(generation, alias)
  assert.throws(() => readPreparedStorageLayout(alias, member, storage), /redirected/)
  assert.throws(() => readPreparedStorageLayout(generation, '/', storage), /Invalid prepared member root/)
})
test('parses actual mountinfo escaping and per-mount write policy', () => {
  assert.deepEqual(parseMountPoints('123 9 0:9 / /data/Hansen\\040project rw,nosuid - tmpfs tmpfs rw\n124 9 0:9 / /data/notes\\134copy ro - tmpfs tmpfs rw'),
    [{ path: '/data/Hansen project', writable: true }, { path: '/data/notes\\copy', writable: false }])
  assert.throws(() => parseMountPoints('untrusted incomplete line'), /Invalid kernel mount record/)
})
test('shares the operator lock across preparation and runtime lifetime, releasing only after join or failure', async t => {
  const { storage } = await fixture(t)
  let release; let entered
  const ready = new Promise(resolve => { entered = resolve })
  const running = withNativeStorageLock(storage, async () => { entered(); await new Promise(resolve => { release = resolve }); return 17 })
  await ready
  await assert.rejects(withNativeStorageLock(storage, () => {}), { code: 'EEXIST' })
  release(); assert.equal(await running, 17)
  await assert.rejects(withNativeStorageLock(storage, () => { throw Error('owned runtime failed') }), /owned runtime failed/)
  assert.equal(await withNativeStorageLock(storage, () => 23), 23)
})
