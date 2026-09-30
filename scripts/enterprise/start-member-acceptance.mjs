import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { appendFile, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { request } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import { RuntimeAdmission } from '../../apps/enterprise-server/lib/runtime-admission.js'
import { readRuntimeResources } from '../../apps/enterprise-server/lib/runtime-resources.js'
import { RuntimeRecoveryOperator } from '../../apps/enterprise-server/lib/runtime-recovery.js'
import { verifyManagedCell } from '../../deploy/enterprise/controller/member-cell.mjs'
import { managedToolPolicyForRole } from '../../deploy/enterprise/worker/runtime/member-tool-policy.mjs'
import { offlineStorageFenceName } from '../../deploy/enterprise/controller/offline-storage.mjs'
import { BoundedCommandError, maintainMemberLeases, readLeaseObservation, runBoundedCommand, runOwnedProbe } from '../../deploy/enterprise/controller/member-liveness.mjs'
import { MemberRecoveryRequests, readMemberRecoveryCommand, waitForAdministratorRecovery } from '../../deploy/enterprise/controller/member-recovery.mjs'
import { startManagedGateway } from '../../deploy/enterprise/controller/managed-gateway.mjs'
import { verifyResumedDatabaseConfig } from '../../deploy/enterprise/controller/database-resume.mjs'
import { reserveMemberPort } from '../../deploy/enterprise/controller/member-port.mjs'
import { selectMemberCheckpoint, finalizeMemberCheckpoint } from '../../deploy/enterprise/controller/member-checkpoint.mjs'
import { createHarnessHostHealthReadback, verifyHarnessHostHealthReadback } from '../../packages/harness-compat/lib/gateway-transport.js'

// Explicit, non-production operator session for the two already-created browser
// members, with an optional explicitly selected existing administrator. No
// account creation, existing gateway restart, model credentials or
// native business objects are performed here. An explicit manageGateway option
// owns a newly spawned gateway only. Controller exit withdraws admission,
// closes its own cells and retains every data/control volume and DB receipt.
const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(), 'codex/enterprise-haas-hybrid-refactor')
assert.equal(process.argv.length, 3, 'One exact private operator configuration required')
const privateJson = path => {
  const s = lstatSync(path)
  assert.equal(realpathSync(path), path)
  assert.ok(s.isFile() && !s.isSymbolicLink() && s.uid === process.getuid() && s.nlink === 1 && !(s.mode & 0o077) && s.size < 32768)
  return JSON.parse(readFileSync(path, 'utf8'))
}
const input = privateJson(process.argv[2])
assert.deepEqual(Object.keys(input).sort(), ['databaseConfigPath', 'gatewayConfigPath', 'imageId', 'members',
  ...(Object.hasOwn(input, 'administrator') ? ['administrator'] : []),
  ...(Object.hasOwn(input, 'manageGateway') ? ['manageGateway'] : []), ...(input.resumeStatePath ? ['resumeStatePath'] : []), 'seccompPath'].sort())
