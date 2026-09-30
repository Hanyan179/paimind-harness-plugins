import assert from 'node:assert/strict'
import { managedToolPolicyForRole } from '../worker/runtime/member-tool-policy.mjs'

/** Readback of an operator-created local acceptance cell. Caller fetches these
 * observations from Docker, never from the browser or a binding row. This is
 * not a production outbound-network approval or final-image acceptance claim.
 */
export function verifyMemberCell({ container: c, network: n, volumes, references, ready }, expected, seccomp) {
  assert.equal(expected.pin.role, 'member', 'Member-only verifier cannot admit an administrator')
  return verifyManagedCell({ container: c, network: n, volumes, references, ready }, expected, seccomp)
}

export function verifyManagedCell({ container: c, network: n, volumes, references, ready }, expected, seccomp) {
  const p = expected.pin, h = c.HostConfig
  const toolPolicy = managedToolPolicyForRole(p.role)
  assert.equal(c.Id, p.containerId); assert.equal(c.Image, p.imageId)
  assert.equal(c.Name, '/' + expected.name); assert.equal(c.State.Running, true)
  assert.equal(c.Config.User, '10001:10001'); assert.equal(c.Config.WorkingDir, '/var/lib/paimind')
  assert.deepEqual(c.Config.Entrypoint, ['/usr/local/bin/node', '/usr/local/lib/paimind/start-native-runtime.mjs'])
  assert.deepEqual(c.Config.Cmd, ['--run-storage', expected.generation])
  assert.ok(c.Config.Env.includes('PAIMIND_CELL_INGRESS=1'))
  assert.deepEqual(c.Config.Env.filter(value => value.startsWith('PAIMIND_CELL_POLICY=')), ['PAIMIND_CELL_POLICY=' + toolPolicy])
  assert.equal(h.ReadonlyRootfs, true); assert.equal(h.Privileged, false); assert.equal(h.Init, true)
  assert.deepEqual(h.CapDrop, ['ALL']); assert.deepEqual(h.CapAdd ?? [], [])
  assert.equal(h.RestartPolicy.Name, 'no'); assert.equal(h.NetworkMode, expected.networkId)
  assert.equal(h.IpcMode, 'private'); assert.equal(h.PidMode, ''); assert.equal(h.UTSMode, '')
  assert.equal(h.CgroupnsMode, 'private'); assert.equal(h.PublishAllPorts, false)
  for (const key of ['Binds', 'VolumesFrom', 'Devices', 'DeviceRequests', 'DeviceCgroupRules', 'ExtraHosts', 'GroupAdd', 'Links']) {
    assert.deepEqual(h[key] ?? [], [], `Unexpected ${key}`)
  }
  const resources = expected.resources ?? { revision: 0, desiredState: 'running', cpuMillis: 1000, memoryMiB: 1024, pidsLimit: 256 }
  assert.equal(resources.desiredState, 'running')
  for (const [key, min, max] of [['revision', 0, 2147483647], ['cpuMillis', 100, 1000], ['memoryMiB', 256, 1024], ['pidsLimit', 32, 256]]) {
    assert.ok(Number.isSafeInteger(resources[key]) && resources[key] >= min && resources[key] <= max, 'Invalid runtime resource observation')
  }
  assert.equal(h.Memory, resources.memoryMiB * 1024 ** 2)
  assert.equal(h.NanoCpus, resources.cpuMillis * 1_000_000); assert.equal(h.PidsLimit, resources.pidsLimit)
  assert.deepEqual(h.Tmpfs, { '/tmp': 'rw,nosuid,nodev,mode=1777,size=134217728' })
  assert.equal(h.SecurityOpt.length, 2); assert.ok(h.SecurityOpt.includes('no-new-privileges:true'))
  const profile = h.SecurityOpt.find(value => value.startsWith('seccomp='))
  assert.ok(profile); assert.deepEqual(JSON.parse(profile.slice(8)), seccomp)
  const expectedVolumes = [[p.volumeName, '/var/lib/paimind', true], [expected.controlVolume, '/run/paimind-cell', false]]
  assert.equal(c.Mounts.length, 2); assert.equal(h.Mounts.length, 2); assert.equal(volumes.length, 2)
  for (const [name, destination, writable] of expectedVolumes) {
    const mount = c.Mounts.find(item => item.Destination === destination)
    assert.equal(mount?.Type, 'volume'); assert.equal(mount.Name, name); assert.equal(mount.RW, writable)
    const declared = h.Mounts.find(item => item.Target === destination)
    assert.equal(declared?.Source, name); assert.equal(declared.VolumeOptions.NoCopy, true)
    const volume = volumes.find(item => item.Name === name)
    assert.equal(volume?.Driver, 'local'); assert.equal(volume.Scope, 'local')
    assert.deepEqual(volume.Options ?? {}, {}); assert.deepEqual(references[name], [p.containerId])
    for (const [key, value] of Object.entries(expected.labels)) assert.equal(volume.Labels[key], value)
  }
  for (const [key, value] of Object.entries(expected.labels)) {
    assert.equal(c.Config.Labels[key], value); assert.equal(n.Labels[key], value)
  }
  assert.equal(n.Id, expected.networkId); assert.equal(n.Driver, 'bridge'); assert.equal(n.Internal, false)
  assert.deepEqual(Object.keys(n.Containers), [p.containerId])
  assert.equal(Object.keys(c.NetworkSettings.Networks).length, 1)
  assert.equal(Object.values(c.NetworkSettings.Networks)[0].NetworkID, expected.networkId)
  const target = new URL(p.origin)
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.protocol, 'http:')
  assert.ok(Number(target.port) >= 1024 && target.port !== '3080')
  assert.deepEqual(c.NetworkSettings.Ports, { '3211/tcp': [{ HostIp: '127.0.0.1', HostPort: target.port }] })
  assert.deepEqual(Object.keys(h.PortBindings), ['3211/tcp'])
  assert.equal(ready.event, 'managed-native-profile-ready')
  // The native bootstrap reports technical readiness only. Admission belongs
  // to this controller; old images without the private owner channel must not
  // receive bindings from the updated gateway/controller pair.
  assert.equal(ready.memberAdmissionVerified, false)
  assert.equal(ready.nativePrivateControlActive, true, 'Member admission requires active private native control')
  assert.equal(ready.cellId, p.cellId); assert.equal(ready.policyDigest, p.policyDigest)
  assert.equal(ready.toolPolicy, toolPolicy); assert.equal(ready.storageMounted, true)
  // Older admitted member images have no role field; their member-only policy
  // and exact digest remain required. An administrator requires explicit role
  // readback from the new image and cannot borrow a member readiness receipt.
  if (p.role === 'admin' || ready.cellRole !== undefined) assert.equal(ready.cellRole, p.role)
  assert.equal(ready.nativeToolGuardActive, true); assert.equal(ready.unpreparedExecutionRootGateActive, true)
  return Object.freeze({ cellId: p.cellId, userId: p.userId, containerId: p.containerId, observedAt: new Date().toISOString(),
    resources: { ...resources }, persistentStorageQuota: 'not-enforced',
    immutableRuntimeVerified: true, finalWorkerImageAccepted: false, outboundNetworkPolicyVerified: false })
}
