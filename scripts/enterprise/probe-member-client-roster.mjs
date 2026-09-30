import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Only an immutable member iteration produced from the current source is
// accepted. No restart, login, native write or volume of the live members.
assert.equal(process.argv.length, 3)
const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
const evidenceRoot = await realpath(join(root, '../.paimind-goal-evidence'))
const imageEvidence = await realpath(process.argv[2])
assert.ok(imageEvidence.startsWith(evidenceRoot + '/haas-member-image-') && dirname(imageEvidence) === evidenceRoot)
const image = JSON.parse(await readFile(join(imageEvidence, 'result.json'), 'utf8'))
assert.match(image.imageId, /^sha256:[a-f0-9]{64}$/u)
assert.equal(image.managedCompatSourceRebuilt, true)
for (const input of image.inputs) {
  assert.ok(/^(?:packages|deploy)\//u.test(input.source) && !input.source.split('/').includes('..'))
  assert.equal(createHash('sha256').update(await readFile(join(root, input.source))).digest('hex'), input.sha256)
}
const docker = args => {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30_000 })
  assert.ok(!result.error); assert.equal(result.status, 0, 'Owned Docker command failed: ' + args[0])
  return result.stdout.trim()
}
const [base] = JSON.parse(docker(['image', 'inspect', image.imageId]))
assert.equal(base.Id, image.imageId); assert.equal(base.Config.User, '10001:10001')
assert.equal(base.Config.Labels['io.paimind.acceptance'], 'isolated-member-iteration-not-final')
const source = 'packages/harness-compat/tests/managed-client-roster-container.mjs'
const probe = await readFile(join(root, source))
process.umask(0o077)
const evidence = await mkdtemp(join(evidenceRoot, 'haas-member-client-roster-'))
await writeFile(join(evidence, 'probe.mjs'), probe)
await writeFile(join(evidence, 'inputs.json'), JSON.stringify({ imageEvidence, imageId: image.imageId,
  source, sha256: createHash('sha256').update(probe).digest('hex'), liveMemberResourcesTouched: false }, null, 2))
const run = randomUUID(), name = 'paimind-member-client-roster-' + run.slice(0, 8)
const goal = 'enterprise-haas-member-client-roster'
const id = docker(['create', '--name', name, '--init', '--interactive', '--read-only', '--network', 'none',
  '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--memory', '1g', '--cpus', '1', '--pids-limit', '256',
  '--tmpfs', '/var/lib/paimind:rw,nosuid,nodev,uid=10001,gid=10001,mode=0700,size=268435456',
  '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777,size=134217728',
  '--label', 'io.paimind.goal=' + goal, '--label', 'io.paimind.run=' + run,
  '--entrypoint', '/usr/local/bin/node', image.imageId, '--input-type=module', '-'])
const inspect = () => {
  const [c] = JSON.parse(docker(['inspect', id]))
  assert.equal(c.Id, id); assert.equal(c.Name, '/' + name); assert.equal(c.Image, image.imageId)
  assert.equal(c.Config.Labels['io.paimind.goal'], goal); assert.equal(c.Config.Labels['io.paimind.run'], run)
  assert.equal(c.Config.User, '10001:10001'); assert.equal(c.HostConfig.ReadonlyRootfs, true)
  assert.equal(c.HostConfig.NetworkMode, 'none'); assert.equal(c.HostConfig.Privileged, false)
  assert.deepEqual(c.HostConfig.CapDrop, ['ALL']); assert.equal(c.Mounts.length, 0)
  assert.ok(!c.HostConfig.Binds?.length && !c.HostConfig.VolumesFrom?.length)
  assert.deepEqual(c.HostConfig.PortBindings ?? {}, {})
  return c
}
let log = '', watchdog
try {
  await writeFile(join(evidence, 'container.json'), JSON.stringify(inspect(), null, 2))
  console.log(JSON.stringify({ status: 'TESTING_NATIVE_CLIENT_ROSTER', evidence, containerId: id }))
  const child = spawn('docker', ['start', '--attach', '--interactive', id], { stdio: ['pipe', 'pipe', 'pipe'] })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { log += bytes.toString() })
  child.stdin.on('error', () => {})
  child.stdin.end(probe)
  watchdog = setTimeout(() => { if (inspect().State.Running) docker(['stop', '--time', '10', id]) }, 120_000)
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done) })
  clearTimeout(watchdog)
  const c = inspect()
  assert.equal(code, 0); assert.equal(c.State.Running, false); assert.equal(c.State.ExitCode, 0)
  const receipt = log.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
    .find(row => row.status === 'NATIVE_MEMBER_CLIENT_ROSTER_PASSED')
  assert.ok(receipt)
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ...receipt, imageId: image.imageId, evidence }, null, 2))
  console.log(JSON.stringify({ status: receipt.status, evidence, managementClientCounts: receipt.cycles.map(cycle => cycle.managementClientCount),
    browserE2EVerified: false, liveMemberResourcesTouched: false }))
} finally {
  clearTimeout(watchdog)
  if (inspect().State.Running) docker(['stop', '--time', '10', id])
  const stopped = inspect(); assert.equal(stopped.State.Running, false)
  await writeFile(join(evidence, 'native.log'), log)
  docker(['rm', id])
  await writeFile(join(evidence, 'closed.json'), JSON.stringify({ removedContainer: id, state: stopped.State, userVolumesRemoved: false }))
}
