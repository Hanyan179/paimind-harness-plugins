import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  inspectWorkerBuildRootDirectory,
  parseWorkerBuildRootArguments,
  verifyWorkerBuildRootContract,
  WORKER_BUILD_ROOT_CONTRACT,
  WORKER_BUILD_ROOT_CONTRACT_DIGEST,
} from './worker-build-root-contract.mjs'

function lockedEnvironment() {
  return Object.fromEntries(Object.values(WORKER_BUILD_ROOT_CONTRACT.roots)
    .map(root => [root.environmentVariable, root.path]))
}

test('locks every build root through fixed environment variables and emits one path-free digest receipt', async () => {
  const first = await verifyWorkerBuildRootContract({ environment: lockedEnvironment() })
  const second = await verifyWorkerBuildRootContract({ environment: { ...lockedEnvironment() } })
  assert.deepEqual(first, second)
  assert.deepEqual(first.requiredRoots, [])
  assert.deepEqual(first.verifiedRoots, [])
  assert.match(first.contractDigest, /^sha256:[a-f0-9]{64}$/u)
  assert.equal(first.contractDigest, WORKER_BUILD_ROOT_CONTRACT_DIGEST)
  const serialized = JSON.stringify(first)
  assert.equal(serialized.includes('/'), false)
  for (const root of Object.values(WORKER_BUILD_ROOT_CONTRACT.roots)) {
    assert.equal(serialized.includes(root.path), false)
  }
})

test('fails closed for missing, relative, filesystem-root, unnormalized and unlocked environment values', async () => {
  const missing = lockedEnvironment()
  delete missing.PAIMIND_WORKER_PNPM_STORE_ROOT
  await assert.rejects(verifyWorkerBuildRootContract({ environment: missing }), /environment variable is missing/)

  const relative = { ...lockedEnvironment(), PAIMIND_WORKER_BUILD_SOURCE_ROOT: 'build-source' }
  await assert.rejects(verifyWorkerBuildRootContract({ environment: relative }), /non-root absolute path/)

  const filesystemRoot = { ...lockedEnvironment(), PAIMIND_WORKER_BUILD_SOURCE_ROOT: '/' }
  await assert.rejects(verifyWorkerBuildRootContract({ environment: filesystemRoot }), /non-root absolute path/)

  const unnormalized = { ...lockedEnvironment(), PAIMIND_WORKER_BUILD_SOURCE_ROOT: '/opt/../opt/paimind-enterprise-build-source' }
  await assert.rejects(verifyWorkerBuildRootContract({ environment: unnormalized }), /lexically normalized/)

  const unlocked = { ...lockedEnvironment(), PAIMIND_WORKER_BUILD_SOURCE_ROOT: '/opt/paimind-enterprise-build-source-other' }
  await assert.rejects(verifyWorkerBuildRootContract({ environment: unlocked }), /locked root contract/)
})

test('rejects overlapping build roots before accepting their locked identities', async () => {
  const overlapping = {
    ...lockedEnvironment(),
    PAIMIND_WORKER_ASSEMBLED_ROOT: '/runtime-deploy/assembled',
  }
  await assert.rejects(verifyWorkerBuildRootContract({ environment: overlapping }), /roots overlap: deploy and assembled/)
})

test('parses explicit required root lists deterministically and rejects unknown or empty names', () => {
  assert.deepEqual(parseWorkerBuildRootArguments([]), { requiredRoots: [] })
  assert.deepEqual(parseWorkerBuildRootArguments(['--require=store,source', '--require=deploy,store']), {
    requiredRoots: ['deploy', 'source', 'store'],
  })
  assert.throws(() => parseWorkerBuildRootArguments(['--require=']), /may not be empty/)
  assert.throws(() => parseWorkerBuildRootArguments(['--require=source,']), /empty name/)
  assert.throws(() => parseWorkerBuildRootArguments(['--require=unknown']), /unknown Worker build root name/)
  assert.throws(() => parseWorkerBuildRootArguments(['--other=source']), /unknown argument/)
})

test('requires requested root directories to exist as direct canonical non-symlink directories', async t => {
  const createdRoot = await mkdtemp(join(tmpdir(), 'paimind-worker-build-root-contract-'))
  const temporaryRoot = await realpath(createdRoot)
  t.after(() => rm(createdRoot, { recursive: true, force: true }))

  const direct = join(temporaryRoot, 'direct')
  await mkdir(direct)
  const inspected = await inspectWorkerBuildRootDirectory('source', direct)
  assert.equal(inspected.root, 'source')
  assert.match(inspected.identityDigest, /^sha256:[a-f0-9]{64}$/u)
  assert.equal(inspected.ownerUid, process.getuid())
  assert.equal(inspected.ownerGid, process.getgid())
  assert.equal(inspected.mode, 0o755)
  assert.equal(JSON.stringify(inspected).includes(direct), false)

  await assert.rejects(
    inspectWorkerBuildRootDirectory('store', join(temporaryRoot, 'missing')),
    /root store is missing/,
  )

  const file = join(temporaryRoot, 'file')
  await writeFile(file, 'not-a-directory')
  await assert.rejects(inspectWorkerBuildRootDirectory('deploy', file), /must be a directory/)

  const symbolicRoot = join(temporaryRoot, 'symbolic-root')
  await symlink(direct, symbolicRoot, 'dir')
  await assert.rejects(inspectWorkerBuildRootDirectory('assembled', symbolicRoot), /may not be a symbolic link/)

  const aliasedParent = join(temporaryRoot, 'aliased-parent')
  const canonicalParent = join(temporaryRoot, 'canonical-parent')
  await mkdir(join(canonicalParent, 'child'), { recursive: true })
  await symlink(canonicalParent, aliasedParent, 'dir')
  await assert.rejects(
    inspectWorkerBuildRootDirectory('final', join(aliasedParent, 'child')),
    /may not alias another path/,
  )
})
