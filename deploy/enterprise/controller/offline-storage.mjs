import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'

export function offlineStorageFenceName(volume) {
  assert.match(volume, /^paimind-[a-z0-9][a-z0-9-]{4,150}$/)
  return `paimind-storage-fence-${createHash('sha256').update(volume).digest('hex').slice(0, 32)}`
}

/** Internal operator controller, never a browser endpoint. The caller must
 * suspend admission and stop/join/remove the old cell before entering. A named,
 * never-started daemon object serializes cooperating controllers for this exact
 * volume. All existing container references (including stopped ones) reject.
 * This does not revoke arbitrary daemon administrators' access to the volume.
 * Controller death retains the fence; no timeout-based automatic takeover.
 */
export async function withOfflineStorageFence({ volume, imageId, policy, ownerLabels, record = async () => {} }, operation) {
  const fenceName = offlineStorageFenceName(volume), attempt = randomUUID()
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/)
  assert.equal(realpathSync(policy), policy); assert.ok(statSync(policy).isFile())
  const labels = Object.entries(ownerLabels ?? {})
  assert.ok(labels.length > 0 && labels.length <= 8, 'Explicit volume ownership labels required')
  for (const [key, value] of labels) {
    assert.match(key, /^io\.paimind\.[a-z][a-z0-9.-]*$/)
    assert.ok(typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,160}$/.test(value))
  }
  const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 45_000, maxBuffer: 4 * 1024 ** 2 }).trim()
  const inspectVolume = () => {
    const [v] = JSON.parse(docker(['volume', 'inspect', volume]))
    assert.equal(v.Name, volume); assert.equal(v.Driver, 'local'); assert.equal(v.Scope, 'local')
    assert.ok(!v.Options || Object.keys(v.Options).length === 0)
    for (const [key, value] of labels) assert.equal(v.Labels?.[key], value, 'Volume ownership mismatch')
  }
  const references = () => {
    inspectVolume()
    return docker(['ps', '--all', '--quiet', '--no-trunc', '--filter', `volume=${volume}`]).split('\n').filter(Boolean).sort()
  }
  assert.deepEqual(references(), [], 'Storage is still referenced by another container')
  const [image] = JSON.parse(docker(['image', 'inspect', imageId]))
  assert.equal(image.Id, imageId); assert.equal(image.Os, 'linux'); assert.equal(image.Architecture, 'arm64')
  assert.ok(!Object.keys(image.Config.Volumes ?? {}).length, 'Implicit image volumes are forbidden')
  const common = ['--user', '10001:10001', '--read-only', '--network', 'none', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true', '--security-opt', `seccomp=${policy}`,
    '--memory', '128m', '--cpus', '1', '--pids-limit', '64', '--restart', 'no', '--entrypoint', '/usr/local/bin/node',
    '--label', `io.paimind.storage-volume=${volume}`, '--label', `io.paimind.storage-attempt=${attempt}`]
  // Name allocation is the acquisition. Do not inspect-and-delete an existing
  // fence, even if it was never started or its creator can no longer be found.
  const fence = docker(['create', '--name', fenceName, ...common,
    '--label', 'io.paimind.storage-role=fence', imageId, '-e', 'process.exit(0)'])
  assert.match(fence, /^[a-f0-9]{64}$/)
  const jobs = new Map()
  const pending = new Set()
  let live = true, uncertain = false, busy = false
  const inspect = (id, role) => {
    const [s] = JSON.parse(docker(['inspect', id]))
    assert.equal(s.Id, id); assert.equal(s.Image, imageId)
    assert.equal(s.Config.Labels['io.paimind.storage-attempt'], attempt)
    assert.equal(s.Config.Labels['io.paimind.storage-volume'], volume)
    assert.equal(s.Config.Labels['io.paimind.storage-role'], role)
    assert.equal(s.Config.User, '10001:10001'); assert.equal(s.HostConfig.ReadonlyRootfs, true)
    assert.equal(s.HostConfig.NetworkMode, 'none'); assert.equal(s.HostConfig.Privileged, false)
    assert.deepEqual(s.HostConfig.CapDrop, ['ALL']); assert.deepEqual(s.HostConfig.CapAdd ?? [], [])
    assert.equal(s.HostConfig.RestartPolicy.Name, 'no')
    assert.ok(s.HostConfig.SecurityOpt.includes('no-new-privileges:true'))
    assert.ok(!s.HostConfig.Binds?.length && !s.HostConfig.VolumesFrom?.length && !s.HostConfig.Devices?.length)
    assert.ok(!Object.keys(s.HostConfig.PortBindings ?? {}).length)
    if (role === 'fence') {
      assert.equal(s.Name, '/' + fenceName); assert.equal(s.State.Status, 'created')
      assert.deepEqual(s.Mounts, [])
    } else {
      assert.equal(s.Mounts.length, 1)
      assert.equal(s.Mounts[0].Type, 'volume'); assert.equal(s.Mounts[0].Name, volume)
      assert.equal(s.Mounts[0].Destination, '/var/lib/paimind')
      assert.equal(s.HostConfig.Mounts[0].VolumeOptions.NoCopy, true)
    }
    return s
  }
  const removeJob = async id => {
    let state = inspect(id, jobs.get(id))
    if (state.State.Running) docker(['stop', '--time', '5', id])
    state = inspect(id, jobs.get(id)); assert.equal(state.State.Running, false)
    await record({ event: 'storage-maintenance-job-closed', id, state: state.State })
    docker(['rm', id]); jobs.delete(id)
  }
  const job = async (mode, expected) => {
    assert.ok(live, 'Offline controller scope has ended')
    assert.equal(busy, false, 'Offline storage operation is already running')
    inspect(fence, 'fence'); assert.deepEqual(references(), [], 'Storage is still referenced by another container')
    const role = mode === '--inspect' ? 'inspect' : 'quarantine'
    const id = docker(['create', ...common, '--label', `io.paimind.storage-role=${role}`,
      '--mount', `type=volume,source=${volume},target=/var/lib/paimind,volume-nocopy`,
      imageId, '/usr/local/lib/paimind/recover-native-storage.mjs', mode,
      ...(expected ? [JSON.stringify(expected)] : [])])
    jobs.set(id, role)
    busy = true
    try {
      inspect(id, role); inspect(fence, 'fence'); assert.deepEqual(references(), [id])
      await record({ event: 'storage-maintenance-job-created', id, role, volume, attempt })
      const response = spawnSync('docker', ['start', '--attach', id], {
        encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 ** 2,
      })
      const state = inspect(id, role)
      assert.equal(state.State.Running, false, 'Offline job did not terminate')
      assert.equal(response.status, 0, response.stderr); assert.equal(state.State.ExitCode, 0, response.stderr)
      inspect(fence, 'fence'); assert.deepEqual(references(), [id])
      const result = JSON.parse(response.stdout.trim())
      await record({ event: 'storage-maintenance-job-result', id, role, result })
      return result
    } finally { try { await removeJob(id) } finally { busy = false } }
  }
  const dispatch = (mode, expected) => {
    const current = job(mode, expected); pending.add(current)
    void current.then(() => pending.delete(current), () => pending.delete(current))
    return current
  }
  try {
    inspect(fence, 'fence')
    await record({ event: 'storage-maintenance-fence-acquired', fence, fenceName, volume, attempt })
    assert.deepEqual(references(), [], 'Storage is still referenced by another container')
    return await operation(Object.freeze({ inspect: () => dispatch('--inspect'), quarantine: expected => dispatch('--quarantine', expected) }))
  } finally {
    live = false
    await Promise.allSettled([...pending])
    try {
      for (const id of [...jobs.keys()]) await removeJob(id)
      assert.deepEqual(references(), [], 'Unexpected storage user; retaining controller fence')
      inspect(fence, 'fence'); docker(['rm', fence])
    } catch (error) { uncertain = true; throw error }
    finally { await record({ event: 'storage-maintenance-fence-closed', fence, retained: uncertain, volume, userVolumesRemoved: false }) }
  }
}
