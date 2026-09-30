import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdir, readFile, readdir, realpath, rename, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createCandidateExecutionDomain } from '/usr/local/lib/paimind/confine-execution.mjs'

// Diagnostic-only, actual Linux/native library/PTY tests. No simulated handles.
assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'arm64'); assert.equal(process.getuid(), 10001)
const anchor = '/opt/paimind/node_modules/@paimind/harness-compat/package.json'
const require = createRequire(await realpath(anchor))
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
const { createManagedHarnessSubprocessProvider } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-subprocess')).href)
const nativeBase = createRequire(await realpath('/opt/paimind/node_modules/@deepseek-ai/dsh-base/package.json'))
const { LocalSandboxProvider } = await import(pathToFileURL(nativeBase.resolve('@deepseek-ai/dsh-sandbox-local')).href)
const workspace = '/var/lib/paimind/workspaces/hansen'
const privateRoot = '/var/lib/paimind/dsh-home'
await mkdir(workspace, { recursive: true, mode: 0o700 }); await mkdir(privateRoot, { mode: 0o700 })
await mkdir('/var/lib/paimind/temporary/hansen', { recursive: true, mode: 0o700 })
await mkdir('/var/lib/paimind/resources/hansen', { recursive: true, mode: 0o700 })
const secret = randomUUID(); process.env.PAIMIND_PRIVATE_CANARY = secret
let parentSignals = 0
const recordParentSignal = () => { parentSignals++ }
process.on('SIGUSR2', recordParentSignal)
await writeFile(`${privateRoot}/private-canary`, secret, { flag: 'wx', mode: 0o600 })
const server = createServer((_req, res) => res.end(secret))
await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
const port = server.address().port
const root = new Context()
const checks = []
function passed(name, facts = {}) { checks.push({ name, ...facts }); console.log(JSON.stringify({ nativeSubprocessCheck: name, ...facts })) }
async function until(check, description) {
  const end = Date.now() + 5000
  while (Date.now() < end) { if (await check()) return; await delay(25) }
  throw Error(`Timed out waiting for ${description}`)
}
const spec = (code, extra = {}) => ({ argv: ['/usr/local/bin/node', '--input-type=module', '-e', code], cwd: workspace,
  graceMs: 200, stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } }, ...extra })
