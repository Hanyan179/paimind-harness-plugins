import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'

// Bounded actual-container transport diagnostic. No DB binding, member grant,
// model call, shared runtime, or Browser E2E claim. Retains its private volumes.
const memberPolicyMode = process.argv[2] === '--member-policy'
assert.ok(process.argv.length === 2 || process.argv.length === 3 && memberPolicyMode)
const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
const base = 'sha256:e5b1eae8406bedc771c70368e804ae5a26c80913b7ba3d726fc003bfb7455ac7'
const baseTag = 'paimind-enterprise-runtime-candidate:f111bebd2330-b5353970'
const docker = (args, input) => {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw Error(`Owned Docker ${args[0]} failed (${result.status})`)
  return result.stdout.trim()
}
assert.equal(JSON.parse(docker(['image', 'inspect', baseTag]))[0].Id, base)
process.umask(0o077)
const evidence = await mkdtemp(join(await realpath(join(root, '../.paimind-goal-evidence')), 'haas-private-ingress-'))
const context = join(evidence, 'context'); await mkdir(context)
// Reuse the exact previously exercised diagnostic namespace profile. This
// does not approve it for production or widen daemon/default container policy.
const priorPolicy = join(root, '../.paimind-goal-evidence/haas-execution-domain-eoV8ch/diagnostic-seccomp.json')
const policyBytes = await readFile(priorPolicy)
assert.equal(createHash('sha256').update(policyBytes).digest('hex'), '7f5b3176bddd660717d52f4cda90b2d3e614bf7a2caed96159e47e9bc7c11140')
const policy = join(evidence, 'diagnostic-seccomp.json'); await writeFile(policy, policyBytes)
const run = randomUUID(); const scope = 'enterprise-haas-private-ingress-diagnostic'
const tag = `paimind-private-ingress-diagnostic:${run.slice(0, 8)}`
const captures = []
for (const name of ['start-native-runtime.mjs', 'native-ingress.mjs', 'boot-native-runtime.mjs', 'member-tool-policy.mjs',
  'native-control.mjs', 'run-prepared-runtime.mjs', 'prepared-storage.mjs']) {
  const source = `deploy/enterprise/worker/runtime/${name}`
  await copyFile(join(root, source), join(context, name))
  captures.push({ source, sha256: createHash('sha256').update(await readFile(join(context, name))).digest('hex') })
}
await writeFile(join(context, 'Dockerfile'), `FROM ${baseTag}
USER 0:0
COPY --chown=0:0 --chmod=0444 *.mjs /usr/local/lib/paimind/
RUN chmod 0555 /usr/local/lib/paimind
LABEL io.paimind.acceptance="private-ingress-diagnostic-not-admitted"
USER 10001:10001
`)
await writeFile(join(evidence, 'inputs.json'), JSON.stringify({ base, run, captures, diagnosticOnly: true }, null, 2))
console.log(JSON.stringify({ state: 'BUILDING_PRIVATE_INGRESS_DIAGNOSTIC', evidence, run }))
const child = spawn('docker', ['buildx', 'build', '--platform', 'linux/arm64', '--network=none', '--load', '--progress=plain',
  '--tag', tag, '--iidfile', join(evidence, 'image-id.txt'), context], { stdio: ['ignore', 'pipe', 'pipe'] })
