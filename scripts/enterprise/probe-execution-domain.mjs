import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probePersistentStorage } from './probe-persistent-storage.mjs'

// Feasibility evidence only: never changes the daemon, grants member admission,
// replaces a live cell, or relaxes any production/candidate launch policy.
const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
const nativeSubprocess = process.argv[2] === '--native-subprocess'
const nativeFilesystem = process.argv[2] === '--native-filesystem'
const nativeStoragePersistence = process.argv[2] === '--native-storage-persistence'
const nativeStorageRuntime = process.argv[2] === '--native-storage-runtime' || nativeStoragePersistence
const nativeStoragePreparation = process.argv[2] === '--native-storage-preparation' || nativeStorageRuntime
const nativeStorageDiscovery = process.argv[2] === '--native-storage-discovery' || nativeStoragePreparation
const nativeProfile = process.argv[2] === '--native-profile' || nativeStorageDiscovery
const nativeCode = process.argv[2] === '--native-code'
const nativeWorkflow = process.argv[2] === '--native-workflow'
const nativeHardlink = process.argv[2] === '--native-hardlink'
const nativeStorageScopes = process.argv[2] === '--native-storage-scopes'
const nativeStorageImport = process.argv[2] === '--native-storage-import' || nativeStorageScopes
const nativeStorage = process.argv[2] === '--native-storage' || nativeStorageImport
const nativeServices = nativeSubprocess || nativeFilesystem || nativeProfile || nativeCode || nativeWorkflow || nativeHardlink || nativeStorage
assert.ok(process.argv.length === 2 || process.argv.length === 3 && nativeServices)
assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(), 'codex/enterprise-haas-hybrid-refactor')
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }).trim()
const base = 'paimind-enterprise-runtime-candidate:12fffa008d84-2f324f3b'
const baseId = 'sha256:6bae85abfe775c5231b942a9f0fa9372bbb25e004b2ce76e6181dc61bd50ba9f'
assert.equal(JSON.parse(docker(['image', 'inspect', base]))[0].Id, baseId)
assert.equal(docker(['version', '--format', '{{.Server.Os}}/{{.Server.Arch}}']), 'linux/arm64')
process.umask(0o077)
const evidence = await mkdtemp(join(await realpath(join(root, '../.paimind-goal-evidence')), 'haas-execution-domain-'))
const context = join(evidence, 'context'); await mkdir(context)
const run = randomUUID(); const tag = `paimind-execution-domain-diagnostic:${run.slice(0, 8)}`
console.log(JSON.stringify({ state: 'PREPARING_EXECUTION_DOMAIN_PROBE', evidence, run }))
const upstreamUrl = 'https://raw.githubusercontent.com/moby/profiles/seccomp/v0.2.3/seccomp/default.json'
const upstreamSha256 = '536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74'
const response = await fetch(upstreamUrl, { signal: AbortSignal.timeout(15_000) })
assert.equal(response.status, 200)
const bytes = await response.text()
assert.equal(createHash('sha256').update(bytes).digest('hex'), upstreamSha256)
await writeFile(join(evidence, 'upstream-seccomp.json'), bytes, { flag: 'wx' })
const profile = JSON.parse(bytes)
assert.equal(profile.defaultAction, 'SCMP_ACT_ERRNO')
// This exact flags word is the bwrap clone for the five explicit
// namespaces below. No CAP_SYS_ADMIN, privileged container, setns or unconfined
// profile. The kernel still checks mount permissions in the owning user ns.
const cloneFlags = 17 | 0x20000 | 0x10000000 | 0x20000000 | 0x40000000 | 0x08000000 | 0x04000000
const additions = [
  { names: ['clone'], action: 'SCMP_ACT_ALLOW', args: [{ index: 0, value: cloneFlags, op: 'SCMP_CMP_EQ' }] },
  // This diagnostic alone places the whole trusted runtime in a storage mount
  // namespace, retaining its original container PID/proc view. Nested member
  // commands still use the original five-namespace flags. No unconfined clone.
  ...(nativeStorage ? [{ names: ['clone'], action: 'SCMP_ACT_ALLOW',
    args: [{ index: 0, value: cloneFlags & ~0x20000000, op: 'SCMP_CMP_EQ' }] }] : []),
  // Prepared runtime retains the container's existing network and PID view;
  // managed member commands retain the original five-namespace confinement.
  ...(nativeStorageRuntime ? [{ names: ['clone'], action: 'SCMP_ACT_ALLOW',
    args: [{ index: 0, value: cloneFlags & ~0x20000000 & ~0x40000000, op: 'SCMP_CMP_EQ' }] }] : []),
  { names: ['unshare'], action: 'SCMP_ACT_ALLOW', args: [{ index: 0, value: 0x10000000, op: 'SCMP_CMP_EQ' }] },
  { names: ['mount', 'umount2', 'pivot_root'], action: 'SCMP_ACT_ALLOW' },
]
profile.syscalls.push(...additions)
const policy = join(evidence, 'diagnostic-seccomp.json')
await writeFile(policy, JSON.stringify(profile), { flag: 'wx' })
const probeSource = nativeStorageDiscovery ? 'packages/harness-compat/tests/managed-storage-discovery-container.mjs' :
  nativeProfile ? 'packages/harness-compat/tests/managed-profile-container.mjs' :
  nativeStorage ? 'packages/harness-compat/tests/managed-storage-container.mjs' :
  nativeHardlink ? 'packages/harness-compat/tests/managed-hardlink-container.mjs' :
  nativeWorkflow ? 'packages/harness-compat/tests/managed-workflow-container.mjs' :
  nativeCode ? 'packages/harness-compat/tests/managed-code-container.mjs' :
  nativeFilesystem ? 'packages/harness-compat/tests/managed-filesystem-container.mjs' :
  nativeSubprocess ? 'packages/harness-compat/tests/managed-subprocess-container.mjs' : 'scripts/enterprise/probe-execution-domain-cell.mjs'
