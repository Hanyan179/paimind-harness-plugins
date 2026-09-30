import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, realpath, symlink, stat, writeFile, readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createPreparedExecutionDomain } from '/usr/local/lib/paimind/confine-execution.mjs'

// Real Linux placement and native filesystem. Test-only files; not Browser E2E.
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 10001)
const require = createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
const base = createRequire(await realpath('/opt/paimind/node_modules/@deepseek-ai/dsh-base/package.json'))
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
const { SandboxPolicyService } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-sandbox-policy')).href)
const { LocalSandboxProvider } = await import(pathToFileURL(base.resolve('@deepseek-ai/dsh-sandbox-local')).href)
const { createManagedHarnessSubprocessProvider } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-subprocess')).href)
const { createManagedHarnessFilesystemProvider, readManagedHarnessDirectoryView } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-filesystem')).href)
const workspace = '/var/lib/paimind/workspaces/hansen', project = workspace + '/Hansen 项目', alex = '/var/lib/paimind/workspaces/alex', home = '/var/lib/paimind/dsh-home'
for (const path of [project + '/资料', alex, home]) await mkdir(path, { recursive: true, mode: 0o700 })
await writeFile(project + '/说明.txt', 'Hansen only'); await writeFile(project + '/.hidden', 'Hidden only')
await writeFile(alex + '/Alex-private', 'Alex only'); await writeFile(home + '/private', 'Private only')
await writeFile(project + '/资料/报价.txt', 'Quotation')
const identity = await stat(workspace, { bigint: true })
const domain = createPreparedExecutionDomain(workspace, [{ path: workspace, identity: `${identity.dev}:${identity.ino}` }])
for (const path of [domain.temporaryRoot, domain.resourceRoot]) await mkdir(path, { recursive: true, mode: 0o700 })
const root = new Context(), checks = [], helpers = []
const passed = name => { checks.push(name); console.log(JSON.stringify({ directoryViewCheck: name })) }
const read = (directory = project, path = directory, signal = new AbortController().signal) => readManagedHarnessDirectoryView(root, directory, path, signal)
try {
  await root.plugin(LocalSandboxProvider, {})
  await root.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
  const Process = createManagedHarnessSubprocessProvider(domain, root.sandbox)
  class Observed extends Process { spawn(spec) { const handle = super.spawn(spec); helpers.push(handle); return handle } }
  await root.plugin(Observed)
  await root.plugin(createManagedHarnessFilesystemProvider({ executionWorld: domain }), { cwd: workspace })
  const listing = await read()
  assert.deepEqual(listing, { path: project, entries: [
    { name: '.hidden', path: project + '/.hidden', type: 'file', symlink: false, unavailable: false },
    { name: '说明.txt', path: project + '/说明.txt', type: 'file', symlink: false, unavailable: false },
    { name: '资料', path: project + '/资料', type: 'directory', symlink: false, unavailable: false },
  ], truncated: false })
  assert.deepEqual((await read(project, project + '/资料')).entries.map(row => row.name), ['报价.txt'])
  passed('actual-original-filesystem-nested-unicode-hidden-files-and-no-target-keys')
  for (const path of [alex, home, workspace, '/', '/usr', project + '/../escape', project + '-sibling', 'relative']) {
    await assert.rejects(read(project, path), error => error.code === 'FS_SANDBOX_DENIED')
  }
  for (const path of [alex, home, '/', '/usr']) await assert.rejects(read(path))
  passed('session-root-member-root-private-home-and-traversal-boundaries')
  for (const [name, target] of [['foreign', alex], ['controller', home], ['internal', project + '/资料'], ['broken', project + '/missing']]) {
    await symlink(target, project + '/' + name)
    await assert.rejects(read(project, project + '/' + name))
    await assert.rejects(read(project, project + '/' + name + '/child'))
  }
  const links = (await read()).entries.filter(row => row.symlink)
  assert.deepEqual(links.map(row => row.name), ['broken', 'controller', 'foreign', 'internal'])
  assert.ok(links.every(row => row.unavailable))
  passed('symlinks-listed-unavailable-and-never-followed-as-directory-entry')
  await mkdir(project + '/many')
  for (let index = 0; index < 1005; index++) await writeFile(project + '/many/' + String(index).padStart(4, '0'), '')
  const many = await read(project, project + '/many')
  assert.equal(many.entries.length, 1000); assert.equal(many.truncated, true)
  assert.ok(Buffer.byteLength(JSON.stringify(many)) < 192 * 1024)
  passed('actual-large-directory-is-explicitly-bounded-and-truncated')
  await assert.rejects(read(project, project, AbortSignal.abort()))
  const abort = new AbortController(), inflight = read(project, project + '/many', abort.signal)
  const rejected = assert.rejects(inflight); abort.abort(); await rejected
  await root.fiber.dispose(); await assert.rejects(read())
  for (const helper of helpers) assert.equal(await helper.waitForExit(AbortSignal.timeout(3000)), true)
  assert.equal(await readFile(alex + '/Alex-private', 'utf8'), 'Alex only')
  assert.equal(await readFile(home + '/private', 'utf8'), 'Private only')
  assert.deepEqual(await readdir(alex), ['Alex-private']); assert.deepEqual(await readdir(home), ['private'])
  passed('abort-unload-joins-native-processes-and-preserves-foreign-canaries')
  console.log(JSON.stringify({ status: 'MANAGED_DIRECTORY_VIEW_LINUX_PASSED', checks, helperCount: helpers.length, browserE2EVerified: false, finalWorkerImageAccepted: false }))
} catch (error) {
  for (const helper of helpers) process.stderr.write(helper.collected.stderr.readFrom(0).text)
  throw error
} finally { await root.fiber.dispose() }