assert.ok(input.manageGateway === undefined || typeof input.manageGateway === 'boolean')
const config = privateJson(input.databaseConfigPath), gateway = privateJson(input.gatewayConfigPath)
assert.equal(config.tenantId, gateway.tenantId); assert.equal(config.applicationUrl, gateway.applicationUrl)
assert.deepEqual(input.members.map(member => member.username).sort(), ['alex', 'hansen'])
assert.equal(input.members.length, 2)
for (const account of [...input.members, ...(Object.hasOwn(input, 'administrator') ? [input.administrator] : [])]) {
  assert.ok(account && typeof account === 'object' && !Array.isArray(account))
  assert.deepEqual(Object.keys(account).sort(), ['userId', 'username'])
  assert.match(account.username, /^[a-z0-9][a-z0-9._+@-]{2,127}$/)
  assert.match(account.userId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
}
const accounts = [...(input.administrator ? [{ ...input.administrator, role: 'admin' }] : []),
  ...input.members.map(member => ({ ...member, role: 'member' }))]
assert.equal(new Set(accounts.map(account => account.userId)).size, accounts.length)
assert.equal(new Set(accounts.map(account => account.username)).size, accounts.length)
const dburl = new URL(config.ownerUrl), publicUrl = new URL(gateway.publicOrigin)
assert.equal(dburl.hostname, '127.0.0.1'); assert.equal(dburl.pathname, '/haas_e2e')
assert.ok(dburl.port && !['3080', '5432', '10012'].includes(dburl.port))
assert.equal(publicUrl.hostname, '127.0.0.1'); assert.equal(publicUrl.protocol, 'http:')
assert.ok(Number(publicUrl.port) >= 1024 && !['3080', dburl.port].includes(publicUrl.port))
assert.match(input.imageId, /^sha256:[a-f0-9]{64}$/)
const policyBytes = readFileSync(input.seccompPath)
assert.equal(createHash('sha256').update(policyBytes).digest('hex'), '7f5b3176bddd660717d52f4cda90b2d3e614bf7a2caed96159e47e9bc7c11140')
const seccomp = JSON.parse(policyBytes)
const prior = input.resumeStatePath ? privateJson(input.resumeStatePath) : undefined
const priorGateway = prior ? privateJson(join(dirname(input.resumeStatePath), 'gateway-config.json')) : undefined
if (prior) {
  assert.equal(prior.sourceRoot, root)
  assert.equal(prior.cells.length, accounts.length)
  const closed = privateJson(join(dirname(input.resumeStatePath), 'closed.json'))
  assert.equal(closed.userVolumesRemoved, false)
  assert.notEqual(closed.cleanupComplete, false, 'Previous resource cleanup is unconfirmed')
  assert.notEqual(closed.checkpointRecorded, false, 'Previous checkpoint is incomplete')
  for (const cell of prior.cells) assert.ok(closed.retainedVolumes.includes(cell.pin.volumeName) && closed.retainedVolumes.includes(cell.controlVolume))
}
const docker = (args, stdin) => {
  const result = spawnSync('docker', args, { input: stdin, encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 ** 2 })
  if (result.error || result.status !== 0) throw Error(`Owned engine operation ${args[0]} failed (${result.status})`)
  return result.stdout.trim()
}
const inspect = id => JSON.parse(docker(['inspect', id]))[0]
// Runtime observations and per-member withdrawal must never block the other
// lane's timers or native HTTP callbacks. Startup/final cleanup stay serialized.
const asyncDocker = async (args, signal, timeout = 5000) => {
  try {
    return await runBoundedCommand('docker', args, { signal, timeoutMs: timeout, diagnosticProfile: 'docker' })
  } catch (error) {
    const diagnostic = error instanceof BoundedCommandError ? error.diagnostic : { kind: 'unclassified' }
    throw Object.assign(Error(`Owned engine operation ${args[0]} unavailable (${diagnostic.kind})`), { commandDiagnostic: diagnostic })
  }
}
const asyncInspect = async (id, signal) => JSON.parse(await asyncDocker(['inspect', id], signal))[0]
const asyncVerifyOwned = async (id, labels, signal) => {
  const state = await asyncInspect(id, signal)
  assert.equal(state.Id, id); assert.equal(state.Image, input.imageId)
  for (const [key, value] of Object.entries(labels)) assert.equal(state.Config.Labels[key], value)
  return state
}
const database = inspect(config.containerId)
if (prior) verifyResumedDatabaseConfig(privateJson(prior.databaseConfigPath), config, database)
assert.equal(database.Config.Labels['paimind.role'], 'identity-e2e-only')
assert.deepEqual(database.NetworkSettings.Ports['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: dburl.port }])
const [image] = JSON.parse(docker(['image', 'inspect', input.imageId]))
assert.equal(image.Id, input.imageId); assert.equal(image.Os, 'linux'); assert.equal(image.Architecture, 'arm64')
assert.equal(image.Config.User, '10001:10001'); assert.deepEqual(image.Config.Volumes ?? {}, {})
process.umask(0o077)
const evidence = await mkdtemp(join(realpathSync(join(root, '../.paimind-goal-evidence')), 'haas-member-browser-cells-'))
const event = async data => { await appendFile(join(evidence, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...data }) + '\n') }
await writeFile(join(evidence, 'seccomp.json'), policyBytes)
await build({ entryPoints: [join(root, 'apps/enterprise-server/src/cell-transport.ts')], outfile: join(evidence, 'cell-transport.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24' })
const { CellTransport } = await import(join(evidence, 'cell-transport.mjs'))
const sql = createRequire(join(root, 'apps/enterprise-server/package.json'))('postgres')(config.ownerUrl,
  { max: 1, connect_timeout: 3, onnotice: () => {}, connection: { statement_timeout: 4000, lock_timeout: 4000 } })
const memberAdmission = new RuntimeAdmission(sql, gateway.publicOrigin)
const adminAdmission = new RuntimeAdmission(sql, gateway.publicOrigin, 'admin')
const administratorRecovery = new RuntimeRecoveryOperator(sql)
const admissionFor = pin => {
  assert.ok(pin.role === 'member' || pin.role === 'admin')
  return pin.role === 'admin' ? adminAdmission : memberAdmission
}
const run = randomUUID(), cells = [], transient = [], fences = [], networks = [], volumes = [], agents = []
const reservePort = signal => reserveMemberPort({ signal,
  excludedOrigins: [gateway.publicOrigin, `http://127.0.0.1:${dburl.port}`, 'http://127.0.0.1:3080'],
  isRetained: async origin => {
    const rows = await sql`select 1 from haas.runtime_bindings where origin=${origin} limit 1`
    return rows.length !== 0
  },
})
const replacements = new Map()
const resourcePlans = new Map()
const recoveryRequests = new MemberRecoveryRequests()
let ownedGateway, pendingRecovery = Promise.resolve(), recoverySignal
let stopping = false
const lifetime = new AbortController()
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { stopping = true; lifetime.abort() })
const shouldContinue = () => assert.equal(stopping, false, 'Operator session stopping')
const runtimeCommon = ['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--security-opt', `seccomp=${join(evidence, 'seccomp.json')}`,
  '--restart', 'no', '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777,size=134217728']
const common = [...runtimeCommon, '--memory', '1g', '--cpus', '1', '--pids-limit', '256']
const resourceArgs = resources => {
  assert.equal(resources.desiredState, 'running', 'Administrator suspended this runtime; explicit running intent required')
  return ['--memory', `${resources.memoryMiB}m`, '--cpus', String(resources.cpuMillis / 1000), '--pids-limit', String(resources.pidsLimit)]
}
const ownerLabels = labels => Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`])
const verifyOwned = (id, labels) => {
  const state = inspect(id); assert.equal(state.Id, id); assert.equal(state.Image, input.imageId)
  for (const [key, value] of Object.entries(labels)) assert.equal(state.Config.Labels[key], value)
  return state
}
const complete = async (args, labels, stdin) => {
  shouldContinue()
  const id = docker(['create', ...ownerLabels(labels), ...common, ...args]); transient.push({ id, labels })
  verifyOwned(id, labels)
  const output = docker(['start', '--attach', ...(stdin === undefined ? [] : ['--interactive']), id], stdin)
  const state = verifyOwned(id, labels); assert.equal(state.State.Running, false); assert.equal(state.State.ExitCode, 0)
  await event({ event: 'preparation-joined', id, exitCode: state.State.ExitCode })
  docker(['rm', id]); transient.splice(transient.findIndex(row => row.id === id), 1)
  return output
}
const nativeHealth = (agent, signal = lifetime.signal) => new Promise((done, reject) => {
  const rpcId = randomUUID(), wire = createHarnessHostHealthReadback(rpcId)
  const req = request(new URL(wire.path, agent.nativeOrigin), { agent, signal, method: 'POST', headers: { origin: agent.nativeOrigin,
    'content-type': 'application/json', 'content-length': Buffer.byteLength(wire.body), 'accept-encoding': 'identity' } }, async response => {
    try {
      assert.equal(response.statusCode, 200)
      assert.equal(response.headers['content-type']?.split(';')[0]?.trim(), 'application/json')
      assert.ok(!response.headers['content-encoding'] || response.headers['content-encoding'] === 'identity')
      let text = ''; for await (const bytes of response) { signal.throwIfAborted(); text += bytes; assert.ok(Buffer.byteLength(text) <= 64 * 1024) }
      verifyHarnessHostHealthReadback(text, rpcId); done(true)
    } catch { response.destroy(); req.destroy(); reject(Error('Private native health unavailable')) }
  })
  req.setTimeout(3000, () => req.destroy(Error('Private native readback timed out'))); req.once('error', reject); req.end(wire.body)
})
const readinessReceipts = expected =>
  docker(['logs', '--tail', '500', expected.pin.containerId]).split('\n').flatMap(line => {
    try { const row = JSON.parse(line); return row.event === 'managed-native-profile-ready' ? [row] : [] } catch { return [] }
  })
const observation = expected => {
  const readyRows = readinessReceipts(expected)
  assert.equal(readyRows.length, 1, 'One native policy readiness receipt required')
  const names = [expected.pin.volumeName, expected.controlVolume]
  return { container: inspect(expected.pin.containerId), network: JSON.parse(docker(['network', 'inspect', expected.networkId]))[0],
    volumes: JSON.parse(docker(['volume', 'inspect', ...names])), references: Object.fromEntries(names.map(name => [name,
      docker(['ps', '--all', '--quiet', '--no-trunc', '--filter', `volume=${name}`]).split('\n').filter(Boolean).sort()])), ready: readyRows[0] }
}
const asyncObservation = async (expected, signal) => {
  const names = [expected.pin.volumeName, expected.controlVolume]
  const results = await Promise.allSettled([
    runOwnedProbe('runtime-logs', expected.pin.containerId, () => asyncDocker(['logs', '--tail', '500', expected.pin.containerId], signal)),
    runOwnedProbe('runtime-container', expected.pin.containerId, () => asyncInspect(expected.pin.containerId, signal)),
    runOwnedProbe('runtime-network', expected.networkId, () => asyncDocker(['network', 'inspect', expected.networkId], signal)),
    runOwnedProbe('runtime-storage', names, () => asyncDocker(['volume', 'inspect', ...names], signal)),
    ...names.map(name => runOwnedProbe('runtime-references', name, () => asyncDocker(['ps', '--all', '--quiet', '--no-trunc', '--filter', `volume=${name}`], signal))),
  ])
  const failure = results.find(result => result.status === 'rejected')
  if (failure) throw failure.reason
  const [logs, container, network, volumes, ...references] = results.map(result => result.value)
  const ready = logs.split('\n').flatMap(line => {
    try { const row = JSON.parse(line); return row.event === 'managed-native-profile-ready' ? [row] : [] } catch { return [] }
  })
  assert.equal(ready.length, 1, 'One native policy readiness receipt required')
  return { container, network: JSON.parse(network)[0], volumes: JSON.parse(volumes), ready: ready[0],
    references: Object.fromEntries(names.map((name, index) => [name, references[index].split('\n').filter(Boolean).sort()])) }
}
const persistState = async ({ closed = false } = {}) => {
  if (prior) assert.equal(replacements.size, accounts.length, 'Previous account preflight must be complete')
  const bindings = []
  for (const member of accounts) {
    bindings.push(...await sql`select *, lease_expires_at<=clock_timestamp() as expired from haas.runtime_bindings
      where tenant_id=${config.tenantId} and user_id=${member.userId}`)
  }
  const selected = selectMemberCheckpoint({ accounts, tenantId: config.tenantId, bindings,
    knownCells: [...cells, ...(prior?.cells ?? [])], closed })
  const privateCells = selected.map(cell => {
    const key = cells.find(known => known.pin.containerId === cell.pin.containerId)?.transportKey
      ?? priorGateway?.nativePrivateCells.find(known => ['cellId', 'tenantId', 'userId', 'role', 'volumeName']
        .every(field => known[field] === cell.pin[field]))?.transportKey
    assert.match(key, /^[a-f0-9]{64}$/, 'Exact retained cell transport key required')
    return { ...cell.pin, transportKey: key }
  })
  if (closed) for (const cell of selected) for (const name of [cell.pin.volumeName, cell.controlVolume]) {
    const [volume] = JSON.parse(docker(['volume', 'inspect', name])); assert.equal(volume.Name, name)
    for (const [key, value] of Object.entries(cell.labels)) assert.equal(volume.Labels[key], value)
    assert.equal(docker(['ps', '--all', '--quiet', '--filter', `volume=${name}`]), '', 'Closed checkpoint volume still has a writer reference')
    if (!volumes.includes(name)) volumes.push(name)
  }
  // A running managed gateway owns its config replacement + reload handshake.
  // Writing its file before replaceCell() would invalidate that exact-owner
  // check. Startup and post-join closure have no competing live config writer.
  if (!ownedGateway || closed) await writeFile(join(evidence, 'gateway-config.json'),
    JSON.stringify({ ...gateway, nativePrivateCells: privateCells }, null, 2))
  await writeFile(join(evidence, 'operator-state.json'), JSON.stringify({ run, sourceRoot: root, databaseConfigPath: input.databaseConfigPath,
    cells: selected, userVolumesRemoved: false, finalWorkerImageAccepted: false }, null, 2))
}
const recoverMember = async (old, command, signal, authorization) => {
  assert.ok(ownedGateway?.available && old.withdrawn && !old.retired, 'Exact withdrawn owned member and available gateway required')
  signal.throwIfAborted()
  const resources = await readRuntimeResources(sql, old.pin.tenantId, old.pin.userId)
  resourceArgs(resources) // Reject suspended intent before retiring any resource.
  await authorization?.verify()
  const before = await asyncVerifyOwned(old.pin.containerId, old.labels, signal)
  assert.equal(before.State.Running, false, 'Old writer must be stopped before recovery')
  assert.equal((await asyncVerifyOwned(old.fenceId, old.labels, signal)).State.Status, 'created')
  const [binding] = await sql`select *, lease_expires_at<=clock_timestamp() as expired from haas.runtime_bindings
    where cell_id=${old.pin.cellId}`
  assert.ok(binding && binding.status === 'suspended' && binding.expired && binding.isolation_mode === 'container-managed')
  for (const [field, column] of Object.entries({ cellId: 'cell_id', tenantId: 'tenant_id', userId: 'user_id', origin: 'origin',
    containerId: 'container_id', imageId: 'image_id', volumeName: 'volume_name', policyDigest: 'policy_digest' })) assert.equal(old.pin[field], binding[column])
  const previousPin = { ...old.pin, revision: binding.revision }
  await authorization?.verify()
  await event({ event: 'member-recovery-started', requestId: command.requestId, cellId: old.pin.cellId, previousPin })
  await writeFile(join(evidence, old.pin.containerId + '-retired.log'), await asyncDocker(['logs', '--tail', '500', old.pin.containerId], signal))
  await asyncDocker(['rm', old.pin.containerId], signal)
  old.retired = true
  const [network] = JSON.parse(await asyncDocker(['network', 'inspect', old.networkId], signal))
  assert.equal(network.Id, old.networkId); assert.equal(Object.keys(network.Containers).length, 0)
  for (const [key, value] of Object.entries(old.labels)) assert.equal(network.Labels[key], value)
  await asyncDocker(['network', 'rm', old.networkId], signal)
  networks.splice(networks.findIndex(row => row.id === old.networkId), 1)
  for (const volume of [old.pin.volumeName, old.controlVolume]) {
    assert.equal(await asyncDocker(['ps', '--all', '--quiet', '--filter', `volume=${volume}`], signal), '', 'Original volumes must have no other container reference')
  }
  const resourceName = old.pin.role === 'admin' ? `admin-${old.pin.userId}` : old.member
  const prefix = `paimind-haas-member-${run.slice(0, 8)}-${resourceName}-${command.requestId}`
  await event({ event: 'member-recovery-network-intent', requestId: command.requestId, name: prefix + '-network', labels: old.labels })
  const networkId = await asyncDocker(['network', 'create', '--driver', 'bridge', ...ownerLabels(old.labels), prefix + '-network'], signal)
  networks.push({ id: networkId, labels: old.labels })
  const name = prefix + '-native'
  await authorization?.verify()
  await event({ event: 'member-recovery-container-intent', requestId: command.requestId, name, networkId, labels: old.labels,
    dataVolume: old.pin.volumeName, controlVolume: old.controlVolume })
  const reservation = await reservePort(signal)
  let containerId, cell
  try {
  containerId = await asyncDocker(['create', '--name', name, ...ownerLabels(old.labels), ...runtimeCommon, ...resourceArgs(resources), '--user', '10001:10001', '--init', '--network', networkId,
    '--mount', `type=volume,src=${old.pin.volumeName},dst=/var/lib/paimind,volume-nocopy`,
    '--mount', `type=volume,src=${old.controlVolume},dst=/run/paimind-cell,readonly,volume-nocopy`,
    '--env', 'PAIMIND_CELL_INGRESS=1', '--env', 'PAIMIND_CELL_POLICY=' + managedToolPolicyForRole(old.pin.role),
    '--publish', `127.0.0.1:${reservation.port}:3211`, input.imageId, '--run-storage', old.generation], signal, 15000)
  cell = { name, labels: old.labels, generation: old.generation, networkId, controlVolume: old.controlVolume, fenceId: old.fenceId,
    member: old.member, transportKey: old.transportKey, resources, pin: { ...old.pin, revision: randomUUID(), containerId, origin: reservation.origin } }
  cells.push(cell)
  await asyncVerifyOwned(containerId, cell.labels, signal)
  await reservation.release(); signal.throwIfAborted()
  await asyncDocker(['start', containerId], signal, 15000)
  } finally { await reservation.release() }
  const state = await asyncVerifyOwned(containerId, cell.labels, signal), port = state.NetworkSettings.Ports['3211/tcp']?.[0]
  assert.equal(port?.HostIp, '127.0.0.1'); assert.equal(port.HostPort, String(reservation.port))
  cell.agent = new CellTransport(cell.pin.origin, cell.transportKey); agents.push(cell.agent)
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(60000)])
  let verified
  while (!deadline.aborted) {
    assert.equal((await asyncVerifyOwned(containerId, cell.labels, deadline)).State.Running, true)
    try {
      const observation = await asyncObservation(cell, deadline)
      verified = verifyManagedCell(observation, cell, seccomp)
      await nativeHealth(cell.agent, deadline)
      await writeFile(join(evidence, command.requestId + '-readback.json'), JSON.stringify({ ...observation, receipt: verified }, null, 2))
      break
    } catch {
      // Readiness is not admission. A bounded retry never renews either the
      // suspended old pin or an unverified candidate; healthy lanes still run.
      verified = undefined
      await delay(500, undefined, { signal: deadline })
    }
  }
  assert.ok(verified, 'Recovered native policy did not become ready'); signal.throwIfAborted()
  assert.equal((await asyncVerifyOwned(cell.fenceId, cell.labels, signal)).State.Status, 'created')
  await admissionFor(cell.pin).replaceSuspended(previousPin, cell.pin, verified.resources, authorization?.beforeAdmission, old.pin); cell.admitted = true
  await persistState()
  const acknowledgement = await ownedGateway.replaceCell({ ...cell.pin, transportKey: cell.transportKey }, signal)
  const currentResources = verifyManagedCell(await asyncObservation(cell, signal), cell, seccomp).resources
  await nativeHealth(cell.agent, signal); await admissionFor(cell.pin).renew(cell.pin, currentResources); signal.throwIfAborted()
  await authorization?.complete(cell.pin)
  await event({ event: 'member-recovery-confirmed', requestId: command.requestId, cellId: cell.pin.cellId,
    revision: cell.pin.revision, containerId, gatewayPid: ownedGateway.pid, acknowledgement }).catch(() => {
    console.error(JSON.stringify({status:'MEMBER_RECOVERY_LOCAL_EVIDENCE_UNAVAILABLE',requestId:command.requestId,evidence}))
  })
  return cell
}
const withdrawUnconfirmedRecovery = async command => {
  let withdrawalConfirmed = true
  for (const cell of cells.filter(value => value.pin.cellId === command.cellId && !value.retired)) {
    try {
      if (cell.pin.origin) await admissionFor(cell.pin).suspend(cell.pin)
      const observed = await asyncVerifyOwned(cell.pin.containerId, cell.labels)
      if (observed.State.Running) await asyncDocker(['stop', '--timeout', '15', cell.pin.containerId], undefined, 20000)
      assert.equal((await asyncVerifyOwned(cell.pin.containerId, cell.labels)).State.Running, false)
      cell.agent?.destroy(); cell.withdrawn = true
    } catch { withdrawalConfirmed = false }
  }
  try { await persistState() } catch { withdrawalConfirmed = false }
  await event({ event: 'member-recovery-unconfirmed', requestId: command.requestId, withdrawalConfirmed, recovery: recoveryRequests.snapshot() })
  return withdrawalConfirmed
}
// Serialize administrator and explicit local operator commands through the
// original rendezvous. A waiting lane never claims a second queued request.
const serializeRecovery = work => {
  const operation = pendingRecovery.then(work)
  pendingRecovery = operation.catch(() => {})
  return operation
}
try {
  // Schema migration is a separate explicit deployment step, not an implicit
  // side effect of starting this controller.
  await sql`select container_id, policy_digest, resource_observation from haas.admitted_runtime_bindings limit 0`
  await sql`select request_id from haas.runtime_recovery_requests limit 0`
  await sql`select command_id from haas.session_create_commands limit 0`
  await sql`select source_revision from haas.runtime_replacement_lineage limit 0`
  for (const member of accounts) {
    const rows = await sql`select user_id, display_name from haas.users where tenant_id = ${config.tenantId}
      and user_id = ${member.userId} and username = ${member.username} and role = ${member.role} and status = 'active'`
    assert.equal(rows.length, 1)
    const resources = await readRuntimeResources(sql, config.tenantId, member.userId)
    resourceArgs(resources); resourcePlans.set(member.userId, resources)
    if (member.role === 'member') assert.equal(rows[0].display_name, member.username === 'hansen' ? 'Hansen' : 'Alex')
    const bindings = await sql`select *, lease_expires_at <= clock_timestamp() as expired from haas.runtime_bindings
      where tenant_id = ${config.tenantId} and user_id = ${member.userId}`
    if (!prior) assert.equal(bindings.length, 0, 'Existing member binding requires explicit maintenance, never overwrite')
    else {
      const old = prior.cells.find(cell => cell.member === member.username)
      assert.ok(old); assert.equal(old.pin.role, member.role); assert.equal(bindings.length, 1); const b = bindings[0]
      for (const [field, column] of Object.entries({ cellId: 'cell_id', tenantId: 'tenant_id', userId: 'user_id',
        containerId: 'container_id', imageId: 'image_id', volumeName: 'volume_name', policyDigest: 'policy_digest', origin: 'origin' })) {
        assert.equal(old.pin[field], b[column], 'Previous runtime identity changed')
      }
      assert.equal(b.status, 'suspended'); assert.equal(b.expired, true); assert.equal(b.isolation_mode, 'container-managed')
      for (const volume of [old.pin.volumeName, old.controlVolume]) assert.equal(docker(['ps', '--all', '--quiet', '--filter', `volume=${volume}`]), '')
      replacements.set(member.userId, { ...old, previousPin: { ...old.pin, revision: b.revision } })
    }
  }
  for (const member of accounts) {
    shouldContinue()
    const old = replacements.get(member.userId)
    const resourceName = member.role === 'admin' ? `admin-${member.userId}` : member.username
    const cellId = old?.pin.cellId ?? randomUUID(), revision = randomUUID(), prefix = `paimind-haas-member-${run.slice(0, 8)}-${resourceName}`
    const labels = old?.labels ?? { 'io.paimind.goal': 'enterprise-haas-member-acceptance', 'io.paimind.run': run, 'io.paimind.runtime-cell': cellId }
    const data = old?.pin.volumeName ?? docker(['volume', 'create', ...ownerLabels(labels), prefix + '-data'])
    const control = old?.controlVolume ?? docker(['volume', 'create', ...ownerLabels(labels), prefix + '-control']); volumes.push(data, control)
    const fenceId = docker(['create', '--name', offlineStorageFenceName(data), ...ownerLabels(labels), ...common,
      '--user', '10001:10001', '--network', 'none', '--entrypoint', '/usr/local/bin/node', input.imageId, '-e', 'process.exit(0)'])
    fences.push({ id: fenceId, labels }); assert.equal(verifyOwned(fenceId, labels).State.Status, 'created')
    for (const volume of old ? [] : [data, control]) await complete(['--user', '0:0', '--cap-add', 'CHOWN', '--network', 'none',
      '--mount', `type=volume,src=${volume},dst=/var/lib/paimind,volume-nocopy`, '--entrypoint', '/usr/local/bin/node', input.imageId,
      '--input-type=module', '-e', "import assert from'node:assert/strict';import{readdir,chmod,chown}from'node:fs/promises';const p='/var/lib/paimind';assert.deepEqual(await readdir(p),[]);await chmod(p,0o700);await chown(p,10001,10001)"], labels)
    const transportKey = old ? priorGateway.nativePrivateCells.find(cell => cell.cellId === cellId)?.transportKey : randomBytes(32).toString('hex')
    assert.match(transportKey, /^[a-f0-9]{64}$/)
    const capsule = JSON.stringify({ schemaVersion: 1, role: member.role, policy: managedToolPolicyForRole(member.role), cellId,
      tenantId: config.tenantId, userId: member.userId })
    if (!old) await complete(['--user', '10001:10001', '--network', 'none', '--interactive',
      '--mount', `type=volume,src=${control},dst=/var/lib/paimind,volume-nocopy`, '--entrypoint', '/usr/local/bin/node', input.imageId,
      '--input-type=module', '-e', "import{writeFileSync}from'node:fs';let text='';for await(const b of process.stdin)text+=b;const value=JSON.parse(text);writeFileSync('/var/lib/paimind/transport-key',value.token,{mode:0o400,flag:'wx'});writeFileSync('/var/lib/paimind/member-policy.json',value.capsule,{mode:0o400,flag:'wx'})"],
    labels, JSON.stringify({ token: transportKey, capsule }))
    let generation = old?.generation
    if (!old) {
    const prepare = await complete(['--user', '10001:10001', '--network', 'none', '--init',
      '--mount', `type=volume,src=${data},dst=/var/lib/paimind,volume-nocopy`, input.imageId, '--prepare-storage'], labels)
    await writeFile(join(evidence, member.username + '-prepare.log'), prepare)
    const receipts = prepare.split('\n').flatMap(line => { try { const row = JSON.parse(line); return row.event === 'native-storage-prepared' ? [row] : [] } catch { return [] } })
    assert.equal(receipts.length, 1); generation = receipts[0].generation
    }
    assert.match(generation, /^\/var\/lib\/paimind\/storage-generations\/unpublished-[a-zA-Z0-9]+$/)
    const networkId = docker(['network', 'create', '--driver', 'bridge', ...ownerLabels(labels), prefix + '-network'])
    networks.push({ id: networkId, labels })
    const name = prefix + '-native'
    const reservation = await reservePort(lifetime.signal)
    const resources = resourcePlans.get(member.userId)
    let containerId, cell
    try {
    containerId = docker(['create', '--name', name, ...ownerLabels(labels), ...runtimeCommon, ...resourceArgs(resources), '--user', '10001:10001', '--init', '--network', networkId,
      '--mount', `type=volume,src=${data},dst=/var/lib/paimind,volume-nocopy`,
      '--mount', `type=volume,src=${control},dst=/run/paimind-cell,readonly,volume-nocopy`,
      '--env', 'PAIMIND_CELL_INGRESS=1', '--env', 'PAIMIND_CELL_POLICY=' + managedToolPolicyForRole(member.role),
      '--publish', `127.0.0.1:${reservation.port}:3211`, input.imageId, '--run-storage', generation])
    cell = { name, labels, generation, networkId, controlVolume: control, fenceId, member: member.username, resources,
      transportKey, pin: { cellId, tenantId: config.tenantId, userId: member.userId, role: member.role, revision,
        containerId, imageId: input.imageId, volumeName: data, origin: reservation.origin,
        policyDigest: 'sha256:' + createHash('sha256').update(capsule).digest('hex') } }
    cells.push(cell); verifyOwned(containerId, labels)
    await reservation.release(); shouldContinue(); docker(['start', containerId])
    } finally { await reservation.release() }
    const state = verifyOwned(containerId, labels)
    const port = state.NetworkSettings.Ports['3211/tcp']?.[0]
    assert.equal(port?.HostIp, '127.0.0.1'); assert.equal(port.HostPort, String(reservation.port))
    const agent = new CellTransport(cell.pin.origin, transportKey); agents.push(agent); cell.agent = agent
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      shouldContinue(); assert.equal(verifyOwned(containerId, labels).State.Running, true)
      let apiReady = false
      try { await nativeHealth(agent); apiReady = true } catch { /* Still within the bounded startup window. */ }
      // The HTTP listener can answer before the native bootstrap has returned
      // and emitted its policy receipt. Both signals are required; absence is
      // pending, while duplicate or invalid receipts must never be accepted.
      const receipts = readinessReceipts(cell)
      assert.ok(receipts.length <= 1, 'Duplicate native policy readiness receipts')
      if (apiReady && receipts.length === 1) { ready = true; break }
      await delay(500)
    }
    assert.ok(ready, 'Native member composition did not become ready')
    const obs = observation(cell); const receipt = verifyManagedCell(obs, cell, seccomp)
    await writeFile(join(evidence, member.username + '-initial-readback.json'), JSON.stringify({ ...obs, receipt }, null, 2))
    await event({ event: 'member-cell-ready-unbound', member: member.username, ...receipt })
  }
  for (const cell of cells) {
    const resources = verifyManagedCell(observation(cell), cell, seccomp).resources
    const old = replacements.get(cell.pin.userId)
    if (old) await admissionFor(cell.pin).replaceSuspended(old.previousPin, cell.pin, resources, undefined, old.pin)
    else await admissionFor(cell.pin).admit(cell.pin, resources)
    cell.admitted = true
  }
  // Write a new private startup file. Existing live gateway/config is untouched.
  await persistState()
  if (input.manageGateway) {
    ownedGateway = await startManagedGateway({ entry: join(root, 'apps/enterprise-server/lib/cli.js'), configPath: join(evidence, 'gateway-config.json'),
      logPath: join(evidence, 'managed-gateway.log'), signal: lifetime.signal })
    await writeFile(join(evidence, 'gateway-process.json'), JSON.stringify({ gatewayPid: ownedGateway.pid, controllerPid: process.pid,
      publicOrigin: gateway.publicOrigin, configPath: join(evidence, 'gateway-config.json') }))
    recoverySignal = () => {
      let command
      try { command = readMemberRecoveryCommand(privateJson(join(evidence, 'recovery-request.json'))) }
      catch { console.error(JSON.stringify({status:'MEMBER_RECOVERY_REQUEST_REJECTED',evidence})); return }
      void serializeRecovery(async () => {
        let work
        try { work = recoveryRequests.recover(command, recoverMember) }
        catch { console.error(JSON.stringify({status:'MEMBER_RECOVERY_REQUEST_REJECTED',evidence})); return }
        let result
        try {
          result = await work
        } catch {
          await withdrawUnconfirmedRecovery(command)
          console.error(JSON.stringify({ status: 'MEMBER_RECOVERY_UNCONFIRMED', evidence }))
          return
        }
        await event({ event: 'member-recovery-result', ...result })
        console.log(JSON.stringify({ ...result, status: 'ONE_MEMBER_RUNTIME_RECOVERED', evidence }))
      }).catch(() => console.error(JSON.stringify({status:'MEMBER_RECOVERY_RESULT_UNCONFIRMED',evidence})))
    }
    process.on('SIGHUP', recoverySignal)
  }
  console.log(JSON.stringify({ status: 'MEMBER_CELLS_BOUND_CONTROLLER_RUNNING', evidence, pid: process.pid,
    members: cells.map(cell => ({ username: cell.member, cellId: cell.pin.cellId, origin: cell.pin.origin })),
    ...(ownedGateway ? { gatewayPid: ownedGateway.pid } : {}), browserE2EVerified: false }))
  const lanes = await maintainMemberLeases(cells, {
    signal: lifetime.signal,
    cycle: async (cell, cancellation) => {
      const started = performance.now(), deadline = AbortSignal.any([cancellation, AbortSignal.timeout(10000)])
      const { value: resources, attempts } = await readLeaseObservation(async signal => {
        const observed = verifyManagedCell(await asyncObservation(cell, signal), cell, seccomp).resources
        await nativeHealth(cell.agent, signal)
        await runOwnedProbe('storage-fence', cell.fenceId, async () => {
          assert.equal((await asyncVerifyOwned(cell.fenceId, cell.labels, signal)).State.Status, 'created')
        })
        return observed
      }, {
        signal: deadline,
        onRetry: diagnostic => event({ event: 'member-observation-transport-retry', cellId: cell.pin.cellId,
          revision: cell.pin.revision, nextAttempt: 2, totalDeadlineMs: 10000, ...diagnostic }),
      })
      deadline.throwIfAborted(); await admissionFor(cell.pin).renew(cell.pin, resources); cancellation.throwIfAborted()
      // Each lane has one evidence writer. This observation is not a lease
      // grant; the database remains authoritative and retains the same 30s TTL.
      await writeFile(join(evidence, `lease-${cell.pin.cellId}.json`), JSON.stringify({ cellId: cell.pin.cellId,
        renewedAt: new Date().toISOString(), observationAttempts: attempts, checkElapsedMs: Math.round(performance.now() - started) }))
    },
    withdraw: async cell => {
      try { await admissionFor(cell.pin).suspend(cell.pin) } catch { /* No further renewal: the original DB lease still expires. */ }
      const state = await asyncVerifyOwned(cell.pin.containerId, cell.labels)
      if (state.State.Running) await asyncDocker(['stop', '--timeout', '15', cell.pin.containerId], undefined, 20000)
      assert.equal((await asyncVerifyOwned(cell.pin.containerId, cell.labels)).State.Running, false)
      cell.agent.destroy(); cell.withdrawn = true
    },
    onTerminal: async (cell, outcome) => {
      await event({ event: outcome.state === 'withdrawn' ? 'one-member-runtime-withdrawn' : 'one-member-withdrawal-unconfirmed',
        cellId: cell.pin.cellId, reason: outcome.error.message,
        ...(outcome.error.commandDiagnostic ? { commandDiagnostic: outcome.error.commandDiagnostic } : {}),
        ...(outcome.error.ownedProbe ? { ownedProbe: outcome.error.ownedProbe } : {}),
        ...(outcome.withdrawalError ? { withdrawalReason: outcome.withdrawalError.message,
          ...(outcome.withdrawalError.commandDiagnostic ? { withdrawalDiagnostic: outcome.withdrawalError.commandDiagnostic } : {}) } : {}) })
      console.log(JSON.stringify({ status: outcome.state === 'withdrawn' ? 'ONE_MEMBER_RUNTIME_WITHDRAWN' : 'ONE_MEMBER_WITHDRAWAL_UNCONFIRMED', member: cell.member, evidence }))
    },
    ...(ownedGateway ? { waitForRecovery: (cell, signal) => {
      const waiting = recoveryRequests.wait(cell, signal)
      console.log(JSON.stringify({ status: 'MEMBER_READY_FOR_EXPLICIT_RECOVERY', cellId: cell.pin.cellId, revision: cell.pin.revision, evidence }))
      return waitForAdministratorRecovery(waiting, {signal,
        poll: cancellation => serializeRecovery(async () => {
          cancellation.throwIfAborted()
          if (!recoveryRequests.snapshot().some(row=>row.cellId===cell.pin.cellId&&row.state==='withdrawn')) return false
          const claim = await administratorRecovery.claim(cell.pin)
          if (!claim) return true
          const command = {requestId:claim.requestId,cellId:cell.pin.cellId,expectedRevision:cell.pin.revision}
          let outcome = 'confirmed'
          try {
            cancellation.throwIfAborted()
            await recoveryRequests.recover(command,(old,request,innerSignal)=>recoverMember(old,request,innerSignal,{
              verify:()=>administratorRecovery.verify(claim),
              beforeAdmission:db=>administratorRecovery.verifyInTransaction(db,claim),
              complete:next=>administratorRecovery.complete(claim,next),
            }))
          } catch {
            await withdrawUnconfirmedRecovery(command)
            await administratorRecovery.unconfirmed(claim)
            outcome = 'unconfirmed'
          }
          // Local evidence failure cannot undo a durably confirmed recovery.
          // The original lane and database receipt remain authoritative.
          await event({event:`administrator-member-recovery-${outcome}`,requestId:claim.requestId,cellId:cell.pin.cellId})
          return false
        }),
        onError:()=>event({event:'administrator-recovery-inbox-unavailable',cellId:cell.pin.cellId,claimedActionAutomaticRetry:false}),
      })
    } } : {}),
  })
  if (lanes.some(lane => lane.status === 'rejected' || lane.value.state === 'withdrawal-unconfirmed')) throw Error('Member withdrawal needs operator inspection')
} catch (error) {
  await event({ event: 'controller-failed', error: error.message }); process.exitCode = 1
  console.error(JSON.stringify({ status: 'MEMBER_CONTROLLER_CLOSED_ON_FAILURE', evidence, error: error.message }))
} finally {
  stopping = true
  lifetime.abort()
  if (recoverySignal) process.off('SIGHUP', recoverySignal)
  const cleanupFailures = []
  const cleanupStep = async (step, work) => {
    try { await work() } catch {
      cleanupFailures.push(step)
      try { await event({ event: 'owned-cleanup-unconfirmed', step }) } catch { /* Still attempt the other owned cleanup steps. */ }
    }
  }
  await cleanupStep('pending-recovery', () => pendingRecovery)
  if (ownedGateway) await cleanupStep('gateway', async () => event({ event: 'owned-gateway-joined', ...await ownedGateway.stop() }))
  for (const cell of cells) {
    if (cell.pin.origin) await cleanupStep(`suspend:${cell.pin.containerId}`, () => admissionFor(cell.pin).suspend(cell.pin))
  }
  for (const agent of agents) await cleanupStep('transport', () => agent.destroy())
  // Close ONLY this invocation's exact immutable resources. Never delete data.
  for (const record of [...cells.filter(cell => !cell.retired).map(cell => ({ id: cell.pin.containerId, labels: cell.labels })), ...transient]) {
    await cleanupStep(`container:${record.id}`, async () => {
    const before = verifyOwned(record.id, record.labels)
    if (before.State.Running) docker(['stop', '--time', '15', record.id])
    const after = verifyOwned(record.id, record.labels); assert.equal(after.State.Running, false)
    await writeFile(join(evidence, record.id + '-closed.log'), docker(['logs', '--tail', '500', record.id]))
    await event({ event: 'owned-container-joined', id: record.id, exitCode: after.State.ExitCode })
    docker(['rm', record.id])
    })
  }
  for (const record of networks) {
    await cleanupStep(`network:${record.id}`, async () => {
    const [n] = JSON.parse(docker(['network', 'inspect', record.id])); assert.equal(n.Id, record.id)
    for (const [key, value] of Object.entries(record.labels)) assert.equal(n.Labels[key], value)
    assert.equal(Object.keys(n.Containers).length, 0); docker(['network', 'rm', record.id])
    })
  }
  // Keep exclusion fences if any writer or cleanup outcome is still unknown.
  if (cleanupFailures.length === 0) for (const record of fences) await cleanupStep(`fence:${record.id}`, async () => {
    assert.equal(verifyOwned(record.id, record.labels).State.Status, 'created'); docker(['rm', record.id])
  })
  const finalized = await finalizeMemberCheckpoint({ cleanupComplete: cleanupFailures.length === 0,
    persist: () => persistState({ closed: true }),
    writeReceipt: result => writeFile(join(evidence, 'closed.json'), JSON.stringify({ closedAt: new Date().toISOString(),
      ...result, cleanupFailures, retainedVolumes: [...new Set(volumes)], userVolumesRemoved: false })),
    closeDatabase: () => sql.end({ timeout: 5 }),
  })
  if (cleanupFailures.length || finalized.failures.length) {
    process.exitCode = 1
    console.error(JSON.stringify({ status: 'MEMBER_CLOSURE_NEEDS_INSPECTION', evidence, ...finalized, cleanupFailures }))
  }
}
