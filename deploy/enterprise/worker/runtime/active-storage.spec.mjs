import assert from 'node:assert/strict'
import { chmod, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { activatePreparedStorage, readActiveStorageGeneration } from './active-storage.mjs'
import { withNativeStorageLock } from './prepare-native-storage.mjs'

async function fixture(t) {
  const storageRoot = await realpath(await mkdtemp(join(tmpdir(), 'paimind-active-storage-')))
  t.after(() => rm(storageRoot, { recursive: true, force: true }))
  const memberRoot = '/var/lib/paimind/workspace'
  const create = async (name, sourceGeneration) => {
    const generation = join(storageRoot, 'unpublished-' + name)
    const target = join(generation, 'scopes/0'); await mkdir(target, { recursive: true, mode: 0o700 })
    const layout = { schemaVersion: 1, state: 'prepared-not-mounted', memberRoot,
      scopes: [{ path: memberRoot, availability: 'present', storagePath: target }],
      ...(sourceGeneration === undefined ? {} : { sourceGeneration }) }
    await writeFile(join(generation, 'layout.json'), JSON.stringify(layout), { mode: 0o600 })
    return generation
  }
  const read = () => readActiveStorageGeneration(memberRoot, storageRoot)
  const activate = (generation, expectedGeneration, signal) => activatePreparedStorage({ generation, expectedGeneration, memberRoot, storageRoot, signal })
  return { storageRoot, memberRoot, create, read, activate, activeFile: join(storageRoot, 'active-layout.json') }
}

test('does not guess an active generation from prepared directory existence or ordering', async t => {
  const f = await fixture(t); await f.create('Hansen'); await f.create('Alex00')
  assert.equal(f.read(), null)
  await assert.rejects(f.activate(join(f.storageRoot, 'unpublished-Hansen'), undefined), /expected generation/)
  assert.equal(f.read(), null)
})
test('durably activates an initial generation and repeats its exact selection idempotently', async t => {
  const f = await fixture(t), first = await f.create('Hansen')
  assert.equal((await f.activate(first, null)).changed, true); assert.equal(f.read(), first)
  assert.equal((await f.activate(first, null)).changed, false)
  assert.deepEqual(JSON.parse(await readFile(f.activeFile, 'utf8')), { schemaVersion: 1, generation: 'unpublished-Hansen' })
  assert.ok(!(await readdir(f.storageRoot)).some(name => name.startsWith('.active-layout-')))
})
test('only advances from the actual current source and rejects stale siblings, wrong expectations and data rollback', async t => {
  const f = await fixture(t), first = await f.create('Hansen'), second = await f.create('Alex00', first)
  const sibling = await f.create('Alex01', first)
  await f.activate(first, null)
  await assert.rejects(f.activate(second, null), /generation changed/)
  assert.equal(f.read(), first)
  await f.activate(second, first); assert.equal(f.read(), second)
  assert.equal((await f.activate(second, first)).changed, false)
  await assert.rejects(f.activate(sibling, second), /not derived/)
  await assert.rejects(f.activate(first, second), /not derived/)
  assert.equal(f.read(), second)
})
test('refuses incomplete layouts and wrong member scope without changing the current receipt', async t => {
  const f = await fixture(t), first = await f.create('Hansen'), bad = await f.create('Alex00', first)
  await f.activate(first, null); const original = await readFile(f.activeFile, 'utf8')
  const manifest = join(bad, 'layout.json'), value = JSON.parse(await readFile(manifest, 'utf8'))
  await writeFile(manifest, JSON.stringify({ ...value, memberRoot: '/var/lib/paimind/workspaces/alex' }))
  await assert.rejects(f.activate(bad, first)); assert.equal(await readFile(f.activeFile, 'utf8'), original)
  await rm(manifest); await assert.rejects(f.activate(bad, first), { code: 'ENOENT' })
  assert.equal(f.read(), first)
})
test('rejects redirected, hardlinked, public or malformed active receipts without falling back', async t => {
  const f = await fixture(t), first = await f.create('Hansen'); await f.activate(first, null)
  const original = await readFile(f.activeFile, 'utf8')
  await chmod(f.activeFile, 0o644); assert.throws(f.read, /private regular/); await chmod(f.activeFile, 0o600)
  await link(f.activeFile, f.activeFile + '.alias'); assert.throws(f.read, /private regular/); await rm(f.activeFile + '.alias')
  for (const value of ['{', JSON.stringify({ schemaVersion: 1, generation: '../escape' }),
    JSON.stringify({ schemaVersion: 1, generation: 'unpublished-Hansen', sessionIds: [] })]) {
    await writeFile(f.activeFile, value); assert.throws(f.read)
  }
  await rm(f.activeFile); await symlink(first + '/missing', f.activeFile); assert.throws(f.read)
  await rm(f.activeFile); await writeFile(f.activeFile, original, { mode: 0o600 }); assert.equal(f.read(), first)
})
test('never activates a claimed successor on an empty volume or accepts a self-derived generation', async t => {
  const f = await fixture(t), first = await f.create('Hansen'), next = await f.create('Alex00', first)
  await assert.rejects(f.activate(next, null), /not derived/)
  const self = join(f.storageRoot, 'unpublished-Alex01'); await f.create('Alex01', self)
  await assert.rejects(f.activate(self, null), /derive from itself/); assert.equal(f.read(), null)
})
test('shares the real running/preparing operator lock and leaves cancelled activation unchanged', async t => {
  const f = await fixture(t), first = await f.create('Hansen')
  const controller = new AbortController(); controller.abort(Error('cancelled activation'))
  await assert.rejects(f.activate(first, null, controller.signal), /cancelled activation/)
  await withNativeStorageLock(f.storageRoot, async () => { await assert.rejects(f.activate(first, null), { code: 'EEXIST' }) })
  assert.equal(f.read(), null)
  await f.activate(first, null); assert.equal(f.read(), first)
})

test('allows activation in the actual preparation lock but rejects fabricated, expired and foreign leases', async t => {
  const f = await fixture(t), first = await f.create('Hansen')
  const options = { generation: first, expectedGeneration: null, memberRoot: f.memberRoot, storageRoot: f.storageRoot }
  await assert.rejects(activatePreparedStorage({ ...options, lease: {} }), /lock lease/)
  let retained
  await withNativeStorageLock(f.storageRoot, async lease => {
    retained = lease
    assert.equal((await activatePreparedStorage({ ...options, lease })).changed, true)
    await assert.rejects(activatePreparedStorage({ ...options, storageRoot: f.storageRoot + '/other', lease }), /lock lease/)
    await assert.rejects(f.activate(first, first), { code: 'EEXIST' })
  })
  await assert.rejects(activatePreparedStorage({ ...options, lease: retained }), /lock lease/)
  assert.equal(f.read(), first)
})
