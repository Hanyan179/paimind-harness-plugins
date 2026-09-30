import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import test from 'node:test'
import {
  assertPnpmProjectRegistryLinkMetadata,
  normalizePnpmProjectRegistry,
  requirePnpmProjectRegistryNormalizationReceipt,
} from './normalize-pnpm-project-registry.mjs'
import {
  WORKER_BUILD_ROOT_CONTRACT,
  WORKER_BUILD_ROOT_CONTRACT_DIGEST,
} from './worker-build-root-contract.mjs'

function projectId(path) {
  return createHash('sha256').update(path).digest('hex').slice(0, 32)
}

async function fixture(t) {
  const temporaryBase = await realpath(tmpdir())
  const temporaryRoot = await mkdtemp(join(temporaryBase, 'paimind-project-registry-'))
  const sourceRoot = join(temporaryRoot, 'source')
  const storeRoot = join(temporaryRoot, 'store')
  const projectsRoot = join(storeRoot, 'v11', 'projects')
  const filesRoot = join(storeRoot, 'v11', 'files', 'aa')
  const linksRoot = join(storeRoot, 'v11', 'links')
  await Promise.all([
    mkdir(sourceRoot, { recursive: true }),
    mkdir(projectsRoot, { recursive: true }),
    mkdir(filesRoot, { recursive: true }),
    mkdir(linksRoot, { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(filesRoot, `${'b'.repeat(126)}`), 'content'),
    writeFile(join(storeRoot, 'v11', 'index.db'), 'index'),
  ])
  const expectedProjectId = projectId(sourceRoot)
  const expectedLinkPath = join(projectsRoot, expectedProjectId)
  const rawTarget = relative(projectsRoot, sourceRoot)
  await symlink(rawTarget, expectedLinkPath, 'dir')
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }))
  return {
    temporaryRoot,
    sourceRoot,
    storeRoot,
    projectsRoot,
    filesRoot,
    linksRoot,
    expectedProjectId,
    expectedLinkPath,
    rawTarget,
  }
}

function options(source, overrides = {}) {
  return {
    sourceRoot: source.sourceRoot,
    storeRoot: source.storeRoot,
    enforceLockedRoots: false,
    requiredOwnerUid: process.getuid?.() ?? 0,
    ...overrides,
  }
}

async function registrySnapshot(source) {
  const entries = []
  for (const name of (await readdir(source.projectsRoot)).sort()) {
    const path = join(source.projectsRoot, name)
    const metadata = await lstat(path)
    entries.push({
      name,
      type: metadata.isSymbolicLink() ? 'link' : metadata.isDirectory() ? 'directory' : metadata.isFile() ? 'file' : 'other',
      target: metadata.isSymbolicLink() ? await readlink(path) : undefined,
    })
  }
  return entries
}

async function expectFailureWithoutRegistryDeletion(source, pattern, overrides = {}) {
  const before = await registrySnapshot(source)
  await assert.rejects(normalizePnpmProjectRegistry(options(source, overrides)), pattern)
  assert.deepEqual(await registrySnapshot(source), before)
}

test('removes only the exact pnpm 11.7.0 Project Registry link and emits a path-free receipt', async t => {
  const source = await fixture(t)
  const receipt = await normalizePnpmProjectRegistry(options(source))
  const lockedSourceRoot = WORKER_BUILD_ROOT_CONTRACT.roots.source.path
  const lockedStoreRoot = WORKER_BUILD_ROOT_CONTRACT.roots.store.path
  const lockedProjectId = projectId(lockedSourceRoot)
  const lockedTarget = relative(join(lockedStoreRoot, 'v11', 'projects'), lockedSourceRoot)
  assert.deepEqual(receipt, {
    schemaVersion: 1,
    status: 'PASS',
    packageManager: 'pnpm@11.7.0',
    policy: 'pnpm-v11-project-registry-exact-link-removal-v1',
    evidenceRole: 'pre-seal-generated-metadata-removal',
    rootContractDigest: WORKER_BUILD_ROOT_CONTRACT_DIGEST,
    sourceRootDigest: `sha256:${createHash('sha256').update(lockedSourceRoot).digest('hex')}`,
    storeRootDigest: `sha256:${createHash('sha256').update(lockedStoreRoot).digest('hex')}`,
    registryPathDigest: `sha256:${createHash('sha256').update(`v11/projects/${lockedProjectId}`).digest('hex')}`,
    linkTargetDigest: `sha256:${createHash('sha256').update(lockedTarget).digest('hex')}`,
    removedEntries: 1,
    unexpectedEntries: 0,
    residualSymlinks: 0,
    registryDirectoryRemoved: true,
  })
  assert.deepEqual(requirePnpmProjectRegistryNormalizationReceipt(receipt), receipt)
  assert.equal(Object.isFrozen(receipt), true)
  await assert.rejects(lstat(source.projectsRoot), error => error?.code === 'ENOENT')
  assert.equal(JSON.stringify(receipt).includes(source.temporaryRoot), false)
  assert.equal(JSON.stringify(receipt).includes(source.rawTarget), false)
})

