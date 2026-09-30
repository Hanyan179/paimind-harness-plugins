import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
assert.equal(process.argv.length, 3)
const imageId = process.argv[2]; assert.match(imageId, /^sha256:[a-f0-9]{64}$/)
const docker = args => {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim()
}
const info = JSON.parse(docker(['image', 'inspect', imageId]))[0]
assert.equal(info.Id, imageId); assert.equal(info.Config.Labels['io.paimind.acceptance'], 'isolated-member-iteration-not-final')
const policy = join(root, '../.paimind-goal-evidence/haas-execution-domain-eoV8ch/diagnostic-seccomp.json')
assert.equal(createHash('sha256').update(await readFile(policy)).digest('hex'), '7f5b3176bddd660717d52f4cda90b2d3e614bf7a2caed96159e47e9bc7c11140')
process.umask(0o077)
const evidence = await mkdtemp(join(await realpath(join(root, '../.paimind-goal-evidence')), 'haas-member-directory-'))
const source = await readFile(join(root, 'packages/harness-compat/tests/managed-directory-picker-container.mjs'), 'utf8')
await writeFile(join(evidence, 'container-test.mjs'), source)
const run = randomUUID(); const name = `paimind-member-directory-${run.slice(0, 8)}`
const id = docker(['create', '--interactive', '--init', '--name', name, '--read-only', '--network', 'none', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges:true', '--security-opt', `seccomp=${policy}`, '--memory', '1g', '--cpus', '1', '--pids-limit', '256',
  '--tmpfs', '/var/lib/paimind:rw,nosuid,nodev,uid=10001,gid=10001,mode=0700,size=268435456',
  '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777,size=134217728',
  '--label', 'io.paimind.goal=enterprise-haas-member-directory-diagnostic', '--label', `io.paimind.run=${run}`,
  '--entrypoint', '/usr/local/bin/node', imageId, '--input-type=module'])
const inspect = () => {
  const state = JSON.parse(docker(['inspect', id]))[0]
  assert.equal(state.Id, id); assert.equal(state.Image, imageId); assert.equal(state.Name, '/' + name)
  assert.equal(state.Config.Labels['io.paimind.run'], run)
  assert.equal(state.Config.User, '10001:10001'); assert.equal(state.HostConfig.ReadonlyRootfs, true)
  assert.equal(state.HostConfig.NetworkMode, 'none'); assert.equal(state.HostConfig.Privileged, false)
  assert.ok(!state.HostConfig.Binds?.length && !state.HostConfig.VolumesFrom?.length)
  assert.ok(state.Mounts.every(mount => mount.Type === 'tmpfs'))
  assert.ok(!Object.keys(state.HostConfig.PortBindings ?? {}).length)
  return state
}
console.log(JSON.stringify({ status: 'TESTING_MEMBER_DIRECTORY', imageId, evidence, id }))
await writeFile(join(evidence, 'container.json'), JSON.stringify(inspect(), null, 2))
let log = ''
try {
  const child = spawn('docker', ['start', '--attach', '--interactive', id], { stdio: ['pipe', 'pipe', 'pipe'] })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { log += bytes; process.stdout.write(bytes) })
  child.stdin.end(source)
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done) })
  assert.equal(code, 0); assert.equal(inspect().State.ExitCode, 0)
  const result = log.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
    .find(row => row.status === 'MANAGED_DIRECTORY_PICKER_LINUX_PASSED')
  assert.ok(result); await writeFile(join(evidence, 'result.json'), JSON.stringify({ ...result, imageId, run }, null, 2))
} finally {
  const before = inspect(); if (before.State.Running) docker(['stop', '--time', '10', id])
  const state = inspect(); assert.equal(state.State.Running, false)
  await writeFile(join(evidence, 'native.log'), log)
  docker(['rm', id])
  await writeFile(join(evidence, 'closed.json'), JSON.stringify({ state: state.State, removedContainer: id, userVolumesRemoved: false }))
}
