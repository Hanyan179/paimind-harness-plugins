import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateCandidateContainer } from '../enterprise/runtime-candidate.mjs'

// Inspect-record contract tests only; these do not prove actual Docker isolation.
const expected = { imageId: `sha256:${'a'.repeat(64)}`, name: 'paimind-native-smoke-test', run: 'synthetic-run' }
const fixture = () => ({
  Name: `/${expected.name}`, Image: expected.imageId,
  Config: { User: '10001:10001', Labels: {
    'io.paimind.goal': 'enterprise-haas-native-runtime', 'io.paimind.run': expected.run,
  } },
  HostConfig: { ReadonlyRootfs: true, NetworkMode: 'none', Privileged: false,
    Binds: null, VolumesFrom: null, Devices: [], DeviceRequests: [], PortBindings: {}, CapDrop: ['ALL'],
    SecurityOpt: ['no-new-privileges:true'], PidsLimit: 256, Memory: 1024 ** 3, NanoCpus: 1_000_000_000,
    Tmpfs: { '/var/lib/paimind': 'rw,nosuid,nodev,uid=10001,gid=10001,mode=0700,size=268435456',
      '/tmp': 'rw,nosuid,nodev,mode=1777,size=134217728' },
  }, Mounts: [],
})
test('accepts only the owned bounded non-root network-none candidate contract', () => {
  assert.equal(validateCandidateContainer(fixture(), expected), true)
})
for (const [name, change] of Object.entries({
  'another image': value => { value.Image = `sha256:${'b'.repeat(64)}` },
  'another name': value => { value.Name = '/user-container' },
  'another run': value => { value.Config.Labels['io.paimind.run'] = 'foreign' },
  'another goal': value => { value.Config.Labels['io.paimind.goal'] = 'foreign' },
  'root user': value => { value.Config.User = '0:0' },
  'writable image': value => { value.HostConfig.ReadonlyRootfs = false },
  'host network': value => { value.HostConfig.NetworkMode = 'host' },
  'privileged execution': value => { value.HostConfig.Privileged = true },
  'capability retention': value => { value.HostConfig.CapDrop = [] },
  'privilege escalation': value => { value.HostConfig.SecurityOpt = [] },
  'host bind': value => { value.HostConfig.Binds = ['/user/home:/var/lib/paimind'] },
  'foreign volume': value => { value.HostConfig.VolumesFrom = ['user-container'] },
  'device access': value => { value.HostConfig.Devices = [{}] },
  'device request': value => { value.HostConfig.DeviceRequests = [{}] },
  'published port': value => { value.HostConfig.PortBindings = { '3210/tcp': [{ HostPort: '3080' }] } },
  'unbounded processes': value => { value.HostConfig.PidsLimit = -1 },
  'unbounded memory': value => { value.HostConfig.Memory = 0 },
  'unbounded CPU': value => { value.HostConfig.NanoCpus = 0 },
  'unexpected tmpfs': value => { value.HostConfig.Tmpfs['/opt/paimind'] = 'rw' },
  'tmpfs UID override': value => { value.HostConfig.Tmpfs['/var/lib/paimind'] += ',uid=0' },
  'unexpected materialized mount': value => { value.Mounts = [{ Type: 'volume', Destination: '/var/lib/paimind' }] },
})) {
  test(`rejects ${name} instead of accepting isolation by container label alone`, () => {
    const value = fixture(); change(value)
    assert.throws(() => validateCandidateContainer(value, expected))
  })
}
