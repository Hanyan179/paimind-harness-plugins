import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { createNativeControlBroker, connectNativeControl, NATIVE_CONTROL_SOCKET } from './native-control.mjs'
import { openPreparedStorageLaunch } from './prepared-storage.mjs'
import { createCandidateExecutionDomain } from './confine-execution.mjs'

// Actual Linux namespace + installed native subprocess provider diagnostic.
// Control-domain content is an explicit fixture, not real adoption, member
// authorization, model execution or browser acceptance. No online volumes.
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 10001)
const workspace = '/var/lib/paimind/workspace'
const selection = { presetId: 'hansen-client', expectedVersion: 'fixture-version' }
const fixtureSnapshot = { source: 'explicit-fixture', ...selection }
const checks = []
const passed = name => { checks.push(name); console.log(JSON.stringify({ privateControlCheck: name })) }
async function until(test, description) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) { if (await test()) return; await delay(20) }
  throw Error('Timed out: ' + description)
}

if (process.argv[2] === '--trusted-native') {
  const privateDirectory = '/run/paimind-native-control'
  await assert.rejects(writeFile(privateDirectory + '/member-overwrite', 'forbidden'), error => ['EROFS', 'EACCES'].includes(error.code))
  await assert.rejects(access('/run/paimind-cell'), { code: 'ENOENT' })
  assert.equal(process.env.PAIMIND_PRIVATE_CANARY, undefined)
  const ownerCalls = []
  const owner = {
    async getPublicationSnapshot(input) { assert.deepEqual(input, selection); ownerCalls.push('snapshot'); return fixtureSnapshot },
    async getAdoptedPublication(input) { ownerCalls.push('receipt'); return { receipt: input.presetId } },
    async adoptPublication() { throw Error('This diagnostic does not adopt content') },
  }
  let disconnected = false
  const peer = await connectNativeControl(NATIVE_CONTROL_SOCKET, {
    get(name) { assert.equal(name, 'paimindAgentProfiles'); return owner },
  }, () => { disconnected = true })
  let root
  try {
    const require = createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
    const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
    const { createManagedHarnessSubprocessProvider } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-subprocess')).href)
    const base = createRequire(await realpath('/opt/paimind/node_modules/@deepseek-ai/dsh-base/package.json'))
    const { LocalSandboxProvider } = await import(pathToFileURL(base.resolve('@deepseek-ai/dsh-sandbox-local')).href)
    root = new Context(); await root.plugin(LocalSandboxProvider, {})
    await root.plugin(createManagedHarnessSubprocessProvider(createCandidateExecutionDomain(workspace), root.sandbox))
    const code = `
      import assert from 'node:assert/strict';
      import { access, readFile, writeFile } from 'node:fs/promises';
      import { createConnection } from 'node:net';
      for (const path of ['/run/paimind-native-control', '/run/paimind-cell', '/proc', ${JSON.stringify(process.argv[3])}]) {
        await assert.rejects(access(path), { code: 'ENOENT' });
      }
      await assert.rejects(new Promise((resolve, reject) => {
        const socket = createConnection('${NATIVE_CONTROL_SOCKET}');
        socket.once('connect', () => { socket.destroy(); resolve(); }); socket.once('error', reject);
      }), { code: 'ENOENT' });
      assert.equal(process.env.PAIMIND_NATIVE_CONTROL_SOCKET, undefined);
      assert.equal(process.env.PAIMIND_PRIVATE_CANARY, undefined);
      await writeFile('${workspace}/member-result.txt', 'member-workspace-only');
      assert.equal(await readFile('${workspace}/member-result.txt', 'utf8'), 'member-workspace-only');
      console.log('NATIVE_MEMBER_PRIVATE_CONTROL_UNAVAILABLE');
    `
    const handle = root.subprocess.spawn({ argv: ['/usr/local/bin/node', '--input-type=module', '-e', code], cwd: workspace,
      graceMs: 200, stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: { maxBytes: 8192 } } })
    try {
      assert.equal((await handle.done).exitCode, 0, handle.collected.stderr.readFrom(0).text)
      assert.equal(handle.collected.stdout.readFrom(0).text.trim(), 'NATIVE_MEMBER_PRIVATE_CONTROL_UNAVAILABLE')
    } finally { handle.terminate(); await handle.waitForExit(AbortSignal.timeout(5000)) }
    passed('installed-native-member-command-cannot-see-socket-private-volume-parent-tmp-or-proc')
    passed('installed-native-member-command-retains-own-workspace-write')
    passed('trusted-control-mount-readonly-and-transport-secret-absent')
    await until(() => ownerCalls.length === 2, 'outer launcher snapshot and receipt')
    assert.deepEqual(ownerCalls, ['snapshot', 'receipt'])
    await writeFile('/var/lib/paimind/control-probe-ready', 'ready', { flag: 'wx', mode: 0o600 })
    await until(() => disconnected, 'launcher peer withdrawal')
    passed('trusted-native-observes-private-control-withdrawal')
  } finally { peer.close(); await root?.fiber.dispose() }
} else {
  assert.equal(process.argv.length, 2)
  process.env.PAIMIND_PRIVATE_CANARY = 'diagnostic-only-never-a-credential'
  for (const directory of [workspace, '/var/lib/paimind/temporary', '/var/lib/paimind/resources']) await mkdir(directory, { mode: 0o700 })
  const broker = await createNativeControlBroker()
  // This probe intentionally tests mount mechanics with a single synthetic
  // workspace. It is not storage discovery/activation receipt acceptance.
  const layout = { memberRoot: workspace, scopes: [] }
  const launch = openPreparedStorageLaunch(layout, { controlDirectory: broker.directory })
  let child, complete, stderr = ''
  try {
    child = spawn(launch.argv[0], [...launch.argv.slice(1), '/usr/local/bin/node',
      '/usr/local/lib/paimind/native-control-container.mjs', '--trusted-native', broker.directory], {
      cwd: '/', env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/var/lib/paimind',
        PAIMIND_NATIVE_CONTROL_SOCKET: NATIVE_CONTROL_SOCKET }, stdio: ['ignore', 'inherit', 'pipe', ...launch.fds],
    })
    child.stderr.on('data', bytes => { stderr += bytes; process.stderr.write(bytes) })
    complete = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) })
  } finally { launch.close() }
  try {
    await until(() => { if (child.exitCode !== null) throw Error('Native child exited: ' + stderr); return broker.ready }, 'trusted native ready')
    assert.deepEqual(await broker.request('publication.snapshot', selection), fixtureSnapshot)
    assert.deepEqual(await broker.request('publication.receipt', { presetId: 'paimind-enterprise-' + 'a'.repeat(32) }), { receipt: 'paimind-enterprise-' + 'a'.repeat(32) })
    passed('launcher-request-reaches-only-listed-owner-methods-across-real-readonly-socket-mount')
    await assert.rejects(broker.request('session.prompt', {}))
    await until(async () => { try { return await readFile('/var/lib/paimind/control-probe-ready', 'utf8') === 'ready' } catch (error) { if (error.code !== 'ENOENT') throw error; return false } }, 'native checks finished')
    await broker.close()
    const result = await complete
    assert.deepEqual(result, { code: 0, signal: null }, stderr)
    await assert.rejects(access(broker.directory), { code: 'ENOENT' })
    passed('launcher-close-removes-owned-socket-and-child-joins')
    console.log(JSON.stringify({ privateControlLinuxDiagnosticPassed: true, finalWorkerImageAccepted: false,
      nativeOwnerContentFixture: true, memberAcceptancePassed: false, browserE2EPassed: false, modelCalled: false }))
  } finally { child.kill('SIGTERM'); await complete; await broker.close() }
}
