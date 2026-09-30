import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
const docker = args => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60_000 }).trim()
const dockerLogs = id => {
  const result = spawnSync('docker', ['logs', id], { encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
  assert.equal(result.status, 0); assert.equal(result.signal, null); assert.ok(!result.error)
  return result.stdout + result.stderr
}
assert.equal(process.argv.length, 2)
assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(), 'codex/enterprise-haas-hybrid-refactor')
const base = 'sha256:6bae85abfe775c5231b942a9f0fa9372bbb25e004b2ce76e6181dc61bd50ba9f'
const baseTag = 'paimind-enterprise-runtime-candidate:12fffa008d84-2f324f3b'
const [baseInfo] = JSON.parse(docker(['image', 'inspect', base]))
assert.equal(baseInfo.Id, base); assert.equal(baseInfo.Config.User, '10001:10001')
assert.equal(JSON.parse(docker(['image', 'inspect', baseTag]))[0].Id, base)
assert.equal(baseInfo.Config.Labels['io.paimind.acceptance'], 'native-runtime-candidate-not-admitted')
process.umask(0o077)
const evidence = await mkdtemp(join(await realpath(join(root, '../.paimind-goal-evidence')), 'haas-managed-native-'))
const context = join(evidence, 'context'); await mkdir(context)
const run = randomUUID(); const tag = `paimind-managed-native-diagnostic:${run.slice(0, 8)}`
const inputs = [
  ['packages/harness-compat/lib/managed-runtime.js', 'managed-runtime.js'],
  ['packages/harness-compat/package.json', 'compat-package.json'],
  ['apps/enterprise-worker-runtime/package.json', 'runtime-package.json'],
  ['deploy/enterprise/worker/runtime/start-native-runtime.mjs', 'start-native-runtime.mjs'],
  ['deploy/enterprise/worker/runtime/native-control.mjs', 'native-control.mjs'],
  ['deploy/enterprise/worker/runtime/boot-native-runtime.mjs', 'boot-native-runtime.mjs'],
  ['scripts/enterprise/probe-managed-runtime.mjs', 'probe-managed-runtime.mjs'],
  ...['package.json', 'cordis.yml', 'cordis.patch.yml'].map(file => [`deploy/enterprise/worker/runtime/managed-profile/${file}`, `profile/${file}`]),
]
const captured = []
for (const [source, destination] of inputs) {
  await mkdir(dirname(join(context, destination)), { recursive: true })
  await copyFile(join(root, source), join(context, destination))
  captured.push({ source, sha256: createHash('sha256').update(await readFile(join(context, destination))).digest('hex') })
}
await writeFile(join(evidence, 'inputs.json'), JSON.stringify({ run, base, captured, diagnosticOnly: true }))
// A derived image is deliberately NOT current-source install/build proof.
// Added declared dependencies already exist in the pinned native app. Resolve
// and verify those exact existing packages instead of fetching new content.
const prepare = `import assert from 'node:assert/strict';import{copyFileSync,readFileSync,realpathSync,symlinkSync}from'node:fs';import{dirname,join,relative}from'node:path';import{createRequire}from'node:module';
const root='/opt/paimind',admin=realpathSync(root+'/node_modules/@paimind/enterprise-admin'),compat=dirname(dirname(createRequire(admin+'/package.json').resolve('@paimind/harness-compat/host'))),app=realpathSync(root+'/node_modules/@deepseek-ai/dsh');
assert.ok(compat.startsWith(root+'/'));const direct=root+'/node_modules/@paimind/harness-compat';symlinkSync(relative(dirname(direct),compat),direct);copyFileSync('/usr/local/lib/paimind/runtime-package.json',root+'/package.json');
for(const name of ['dsh-app-boot','dsh-cmdline','dsh-launch-environment']){const source=realpathSync(join(dirname(dirname(app)),'@deepseek-ai',name));const p=JSON.parse(readFileSync(join(source,'package.json')));assert.equal(p.name,'@deepseek-ai/'+name);assert.equal(p.version,'0.1.1-rc.2');assert.ok(source.startsWith(root+'/'));const dest=join(dirname(dirname(compat)),'@deepseek-ai',name);try{symlinkSync(relative(dirname(dest),source),dest)}catch(e){if(e.code!=='EEXIST')throw e;assert.equal(realpathSync(dest),source)}}
copyFileSync('/usr/local/lib/paimind/managed-runtime.js',compat+'/lib/managed-runtime.js');copyFileSync('/usr/local/lib/paimind/compat-package.json',compat+'/package.json');
const{prepareManagedHarnessModuleRoot}=await import(compat+'/lib/managed-runtime.js');prepareManagedHarnessModuleRoot(root);`
await writeFile(join(context, 'prepare.mjs'), prepare)
await writeFile(join(context, 'Dockerfile'), `FROM ${baseTag}
USER 0:0
COPY --chown=0:0 --chmod=0444 *.mjs *.js *.json /usr/local/lib/paimind/
COPY --chown=0:0 --chmod=0444 profile/ /usr/share/paimind/managed/profiles/web/
RUN chmod 0555 /usr/local/lib/paimind /usr/share/paimind /usr/share/paimind/managed /usr/share/paimind/managed/profiles /usr/share/paimind/managed/profiles/web && ln -s /opt/paimind/node_modules /usr/share/paimind/managed/profiles/web/node_modules && node /usr/local/lib/paimind/prepare.mjs && chmod 0555 /opt/paimind/profiles /opt/paimind/profiles/node_modules
LABEL io.paimind.acceptance="managed-native-diagnostic-not-admitted"
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/node","/usr/local/lib/paimind/probe-managed-runtime.mjs"]
`)
console.log(JSON.stringify({ state: 'BUILDING_MANAGED_NATIVE_DIAGNOSTIC', evidence, run, base }))
const log = createWriteStream(join(evidence, 'build.log'), { flags: 'wx' })
const build = spawn('docker', ['buildx', 'build', '--network=none', '--platform=linux/arm64', '--load', '--progress=plain',
  '--tag', tag, '--iidfile', join(evidence, 'image-id.txt'), context], { stdio: ['ignore', 'pipe', 'pipe'] })
for (const stream of [build.stdout, build.stderr]) stream.on('data', bytes => { log.write(bytes); process.stdout.write(bytes) })
const buildCode = await new Promise((done, reject) => { build.once('error', reject); build.once('close', done) })
await new Promise(done => log.end(done)); assert.equal(buildCode, 0)
const imageId = (await readFile(join(evidence, 'image-id.txt'), 'utf8')).trim()
const name = `paimind-managed-native-${run.slice(0, 8)}`
const id = docker(['create', '--init', '--name', name, '--read-only', '--network', 'none', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges:true', '--memory', '1g', '--cpus', '1', '--pids-limit', '256',
  '--tmpfs', '/var/lib/paimind:rw,nosuid,nodev,uid=10001,gid=10001,mode=0700,size=268435456',
  '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777,size=134217728',
  '--label', 'io.paimind.goal=enterprise-haas-managed-diagnostic', '--label', `io.paimind.run=${run}`, imageId])
const inspect = () => {
  const [s] = JSON.parse(docker(['inspect', id])); assert.equal(s.Id, id); assert.equal(s.Image, imageId)
  assert.equal(s.Name, `/${name}`); assert.equal(s.Config.Labels['io.paimind.run'], run)
  assert.equal(s.Config.Labels['io.paimind.goal'], 'enterprise-haas-managed-diagnostic')
  assert.equal(s.Config.User, '10001:10001'); assert.equal(s.HostConfig.ReadonlyRootfs, true)
  assert.equal(s.HostConfig.NetworkMode, 'none'); assert.equal(s.HostConfig.Privileged, false)
  assert.ok(!s.HostConfig.Binds?.length && !s.HostConfig.VolumesFrom?.length && s.Mounts.length === 0)
  assert.ok(!Object.keys(s.HostConfig.PortBindings ?? {}).length)
  return s
}
await writeFile(join(evidence, 'container.json'), JSON.stringify(inspect()))
try {
  docker(['start', id])
  const wait = spawn('docker', ['wait', id], { stdio: ['ignore', 'pipe', 'inherit'] })
  let result = ''; wait.stdout.on('data', bytes => { result += bytes.toString() })
  const watchdog = setTimeout(() => { inspect(); docker(['stop', '--time', '10', id]) }, 210_000)
  const waited = await new Promise((done, reject) => { wait.once('error', reject); wait.once('close', done) })
  clearTimeout(watchdog); assert.equal(waited, 0)
  const state = inspect(); assert.equal(state.State.Running, false)
  assert.equal(result.trim(), '0'); assert.equal(state.State.ExitCode, 0)
  const output = dockerLogs(id)
  const receipt = JSON.parse(output.split('\n').find(line => line.startsWith('{"status":"MANAGED_NATIVE_')))
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ...receipt, imageId, base, run, evidence }, null, 2))
  console.log(JSON.stringify({ state: receipt.status, imageId, evidence, browserE2EVerified: false, finalWorkerImageAccepted: false }))
} finally {
  const before = inspect(); if (before.State.Running) docker(['stop', '--time', '10', id])
  const stopped = inspect(); assert.equal(stopped.State.Running, false)
  await writeFile(join(evidence, 'native.log'), dockerLogs(id))
  docker(['rm', id])
  await writeFile(join(evidence, 'stopped.json'), JSON.stringify({ state: stopped.State, removedContainer: id, userVolumesRemoved: false }))
}
