import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, readdir, realpath, writeFile, symlink, link, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createCandidateExecutionDomain } from '/usr/local/lib/paimind/confine-execution.mjs'
import { filesystemCheckpointProgram } from './filesystem-checkpoints.mjs'

assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'arm64'); assert.equal(process.getuid(), 10001)
const require = createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
const nativeBase = createRequire(await realpath('/opt/paimind/node_modules/@deepseek-ai/dsh-base/package.json'))
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
const { SandboxPolicyService } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-sandbox-policy')).href)
const { LocalSandboxProvider } = await import(pathToFileURL(nativeBase.resolve('@deepseek-ai/dsh-sandbox-local')).href)
const { createManagedHarnessSubprocessProvider } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-subprocess')).href)
const { createManagedHarnessFilesystemProvider } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-filesystem')).href)
const workspace = '/var/lib/paimind/workspaces/hansen'
const alex = '/var/lib/paimind/workspaces/alex'
const privateRoot = '/var/lib/paimind/dsh-home'
for (const path of [workspace, alex, privateRoot]) await mkdir(path, { recursive: true, mode: 0o700 })
const secret = randomUUID()
await writeFile(`${privateRoot}/private-canary`, secret, { mode: 0o600 })
await writeFile(`${alex}/Alex-private.txt`, 'Alex-only', { mode: 0o600 })
const root = new Context()
const domain = createCandidateExecutionDomain(workspace)
await mkdir(domain.temporaryRoot, { recursive: true, mode: 0o700 })
await mkdir(domain.resourceRoot, { recursive: true, mode: 0o700 })
const checks = []
const helpers = []
let checkpoint
const passed = name => { checks.push(name); console.log(JSON.stringify({ nativeFilesystemCheck: name })) }
try {
  await root.plugin(LocalSandboxProvider, {})
  await root.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
  const ManagedSubprocess = createManagedHarnessSubprocessProvider(domain, root.sandbox)
  class ObservedNativeSubprocess extends ManagedSubprocess {
    spawn(spec) {
      const active = checkpoint
      const argv = [...spec.argv]
      if (active) {
        assert.equal(argv.at(-3), '-e'); assert.equal(argv.at(-1), domain.moduleAnchor)
        argv[argv.length - 2] = filesystemCheckpointProgram(active.phase, argv.at(-2))
      }
      const handle = super.spawn(active ? { ...spec, argv, stdio: { ...spec.stdio, stderr: 'pipe' } } : spec)
      helpers.push(handle)
      if (active) {
        if (active.phase === 'spawn') { active.reached++; active.abort.abort(); return handle }
        let text = ''
        const stream = active.phase === 'result' ? handle.stdout : handle.stderr
        if (active.phase === 'result') handle.stderr.on('data', chunk => { active.stderr += chunk.toString() })
        stream.on('data', chunk => {
          text += chunk.toString()
          if (active.phase !== 'result') active.stderr = text
          if (active.reached || !text.includes(active.phase === 'result' ? '"type":"result"' : 'NATIVE_FILE_CHECKPOINT')) return
          active.reached++; active.abort.abort()
        })
      }
      return handle
    }
  }
  await root.plugin(ObservedNativeSubprocess)
  await root.plugin(createManagedHarnessFilesystemProvider({ executionWorld: domain }), { cwd: workspace })
  const fs = root.fs
  assert.equal(fs.sandboxMode, 'workspace-write')
  for (const path of [`${privateRoot}/private-canary`, `${alex}/Alex-private.txt`]) {
    const target = await fs.resolve(path)
    assert.equal(await fs.stat(target), undefined)
    await assert.rejects(fs.readText(target), error => error.code === 'FS_NOT_FOUND')
    await assert.rejects(fs.readBytes(target, undefined, 1024), error => error.code === 'FS_NOT_FOUND')
    await assert.rejects(fs.writeText(target, 'bad'), error => error.code === 'FS_SANDBOX_DENIED')
  }
  assert.deepEqual((await fs.listDir(await fs.resolve('/var/lib/paimind/workspaces'))).map(row => row.name), ['hansen'])
  passed('native-file-service-cannot-read-or-write-private-home-or-other-member')

  const target = await fs.resolve('Hansen.txt')
  const created = await fs.writeText(target, 'Hansen\nHansen\n', { kind: 'createIfAbsent' })
  assert.equal(created.operation, 'create')
  await assert.rejects(fs.writeText(target, 'bad', { kind: 'createIfAbsent' }), error => error.code === 'FS_NOT_OBSERVED')
  const results = await Promise.allSettled(['first', 'second', 'third'].map(text => fs.writeText(target, text,
    { kind: 'replaceIfVersion', version: created.version })))
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1)
  assert.deepEqual(results.filter(row => row.status === 'rejected').map(row => row.reason.code), ['FS_STALE_VERSION', 'FS_STALE_VERSION'])
  assert.equal(await fs.readText(target), 'first')
  const version = (await fs.stat(target)).version
  const edited = await fs.editText(target, { oldString: 'first', newString: 'Hansen edited', replaceAll: false }, { version })
  assert.equal(edited.before, 'first'); assert.equal(edited.after, 'Hansen edited')
  await assert.rejects(fs.writeText(target, 'bad', undefined, undefined, { mode: 'read-only', workspaceRoot: workspace }), error => error.code === 'FS_SANDBOX_DENIED')
  passed('native-atomic-write-edit-readonly-and-concurrent-version-guards')

  const project = `${workspace}/client-project`; const neighbor = `${workspace}/internal-project`
  await mkdir(project); await mkdir(neighbor)
  await writeFile(`${neighbor}/original`, 'neighbor-safe', { mode: 0o600 })
  const policy = { mode: 'workspace-write', workspaceRoot: project }
  const own = await fs.resolve(`${project}/owned`)
  await fs.writeText(own, 'project-only', undefined, undefined, policy)
  await assert.rejects(fs.writeText(await fs.resolve(`${neighbor}/original`), 'bad', undefined, undefined, policy), error => error.code === 'FS_SANDBOX_DENIED')
  // Pre-existing cross-project hardlinks are an adversarial seed. The native
  // atomic replacement must break that alias instead of mutating its peer.
  await link(`${neighbor}/original`, `${project}/linked`)
  await fs.writeText(await fs.resolve(`${project}/linked`), 'replacement-only', undefined, undefined, policy)
  assert.equal(await readFile(`${neighbor}/original`, 'utf8'), 'neighbor-safe')
  assert.equal((await stat(`${neighbor}/original`)).mode & 0o777, 0o600)
  assert.notEqual((await stat(`${neighbor}/original`)).ino, (await stat(`${project}/linked`)).ino)
  passed('native-file-mutations-respect-project-root-and-hardlink-atomic-replacement')

  await symlink(`${privateRoot}/private-canary`, `${workspace}/private-alias`)
  await assert.rejects(fs.readText(await fs.resolve('private-alias')), error => error.code === 'FS_NOT_FOUND')
  const binary = await fs.resolve('binary')
  await writeFile(`${workspace}/binary`, new Uint8Array([0, 1, 2, 255]))
  assert.deepEqual(await fs.readBytes(binary, undefined, 4), new Uint8Array([0, 1, 2, 255]))
  await assert.rejects(fs.readBytes(binary, undefined, 3), error => error.code === 'FS_TOO_LARGE')
  await assert.rejects(fs.readText(binary), error => error.code === 'FS_NOT_TEXT')
  const text = 'Hansen 和 Alex\n'.repeat(20_000)
  await writeFile(`${workspace}/stream`, text)
  let collected = ''
  for await (const chunk of await fs.streamText(await fs.resolve('stream'))) collected += chunk
  assert.equal(collected, text)
  passed('native-file-byte-bounds-streaming-and-private-symlink-denial')

  const temporary = await fs.resolve('/tmp/Hansen-between-calls.txt')
  await fs.writeText(temporary, 'same-execution-world')
  assert.equal(await fs.readText(temporary), 'same-execution-world')
  const command = root.sandbox.confine(['/usr/local/bin/node', '--input-type=module', '-e',
    "import assert from 'node:assert/strict';import{readFile,writeFile}from'node:fs/promises';assert.equal(await readFile('/tmp/Hansen-between-calls.txt','utf8'),'same-execution-world');await writeFile('/tmp/from-native-command.txt','command-to-file-service');"],
  { mode: 'workspace-write', workspaceRoot: workspace })
  const handle = root.subprocess.spawn({ argv: command.argv, cwd: workspace, graceMs: 1000,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } } })
  assert.equal((await handle.done).exitCode, 0, handle.collected.stderr.readFrom(0).text)
  assert.equal(await handle.waitForExit(), true)
  assert.equal(await fs.readText(await fs.resolve('/tmp/from-native-command.txt')), 'command-to-file-service')
  passed('temporary-files-remain-visible-between-native-filesystem-calls')

  const atomicCases = []
  for (const operation of ['write', 'create', 'edit']) for (const phase of ['spawn', 'staged', 'published', 'result', 'published-lost-result']) {
    const filename = `atomic-${operation}-${phase}.txt`; const path = `${workspace}/${filename}`
    if (operation !== 'create') await writeFile(path, 'original')
    const target = await fs.resolve(filename)
    const control = { phase, abort: new AbortController(), reached: 0, stderr: '' }; checkpoint = control
    try {
      const request = operation === 'edit'
        ? fs.editText(target, { oldString: 'original', newString: 'updated', replaceAll: false }, undefined, control.abort.signal)
        : fs.writeText(target, 'updated', operation === 'create' ? { kind: 'createIfAbsent' } : undefined, control.abort.signal)
      const unpublished = phase === 'staged' || phase === 'spawn'
      if (unpublished) {
        await assert.rejects(request, error => error.code === 'FS_ABORTED')
        if (operation === 'create') await assert.rejects(readFile(path), error => error.code === 'ENOENT')
        else assert.equal(await readFile(path, 'utf8'), 'original')
      } else if (phase === 'published-lost-result') {
        await assert.rejects(request, error => error.code === 'FS_IO_ERROR' && error.message.includes('outcome unavailable'))
        assert.equal(await readFile(path, 'utf8'), 'updated')
      } else {
        assert.equal((await request).after, 'updated')
        assert.equal(await readFile(path, 'utf8'), 'updated')
      }
      assert.equal(control.reached, 1)
      assert.deepEqual((await readdir(workspace)).filter(name => name.endsWith('.tmpdir')), [])
      atomicCases.push({ operation, phase, readback: unpublished ? 'unpublished' : 'committed',
        response: unpublished ? 'FS_ABORTED' : phase === 'published-lost-result' ? 'FS_IO_ERROR-outcome-unavailable' : 'original-native-receipt' })
    } catch (error) {
      console.log(JSON.stringify({ nativeAtomicCancellationFailure: { operation, phase, reached: control.reached,
        stderr: control.stderr, message: String(error) } }))
      throw error
    } finally { checkpoint = undefined }
  }
  console.log(JSON.stringify({ nativeAtomicCancellationCases: atomicCases }))
  passed('native-atomic-publication-cancellation-and-lost-response-readback')

  await assert.rejects(fs.writeText(target, 'cancelled', undefined, AbortSignal.abort()), error => error.code === 'FS_ABORTED')
  const stream = await fs.streamText(await fs.resolve('stream'))
  for await (const chunk of stream) { assert.ok(chunk.length); break }
  await writeFile(`${workspace}/large-stream`, 'x'.repeat(8 * 1024 * 1024))
  const streamTarget = await fs.resolve('large-stream')
  const abort = new AbortController()
  const iterator = (await fs.streamText(streamTarget, abort.signal))[Symbol.asyncIterator]()
  assert.equal((await iterator.next()).done, false)
  abort.abort()
  await assert.rejects(iterator.next(), error => error.code === 'FS_ABORTED')
  const unconsumed = await fs.streamText(streamTarget)
  await root.fiber.dispose()
  await assert.rejects(unconsumed[Symbol.asyncIterator]().next(), error => error.code === 'FS_ABORTED')
  for (const helper of helpers) assert.equal(await helper.waitForExit(AbortSignal.timeout(5000)), true)
  await assert.rejects(fs.resolve('withdrawn'), error => error.code === 'FS_ABORTED')
  assert.equal(await readFile(`${privateRoot}/private-canary`, 'utf8'), secret)
  assert.equal(await readFile(`${alex}/Alex-private.txt`, 'utf8'), 'Alex-only')
  passed('native-filesystem-cancellation-withdrawal-and-independent-private-readback')
  console.log(JSON.stringify({ status: 'NATIVE_FILESYSTEM_EXECUTION_DOMAIN_PASSED', checks,
    nativeFilesystemProviderSliceVerified: true, nativeFilesystemFullProfileVerified: false,
    codeRuntimeIsolationVerified: false, memberAdmissionVerified: false }))
} finally { await root.fiber.dispose() }
