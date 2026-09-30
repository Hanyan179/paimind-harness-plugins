import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, realpath, readdir, symlink, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createPreparedExecutionDomain } from '/usr/local/lib/paimind/confine-execution.mjs'

// Actual native backend, processes, Linux filesystem and enforcing sandbox.
// Disposable filesystem fixtures are not real-member Browser E2E acceptance.
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 10001)
const require = createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
const nativeBase = createRequire(await realpath('/opt/paimind/node_modules/@deepseek-ai/dsh-base/package.json'))
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
const { SandboxPolicyService } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-sandbox-policy')).href)
const { LocalSandboxProvider } = await import(pathToFileURL(nativeBase.resolve('@deepseek-ai/dsh-sandbox-local')).href)
const { createManagedHarnessSubprocessProvider } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-subprocess')).href)
const { createManagedHarnessDirectoryPickerProvider } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-directory-picker')).href)
const workspace = '/var/lib/paimind/workspaces/hansen'
const alex = '/var/lib/paimind/workspaces/alex'
const privateHome = '/var/lib/paimind/dsh-home'
for (const path of [workspace, alex, privateHome]) await mkdir(path, { recursive: true, mode: 0o700 })
const identity = await stat(workspace, { bigint: true })
const domain = createPreparedExecutionDomain(workspace, [{ path: workspace, identity: `${identity.dev}:${identity.ino}` }])
for (const path of [domain.temporaryRoot, domain.resourceRoot]) await mkdir(path, { recursive: true, mode: 0o700 })
const root = new Context(); const checks = []; const helpers = []
const passed = name => { checks.push(name); console.log(JSON.stringify({ directoryPickerCheck: name })) }
try {
  await root.plugin(LocalSandboxProvider, {})
  await root.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
  const Process = createManagedHarnessSubprocessProvider(domain, root.sandbox)
  class Observed extends Process { spawn(spec) { const handle = super.spawn(spec); helpers.push(handle); return handle } }
  await root.plugin(Observed)
  await root.plugin(createManagedHarnessDirectoryPickerProvider({ executionWorld: domain }), { maxEntries: 3 })
  const picker = root.directoryPicker.capability(); assert.equal(picker.kind, 'browse')
  assert.equal(root.directoryPicker.capability(), picker)
  const initial = await picker.list()
  assert.deepEqual(initial, { path: workspace, home: workspace,
    crumbs: [{ name: 'hansen', path: workspace, hidden: false }], entries: [], truncated: false })
  passed('native-default-directory-and-breadcrumbs-owned-by-member')

  const hansenProject = await picker.createDirectory(workspace, 'Hansen 客户项目')
  const nested = await picker.createDirectory(hansenProject, '询盘回复')
  assert.equal(nested, `${workspace}/Hansen 客户项目/询盘回复`)
  assert.equal((await stat(nested)).isDirectory(), true)
  const listing = await picker.list(hansenProject)
  assert.deepEqual(listing.entries, [{ name: '询盘回复', path: nested, hidden: false }])
  assert.deepEqual(listing.crumbs.map(row => row.path), [workspace, hansenProject])
  assert.equal(JSON.stringify(listing).includes('/proc/'), false)
  passed('native-mkdir-and-list-preserve-unicode-without-exposing-descriptors')

  for (const path of [alex, privateHome, '/usr', '/', `${workspace}-sibling`, `${workspace}/../alex`, 'relative']) {
    await assert.rejects(picker.list(path), error => error.code === 'directory-unreadable')
    await assert.rejects(picker.createDirectory(path, 'bad'), error => error.code === 'directory-create-failed')
  }
  assert.deepEqual(await readdir(alex), []); assert.deepEqual(await readdir(privateHome), [])
  passed('outside-member-private-home-and-path-traversal-denied')

  for (const [name, target] of [['external', '/usr'], ['member-link', alex], ['internal-link', hansenProject]]) {
    await symlink(target, `${workspace}/${name}`)
    await assert.rejects(picker.list(`${workspace}/${name}`), error => error.code === 'directory-unreadable')
    await assert.rejects(picker.createDirectory(`${workspace}/${name}`, 'bad'), error => error.code === 'directory-create-failed')
  }
  assert.deepEqual((await picker.list()).entries.map(row => row.name), ['Hansen 客户项目'])
  await assert.rejects(picker.list(`${workspace}/internal-link/询盘回复`), error => error.code === 'directory-unreadable')
  passed('symlink-children-and-intermediate-symlink-components-fail-closed')

  for (const name of ['..', '.', '../escape', '/escape', 'a/b', 'a\\b', ' ']) {
    await assert.rejects(picker.createDirectory(workspace, name), error => error.code === 'directory-create-failed')
  }
  await assert.rejects(picker.createDirectory(workspace, 'Hansen 客户项目'), error => error.code === 'directory-exists')
  const raced = await Promise.allSettled([picker.createDirectory(hansenProject, '共同目录'), picker.createDirectory(hansenProject, '共同目录')])
  assert.equal(raced.filter(row => row.status === 'fulfilled').length, 1)
  assert.deepEqual(raced.filter(row => row.status === 'rejected').map(row => row.reason.code), ['directory-exists'])
  passed('original-native-name-validation-duplicate-and-concurrent-create-semantics')

  for (const name of ['A', 'B', 'C', 'D']) await picker.createDirectory(hansenProject, name)
  const bounded = await picker.list(hansenProject)
  assert.equal(bounded.entries.length, 3); assert.equal(bounded.truncated, true)
  assert.deepEqual(bounded.entries.map(row => row.name), ['A', 'B', 'C'])
  await assert.rejects(picker.list(undefined, AbortSignal.abort()))
  passed('native-sorted-listing-limit-and-pre-aborted-call')
  await root.fiber.dispose()
  await assert.rejects(picker.list(), error => error.code === 'directory-unreadable')
  for (const helper of helpers) assert.equal(await helper.waitForExit(AbortSignal.timeout(3000)), true)
  passed('native-service-withdrawal-and-joined-helper-processes')
  console.log(JSON.stringify({ status: 'MANAGED_DIRECTORY_PICKER_LINUX_PASSED', checks, helperCount: helpers.length,
    actualNativeFilesystem: true, actualLinuxConfinement: true, browserE2EVerified: false, finalWorkerImageAccepted: false }))
} catch (error) {
  for (const helper of helpers) process.stderr.write(helper.collected.stderr.readFrom(0).text)
  throw error
} finally { await root.fiber.dispose() }