test('strictly validates the exact locked path-free normalization receipt schema', async t => {
  const source = await fixture(t)
  const receipt = await normalizePnpmProjectRegistry(options(source))
  const mutations = [
    value => { delete value.policy },
    value => { value.extra = true },
    value => { value.policy = 'other-policy' },
    value => { value.evidenceRole = 'other-role' },
    value => { value.schemaVersion = 2 },
    value => { value.status = 'FAIL' },
    value => { value.packageManager = 'pnpm@11.7.1' },
    value => { value.rootContractDigest = `sha256:${'0'.repeat(64)}` },
    value => { value.sourceRootDigest = `sha256:${'0'.repeat(64)}` },
    value => { value.storeRootDigest = `sha256:${'0'.repeat(64)}` },
    value => { value.registryPathDigest = `sha256:${'0'.repeat(64)}` },
    value => { value.linkTargetDigest = `sha256:${'0'.repeat(64)}` },
    value => { value.removedEntries = 0 },
    value => { value.unexpectedEntries = 1 },
    value => { value.residualSymlinks = 1 },
    value => { value.registryDirectoryRemoved = false },
  ]
  for (const mutate of mutations) {
    const candidate = { ...receipt }
    mutate(candidate)
    assert.throws(
      () => requirePnpmProjectRegistryNormalizationReceipt(candidate, 'candidate receipt'),
      /candidate receipt does not match the locked/u,
    )
  }
})

test('fails closed without partial deletion on wrong hash, target, link form or Registry shape', async t => {
  const mutations = {
    'wrong hash': async source => {
      await rename(source.expectedLinkPath, join(source.projectsRoot, '0'.repeat(32)))
    },
    'relative outbound target': async source => {
      const other = join(source.temporaryRoot, 'other-source')
      await mkdir(other)
      await unlink(source.expectedLinkPath)
      await symlink(relative(source.projectsRoot, other), source.expectedLinkPath, 'dir')
    },
    'absolute target': async source => {
      await unlink(source.expectedLinkPath)
      await symlink(source.sourceRoot, source.expectedLinkPath, 'dir')
    },
    'dangling target': async source => {
      await unlink(source.expectedLinkPath)
      await symlink(relative(source.projectsRoot, join(source.temporaryRoot, 'missing')), source.expectedLinkPath, 'dir')
    },
    'target chain': async source => {
      const realSource = join(source.temporaryRoot, 'real-source')
      await mkdir(realSource)
      await rm(source.sourceRoot, { recursive: true })
      await symlink(realSource, source.sourceRoot, 'dir')
    },
    'self cycle': async source => {
      await unlink(source.expectedLinkPath)
      await symlink(source.expectedProjectId, source.expectedLinkPath, 'dir')
    },
    'extra entry': async source => {
      await writeFile(join(source.projectsRoot, 'extra'), 'unexpected')
    },
    'regular replacement': async source => {
      await unlink(source.expectedLinkPath)
      await writeFile(source.expectedLinkPath, 'unexpected')
    },
    'directory replacement': async source => {
      await unlink(source.expectedLinkPath)
      await mkdir(source.expectedLinkPath)
    },
  }
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async child => {
      const source = await fixture(child)
      await mutate(source)
      await expectFailureWithoutRegistryDeletion(
        source,
        /locked Worker source entry|target|real directory|only the locked Project Registry symbolic link/u,
      )
    })
  }
})