async function finish(handle) {
  const outcome = await handle.done
  const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
  assert.equal(outcome.exitCode, 0, stderr)
  assert.equal(stderr, '')
  assert.equal(await handle.waitForExit(AbortSignal.timeout(5000)), true)
  return handle.collected.stdout?.readFrom(0)
}
async function ownedProcesses(marker) {
  const rows = await readdir('/proc'); const found = []
  for (const row of rows.filter(row => /^\d+$/.test(row))) {
    try { if ((await readFile(`/proc/${row}/cmdline`, 'utf8')).includes(marker)) found.push(Number(row)) } catch (e) {
      if (!['ENOENT', 'ESRCH'].includes(e.code)) throw e
    }
  }
  return found
}
let terminal
try {
  await root.plugin(LocalSandboxProvider, {})
  await root.plugin(createManagedHarnessSubprocessProvider(createCandidateExecutionDomain(workspace), root.sandbox))
  await finish(root.subprocess.spawn(spec("console.log('EXECUTION_PLACEMENT_READY')")))
  assert.equal(await root.subprocess.resolveExecutable('node'), '/usr/local/bin/node')
  await assert.rejects(root.subprocess.resolveExecutable('./node'))
  await assert.rejects(root.subprocess.resolveExecutable(`${privateRoot}/private-canary`))
  passed('native-lookup-in-confined-world')

  // Resource placement must fail before the native command body if operator
  // configuration selects another world, or a required directory disappears
  // or becomes a symlink. There is no private-home fallback.
  async function rejectedResourceLaunch(provider, message) {
    const handle = provider.spawn(spec("console.log('RESOURCE_BOUNDARY_BYPASSED')"))
    try {
      assert.equal((await handle.done).exitCode, 125)
      assert.equal(handle.collected.stdout.readFrom(0).text, '')
      assert.ok(handle.collected.stderr.readFrom(0).text.includes(message))
    } finally { handle.terminate(); await handle.waitForExit(AbortSignal.timeout(5000)) }
  }
  const incorrectWorld = new Context()
  const resourceDomain = createCandidateExecutionDomain(workspace)
  try {
    await incorrectWorld.plugin(createManagedHarnessSubprocessProvider({ ...resourceDomain, prepare(request) {
      const launch = resourceDomain.prepare(request)
      assert.equal(launch.argv[4], resourceDomain.resourceRoot)
      const argv = [...launch.argv]; argv[4] = '/var/lib/paimind/resources/alex'
      return { ...launch, argv }
    } }, root.sandbox))
    await rejectedResourceLaunch(incorrectWorld.subprocess, 'resource directory belongs to a different world')
  } finally { await incorrectWorld.fiber.dispose() }
  for (const replacement of ['missing', 'symlink']) {
    const parked = resourceDomain.resourceRoot + '.original'
    await rename(resourceDomain.resourceRoot, parked)
    let linked = false
    try {
      if (replacement === 'symlink') { await symlink(privateRoot, resourceDomain.resourceRoot); linked = true }
      await rejectedResourceLaunch(root.subprocess, 'directory component unavailable or symbolic link')
    } finally {
      if (linked) await unlink(resourceDomain.resourceRoot)
      await rename(parked, resourceDomain.resourceRoot)
    }
  }
  passed('resource-world-mismatch-missing-and-symlink-rejected-before-command')

  const security = root.subprocess.spawn(spec(`
    import assert from 'node:assert/strict';import{readFile,writeFile,readdir,symlink}from'node:fs/promises';
    assert.equal(process.getuid(),10001);assert.equal(process.env.PAIMIND_PRIVATE_CANARY,undefined);
    await assert.rejects(readFile('${privateRoot}/private-canary'),e=>e.code==='ENOENT');
    await assert.rejects(readdir('/proc'),e=>e.code==='ENOENT');
    // PID numbers can coincide across namespaces. Probe an actual harmless
    // signal and check the intended outer process, not numeric non-existence.
    process.on('SIGUSR2',()=>{});
    try{process.kill(${process.pid},'SIGUSR2')}catch(e){assert.equal(e.code,'ESRCH')}
    await assert.rejects(fetch('http://127.0.0.1:${port}/',{signal:AbortSignal.timeout(500)}));
    await assert.rejects(writeFile('/usr/local/bin/untrusted','bad'),e=>['EROFS','EACCES'].includes(e.code));
    await symlink('${privateRoot}/private-canary','escape-link');
    await assert.rejects(readFile('escape-link'),e=>e.code==='ENOENT');
    await writeFile('native-result.txt','confined-native-write');
    process.stdout.write('x'.repeat(8192));
  `, { stdio: { stdin: 'ignore', stdout: { maxBytes: 256, spill: { maxBytes: 16_384 } }, stderr: { maxBytes: 4096 } } }))
  const output = await finish(security)
  assert.equal(output.lossy, true); assert.equal(output.nextOffset, 8192)
  assert.deepEqual(security.collected.stdout.readFrom(0), output)
  assert.equal(await readFile(output.spillPath, 'utf8'), 'x'.repeat(8192))
  assert.equal(await readFile(`${workspace}/native-result.txt`, 'utf8'), 'confined-native-write')
  assert.equal(await readFile(`${privateRoot}/private-canary`, 'utf8'), secret)
  assert.equal(parentSignals, 0, 'Inner command must not signal the outer runtime process')
  passed('native-collection-spill-file-network-environment-isolation')

  const pipe = root.subprocess.spawn(spec('process.stdin.pipe(process.stdout)', {
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 4096 } },
  }))
  let pipeOutput = ''; pipe.stdout.on('data', bytes => { pipeOutput += bytes })
  pipe.stdin.end('Hansen native pipe\n'); await finish(pipe)
  assert.equal(pipeOutput, 'Hansen native pipe\n'); passed('native-raw-stdio')

  await writeFile(`${workspace}/readonly-existing.txt`, 'original', { mode: 0o600, flag: 'wx' })
  const readonlyCode = `
    import assert from 'node:assert/strict';
    import{readFile,writeFile,truncate,rename,unlink,mkdir,link,chmod,chown,utimes,stat,open}from'node:fs/promises';
    const file='${workspace}/readonly-existing.txt';
    assert.equal(await readFile(file,'utf8'),'original');
    const denied=e=>['EACCES','EPERM','EROFS'].includes(e.code);
    for(const [name,attempt] of Object.entries({write:()=>writeFile(file,'changed'),create:()=>writeFile('${workspace}/readonly-new.txt','new'),
      truncate:()=>truncate(file,0),rename:()=>rename(file,file+'.renamed'),unlink:()=>unlink(file),mkdir:()=>mkdir('${workspace}/readonly-dir'),
      link:()=>link(file,file+'.hardlink'),temporary:()=>writeFile('/tmp/readonly-temp','bad'),chmod:()=>chmod(file,0o777),
      chown:()=>chown(file,10001,10001),utimes:()=>utimes(file,0,0),fdchmod:async()=>{const fd=await open(file,'r');try{await fd.chmod(0o777)}finally{await fd.close()}}})){
      await assert.rejects(attempt,denied,'Read-only operation was not rejected: '+name);
    }
    assert.equal((await stat(file)).mode&0o777,0o600);console.log('READONLY_POLICY_ENFORCED');
  `
  const readonly = root.sandbox.confine(spec(readonlyCode).argv, { mode: 'read-only', workspaceRoot: workspace })
  passed('native-sandbox-readonly-wrapper-selected', { enforcement: readonly.enforcement, runner: readonly.argv[0] })
  assert.equal(readonly.enforcement, 'full')
  const readonlyResult = await finish(root.subprocess.spawn({ ...spec(readonlyCode), argv: readonly.argv }))
  assert.ok(readonlyResult.text.includes('READONLY_POLICY_ENFORCED'))
  assert.equal(await readFile(`${workspace}/readonly-existing.txt`, 'utf8'), 'original')
  passed('native-sandbox-readonly-file-effects')
  const writeCode = `import{writeFile,readFile}from'node:fs/promises';
    await writeFile('${workspace}/write-policy.txt','native-policy-write');
    await writeFile('/tmp/write-policy-temp','private-temp');console.log(await readFile('${workspace}/write-policy.txt','utf8'));`
  const writable = root.sandbox.confine(spec(writeCode).argv, { mode: 'workspace-write', workspaceRoot: workspace })
  assert.equal(writable.enforcement, 'full')
  assert.ok((await finish(root.subprocess.spawn({ ...spec(writeCode), argv: writable.argv }))).text.includes('native-policy-write'))
  passed('native-sandbox-workspace-write-file-effects')
  for (let round = 0; round < 3; round++) {
    const [read, write] = await Promise.all([
      finish(root.subprocess.spawn({ ...spec(readonlyCode), argv: readonly.argv, env: { DSH_PERMISSION_MODE: 'danger-full-access' } })),
      finish(root.subprocess.spawn({ ...spec(writeCode), argv: writable.argv })),
    ])
    assert.ok(read.text.includes('READONLY_POLICY_ENFORCED')); assert.ok(write.text.includes('native-policy-write'))
  }
  passed('concurrent-native-readonly-and-write-policies', { rounds: 3, permissionEnvironmentCannotRelaxReadonly: true })

  const project = `${workspace}/client-project`
  const neighbor = `${workspace}/internal-project`
  await mkdir(project); await mkdir(neighbor)
  await writeFile(`${neighbor}/neighbor.txt`, 'other-workspace-original', { mode: 0o600, flag: 'wx' })
  const scopedWriteCode = `
    import assert from 'node:assert/strict';
    import{fstatSync}from'node:fs';
    import{readFile,writeFile,chmod,chown,utimes,open,stat}from'node:fs/promises';
    for(let fd=3;fd<128;fd++){
      try{assert.equal(fstatSync(fd).isDirectory(),false,'Launcher directory descriptor leaked to command')}
      catch(e){if(e.code!=='EBADF')throw e}
    }
    const own='${project}/owned.txt',other='${neighbor}/neighbor.txt';
    await writeFile(own,'owned-workspace-write');await chmod(own,0o700);
    assert.equal((await stat(own)).mode&0o777,0o700);
    assert.equal(await readFile(other,'utf8'),'other-workspace-original');
    const denied=e=>['EACCES','EPERM','EROFS'].includes(e.code);
    for(const[name,attempt]of Object.entries({write:()=>writeFile(other,'bad'),chmod:()=>chmod(other,0o777),
      chown:()=>chown(other,10001,10001),utimes:()=>utimes(other,0,0),
      fdchmod:async()=>{const fd=await open(other,'r');try{await fd.chmod(0o777)}finally{await fd.close()}}})){
      await assert.rejects(attempt,denied,'Unauthorized neighboring workspace operation: '+name);
    }
    assert.equal((await stat(other)).mode&0o777,0o600);console.log('NESTED_WORKSPACE_POLICY_ENFORCED');
  `
  const scopedWritable = root.sandbox.confine(spec(scopedWriteCode).argv, { mode: 'workspace-write', workspaceRoot: project })
  assert.ok((await finish(root.subprocess.spawn({ ...spec(scopedWriteCode), cwd: project, argv: scopedWritable.argv }))).text.includes('NESTED_WORKSPACE_POLICY_ENFORCED'))
  passed('native-nested-workspace-write-and-metadata-boundary')

  // Reject symlinks in both final and intermediate writable-root components.
  // The attempted target is another project owned by this same user: read
  // access is permitted, but granting it writes through an alias is not.
  await symlink(neighbor, `${workspace}/project-alias`)
  await mkdir(`${neighbor}/nested`)
  for (const writableRoot of [`${workspace}/project-alias`, `${workspace}/project-alias/nested`]) {
    const confined = root.sandbox.confine(spec("console.log('SHOULD_NOT_EXECUTE')").argv,
      { mode: 'workspace-write', workspaceRoot: writableRoot })
    const denied = root.subprocess.spawn({ ...spec(''), argv: confined.argv })
    assert.equal((await denied.done).exitCode, 125)
    assert.ok(denied.collected.stderr.readFrom(0).text.includes('directory component unavailable or symbolic link'))
    assert.equal(denied.collected.stdout.readFrom(0).text, '')
    assert.equal(await denied.waitForExit(AbortSignal.timeout(5000)), true)
  }
  passed('symlink-components-cannot-select-writable-directory')

  // Deterministic race: the unmodified bwrap --args API waits for stdin during
  // parsing, AFTER our exec-only launcher opened its directory descriptors and
  // BEFORE bwrap resolves/mounts them. Seeing the original native handle's comm
  // change to bwrap establishes that boundary; no sleep-based race assumption.
  // The diagnostic projection adds only this input gate, never a permission.
  const racingRoot = new Context()
  const domain = createCandidateExecutionDomain(workspace)
  try {
    await racingRoot.plugin(createManagedHarnessSubprocessProvider({ ...domain, prepare(request) {
      const launch = domain.prepare(request)
      const afterLauncherOptions = launch.argv.indexOf('--') + 1
      assert.ok(afterLauncherOptions > 0)
      return { ...launch, argv: [...launch.argv.slice(0, afterLauncherOptions), '--args', '0', ...launch.argv.slice(afterLauncherOptions)] }
    } }, root.sandbox))
    const outcomes = []
    for (const replacement of ['directory', 'symlink']) {
      const selected = `${workspace}/race-${replacement}`
      const pinned = `${selected}-opened`
      const sentinel = 'WRITE_ONLY_IN_ORIGINALLY_OPENED_DIRECTORY'
      await mkdir(selected)
      const code = `import{writeFile}from'node:fs/promises';await writeFile('${selected}/race-result','${sentinel}');console.log('ORIGINAL_DIRECTORY_WRITE');`
      const confined = root.sandbox.confine(spec(code).argv, { mode: 'workspace-write', workspaceRoot: selected })
      const handle = racingRoot.subprocess.spawn({ ...spec(code), argv: confined.argv,
        stdio: { stdin: 'pipe', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } } })
      try {
        await until(async () => {
          try { return (await readFile(`/proc/${handle.pid}/comm`, 'utf8')).trim() === 'bwrap' }
          catch (error) { if (error.code === 'ENOENT') return false; throw error }
        }, 'exec-only launcher descriptor handoff to bwrap')
        await rename(selected, pinned)
        if (replacement === 'directory') await mkdir(selected)
        else await symlink(neighbor, selected)
        handle.stdin.end() // EOF supplies zero extra bwrap arguments.
        const outcome = await handle.done
        assert.equal(await handle.waitForExit(AbortSignal.timeout(5000)), true)
        assert.equal(await readFile(`${neighbor}/neighbor.txt`, 'utf8'), 'other-workspace-original')
        assert.equal((await stat(`${neighbor}/neighbor.txt`)).mode & 0o777, 0o600)
        await assert.rejects(readFile(`${neighbor}/race-result`), error => error.code === 'ENOENT')
        if (replacement === 'directory') await assert.rejects(readFile(`${selected}/race-result`), error => error.code === 'ENOENT')
        if (outcome.exitCode === 0) {
          assert.equal(await readFile(`${pinned}/race-result`, 'utf8'), sentinel)
          assert.ok(handle.collected.stdout.readFrom(0).text.includes('ORIGINAL_DIRECTORY_WRITE'))
          outcomes.push({ replacement, result: 'original-opened-directory-only' })
        } else {
          assert.equal(outcome.exitCode, 1)
          assert.equal(handle.collected.stdout.readFrom(0).text, '')
          assert.ok(handle.collected.stderr.readFrom(0).text.includes('bwrap:'))
          await assert.rejects(readFile(`${pinned}/race-result`), error => error.code === 'ENOENT')
          outcomes.push({ replacement, result: 'mount-rejected-before-command' })
        }
      } finally { handle.terminate(); await handle.waitForExit(AbortSignal.timeout(5000)) }
      if (replacement === 'symlink') await unlink(selected)
    }
    passed('opened-directory-replacement-cannot-redirect-writes', { outcomes })
  } finally { await racingRoot.fiber.dispose() }

  // A detached grandchild deliberately ignores TERM. Check real whole-world
  // disappearance from the trusted parent, not just the native wrapper's exit.
  const marker = `paimind-owned-descendant-${randomUUID()}`
  const grandchild = `import{appendFileSync}from'node:fs';process.on('SIGTERM',()=>{});setInterval(()=>appendFileSync('${workspace}/ticks','${marker}\\n'),25);`
  const abort = new AbortController()
  const tree = root.subprocess.spawn(spec(`import{spawn}from'node:child_process';
    spawn('/usr/local/bin/node',['--input-type=module','-e',${JSON.stringify(grandchild)}],{detached:true,stdio:'ignore'}).unref();
    console.log('TREE_READY');setInterval(()=>{},1000);`, { signal: abort.signal }))
  // The marker also appears in the ancestor argv; counting matching processes
  // alone can race before the grandchild runs. Require its real file effect.
  await until(async () => {
    try { return (await readFile(`${workspace}/ticks`, 'utf8')).includes(marker) } catch (e) {
      if (e.code === 'ENOENT') return false
      throw e
    }
  }, 'detached descendant actively writing')
  assert.ok((await ownedProcesses(marker)).length >= 3)
  abort.abort(); await tree.done
  assert.equal(await tree.waitForExit(AbortSignal.timeout(5000)), true)
  await until(async () => (await ownedProcesses(marker)).length === 0, 'detached descendant termination')
  passed('native-cancellation-kills-detached-descendant')

  const terminalRounds = []
  for (let round = 0; round < 10; round++) {
    terminal = await root.subprocess.spawnTerminal({ argv: ['/usr/local/bin/node', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    assert.equal(process.stdin.isTTY,true);assert.equal(process.stdout.isTTY,true);
    assert.equal(process.stdout.rows,24);assert.equal(process.stdout.columns,80);
    let signals=0;process.on('SIGINT',()=>process.stdout.write('SIGNAL_RECEIVED:'+ ++signals+'\\n'));
    process.stdin.on('data',data=>process.stdout.write('INPUT_RECEIVED:'+data));
    console.log('TERMINAL_READY');
    `], cwd: workspace, rows: 24, cols: 80, graceMs: 200 })
    let terminalOutput = ''; terminal.output.on('data', bytes => { terminalOutput += bytes })
    await until(() => terminalOutput.includes('TERMINAL_READY'), `native terminal readiness: ${terminalOutput}`)
    await terminal.write('Hansen keyboard\n')
    await until(() => terminalOutput.includes('INPUT_RECEIVED:Hansen keyboard'), 'terminal input')
    const foreground = await terminal.inspectForeground(); assert.ok(foreground)
    assert.notEqual(foreground.processGroupId, terminal.pid, 'Foreground command must not share the boundary monitor group')
    const signalledGroup = await terminal.signalForeground('SIGINT'); assert.equal(signalledGroup, foreground.processGroupId)
    await until(() => terminalOutput.includes('SIGNAL_RECEIVED:1'), `foreground signal: ${terminalOutput}`)
    await terminal.write('\x03')
    await until(() => terminalOutput.includes('SIGNAL_RECEIVED:2'), `keyboard interrupt: ${terminalOutput}`)
    terminalRounds.push({ round, pid: terminal.pid, foreground, signalledGroup, signalAcknowledgments: 2 })
    await terminal.terminate(); await terminal.done
    terminal = undefined
  }
  passed('native-pty-input-foreground-signal-cleanup', { terminalRounds })

  terminal = await root.subprocess.spawnTerminal({ argv: ['/usr/local/bin/node', '-e', "console.log('DEFAULT_SIGNAL_READY');setInterval(()=>{},1000)"],
    cwd: workspace, rows: 24, cols: 80, graceMs: 200 })
  let defaultOutput = ''; terminal.output.on('data', bytes => { defaultOutput += bytes })
  await until(() => defaultOutput.includes('DEFAULT_SIGNAL_READY'), 'default signal command readiness')
  await terminal.signalForeground('SIGINT')
  const defaultOutcome = await terminal.done
  assert.equal(defaultOutcome.exitCode, 130)
  await terminal.terminate(); terminal = undefined
  passed('native-pty-default-interrupt-disposition-preserved', { outcome: defaultOutcome })

  const disposedMarker = `paimind-disposal-${randomUUID()}`
  const disposed = root.subprocess.spawn(spec(`console.log('${disposedMarker}');setInterval(()=>{},1000);`))
  await until(() => disposed.collected.stdout.readFrom(0).text.includes(disposedMarker), 'live disposal fixture')
  await root.fiber.dispose()
  assert.equal(await disposed.waitForExit(AbortSignal.timeout(5000)), true)
  assert.deepEqual(await ownedProcesses(disposedMarker), [])
  passed('native-provider-disposal-joins-live-tree')
  console.log(JSON.stringify({ status: 'NATIVE_SUBPROCESS_EXECUTION_DOMAIN_PASSED', checks,
    nativeReadonlyFileEffectsVerified: true, nativeWorkspaceWriteSameRootVerified: true,
    concurrentNativeFilePolicyVerified: true,
    nativeNestedWorkspaceFileEffectsVerified: true, directoryDescriptorTransportVerified: true,
    nestedNamespacePolicyVerified: false, nativeFilesystemProviderVerified: false,
    nativeSandboxCompositionVerified: false, codeRuntimeIsolationVerified: false, memberAdmissionVerified: false }))
} finally {
  await terminal?.terminate()
  await root.fiber.dispose()
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()))
  process.off('SIGUSR2', recordParentSignal)
}
