import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyMemberCell, verifyManagedCell } from './member-cell.mjs'

function fixture() {
  const pin = { role: 'member', containerId: 'a'.repeat(64), imageId: 'sha256:' + 'b'.repeat(64), cellId: 'cell-test', userId: 'user-test',
    volumeName: 'paimind-haas-member-test-data', policyDigest: 'sha256:' + 'c'.repeat(64), origin: 'http://127.0.0.1:49152' }
  const labels = { 'io.paimind.goal': 'synthetic-readback-test', 'io.paimind.runtime-cell': pin.cellId }
  const expected = { pin, labels, name: 'test-native', generation: '/generation', networkId: 'network-test', controlVolume: 'control-test' }
  const seccomp = { defaultAction: 'SCMP_ACT_ERRNO', syscalls: [] }
  const mounts = [{ Type: 'volume', Name: pin.volumeName, Destination: '/var/lib/paimind', RW: true },
    { Type: 'volume', Name: expected.controlVolume, Destination: '/run/paimind-cell', RW: false }]
  const observations = { container: { Id: pin.containerId, Image: pin.imageId, Name: '/test-native', State: { Running: true },
    Config: { User: '10001:10001', WorkingDir: '/var/lib/paimind', Labels: labels,
      Entrypoint: ['/usr/local/bin/node', '/usr/local/lib/paimind/start-native-runtime.mjs'], Cmd: ['--run-storage', '/generation'],
      Env: ['PAIMIND_CELL_INGRESS=1', 'PAIMIND_CELL_POLICY=member-personal-v1'] },
    HostConfig: { ReadonlyRootfs: true, Privileged: false, Init: true, CapDrop: ['ALL'], RestartPolicy: { Name: 'no' },
      NetworkMode: expected.networkId, IpcMode: 'private', PidMode: '', UTSMode: '', CgroupnsMode: 'private', PublishAllPorts: false,
      Memory: 1073741824, NanoCpus: 1000000000, PidsLimit: 256,
      Tmpfs: { '/tmp': 'rw,nosuid,nodev,mode=1777,size=134217728' }, SecurityOpt: ['no-new-privileges:true', 'seccomp=' + JSON.stringify(seccomp)],
      Mounts: mounts.map(m => ({ Source: m.Name, Target: m.Destination, VolumeOptions: { NoCopy: true } })), PortBindings: { '3211/tcp': [] } },
    Mounts: mounts, NetworkSettings: { Networks: { isolated: { NetworkID: expected.networkId } },
      Ports: { '3211/tcp': [{ HostIp: '127.0.0.1', HostPort: '49152' }] } } },
    network: { Id: expected.networkId, Driver: 'bridge', Internal: false, Labels: labels, Containers: { [pin.containerId]: {} } },
    volumes: mounts.map(m => ({ Name: m.Name, Driver: 'local', Scope: 'local', Labels: labels })),
    references: Object.fromEntries(mounts.map(m => [m.Name, [pin.containerId]])),
    ready: { event: 'managed-native-profile-ready', cellId: pin.cellId, policyDigest: pin.policyDigest,
      toolPolicy: 'member-personal-v1', storageMounted: true, nativePrivateControlActive: true,
      memberAdmissionVerified: false, nativeToolGuardActive: true, unpreparedExecutionRootGateActive: true } }
  return { observations, expected, seccomp }
}
test('exact immutable container readback passes without claiming final acceptance', () => {
  const f = fixture(); const result = verifyMemberCell(f.observations, f.expected, f.seccomp)
  assert.equal(result.immutableRuntimeVerified, true); assert.equal(result.finalWorkerImageAccepted, false)
})
test('explicit per-user resource snapshot must match actual container limits, never merely requested policy', () => {
  const f = fixture()
  f.expected.resources = { revision: 2, desiredState: 'running', cpuMillis: 500, memoryMiB: 512, pidsLimit: 64 }
  assert.throws(() => verifyManagedCell(f.observations, f.expected, f.seccomp))
  Object.assign(f.observations.container.HostConfig, { Memory: 512 * 1024 ** 2, NanoCpus: 500000000, PidsLimit: 64 })
  const result = verifyManagedCell(f.observations, f.expected, f.seccomp)
  assert.deepEqual(result.resources, f.expected.resources)
  assert.equal(result.persistentStorageQuota, 'not-enforced')
  for (const change of [{ cpuMillis: 0 }, { cpuMillis: 1001 }, { memoryMiB: 255 }, { pidsLimit: 257 }, { desiredState: 'suspended' }]) {
    assert.throws(() => verifyManagedCell(f.observations, { ...f.expected, resources: { ...f.expected.resources, ...change } }, f.seccomp))
  }
})
test('privilege, host mounts, public ports, image or native policy substitution is rejected', () => {
  for (const change of [o => o.container.HostConfig.Privileged = true,
    o => o.container.HostConfig.Binds = ['/host:/data'], o => o.container.HostConfig.CapAdd = ['SYS_ADMIN'],
    o => o.container.NetworkSettings.Ports['3211/tcp'][0].HostIp = '0.0.0.0',
    o => o.container.Image = 'different', o => o.ready.policyDigest = 'different',
    o => o.ready.nativeToolGuardActive = false, o => o.container.Config.Entrypoint = ['sh'],
    o => o.container.HostConfig.SecurityOpt = ['no-new-privileges:true', 'seccomp=unconfined']]) {
    const f = fixture(); change(f.observations); assert.throws(() => verifyMemberCell(f.observations, f.expected, f.seccomp))
  }
})
test('shared volumes, additional network peers and writable private control volumes reject', () => {
  for (const change of [o => o.references['control-test'].push('foreign'), o => o.network.Containers.foreign = {},
    o => o.container.Mounts[1].RW = true, o => o.container.HostConfig.Mounts[0].VolumeOptions.NoCopy = false,
    o => o.volumes[0].Options = { device: '/host', type: 'none', o: 'bind' }, o => o.container.State.Running = false]) {
    const f = fixture(); change(f.observations); assert.throws(() => verifyMemberCell(f.observations, f.expected, f.seccomp))
  }
})