await copyFile(join(root, probeSource), join(context, 'probe.mjs'))
const additionalInputs = []
// The Bookworm 0.8 package lacks bind-fd and cannot safely mount a directory
// through a mutable pathname. Pin the official source release and its published
// asset digest; build without setuid support, in a disposable build stage.
const bubblewrapUrl = 'https://github.com/containers/bubblewrap/releases/download/v0.11.2/bubblewrap-0.11.2.tar.xz'
const bubblewrapSha256 = '69abc30005d2186baf7737feacd8da35633b93cf5af38838ecff17c5f8e924f6'
const bubblewrapAssetUrl = 'https://api.github.com/repos/containers/bubblewrap/releases/assets/403245431'
const bubblewrapResponse = await fetch(bubblewrapAssetUrl, { headers: { Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(20_000) })
assert.equal(bubblewrapResponse.status, 200)
const bubblewrapBytes = Buffer.from(await bubblewrapResponse.arrayBuffer())
assert.equal(createHash('sha256').update(bubblewrapBytes).digest('hex'), bubblewrapSha256)
await writeFile(join(context, 'bubblewrap.tar.xz'), bubblewrapBytes, { flag: 'wx' })
await copyFile(join(root, 'deploy/enterprise/worker/runtime/execution-launch.c'), join(context, 'execution-launch.c'))
additionalInputs.push({ source: 'deploy/enterprise/worker/runtime/execution-launch.c',
  sha256: createHash('sha256').update(await readFile(join(context, 'execution-launch.c'))).digest('hex') })
if (nativeServices) {
  for (const [source, destination] of [
    ['packages/harness-compat/lib/managed-subprocess.js', 'managed-subprocess.js'],
    ['packages/harness-compat/lib/managed-filesystem.js', 'managed-filesystem.js'],
    ['packages/harness-compat/package.json', 'compat-package.json'],
    ['deploy/enterprise/worker/runtime/confine-execution.mjs', 'confine-execution.mjs'],
    ...(nativeStorageDiscovery ? [
      ['deploy/enterprise/worker/runtime/boot-native-runtime.mjs', 'boot-native-runtime.mjs'],
      ['deploy/enterprise/worker/runtime/native-control.mjs', 'native-control.mjs'],
    ] : []),
    ...(nativeStoragePreparation ? [
      ['deploy/enterprise/worker/runtime/prepare-native-storage.mjs', 'prepare-native-storage.mjs'],
      ['deploy/enterprise/worker/runtime/prepared-storage.mjs', 'prepared-storage.mjs'],
      ['deploy/enterprise/worker/runtime/active-storage.mjs', 'active-storage.mjs'],
      ['deploy/enterprise/worker/runtime/storage-lock.mjs', 'storage-lock.mjs'],
      ['deploy/enterprise/worker/runtime/recover-native-storage.mjs', 'recover-native-storage.mjs'],
    ] : []),
    ...(nativeStorageRuntime ? [
      ['deploy/enterprise/worker/runtime/run-prepared-runtime.mjs', 'run-prepared-runtime.mjs'],
      ['deploy/enterprise/worker/runtime/start-native-runtime.mjs', 'start-native-runtime.mjs'],
      ['packages/harness-compat/tests/managed-storage-runtime-container.mjs', 'storage-runtime-check.mjs'],
      ['packages/harness-compat/tests/managed-storage-advance-container.mjs', 'storage-advance-check.mjs'],
      ['packages/harness-compat/tests/managed-storage-persistence-container.mjs', 'storage-persistence-check.mjs'],
    ] : []),
    ...(nativeFilesystem ? [['packages/harness-compat/tests/managed-filesystem-checkpoints.mjs', 'filesystem-checkpoints.mjs']] : []),
    ...(nativeCode || nativeProfile ? [['packages/harness-compat/lib/managed-code-runtime.js', 'managed-code-runtime.js']] : []),
    ...(nativeWorkflow || nativeProfile ? [['packages/harness-compat/lib/managed-workflow.js', 'managed-workflow.js']] : []),
    ...(nativeProfile ? [
      ['packages/harness-compat/lib/managed-runtime.js', 'managed-runtime.js'],
      ['packages/skill-market/lib/index.js', 'skill-market.js'],
      ['apps/enterprise-worker-runtime/package.json', 'runtime-package.json'],
      ...['package.json', 'cordis.yml', 'cordis.patch.yml'].map(file => [
        `deploy/enterprise/worker/runtime/managed-profile/${file}`, `profile/${file}`]),
    ] : []),
  ]) {
    await mkdir(dirname(join(context, destination)), { recursive: true })
    await copyFile(join(root, source), join(context, destination))
    additionalInputs.push({ source, sha256: createHash('sha256').update(await readFile(join(context, destination))).digest('hex') })
  }
  if (nativeProfile) {
    // Diagnostic member world only, appended to an owned disposable overlay;
    // ordinary candidate profile/launcher remain unchanged and not admitted.
    const resourceConfiguration = [{ id: 'paimind-skill-market', config: { skillRoot: nativeStorageRuntime
      ? '/var/lib/paimind/resources/skills' : '/var/lib/paimind/resources/hansen/skills' } }]
    const patchFile = join(context, 'profile/cordis.patch.yml')
    await writeFile(patchFile, (await readFile(patchFile, 'utf8')) + '\n'
      + resourceConfiguration.map(row => `- ${JSON.stringify(row)}\n`).join(''))
    additionalInputs.push({ diagnosticResourceConfiguration: resourceConfiguration,
      projectedPatchSha256: createHash('sha256').update(await readFile(patchFile)).digest('hex') })
  }
  // Diagnostic-only projection into the existing pinned native closure. No
  // package download, upstream modification or current full-image acceptance.
  await writeFile(join(context, 'prepare-native.mjs'), `
import assert from 'node:assert/strict';import{chmodSync,copyFileSync,readFileSync,realpathSync,symlinkSync}from'node:fs';
import{dirname,join,relative}from'node:path';import{createRequire}from'node:module';
const root='/opt/paimind',admin=realpathSync(root+'/node_modules/@paimind/enterprise-admin');
const compat=dirname(dirname(createRequire(admin+'/package.json').resolve('@paimind/harness-compat/host')));
const baseRequire=createRequire(realpathSync(root+'/node_modules/@deepseek-ai/dsh-base/package.json'));assert.ok(compat.startsWith(root+'/'));
const local=dirname(dirname(baseRequire.resolve('@deepseek-ai/dsh-subprocess-local')));
const nativeRequire=createRequire(local+'/package.json');
const fsRequire=createRequire(baseRequire.resolve('@deepseek-ai/dsh-fs-local/package.json'));
const appRequire=createRequire(realpathSync(root+'/node_modules/@deepseek-ai/dsh/package.json'));
${nativeProfile ? `const loader=realpathSync(appRequire.resolve('@deepseek-ai/cordis-plugin-loader/package.json'));
assert.equal(JSON.parse(readFileSync(loader)).version,'1.0.2');
const loaderDest=join(dirname(dirname(compat)),'@deepseek-ai/cordis-plugin-loader');
try{symlinkSync(relative(dirname(loaderDest),dirname(loader)),loaderDest)}catch(e){if(e.code!=='EEXIST')throw e;assert.equal(realpathSync(loaderDest),dirname(loader))}` : ''}
symlinkSync(relative(root+'/node_modules/@paimind',compat),root+'/node_modules/@paimind/harness-compat');
for(const name of ['dsh-subprocess','dsh-subprocess-local','dsh-fs','dsh-fs-local','dsh-fs-sandbox','dsh-sandbox-policy',
 ...${JSON.stringify(nativeCode || nativeProfile ? ['dsh-code-runtime', 'dsh-code-runtime-worker-thread'] : [])},
 ...${JSON.stringify(nativeWorkflow || nativeProfile ? ['dsh-workflow', 'dsh-workflow-worker-thread'] : [])},
 ...${JSON.stringify(nativeProfile ? ['dsh-app-boot', 'dsh-cmdline', 'dsh-launch-environment'] : [])}]){
 const owner=['dsh-app-boot','dsh-cmdline','dsh-launch-environment'].includes(name)?appRequire:name==='dsh-fs'?fsRequire:name.startsWith('dsh-subprocess')?nativeRequire:baseRequire;
 const source=realpathSync(dirname(dirname(owner.resolve('@deepseek-ai/'+name))));
 const p=JSON.parse(readFileSync(join(source,'package.json')));assert.equal(p.name,'@deepseek-ai/'+name);assert.equal(p.version,'0.1.1-rc.2');assert.ok(source.startsWith(root+'/'));
 const dest=join(dirname(dirname(compat)),'@deepseek-ai',name);
 try{symlinkSync(relative(dirname(dest),source),dest)}catch(e){if(e.code!=='EEXIST')throw e;assert.equal(realpathSync(dest),source)}
}
copyFileSync('/usr/local/lib/paimind/managed-subprocess.js',compat+'/lib/managed-subprocess.js');
copyFileSync('/usr/local/lib/paimind/managed-filesystem.js',compat+'/lib/managed-filesystem.js');
copyFileSync('/usr/local/lib/paimind/compat-package.json',compat+'/package.json');
${nativeCode || nativeProfile ? "copyFileSync('/usr/local/lib/paimind/managed-code-runtime.js',compat+'/lib/managed-code-runtime.js');" : ''}
${nativeWorkflow || nativeProfile ? "copyFileSync('/usr/local/lib/paimind/managed-workflow.js',compat+'/lib/managed-workflow.js');" : ''}
${nativeProfile ? `copyFileSync('/usr/local/lib/paimind/managed-runtime.js',compat+'/lib/managed-runtime.js');
const bundleRequire=createRequire(realpathSync(root+'/node_modules/@paimind/harness-bundle/package.json'));
const skill=dirname(dirname(bundleRequire.resolve('@paimind/skill-market')));
assert.ok(skill.startsWith(root+'/'));assert.equal(JSON.parse(readFileSync(skill+'/package.json')).name,'@paimind/skill-market');
copyFileSync('/usr/local/lib/paimind/skill-market.js',skill+'/lib/index.js');
copyFileSync('/usr/local/lib/paimind/runtime-package.json',root+'/package.json');
const {prepareManagedHarnessModuleRoot}=await import(compat+'/lib/managed-runtime.js');
prepareManagedHarnessModuleRoot(root);chmodSync(root+'/profiles',0o555);chmodSync(root+'/profiles/node_modules',0o555);
symlinkSync(root+'/node_modules','/usr/share/paimind/managed/profiles/web/node_modules');
symlinkSync(root+'/profiles/node_modules','/usr/share/paimind/managed/profiles/node_modules');` : ''}
`)
}
await writeFile(join(context, 'Dockerfile'), `FROM ${base} AS execution-tools
USER 0:0
RUN apt-get update && apt-get install --yes --no-install-recommends gcc libc6-dev meson ninja-build pkg-config libcap-dev xz-utils
COPY --chown=0:0 --chmod=0444 bubblewrap.tar.xz /build/
RUN cd /build && sha256sum bubblewrap.tar.xz && tar -xf bubblewrap.tar.xz && meson setup build bubblewrap-0.11.2 --prefix=/usr/local -Dsupport_setuid=false -Dselinux=disabled -Dman=disabled -Dtests=false -Dbash_completion=disabled -Dzsh_completion=disabled && ninja -C build && test "$(build/bwrap --version)" = "bubblewrap 0.11.2"
COPY --chown=0:0 --chmod=0444 execution-launch.c /build/
RUN gcc -std=c11 -Wall -Wextra -Werror -Wformat=2 -Wconversion -Wshadow -O2 -fstack-protector-strong -D_FORTIFY_SOURCE=2 -Wl,-z,relro,-z,now -o /build/execution-launch /build/execution-launch.c
FROM ${base}
USER 0:0
RUN apt-get update && apt-get install --yes --no-install-recommends libcap2
COPY --from=execution-tools --chown=0:0 --chmod=0555 /build/build/bwrap /usr/local/bin/bwrap
COPY --from=execution-tools --chown=0:0 --chmod=0555 /build/execution-launch /usr/local/libexec/paimind-execution-launch
COPY --chown=0:0 --chmod=0444 probe.mjs /usr/local/lib/paimind/execution-domain-probe.mjs
${nativeStorageDiscovery ? 'COPY --chown=0:0 --chmod=0444 boot-native-runtime.mjs native-control.mjs /usr/local/lib/paimind/' : ''}
${nativeStoragePreparation ? 'COPY --chown=0:0 --chmod=0444 prepare-native-storage.mjs prepared-storage.mjs active-storage.mjs storage-lock.mjs recover-native-storage.mjs /usr/local/lib/paimind/' : ''}
${nativeStorageRuntime ? 'COPY --chown=0:0 --chmod=0444 run-prepared-runtime.mjs start-native-runtime.mjs storage-runtime-check.mjs storage-advance-check.mjs storage-persistence-check.mjs /usr/local/lib/paimind/' : ''}
${nativeFilesystem ? 'COPY --chown=0:0 --chmod=0444 filesystem-checkpoints.mjs /usr/local/lib/paimind/' : ''}
${nativeCode || nativeProfile ? 'COPY --chown=0:0 --chmod=0444 managed-code-runtime.js /usr/local/lib/paimind/' : ''}
${nativeWorkflow || nativeProfile ? 'COPY --chown=0:0 --chmod=0444 managed-workflow.js /usr/local/lib/paimind/' : ''}
${nativeProfile ? 'COPY --chown=0:0 --chmod=0444 managed-runtime.js skill-market.js runtime-package.json /usr/local/lib/paimind/\nCOPY --chown=0:0 --chmod=0444 profile/ /usr/share/paimind/managed/profiles/web/\nRUN chmod 0555 /usr/share/paimind /usr/share/paimind/managed /usr/share/paimind/managed/profiles /usr/share/paimind/managed/profiles/web' : ''}
${nativeServices ? 'COPY --chown=0:0 --chmod=0444 managed-subprocess.js managed-filesystem.js compat-package.json confine-execution.mjs prepare-native.mjs /usr/local/lib/paimind/\nRUN chmod 0555 /usr/local/lib/paimind && node /usr/local/lib/paimind/prepare-native.mjs' : ''}
RUN chmod 0555 /usr/local/lib/paimind
LABEL io.paimind.acceptance="execution-domain-diagnostic-not-admitted"
USER 10001:10001
ENTRYPOINT ${JSON.stringify(['/usr/local/bin/node', '/usr/local/lib/paimind/execution-domain-probe.mjs', ...(nativeStoragePersistence ? ['--run-storage', '--activate-for-replacement'] : nativeStorageRuntime ? ['--run-storage'] : nativeStoragePreparation ? ['--prepare-storage'] : nativeStorageScopes ? ['--materialized-scopes'] : nativeStorageImport ? ['--materialized'] : [])])}
`)
await writeFile(join(evidence, 'inputs.json'), JSON.stringify({ run, baseId, upstreamUrl, upstreamSha256, additions, bubblewrapUrl, bubblewrapAssetUrl, bubblewrapSha256,
  hostInputs: await Promise.all(['scripts/enterprise/probe-execution-domain.mjs',
    ...(nativeStoragePersistence ? ['scripts/enterprise/probe-persistent-storage.mjs', 'deploy/enterprise/controller/offline-storage.mjs'] : [])].map(async source => ({ source,
      sha256: createHash('sha256').update(await readFile(join(root, source))).digest('hex') }))),
  probeSha256: createHash('sha256').update(await readFile(join(context, 'probe.mjs'))).digest('hex'),
  nativeSubprocess, nativeFilesystem, nativeProfile, nativeCode, nativeWorkflow, nativeHardlink, nativeStorage, nativeStorageImport, nativeStorageScopes, nativeStorageDiscovery, nativeStoragePreparation, nativeStorageRuntime, nativeStoragePersistence, additionalInputs, diagnosticOnly: true, productionPolicyChanged: false }, null, 2))
console.log(JSON.stringify({ state: 'BUILDING_EXECUTION_DOMAIN_PROBE', evidence, run }))
const log = createWriteStream(join(evidence, 'build.log'), { flags: 'wx' })
const build = spawn('docker', ['buildx', 'build', '--platform=linux/arm64', '--load', '--progress=plain',
  '--tag', tag, '--iidfile', join(evidence, 'image-id.txt'), context], { stdio: ['ignore', 'pipe', 'pipe'] })
for (const stream of [build.stdout, build.stderr]) stream.on('data', bytes => { log.write(bytes); process.stdout.write(bytes) })
const buildCode = await new Promise((done, reject) => { build.once('error', reject); build.once('close', done) })
await new Promise(done => log.end(done)); assert.equal(buildCode, 0)
const imageId = (await readFile(join(evidence, 'image-id.txt'), 'utf8')).trim()
if (nativeStoragePersistence) {
  await probePersistentStorage({ evidence, imageId, policy, run })
} else {
const name = `paimind-execution-domain-${run.slice(0, 8)}`
const id = docker(['create', '--init', '--name', name, '--read-only', '--network', 'none', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges:true', '--security-opt', `seccomp=${policy}`,
  '--memory', nativeProfile ? '1g' : '512m', '--cpus', '1', '--pids-limit', nativeProfile ? '256' : '128',
  '--tmpfs', '/var/lib/paimind:rw,nosuid,nodev,uid=10001,gid=10001,mode=0700,size=67108864',
  '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777,size=67108864',
  '--label', 'io.paimind.goal=enterprise-haas-execution-domain', '--label', `io.paimind.run=${run}`, imageId])
const inspect = () => {
  const [s] = JSON.parse(docker(['inspect', id]))
  assert.equal(s.Id, id); assert.equal(s.Image, imageId); assert.equal(s.Name, `/${name}`)
  assert.equal(s.Config.Labels['io.paimind.run'], run); assert.equal(s.Config.Labels['io.paimind.goal'], 'enterprise-haas-execution-domain')
  assert.equal(s.Config.User, '10001:10001'); assert.equal(s.HostConfig.Privileged, false)
  assert.equal(s.HostConfig.ReadonlyRootfs, true); assert.equal(s.HostConfig.NetworkMode, 'none')
  assert.deepEqual(s.HostConfig.CapDrop, ['ALL']); assert.ok(!s.HostConfig.CapAdd?.length)
  assert.ok(!s.HostConfig.Binds?.length && !s.Mounts.length && !Object.keys(s.HostConfig.PortBindings ?? {}).length)
  return s
}
await writeFile(join(evidence, 'container.json'), JSON.stringify(inspect()))
try {
  docker(['start', id])
  const wait = spawn('docker', ['wait', id], { stdio: ['ignore', 'pipe', 'inherit'] })
  let code = ''; wait.stdout.on('data', bytes => { code += bytes })
  const watchdog = setTimeout(() => { inspect(); docker(['stop', '--time', '5', id]) }, nativeProfile ? 210_000 : 45_000)
  try {
    assert.equal(await new Promise((done, reject) => { wait.once('error', reject); wait.once('close', done) }), 0)
  } finally { clearTimeout(watchdog) }
  const state = inspect(); assert.equal(state.State.Running, false)
  const logs = spawnSync('docker', ['logs', id], { encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024 })
  assert.equal(logs.status, 0); assert.ok(!logs.error)
  const output = logs.stdout + logs.stderr
  await writeFile(join(evidence, 'execution.log'), output, { flag: 'wx' })
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ imageId, state: state.State,
    output, diagnosticOnly: true, memberAdmissionVerified: false }, null, 2))
  console.log(JSON.stringify({ evidence, code: code.trim(), output, memberAdmissionVerified: false }))
  assert.equal(code.trim(), '0'); assert.equal(state.State.ExitCode, 0)
} finally {
  const before = inspect(); if (before.State.Running) docker(['stop', '--time', '5', id])
  const stopped = inspect(); assert.equal(stopped.State.Running, false)
  docker(['rm', id])
  await writeFile(join(evidence, 'stopped.json'), JSON.stringify({ state: stopped.State, removedContainer: id, userVolumesRemoved: false }))
}
}