test('rejects every symlink outside the exact Project Registry entry and every hard-linked Store file', async t => {
  for (const location of ['files', 'links']) {
    await t.test(`${location} symlink`, async child => {
      const source = await fixture(child)
      const parent = location === 'files' ? source.filesRoot : source.linksRoot
      await symlink(source.sourceRoot, join(parent, 'unexpected'), 'dir')
      await expectFailureWithoutRegistryDeletion(source, /only the locked Project Registry symbolic link/u)
      assert.equal((await lstat(join(parent, 'unexpected'))).isSymbolicLink(), true)
    })
  }

  await t.test('unknown-location symlink', async child => {
    const source = await fixture(child)
    const unknownRoot = join(source.storeRoot, 'v11', 'unknown')
    await mkdir(unknownRoot)
    await symlink(source.sourceRoot, join(unknownRoot, 'unexpected'), 'dir')
    await expectFailureWithoutRegistryDeletion(source, /only the locked Project Registry symbolic link/u)
    assert.equal((await lstat(join(unknownRoot, 'unexpected'))).isSymbolicLink(), true)
  })

  await t.test('hard-linked regular file', async child => {
    const source = await fixture(child)
    const content = join(source.filesRoot, 'b'.repeat(126))
    await link(content, join(source.temporaryRoot, 'external-hardlink'))
    await expectFailureWithoutRegistryDeletion(source, /hard-linked regular file/u)
  })

  await t.test('Registry link metadata requires one link and the locked owner', () => {
    const owner = process.getuid?.() ?? 0
    const metadata = {
      isSymbolicLink: () => true,
      uid: BigInt(owner),
      nlink: 1n,
    }
    assert.equal(assertPnpmProjectRegistryLinkMetadata(metadata, owner), true)
    assert.throws(
      () => assertPnpmProjectRegistryLinkMetadata({ ...metadata, nlink: 2n }, owner),
      /exactly one link/u,
    )
    assert.throws(
      () => assertPnpmProjectRegistryLinkMetadata({ ...metadata, uid: BigInt(owner + 1) }, owner),
      /unexpected owner/u,
    )
  })
})

test('rejects ownership mismatch and a replacement race without deleting the replacement', async t => {
  await t.test('owner mismatch', async child => {
    const source = await fixture(child)
    const wrongOwner = (process.getuid?.() ?? 0) + 1
    await expectFailureWithoutRegistryDeletion(source, /unexpected owner/u, { requiredOwnerUid: wrongOwner })
  })

  await t.test('replacement race', async child => {
    const source = await fixture(child)
    await assert.rejects(
      normalizePnpmProjectRegistry(options(source, {
        beforeCommit: async () => {
          await unlink(source.expectedLinkPath)
          await symlink(source.rawTarget, source.expectedLinkPath, 'dir')
        },
      })),
      /changed before normalization commit/u,
    )
    const metadata = await lstat(source.expectedLinkPath)
    assert.equal(metadata.isSymbolicLink(), true)
    assert.equal(await readlink(source.expectedLinkPath), source.rawTarget)
  })

  await t.test('post-validation entry race', async child => {
    const source = await fixture(child)
    let receipt
    await assert.rejects(
      async () => {
        receipt = await normalizePnpmProjectRegistry(options(source, {
          afterValidationBeforeCommit: async () => {
            await writeFile(join(source.projectsRoot, 'late-entry'), 'unexpected')
          },
        }))
      },
      /must contain exactly the locked Worker source entry/u,
    )
    assert.equal(receipt, undefined)
    assert.deepEqual((await readdir(source.projectsRoot)).sort(), [source.expectedProjectId, 'late-entry'].sort())
    assert.equal((await lstat(source.expectedLinkPath)).isSymbolicLink(), true)
  })
})

test('keeps locked production roots mandatory by default and rejects arguments at the API boundary', async () => {
  await assert.rejects(
    normalizePnpmProjectRegistry({ sourceRoot: '/tmp/source', storeRoot: '/tmp/store' }),
    /locked Worker build root contract/u,
  )
  await assert.rejects(
    normalizePnpmProjectRegistry(null),
    /options must be an object/u,
  )
})
