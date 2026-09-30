import assert from 'node:assert/strict'
import test from 'node:test'
import { requireLoopbackOnlyNetwork, requireReadOnlyExactMount } from '../../deploy/enterprise/worker/runtime/verify-offline-consumer-environment.mjs'
import { sourceBuildArtifacts } from '../../deploy/enterprise/worker/runtime/verify-worker-source-build.mjs'

test('consumer requires exact mounts plus actual EROFS denial, never trusting a ro label or permission bits', () => {
  const mount = '1 2 0:1 / /store ro,relatime - overlay overlay rw\n'
  const readOnly = {writable:false, denial:'EROFS'}
  assert.deepEqual(requireReadOnlyExactMount(mount, '/store', readOnly), {mountTableReadOnly:true,writeOpenDenial:'EROFS'})
  assert.deepEqual(requireReadOnlyExactMount(mount.replace('ro,relatime', 'rw,relatime'), '/store', readOnly), {mountTableReadOnly:false,writeOpenDenial:'EROFS'})
  for (const value of [mount + mount, mount.replace('/store ', '/store/nested '), mount + mount.replace('/store ', '/store/nested ')]) {
    assert.throws(() => requireReadOnlyExactMount(value, '/store', readOnly))
  }
  for (const access of [undefined,{writable:true},{writable:false,denial:'EACCES'},{writable:false,denial:'EPERM'},{writable:true,denial:'EROFS'}]) {
    assert.throws(() => requireReadOnlyExactMount(mount, '/store', access))
  }
})
test('consumer refuses any externally addressable interface even alongside loopback', () => {
  const lo = [{ address: '127.0.0.1', internal: true }, { address: '::1', internal: true }]
  assert.equal(requireLoopbackOnlyNetwork({ lo }), true)
  for (const value of [{}, {lo:[]}, {lo, eth0:[]}, {lo:[{address:'10.0.0.1',internal:true}]}]) {
    assert.throws(() => requireLoopbackOnlyNetwork(value))
  }
})
test('source build checks real runtime, client, public declarations and maps without declaring final image acceptance', () => {
  assert.deepEqual(sourceBuildArtifacts({ exports: { '.': { types: './lib/types/index.d.ts', default: './lib/index.js' } },
    paimindBuild: { node: ['src/index.ts'], client: 'src/client/index.tsx' } }), [
    'lib/client.js', 'lib/client.js.map', 'lib/index.js', 'lib/index.js.map', 'lib/types/index.d.ts', 'lib/types/index.d.ts.map',
  ])
  assert.throws(() => sourceBuildArtifacts({exports:{'.':'./lib/../../outside.js'}}))
  assert.throws(() => sourceBuildArtifacts({paimindBuild:{node:['src/../../outside.ts']}}))
  assert.throws(() => sourceBuildArtifacts({paimindBuild:{}}))
  assert.deepEqual(sourceBuildArtifacts({dsh:{bundle:{patch:'cordis.patch.yml'}}}), [])
})
