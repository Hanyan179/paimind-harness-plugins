import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, realpath, symlink, stat, writeFile, readFile, readdir, link, rename } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createPreparedExecutionDomain } from '/usr/local/lib/paimind/confine-execution.mjs'

// Actual original FS provider + Linux namespace. Private disposable test data;
// this is not authentication, final immutable worker or Browser E2E evidence.
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 10001)
const require = createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
const base = createRequire(await realpath('/opt/paimind/node_modules/@deepseek-ai/dsh-base/package.json'))
const load = async name => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { SandboxPolicyService } = await load('@deepseek-ai/dsh-sandbox-policy')
const { LocalSandboxProvider } = await import(pathToFileURL(base.resolve('@deepseek-ai/dsh-sandbox-local')).href)
const { createManagedHarnessSubprocessProvider } = await load('@paimind/harness-compat/managed-subprocess')
const { createManagedHarnessFilesystemProvider, readManagedHarnessFileChunk, readManagedHarnessDirectoryView } = await load('@paimind/harness-compat/managed-filesystem')
const workspace = '/var/lib/paimind/workspaces/hansen', project = workspace + '/Hansen 项目', alex = '/var/lib/paimind/workspaces/alex', home = '/var/lib/paimind/dsh-home'
for (const dir of [project + '/资料', alex, home]) await mkdir(dir, { recursive: true, mode: 0o700 })
await writeFile(alex + '/private', 'Alex only'); await writeFile(home + '/private', 'Home only')
await writeFile(project + '/资料/说明.txt', 'Hansen 你好'); await writeFile(project + '/empty', '')
const binary = Buffer.alloc(100000, 0), text = Buffer.from('汉'.repeat(200000))
await writeFile(project + '/binary', binary); await writeFile(project + '/large', text)
const identity = await stat(workspace, { bigint: true })
const domain = createPreparedExecutionDomain(workspace, [{ path: workspace, identity: `${identity.dev}:${identity.ino}` }])
for (const dir of [domain.temporaryRoot, domain.resourceRoot]) await mkdir(dir, { recursive: true, mode: 0o700 })
const root = new Context(), checks = [], helpers = []
const passed = name => { checks.push(name); console.log(JSON.stringify({ filePreviewCheck: name })) }
const read = (path, offset = 0, version, signal = new AbortController().signal, sessionRoot = project) =>
  readManagedHarnessFileChunk(root, sessionRoot, path, offset, version, signal)
