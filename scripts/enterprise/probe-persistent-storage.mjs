import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withOfflineStorageFence } from '../../deploy/enterprise/controller/offline-storage.mjs'

// Operator-owned diagnostic only. No host bind, shared daemon change, user
// identity, gateway binding or final Worker admission is created here.
export async function probePersistentStorage({ evidence, imageId, policy, run, boundMaintenance }) {
  const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 45_000, maxBuffer: 8 * 1024 * 1024 }).trim()
  const goal = 'enterprise-haas-storage-persistence', volume = `paimind-haas-storage-${run}`
  const save = (name, value) => writeFile(join(evidence, name), JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
  const containers = new Map(), removed = []
  const events = output => output.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
  assert.match(run, /^[a-f0-9-]{36}$/); assert.match(imageId, /^sha256:[a-f0-9]{64}$/)
  assert.equal(docker(['volume', 'ls', '--quiet', '--filter', `name=^${volume}$`]), '')
  assert.equal(docker(['volume', 'create', '--label', `io.paimind.goal=${goal}`, '--label', `io.paimind.run=${run}`,
    '--label', `io.paimind.runtime-cell=${run}`, volume]), volume)
  const inspectVolume = () => {
    const [v] = JSON.parse(docker(['volume', 'inspect', volume]))
    assert.equal(v.Name, volume); assert.equal(v.Driver, 'local'); assert.equal(v.Scope, 'local')
    assert.ok(!v.Options || !Object.keys(v.Options).length)
    assert.equal(v.Labels['io.paimind.goal'], goal); assert.equal(v.Labels['io.paimind.run'], run)
    assert.equal(v.Labels['io.paimind.runtime-cell'], run)
    return v
  }
  const references = () => {
    inspectVolume()
    const ids = docker(['ps', '--all', '--quiet', '--no-trunc', '--filter', `volume=${volume}`]).split('\n').filter(Boolean)
    return ids.map(id => {
      const [value] = JSON.parse(docker(['inspect', id]))
      assert.ok(value.Mounts.some(m => m.Type === 'volume' && m.Name === volume))
      return value.Id
    }).sort()
  }
  const inspect = id => {
    const expected = containers.get(id); assert.ok(expected)
    const [s] = JSON.parse(docker(['inspect', id]))
    assert.equal(s.Id, id); assert.equal(s.Image, imageId); assert.equal(s.Name, '/' + expected.name)
    assert.equal(s.Config.Labels['io.paimind.run'], run); assert.equal(s.Config.Labels['io.paimind.role'], expected.role)
    assert.equal(s.Config.Labels['io.paimind.goal'], goal)
    assert.equal(s.Config.Labels['io.paimind.runtime-cell'], run)
    assert.equal(s.Config.User, expected.role === 'initialize' ? '0:0' : '10001:10001')
    assert.equal(s.HostConfig.ReadonlyRootfs, true); assert.equal(s.HostConfig.NetworkMode, 'none')
    assert.equal(s.HostConfig.Privileged, false); assert.deepEqual(s.HostConfig.CapDrop, ['ALL'])
    assert.ok(s.HostConfig.SecurityOpt.includes('no-new-privileges:true'))
    assert.equal(s.HostConfig.Memory, 1024 ** 3); assert.equal(s.HostConfig.NanoCpus, 1_000_000_000)
    assert.equal(s.HostConfig.PidsLimit, 256); assert.ok(!s.HostConfig.DeviceRequests?.length)
    assert.deepEqual(s.HostConfig.CapAdd ?? [], expected.role === 'initialize' ? ['CAP_CHOWN'] : [])
    assert.ok(!s.HostConfig.Binds?.length && !s.HostConfig.VolumesFrom?.length && !s.HostConfig.Devices?.length)
    assert.ok(!Object.keys(s.HostConfig.PortBindings ?? {}).length)
    const mounted = s.Mounts.filter(m => m.Type === 'volume')
    assert.equal(mounted.length, 1); assert.equal(mounted[0].Name, volume)
    assert.equal(mounted[0].Destination, '/var/lib/paimind'); assert.equal(mounted[0].RW, true)
    assert.equal(s.HostConfig.Mounts.find(m => m.Source === volume)?.VolumeOptions?.NoCopy, true)
    assert.ok(s.Mounts.every(m => m.Type === 'volume' || m.Type === 'tmpfs' && m.Destination === '/tmp'))
    return s
  }
  const create = (role, command = [], permittedReferences = []) => {
    assert.deepEqual(references(), [...permittedReferences].sort(), 'Storage volume has unexpected container references')
    const name = `paimind-haas-storage-${role}-${run.slice(0, 8)}`
    const id = docker(['create', '--init', '--name', name, '--user', role === 'initialize' ? '0:0' : '10001:10001',
      '--read-only', '--network', 'none', '--cap-drop', 'ALL', ...(role === 'initialize' ? ['--cap-add', 'CHOWN'] : []),
      '--security-opt', 'no-new-privileges:true', '--security-opt', `seccomp=${policy}`,
      '--memory', '1g', '--cpus', '1', '--pids-limit', '256',
      '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777,size=67108864',
      '--mount', `type=volume,source=${volume},target=/var/lib/paimind,volume-nocopy`,
      '--label', `io.paimind.goal=${goal}`, '--label', `io.paimind.run=${run}`, '--label', `io.paimind.role=${role}`,
      '--label', `io.paimind.runtime-cell=${run}`,
      ...(command.length ? ['--entrypoint', '/usr/local/bin/node'] : []), imageId, ...command])
    containers.set(id, { name, role }); inspect(id)
    assert.deepEqual(references(), [...permittedReferences, id].sort())
    return id
  }
  const logs = id => {
    inspect(id)
    const result = spawnSync('docker', ['logs', id], { encoding: 'utf8', timeout: 45_000, maxBuffer: 8 * 1024 * 1024 })
    assert.equal(result.status, 0)
    return result.stdout + result.stderr
  }
  const remove = async id => {
    const before = inspect(id)
    if (before.State.Running) docker(['stop', '--time', '15', id])
    const stopped = inspect(id); assert.equal(stopped.State.Running, false)
    const role = containers.get(id).role
    await save(`${role}-closed.json`, { state: stopped.State, output: logs(id), container: id })
    docker(['rm', id]); removed.push({ id, role, exitCode: stopped.State.ExitCode }); containers.delete(id)
  }
  const wait = async (id, timeoutMs = 120_000) => {
    const child = spawn('docker', ['wait', id], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; child.stdout.on('data', bytes => { output += bytes }); child.stderr.resume()
    const timeout = setTimeout(() => { if (inspect(id).State.Running) docker(['stop', '--time', '5', id]) }, timeoutMs)
    try {
      assert.equal(await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }), 0)
      const s = inspect(id); assert.equal(s.State.Running, false); assert.equal(Number(output.trim()), s.State.ExitCode)
      return { state: s.State, output: logs(id) }
    } finally { clearTimeout(timeout) }
  }
  const waitReady = async id => {
    const deadline = Date.now() + 40_000
    for (;;) {
      assert.equal(inspect(id).State.Running, true, logs(id))
      const ready = events(logs(id)).find(e => e.storageReplacementReady)
      if (ready) return ready
      assert.ok(Date.now() < deadline, 'Replacement did not become ready')
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
  const maintenance = { volume, imageId, policy, ownerLabels: { 'io.paimind.goal': goal, 'io.paimind.run': run } }
  let result
  try {
    await save('persistent-volume.json', inspectVolume())
    const initialize = create('initialize', ['--input-type=module', '-e',
      "import assert from'node:assert/strict';import{readdir,chmod,chown}from'node:fs/promises';const p='/var/lib/paimind';assert.deepEqual(await readdir(p),[]);await chmod(p,0o700);await chown(p,10001,10001);console.log('private empty storage initialized')"])
    docker(['start', initialize]); assert.equal((await wait(initialize)).state.ExitCode, 0); await remove(initialize)
    const seedId = create('seed'); await save('seed-container.json', inspect(seedId)); docker(['start', seedId])
    const seedRun = await wait(seedId); assert.equal(seedRun.state.ExitCode, 0, seedRun.output)
    const seed = events(seedRun.output).find(e => e.persistentNativeStorageSeedReady); assert.ok(seed)
    assert.equal(seed.actualOfflineActivationVerified, true)
    assert.equal(seed.atomicPrepareAndActivationVerified, true); assert.equal(seed.supersededRuntimeRejected, true)
    await remove(seedId); assert.deepEqual(references(), [])
    const replacements = []
    for (const role of ['replacement-one', 'replacement-two']) {
      const id = create(role, ['/usr/local/lib/paimind/storage-persistence-check.mjs', seed.generation, seed.projectWorkspaceId, seed.archivedSessionId])
      await save(`${role}-container.json`, inspect(id)); docker(['start', id])
      const ready = await waitReady(id)
      assert.equal(ready.generation, seed.generation)
      assert.equal(ready.actualActiveEntryVerified, true); assert.equal(ready.latestFilesAndLinkBoundariesPreserved, true)
      assert.equal(ready.nativeWorkspaceArchiveAndSessionResumed, true); assert.equal(ready.memberAdmissionVerified, false)
      if (role === 'replacement-one') {
        assert.throws(() => create('unexpected-second-owner'), /unexpected container references/)
        // Deliberate race injection in this one private volume: even another
        // runtime created outside our reference preflight must hit the shared
        // on-volume lock and exit before boot. Not a daemon-wide writer lease.
        const competitor = create('conflict', ['/usr/local/lib/paimind/start-native-runtime.mjs', '--run-active-storage'], [id])
        docker(['start', competitor]); const denied = await wait(competitor, 20_000)
        assert.notEqual(denied.state.ExitCode, 0); assert.match(denied.output, /EEXIST/)
        assert.equal(events(denied.output).some(e => e.event === 'managed-native-profile-ready'), false)
        assert.equal(inspect(id).State.Running, true); await remove(competitor)
        assert.deepEqual(references(), [id])
      }
      docker(['stop', '--time', '15', id]); const closed = inspect(id)
      assert.equal(closed.State.ExitCode, 0, logs(id))
      assert.ok(events(logs(id)).some(e => e.storageReplacementClosed && e.actualNativeShutdownJoined))
      replacements.push({ id, role, ready, cleanExit: true }); await remove(id)
    }
    // Real abrupt container death, not a manually created fake stale lock.
    const recoveryCommand = ['/usr/local/lib/paimind/storage-persistence-check.mjs', seed.generation, seed.projectWorkspaceId, seed.archivedSessionId]
    const crashId = create('crash', recoveryCommand)
    docker(['start', crashId]); await waitReady(crashId)
    await assert.rejects(withOfflineStorageFence(maintenance, () => assert.fail('Live volume must not enter maintenance')),
      /Storage is still referenced/)
    docker(['kill', '--signal', 'KILL', crashId])
    assert.equal((await wait(crashId)).state.ExitCode, 137)
    await remove(crashId)
    const blockedId = create('blocked-restart', ['/usr/local/lib/paimind/start-native-runtime.mjs', '--run-active-storage'])
    docker(['start', blockedId]); const blocked = await wait(blockedId, 20_000)
    assert.notEqual(blocked.state.ExitCode, 0); assert.match(blocked.output, /EEXIST/)
    assert.equal(events(blocked.output).some(e => e.event === 'managed-native-profile-ready'), false)
    await remove(blockedId)
    const controllerEvents = []; let recovery, retainedController
    try {
      await withOfflineStorageFence({ ...maintenance, record: async event => { controllerEvents.push(event) } }, async controller => {
        retainedController = controller
        await assert.rejects(withOfflineStorageFence(maintenance, () => assert.fail('Second controller must not acquire')),
          /already in use|Conflict/i)
        const before = await controller.inspect()
        assert.equal(before.activeGeneration, seed.generation); assert.ok(before.lock)
        await assert.rejects(controller.quarantine({ ...before, lock: { ...before.lock, ino: '0' } }), /changed/)
        assert.deepEqual(await controller.inspect(), before)
        recovery = await controller.quarantine(before)
        assert.equal(recovery.userDataDeleted, false); assert.equal(recovery.memberAdmissionVerified, false)
        assert.deepEqual(await controller.inspect(), { activeGeneration: seed.generation, lock: null })
      })
      await assert.rejects(retainedController.inspect(), /scope has ended/)
    } finally { await save('storage-controller-events.json', controllerEvents) }
    const recoveredId = create('crash-recovered', recoveryCommand)
    docker(['start', recoveredId]); const recovered = await waitReady(recoveredId)
    assert.equal(recovered.latestFilesAndLinkBoundariesPreserved, true)
    assert.equal(recovered.nativeWorkspaceArchiveAndSessionResumed, true)
    let boundMaintenanceReceipt
    if (boundMaintenance) {
      inspect(recoveredId)
      boundMaintenanceReceipt = await boundMaintenance({ containerId: recoveredId, cellId: run, volume, imageId, policy,
        ownerLabels: { 'io.paimind.goal': goal, 'io.paimind.run': run, 'io.paimind.runtime-cell': run } })
      assert.equal(boundMaintenanceReceipt.closedState.ExitCode, 0)
      assert.equal(boundMaintenanceReceipt.bindingStatus, 'suspended')
      const missing = spawnSync('docker', ['inspect', recoveredId], { encoding: 'utf8', timeout: 10_000 })
      assert.notEqual(missing.status, 0); assert.match(missing.stderr, /no such (object|container)/i)
      containers.delete(recoveredId); removed.push({ id: recoveredId, role: 'crash-recovered', exitCode: 0, operatorCommandRemoved: true })
      assert.deepEqual(references(), [])
    } else {
      docker(['stop', '--time', '15', recoveredId])
      assert.equal(inspect(recoveredId).State.ExitCode, 0, logs(recoveredId))
      await remove(recoveredId)
    }
    result = { persistentContainerReplacementVerified: true, imageId, run, volume,
      atomicPrepareAndActivationVerified: true, supersededRuntimeRejected: true,
      explicitActiveGenerationRecovered: true, twoDistinctReplacementContainers: replacements,
      unexpectedVolumeReferenceRejected: true, concurrentPreparedRuntimeRejected: true,
      realCrashRecovered: true, liveVolumeMaintenanceRejected: true, concurrentControllerRejected: true,
      staleLockIdentityRejected: true, ordinaryStartupDoesNotTakeOverLock: true,
      recovery, recoveredNative: recovered, controllerCrashTakeoverVerified: false,
      ...(boundMaintenanceReceipt ? { boundMaintenance: boundMaintenanceReceipt } : {}),
      volumeWriterLeaseVerified: false, finalWorkerVerified: false, memberAdmissionVerified: false, browserE2EVerified: false }
    await save('persistent-result.json', result)
  } finally {
    for (const id of [...containers.keys()]) await remove(id)
    assert.deepEqual(references(), [])
    await save('persistent-cleanup.json', { removedContainers: removed, volume, volumeRetained: true, userVolumesRemoved: false })
  }
  console.log(JSON.stringify({ evidence, persistentContainerReplacementVerified: result.persistentContainerReplacementVerified,
    replacements: result.twoDistinctReplacementContainers.length, volume, volumeRetained: true, memberAdmissionVerified: false }))
}
