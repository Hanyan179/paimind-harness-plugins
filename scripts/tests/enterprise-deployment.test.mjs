import assert from 'node:assert/strict'
import test from 'node:test'
import { chmod, link, lstat, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detachGeneratedDeploymentLinks, inspectWorkerDeployment, requireContainedDeploymentPath, sealWorkerRuntimePermissions, FORBIDDEN_DEPLOYMENT_PACKAGES } from '../../deploy/enterprise/worker/runtime/verify-worker-deployment.mjs'
import { DEPLOY_ARGS } from '../../deploy/enterprise/worker/runtime/verify-offline-consumer-environment.mjs'

test('production deployment selects the actual runtime carrier and retains offline frozen options', () => {
  assert.deepEqual(DEPLOY_ARGS, [
    '--store-dir=/opt/paimind-enterprise-pnpm-store','--frozen-store','--config.side-effects-cache=false',
    '--config.inject-workspace-packages=true','--config.auto-install-peers=true','--offline',
    '--filter','@paimind/enterprise-worker-runtime','--fail-if-no-match','deploy','--prod','--legacy','/runtime-deploy',
  ])
  assert.ok(FORBIDDEN_DEPLOYMENT_PACKAGES.includes('postgres'))
  assert.ok(FORBIDDEN_DEPLOYMENT_PACKAGES.includes('@paimind/enterprise-server'))
})
test('production path containment rejects prefix lookalikes and outside roots', () => {
  assert.equal(requireContainedDeploymentPath('/runtime-deploy','/runtime-deploy/node_modules/package'),'node_modules/package')
  for (const path of ['/runtime-deploy-other/package','/opt/paimind-enterprise-build-source/package','/runtime-deploy/../source']) {
    assert.throws(() => requireContainedDeploymentPath('/runtime-deploy',path))
  }
})
test('deployment inspection refuses escaped links, leaked control plane and incomplete native closures', async t => {
  const temporary = await mkdtemp(join(tmpdir(),'paimind-deploy-verifier-'))
  const root = await realpath(temporary)
  t.after(() => rm(root,{recursive:true}))
  await writeFile(join(root,'package.json'),JSON.stringify({name:'@paimind/enterprise-worker-runtime',version:'0.1.0-alpha.0',private:true}))
  await assert.rejects(inspectWorkerDeployment(root),/Missing runtime package/)
  await mkdir(join(root,'node_modules'))
  const leak = join(root,'node_modules/postgres')
  await mkdir(leak)
  await writeFile(join(leak,'package.json'),JSON.stringify({name:'postgres',version:'3.4.9'}))
  await assert.rejects(inspectWorkerDeployment(root),/Control-plane or development package leaked/)
  await symlink('/usr',join(root,'node_modules/a-escape'))
  await assert.rejects(inspectWorkerDeployment(root),/escapes/)
})

test('generated peer-projection hardlinks are detached without writing through their source inode', async t => {
  const parent = await realpath(await mkdtemp(join(tmpdir(),'paimind-deploy-detach-')))
  t.after(() => rm(parent,{recursive:true}))
  const root = join(parent,'deploy'); await mkdir(root)
  const source = join(parent,'source'); await writeFile(source,'original bytes\n',{mode:0o755})
  await link(source,join(root,'a')); await link(source,join(root,'b'))
  const receipt = await detachGeneratedDeploymentLinks(root,join(parent,'carrier'))
  assert.equal(receipt.detachedFiles,2)
  assert.equal(receipt.samples[0].originalLinks,3)
  for (const name of ['a','b']) {
    const stat = await lstat(join(root,name)); assert.equal(stat.nlink,1)
    assert.equal(stat.mode & 0o777,0o755)
    assert.equal(await readFile(join(root,name),'utf8'),'original bytes\n')
  }
  await writeFile(join(root,'a'),'changed deployment\n')
  assert.equal(await readFile(source,'utf8'),'original bytes\n')
  assert.equal(await readFile(join(root,'b'),'utf8'),'original bytes\n')
})

test('only the exact generated self-link to the current private carrier may be omitted', async t => {
  const parent = await realpath(await mkdtemp(join(tmpdir(),'paimind-deploy-self-')))
  t.after(() => rm(parent,{recursive:true}))
  const root = join(parent,'deploy'); const carrier = join(parent,'carrier')
  const links = join(root,'node_modules/.pnpm/node_modules/@paimind')
  await mkdir(links,{recursive:true}); await mkdir(carrier)
  await writeFile(join(carrier,'package.json'),JSON.stringify({name:'@paimind/enterprise-worker-runtime',private:true}))
  const self = join(links,'enterprise-worker-runtime')
  await symlink(carrier,self)
  assert.equal((await detachGeneratedDeploymentLinks(root,carrier)).omittedSelfLinks,1)
  assert.equal(await readFile(join(carrier,'package.json'),'utf8'),JSON.stringify({name:'@paimind/enterprise-worker-runtime',private:true}))
  await symlink('/usr',self)
  await assert.rejects(detachGeneratedDeploymentLinks(root,carrier),/unexpected target/)
  assert.ok((await lstat(self)).isSymbolicLink())
})

async function permissionFixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'paimind-runtime-permissions-')))
  t.after(() => rm(root, { recursive: true }))
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@paimind/enterprise-worker-runtime', private: true }), { mode: 0o400 })
  return root
}
test('image permissions preserve bytes and executability without exposing write access', async t => {
  const root = await permissionFixture(t)
  await mkdir(join(root, 'private'), { mode: 0o700 })
  await writeFile(join(root, 'private/code.js'), 'unchanged code', { mode: 0o400 })
  await writeFile(join(root, 'private/command'), '#!/bin/sh\n', { mode: 0o700 })
  await chmod(join(root, 'private/command'), 0o777)
  await symlink('private/code.js', join(root, 'contained-link'))
  const receipt = await sealWorkerRuntimePermissions(root)
  assert.equal(receipt.status, 'RUNTIME_PERMISSIONS_PREPARED'); assert.equal(receipt.containedLinks, 1)
  assert.equal((await lstat(join(root, 'private'))).mode & 0o7777, 0o755)
  assert.equal((await lstat(join(root, 'private/code.js'))).mode & 0o7777, 0o444)
  assert.equal((await lstat(join(root, 'private/command'))).mode & 0o7777, 0o555)
  assert.equal(await readFile(join(root, 'private/code.js'), 'utf8'), 'unchanged code')
  assert.ok((await lstat(join(root, 'contained-link'))).isSymbolicLink())
  assert.equal((await sealWorkerRuntimePermissions(root)).changed, 0)
})
test('permissions preflight rejects escaped links before changing any generated file', async t => {
  const root = await permissionFixture(t)
  await symlink('/usr', join(root, 'outside'))
  await assert.rejects(sealWorkerRuntimePermissions(root), /escapes/)
  assert.equal((await lstat(join(root, 'package.json'))).mode & 0o777, 0o400)
})
test('permissions preflight rejects shared inodes instead of chmod through a hardlink', async t => {
  const root = await permissionFixture(t)
  await link(join(root, 'package.json'), join(root, 'shared'))
  await assert.rejects(sealWorkerRuntimePermissions(root), /Unsafe runtime permissions target/)
  assert.equal((await lstat(join(root, 'shared'))).mode & 0o777, 0o400)
})