try {
  await root.plugin(LocalSandboxProvider, {})
  await root.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
  const Process = createManagedHarnessSubprocessProvider(domain, root.sandbox)
  class Observed extends Process { spawn(spec) { const handle = super.spawn(spec); helpers.push(handle); return handle } }
  await root.plugin(Observed)
  await root.plugin(createManagedHarnessFilesystemProvider({ executionWorld: domain }), { cwd: workspace })
  const first = await read(project + '/资料/说明.txt')
  assert.equal(Buffer.from(first.data, 'base64').toString(), 'Hansen 你好'); assert.equal(first.path, project + '/资料/说明.txt')
  assert.equal(first.nextOffset, null); assert.match(first.version, /^[a-f0-9]{64}$/)
  assert.deepEqual(Object.keys(first).sort(), ['data', 'nextOffset', 'offset', 'path', 'size', 'version'])
  const empty = await read(project + '/empty'); assert.equal(empty.size, 0); assert.equal(empty.data, ''); assert.equal(empty.nextOffset, null)
  passed('nested-unicode-empty-content-with-no-native-target-or-authority-keys')
  for (const [name, bytes] of [['large', text], ['binary', binary]]) {
    let current = await read(project + '/' + name), offset = 0, version = current.version; const chunks = []
    while (true) {
      assert.equal(current.size, bytes.length); assert.equal(current.version, version); assert.equal(current.offset, offset)
      const part = Buffer.from(current.data, 'base64'); assert.ok(part.length <= 65536); chunks.push(part)
      assert.equal(part.length, Math.min(65536, bytes.length - offset)); offset += part.length
      if (current.nextOffset === null || offset >= 524288) break
      assert.equal(current.nextOffset, offset); current = await read(project + '/' + name, offset, version)
    }
    assert.deepEqual(Buffer.concat(chunks), bytes.subarray(0, 524288))
  }
  passed('actual-binary-and-multichunk-unicode-same-version-bounded-prefix')
  for (const [offset, version] of [[1, undefined], [-1, undefined], [65536, undefined], [0, ['a'.repeat(64)]]]) {
    await assert.rejects(read(project + '/large', offset, version), error => error.code === 'FS_SANDBOX_DENIED')
  }
  const before = await read(project + '/large')
  await writeFile(project + '/large', Buffer.alloc(text.length, 65))
  await assert.rejects(read(project + '/large', 65536, before.version), error => error.code === 'FS_STALE_VERSION')
  const changed = await read(project + '/large')
  await writeFile(project + '/replacement', Buffer.alloc(text.length, 66)); await rename(project + '/replacement', project + '/large')
  await assert.rejects(read(project + '/large', 65536, changed.version), error => error.code === 'FS_STALE_VERSION')
  await assert.rejects(read(project + '/资料/说明.txt', 65536, first.version), error => error.code === 'FS_NOT_FOUND')
  passed('invalid-offset-coercion-mutation-replacement-and-eof-refused')
  for (const path of [alex + '/private', home + '/private', workspace + '/outside', project + '/../outside', '/etc/passwd', 'relative', project]) {
    await assert.rejects(read(path))
  }
  await assert.rejects(read(alex + '/private', 0, undefined, new AbortController().signal, alex))
  for (const [name, target] of [['foreign-link', alex + '/private'], ['home-link', home + '/private'], ['own-link', project + '/资料/说明.txt'], ['broken', project + '/missing']]) {
    await symlink(target, project + '/' + name); await assert.rejects(read(project + '/' + name))
  }
  await symlink(project + '/资料', project + '/directory-link'); await assert.rejects(read(project + '/directory-link/说明.txt'))
  await link(project + '/资料/说明.txt', project + '/hardlink'); await assert.rejects(read(project + '/hardlink'))
  execFileSync('mkfifo', [project + '/fifo']); await assert.rejects(read(project + '/fifo'))
  await assert.rejects(read(project + '/资料'))
  const directory = await readManagedHarnessDirectoryView(root, project, project, new AbortController().signal)
  assert.ok(directory.entries.find(row => row.name === 'foreign-link' && row.symlink && row.unavailable))
  passed('original-directory-regression-foreign-roots-symlinks-hardlinks-fifo-and-directory-denied')
  await assert.rejects(read(project + '/large', 0, undefined, AbortSignal.abort()))
  const abort = new AbortController(), pending = read(project + '/large', 0, undefined, abort.signal)
  const rejected = assert.rejects(pending); abort.abort(); await rejected
  await root.fiber.dispose(); await assert.rejects(read(project + '/large'))
  for (const helper of helpers) assert.equal(await helper.waitForExit(AbortSignal.timeout(3000)), true)
  assert.equal(await readFile(alex + '/private', 'utf8'), 'Alex only'); assert.equal(await readFile(home + '/private', 'utf8'), 'Home only')
  assert.deepEqual(await readdir(alex), ['private']); assert.deepEqual(await readdir(home), ['private'])
  passed('cancellation-and-unload-join-all-helpers-and-retain-foreign-canaries')
  console.log(JSON.stringify({ status: 'MANAGED_FILE_PREVIEW_LINUX_PASSED', checks, helperCount: helpers.length,
    realNativeFilesystem: true, browserE2EVerified: false, finalWorkerImageAccepted: false }))
} catch (error) {
  for (const helper of helpers) process.stderr.write(helper.collected.stderr.readFrom(0).text)
  throw error
} finally { await root.fiber.dispose() }