test('missing, inactive or malformed private native control readiness cannot admit a member cell', () => {
  for (const value of [undefined, false, null, 1, 'true', {}, []]) {
    const f = fixture()
    if (value === undefined) delete f.observations.ready.nativePrivateControlActive
    else f.observations.ready.nativePrivateControlActive = value
    assert.throws(() => verifyMemberCell(f.observations, f.expected, f.seccomp),
      /private native control/, `Rejected readiness value: ${JSON.stringify(value)}`)
  }
})

test('only the exact native bootstrap event is accepted and it cannot self-grant member admission', () => {
  for (const change of [o => delete o.ready.event, o => o.ready.event = 'other-ready',
    o => delete o.ready.memberAdmissionVerified, o => o.ready.memberAdmissionVerified = true,
    o => o.ready.memberAdmissionVerified = 'false']) {
    const f = fixture(); change(f.observations)
    assert.throws(() => verifyMemberCell(f.observations, f.expected, f.seccomp))
  }
})

test('administrator readback requires its explicit native role and policy without relaxing any isolation boundary', () => {
  const admin = () => {
    const f = fixture(); f.expected.pin.role = 'admin'
    f.observations.container.Config.Env = ['PAIMIND_CELL_INGRESS=1', 'PAIMIND_CELL_POLICY=admin-authoring-v1']
    f.observations.ready.toolPolicy = 'admin-authoring-v1'; f.observations.ready.cellRole = 'admin'
    return f
  }
  const f = admin()
  assert.equal(verifyManagedCell(f.observations, f.expected, f.seccomp).immutableRuntimeVerified, true)
  assert.throws(() => verifyMemberCell(f.observations, f.expected, f.seccomp), /Member-only/)
  for (const change of [o => delete o.ready.cellRole, o => o.ready.cellRole = 'member',
    o => o.ready.toolPolicy = 'member-personal-v1', o => o.container.Config.Env.push('PAIMIND_CELL_POLICY=member-personal-v1'),
    o => o.container.HostConfig.Privileged = true, o => o.container.HostConfig.CapAdd = ['SYS_ADMIN'],
    o => o.container.Mounts[1].RW = true, o => o.references['control-test'].push('foreign'),
    o => o.ready.nativePrivateControlActive = false, o => o.ready.nativeToolGuardActive = false]) {
    const f = admin(); change(f.observations); assert.throws(() => verifyManagedCell(f.observations, f.expected, f.seccomp))
  }
})
