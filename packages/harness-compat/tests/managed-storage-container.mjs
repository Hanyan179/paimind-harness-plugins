import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile, link, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createCandidateExecutionDomain } from '/usr/local/lib/paimind/confine-execution.mjs'

// Feasibility only: a single mount per workspace covers the whole lifetime
// of a native runtime, NOT a new temporary/competing mount per operation.
// No production launcher, admission policy or member volume is changed here.
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 10001)
const data = '/var/lib/paimind'
const workspace = data + '/workspaces/hansen'
const client = workspace + '/client-project'
const neighbor = workspace + '/internal-project'
const nested = client + '/nested-project'
const storage = data + '/storage-diagnostic'
const domain = createCandidateExecutionDomain(workspace)

async function captured(argv) {
  const child = spawn(argv[0], argv.slice(1), { env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''; let stderr = ''
  child.stdout.on('data', bytes => { stdout += bytes })
  child.stderr.on('data', bytes => { stderr += bytes })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15_000)
  try {
    const exit = await new Promise((done, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => done({ code, signal }))
    })
    assert.deepEqual(exit, { code: 0, signal: null }, stderr + stdout)
    return { stdout, stderr }
  } finally { clearTimeout(timeout) }
}

if (process.argv[2] === '--inside') {
  const boot = Number(process.argv[3]); assert.ok(boot === 1 || boot === 2)
  const require = createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
  const base = createRequire(await realpath('/opt/paimind/node_modules/@deepseek-ai/dsh-base/package.json'))
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const { LocalSandboxProvider } = await import(pathToFileURL(base.resolve('@deepseek-ai/dsh-sandbox-local')).href)
  const { SandboxPolicyService } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-sandbox-policy')).href)
  const { createManagedHarnessSubprocessProvider } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-subprocess')).href)
  const { createManagedHarnessFilesystemProvider } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-filesystem')).href)
  const root = new Context(); const checks = {}
  const policy = { mode: 'workspace-write', workspaceRoot: client }
  try {
    await root.plugin(LocalSandboxProvider)
    await root.plugin(SandboxPolicyService, policy)
    await root.plugin(createManagedHarnessSubprocessProvider(domain, root.sandbox))
    await root.plugin(createManagedHarnessFilesystemProvider({ executionWorld: domain }), { cwd: workspace })
    const targetFor = name => root.fs.resolve(client + '/' + name)
    async function command(code, selected = policy) {
      const argv = root.sandbox.confine(['/usr/local/bin/node', '--input-type=module', '-e', code], selected).argv
      const handle = root.subprocess.spawn({ argv, cwd: client, graceMs: 200,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: { maxBytes: 8192 } } })
      try {
        assert.equal((await handle.done).exitCode, 0, handle.collected.stderr.readFrom(0).text)
        await handle.waitForExit()
        return JSON.parse(handle.collected.stdout.readFrom(0).text)
      } finally { handle.terminate(); await handle.waitForExit() }
    }
    if (boot === 1) {
      const mutations = await command(`import{writeFile,chmod,readFile,stat,link}from'node:fs/promises';
        await writeFile('${client}/external-alias','client-change');await chmod('${client}/external-alias',0o640);
        await writeFile('${client}/legal-one','legal-change');
        const newFile='${client}/new-one';await writeFile(newFile,'upper-original');await link(newFile,'${client}/new-two');
        await writeFile('${client}/new-two','upper-updated');
        const blocked={};for(const p of ['${storage}','${data}/dsh-home','${data}/workspaces/alex','/proc']){
          try{await stat(p);blocked[p]='VISIBLE'}catch(e){blocked[p]=e.code}}
        console.log(JSON.stringify({peer:await readFile('${neighbor}/external-original','utf8'),
          peerMode:(await stat('${neighbor}/external-original')).mode&511,
          importedLegalPeer:await readFile('${client}/legal-two','utf8'),
          newLegalPeer:await readFile(newFile,'utf8'),blocked}));`)
      checks.existingCrossWorkspaceAliasSeparated = mutations.peer === 'outside-original' && mutations.peerMode === 0o600
      checks.importedSameWorkspaceHardlinksPreserved = mutations.importedLegalPeer === 'legal-change'
      checks.newSameWorkspaceHardlinksPreserved = mutations.newLegalPeer === 'upper-updated'
      checks.rawStorageAndPrivateStateHidden = Object.values(mutations.blocked).every(code => code === 'ENOENT')

      // Even a broader same-member command cannot add a new cross-mount link.
      const cross = await command(`import{link}from'node:fs/promises';let result;
        try{await link('${neighbor}/external-original','${client}/new-cross-link');result='ALLOWED'}catch(e){result=e.code}
        console.log(JSON.stringify({result}));`, { mode: 'workspace-write', workspaceRoot: workspace })
      checks.broaderWriterCannotCreateCrossWorkspaceHardlink = cross.result === 'EXDEV'

      const target = await targetFor('native-receipt')
      const created = await root.fs.writeText(target, 'native-created', { kind: 'createIfAbsent' })
      assert.equal(created.operation, 'create')
      const observation = await command(`import{readFile,writeFile}from'node:fs/promises';
        const text=await readFile('${client}/native-receipt','utf8');await writeFile('${client}/command-receipt','command-created');
        console.log(JSON.stringify({text}));`)
      checks.nativeFilesystemAndCommandShareView = observation.text === 'native-created' &&
        await root.fs.readText(await targetFor('command-receipt')) === 'command-created'
      const writes = await Promise.allSettled(['winner-one', 'winner-two'].map(value => root.fs.writeText(target, value,
        { kind: 'replaceIfVersion', version: created.version })))
      checks.nativeConcurrentVersionGuard = writes.filter(row => row.status === 'fulfilled').length === 1 &&
        writes.filter(row => row.status === 'rejected').every(row => row.reason.code === 'FS_STALE_VERSION')
      // Persist deletions as well as creations, without exposing layer files to commands.
      await command(`import{unlink}from'node:fs/promises';await unlink('${client}/remove-me');console.log('{}');`)
      // Native session cwd can be narrower than a provisioned workspace. A
      // top-level-only storage result must not silently claim that case passes.
      const narrowed = await command(`import{writeFile,readFile}from'node:fs/promises';
        await writeFile('${nested}/alias','nested-change');await writeFile('${nested}/legal-one','nested-legal-change');
        console.log(JSON.stringify({outer:await readFile('${client}/outer-owned','utf8'),legal:await readFile('${nested}/legal-two','utf8')}));`,
      { mode: 'workspace-write', workspaceRoot: nested })
      checks.narrowedDescendantAliasSeparated = narrowed.outer === 'outer-original'
      checks.narrowedDescendantLegalLinksPreserved = narrowed.legal === 'nested-legal-change'
      const crossNested = await command(`import{link}from'node:fs/promises';let result;
        try{await link('${client}/outer-owned','${nested}/new-cross-alias');result='ALLOWED'}catch(e){result=e.code}
        console.log(JSON.stringify({result}));`)
      checks.broaderWriterCannotCreateNarrowedDescendantAlias = crossNested.result === 'EXDEV'
    } else {
      checks.restartPreservesNativeAndCommandWrites =
        ['winner-one', 'winner-two'].includes(await root.fs.readText(await targetFor('native-receipt'))) &&
        await root.fs.readText(await targetFor('command-receipt')) === 'command-created'
      checks.restartPreservesDeletion = await root.fs.stat(await targetFor('remove-me')) === undefined
      checks.restartPreservesNewHardlinkIdentity = (await stat(client + '/new-one')).ino === (await stat(client + '/new-two')).ino
      checks.restartPreservesNeighbor = await readFile(neighbor + '/external-original', 'utf8') === 'outside-original'
      checks.restartPreservesNarrowedIsolationAndLegalLinks = await readFile(client + '/outer-owned', 'utf8') === 'outer-original' &&
        await readFile(nested + '/alias', 'utf8') === 'nested-change' &&
        (await stat(nested + '/legal-one')).ino === (await stat(nested + '/legal-two')).ino
    }
    console.log(JSON.stringify({ nativeWorkspaceStorageBoot: boot, checks, memberAdmissionVerified: false }))
  } finally { await root.fiber.dispose() }
} else {
  const scopes = process.argv[2] === '--materialized-scopes'
  const materialized = process.argv[2] === '--materialized' || scopes
  assert.ok(process.argv.length === 2 || process.argv.length === 3 && materialized)
  for (const path of [workspace, domain.resourceRoot, domain.temporaryRoot, data + '/dsh-home', data + '/workspaces/alex',
    ...['client-lower', 'client-upper', 'client-work', 'neighbor-lower', 'neighbor-upper', 'neighbor-work',
      'nested-upper', 'client-lower/nested-project'].map(name => storage + '/' + name)]) {
    await mkdir(path, { recursive: true, mode: 0o700 })
  }
  const source = storage + '/neighbor-lower/external-original'
  await writeFile(data + '/dsh-home/private-canary', 'controller-private', { mode: 0o600, flag: 'wx' })
  await writeFile(data + '/workspaces/alex/Alex-private.txt', 'Alex-private', { mode: 0o600, flag: 'wx' })
  await writeFile(source, 'outside-original', { mode: 0o600, flag: 'wx' })
  await link(source, storage + '/client-lower/external-alias')
  await writeFile(storage + '/client-lower/legal-one', 'legal-original', { mode: 0o600, flag: 'wx' })
  await link(storage + '/client-lower/legal-one', storage + '/client-lower/legal-two')
  await writeFile(storage + '/client-lower/remove-me', 'remove-after-mount', { flag: 'wx' })
  await writeFile(storage + '/client-lower/outer-owned', 'outer-original', { mode: 0o600, flag: 'wx' })
  await link(storage + '/client-lower/outer-owned', storage + '/client-lower/nested-project/alias')
  await writeFile(storage + '/client-lower/nested-project/legal-one', 'nested-legal-original', { mode: 0o600, flag: 'wx' })
  await link(storage + '/client-lower/nested-project/legal-one', storage + '/client-lower/nested-project/legal-two')
  if (materialized) {
    // Two independent, offline imports: cp's in-command inode map preserves
    // links WITHIN each source but never aliases two separate workspace copies.
    // There is no concurrent writer, scanned-live-tree claim, or runtime copyback.
    for (const name of ['client', 'neighbor']) {
      await captured(['/usr/bin/cp', '--archive', storage + '/' + name + '-lower/.', storage + '/' + name + '-upper/'])
    }
    if (scopes) await captured(['/usr/bin/cp', '--archive', storage + '/client-lower/nested-project/.', storage + '/nested-upper/'])
    assert.equal((await stat(storage + '/client-upper/legal-one')).ino, (await stat(storage + '/client-upper/legal-two')).ino)
    assert.notEqual((await stat(storage + '/client-upper/external-alias')).ino, (await stat(storage + '/neighbor-upper/external-original')).ino)
  }
  const boots = []
  for (const boot of [1, 2]) {
    const result = await captured(['/usr/local/bin/bwrap', '--unshare-user', '--unshare-ipc', '--unshare-net',
      '--unshare-uts', '--die-with-parent', '--new-session', '--ro-bind', '/usr', '/usr',
      '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--ro-bind', '/opt/paimind', '/opt/paimind',
      // The trusted runtime needs the existing proc view for its nested native
      // launcher (including its own uid_map writes). Docker masks prohibit a
      // new proc mount here; inherit the same masked view without removing its
      // read-only submounts. Managed member commands still receive NO /proc.
      '--dev', '/dev', '--bind', '/proc', '/proc', '--bind', data, data, '--tmpfs', '/tmp',
      ...(materialized ? ['--bind', storage + '/client-upper', client, '--bind', storage + '/neighbor-upper', neighbor,
        ...(scopes ? ['--bind', storage + '/nested-upper', nested] : [])] : [
        '--overlay-src', storage + '/client-lower', '--overlay', storage + '/client-upper', storage + '/client-work', client,
        '--overlay-src', storage + '/neighbor-lower', '--overlay', storage + '/neighbor-upper', storage + '/neighbor-work', neighbor]),
      '--chdir', client, '--clearenv', '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin', '--',
      '/usr/local/bin/node', '/usr/local/lib/paimind/execution-domain-probe.mjs', '--inside', String(boot)])
    process.stdout.write(result.stdout); process.stderr.write(result.stderr)
    const row = result.stdout.trim().split('\n').map(line => { try { return JSON.parse(line) } catch { return {} } })
      .find(row => row.nativeWorkspaceStorageBoot === boot)
    assert.ok(row); boots.push(row)
  }
  assert.equal(await readFile(source, 'utf8'), 'outside-original')
  assert.equal((await stat(source)).mode & 0o777, 0o600)
  assert.equal(await readFile(data + '/dsh-home/private-canary', 'utf8'), 'controller-private')
  assert.equal(await readFile(data + '/workspaces/alex/Alex-private.txt', 'utf8'), 'Alex-private')
  const failures = boots.flatMap(row => Object.entries(row.checks).filter(([, passed]) => !passed)
    .map(([name]) => ({ boot: row.nativeWorkspaceStorageBoot, name })))
  console.log(JSON.stringify({ nativeWorkspaceStorage: scopes ? 'offline-import-scope-mount-feasibility' :
    materialized ? 'offline-import-bind-feasibility' : 'persistent-overlay-feasibility', boots, failures,
    sourceUnchanged: true, memberAdmissionVerified: false, finalWorkerVerified: false,
    dynamicNativeWorkspaceProvisioningVerified: false, unprovisionedPolicyRootAdmissionVerified: false }))
  assert.deepEqual(failures, [], 'Storage feasibility does not pass when legitimate native semantics are lost')
}