let buildLog = ''
for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { buildLog += bytes; process.stdout.write(bytes) })
const buildCode = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done) })
await writeFile(join(evidence, 'build.log'), buildLog); assert.equal(buildCode, 0)
const imageId = (await readFile(join(evidence, 'image-id.txt'), 'utf8')).trim()
await build({ entryPoints: [join(root, 'apps/enterprise-server/src/cell-transport.ts')], outfile: join(evidence, 'cell-transport.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24' })
const { CellTransport } = await import(pathToFileURL(join(evidence, 'cell-transport.mjs')).href)
const labels = ['--label', `io.paimind.goal=${scope}`, '--label', `io.paimind.run=${run}`]
const containers = []; const retainedVolumes = []; const networks = []; const agents = []; const results = []
const inspect = record => {
  const [info] = JSON.parse(docker(['inspect', record.id]))
  assert.equal(info.Id, record.id); assert.equal(info.Name, '/' + record.name); assert.equal(info.Image, imageId)
  assert.equal(info.Config.Labels['io.paimind.goal'], scope); assert.equal(info.Config.Labels['io.paimind.run'], run)
  assert.equal(info.Config.User, '10001:10001'); assert.equal(info.HostConfig.ReadonlyRootfs, true)
  assert.equal(info.HostConfig.Privileged, false); assert.deepEqual(info.HostConfig.CapDrop, ['ALL'])
  assert.ok(!info.HostConfig.Binds?.length && !info.HostConfig.VolumesFrom?.length)
  return info
}
const create = (name, args) => {
  const id = docker(['create', '--name', name, ...labels, '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true', '--security-opt', `seccomp=${policy}`, '--memory', '1g', '--cpus', '1', '--pids-limit', '256',
    '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777,size=134217728', ...args])
  const record = { id, name }; containers.push(record); inspect(record); return record
}
const complete = (record, input) => {
  const output = docker(['start', '--attach', ...(input === undefined ? [] : ['--interactive']), record.id], input)
  const info = inspect(record); assert.equal(info.State.Running, false); assert.equal(info.State.ExitCode, 0)
  return output
}
const call = (agent, path, payload) => new Promise((done, reject) => {
  const body = payload === undefined ? undefined : JSON.stringify(payload)
  const req = request(new URL(path, agent.nativeOrigin), { agent, method: body ? 'POST' : 'GET',
    headers: { origin: agent.nativeOrigin, ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}) } }, async response => {
    try { const parts = []; for await (const bytes of response) parts.push(bytes)
      done({ status: response.statusCode, contentType: response.headers['content-type'], text: Buffer.concat(parts).toString() })
    } catch (error) { reject(error) }
  })
  req.on('error', reject); req.end(body)
})
const credentials = []
try {
  for (const member of ['hansen', 'alex']) {
    const prefix = `paimind-ingress-${run.slice(0, 8)}-${member}`
    const data = docker(['volume', 'create', ...labels, prefix + '-data'])
    const control = docker(['volume', 'create', ...labels, prefix + '-control'])
    retainedVolumes.push(data, control)
    const token = randomBytes(32).toString('hex'); credentials.push({ member, token, data, control })
    const capsule = memberPolicyMode ? JSON.stringify({ schemaVersion: 1, cellId: randomUUID(), userId: randomUUID(),
      tenantId: 'transport-diagnostic', role: 'member', policy: 'member-personal-v1' }) : undefined
    await writeFile(join(evidence, 'private-fixture.json'), JSON.stringify(credentials))
    const seed = create(prefix + '-seed', ['--network', 'none', '--interactive', '--mount', `type=volume,src=${control},dst=/var/lib/paimind`,
      '--entrypoint', '/usr/local/bin/node', imageId, '--input-type=module', '-e',
      "import{writeFileSync}from'node:fs';let text='';for await(const b of process.stdin)text+=b;const value=JSON.parse(text);if(!/^[a-f0-9]{64}$/.test(value.token))throw Error('Invalid private seed');writeFileSync('/var/lib/paimind/transport-key',value.token,{mode:0o400,flag:'wx'});if(value.capsule)writeFileSync('/var/lib/paimind/member-policy.json',value.capsule,{mode:0o400,flag:'wx'});"])
    complete(seed, JSON.stringify({ token, capsule }))
    const prepare = create(prefix + '-prepare', ['--network', 'none', '--init', '--mount', `type=volume,src=${data},dst=/var/lib/paimind`, imageId, '--prepare-storage'])
    const prepared = complete(prepare)
    await writeFile(join(evidence, member + '-prepare.log'), prepared)
    const receipt = prepared.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } }).find(row => row.event === 'native-storage-prepared')
    assert.ok(receipt?.generation)
    // Docker Desktop does not publish host ports on an internal-only network.
    // Use a dedicated bridge per diagnostic cell; only the explicit image-owned
    // member tool policy may replace the default deny-all candidate gate.
    // This proves authenticated ingress, NOT final outbound network policy.
    const network = docker(['network', 'create', '--driver', 'bridge', ...labels, prefix + '-network']); networks.push(network)
    const runtime = create(prefix + '-native', ['--network', network, '--init',
      '--mount', `type=volume,src=${data},dst=/var/lib/paimind`, '--mount', `type=volume,src=${control},dst=/run/paimind-cell,readonly`,
      '--env', 'PAIMIND_CELL_INGRESS=1', ...(memberPolicyMode ? ['--env', 'PAIMIND_CELL_POLICY=member-personal-v1'] : []),
      '--publish', '127.0.0.1::3211', imageId, '--run-storage', receipt.generation])
    docker(['start', runtime.id])
    const info = inspect(runtime)
    await writeFile(join(evidence, member + '-initial-container.json'), JSON.stringify(info, null, 2))
    assert.equal(info.State.Running, true, 'Prepared native runtime exited before transport readback')
    const ports = info.NetworkSettings.Ports
    assert.deepEqual(Object.keys(ports), ['3211/tcp']); assert.equal(ports['3211/tcp'].length, 1)
    assert.equal(ports['3211/tcp'][0].HostIp, '127.0.0.1')
    assert.equal(info.Mounts.find(m => m.Destination === '/run/paimind-cell').RW, false)
    const origin = `http://127.0.0.1:${ports['3211/tcp'][0].HostPort}`
    const agent = new CellTransport(origin, token); agents.push(agent)
    let html
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      assert.equal(inspect(runtime).State.Running, true, 'Private native runtime exited')
      try { const response = await call(agent, '/'); if (response.status === 200 && response.text.includes('__DSH_BOOT__')) { html = response; break } } catch {}
      await delay(1000)
    }
    assert.ok(html?.text.includes('@paimind/enterprise-admin')); assert.ok(html.text.includes('@paimind/extension-center'))
    const denied = await fetch(origin, { signal: AbortSignal.timeout(5000) }); assert.equal(denied.status, 403)
    // The actual native owner persists a unique session in this diagnostic
    // volume. This is NOT a member-authorized browser-created business object.
    const sessionId = `transport-diagnostic-${member}-${run}`
    const invoke = async (method, payload) => {
      const response = await call(agent, '/api/' + method, { type: 'client-request', rpcId: randomUUID(), method, payload })
      assert.equal(response.status, 200); return JSON.parse(response.text)
    }
    const created = await invoke('session.create', { sessionId, cwd: '/var/lib/paimind/workspace', agentPreset: 'standard' })
    assert.equal(created.result.ok, true)
    const profiles = []
    if (memberPolicyMode) {
      const logs = docker(['logs', runtime.id])
      const ready = logs.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
        .find(row => row.event === 'managed-native-profile-ready')
      assert.equal(ready?.toolPolicy, 'member-personal-v1')
      assert.equal(ready?.policyDigest, 'sha256:' + createHash('sha256').update(capsule).digest('hex'))
      assert.equal(ready?.cellId, JSON.parse(capsule).cellId)
      assert.equal(ready?.storageMounted, true); assert.equal(ready?.nativeToolGuardActive, true)
      for (const purpose of ['sales', 'research']) {
        const id = `${member}-${purpose}-${run.slice(0, 6)}`
        const copied = await invoke('agentPreset.copy', { from: 'standard', agentPreset: id, name: `${member} ${purpose}` })
        assert.equal(copied.result.ok, true, 'Native personal preset copy failed')
        const saved = await invoke('paimindAgentProfiles/saveProfile', { args: { input: {
          agentId: id, presetId: id, basePresetId: 'standard', name: `${member} ${purpose}`, productKind: 'personal',
          description: `Private ${purpose} diagnostic`, role: `${purpose} assistant`, goal: 'Help this member with their own work',
          behavior: 'Ask clear questions and respect private information', instructions: '', preferredSkillNames: [],
        } } })
        assert.equal(saved.result.ok, true, 'Native personal profile save failed')
        profiles.push({ id, version: saved.result.value.configVersion })
      }
      const listed = await invoke('paimindAgentProfiles/listProfiles', { args: {} })
      assert.equal(listed.result.ok, true)
      assert.deepEqual(listed.result.value.profiles.map(row => row.agentId).sort(), profiles.map(row => row.id).sort())
    }
    results.push({ member, origin, runtimeId: runtime.id, sessionId, profiles, memberPolicyLoaded: memberPolicyMode,
      data, control, nativeDocument: true, bareIngressStatus: denied.status, agent, invoke })
    await writeFile(join(evidence, member + '-container.json'), JSON.stringify(info, null, 2))
    console.log(JSON.stringify({ state: 'PRIVATE_NATIVE_INGRESS_READY', member, origin, evidence, memberAdmissionVerified: false }))
  }
  for (const [index, own] of results.entries()) {
    const other = results[1 - index]
    const cross = await own.invoke('session.history', { sessionId: other.sessionId })
    assert.equal(cross.result.ok, false)
    for (const profile of other.profiles) {
      assert.equal((await own.invoke('agentPreset.read', { agentPreset: profile.id })).result.ok, false)
    }
    const wrong = new CellTransport(own.origin, credentials[1 - index].token); agents.push(wrong)
    await assert.rejects(call(wrong, '/'), /Private cell transport unavailable/)
  }
  const status = memberPolicyMode ? 'DUAL_NATIVE_MEMBER_POLICY_COMPOSITION_PASSED' : 'DUAL_NATIVE_PRIVATE_INGRESS_PASSED'
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ status, imageId, base, run,
    cells: results.map(({ agent, invoke, ...data }) => data), crossCellKeyRejected: true, crossNativeSessionRejected: true,
    outboundNetworkPolicyVerified: false, memberAdmissionVerified: false, browserE2EVerified: false, finalWorkerImageAccepted: false }, null, 2))
  console.log(JSON.stringify({ state: status, evidence, imageId, memberAdmissionVerified: false }))
} finally {
  for (const agent of agents) agent.destroy()
  const stopped = []
  for (const record of containers.reverse()) {
    const before = inspect(record)
    if (before.State.Running) docker(['stop', '--time', '10', record.id])
    const info = inspect(record); assert.equal(info.State.Running, false)
    const logs = spawnSync('docker', ['logs', record.id], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    await writeFile(join(evidence, record.name + '.log'), logs.stdout + logs.stderr)
    docker(['rm', record.id]); stopped.push({ ...record, exitCode: info.State.ExitCode })
  }
  for (const id of networks) {
    const [info] = JSON.parse(docker(['network', 'inspect', id])); assert.equal(info.Id, id)
    assert.equal(info.Labels['io.paimind.goal'], scope); assert.equal(info.Labels['io.paimind.run'], run)
    assert.equal(Object.keys(info.Containers).length, 0); docker(['network', 'rm', id])
  }
  await writeFile(join(evidence, 'cleanup.json'), JSON.stringify({ stopped, removedNetworks: networks, retainedVolumes, userVolumesRemoved: false }, null, 2))
}
