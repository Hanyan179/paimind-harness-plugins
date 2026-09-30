import assert from 'node:assert/strict'
import { mkdir, mkdtemp, open, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runStoragePreparationProcess, validateNativeStorageSnapshot } from './prepare-native-storage.mjs'

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'paimind-storage-prepare-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const member = join(root, 'hansen'); await mkdir(member)
  const row = (path, availability = 'present') => ({ path, availability, workspaceIds: [], sessionIds: [] })
  const snapshot = rows => ({ memberRoot: member, scopes: [row(member), ...rows] })
  return { root, member, row, snapshot }
}

test('projects canonical mount paths only, preserving missing history and parent-first ordering', async t => {
  const { member, row, snapshot } = await fixture(t)
  const project = join(member, '项目'); const nested = join(project, 'notes'); const missing = join(member, 'old')
  await mkdir(nested, { recursive: true })
  const value = snapshot([row(nested), row(missing, 'missing'), row(project)])
  value.scopes[0].sessionIds = ['native-session-ref']
  const result = await validateNativeStorageSnapshot(value, member)
  assert.deepEqual(result.map(item => item.path), [member, missing, project, nested])
  assert.equal(JSON.stringify(result).includes('native-session-ref'), false)
  await assert.rejects(realpath(missing), { code: 'ENOENT' })
})

test('rejects wrong member, duplicate roots, external roots and absent native fallback', async t => {
  const { root, member, row, snapshot } = await fixture(t)
  await assert.rejects(validateNativeStorageSnapshot({ memberRoot: root, scopes: [row(root)] }, member), /mismatch/)
  await assert.rejects(validateNativeStorageSnapshot(snapshot([row(member)]), member), /Duplicate/)
  await assert.rejects(validateNativeStorageSnapshot(snapshot([row(root)]), member), /outside/)
  const child = join(member, 'child'); await mkdir(child)
  await assert.rejects(validateNativeStorageSnapshot({ memberRoot: member, scopes: [row(child)] }, member), /fallback/)
})

test('rejects redirected ancestors, symlink roots, files and stale missing states', async t => {
  const { member, row, snapshot } = await fixture(t)
  const direct = join(member, 'direct'); await mkdir(direct)
  await symlink(direct, join(member, 'alias'))
  await assert.rejects(validateNativeStorageSnapshot(snapshot([row(join(member, 'alias'))]), member), /direct directory/)
  await assert.rejects(validateNativeStorageSnapshot(snapshot([row(join(member, 'alias', 'missing'), 'missing')]), member), /direct directory/)
  await symlink(join(member, 'absent'), join(member, 'dangling'))
  await assert.rejects(validateNativeStorageSnapshot(snapshot([row(join(member, 'dangling'), 'missing')]), member), /appeared/)
  await writeFile(join(member, 'file'), 'original')
  await assert.rejects(validateNativeStorageSnapshot(snapshot([row(join(member, 'file'))]), member), /direct directory/)
  await assert.rejects(validateNativeStorageSnapshot(snapshot([row(direct, 'missing')]), member), /appeared/)
})

test('rejects path traversal spellings and invalid availability', async t => {
  const { member, row, snapshot } = await fixture(t)
  for (const path of ['relative', '/', member + '/a/../b', member + '/bad\0name']) {
    await assert.rejects(validateNativeStorageSnapshot(snapshot([row(path)]), member), /canonical/)
  }
  await assert.rejects(validateNativeStorageSnapshot(snapshot([row(member + '/x', 'ready')]), member), /availability/)
})

const run = (source, extra = {}) => runStoragePreparationProcess(process.execPath, ['--input-type=module', '-e', source],
  { cwd: process.cwd(), env: { ...process.env }, ...extra })

test('joins an actual child after output and decodes split UTF-8 without changing native paths', async () => {
  const result = await run("const b=Buffer.from('Hansen／项目');process.stdout.write(b.subarray(0,7));setTimeout(()=>process.stdout.write(b.subarray(7)),30)")
  assert.equal(result, 'Hansen／项目')
})

test('does not trust a success-shaped stdout receipt from a failed or signalled child', async () => {
  await assert.rejects(run("console.log('{\"event\":\"native-storage-discovery\"}');process.exitCode=2"), /did not close successfully/)
  await assert.rejects(run("process.kill(process.pid,'SIGTERM')"), /did not close successfully/)
})

test('joins cancelled and timed-out children and rejects pre-aborted work', async () => {
  const pre = new AbortController(); pre.abort(Error('pre-aborted'))
  await assert.rejects(run('process.exit(0)', { signal: pre.signal }), /pre-aborted/)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(Error('cancelled-owned-child')), 50)
  try { await assert.rejects(run('setInterval(()=>{},1000)', { signal: controller.signal }), /cancelled-owned-child/) }
  finally { clearTimeout(timer) }
  await assert.rejects(run('setInterval(()=>{},1000)', { timeoutMs: 50 }), /timed out/)
})

test('joins output overflow and spawn failure without returning a partial receipt', async () => {
  await assert.rejects(run("process.stdout.write('x'.repeat(3*1024*1024));setInterval(()=>{},1000)"), /exceeded/)
  await assert.rejects(runStoragePreparationProcess('/paimind-nonexistent-storage-child', [],
    { cwd: process.cwd(), env: { ...process.env } }), { code: 'ENOENT' })
})

test('passes owned source descriptors to the actual child without transferring parent ownership', async t => {
  const { member } = await fixture(t)
  const path = join(member, 'Hansen.txt'); await writeFile(path, 'descriptor-backed source')
  const handle = await open(path, 'r')
  try {
    const result = await run("process.stdout.write((await import('node:fs')).readFileSync(3,'utf8'))", { fds: [handle.fd] })
    assert.equal(result, 'descriptor-backed source')
    assert.equal((await handle.stat()).isFile(), true)
  } finally { await handle.close() }
})
